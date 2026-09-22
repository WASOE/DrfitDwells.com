/**
 * SP4 — Split-payment OFFER snapshot foundation (no partial charging).
 *
 * Proves:
 * - integer-cent schedule math + deterministic Sofia date-only due dates
 * - dedicated offer hash (separate from quoteSnapshotHash)
 * - commercial eligibility fallbacks leave full-pay checkout intact
 * - config/integrity failures fail closed
 * - CheckoutSession stores typed sibling offer fields without changing stripe amount
 *
 * Run: cd server && node --test --test-concurrency=1 scripts/paymentScheduleSp4.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const CheckoutSession = require('../models/CheckoutSession');
const PaymentTermTemplate = require('../models/PaymentTermTemplate');
const RatePlan = require('../models/RatePlan');
const {
  validateAndNormalizePaymentTermTemplate
} = require('../services/paymentTermService');
const {
  SPLIT_OFFER_SCHEMA_VERSION,
  INELIGIBILITY_REASONS,
  PaymentScheduleError,
  calculateInstallmentAmounts,
  hashSplitPaymentOfferSnapshot,
  buildSplitPaymentOffer,
  resolveSplitPaymentOfferForCheckout
} = require('../services/paymentScheduleService');
const {
  createCheckoutSession,
  buildQuoteSnapshot,
  hashQuoteSnapshot,
  normalizeCheckoutSessionInput
} = require('../services/checkout/checkoutSessionService');

let mongoServer;

const ENTITY_ID = new mongoose.Types.ObjectId();

async function withEnvAsync(key, value, fn) {
  const prev = process.env[key];
  const had = Object.prototype.hasOwnProperty.call(process.env, key);
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return await fn();
  } finally {
    if (had) process.env[key] = prev;
    else delete process.env[key];
  }
}

function percentSplit40(overrides = {}) {
  return {
    code: 'split-40-remainder',
    internalName: '40% checkout + remainder',
    version: 1,
    status: 'active',
    currency: 'EUR',
    scheduleKind: 'percent_split',
    allowDateTransfer: false,
    legs: [
      {
        sequence: 1,
        amountType: 'percent_bps',
        amountValue: 4000,
        dueRule: 'checkout',
        dueOffsetDays: 0,
        cancellationTreatment: 'stay_credit'
      },
      {
        sequence: 2,
        amountType: 'remainder',
        amountValue: null,
        dueRule: 'days_before_arrival',
        dueOffsetDays: 30,
        cancellationTreatment: 'standard_policy'
      }
    ],
    ...overrides
  };
}

function fullTerm(overrides = {}) {
  return {
    code: 'full-pay',
    internalName: 'Full payment',
    version: 1,
    status: 'active',
    currency: 'EUR',
    scheduleKind: 'full',
    allowDateTransfer: false,
    legs: [
      {
        sequence: 1,
        amountType: 'remainder',
        amountValue: null,
        dueRule: 'checkout',
        dueOffsetDays: 0,
        cancellationTreatment: 'standard_policy'
      }
    ],
    ...overrides
  };
}

function fixedDepositTerm(overrides = {}) {
  return {
    code: 'deposit-200',
    internalName: '€200 deposit',
    version: 1,
    status: 'active',
    currency: 'EUR',
    scheduleKind: 'fixed_deposit',
    allowDateTransfer: false,
    legs: [
      {
        sequence: 1,
        amountType: 'fixed_cents',
        amountValue: 20000,
        dueRule: 'checkout',
        dueOffsetDays: 0,
        cancellationTreatment: 'stay_credit'
      },
      {
        sequence: 2,
        amountType: 'remainder',
        amountValue: null,
        dueRule: 'days_before_arrival',
        dueOffsetDays: 14,
        cancellationTreatment: 'standard_policy'
      }
    ],
    ...overrides
  };
}

function installmentPlan2525(overrides = {}) {
  return {
    code: 'three-leg-25-25',
    internalName: '25/25/remainder',
    version: 1,
    status: 'active',
    currency: 'EUR',
    scheduleKind: 'installment_plan',
    allowDateTransfer: true,
    legs: [
      {
        sequence: 1,
        amountType: 'percent_bps',
        amountValue: 2500,
        dueRule: 'checkout',
        dueOffsetDays: 0,
        cancellationTreatment: 'stay_credit'
      },
      {
        sequence: 2,
        amountType: 'percent_bps',
        amountValue: 2500,
        dueRule: 'days_after_booking',
        dueOffsetDays: 30,
        cancellationTreatment: 'standard_policy'
      },
      {
        sequence: 3,
        amountType: 'remainder',
        amountValue: null,
        dueRule: 'days_before_arrival',
        dueOffsetDays: 14,
        cancellationTreatment: 'standard_policy'
      }
    ],
    ...overrides
  };
}

function mixedInstallmentPlan(overrides = {}) {
  return {
    code: 'mixed-fixed-percent',
    internalName: 'Fixed + percent + remainder',
    version: 1,
    status: 'active',
    currency: 'EUR',
    scheduleKind: 'installment_plan',
    allowDateTransfer: false,
    legs: [
      {
        sequence: 1,
        amountType: 'fixed_cents',
        amountValue: 15000,
        dueRule: 'checkout',
        dueOffsetDays: 0,
        cancellationTreatment: 'stay_credit'
      },
      {
        sequence: 2,
        amountType: 'percent_bps',
        amountValue: 2000,
        dueRule: 'days_before_arrival',
        dueOffsetDays: 45,
        cancellationTreatment: 'standard_policy'
      },
      {
        sequence: 3,
        amountType: 'remainder',
        amountValue: null,
        dueRule: 'days_before_arrival',
        dueOffsetDays: 14,
        cancellationTreatment: 'forfeit'
      }
    ],
    ...overrides
  };
}

function seasonalRatePlanDoc({
  code = 'sp4-winter',
  version = 1,
  paymentTermCode = null,
  paymentTermVersion = null
} = {}) {
  return {
    code,
    internalName: 'SP4 Winter',
    version,
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
    paymentTermCode,
    paymentTermVersion,
    inclusions: [],
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
    revision: 1
  };
}

function buildQuote({
  totalPrice = 500,
  remainingDueCents = 50000,
  voucherAppliedCents = 0,
  ratePlan = { code: 'sp4-winter', version: 1, type: 'seasonal_stay', currency: 'EUR' },
  checkInDateOnly = '2026-12-20',
  checkOutDateOnly = '2026-12-22'
} = {}) {
  return {
    entityType: 'cabin',
    entity: {
      _id: ENTITY_ID,
      minNights: 1,
      capacity: 4,
      pricingModel: 'per_night'
    },
    checkInDate: new Date(`${checkInDateOnly}T12:00:00.000Z`),
    checkOutDate: new Date(`${checkOutDateOnly}T12:00:00.000Z`),
    checkInDateOnly,
    checkOutDateOnly,
    subtotalPrice: totalPrice,
    discountAmount: 0,
    totalPrice,
    voucherAppliedCents,
    remainingDueCents,
    fullVoucherCoverage: remainingDueCents === 0 && voucherAppliedCents > 0,
    ratePlan
  };
}

function baseInput(overrides = {}) {
  return {
    cabinId: String(ENTITY_ID),
    checkIn: '2026-12-20',
    checkOut: '2026-12-22',
    adults: 2,
    children: 0,
    experienceKeys: [],
    transportMethod: '',
    romanticSetup: false,
    promoCode: '',
    voucherCode: '',
    guestEmail: 'guest@example.com',
    ...overrides
  };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await CheckoutSession.syncIndexes();
  await PaymentTermTemplate.syncIndexes();
  await RatePlan.syncIndexes();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await CheckoutSession.deleteMany({});
  await PaymentTermTemplate.deleteMany({});
  await RatePlan.deleteMany({});
});

// ---------------------------------------------------------------------------
// Calculator / offer purity
// ---------------------------------------------------------------------------

test('40/60 percent split: integer cents, exact sum, stay_credit checkout', () => {
  const result = buildSplitPaymentOffer({
    totalCents: 10001,
    currency: 'EUR',
    template: percentSplit40(),
    bookingDateOnly: '2026-10-01',
    arrivalDateOnly: '2026-12-20',
    voucherAppliedCents: 0
  });
  assert.equal(result.eligible, true);
  assert.equal(result.snapshot.schemaVersion, SPLIT_OFFER_SCHEMA_VERSION);
  assert.equal(result.snapshot.totalCents, 10001);
  assert.equal(result.snapshot.installments[0].amountCents, 4000); // floor(10001*4000/10000)
  assert.equal(result.snapshot.installments[1].amountCents, 6001);
  assert.equal(
    result.snapshot.installments.reduce((s, i) => s + i.amountCents, 0),
    10001
  );
  assert.equal(result.snapshot.installments[0].cancellationTreatment, 'stay_credit');
  assert.equal(result.snapshot.installments[0].dueAtDateOnly, '2026-10-01');
  assert.equal(result.snapshot.installments[1].dueAtDateOnly, '2026-11-20'); // 30 before arrival
  assert.equal(typeof result.hash, 'string');
  assert.equal(result.hash.length, 64);
  assert.equal(result.hash, hashSplitPaymentOfferSnapshot(result.snapshot));
});

test('25/25/remainder installment plan amounts and dates', () => {
  const result = buildSplitPaymentOffer({
    totalCents: 10000,
    currency: 'EUR',
    template: installmentPlan2525(),
    bookingDateOnly: '2026-09-01',
    arrivalDateOnly: '2026-12-20',
    voucherAppliedCents: 0
  });
  assert.equal(result.eligible, true);
  assert.deepEqual(
    result.snapshot.installments.map((i) => i.amountCents),
    [2500, 2500, 5000]
  );
  assert.equal(result.snapshot.installments[1].dueAtDateOnly, '2026-10-01'); // +30 after booking
  assert.equal(result.snapshot.installments[2].dueAtDateOnly, '2026-12-06'); // 14 before arrival
  assert.equal(result.snapshot.allowDateTransfer, true);
});

test('fixed reservation payment + remainder', () => {
  const result = buildSplitPaymentOffer({
    totalCents: 80000,
    currency: 'EUR',
    template: fixedDepositTerm(),
    bookingDateOnly: '2026-10-01',
    arrivalDateOnly: '2026-12-20',
    voucherAppliedCents: 0
  });
  assert.equal(result.eligible, true);
  assert.deepEqual(
    result.snapshot.installments.map((i) => i.amountCents),
    [20000, 60000]
  );
  assert.equal(result.snapshot.scheduleKind, 'fixed_deposit');
});

test('mixed installment plan (fixed + percent + remainder)', () => {
  const totalCents = 100000;
  const result = buildSplitPaymentOffer({
    totalCents,
    currency: 'EUR',
    template: mixedInstallmentPlan(),
    bookingDateOnly: '2026-08-01',
    arrivalDateOnly: '2026-12-20',
    voucherAppliedCents: 0
  });
  assert.equal(result.eligible, true);
  const amounts = result.snapshot.installments.map((i) => i.amountCents);
  assert.equal(amounts[0], 15000);
  assert.equal(amounts[1], 20000); // floor(100000*2000/10000)
  assert.equal(amounts[2], 65000);
  assert.equal(amounts.reduce((a, b) => a + b, 0), totalCents);
});

test('integer rounding: remainder absorbs leftover cents', () => {
  const amounts = calculateInstallmentAmounts(100, [
    { sequence: 1, amountType: 'percent_bps', amountValue: 3333 },
    { sequence: 2, amountType: 'percent_bps', amountValue: 3333 },
    { sequence: 3, amountType: 'remainder', amountValue: null }
  ]);
  assert.deepEqual(amounts, [33, 33, 34]);
  assert.equal(amounts.reduce((a, b) => a + b, 0), 100);
});

test('deterministic hash: same input same hash; commercial change differs', () => {
  const a = buildSplitPaymentOffer({
    totalCents: 50000,
    template: percentSplit40(),
    bookingDateOnly: '2026-10-01',
    arrivalDateOnly: '2026-12-20'
  });
  const b = buildSplitPaymentOffer({
    totalCents: 50000,
    template: percentSplit40(),
    bookingDateOnly: '2026-10-01',
    arrivalDateOnly: '2026-12-20'
  });
  const c = buildSplitPaymentOffer({
    totalCents: 50001,
    template: percentSplit40(),
    bookingDateOnly: '2026-10-01',
    arrivalDateOnly: '2026-12-20'
  });
  assert.equal(a.eligible, true);
  assert.equal(a.hash, b.hash);
  assert.notEqual(a.hash, c.hash);
});

test('over-allocation fails closed', () => {
  assert.throws(
    () =>
      calculateInstallmentAmounts(10000, [
        { sequence: 1, amountType: 'fixed_cents', amountValue: 6000 },
        { sequence: 2, amountType: 'fixed_cents', amountValue: 5000 },
        { sequence: 3, amountType: 'remainder', amountValue: null }
      ]),
    (err) => err instanceof PaymentScheduleError && err.code === 'OVER_ALLOCATION'
  );
});

test('fixed checkout amount >= total fails closed', () => {
  assert.throws(
    () =>
      buildSplitPaymentOffer({
        totalCents: 20000,
        template: fixedDepositTerm({
          legs: [
            {
              sequence: 1,
              amountType: 'fixed_cents',
              amountValue: 20000,
              dueRule: 'checkout',
              dueOffsetDays: 0,
              cancellationTreatment: 'stay_credit'
            },
            {
              sequence: 2,
              amountType: 'remainder',
              amountValue: null,
              dueRule: 'days_before_arrival',
              dueOffsetDays: 14,
              cancellationTreatment: 'standard_policy'
            }
          ]
        }),
        bookingDateOnly: '2026-10-01',
        arrivalDateOnly: '2026-12-20'
      }),
    (err) =>
      err instanceof PaymentScheduleError &&
      (err.code === 'OVER_ALLOCATION' || err.code === 'RESERVATION_AMOUNT_GE_TOTAL')
  );
});

test('split checkout leg not stay_credit fails closed', () => {
  assert.throws(
    () =>
      buildSplitPaymentOffer({
        totalCents: 50000,
        template: percentSplit40({
          legs: [
            {
              sequence: 1,
              amountType: 'percent_bps',
              amountValue: 4000,
              dueRule: 'checkout',
              dueOffsetDays: 0,
              cancellationTreatment: 'standard_policy'
            },
            {
              sequence: 2,
              amountType: 'remainder',
              amountValue: null,
              dueRule: 'days_before_arrival',
              dueOffsetDays: 30,
              cancellationTreatment: 'standard_policy'
            }
          ]
        }),
        bookingDateOnly: '2026-10-01',
        arrivalDateOnly: '2026-12-20'
      }),
    (err) =>
      err instanceof PaymentScheduleError &&
      err.code === 'INVALID_SPLIT_CHECKOUT_CANCELLATION_TREATMENT'
  );

  assert.throws(
    () =>
      buildSplitPaymentOffer({
        totalCents: 50000,
        template: percentSplit40({
          legs: [
            {
              sequence: 1,
              amountType: 'percent_bps',
              amountValue: 4000,
              dueRule: 'checkout',
              dueOffsetDays: 0,
              cancellationTreatment: 'forfeit'
            },
            {
              sequence: 2,
              amountType: 'remainder',
              amountValue: null,
              dueRule: 'days_before_arrival',
              dueOffsetDays: 30,
              cancellationTreatment: 'standard_policy'
            }
          ]
        }),
        bookingDateOnly: '2026-10-01',
        arrivalDateOnly: '2026-12-20'
      }),
    (err) =>
      err instanceof PaymentScheduleError &&
      err.code === 'INVALID_SPLIT_CHECKOUT_CANCELLATION_TREATMENT'
  );
});

test('full-payment term is normal ineligibility (no split offer)', () => {
  const result = buildSplitPaymentOffer({
    totalCents: 50000,
    template: fullTerm(),
    bookingDateOnly: '2026-10-01',
    arrivalDateOnly: '2026-12-20'
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, INELIGIBILITY_REASONS.FULL_PAYMENT_TERM);
  assert.equal(result.snapshot, null);
});

test('accommodation voucher credit => ineligible; booking continues conceptually', () => {
  const result = buildSplitPaymentOffer({
    totalCents: 30000,
    template: percentSplit40(),
    bookingDateOnly: '2026-10-01',
    arrivalDateOnly: '2026-12-20',
    voucherAppliedCents: 20000
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, INELIGIBILITY_REASONS.ACCOMMODATION_VOUCHER_APPLIED);
});

test('future installment already due => ineligible (short-lead fallback)', () => {
  // Booking 10 days before arrival; 30-days-before-arrival leg is already past.
  const result = buildSplitPaymentOffer({
    totalCents: 50000,
    template: percentSplit40(),
    bookingDateOnly: '2026-12-10',
    arrivalDateOnly: '2026-12-20',
    voucherAppliedCents: 0
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, INELIGIBILITY_REASONS.FUTURE_INSTALLMENT_ALREADY_DUE);
});

test('days_after_booking due on/after arrival => ineligible', () => {
  const result = buildSplitPaymentOffer({
    totalCents: 10000,
    template: installmentPlan2525({
      legs: [
        {
          sequence: 1,
          amountType: 'percent_bps',
          amountValue: 2500,
          dueRule: 'checkout',
          dueOffsetDays: 0,
          cancellationTreatment: 'stay_credit'
        },
        {
          sequence: 2,
          amountType: 'percent_bps',
          amountValue: 2500,
          dueRule: 'days_after_booking',
          dueOffsetDays: 60,
          cancellationTreatment: 'standard_policy'
        },
        {
          sequence: 3,
          amountType: 'remainder',
          amountValue: null,
          dueRule: 'days_before_arrival',
          dueOffsetDays: 7,
          cancellationTreatment: 'standard_policy'
        }
      ]
    }),
    bookingDateOnly: '2026-12-01',
    arrivalDateOnly: '2026-12-20',
    voucherAppliedCents: 0
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, INELIGIBILITY_REASONS.INSTALLMENT_DUE_ON_OR_AFTER_ARRIVAL);
});

test('malformed template fails closed', () => {
  assert.throws(
    () =>
      buildSplitPaymentOffer({
        totalCents: 50000,
        template: {
          code: 'bad',
          internalName: 'Bad',
          version: 1,
          scheduleKind: 'percent_split',
          currency: 'EUR',
          legs: []
        },
        bookingDateOnly: '2026-10-01',
        arrivalDateOnly: '2026-12-20'
      }),
    (err) => err instanceof PaymentScheduleError && err.code === 'MALFORMED_PAYMENT_TERM'
  );
});

// ---------------------------------------------------------------------------
// Checkout integration
// ---------------------------------------------------------------------------

test('flag off => no term resolution / no offer; stripeAmountCents full', async () => {
  await withEnvAsync('SPLIT_PAYMENT_ENABLED', undefined, async () => {
    const term = validateAndNormalizePaymentTermTemplate(percentSplit40());
    await PaymentTermTemplate.create(term.value);
    await RatePlan.create(
      seasonalRatePlanDoc({
        paymentTermCode: 'split-40-remainder',
        paymentTermVersion: 1
      })
    );

    const quote = buildQuote();
    const input = baseInput();
    const { session } = await createCheckoutSession({ input, quote });

    assert.equal(session.splitPaymentOfferSnapshot, null);
    assert.equal(session.splitPaymentOfferSnapshotHash, null);
    assert.equal(session.stripeAmountCents, 50000);

    const normalized = normalizeCheckoutSessionInput(input);
    const snap = buildQuoteSnapshot({ normalizedInput: normalized, quote });
    assert.equal(session.quoteSnapshotHash, hashQuoteSnapshot(snap));
  });
});

test('RatePlan without term => no offer', async () => {
  await withEnvAsync('SPLIT_PAYMENT_ENABLED', 'true', async () => {
    await RatePlan.create(seasonalRatePlanDoc());
    const quote = buildQuote();
    const { session } = await createCheckoutSession({ input: baseInput(), quote });
    assert.equal(session.splitPaymentOfferSnapshot, null);
    assert.equal(session.splitPaymentOfferSnapshotHash, null);
    assert.equal(session.stripeAmountCents, 50000);
  });
});

test('full-payment term => no split offer; full checkout survives', async () => {
  await withEnvAsync('SPLIT_PAYMENT_ENABLED', 'true', async () => {
    const term = validateAndNormalizePaymentTermTemplate(fullTerm());
    await PaymentTermTemplate.create(term.value);
    await RatePlan.create(
      seasonalRatePlanDoc({ paymentTermCode: 'full-pay', paymentTermVersion: 1 })
    );
    const { session } = await createCheckoutSession({ input: baseInput(), quote: buildQuote() });
    assert.equal(session.splitPaymentOfferSnapshot, null);
    assert.equal(session.stripeAmountCents, 50000);
  });
});

test('eligible RatePlan => offer snapshot attached; stripe/PI amount semantics unchanged', async () => {
  await withEnvAsync('SPLIT_PAYMENT_ENABLED', 'true', async () => {
    const term = validateAndNormalizePaymentTermTemplate(percentSplit40());
    await PaymentTermTemplate.create(term.value);
    await RatePlan.create(
      seasonalRatePlanDoc({
        paymentTermCode: 'split-40-remainder',
        paymentTermVersion: 1
      })
    );

    const quote = buildQuote({ remainingDueCents: 50000 });
    const input = baseInput();
    const normalized = normalizeCheckoutSessionInput(input);
    const commercialSnap = buildQuoteSnapshot({ normalizedInput: normalized, quote });
    const commercialHash = hashQuoteSnapshot(commercialSnap);

    const { session } = await createCheckoutSession({ input, quote });

    assert.ok(session.splitPaymentOfferSnapshot);
    assert.equal(session.splitPaymentOfferSnapshot.templateCode, 'split-40-remainder');
    assert.equal(session.splitPaymentOfferSnapshot.totalCents, 50000);
    assert.equal(session.splitPaymentOfferSnapshot.installments.length, 2);
    assert.equal(session.splitPaymentOfferSnapshot.installments[0].amountCents, 20000);
    assert.equal(session.splitPaymentOfferSnapshot.installments[1].amountCents, 30000);
    assert.equal(
      session.splitPaymentOfferSnapshot.installments[0].cancellationTreatment,
      'stay_credit'
    );
    assert.equal(typeof session.splitPaymentOfferSnapshotHash, 'string');
    assert.equal(session.splitPaymentOfferSnapshotHash.length, 64);

    // Full card obligation unchanged — SP4 does not partial-charge.
    assert.equal(session.stripeAmountCents, 50000);
    assert.equal(session.quoteSnapshot.stripeAmountCents, 50000);
    // Offer must not mutate commercial quote hash / PI identity.
    assert.equal(session.quoteSnapshotHash, commercialHash);
  });
});

test('accommodation voucher credit => no offer; remaining card due still full at checkout', async () => {
  await withEnvAsync('SPLIT_PAYMENT_ENABLED', 'true', async () => {
    const term = validateAndNormalizePaymentTermTemplate(percentSplit40());
    await PaymentTermTemplate.create(term.value);
    await RatePlan.create(
      seasonalRatePlanDoc({
        paymentTermCode: 'split-40-remainder',
        paymentTermVersion: 1
      })
    );

    const quote = buildQuote({
      totalPrice: 500,
      voucherAppliedCents: 20000,
      remainingDueCents: 30000
    });
    const { session } = await createCheckoutSession({ input: baseInput(), quote });
    assert.equal(session.splitPaymentOfferSnapshot, null);
    assert.equal(session.splitPaymentOfferSnapshotHash, null);
    assert.equal(session.stripeAmountCents, 30000);
    assert.equal(session.giftVoucherAppliedCents, 20000);
  });
});

test('short-lead already-due future leg => no offer; full checkout survives', async () => {
  await withEnvAsync('SPLIT_PAYMENT_ENABLED', 'true', async () => {
    const term = validateAndNormalizePaymentTermTemplate(percentSplit40());
    await PaymentTermTemplate.create(term.value);
    await RatePlan.create(
      seasonalRatePlanDoc({
        paymentTermCode: 'split-40-remainder',
        paymentTermVersion: 1
      })
    );

    const quote = buildQuote({
      checkInDateOnly: '2026-12-20',
      checkOutDateOnly: '2026-12-22'
    });
    // Force booking date close to arrival via deps override path:
    const resolved = await resolveSplitPaymentOfferForCheckout({
      quote,
      quoteSnapshot: {
        checkInDateOnly: '2026-12-20',
        voucherAppliedCents: 0,
        stripeAmountCents: 50000,
        currency: 'EUR'
      },
      stripeAmountCents: 50000,
      bookingDateOnly: '2026-12-10',
      deps: { isSplitPaymentEnabled: () => true }
    });
    assert.equal(resolved.splitPaymentOfferSnapshot, null);
    assert.equal(resolved.eligibility.reason, INELIGIBILITY_REASONS.FUTURE_INSTALLMENT_ALREADY_DUE);
  });
});

test('missing pinned template fails closed', async () => {
  await withEnvAsync('SPLIT_PAYMENT_ENABLED', 'true', async () => {
    await RatePlan.create(
      seasonalRatePlanDoc({
        paymentTermCode: 'missing-term',
        paymentTermVersion: 1
      })
    );
    await assert.rejects(
      () => createCheckoutSession({ input: baseInput(), quote: buildQuote() }),
      (err) => err instanceof PaymentScheduleError && err.code === 'PAYMENT_TERM_NOT_FOUND'
    );
  });
});

test('retired exact pinned template remains resolvable for eligible offer', async () => {
  await withEnvAsync('SPLIT_PAYMENT_ENABLED', 'true', async () => {
    const term = validateAndNormalizePaymentTermTemplate(
      percentSplit40({ status: 'retired', version: 2, code: 'split-retired-pin' })
    );
    await PaymentTermTemplate.create(term.value);
    await RatePlan.create(
      seasonalRatePlanDoc({
        paymentTermCode: 'split-retired-pin',
        paymentTermVersion: 2
      })
    );

    const { session } = await createCheckoutSession({ input: baseInput(), quote: buildQuote() });
    assert.ok(session.splitPaymentOfferSnapshot);
    assert.equal(session.splitPaymentOfferSnapshot.templateCode, 'split-retired-pin');
    assert.equal(session.splitPaymentOfferSnapshot.templateVersion, 2);
    assert.equal(session.stripeAmountCents, 50000);
  });
});

test('old CheckoutSessions without offer fields remain valid', async () => {
  const session = await CheckoutSession.create({
    checkoutId: 'chk_sp4_legacy_no_offer',
    flowVersion: 'v2',
    status: 'quoted',
    quoteSnapshot: { schemaVersion: 1, stripeAmountCents: 10000 },
    quoteSnapshotHash: 'abc',
    stripeAmountCents: 10000,
    paymentStatus: 'unpaid',
    finalizeStatus: 'open',
    sessionVersion: 1
  });
  assert.equal(session.splitPaymentOfferSnapshot, null);
  assert.equal(session.splitPaymentOfferSnapshotHash, null);

  const reloaded = await CheckoutSession.findOne({ checkoutId: 'chk_sp4_legacy_no_offer' });
  assert.equal(reloaded.splitPaymentOfferSnapshot, null);
  assert.equal(reloaded.stripeAmountCents, 10000);
});

test('CheckoutSession offer uses strict embedded schema (not Mixed)', () => {
  const path = CheckoutSession.schema.path('splitPaymentOfferSnapshot');
  assert.ok(path);
  assert.notEqual(path.instance, 'Mixed');
  assert.equal(CheckoutSession.schema.path('quoteSnapshot').instance, 'Mixed');
});

test('quoteSnapshotHash ignores offer presence (same commercial quote)', async () => {
  const quote = buildQuote();
  const input = baseInput();
  const normalized = normalizeCheckoutSessionInput(input);
  const snap = buildQuoteSnapshot({ normalizedInput: normalized, quote });
  const hashA = hashQuoteSnapshot(snap);

  // Mutating a non-hash field standing in for "offer attached elsewhere"
  const snapWithExtra = { ...snap, splitPaymentOfferSnapshot: { shouldNotMatter: true } };
  const hashB = hashQuoteSnapshot(snapWithExtra);
  assert.equal(hashA, hashB);
});

test('resolveSplitPaymentOfferForCheckout: flag off short-circuits without DB term load', async () => {
  const result = await resolveSplitPaymentOfferForCheckout({
    quote: buildQuote(),
    quoteSnapshot: { stripeAmountCents: 50000, checkInDateOnly: '2026-12-20', currency: 'EUR' },
    stripeAmountCents: 50000,
    deps: {
      isSplitPaymentEnabled: () => false,
      RatePlan: {
        findOne: async () => {
          throw new Error('RatePlan must not be loaded when flag is off');
        }
      }
    }
  });
  assert.equal(result.splitPaymentOfferSnapshot, null);
  assert.equal(result.eligibility.reason, INELIGIBILITY_REASONS.SPLIT_PAYMENT_DISABLED);
});
