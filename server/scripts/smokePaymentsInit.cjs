#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Safe post-deploy smoke: payment initialization only.
 *
 * - No confirmPayment, webhooks, or paid activation
 * - Creates pending gift vouchers marked with purchaseRequestId prefix gvr_smoke_
 * - Optional cleanup via SMOKE_CLEANUP=1 + MONGODB_URI
 *
 * Usage:
 *   npm run smoke:payments
 *   SMOKE_BASE_URL=https://driftdwells.com npm run smoke:payments
 *   SMOKE_CLEANUP=1 MONGODB_URI=... npm run smoke:payments
 */

const crypto = require('node:crypto');
const path = require('node:path');

const SMOKE_PURCHASE_REQUEST_PREFIX = 'gvr_smoke_';
const VOUCHER_VALUE_CENTS = 5000;
const PHYSICAL_FEE_CENTS = 500;
const AVAILABILITY_OFFSETS_DAYS = [30, 45, 60, 90, 120];

function parseBaseUrl() {
  const fromEnv = process.env.SMOKE_BASE_URL;
  if (fromEnv && String(fromEnv).trim()) {
    return String(fromEnv).trim().replace(/\/+$/, '');
  }
  return 'http://localhost:5000';
}

function buildRunId() {
  return `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function buildSmokePurchaseRequestId(runId, label) {
  const safeLabel = String(label || 'check')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  return `${SMOKE_PURCHASE_REQUEST_PREFIX}${runId}_${safeLabel}`;
}

function futureDateOnly(daysFromToday) {
  const d = new Date(Date.now() + daysFromToday * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function smokeBuyerIdentity(runId) {
  return {
    buyerName: 'SMOKE PAYMENTS (auto cleanup)',
    buyerEmail: `smoke-payments+${runId}@example.com`,
    recipientName: 'Smoke Recipient',
    recipientEmail: `smoke-recipient+${runId}@example.com`
  };
}

function isTheCabinListing(row) {
  if (!row || row.available !== true) return false;
  if (row.inventoryMode === 'multi' || row.cabinTypeId) return false;
  return String(row.name || '').trim() === 'The Cabin';
}

function isAFrameListing(row) {
  if (!row || row.available !== true) return false;
  const name = String(row.name || '').trim();
  const slug = String(row.slug || '').trim().toLowerCase();
  const isMulti = row.inventoryMode === 'multi' || Boolean(row.cabinTypeId);
  if (!isMulti) return false;
  return slug === 'a-frame' || /a-?frame/i.test(name);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(options.headers || {})
    }
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { response, body };
}

async function postJson(baseUrl, route, payload) {
  return fetchJson(`${baseUrl}${route}`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

function assertCheck(condition, message) {
  if (!condition) {
    const err = new Error(message);
    err.isSmokeFailure = true;
    throw err;
  }
}

async function checkHealth(baseUrl) {
  const { response, body } = await fetchJson(`${baseUrl}/api/health`);
  assertCheck(response.ok, `Health check failed: HTTP ${response.status}`);
  assertCheck(body?.success !== false, 'Health check returned unsuccessful payload');
}

async function findAvailabilityFixtures(baseUrl) {
  for (const startDays of AVAILABILITY_OFFSETS_DAYS) {
    const checkIn = futureDateOnly(startDays);
    const checkOut = futureDateOnly(startDays + 2);
    const query = new URLSearchParams({
      checkIn,
      checkOut,
      adults: '2',
      children: '0'
    });
    const { response, body } = await fetchJson(`${baseUrl}/api/availability?${query}`);
    if (!response.ok) {
      continue;
    }
    const cabins = body?.data?.cabins;
    if (!Array.isArray(cabins)) {
      continue;
    }
    const theCabin = cabins.find(isTheCabinListing);
    const aFrame = cabins.find(isAFrameListing);
    if (theCabin || aFrame) {
      return { checkIn, checkOut, theCabin, aFrame };
    }
  }
  return null;
}

function buildGiftVoucherBase(runId) {
  return {
    amountOriginalCents: VOUCHER_VALUE_CENTS,
    currency: 'EUR',
    termsAccepted: true,
    termsVersion: 'v1',
    ...smokeBuyerIdentity(runId)
  };
}

async function checkGiftVoucherEmailInit(baseUrl, runId, createdPurchaseRequestIds) {
  const purchaseRequestId = buildSmokePurchaseRequestId(runId, 'email');
  createdPurchaseRequestIds.push(purchaseRequestId);

  const quotePayload = {
    ...buildGiftVoucherBase(runId),
    deliveryMode: 'email'
  };

  const quote = await postJson(baseUrl, '/api/gift-vouchers/quote', {
    amountOriginalCents: quotePayload.amountOriginalCents,
    currency: quotePayload.currency,
    deliveryMode: 'email'
  });
  assertCheck(quote.response.status === 200, `Gift voucher email quote failed: HTTP ${quote.response.status}`);
  assertCheck(quote.body?.data?.totalDueCents === VOUCHER_VALUE_CENTS, 'Email quote totalDueCents expected 5000');
  assertCheck(quote.body?.data?.physicalCardFeeCents === 0, 'Email quote physicalCardFeeCents expected 0');

  const init = await postJson(baseUrl, '/api/gift-vouchers/create-payment-intent', {
    ...quotePayload,
    purchaseRequestId
  });
  assertCheck(init.response.status === 200, `Gift voucher email create-payment-intent failed: HTTP ${init.response.status}`);
  assertCheck(init.body?.success === true, 'Gift voucher email init success flag missing');
  assertCheck(
    typeof init.body?.data?.clientSecret === 'string' && init.body.data.clientSecret.length > 0,
    'Gift voucher email init missing clientSecret'
  );

  return {
    purchaseRequestId,
    giftVoucherId: init.body?.data?.giftVoucherId || null,
    clientSecretPresent: true,
    totalDueCents: quote.body?.data?.totalDueCents
  };
}

async function checkGiftVoucherPostalInit(baseUrl, runId, createdPurchaseRequestIds) {
  const purchaseRequestId = buildSmokePurchaseRequestId(runId, 'postal');
  createdPurchaseRequestIds.push(purchaseRequestId);

  const quote = await postJson(baseUrl, '/api/gift-vouchers/quote', {
    amountOriginalCents: VOUCHER_VALUE_CENTS,
    currency: 'EUR',
    deliveryMode: 'postal'
  });
  assertCheck(quote.response.status === 200, `Gift voucher postal quote failed: HTTP ${quote.response.status}`);
  assertCheck(quote.body?.data?.amountOriginalCents === VOUCHER_VALUE_CENTS, 'Postal quote voucher value expected 5000');
  assertCheck(quote.body?.data?.physicalCardFeeCents === PHYSICAL_FEE_CENTS, 'Postal quote physical fee expected 500');
  assertCheck(
    quote.body?.data?.totalDueCents === VOUCHER_VALUE_CENTS + PHYSICAL_FEE_CENTS,
    'Postal quote totalDueCents expected 5500'
  );

  const init = await postJson(baseUrl, '/api/gift-vouchers/create-payment-intent', {
    ...buildGiftVoucherBase(runId),
    deliveryMode: 'postal',
    purchaseRequestId,
    deliveryAddress: {
      addressLine1: '1 Smoke Test Lane',
      city: 'Sofia',
      postalCode: '1000',
      country: 'Bulgaria'
    }
  });
  assertCheck(init.response.status === 200, `Gift voucher postal create-payment-intent failed: HTTP ${init.response.status}`);
  assertCheck(init.body?.success === true, 'Gift voucher postal init success flag missing');
  assertCheck(
    typeof init.body?.data?.clientSecret === 'string' && init.body.data.clientSecret.length > 0,
    'Gift voucher postal init missing clientSecret'
  );

  return {
    purchaseRequestId,
    giftVoucherId: init.body?.data?.giftVoucherId || null,
    clientSecretPresent: true,
    totalDueCents: quote.body?.data?.totalDueCents,
    voucherValueCents: quote.body?.data?.amountOriginalCents,
    physicalCardFeeCents: quote.body?.data?.physicalCardFeeCents
  };
}

async function checkBookingInit(baseUrl, label, payload) {
  const init = await postJson(baseUrl, '/api/bookings/create-payment-intent', payload);
  assertCheck(init.response.status === 200, `${label} booking create-payment-intent failed: HTTP ${init.response.status}`);
  assertCheck(init.body?.success === true, `${label} booking init success flag missing`);

  const hasClientSecret =
    typeof init.body?.clientSecret === 'string' && init.body.clientSecret.length > 0;
  const fullVoucherCoverage = init.body?.fullVoucherCoverage === true;

  assertCheck(
    hasClientSecret || fullVoucherCoverage,
    `${label} booking init missing clientSecret and not fullVoucherCoverage`
  );

  return {
    paymentIntentId: init.body?.paymentIntentId || null,
    clientSecretPresent: hasClientSecret,
    fullVoucherCoverage
  };
}

async function cleanupSmokeVouchers(purchaseRequestIds) {
  if (!purchaseRequestIds.length) {
    return { attempted: false, voided: 0 };
  }

  const cleanupEnabled =
    process.env.SMOKE_CLEANUP === '1' || String(process.env.SMOKE_CLEANUP || '').toLowerCase() === 'true';
  if (!cleanupEnabled) {
    return {
      attempted: false,
      voided: 0,
      skippedReason: 'SMOKE_CLEANUP not enabled'
    };
  }

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    return {
      attempted: false,
      voided: 0,
      skippedReason: 'MONGODB_URI not set'
    };
  }

  const mongoose = require('mongoose');
  const GiftVoucher = require('../models/GiftVoucher');

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  try {
    const result = await GiftVoucher.updateMany(
      {
        purchaseRequestId: { $in: purchaseRequestIds },
        status: 'pending_payment'
      },
      {
        $set: { status: 'voided' }
      }
    );
    return {
      attempted: true,
      voided: result.modifiedCount || 0,
      matched: result.matchedCount || 0
    };
  } finally {
    await mongoose.disconnect();
  }
}

async function main() {
  try {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  } catch {
    // dotenv optional
  }

  const baseUrl = parseBaseUrl();
  const runId = buildRunId();
  const createdPurchaseRequestIds = [];
  const results = {
    success: true,
    baseUrl,
    runId,
    checks: {}
  };

  console.log(`[smoke:payments] baseUrl=${baseUrl} runId=${runId}`);

  await checkHealth(baseUrl);

  results.checks.giftVoucherEmail = await checkGiftVoucherEmailInit(
    baseUrl,
    runId,
    createdPurchaseRequestIds
  );
  console.log('[smoke:payments] gift voucher email init OK');

  results.checks.giftVoucherPostal = await checkGiftVoucherPostalInit(
    baseUrl,
    runId,
    createdPurchaseRequestIds
  );
  console.log('[smoke:payments] gift voucher postal init OK');

  const fixtures = await findAvailabilityFixtures(baseUrl);
  assertCheck(fixtures, 'Could not find safe availability fixtures for booking smoke checks');

  if (fixtures.theCabin) {
    results.checks.bookingTheCabin = await checkBookingInit(baseUrl, 'The Cabin', {
      cabinId: String(fixtures.theCabin._id),
      checkIn: fixtures.checkIn,
      checkOut: fixtures.checkOut,
      adults: 2,
      children: 0
    });
    console.log('[smoke:payments] booking The Cabin init OK');
  } else {
    results.checks.bookingTheCabin = { skipped: true, reason: 'The Cabin not available in scanned windows' };
    console.warn('[smoke:payments] skipped The Cabin — not available');
  }

  if (fixtures.aFrame) {
    results.checks.bookingAFrame = await checkBookingInit(baseUrl, 'A-Frame / The Valley', {
      cabinTypeId: String(fixtures.aFrame.cabinTypeId || fixtures.aFrame.cabinTypeRef || fixtures.aFrame._id),
      checkIn: fixtures.checkIn,
      checkOut: fixtures.checkOut,
      adults: 2,
      children: 0
    });
    console.log('[smoke:payments] booking A-Frame init OK');
  } else {
    results.checks.bookingAFrame = { skipped: true, reason: 'A-Frame not available in scanned windows' };
    console.warn('[smoke:payments] skipped A-Frame — not available');
  }

  const bookingChecks = [results.checks.bookingTheCabin, results.checks.bookingAFrame];
  const anyBookingRan = bookingChecks.some((check) => check && !check.skipped);
  assertCheck(anyBookingRan, 'No booking payment init checks could run');

  results.cleanup = await cleanupSmokeVouchers(createdPurchaseRequestIds);
  results.createdPurchaseRequestIds = createdPurchaseRequestIds;
  results.pendingVouchersCreated = createdPurchaseRequestIds.length;

  console.log(JSON.stringify(results, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(
      JSON.stringify(
        {
          success: false,
          script: 'smoke:payments',
          error: error?.message || String(error)
        },
        null,
        2
      )
    );
    process.exit(1);
  });
}

module.exports = {
  SMOKE_PURCHASE_REQUEST_PREFIX,
  VOUCHER_VALUE_CENTS,
  PHYSICAL_FEE_CENTS,
  parseBaseUrl,
  buildSmokePurchaseRequestId,
  isTheCabinListing,
  isAFrameListing,
  smokeBuyerIdentity
};
