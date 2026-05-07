#!/usr/bin/env node
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const mongoose = require('mongoose');
const CreatorReferralVisit = require('../models/CreatorReferralVisit');
const { normalizeReferralCode } = require('../models/CreatorPartner');

function getBaseUrl() {
  return (process.env.VERIFY_BASE_URL || process.env.E2E_BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');
}

async function postVisit(baseUrl, payload) {
  const response = await fetch(`${baseUrl}/api/creator-referral-visits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function run() {
  const referralCode = normalizeReferralCode(process.env.VERIFY_REFERRAL_CODE || 'diana.bosa');
  if (!referralCode) {
    throw new Error('Invalid VERIFY_REFERRAL_CODE value');
  }

  const visitorKey = process.env.VERIFY_VISITOR_KEY || `verify-${Date.now()}`;
  const sessionKey = process.env.VERIFY_SESSION_KEY || visitorKey;
  const baseUrl = getBaseUrl();
  const mongoUri = process.env.VERIFY_MONGODB_URI || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('Set VERIFY_MONGODB_URI (or MONGODB_URI/MONGO_URI) to verify Mongo write results');
  }

  await mongoose.connect(mongoUri, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 10000,
    retryWrites: true
  });

  const before = await CreatorReferralVisit.findOne({ referralCode, visitorKey }).lean();
  const beforeCount = Number(before?.visitCount || 0);

  const payload = {
    referralCode,
    landingPath: `/?ref=${referralCode}`,
    referrer: '',
    visitorKey,
    sessionKey
  };

  const first = await postVisit(baseUrl, payload);
  if (first.status !== 202 || first.body?.success !== true) {
    throw new Error(`First POST failed: status=${first.status} body=${JSON.stringify(first.body)}`);
  }

  const second = await postVisit(baseUrl, payload);
  if (second.status !== 202 || second.body?.success !== true) {
    throw new Error(`Second POST failed: status=${second.status} body=${JSON.stringify(second.body)}`);
  }

  const after = await CreatorReferralVisit.findOne({ referralCode, visitorKey }).lean();
  if (!after) {
    throw new Error(`CreatorReferralVisit row not found for referralCode=${referralCode} visitorKey=${visitorKey}`);
  }

  const afterCount = Number(after.visitCount || 0);
  if (afterCount < beforeCount + 2) {
    throw new Error(`visitCount did not increment as expected (before=${beforeCount}, after=${afterCount})`);
  }

  console.log('[verify-creator-referral-visit] ok', {
    referralCode,
    visitorKey,
    beforeCount,
    afterCount,
    dayBucket: after.dayBucket
  });
}

run()
  .then(async () => {
    await mongoose.connection.close();
    process.exit(0);
  })
  .catch((err) => {
    console.error('[verify-creator-referral-visit] failed', err?.message || err);
    mongoose.connection.close().finally(() => process.exit(1));
  });
