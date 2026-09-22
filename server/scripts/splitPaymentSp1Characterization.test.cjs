/**
 * SP1 — Split-payment isolation characterization (no split behavior).
 *
 * Locks CURRENT committed full-payment invariants + disabled SPLIT_PAYMENT_ENABLED.
 * Does not invent requiresFullPayment=false semantics beyond today's snapshot/charge path.
 *
 * Run: cd server && node --test --test-concurrency=1 scripts/splitPaymentSp1Characterization.test.cjs
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const featureFlags = require('../utils/featureFlags');
const {
  validateAndNormalizeRatePlan,
  buildResolvedSnapshot
} = require('../services/ratePlanService');
const {
  buildQuoteSnapshot,
  sanitizePackageSnapshotForCheckout
} = require('../services/checkout/checkoutSessionSnapshot');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SERVER_ROOT = path.join(__dirname, '..');

function readServerFile(relativeFromServer) {
  return fs.readFileSync(path.join(SERVER_ROOT, relativeFromServer), 'utf8');
}

function walkJsFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkJsFiles(full, out);
      continue;
    }
    if (entry.isFile() && /\.(js|cjs|mjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function withEnv(key, value, fn) {
  const prev = process.env[key];
  const had = Object.prototype.hasOwnProperty.call(process.env, key);
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    if (had) process.env[key] = prev;
    else delete process.env[key];
  }
}

function baseSeasonalPlan(overrides = {}) {
  return {
    code: 'sp1-char-winter',
    internalName: 'SP1 Char Winter',
    version: 1,
    status: 'active',
    type: 'seasonal_stay',
    currency: 'EUR',
    arrivalWindowStart: '2026-12-01',
    arrivalWindowEnd: '2026-12-31',
    minNights: 2,
    inventoryMode: 'shared',
    requiresFullPayment: true,
    cancellationPolicyCode: 'normal-stay-standard',
    cancellationPolicyVersion: 1,
    inclusions: ['Firewood'],
    accommodations: [
      {
        accommodationKey: 'lux-cabin',
        entityType: 'cabin',
        pricingMethod: 'nightly_per_unit',
        nightlyPerUnitAmount: 180,
        includedGuests: 2,
        additionalGuestNightlyAmount: 40
      }
    ],
    ...overrides
  };
}

test('SPLIT_PAYMENT_ENABLED defaults off when unset', () => {
  withEnv('SPLIT_PAYMENT_ENABLED', undefined, () => {
    assert.equal(featureFlags.isSplitPaymentEnabled(), false);
  });
});

test('SPLIT_PAYMENT_ENABLED respects explicit off/on tokens', () => {
  for (const off of ['0', 'false', 'off', 'no', ' FALSE ']) {
    withEnv('SPLIT_PAYMENT_ENABLED', off, () => {
      assert.equal(featureFlags.isSplitPaymentEnabled(), false, off);
    });
  }
  for (const on of ['1', 'true', 'on', 'yes', ' YES ']) {
    withEnv('SPLIT_PAYMENT_ENABLED', on, () => {
      assert.equal(featureFlags.isSplitPaymentEnabled(), true, on);
    });
  }
});

test('SP1: no runtime payment path branches on SPLIT_PAYMENT_ENABLED yet', () => {
  const flagDef = path.join(SERVER_ROOT, 'utils', 'featureFlags.js');
  const scanRoots = [
    path.join(SERVER_ROOT, 'services', 'checkout'),
    path.join(SERVER_ROOT, 'services', 'payments'),
    path.join(SERVER_ROOT, 'services', 'ops', 'ingestion'),
    path.join(SERVER_ROOT, 'services', 'giftVouchers'),
    path.join(SERVER_ROOT, 'services', 'locationCheckout'),
    path.join(SERVER_ROOT, 'routes')
  ];

  const offenders = [];
  for (const root of scanRoots) {
    for (const file of walkJsFiles(root)) {
      if (path.resolve(file) === path.resolve(flagDef)) continue;
      const src = fs.readFileSync(file, 'utf8');
      if (
        src.includes('SPLIT_PAYMENT_ENABLED') ||
        src.includes('isSplitPaymentEnabled')
      ) {
        offenders.push(path.relative(REPO_ROOT, file));
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `SP1 forbids payment branching on SPLIT_PAYMENT_ENABLED; offenders=${offenders.join(',')}`
  );
});

test('requiresFullPayment=false is snapshotted false but does not invent reduced charge math', () => {
  const normalized = validateAndNormalizeRatePlan(
    baseSeasonalPlan({ requiresFullPayment: false })
  );
  assert.equal(normalized.ok, true);
  assert.equal(normalized.value.requiresFullPayment, false);

  const resolved = buildResolvedSnapshot(
    normalized.value,
    'lux-cabin',
    { checkIn: '2026-12-10', checkOut: '2026-12-12' },
    'seasonal_auto'
  );
  assert.equal(resolved.payment.requiresFullPayment, false);

  const packageSnapshot = {
    ratePlanCode: resolved.code,
    ratePlanVersion: resolved.version,
    ratePlanType: resolved.type,
    currency: resolved.currency,
    arrivalDate: '2026-12-10',
    departureDate: '2026-12-12',
    accommodationKey: 'lux-cabin',
    pricingMethod: 'nightly_per_unit',
    inventoryMode: 'shared',
    requiresFullPayment: false,
    cancellationPolicyCode: 'normal-stay-standard',
    cancellationPolicyVersion: 1,
    inclusions: [],
    participants: [{ type: 'adult', count: 2 }],
    counts: { adults: 2, children: 0, infants: 0, total: 2 },
    capacityUsed: 2,
    capacityMaximum: 4,
    pricingBreakdown: {
      numberOfNights: 2,
      lodgingSubtotal: 360,
      additionalGuestAmount: 0,
      preDiscountTotal: 360
    },
    totalBeforePaymentCredits: 360
  };

  const sanitized = sanitizePackageSnapshotForCheckout(packageSnapshot);
  assert.ok(sanitized);
  assert.equal(sanitized.requiresFullPayment, false);

  const entityId = '0000000000000000000000aa';
  const snapshot = buildQuoteSnapshot({
    normalizedInput: {
      cabinId: entityId,
      checkIn: '2026-12-10',
      checkOut: '2026-12-12',
      adults: 2,
      children: 0,
      experienceKeys: [],
      transportMethod: '',
      romanticSetup: false,
      promoCode: '',
      voucherCode: ''
    },
    quote: {
      entityType: 'cabin',
      entity: {
        _id: entityId,
        minNights: 1,
        capacity: 4,
        pricingModel: 'per_night',
        slug: 'lux-cabin'
      },
      checkInDate: new Date('2026-12-10T00:00:00.000Z'),
      checkOutDate: new Date('2026-12-12T00:00:00.000Z'),
      subtotalPrice: 360,
      discountAmount: 0,
      totalPrice: 360,
      voucherAppliedCents: 0,
      remainingDueCents: 36000,
      fullVoucherCoverage: false,
      packageSnapshot,
      // fixed_package marker used by isFixedPackageQuote when present
      fixedPackage: true,
      ratePlan: {
        code: resolved.code,
        version: resolved.version,
        type: resolved.type,
        currency: resolved.currency
      }
    }
  });

  // Current behavior: card charge amount is full remaining due, independent of requiresFullPayment.
  assert.equal(snapshot.stripeAmountCents, 36000);
  assert.equal(snapshot.totalValueCents, 36000);
  assert.equal(snapshot.packageSnapshot?.requiresFullPayment, false);
});

test('canonical PaymentIntent service never reads requiresFullPayment for amount', () => {
  const src = readServerFile('services/checkout/checkoutCanonicalPaymentIntentService.js');
  assert.equal(src.includes('requiresFullPayment'), false);
  assert.match(src, /amount:\s*amountCents/);
  assert.match(src, /amountCents:\s*session\.stripeAmountCents/);
});

test('gift voucher and location checkout do not import split-payment flag', () => {
  const gift = readServerFile('services/giftVouchers/giftVoucherPaymentService.js');
  const location = readServerFile('services/locationCheckout/locationCheckoutService.js');
  const giftRoutes = readServerFile('routes/giftVoucherRoutes.js');
  const locationRoutes = readServerFile('routes/publicLocationCheckoutRoutes.js');

  for (const [label, src] of [
    ['giftVoucherPaymentService', gift],
    ['locationCheckoutService', location],
    ['giftVoucherRoutes', giftRoutes],
    ['publicLocationCheckoutRoutes', locationRoutes]
  ]) {
    assert.equal(src.includes('SPLIT_PAYMENT_ENABLED'), false, label);
    assert.equal(src.includes('isSplitPaymentEnabled'), false, label);
  }
});
