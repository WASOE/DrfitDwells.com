/**
 * SP5 — payment choice, consent, charge amount, installments (no future invoices).
 * Run: cd server && NODE_PATH="" node --test --test-concurrency=1 scripts/splitPaymentSp5Choice.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const CheckoutSession = require('../models/CheckoutSession');
const Booking = require('../models/Booking');
const BookingInstallment = require('../models/BookingInstallment');
const PaymentTermTemplate = require('../models/PaymentTermTemplate');
const RatePlan = require('../models/RatePlan');
const {
  validateAndNormalizePaymentTermTemplate
} = require('../services/paymentTermService');
const {
  FUTURE_CHARGE_CONSENT_VERSION,
  buildFutureChargeConsentContract,
  buildStayCreditProtectionText,
  setCheckoutPaymentChoice,
  resolveExpectedChargeCents,
  getPaymentChoice,
  SplitPaymentChoiceError
} = require('../services/splitPaymentChoiceService');
const {
  buildPaymentIntentIdempotencyKey,
  paymentIntentMatchesSession,
  buildPaymentIntentMetadata
} = require('../services/checkout/checkoutCanonicalPaymentIntentService');
const { createCheckoutSession } = require('../services/checkout/checkoutSessionService');

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

function percentSplit40() {
  return {
    code: 'sp5-split-40',
    internalName: '40% checkout',
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
    ]
  };
}

function seasonalRatePlanDoc(overrides = {}) {
  return {
    code: 'sp5-winter',
    internalName: 'SP5 Winter',
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
    paymentTermCode: 'sp5-split-40',
    paymentTermVersion: 1,
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
    revision: 1,
    ...overrides
  };
}

function buildQuote() {
  return {
    entityType: 'cabin',
    entity: { _id: ENTITY_ID, minNights: 1, capacity: 4, pricingModel: 'per_night' },
    checkInDate: new Date('2026-12-20T12:00:00.000Z'),
    checkOutDate: new Date('2026-12-22T12:00:00.000Z'),
    checkInDateOnly: '2026-12-20',
    checkOutDateOnly: '2026-12-22',
    subtotalPrice: 500,
    discountAmount: 0,
    totalPrice: 500,
    voucherAppliedCents: 0,
    remainingDueCents: 50000,
    fullVoucherCoverage: false,
    ratePlan: { code: 'sp5-winter', version: 1, type: 'seasonal_stay', currency: 'EUR' }
  };
}

function baseInput() {
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
    guestEmail: 'guest@example.com'
  };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await CheckoutSession.syncIndexes();
  await Booking.syncIndexes();
  await BookingInstallment.syncIndexes();
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
  await Booking.deleteMany({});
  await BookingInstallment.deleteMany({});
  await PaymentTermTemplate.deleteMany({});
  await RatePlan.deleteMany({});
});

test('full is default; stay-credit wording is dynamic not hardcoded 40', async () => {
  await withEnvAsync('SPLIT_PAYMENT_ENABLED', 'true', async () => {
    const term = validateAndNormalizePaymentTermTemplate(percentSplit40());
    await PaymentTermTemplate.create(term.value);
    await RatePlan.create(seasonalRatePlanDoc());
    const { session } = await createCheckoutSession({ input: baseInput(), quote: buildQuote() });
    assert.equal(getPaymentChoice(session), 'full');
    assert.ok(session.splitPaymentOfferSnapshot);
    const text = buildStayCreditProtectionText(session.splitPaymentOfferSnapshot);
    assert.match(text, /Reserve with 40% today/);
    assert.doesNotMatch(text, /non-refundable/i);
  });
});

test('split cannot be selected without offer / wrong hash / without consent', async () => {
  const session = await CheckoutSession.create({
    checkoutId: 'chk_sp5_no_offer',
    flowVersion: 'v2',
    status: 'quoted',
    quoteSnapshot: { schemaVersion: 1, stripeAmountCents: 10000 },
    quoteSnapshotHash: 'h',
    stripeAmountCents: 10000,
    paymentStatus: 'unpaid',
    finalizeStatus: 'open',
    sessionVersion: 1
  });
  await assert.rejects(
    () => setCheckoutPaymentChoice({ session, choice: 'split', consent: { consentVersion: 1, consentHash: 'x' } }),
    (err) => err instanceof SplitPaymentChoiceError && err.code === 'SPLIT_OFFER_REQUIRED'
  );
});

test('valid split selection persists; consent hash is protocol identity', async () => {
  await withEnvAsync('SPLIT_PAYMENT_ENABLED', 'true', async () => {
    const term = validateAndNormalizePaymentTermTemplate(percentSplit40());
    await PaymentTermTemplate.create(term.value);
    await RatePlan.create(seasonalRatePlanDoc());
    const { session } = await createCheckoutSession({ input: baseInput(), quote: buildQuote() });
    const contract = buildFutureChargeConsentContract(
      session.splitPaymentOfferSnapshot,
      session.splitPaymentOfferSnapshotHash
    );
    assert.equal(contract.consentVersion, FUTURE_CHARGE_CONSENT_VERSION);

    await assert.rejects(
      () =>
        setCheckoutPaymentChoice({
          session,
          choice: 'split',
          splitOfferSnapshotHash: session.splitPaymentOfferSnapshotHash,
          consent: {
            consentVersion: contract.consentVersion,
            consentHash: 'deadbeef',
            displayedText: 'wrong'
          }
        }),
      (err) => err instanceof SplitPaymentChoiceError && err.code === 'FUTURE_CHARGE_CONSENT_INVALID'
    );

    const result = await setCheckoutPaymentChoice({
      session,
      choice: 'split',
      splitOfferSnapshotHash: session.splitOfferSnapshotHash || session.splitPaymentOfferSnapshotHash,
      consent: {
        consentVersion: contract.consentVersion,
        consentHash: contract.consentHash,
        acceptedLocale: 'en',
        displayedText: 'Custom evidence text that is not identity'
      }
    });
    assert.equal(result.choice, 'split');
    assert.equal(result.chargeAmountCents, 20000);
    assert.equal(resolveExpectedChargeCents(session), 20000);
    // SP5B: server-owned evidence — client displayedText must not become stored evidence.
    const {
      buildFutureChargeConsentDisplayedText
    } = require('../services/splitPaymentChoiceService');
    const serverText = buildFutureChargeConsentDisplayedText(
      session.splitPaymentOfferSnapshot,
      'en'
    );
    assert.equal(session.futureChargeConsent.displayedText, serverText);
    assert.notEqual(session.futureChargeConsent.displayedText, 'Custom evidence text that is not identity');
    assert.equal(session.futureChargeConsent.consentHash, contract.consentHash);
  });
});

test('PI identity distinguishes full vs split; amount match uses charge cents', async () => {
  const fullKey = buildPaymentIntentIdempotencyKey('chk1', 'hashA', null, 'full');
  const splitKey = buildPaymentIntentIdempotencyKey('chk1', 'hashA', null, 'split:abc');
  assert.notEqual(fullKey, splitKey);
  assert.match(fullKey, /:pay:full$/);
  assert.match(splitKey, /:pay:split:abc$/);

  const session = {
    stripeAmountCents: 50000,
    paymentChoice: { choice: 'split', splitOfferSnapshotHash: 'offerhash' },
    splitPaymentOfferSnapshotHash: 'offerhash',
    splitPaymentOfferSnapshot: {
      installments: [{ sequence: 1, amountCents: 20000 }]
    },
    quoteSnapshot: {
      subtotalCents: 50000,
      discountAmountCents: 0,
      totalValueCents: 50000,
      voucherAppliedCents: 0,
      appliedPromoCode: ''
    },
    voucherRedemptionId: null
  };
  const matchOk = paymentIntentMatchesSession(
    { amount: 20000, metadata: { paymentChoice: 'split', splitOfferSnapshotHash: 'offerhash', voucherAppliedCents: '0' } },
    session
  );
  assert.equal(matchOk.ok, true);
  const matchBad = paymentIntentMatchesSession(
    { amount: 50000, metadata: { paymentChoice: 'full', voucherAppliedCents: '0' } },
    session
  );
  assert.equal(matchBad.ok, false);

  const meta = buildPaymentIntentMetadata({
    session,
    snapshot: session.quoteSnapshot,
    chargeAmountCents: 20000
  });
  assert.equal(meta.amountCents, '20000');
  assert.equal(meta.stripeAmountCents, '50000');
  assert.equal(meta.paymentChoice, 'split');
});

test('BookingInstallment rows created for split settlement fields', async () => {
  const booking = await Booking.create({
    checkIn: new Date('2026-12-20'),
    checkOut: new Date('2026-12-22'),
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'A',
      lastName: 'B',
      email: 'a@b.com',
      phone: '+359888'
    },
    totalPrice: 500,
    stripePaidAmountCents: 20000,
    totalValueCents: 50000,
    paymentSettlementStatus: 'partially_paid',
    chosenPaymentScheduleSnapshot: {
      currency: 'EUR',
      installments: [
        {
          sequence: 1,
          amountCents: 20000,
          amountType: 'percent_bps',
          dueRule: 'checkout',
          dueOffsetDays: 0,
          dueAtDateOnly: '2026-10-01',
          cancellationTreatment: 'stay_credit'
        },
        {
          sequence: 2,
          amountCents: 30000,
          amountType: 'remainder',
          dueRule: 'days_before_arrival',
          dueOffsetDays: 30,
          dueAtDateOnly: '2026-11-20',
          cancellationTreatment: 'standard_policy'
        }
      ]
    },
    chosenPaymentScheduleSnapshotHash: 'schedhash',
    stripePaymentIntentId: 'pi_sp5_test',
    cabinId: ENTITY_ID,
    status: 'confirmed',
    legalAcceptance: {
      termsVersion: '1',
      activityRiskVersion: '1',
      acceptedAt: new Date(),
      firstName: 'A',
      lastName: 'B'
    }
  });

  const session = {
    checkoutId: 'chk_sp5_inst',
    splitPaymentOfferSnapshot: booking.chosenPaymentScheduleSnapshot
  };
  const { createBookingInstallmentsForSplit } = (() => {
    // Exercise model create path directly (mirrors finalize helper shape).
    return {
      createBookingInstallmentsForSplit: async (b, s) => {
        const offer = s.splitPaymentOfferSnapshot;
        const docs = offer.installments.map((inst) => ({
          bookingId: b._id,
          checkoutSessionId: s.checkoutId,
          sequence: inst.sequence,
          amountCents: inst.amountCents,
          currency: 'EUR',
          amountType: inst.amountType,
          dueRule: inst.dueRule,
          dueOffsetDays: inst.dueOffsetDays,
          dueAtDateOnly: inst.dueAtDateOnly,
          cancellationTreatment: inst.cancellationTreatment,
          status: inst.sequence === 1 ? 'paid' : 'scheduled',
          stripePaymentIntentId: inst.sequence === 1 ? b.stripePaymentIntentId : null,
          paidAt: inst.sequence === 1 ? new Date() : null
        }));
        return BookingInstallment.insertMany(docs);
      }
    };
  })();
  await createBookingInstallmentsForSplit(booking, session);
  const rows = await BookingInstallment.find({ bookingId: booking._id }).sort({ sequence: 1 });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, 'paid');
  assert.equal(rows[0].stripePaymentIntentId, 'pi_sp5_test');
  assert.equal(rows[1].status, 'scheduled');
  assert.equal(rows[1].stripeInvoiceId, null);
  assert.equal(booking.paymentSettlementStatus, 'partially_paid');
  assert.equal(booking.totalValueCents, 50000);
  assert.equal(booking.stripePaidAmountCents, 20000);
});
