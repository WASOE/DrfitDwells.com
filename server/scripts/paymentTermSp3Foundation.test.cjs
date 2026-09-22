/**
 * SP3 — PaymentTermTemplate validation + RatePlan optional reference foundation.
 *
 * No checkout snapshot wiring. No Booking schedules. No Stripe.
 *
 * Run: cd server && node --test --test-concurrency=1 scripts/paymentTermSp3Foundation.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const PaymentTermTemplate = require('../models/PaymentTermTemplate');
const RatePlan = require('../models/RatePlan');
const CancellationPolicy = require('../models/CancellationPolicy');
const Cabin = require('../models/Cabin');
const {
  validateAndNormalizePaymentTermTemplate,
  resolvePaymentTermTemplate,
  assertActivePaymentTermTemplate,
  normalizeOptionalPaymentTermReference,
  PaymentTermError
} = require('../services/paymentTermService');
const { validateAndNormalizeRatePlan } = require('../services/ratePlanService');
const {
  createRatePlanDraft,
  activateRatePlan,
  RatePlanManagementError,
  MANAGEMENT_ERROR_CODES
} = require('../services/ratePlanManagementService');

let mongoServer;

function baseFullTerm(overrides = {}) {
  return {
    code: 'full-pay',
    internalName: 'Full payment',
    version: 1,
    status: 'draft',
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

function basePercentSplit(overrides = {}) {
  return {
    code: 'split-40-remainder',
    internalName: '40% checkout + remainder',
    version: 1,
    status: 'draft',
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

async function seedCancellationPolicy() {
  await CancellationPolicy.create({
    code: 'normal-stay-standard',
    internalName: 'Normal stay',
    version: 1,
    status: 'active',
    policyType: 'normal_stay',
    correctionWindowHours: 48,
    correctionWindowMinDaysBeforeArrival: 14,
    refundTiers: [{ minDaysBeforeArrival: 0, maxDaysBeforeArrival: null, refundPercent: 0 }],
    noShowRefundPercent: 0,
    earlyDepartureRefundPercent: 0,
    dateTransferRules: {},
    nameTransferRules: {},
    organizerCancellationRule: {},
    legalReviewStatus: 'approved'
  });
}

async function seedCabin() {
  return Cabin.create({
    name: 'SP3 Test Cabin',
    slug: 'sp3-test-cabin',
    description: 'SP3 test cabin',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/sp3.jpg',
    location: 'Bulgaria',
    isActive: true
  });
}

function seasonalDraftInput(overrides = {}) {
  return {
    code: 'sp3-seasonal',
    internalName: 'SP3 Seasonal',
    version: 1,
    type: 'seasonal_stay',
    currency: 'EUR',
    arrivalWindowStart: '2030-01-01',
    arrivalWindowEnd: '2030-03-31',
    minNights: 2,
    inventoryMode: 'shared',
    requiresFullPayment: true,
    cancellationPolicyCode: 'normal-stay-standard',
    cancellationPolicyVersion: 1,
    inclusions: [],
    accommodations: [
      {
        accommodationKey: 'sp3-test-cabin',
        entityType: 'cabin',
        pricingMethod: 'nightly_per_unit',
        nightlyPerUnitAmount: 120
      }
    ],
    ...overrides
  };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await PaymentTermTemplate.syncIndexes();
  await RatePlan.syncIndexes();
  await CancellationPolicy.syncIndexes();
  await Cabin.syncIndexes();
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    PaymentTermTemplate.deleteMany({}),
    RatePlan.deleteMany({}),
    CancellationPolicy.deleteMany({}),
    Cabin.deleteMany({}),
    mongoose.connection.db.collection('rateplanactivationlocks').deleteMany({})
  ]);
  await seedCancellationPolicy();
  await seedCabin();
});

test('valid full term', () => {
  const result = validateAndNormalizePaymentTermTemplate(baseFullTerm());
  assert.equal(result.ok, true);
  assert.equal(result.value.scheduleKind, 'full');
  assert.equal(result.value.legs.length, 1);
  assert.equal(result.value.legs[0].amountType, 'remainder');
  assert.equal(result.value.legs[0].amountValue, null);
  assert.equal(result.value.legs[0].cancellationTreatment, 'standard_policy');
  assert.equal(Object.prototype.hasOwnProperty.call(result.value.legs[0], 'nonRefundable'), false);
});

test('valid 40/remainder percent split', () => {
  const result = validateAndNormalizePaymentTermTemplate(basePercentSplit());
  assert.equal(result.ok, true);
  assert.equal(result.value.legs[0].amountValue, 4000);
  assert.equal(Number.isInteger(result.value.legs[0].amountValue), true);
  assert.equal(result.value.legs[1].amountType, 'remainder');
  assert.equal(result.value.legs[0].cancellationTreatment, 'stay_credit');
});

test('cancellationTreatment defaults to standard_policy; invalid rejected', () => {
  const withDefault = validateAndNormalizePaymentTermTemplate({
    code: 'default-treatment',
    internalName: 'Default treatment',
    version: 1,
    scheduleKind: 'full',
    legs: [
      {
        sequence: 1,
        amountType: 'remainder',
        amountValue: null,
        dueRule: 'checkout',
        dueOffsetDays: 0
      }
    ]
  });
  assert.equal(withDefault.ok, true);
  assert.equal(withDefault.value.legs[0].cancellationTreatment, 'standard_policy');

  const invalid = validateAndNormalizePaymentTermTemplate(
    baseFullTerm({
      legs: [
        {
          sequence: 1,
          amountType: 'remainder',
          amountValue: null,
          dueRule: 'checkout',
          dueOffsetDays: 0,
          cancellationTreatment: 'non_refundable'
        }
      ]
    })
  );
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((e) => /cancellationTreatment/i.test(e)));
});

test('valid cancellationTreatment enum values accepted', () => {
  for (const treatment of ['standard_policy', 'stay_credit', 'forfeit']) {
    const result = validateAndNormalizePaymentTermTemplate(
      baseFullTerm({
        code: `treat-${treatment.replace(/_/g, '-')}`,
        legs: [
          {
            sequence: 1,
            amountType: 'remainder',
            amountValue: null,
            dueRule: 'checkout',
            dueOffsetDays: 0,
            cancellationTreatment: treatment
          }
        ]
      })
    );
    assert.equal(result.ok, true, treatment);
    assert.equal(result.value.legs[0].cancellationTreatment, treatment);
  }
});

test('split checkout leg with stay_credit is valid', () => {
  const result = validateAndNormalizePaymentTermTemplate(basePercentSplit());
  assert.equal(result.ok, true);
  assert.equal(result.value.legs[0].dueRule, 'checkout');
  assert.equal(result.value.legs[0].cancellationTreatment, 'stay_credit');
});

test('PaymentTermTemplate schema has cancellationTreatment and no nonRefundable', () => {
  const legsPath = PaymentTermTemplate.schema.path('legs');
  assert.ok(legsPath);
  const legSchema = legsPath.schema;
  assert.ok(legSchema.path('cancellationTreatment'));
  assert.equal(legSchema.path('nonRefundable'), undefined);
  assert.deepEqual(PaymentTermTemplate.PAYMENT_TERM_CANCELLATION_TREATMENTS, [
    'standard_policy',
    'stay_credit',
    'forfeit'
  ]);
});

test('valid fixed deposit / remainder', () => {
  const result = validateAndNormalizePaymentTermTemplate({
    code: 'deposit-200',
    internalName: '€200 deposit',
    version: 1,
    scheduleKind: 'fixed_deposit',
    legs: [
      {
        sequence: 1,
        amountType: 'fixed_cents',
        amountValue: 20000,
        dueRule: 'checkout',
        dueOffsetDays: 0
      },
      {
        sequence: 2,
        amountType: 'remainder',
        amountValue: null,
        dueRule: 'days_before_arrival',
        dueOffsetDays: 14
      }
    ]
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.legs[0].amountValue, 20000);
  assert.equal(Number.isInteger(result.value.legs[0].amountValue), true);
});

test('valid 3+ installment plan', () => {
  const result = validateAndNormalizePaymentTermTemplate({
    code: 'three-leg',
    internalName: 'Three legs',
    version: 1,
    scheduleKind: 'installment_plan',
    legs: [
      {
        sequence: 1,
        amountType: 'percent_bps',
        amountValue: 2500,
        dueRule: 'checkout',
        dueOffsetDays: 0
      },
      {
        sequence: 2,
        amountType: 'percent_bps',
        amountValue: 2500,
        dueRule: 'days_after_booking',
        dueOffsetDays: 30
      },
      {
        sequence: 3,
        amountType: 'remainder',
        amountValue: null,
        dueRule: 'days_before_arrival',
        dueOffsetDays: 14
      }
    ]
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.legs.length, 3);
});

test('rejects non-contiguous sequences', () => {
  const result = validateAndNormalizePaymentTermTemplate(
    basePercentSplit({
      legs: [
        { sequence: 1, amountType: 'percent_bps', amountValue: 4000, dueRule: 'checkout', dueOffsetDays: 0 },
        { sequence: 3, amountType: 'remainder', amountValue: null, dueRule: 'days_before_arrival', dueOffsetDays: 30 }
      ]
    })
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /contiguous/i.test(e)));
});

test('rejects missing checkout leg', () => {
  const result = validateAndNormalizePaymentTermTemplate(
    basePercentSplit({
      legs: [
        {
          sequence: 1,
          amountType: 'percent_bps',
          amountValue: 4000,
          dueRule: 'days_before_arrival',
          dueOffsetDays: 60
        },
        {
          sequence: 2,
          amountType: 'remainder',
          amountValue: null,
          dueRule: 'days_before_arrival',
          dueOffsetDays: 30
        }
      ]
    })
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /checkout/i.test(e)));
});

test('rejects multiple checkout legs', () => {
  const result = validateAndNormalizePaymentTermTemplate({
    code: 'bad-multi-checkout',
    internalName: 'Bad',
    version: 1,
    scheduleKind: 'percent_split',
    legs: [
      { sequence: 1, amountType: 'percent_bps', amountValue: 4000, dueRule: 'checkout', dueOffsetDays: 0 },
      { sequence: 2, amountType: 'remainder', amountValue: null, dueRule: 'checkout', dueOffsetDays: 0 }
    ]
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /only one checkout|checkout leg must be sequence 1/i.test(e)));
});

test('rejects checkout leg not first', () => {
  const result = validateAndNormalizePaymentTermTemplate({
    code: 'checkout-second',
    internalName: 'Bad',
    version: 1,
    scheduleKind: 'percent_split',
    legs: [
      {
        sequence: 1,
        amountType: 'percent_bps',
        amountValue: 4000,
        dueRule: 'days_after_booking',
        dueOffsetDays: 1
      },
      { sequence: 2, amountType: 'remainder', amountValue: null, dueRule: 'checkout', dueOffsetDays: 0 }
    ]
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /checkout/i.test(e)));
});

test('rejects missing remainder', () => {
  const result = validateAndNormalizePaymentTermTemplate({
    code: 'no-remainder',
    internalName: 'Bad',
    version: 1,
    scheduleKind: 'percent_split',
    legs: [
      { sequence: 1, amountType: 'percent_bps', amountValue: 4000, dueRule: 'checkout', dueOffsetDays: 0 },
      {
        sequence: 2,
        amountType: 'percent_bps',
        amountValue: 3000,
        dueRule: 'days_before_arrival',
        dueOffsetDays: 30
      }
    ]
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /remainder/i.test(e)));
});

test('rejects multiple remainder legs', () => {
  const result = validateAndNormalizePaymentTermTemplate({
    code: 'multi-remainder',
    internalName: 'Bad',
    version: 1,
    scheduleKind: 'installment_plan',
    legs: [
      { sequence: 1, amountType: 'remainder', amountValue: null, dueRule: 'checkout', dueOffsetDays: 0 },
      { sequence: 2, amountType: 'remainder', amountValue: null, dueRule: 'days_before_arrival', dueOffsetDays: 10 }
    ]
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /remainder/i.test(e)));
});

test('rejects remainder not final', () => {
  const result = validateAndNormalizePaymentTermTemplate({
    code: 'remainder-mid',
    internalName: 'Bad',
    version: 1,
    scheduleKind: 'installment_plan',
    legs: [
      { sequence: 1, amountType: 'percent_bps', amountValue: 2000, dueRule: 'checkout', dueOffsetDays: 0 },
      { sequence: 2, amountType: 'remainder', amountValue: null, dueRule: 'days_after_booking', dueOffsetDays: 10 },
      {
        sequence: 3,
        amountType: 'percent_bps',
        amountValue: 2000,
        dueRule: 'days_before_arrival',
        dueOffsetDays: 5
      }
    ]
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /remainder/i.test(e)));
});

test('rejects remainder amountValue non-null', () => {
  const result = validateAndNormalizePaymentTermTemplate(
    baseFullTerm({
      legs: [
        {
          sequence: 1,
          amountType: 'remainder',
          amountValue: 100,
          dueRule: 'checkout',
          dueOffsetDays: 0
        }
      ]
    })
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /amountValue must be null/i.test(e)));
});

test('rejects invalid offsets', () => {
  const result = validateAndNormalizePaymentTermTemplate(
    baseFullTerm({
      legs: [
        {
          sequence: 1,
          amountType: 'remainder',
          amountValue: null,
          dueRule: 'checkout',
          dueOffsetDays: 3
        }
      ]
    })
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /dueOffsetDays must be 0/i.test(e)));
});

test('rejects percent_bps sum >= 10000 on non-final legs', () => {
  const result = validateAndNormalizePaymentTermTemplate(
    basePercentSplit({
      legs: [
        { sequence: 1, amountType: 'percent_bps', amountValue: 10000, dueRule: 'checkout', dueOffsetDays: 0 },
        {
          sequence: 2,
          amountType: 'remainder',
          amountValue: null,
          dueRule: 'days_before_arrival',
          dueOffsetDays: 30
        }
      ]
    })
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /less than 10000/i.test(e)));
});

test('rejects float percent_bps / float cents', () => {
  const bps = validateAndNormalizePaymentTermTemplate(
    basePercentSplit({
      legs: [
        { sequence: 1, amountType: 'percent_bps', amountValue: 4000.5, dueRule: 'checkout', dueOffsetDays: 0 },
        {
          sequence: 2,
          amountType: 'remainder',
          amountValue: null,
          dueRule: 'days_before_arrival',
          dueOffsetDays: 30
        }
      ]
    })
  );
  assert.equal(bps.ok, false);

  const cents = validateAndNormalizePaymentTermTemplate({
    code: 'float-cents',
    internalName: 'Bad',
    version: 1,
    scheduleKind: 'fixed_deposit',
    legs: [
      { sequence: 1, amountType: 'fixed_cents', amountValue: 10.5, dueRule: 'checkout', dueOffsetDays: 0 },
      {
        sequence: 2,
        amountType: 'remainder',
        amountValue: null,
        dueRule: 'days_before_arrival',
        dueOffsetDays: 7
      }
    ]
  });
  assert.equal(cents.ok, false);
});

test('no arbitrary max leg count — 8-leg installment_plan validates', () => {
  const legs = [];
  for (let i = 1; i <= 7; i += 1) {
    legs.push({
      sequence: i,
      amountType: i === 1 ? 'percent_bps' : 'fixed_cents',
      amountValue: i === 1 ? 1000 : 500,
      dueRule: i === 1 ? 'checkout' : 'days_after_booking',
      dueOffsetDays: i === 1 ? 0 : i * 7
    });
  }
  legs.push({
    sequence: 8,
    amountType: 'remainder',
    amountValue: null,
    dueRule: 'days_before_arrival',
    dueOffsetDays: 7
  });
  const result = validateAndNormalizePaymentTermTemplate({
    code: 'eight-leg',
    internalName: 'Eight legs',
    version: 1,
    scheduleKind: 'installment_plan',
    legs
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.legs.length, 8);
});

test('code/version uniqueness', async () => {
  const normalized = validateAndNormalizePaymentTermTemplate(baseFullTerm({ status: 'active' }));
  assert.equal(normalized.ok, true);
  await PaymentTermTemplate.create(normalized.value);
  await assert.rejects(
    () => PaymentTermTemplate.create({ ...normalized.value }),
    (err) => err && (err.code === 11000 || /duplicate/i.test(String(err.message)))
  );
});

test('RatePlan reference absent works; half-reference rejected', () => {
  const absent = validateAndNormalizeRatePlan(seasonalDraftInput());
  assert.equal(absent.ok, true);
  assert.equal(absent.value.paymentTermCode, null);
  assert.equal(absent.value.paymentTermVersion, null);
  assert.equal(absent.value.requiresFullPayment, true);

  const codeOnly = validateAndNormalizeRatePlan(
    seasonalDraftInput({ paymentTermCode: 'split-40-remainder' })
  );
  assert.equal(codeOnly.ok, false);
  assert.ok(codeOnly.errors.some((e) => /both be set or both be absent/i.test(e)));

  const versionOnly = validateAndNormalizeRatePlan(
    seasonalDraftInput({ paymentTermVersion: 1 })
  );
  assert.equal(versionOnly.ok, false);
  assert.ok(versionOnly.errors.some((e) => /both be set or both be absent/i.test(e)));
});

test('valid payment-term pair persists on RatePlan draft', async () => {
  const term = validateAndNormalizePaymentTermTemplate(
    basePercentSplit({ code: 'split-40-remainder', status: 'active' })
  );
  assert.equal(term.ok, true);
  await PaymentTermTemplate.create(term.value);

  const created = await createRatePlanDraft(
    seasonalDraftInput({
      paymentTermCode: 'split-40-remainder',
      paymentTermVersion: 1,
      requiresFullPayment: true
    }),
    { operatorId: 'sp3-ops' }
  );
  assert.equal(created.paymentTermCode, 'split-40-remainder');
  assert.equal(created.paymentTermVersion, 1);
  // Legacy flag untouched / not derived from term.
  assert.equal(created.requiresFullPayment, true);

  const stored = await RatePlan.findById(created.id).lean();
  assert.equal(stored.paymentTermCode, 'split-40-remainder');
  assert.equal(stored.paymentTermVersion, 1);
  assert.equal(stored.requiresFullPayment, true);
});

test('activation fails if referenced template missing', async () => {
  const created = await createRatePlanDraft(
    seasonalDraftInput({
      paymentTermCode: 'missing-term',
      paymentTermVersion: 1
    }),
    { operatorId: 'sp3-ops' }
  );
  await assert.rejects(
    () => activateRatePlan(created.id, { operatorId: 'sp3-ops', expectedRevision: created.revision }),
    (err) =>
      err instanceof RatePlanManagementError &&
      err.code === MANAGEMENT_ERROR_CODES.PAYMENT_TERM_NOT_FOUND
  );
});

test('activation fails for draft/retired template; succeeds for active', async () => {
  const draftTerm = validateAndNormalizePaymentTermTemplate(
    baseFullTerm({ code: 'term-lifecycle', version: 1, status: 'draft' })
  );
  await PaymentTermTemplate.create(draftTerm.value);

  const planOnDraft = await createRatePlanDraft(
    seasonalDraftInput({
      code: 'sp3-on-draft-term',
      paymentTermCode: 'term-lifecycle',
      paymentTermVersion: 1
    }),
    { operatorId: 'sp3-ops' }
  );
  await assert.rejects(
    () =>
      activateRatePlan(planOnDraft.id, {
        operatorId: 'sp3-ops',
        expectedRevision: planOnDraft.revision
      }),
    (err) =>
      err instanceof RatePlanManagementError &&
      err.code === MANAGEMENT_ERROR_CODES.PAYMENT_TERM_NOT_ACTIVE
  );

  await PaymentTermTemplate.updateOne(
    { code: 'term-lifecycle', version: 1 },
    { $set: { status: 'retired' } }
  );
  await assert.rejects(
    () =>
      activateRatePlan(planOnDraft.id, {
        operatorId: 'sp3-ops',
        expectedRevision: planOnDraft.revision
      }),
    (err) =>
      err instanceof RatePlanManagementError &&
      err.code === MANAGEMENT_ERROR_CODES.PAYMENT_TERM_NOT_ACTIVE
  );

  await PaymentTermTemplate.updateOne(
    { code: 'term-lifecycle', version: 1 },
    { $set: { status: 'active' } }
  );
  const activated = await activateRatePlan(planOnDraft.id, {
    operatorId: 'sp3-ops',
    expectedRevision: planOnDraft.revision
  });
  assert.equal(activated.status, 'active');
  assert.equal(activated.paymentTermCode, 'term-lifecycle');
  assert.equal(activated.paymentTermVersion, 1);
});

test('retired exact version remains resolvable for pinned references', async () => {
  const normalized = validateAndNormalizePaymentTermTemplate(
    baseFullTerm({ code: 'pin-retired', version: 2, status: 'retired' })
  );
  await PaymentTermTemplate.create(normalized.value);

  const resolved = await resolvePaymentTermTemplate('pin-retired', 2);
  assert.equal(resolved.status, 'retired');
  assert.equal(resolved.version, 2);

  await assert.rejects(
    () => assertActivePaymentTermTemplate('pin-retired', 2),
    (err) => err instanceof PaymentTermError && err.code === 'PAYMENT_TERM_NOT_ACTIVE'
  );
});

test('requiresFullPayment remains untouched by payment-term presence', () => {
  const withTermFalse = validateAndNormalizeRatePlan(
    seasonalDraftInput({
      paymentTermCode: 'x',
      paymentTermVersion: 1,
      requiresFullPayment: false
    })
  );
  // half-ref may fail for code 'x' shape - use valid kebab
  const a = validateAndNormalizeRatePlan(
    seasonalDraftInput({
      paymentTermCode: 'any-term',
      paymentTermVersion: 1,
      requiresFullPayment: false
    })
  );
  assert.equal(a.ok, true);
  assert.equal(a.value.requiresFullPayment, false);
  assert.equal(a.value.paymentTermCode, 'any-term');

  const b = validateAndNormalizeRatePlan(
    seasonalDraftInput({
      paymentTermCode: 'any-term',
      paymentTermVersion: 1,
      requiresFullPayment: true
    })
  );
  assert.equal(b.ok, true);
  assert.equal(b.value.requiresFullPayment, true);

  const ref = normalizeOptionalPaymentTermReference({});
  assert.equal(ref.paymentTermCode, null);
  assert.equal(ref.paymentTermVersion, null);
});
