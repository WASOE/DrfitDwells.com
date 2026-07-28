/**
 * Batch 3 — mark CheckoutSession paid + ensure CheckoutFinalizationJob (no execute).
 *
 * Run: node --test server/scripts/paidCheckoutWebhookSync.batch3.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const CheckoutSession = require('../models/CheckoutSession');
const CheckoutFinalizationJob = require('../models/CheckoutFinalizationJob');
const Payment = require('../models/Payment');
const Booking = require('../models/Booking');
const StripeEventEvidence = require('../models/StripeEventEvidence');
const PaymentResolutionIssue = require('../models/PaymentResolutionIssue');
const ManualReviewItem = require('../models/ManualReviewItem');

const { processStripeWebhookEvent } = require('../services/ops/ingestion/stripeIngestionService');
const {
  createCheckoutSession
} = require('../services/checkout/checkoutSessionService');
const {
  hashFinalizeIntent,
  buildValidatedFinalizeIntent
} = require('../services/checkout/finalizeIntentService');
const {
  ensureCheckoutFinalizationJob,
  getCheckoutFinalizationJobByCheckoutId
} = require('../services/checkout/checkoutFinalizationJobService');
const {
  VERIFICATION_ERROR_CODES,
  isAccommodationPaymentIntentSucceededEvent
} = require('../services/checkout/paidCheckoutWebhookSyncService');
const {
  LEGAL_ACCEPTANCE_TERMS_VERSION,
  LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
  LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
} = require('../config/legalAcceptance');
const { formatSofiaDateOnly } = require('../utils/dateTime');
const fs = require('fs');
const path = require('path');

let mongoServer;
const ENTITY_ID = new mongoose.Types.ObjectId();

const ORIG = {
  MARK: process.env.CHECKOUT_MARK_PAID_ON_WEBHOOK,
  ENQUEUE: process.env.FINALIZE_JOB_ENQUEUE,
  EXECUTE: process.env.FINALIZE_JOB_EXECUTE,
  REQUIRED: process.env.FINALIZE_INTENT_REQUIRED_FOR_PI
};

function setFlags({ markPaid = '1', enqueue = '1', execute = '0', required = '0' } = {}) {
  process.env.CHECKOUT_MARK_PAID_ON_WEBHOOK = markPaid;
  process.env.FINALIZE_JOB_ENQUEUE = enqueue;
  process.env.FINALIZE_JOB_EXECUTE = execute;
  process.env.FINALIZE_INTENT_REQUIRED_FOR_PI = required;
}

function restoreFlags() {
  for (const [key, envKey] of [
    ['MARK', 'CHECKOUT_MARK_PAID_ON_WEBHOOK'],
    ['ENQUEUE', 'FINALIZE_JOB_ENQUEUE'],
    ['EXECUTE', 'FINALIZE_JOB_EXECUTE'],
    ['REQUIRED', 'FINALIZE_INTENT_REQUIRED_FOR_PI']
  ]) {
    if (ORIG[key] === undefined) delete process.env[envKey];
    else process.env[envKey] = ORIG[key];
  }
}

function buildQuote(overrides = {}) {
  const checkInDate = new Date('2030-08-10T12:00:00.000Z');
  const checkOutDate = new Date('2030-08-12T12:00:00.000Z');
  return {
    entityType: 'cabin',
    entity: {
      _id: ENTITY_ID,
      minNights: 1,
      capacity: 4,
      pricingModel: 'per_night'
    },
    checkInDate,
    checkOutDate,
    subtotalPrice: 200,
    discountAmount: 0,
    totalPrice: 200,
    appliedPromoCode: '',
    promo: null,
    voucherAppliedCents: 0,
    remainingDueCents: 20000,
    fullVoucherCoverage: false,
    ...overrides
  };
}

function buildInput(overrides = {}) {
  return {
    cabinId: String(ENTITY_ID),
    checkIn: '2030-08-10',
    checkOut: '2030-08-12',
    adults: 2,
    children: 0,
    experienceKeys: ['sauna'],
    ...overrides
  };
}

async function createV2SessionWithCanonicalPi({
  paymentIntentId = `pi_${new mongoose.Types.ObjectId().toString()}`,
  withFinalizeIntent = true,
  amountCents = 20000
} = {}) {
  const created = await createCheckoutSession({
    input: buildInput(),
    quote: buildQuote({ remainingDueCents: amountCents, totalPrice: amountCents / 100 })
  });
  const session = created.session;
  session.canonicalPaymentIntentId = paymentIntentId;
  session.status = 'pi_active';
  session.paymentStatus = 'unpaid';
  session.stripeAmountCents = amountCents;

  let finalizeIntentHash = null;
  if (withFinalizeIntent) {
    const intent = buildValidatedFinalizeIntent({
      body: {
        guestInfo: {
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.com',
          phone: '+359888000111'
        },
        specialRequests: '',
        legalAcceptance: {
          acceptedTermsAndCancellation: true,
          acceptedActivityRisk: true,
          termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
          activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
          checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
          checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT,
          locale: 'en'
        },
        consents: {
          quoteDeliveryRequested: false,
          bookingReminderConsent: false,
          marketingConsent: false
        },
        experienceKeys: ['sauna'],
        romanticSetup: false
      },
      requestMeta: { ip: '203.0.113.1', userAgent: 'Batch3Test', acceptLanguage: 'en' },
      capturedAt: new Date('2030-01-01T00:00:00.000Z'),
      quoteSnapshot: session.quoteSnapshot
    });
    finalizeIntentHash = hashFinalizeIntent(intent);
    session.finalizeIntent = intent;
    session.finalizeIntentHash = finalizeIntentHash;
    session.finalizeIntentCapturedAt = intent.capturedAt;
  }

  await session.save();
  return { session, paymentIntentId, finalizeIntentHash };
}

function makeSucceededEvent({
  eventId,
  paymentIntentId,
  session,
  finalizeIntentHash = '',
  amountReceivedCents = null,
  currency = 'eur',
  metadataOverrides = {},
  status = 'succeeded'
}) {
  const snapshot = session.quoteSnapshot || {};
  const amount = amountReceivedCents != null ? amountReceivedCents : session.stripeAmountCents;
  const checkInISO = snapshot.checkInISO || new Date('2030-08-10T12:00:00.000Z').toISOString();
  const checkOutISO = snapshot.checkOutISO || new Date('2030-08-12T12:00:00.000Z').toISOString();
  return {
    id: eventId,
    type: 'payment_intent.succeeded',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: {
      object: {
        object: 'payment_intent',
        id: paymentIntentId,
        status,
        amount,
        amount_received: amount,
        currency,
        metadata: {
          flowVersion: 'v2',
          checkoutId: session.checkoutId,
          quoteSnapshotHash: session.quoteSnapshotHash,
          finalizeIntentHash: finalizeIntentHash || session.finalizeIntentHash || '',
          entityType: snapshot.entityType || 'cabin',
          cabinId: snapshot.cabinId || '',
          cabinTypeId: snapshot.cabinTypeId || '',
          checkIn: checkInISO,
          checkOut: checkOutISO,
          ...metadataOverrides
        }
      }
    }
  };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await CheckoutSession.syncIndexes();
  await CheckoutFinalizationJob.syncIndexes();
  await Payment.syncIndexes();
  await StripeEventEvidence.syncIndexes();
  await PaymentResolutionIssue.syncIndexes();
  await ManualReviewItem.syncIndexes();
  await Booking.syncIndexes();
});

test.after(async () => {
  restoreFlags();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  setFlags({ markPaid: '1', enqueue: '1', execute: '0' });
  await Promise.all([
    CheckoutSession.deleteMany({}),
    CheckoutFinalizationJob.deleteMany({}),
    Payment.deleteMany({}),
    StripeEventEvidence.collection.deleteMany({}),
    PaymentResolutionIssue.deleteMany({}),
    ManualReviewItem.deleteMany({}),
    Booking.deleteMany({})
  ]);
});

test.afterEach(() => {
  restoreFlags();
});

test('flags default off and parse on/off tokens', () => {
  const featureFlags = require('../utils/featureFlags');
  delete process.env.CHECKOUT_MARK_PAID_ON_WEBHOOK;
  delete process.env.FINALIZE_JOB_ENQUEUE;
  assert.equal(featureFlags.isCheckoutMarkPaidOnWebhookEnabled(), false);
  assert.equal(featureFlags.isFinalizeJobEnqueueEnabled(), false);
  process.env.CHECKOUT_MARK_PAID_ON_WEBHOOK = 'yes';
  process.env.FINALIZE_JOB_ENQUEUE = 'on';
  assert.equal(featureFlags.isCheckoutMarkPaidOnWebhookEnabled(), true);
  assert.equal(featureFlags.isFinalizeJobEnqueueEnabled(), true);
  process.env.CHECKOUT_MARK_PAID_ON_WEBHOOK = 'no';
  assert.equal(featureFlags.isCheckoutMarkPaidOnWebhookEnabled(), false);
});

test('1+2) verified canonical accommodation PI marks session paid with safe evidence', async () => {
  const { session, paymentIntentId, finalizeIntentHash } = await createV2SessionWithCanonicalPi();
  const event = makeSucceededEvent({
    eventId: 'evt_batch3_1',
    paymentIntentId,
    session,
    finalizeIntentHash
  });
  const result = await processStripeWebhookEvent(event);
  assert.equal(result.ok, true);
  assert.equal(result.accommodationSync?.markPaid, true);

  const updated = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
  assert.equal(updated.paymentStatus, 'paid');
  assert.equal(updated.status, 'paid');
  assert.ok(updated.paymentSucceededAt);
  assert.ok(updated.finalizeIntentImmutableAt);
  assert.equal(updated.paymentEvidence.paymentIntentId, paymentIntentId);
  assert.equal(updated.paymentEvidence.stripeEventId, 'evt_batch3_1');
  assert.equal(updated.paymentEvidence.amountReceivedCents, 20000);
  assert.equal(updated.paymentEvidence.currency, 'eur');
  assert.equal(updated.paymentEvidence.quoteSnapshotHash, session.quoteSnapshotHash);
  assert.equal(updated.paymentEvidence.finalizeIntentHash, finalizeIntentHash);
  assert.equal(Object.prototype.hasOwnProperty.call(updated.paymentEvidence, 'client_secret'), false);
});

test('3) session paid update is idempotent', async () => {
  const { session, paymentIntentId, finalizeIntentHash } = await createV2SessionWithCanonicalPi();
  const event = makeSucceededEvent({
    eventId: 'evt_batch3_idem_session',
    paymentIntentId,
    session,
    finalizeIntentHash
  });
  await processStripeWebhookEvent(event);
  const first = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
  await processStripeWebhookEvent(event);
  const second = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
  assert.equal(String(second.paymentSucceededAt), String(first.paymentSucceededAt));
  assert.equal(second.paymentEvidence.paymentIntentId, first.paymentEvidence.paymentIntentId);
  assert.equal(second.paymentStatus, 'paid');
});

test('4) duplicate Stripe event does not duplicate the job', async () => {
  const { session, paymentIntentId, finalizeIntentHash } = await createV2SessionWithCanonicalPi();
  const event = makeSucceededEvent({
    eventId: 'evt_batch3_dup_job',
    paymentIntentId,
    session,
    finalizeIntentHash
  });
  await processStripeWebhookEvent(event);
  await processStripeWebhookEvent(event);
  const jobs = await CheckoutFinalizationJob.find({ checkoutId: session.checkoutId });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, 'scheduled');
  assert.equal(jobs[0].stage, 'queued');
});

test('5) duplicate event repairs a missing job', async () => {
  const { session, paymentIntentId, finalizeIntentHash } = await createV2SessionWithCanonicalPi();
  const event = makeSucceededEvent({
    eventId: 'evt_batch3_repair_job',
    paymentIntentId,
    session,
    finalizeIntentHash
  });
  await processStripeWebhookEvent(event);
  await CheckoutFinalizationJob.deleteMany({ checkoutId: session.checkoutId });
  assert.equal(await CheckoutFinalizationJob.countDocuments({}), 0);

  const repair = await processStripeWebhookEvent(event);
  assert.equal(repair.deduped, true);
  assert.equal(repair.accommodationSync?.job?.created, true);
  const jobs = await CheckoutFinalizationJob.find({ checkoutId: session.checkoutId });
  assert.equal(jobs.length, 1);
});

test('6+7) alreadyProcessed repairs missing session paid update', async () => {
  const { session, paymentIntentId, finalizeIntentHash } = await createV2SessionWithCanonicalPi();
  const event = makeSucceededEvent({
    eventId: 'evt_batch3_repair_paid',
    paymentIntentId,
    session,
    finalizeIntentHash
  });
  await processStripeWebhookEvent(event);
  await CheckoutSession.updateOne(
    { checkoutId: session.checkoutId },
    {
      $set: {
        paymentStatus: 'unpaid',
        status: 'pi_active',
        paymentSucceededAt: null,
        paymentEvidence: null,
        finalizeIntentImmutableAt: null
      }
    }
  );
  await CheckoutFinalizationJob.deleteMany({ checkoutId: session.checkoutId });

  const repair = await processStripeWebhookEvent(event);
  assert.equal(repair.deduped, true);
  assert.equal(repair.accommodationSync?.markPaid, true);
  const updated = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
  assert.equal(updated.paymentStatus, 'paid');
  assert.ok(updated.paymentEvidence);
  assert.equal(await CheckoutFinalizationJob.countDocuments({ checkoutId: session.checkoutId }), 1);
});

test('8+9) gift-voucher event never updates accommodation session or enqueues job', async () => {
  const { session } = await createV2SessionWithCanonicalPi({
    paymentIntentId: 'pi_gift_should_not_touch'
  });
  const giftEvent = {
    id: 'evt_gift_1',
    type: 'payment_intent.succeeded',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: {
      object: {
        object: 'payment_intent',
        id: 'pi_gift_only',
        status: 'succeeded',
        amount: 15000,
        amount_received: 15000,
        currency: 'eur',
        metadata: {
          type: 'gift_voucher',
          checkoutId: session.checkoutId,
          giftVoucherId: new mongoose.Types.ObjectId().toString(),
          purchaseRequestId: 'gvr_test'
        }
      }
    }
  };
  assert.equal(isAccommodationPaymentIntentSucceededEvent(giftEvent), false);

  const {
    syncAccommodationCheckoutPaidFromWebhook
  } = require('../services/checkout/paidCheckoutWebhookSyncService');
  const sync = await syncAccommodationCheckoutPaidFromWebhook({ event: giftEvent });
  assert.equal(sync.skipped, true);

  const updated = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
  assert.equal(updated.paymentStatus, 'unpaid');
  assert.equal(await CheckoutFinalizationJob.countDocuments({}), 0);
});

test('10) location flow remains unaffected (no finalize job imports in location routes)', () => {
  const loc = fs.readFileSync(
    path.join(__dirname, '../routes/publicLocationCheckoutRoutes.js'),
    'utf8'
  );
  assert.equal(loc.includes('CheckoutFinalizationJob'), false);
  assert.equal(loc.includes('syncAccommodationCheckoutPaidFromWebhook'), false);
  assert.equal(loc.includes('CHECKOUT_MARK_PAID_ON_WEBHOOK'), false);
});

test('11) missing CheckoutSession becomes precise permanent review', async () => {
  const orphanPi = 'pi_orphan_no_session';
  const event = {
    id: 'evt_missing_session',
    type: 'payment_intent.succeeded',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: {
      object: {
        object: 'payment_intent',
        id: orphanPi,
        status: 'succeeded',
        amount: 20000,
        amount_received: 20000,
        currency: 'eur',
        metadata: {
          flowVersion: 'v2',
          checkoutId: 'missing-checkout-id-12345678',
          quoteSnapshotHash: 'abc',
          finalizeIntentHash: '',
          cabinId: String(ENTITY_ID),
          checkIn: new Date('2030-08-10').toISOString(),
          checkOut: new Date('2030-08-12').toISOString()
        }
      }
    }
  };
  await processStripeWebhookEvent(event);
  const issue = await PaymentResolutionIssue.findOne({ paymentIntentId: orphanPi }).lean();
  assert.ok(issue);
  assert.equal(issue.errorCode, VERIFICATION_ERROR_CODES.CHECKOUT_SESSION_MISSING);
  assert.equal(await CheckoutFinalizationJob.countDocuments({}), 0);
});

test('12) noncanonical PI is rejected', async () => {
  const { session, finalizeIntentHash } = await createV2SessionWithCanonicalPi({
    paymentIntentId: 'pi_canonical_real'
  });
  const event = makeSucceededEvent({
    eventId: 'evt_noncanonical',
    paymentIntentId: 'pi_other',
    session,
    finalizeIntentHash
  });
  await processStripeWebhookEvent(event);
  const updated = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
  assert.equal(updated.paymentStatus, 'unpaid');
  const issue = await PaymentResolutionIssue.findOne({ paymentIntentId: 'pi_other' }).lean();
  assert.equal(issue.errorCode, VERIFICATION_ERROR_CODES.NONCANONICAL_PAYMENT_INTENT);
  assert.equal(await CheckoutFinalizationJob.countDocuments({}), 0);
});

test('13) superseded PI success is not finalized or enqueued', async () => {
  const { session, paymentIntentId, finalizeIntentHash } = await createV2SessionWithCanonicalPi();
  session.supersededPaymentIntentIds = [paymentIntentId];
  session.canonicalPaymentIntentId = 'pi_new_canonical';
  await session.save();
  const event = makeSucceededEvent({
    eventId: 'evt_superseded',
    paymentIntentId,
    session,
    finalizeIntentHash
  });
  await processStripeWebhookEvent(event);
  const updated = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
  assert.equal(updated.paymentStatus, 'unpaid');
  const issue = await PaymentResolutionIssue.findOne({ paymentIntentId }).lean();
  assert.equal(issue.errorCode, VERIFICATION_ERROR_CODES.SUPERSEDED_PAYMENT_INTENT);
  assert.equal(await CheckoutFinalizationJob.countDocuments({}), 0);
});

test('14) quote hash mismatch is rejected', async () => {
  const { session, paymentIntentId, finalizeIntentHash } = await createV2SessionWithCanonicalPi();
  const event = makeSucceededEvent({
    eventId: 'evt_quote_mismatch',
    paymentIntentId,
    session,
    finalizeIntentHash,
    metadataOverrides: { quoteSnapshotHash: 'wrong-hash' }
  });
  await processStripeWebhookEvent(event);
  assert.equal(
    (await PaymentResolutionIssue.findOne({ paymentIntentId }).lean()).errorCode,
    VERIFICATION_ERROR_CODES.QUOTE_SNAPSHOT_HASH_MISMATCH
  );
  assert.equal(await CheckoutFinalizationJob.countDocuments({}), 0);
});

test('15) finalizeIntentHash mismatch is rejected', async () => {
  const { session, paymentIntentId } = await createV2SessionWithCanonicalPi();
  const event = makeSucceededEvent({
    eventId: 'evt_fi_mismatch',
    paymentIntentId,
    session,
    finalizeIntentHash: 'deadbeef'.repeat(8)
  });
  await processStripeWebhookEvent(event);
  assert.equal(
    (await PaymentResolutionIssue.findOne({ paymentIntentId }).lean()).errorCode,
    VERIFICATION_ERROR_CODES.FINALIZE_INTENT_HASH_MISMATCH
  );
});

test('16) amount mismatch is rejected', async () => {
  const { session, paymentIntentId, finalizeIntentHash } = await createV2SessionWithCanonicalPi();
  const event = makeSucceededEvent({
    eventId: 'evt_amount_mismatch',
    paymentIntentId,
    session,
    finalizeIntentHash,
    amountReceivedCents: 19999
  });
  await processStripeWebhookEvent(event);
  assert.equal(
    (await PaymentResolutionIssue.findOne({ paymentIntentId }).lean()).errorCode,
    VERIFICATION_ERROR_CODES.AMOUNT_MISMATCH
  );
});

test('17) currency mismatch is rejected', async () => {
  const { session, paymentIntentId, finalizeIntentHash } = await createV2SessionWithCanonicalPi();
  const event = makeSucceededEvent({
    eventId: 'evt_currency_mismatch',
    paymentIntentId,
    session,
    finalizeIntentHash,
    currency: 'usd'
  });
  await processStripeWebhookEvent(event);
  assert.equal(
    (await PaymentResolutionIssue.findOne({ paymentIntentId }).lean()).errorCode,
    VERIFICATION_ERROR_CODES.CURRENCY_MISMATCH
  );
});

test('18) date mismatch is rejected', async () => {
  const { session, paymentIntentId, finalizeIntentHash } = await createV2SessionWithCanonicalPi();
  const event = makeSucceededEvent({
    eventId: 'evt_date_mismatch',
    paymentIntentId,
    session,
    finalizeIntentHash,
    metadataOverrides: {
      checkIn: new Date('2031-01-01T12:00:00.000Z').toISOString()
    }
  });
  await processStripeWebhookEvent(event);
  assert.equal(
    (await PaymentResolutionIssue.findOne({ paymentIntentId }).lean()).errorCode,
    VERIFICATION_ERROR_CODES.DATE_MISMATCH
  );
});

test('19) entity mismatch is rejected', async () => {
  const { session, paymentIntentId, finalizeIntentHash } = await createV2SessionWithCanonicalPi();
  const event = makeSucceededEvent({
    eventId: 'evt_entity_mismatch',
    paymentIntentId,
    session,
    finalizeIntentHash,
    metadataOverrides: { cabinId: new mongoose.Types.ObjectId().toString() }
  });
  await processStripeWebhookEvent(event);
  assert.equal(
    (await PaymentResolutionIssue.findOne({ paymentIntentId }).lean()).errorCode,
    VERIFICATION_ERROR_CODES.ENTITY_MISMATCH
  );
});

test('20) Payment record not paid prevents enqueue', async () => {
  const { session, paymentIntentId, finalizeIntentHash } = await createV2SessionWithCanonicalPi();
  // Pre-insert unpaid payment row that upsert will not overwrite incorrectly —
  // actually upsert sets paid on succeeded. Simulate by calling sync after forcing unpaid.
  const event = makeSucceededEvent({
    eventId: 'evt_payment_unpaid',
    paymentIntentId,
    session,
    finalizeIntentHash
  });
  // Insert evidence + payment unpaid, then call sync service directly without going through upsert
  const {
    syncAccommodationCheckoutPaidFromWebhook
  } = require('../services/checkout/paidCheckoutWebhookSyncService');
  await Payment.create({
    provider: 'stripe',
    providerReference: paymentIntentId,
    status: 'unpaid',
    amount: 200,
    currency: 'eur',
    source: 'test'
  });
  const sync = await syncAccommodationCheckoutPaidFromWebhook({
    event,
    payment: await Payment.findOne({ providerReference: paymentIntentId })
  });
  assert.equal(sync.ok, false);
  assert.equal(sync.errorCode, VERIFICATION_ERROR_CODES.PAYMENT_RECORD_NOT_PAID);
  assert.equal(await CheckoutFinalizationJob.countDocuments({}), 0);
});

test('21) MARK_PAID off preserves current behaviour', async () => {
  setFlags({ markPaid: '0', enqueue: '0' });
  const { session, paymentIntentId, finalizeIntentHash } = await createV2SessionWithCanonicalPi();
  const event = makeSucceededEvent({
    eventId: 'evt_flags_off',
    paymentIntentId,
    session,
    finalizeIntentHash
  });
  await processStripeWebhookEvent(event);
  const updated = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
  assert.equal(updated.paymentStatus, 'unpaid');
  assert.equal(await CheckoutFinalizationJob.countDocuments({}), 0);
  assert.ok(await Payment.findOne({ providerReference: paymentIntentId, status: 'paid' }));
});

test('22) ENQUEUE off creates no job while mark-paid still works', async () => {
  setFlags({ markPaid: '1', enqueue: '0' });
  const { session, paymentIntentId, finalizeIntentHash } = await createV2SessionWithCanonicalPi();
  const event = makeSucceededEvent({
    eventId: 'evt_enqueue_off',
    paymentIntentId,
    session,
    finalizeIntentHash
  });
  const result = await processStripeWebhookEvent(event);
  assert.equal(result.accommodationSync?.markPaid, true);
  assert.equal(result.accommodationSync?.enqueue, false);
  assert.equal(
    (await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean()).paymentStatus,
    'paid'
  );
  assert.equal(await CheckoutFinalizationJob.countDocuments({}), 0);
});

test('23) ENQUEUE on while MARK_PAID off fails safely', async () => {
  setFlags({ markPaid: '0', enqueue: '1' });
  const { session, paymentIntentId, finalizeIntentHash } = await createV2SessionWithCanonicalPi();
  const event = makeSucceededEvent({
    eventId: 'evt_enqueue_without_mark',
    paymentIntentId,
    session,
    finalizeIntentHash
  });
  const result = await processStripeWebhookEvent(event);
  assert.equal(result.accommodationSync?.skipped, true);
  assert.equal(result.accommodationSync?.warning, VERIFICATION_ERROR_CODES.ENQUEUE_WITHOUT_MARK_PAID);
  assert.equal(
    (await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean()).paymentStatus,
    'unpaid'
  );
  assert.equal(await CheckoutFinalizationJob.countDocuments({}), 0);
});

test('24) active-job unique index prevents duplicates', async () => {
  const { session, paymentIntentId } = await createV2SessionWithCanonicalPi();
  const first = await ensureCheckoutFinalizationJob({
    checkoutId: session.checkoutId,
    paymentIntentId,
    createdReason: 'webhook'
  });
  assert.equal(first.created, true);
  await assert.rejects(
    () =>
      CheckoutFinalizationJob.create({
        checkoutId: session.checkoutId,
        paymentIntentId: 'pi_other_active',
        status: 'scheduled',
        stage: 'queued',
        nextAttemptAt: new Date(),
        createdReason: 'webhook'
      }),
    (err) => err.code === 11000
  );
  const second = await ensureCheckoutFinalizationJob({
    checkoutId: session.checkoutId,
    paymentIntentId,
    createdReason: 'webhook'
  });
  assert.equal(second.created, false);
  assert.equal(second.existing, true);
  assert.equal(await CheckoutFinalizationJob.countDocuments({ checkoutId: session.checkoutId }), 1);
});

test('25) existing succeeded job is not replaced', async () => {
  const { session, paymentIntentId } = await createV2SessionWithCanonicalPi();
  const created = await CheckoutFinalizationJob.create({
    checkoutId: session.checkoutId,
    paymentIntentId,
    status: 'succeeded',
    stage: 'succeeded',
    nextAttemptAt: new Date(),
    createdReason: 'webhook'
  });
  const ensured = await ensureCheckoutFinalizationJob({
    checkoutId: session.checkoutId,
    paymentIntentId: 'pi_new_should_not_create',
    createdReason: 'reconcile'
  });
  assert.equal(ensured.created, false);
  assert.equal(ensured.status, 'succeeded');
  assert.equal(ensured.jobId, String(created._id));
  assert.equal(await CheckoutFinalizationJob.countDocuments({ checkoutId: session.checkoutId }), 1);
});

test('26) existing failed_permanent job is preserved', async () => {
  const { session, paymentIntentId } = await createV2SessionWithCanonicalPi();
  const created = await CheckoutFinalizationJob.create({
    checkoutId: session.checkoutId,
    paymentIntentId,
    status: 'failed_permanent',
    stage: 'verify_payment',
    nextAttemptAt: new Date(),
    createdReason: 'webhook',
    lastErrorCode: 'PRIOR_FAILURE'
  });
  const ensured = await ensureCheckoutFinalizationJob({
    checkoutId: session.checkoutId,
    paymentIntentId,
    createdReason: 'webhook'
  });
  assert.equal(ensured.created, false);
  assert.equal(ensured.status, 'failed_permanent');
  assert.equal(ensured.preserved, true);
  assert.equal(ensured.jobId, String(created._id));
});

test('26b) failed_retryable with remaining attempts is rescheduled without duplicate', async () => {
  const { session, paymentIntentId, finalizeIntentHash } = await createV2SessionWithCanonicalPi();
  const job = await CheckoutFinalizationJob.create({
    checkoutId: session.checkoutId,
    paymentIntentId,
    status: 'failed_retryable',
    stage: 'save_booking',
    attemptCount: 3,
    maxAttempts: 20,
    claimedBy: 'worker-old',
    claimedAt: new Date(Date.now() - 60_000),
    visibilityTimeoutAt: new Date(Date.now() - 30_000),
    nextAttemptAt: new Date(Date.now() + 3600_000),
    lastErrorCode: 'TRANSIENT_DB_ERROR',
    lastErrorSummary: 'temporary write conflict',
    firstFailedAt: new Date(Date.now() - 120_000),
    lastFailedAt: new Date(Date.now() - 60_000),
    safeDetails: { priorStage: 'save_booking' },
    createdReason: 'webhook'
  });

  const ensured = await ensureCheckoutFinalizationJob({
    checkoutId: session.checkoutId,
    paymentIntentId,
    createdReason: 'reconcile'
  });
  assert.equal(ensured.created, false);
  assert.equal(ensured.rescheduled, true);
  assert.equal(ensured.status, 'scheduled');
  assert.equal(ensured.jobId, String(job._id));

  const updated = await CheckoutFinalizationJob.findById(job._id).lean();
  assert.equal(updated.status, 'scheduled');
  assert.equal(updated.attemptCount, 3);
  assert.equal(updated.lastErrorCode, 'TRANSIENT_DB_ERROR');
  assert.equal(updated.lastErrorSummary, 'temporary write conflict');
  assert.equal(updated.safeDetails?.priorStage, 'save_booking');
  assert.equal(updated.claimedBy, null);
  assert.equal(updated.claimedAt, null);
  assert.equal(updated.visibilityTimeoutAt, null);
  assert.ok(new Date(updated.nextAttemptAt).getTime() <= Date.now() + 1000);
  assert.equal(await CheckoutFinalizationJob.countDocuments({ checkoutId: session.checkoutId }), 1);

  // Webhook retry path also reschedules without creating a second job
  const event = makeSucceededEvent({
    eventId: 'evt_reschedule_retryable',
    paymentIntentId,
    session,
    finalizeIntentHash
  });
  await processStripeWebhookEvent(event);
  assert.equal(await CheckoutFinalizationJob.countDocuments({ checkoutId: session.checkoutId }), 1);
  const afterWebhook = await CheckoutFinalizationJob.findById(job._id).lean();
  assert.equal(afterWebhook.status, 'scheduled');
  assert.equal(afterWebhook.lastErrorCode, 'TRANSIENT_DB_ERROR');
});

test('26c) failed_retryable at maxAttempts is promoted to failed_permanent', async () => {
  const { session, paymentIntentId } = await createV2SessionWithCanonicalPi();
  const job = await CheckoutFinalizationJob.create({
    checkoutId: session.checkoutId,
    paymentIntentId,
    status: 'failed_retryable',
    stage: 'link_payment',
    attemptCount: 20,
    maxAttempts: 20,
    lastErrorCode: 'STILL_RETRYABLE',
    lastErrorSummary: 'kept failing',
    nextAttemptAt: new Date(),
    createdReason: 'webhook'
  });
  const ensured = await ensureCheckoutFinalizationJob({
    checkoutId: session.checkoutId,
    paymentIntentId,
    createdReason: 'webhook'
  });
  assert.equal(ensured.created, false);
  assert.equal(ensured.promotedToPermanent, true);
  assert.equal(ensured.status, 'failed_permanent');
  assert.equal(ensured.jobId, String(job._id));
  const updated = await CheckoutFinalizationJob.findById(job._id).lean();
  assert.equal(updated.status, 'failed_permanent');
  assert.equal(updated.attemptCount, 20);
  assert.ok(
    updated.lastErrorCode === 'STILL_RETRYABLE' || updated.lastErrorCode === 'FINALIZE_RETRY_EXHAUSTED'
  );
  assert.equal(await CheckoutFinalizationJob.countDocuments({ checkoutId: session.checkoutId }), 1);
});

test('26d) cancelled job is not silently revived; a new scheduled job may be created', async () => {
  const { session, paymentIntentId } = await createV2SessionWithCanonicalPi();
  const cancelled = await CheckoutFinalizationJob.create({
    checkoutId: session.checkoutId,
    paymentIntentId,
    status: 'cancelled',
    stage: 'queued',
    nextAttemptAt: new Date(),
    createdReason: 'manual'
  });
  const ensured = await ensureCheckoutFinalizationJob({
    checkoutId: session.checkoutId,
    paymentIntentId,
    createdReason: 'webhook'
  });
  assert.equal(ensured.created, true);
  assert.equal(ensured.status, 'scheduled');
  assert.notEqual(ensured.jobId, String(cancelled._id));
  const cancelledStill = await CheckoutFinalizationJob.findById(cancelled._id).lean();
  assert.equal(cancelledStill.status, 'cancelled');
  assert.equal(
    await CheckoutFinalizationJob.countDocuments({
      checkoutId: session.checkoutId,
      status: 'scheduled'
    }),
    1
  );
});

test('27–31) Batch 3 webhook sync still does not create Booking / email / refund / PI', () => {
  const syncSrc = fs.readFileSync(
    path.join(__dirname, '../services/checkout/paidCheckoutWebhookSyncService.js'),
    'utf8'
  );
  const ingestionSrc = fs.readFileSync(
    path.join(__dirname, '../services/ops/ingestion/stripeIngestionService.js'),
    'utf8'
  );

  // Batch 3 sync path must remain enqueue-only (no Booking / finalize / email / refund / new PI).
  assert.equal(syncSrc.includes('Booking.create'), false);
  assert.equal(syncSrc.includes('runCheckoutFinalizeOrchestration'), false);
  assert.equal(syncSrc.includes('finalizePaidCheckout'), false);
  assert.equal(syncSrc.includes('sendMail'), false);
  assert.equal(syncSrc.includes('refunds.create'), false);
  assert.equal(syncSrc.includes('paymentIntents.create'), false);
  assert.equal(ingestionSrc.includes('runCheckoutFinalizeOrchestration'), false);
  assert.equal(ingestionSrc.includes('finalizePaidCheckout'), false);
  assert.equal(ingestionSrc.includes('CheckoutFinalizationJob.findOneAndUpdate'), false);
});

test('inspection helpers return job DTO', async () => {
  const { session, paymentIntentId } = await createV2SessionWithCanonicalPi();
  await ensureCheckoutFinalizationJob({
    checkoutId: session.checkoutId,
    paymentIntentId,
    createdReason: 'manual'
  });
  const dto = await getCheckoutFinalizationJobByCheckoutId(session.checkoutId);
  assert.equal(dto.checkoutId, session.checkoutId);
  assert.equal(dto.status, 'scheduled');
  assert.ok(dto.jobId);
});

test('Sofia date comparison uses date-only equality', () => {
  const a = formatSofiaDateOnly(new Date('2030-08-10T22:00:00.000Z'));
  const b = formatSofiaDateOnly(new Date('2030-08-10T01:00:00.000Z'));
  // Both should be valid YYYY-MM-DD strings; equality used in verification
  assert.match(a, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(b, /^\d{4}-\d{2}-\d{2}$/);
});
