/**
 * S0 multi-unit paid-orphan recovery — supplemental acceptance tests.
 * Binding: docs/architecture/multi-unit-cabin-type-capacity-and-paid-recovery-lock.md
 *
 * Companion to multiUnitPaidOrphanRecovery.test.cjs. Covers deeper
 * acceptance-level guarantees: dry-run zero-write across every recovery-
 * relevant collection (including SavedBookingQuote), partial-scope
 * authorization fail-closed behavior, the commercial-stay-bypass
 * independent-identity check, original-vs-live material evidence drift
 * (stayFingerprintMatch true -> null), manual-review-resolution-hold TOCTOU
 * races, concurrent confirmationQueuedAt transitions, concurrent completion
 * MRI adoption, fail-closed ensure() without scope, active-review-item lease
 * enforcement / foreign-steal rejection, the RECOVERY_UNIT_UNAVAILABLE alias,
 * and the finalizePaidCheckout(...) source-boundary guarantee.
 *
 * Only fake/synthetic IDs are used (24-hex ObjectId-shaped strings derived
 * from md5 of a label, and fake provider ids like `chk_test_*` / `pi_test_*`).
 * No production identifiers.
 *
 * Run:
 *   node --test --test-concurrency=1 server/scripts/multiUnitPaidOrphanRecovery.acceptance.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const CheckoutSession = require('../models/CheckoutSession');
const CheckoutFinalizationJob = require('../models/CheckoutFinalizationJob');
const Payment = require('../models/Payment');
const ManualReviewItem = require('../models/ManualReviewItem');
const Unit = require('../models/Unit');
const Booking = require('../models/Booking');
const EmailDeliveryState = require('../models/EmailDeliveryState');
const SavedBookingQuote = require('../models/SavedBookingQuote');

const {
  recoverAllowlistedMultiUnitPaidOrphanCheckout,
  dryRunMultiUnitPaidOrphanRecovery,
  INTENT_PHRASE,
  MultiUnitPaidOrphanRecoveryError
} = require('../services/checkout/multiUnitPaidOrphanRecoveryService');

const {
  getRecoveryErrorCatalogEntry
} = require('../services/checkout/multiUnitPaidOrphanRecoveryErrors');

const {
  runInMultiUnitPaidOrphanRecoveryContext,
  assertMultiUnitPaidOrphanRecoveryContext
} = require('../services/checkout/multiUnitPaidOrphanRecoveryCapability');

const {
  assertNoCommercialStayConflict
} = require('../services/checkout/commercialStayGuardService');

const {
  ensureMultiUnitPaidOrphanCompletionReview,
  acquireManualReviewResolutionHold,
  buildCompletionRecoveryDedupeKey,
  COMPLETION_SOURCE
} = require('../services/checkout/multiUnitPaidOrphanRecoveryReviewService');

const {
  acquireInitialMultiUnitRecoveryLease,
  markCheckoutFinalizationJobConfirmationQueued,
  setActiveRecoveryReviewItemId,
  buildRecoveryClaimedBy,
  RECOVERY_LEASE_TTL_MS
} = require('../services/checkout/checkoutFinalizationJobService');

const { resolveManualReviewItem } = require('../services/ops/ingestion/manualReviewService');
const {
  resolvePaymentUnlinkedReviews
} = require('../services/payments/paymentReviewResolutionService');

const {
  bookingLifecycleCorrelationKey
} = require('../services/email/emailDeliveryCorrelation');

const featureFlags = require('../utils/featureFlags');

let mongoServer;

const ORIG_RECOVERY_FLAG = process.env.MULTI_UNIT_PAID_ORPHAN_RECOVERY;
const ORIG_CAPACITY_FLAG = process.env.MULTI_UNIT_CAPACITY_STAY_GUARD;

function restoreFeatureFlagEnv() {
  if (ORIG_RECOVERY_FLAG === undefined) delete process.env.MULTI_UNIT_PAID_ORPHAN_RECOVERY;
  else process.env.MULTI_UNIT_PAID_ORPHAN_RECOVERY = ORIG_RECOVERY_FLAG;
  if (ORIG_CAPACITY_FLAG === undefined) delete process.env.MULTI_UNIT_CAPACITY_STAY_GUARD;
  else process.env.MULTI_UNIT_CAPACITY_STAY_GUARD = ORIG_CAPACITY_FLAG;
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await CheckoutSession.syncIndexes();
  await CheckoutFinalizationJob.syncIndexes();
  await Payment.syncIndexes();
  await ManualReviewItem.syncIndexes();
  await Unit.syncIndexes();
  await Booking.syncIndexes();
  await EmailDeliveryState.syncIndexes();
  await SavedBookingQuote.syncIndexes();
});

test.after(async () => {
  restoreFeatureFlagEnv();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  restoreFeatureFlagEnv();
  await Promise.all([
    CheckoutSession.deleteMany({}),
    CheckoutFinalizationJob.deleteMany({}),
    Payment.deleteMany({}),
    ManualReviewItem.deleteMany({}),
    Unit.deleteMany({}),
    Booking.deleteMany({}),
    EmailDeliveryState.deleteMany({}),
    SavedBookingQuote.deleteMany({})
  ]);
});

/* ---------------------------------------------------------------------- *
 * Fake-id helpers — synthetic only, never production identifiers.
 * ---------------------------------------------------------------------- */

function fakeObjectId(seed) {
  const hex = crypto.createHash('md5').update(String(seed)).digest('hex').slice(0, 24);
  return new mongoose.Types.ObjectId(hex);
}

function fakeDigest(seed) {
  return crypto.createHash('sha256').update(String(seed)).digest('hex');
}

let scopeSeq = 0;
function buildFakeScope(overrides = {}) {
  scopeSeq += 1;
  const n = scopeSeq;
  return {
    recoveryMode: 'initial',
    recoveryExecutionId: `exec-acc-test-${n}`,
    checkoutId: `chk_test_orphan_acc_${n}`,
    paymentIntentId: `pi_test_orphan_acc_${n}`,
    checkoutSessionId: String(fakeObjectId(`acc-checkoutSession-${n}`)),
    paymentId: String(fakeObjectId(`acc-payment-${n}`)),
    finalizationJobId: String(fakeObjectId(`acc-job-${n}`)),
    manualReviewItemId: String(fakeObjectId(`acc-review-${n}`)),
    cabinTypeId: String(fakeObjectId(`acc-cabinType-${n}`)),
    expectedTargetUnitId: String(fakeObjectId(`acc-unit-${n}`)),
    evidenceDigest: fakeDigest(`acc-evidence-${n}`),
    ...overrides
  };
}

function buildValidIntentOverlay(overrides = {}) {
  return {
    confirmationPhrase: INTENT_PHRASE,
    operatorActorId: 'ops:test-operator',
    operatorIntentConfirmedAt: new Date().toISOString(),
    recoveryReason: 'Synthetic acceptance test: guest confirmed intent to purchase a second unit',
    ...overrides
  };
}

/**
 * Seed a minimal-but-complete "full incident" (session, job, payment, review,
 * unit) so `loadIncidentDocuments`/`buildCanonicalEvidence` can run for real
 * against the in-memory Mongo instance.
 */
async function seedFullIncident(overrides = {}) {
  const suffix = overrides.suffix || String(Date.now()) + Math.random().toString(16).slice(2);
  const checkoutId = overrides.checkoutId || `chk_test_orphan_acc_${suffix}`;
  const paymentIntentId = overrides.paymentIntentId || `pi_test_orphan_acc_${suffix}`;
  const checkoutSessionId = overrides.checkoutSessionId || new mongoose.Types.ObjectId();
  const paymentId = overrides.paymentId || new mongoose.Types.ObjectId();
  const finalizationJobId = overrides.finalizationJobId || new mongoose.Types.ObjectId();
  const manualReviewItemId = overrides.manualReviewItemId || new mongoose.Types.ObjectId();
  const cabinTypeId = overrides.cabinTypeId || new mongoose.Types.ObjectId();
  const expectedTargetUnitId = overrides.expectedTargetUnitId || new mongoose.Types.ObjectId();

  const checkIn = overrides.checkIn || new Date('2031-04-10T00:00:00.000Z');
  const checkOut = overrides.checkOut || new Date('2031-04-12T00:00:00.000Z');

  await CheckoutSession.create({
    _id: checkoutSessionId,
    checkoutId,
    status: 'needs_review',
    guestEmail: 'guest-acc-orphan-test@example.com',
    quoteSnapshot: {
      checkInDate: checkIn,
      checkOutDate: checkOut,
      totalCents: 40000,
      currency: 'eur'
    },
    paymentStatus: 'paid',
    finalizeStatus: 'needs_review'
  });

  await CheckoutFinalizationJob.create({
    _id: finalizationJobId,
    checkoutId,
    paymentIntentId,
    status: 'failed_permanent',
    stage: 'save_booking',
    createdReason: 'webhook',
    lastErrorCode: 'DUPLICATE_STAY_CONFLICT',
    lastErrorSummary: 'Synthetic duplicate stay conflict for acceptance tests'
  });

  await Payment.create({
    _id: paymentId,
    provider: 'stripe',
    providerReference: paymentIntentId,
    status: 'paid',
    amount: 400,
    currency: 'eur',
    source: 'webhook'
  });

  await ManualReviewItem.create({
    _id: manualReviewItemId,
    category: 'duplicate_stay_conflict',
    severity: 'critical',
    status: 'open',
    title: 'Synthetic duplicate stay conflict (acceptance)',
    details: 'Synthetic incident manual review for acceptance tests'
  });

  await Unit.create({
    _id: expectedTargetUnitId,
    cabinTypeId,
    unitNumber: `AF-ACC-${suffix}`.slice(0, 20),
    isActive: true
  });

  const allowlist = {
    checkoutId,
    checkoutSessionId: String(checkoutSessionId),
    paymentIntentId,
    paymentId: String(paymentId),
    finalizationJobId: String(finalizationJobId),
    manualReviewItemId: String(manualReviewItemId),
    cabinTypeId: String(cabinTypeId),
    expectedTargetUnitId: String(expectedTargetUnitId),
    expectedFailureCode: 'DUPLICATE_STAY_CONFLICT'
  };

  return {
    allowlist,
    checkIn,
    checkOut,
    checkoutSessionId,
    finalizationJobId,
    paymentId,
    manualReviewItemId,
    cabinTypeId,
    expectedTargetUnitId
  };
}

/* ======================================================================== *
 * 1. Dry-run zero-write / unchanged-state guarantee across every collection.
 * ======================================================================== */

test('acceptance: dry-run leaves CheckoutSession/Job/Booking/Payment/MRI/EDS/Unit/SavedBookingQuote counts and key timestamps unchanged', async () => {
  const seeded = await seedFullIncident();
  const { allowlist } = seeded;

  // Unrelated documents in every model so counts/timestamps can be verified
  // to be fully unaffected by the dry-run (not just the incident's own rows).
  const unrelatedBooking = await Booking.create({
    cabinTypeId: seeded.cabinTypeId,
    unitId: seeded.expectedTargetUnitId,
    checkIn: new Date('2031-05-01T00:00:00.000Z'),
    checkOut: new Date('2031-05-03T00:00:00.000Z'),
    adults: 2,
    status: 'confirmed',
    totalPrice: 200,
    guestInfo: {
      firstName: 'Unrelated',
      lastName: 'Guest',
      email: 'unrelated-guest@example.com',
      phone: '+1-555-0100'
    }
  });

  const unrelatedEds = await EmailDeliveryState.create({
    correlationKey: `booking:${unrelatedBooking._id}:booking_received:unrelated-guest@example.com`,
    domain: 'booking_lifecycle',
    bookingId: unrelatedBooking._id,
    templateKey: 'booking_received',
    recipient: 'unrelated-guest@example.com',
    latestStatus: 'pending',
    latestEventAt: new Date()
  });

  const savedQuote = await SavedBookingQuote.create({
    propertyKind: 'cabin',
    entityType: 'cabin_type',
    entityId: seeded.cabinTypeId,
    checkIn: new Date('2031-06-01T00:00:00.000Z'),
    checkOut: new Date('2031-06-03T00:00:00.000Z'),
    checkInDateOnly: '2031-06-01',
    checkOutDateOnly: '2031-06-03',
    adults: 2,
    quotedTotalCents: 30000,
    quoteFingerprint: `fp-acceptance-${Date.now()}`,
    quotedAt: new Date(),
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000)
  });

  const collections = [
    CheckoutSession,
    CheckoutFinalizationJob,
    Booking,
    Payment,
    ManualReviewItem,
    EmailDeliveryState,
    Unit,
    SavedBookingQuote
  ];

  async function snapshot() {
    const counts = await Promise.all(collections.map((m) => m.countDocuments({})));
    const [session, job, payment, review, unit, booking, eds, quote] = await Promise.all([
      CheckoutSession.findById(allowlist.checkoutSessionId).lean(),
      CheckoutFinalizationJob.findById(allowlist.finalizationJobId).lean(),
      Payment.findById(allowlist.paymentId).lean(),
      ManualReviewItem.findById(allowlist.manualReviewItemId).lean(),
      Unit.findById(allowlist.expectedTargetUnitId).lean(),
      Booking.findById(unrelatedBooking._id).lean(),
      EmailDeliveryState.findById(unrelatedEds._id).lean(),
      SavedBookingQuote.findById(savedQuote._id).lean()
    ]);
    return {
      counts,
      keyFields: {
        sessionUpdatedAt: session.updatedAt.getTime(),
        sessionStatus: session.status,
        sessionFinalizeStatus: session.finalizeStatus,
        jobUpdatedAt: job.updatedAt.getTime(),
        jobStatus: job.status,
        jobRecoveryStatus: job.recoveryStatus,
        paymentUpdatedAt: payment.updatedAt.getTime(),
        paymentStatus: payment.status,
        paymentReservationId: payment.reservationId ? String(payment.reservationId) : null,
        reviewUpdatedAt: review.updatedAt.getTime(),
        reviewStatus: review.status,
        unitUpdatedAt: unit.updatedAt.getTime(),
        unitIsActive: unit.isActive,
        bookingUpdatedAt: booking.updatedAt.getTime(),
        bookingStatus: booking.status,
        edsUpdatedAt: eds.updatedAt.getTime(),
        edsLatestStatus: eds.latestStatus,
        quoteUpdatedAt: quote.updatedAt.getTime(),
        quoteStatus: quote.status
      }
    };
  }

  const before = await snapshot();

  const dryRun = await dryRunMultiUnitPaidOrphanRecovery({ allowlist, now: new Date() });
  assert.equal(dryRun.writes, 0);
  const viaPublicEntry = await recoverAllowlistedMultiUnitPaidOrphanCheckout({
    mode: 'dry-run',
    allowlist
  });
  assert.equal(viaPublicEntry.writes, 0);

  const after = await snapshot();

  assert.deepEqual(after.counts, before.counts, 'no collection counts may change during a dry-run');
  assert.deepEqual(
    after.keyFields,
    before.keyFields,
    'no timestamps or status fields may change during a dry-run'
  );
});

/* ======================================================================== *
 * 2. Partial expectedScope cannot authorize a privileged operation.
 * ======================================================================== */

test('acceptance: partial expectedScope cannot authorize commercial_stay_bypass', async () => {
  const scope = buildFakeScope();

  await runInMultiUnitPaidOrphanRecoveryContext(scope, async () => {
    // Full scope authorizes the operation.
    assert.doesNotThrow(() =>
      assertMultiUnitPaidOrphanRecoveryContext(scope, { operation: 'commercial_stay_bypass' })
    );

    // Partial scope (checkoutId only) must fail closed even though the
    // ALS store itself is fully populated and matching.
    assert.throws(
      () =>
        assertMultiUnitPaidOrphanRecoveryContext(
          { checkoutId: scope.checkoutId },
          { operation: 'commercial_stay_bypass' }
        ),
      (err) => {
        assert.ok(err instanceof MultiUnitPaidOrphanRecoveryError);
        assert.equal(err.code, 'RECOVERY_SCOPE_MISMATCH');
        return true;
      }
    );
  });
});

/* ======================================================================== *
 * 3. Commercial-stay bypass rejects independently mismatched identity.
 * ======================================================================== */

test('acceptance: commercial stay bypass rejects independently mismatched paymentIntentId', async () => {
  const scope = buildFakeScope();
  const commercialStayFingerprint = 'fp-acceptance-commercial-stay-001';

  await runInMultiUnitPaidOrphanRecoveryContext(scope, async () => {
    await assert.rejects(
      () =>
        assertNoCommercialStayConflict({
          commercialStayFingerprint,
          checkoutId: scope.checkoutId,
          checkoutSessionId: scope.checkoutSessionId,
          paymentIntentId: 'pi_test_orphan_acc_WRONG',
          cabinTypeId: scope.cabinTypeId,
          evidenceDigest: scope.evidenceDigest
        }),
      (err) => {
        assert.ok(err instanceof MultiUnitPaidOrphanRecoveryError);
        assert.equal(err.code, 'RECOVERY_SCOPE_MISMATCH');
        return true;
      }
    );

    // Independently-supplied identities that DO match every ALS field grant
    // the bypass without ever consulting the Booking/CheckoutSession collections.
    const result = await assertNoCommercialStayConflict({
      commercialStayFingerprint,
      checkoutId: scope.checkoutId,
      checkoutSessionId: scope.checkoutSessionId,
      paymentIntentId: scope.paymentIntentId,
      cabinTypeId: scope.cabinTypeId,
      evidenceDigest: scope.evidenceDigest
    });
    assert.equal(result.ok, true);
    assert.equal(result.recoveryBypass, true);
  });
});

/* ======================================================================== *
 * 4. Original-vs-live material evidence: stayFingerprintMatch true -> null
 *    must abort BEFORE any lease is acquired.
 * ======================================================================== */

test('acceptance: compareMaterialEvidence / initial execute aborts on stayFingerprintMatch true->null', async () => {
  const seeded = await seedFullIncident();
  const { allowlist } = seeded;
  const sharedFingerprint = 'fp-acceptance-shared-stay-001';
  const sharedEmail = 'guest-shared-fp@example.com';

  await CheckoutSession.updateOne(
    { _id: allowlist.checkoutSessionId },
    { $set: { guestEmail: sharedEmail, stayFingerprint: sharedFingerprint } }
  );

  const firstBooking = await Booking.create({
    cabinTypeId: seeded.cabinTypeId,
    unitId: new mongoose.Types.ObjectId(),
    checkIn: seeded.checkIn,
    checkOut: seeded.checkOut,
    adults: 2,
    status: 'confirmed',
    totalPrice: 400,
    commercialStayFingerprint: sharedFingerprint,
    guestInfo: {
      firstName: 'Shared',
      lastName: 'Guest',
      email: sharedEmail,
      phone: '+1-555-0101'
    }
  });

  const allowlistWithFirstBooking = { ...allowlist, firstBookingId: String(firstBooking._id) };

  const dryRun = await dryRunMultiUnitPaidOrphanRecovery({
    allowlist: allowlistWithFirstBooking,
    now: new Date()
  });
  assert.equal(dryRun.canonicalEvidence.guestIdentityMatch, true);
  assert.equal(dryRun.canonicalEvidence.stayFingerprintMatch, true);

  // Live-state drift: the corroborating fingerprint disappears from the
  // first Booking between dry-run and execute (e.g. concurrent correction).
  await Booking.updateOne({ _id: firstBooking._id }, { $set: { commercialStayFingerprint: null } });

  process.env.MULTI_UNIT_PAID_ORPHAN_RECOVERY = '1';
  assert.equal(featureFlags.isMultiUnitPaidOrphanRecoveryEnabled(), true);

  await assert.rejects(
    () =>
      recoverAllowlistedMultiUnitPaidOrphanCheckout({
        mode: 'initial',
        allowlist: allowlistWithFirstBooking,
        originalEvidence: dryRun,
        digest: dryRun.digest,
        execute: true,
        intentOverlay: buildValidIntentOverlay(),
        now: new Date()
      }),
    (err) => {
      assert.ok(err instanceof MultiUnitPaidOrphanRecoveryError);
      assert.ok(
        err.code === 'RECOVERY_HOSTILE_STATE_DRIFT' || err.code === 'RECOVERY_FINGERPRINT_MISMATCH',
        `expected RECOVERY_HOSTILE_STATE_DRIFT or RECOVERY_FINGERPRINT_MISMATCH, got ${err.code}`
      );
      return true;
    }
  );

  const jobAfter = await CheckoutFinalizationJob.findById(allowlist.finalizationJobId).lean();
  assert.equal(jobAfter.recoveryStatus, 'idle', 'no lease may be acquired when material evidence drifts');
  assert.equal(jobAfter.recoveryExecutionId, null);
  assert.equal(jobAfter.recoveryVisibilityTimeoutAt, null);
});

/* ======================================================================== *
 * 5. Ordinary resolveManualReviewItem TOCTOU — the recovery hold wins.
 * ======================================================================== */

test('acceptance: ordinary resolveManualReviewItem TOCTOU — hold wins', async () => {
  const mri = await ManualReviewItem.create({
    category: 'duplicate_stay_conflict',
    severity: 'critical',
    status: 'open',
    title: 'TOCTOU acceptance review',
    details: 'Ordinary writer reads this as open before the recovery hold lands'
  });

  // Ordinary writer's stale read: the review looks resolvable at this instant.
  const staleRead = await ManualReviewItem.findById(mri._id).lean();
  assert.equal(staleRead.status, 'open');
  assert.notEqual(staleRead.resolutionHold?.status, 'active');

  const scope = buildFakeScope({ manualReviewItemId: String(mri._id) });

  await runInMultiUnitPaidOrphanRecoveryContext(scope, () =>
    acquireManualReviewResolutionHold({
      manualReviewItemId: mri._id,
      recoveryExecutionId: scope.recoveryExecutionId,
      finalizationJobId: scope.finalizationJobId,
      checkoutId: scope.checkoutId,
      paymentIntentId: scope.paymentIntentId,
      expectedScope: scope
    })
  );

  // Ordinary writer now attempts to resolve based on its stale open read —
  // the write-time filter (not the stale read) must decide the outcome.
  await assert.rejects(
    () =>
      resolveManualReviewItem({
        manualReviewItemId: mri._id,
        resolvedBy: 'ops_user_toctou_test',
        note: 'Attempted resolve after recovery hold acquired (TOCTOU)'
      }),
    (err) => {
      assert.equal(err.code, 'MANUAL_REVIEW_RESOLUTION_HELD');
      assert.equal(err.status, 409);
      return true;
    }
  );

  const stored = await ManualReviewItem.findById(mri._id).lean();
  assert.equal(stored.status, 'open');
  assert.equal(stored.resolutionHold.status, 'active');
  assert.equal(stored.resolutionHold.recoveryExecutionId, scope.recoveryExecutionId);
});

/* ======================================================================== *
 * 6. payment_unlinked updateMany excludes a hold acquired via the recovery
 *    service itself (not a hand-seeded document).
 * ======================================================================== */

test('acceptance: payment_unlinked updateMany excludes held review atomically', async () => {
  const paymentIntentId = 'pi_test_orphan_acc_unlinked';
  const paymentId = String(fakeObjectId('acc-payment-unlinked'));
  const reservationId = String(fakeObjectId('acc-reservation-unlinked'));

  const heldItem = await ManualReviewItem.create({
    category: 'payment_unlinked',
    severity: 'high',
    status: 'open',
    entityType: 'Payment',
    entityId: paymentId,
    title: 'Held payment_unlinked review (acceptance)',
    details: 'Hold acquired via the recovery service between listing and update',
    evidence: { paymentIntentId }
  });

  const unheldItem = await ManualReviewItem.create({
    category: 'payment_unlinked',
    severity: 'high',
    status: 'open',
    entityType: 'Payment',
    entityId: paymentId,
    title: 'Unheld payment_unlinked review (acceptance)',
    details: 'No hold',
    evidence: { paymentIntentId }
  });

  const scope = buildFakeScope({ manualReviewItemId: String(heldItem._id) });

  // Acquire the hold through the real recovery-service function, not by
  // hand-writing the resolutionHold sub-document.
  await runInMultiUnitPaidOrphanRecoveryContext(scope, () =>
    acquireManualReviewResolutionHold({
      manualReviewItemId: heldItem._id,
      recoveryExecutionId: scope.recoveryExecutionId,
      finalizationJobId: scope.finalizationJobId,
      checkoutId: scope.checkoutId,
      paymentIntentId: scope.paymentIntentId,
      expectedScope: scope
    })
  );

  const heldMidway = await ManualReviewItem.findById(heldItem._id).lean();
  assert.equal(heldMidway.resolutionHold.status, 'active');

  const result = await resolvePaymentUnlinkedReviews({
    paymentId,
    paymentIntentId,
    reservationId,
    resolvedBy: 'payment_linking_service_acceptance_test'
  });

  assert.equal(result.attempted, true);
  assert.equal(result.resolvedCount, 1);

  const heldAfter = await ManualReviewItem.findById(heldItem._id).lean();
  const unheldAfter = await ManualReviewItem.findById(unheldItem._id).lean();
  assert.equal(heldAfter.status, 'open', 'held review must remain open');
  assert.equal(unheldAfter.status, 'resolved', 'unheld review must resolve');
});

/* ======================================================================== *
 * 7. Two concurrent confirmationQueuedAt transitions — exactly one advances.
 * ======================================================================== */

test('acceptance: two concurrent confirmationQueuedAt transitions — one advances, one alreadyAdvanced', async () => {
  const scope = buildFakeScope();
  const bookingId = fakeObjectId('acc-booking-concurrent');

  await CheckoutFinalizationJob.create({
    _id: scope.finalizationJobId,
    checkoutId: scope.checkoutId,
    paymentIntentId: scope.paymentIntentId,
    status: 'succeeded',
    stage: 'succeeded',
    createdReason: 'webhook',
    bookingId,
    recoveryStatus: 'awaiting_confirmation_queue',
    recoveryExecutionId: scope.recoveryExecutionId,
    recoveryEvidenceDigest: scope.evidenceDigest,
    recoveryClaimedBy: buildRecoveryClaimedBy(scope.recoveryExecutionId),
    recoveryVisibilityTimeoutAt: new Date(Date.now() + RECOVERY_LEASE_TTL_MS)
  });

  const correlationKey = bookingLifecycleCorrelationKey({
    bookingId,
    templateKey: 'booking_received',
    recipientEmail: 'guest-concurrent-acc@example.com'
  });

  await EmailDeliveryState.create({
    correlationKey,
    domain: 'booking_lifecycle',
    bookingId,
    templateKey: 'booking_received',
    recipient: 'guest-concurrent-acc@example.com',
    latestStatus: 'pending',
    latestEventAt: new Date()
  });

  const expectedScope = { ...scope, bookingId: String(bookingId) };

  const [resultA, resultB] = await runInMultiUnitPaidOrphanRecoveryContext(scope, () =>
    Promise.all([
      markCheckoutFinalizationJobConfirmationQueued({
        finalizationJobId: scope.finalizationJobId,
        bookingId,
        recoveryExecutionId: scope.recoveryExecutionId,
        expectedCorrelationKey: correlationKey,
        expectedScope
      }),
      markCheckoutFinalizationJobConfirmationQueued({
        finalizationJobId: scope.finalizationJobId,
        bookingId,
        recoveryExecutionId: scope.recoveryExecutionId,
        expectedCorrelationKey: correlationKey,
        expectedScope
      })
    ])
  );

  const advancedFlags = [resultA.alreadyAdvanced, resultB.alreadyAdvanced].sort();
  assert.deepEqual(
    advancedFlags,
    [false, true],
    'exactly one concurrent transition must advance and the other must observe alreadyAdvanced'
  );

  assert.ok(resultA.job.confirmationQueuedAt);
  assert.ok(resultB.job.confirmationQueuedAt);
  assert.equal(
    new Date(resultA.job.confirmationQueuedAt).getTime(),
    new Date(resultB.job.confirmationQueuedAt).getTime(),
    'both callers must observe the identical confirmationQueuedAt timestamp'
  );
  assert.equal(resultA.job.confirmationSentAt, null);
  assert.equal(resultB.job.confirmationSentAt, null);
  assert.equal(resultA.job.recoveryStatus, 'awaiting_review_resolution');
  assert.equal(resultB.job.recoveryStatus, 'awaiting_review_resolution');

  const stored = await CheckoutFinalizationJob.findById(scope.finalizationJobId).lean();
  assert.equal(stored.recoveryStatus, 'awaiting_review_resolution');
  assert.equal(
    new Date(stored.confirmationQueuedAt).getTime(),
    new Date(resultA.job.confirmationQueuedAt).getTime()
  );
});

/* ======================================================================== *
 * 8. Concurrent completion MRI ensure() calls adopt one document (unique
 *    index reaffirmation).
 * ======================================================================== */

test('acceptance: concurrent completion MRI ensure adopts one document', async () => {
  const scope = buildFakeScope();

  const params = {
    originalManualReviewItemId: scope.manualReviewItemId,
    recoveryExecutionId: scope.recoveryExecutionId,
    finalizationJobId: scope.finalizationJobId,
    checkoutId: scope.checkoutId,
    checkoutSessionId: scope.checkoutSessionId,
    paymentId: scope.paymentId,
    paymentIntentId: scope.paymentIntentId,
    expectedScope: scope
  };

  const [resultA, resultB, resultC] = await runInMultiUnitPaidOrphanRecoveryContext(scope, () =>
    Promise.all([
      ensureMultiUnitPaidOrphanCompletionReview(params),
      ensureMultiUnitPaidOrphanCompletionReview(params),
      ensureMultiUnitPaidOrphanCompletionReview(params)
    ])
  );

  const ids = [resultA, resultB, resultC].map((r) => String(r.review._id));
  assert.equal(ids[0], ids[1]);
  assert.equal(ids[1], ids[2]);

  const createdFlags = [resultA.created, resultB.created, resultC.created];
  assert.equal(createdFlags.filter((c) => c === true).length, 1, 'exactly one call must create');
  assert.equal(createdFlags.filter((c) => c === false).length, 2, 'the other two calls must adopt');

  const dedupeKey = buildCompletionRecoveryDedupeKey(scope.recoveryExecutionId);
  const count = await ManualReviewItem.countDocuments({ recoveryDedupeKey: dedupeKey });
  assert.equal(count, 1, 'only one completion review document must exist');

  const indexes = await ManualReviewItem.collection.indexes();
  const dedupeIndex = indexes.find(
    (idx) => idx.key && Object.prototype.hasOwnProperty.call(idx.key, 'recoveryDedupeKey')
  );
  assert.ok(dedupeIndex, 'expected a recoveryDedupeKey index to exist');
  assert.equal(dedupeIndex.unique, true, 'recoveryDedupeKey index must be unique');

  const stored = await ManualReviewItem.findOne({ recoveryDedupeKey: dedupeKey }).lean();
  assert.equal(stored.provenance.source, COMPLETION_SOURCE);
});

/* ======================================================================== *
 * 9. ensureMultiUnitPaidOrphanCompletionReview fails closed without scope
 *    (inside ALS) and without any context at all (outside ALS).
 * ======================================================================== */

test('acceptance: ensureMultiUnitPaidOrphanCompletionReview without expectedScope fails closed', async () => {
  const scope = buildFakeScope();

  const params = {
    originalManualReviewItemId: scope.manualReviewItemId,
    recoveryExecutionId: scope.recoveryExecutionId,
    finalizationJobId: scope.finalizationJobId,
    checkoutId: scope.checkoutId,
    checkoutSessionId: scope.checkoutSessionId,
    paymentId: scope.paymentId,
    paymentIntentId: scope.paymentIntentId
  };

  // Inside a valid ALS context but the caller omits expectedScope entirely —
  // must fail with RECOVERY_SCOPE_MISMATCH (the ALS store existing is not enough).
  await runInMultiUnitPaidOrphanRecoveryContext(scope, async () => {
    await assert.rejects(
      () => ensureMultiUnitPaidOrphanCompletionReview({ ...params }),
      (err) => {
        assert.ok(err instanceof MultiUnitPaidOrphanRecoveryError);
        assert.equal(err.code, 'RECOVERY_SCOPE_MISMATCH');
        return true;
      }
    );
  });

  // Outside any ALS context, even a fully-formed expectedScope cannot help —
  // must fail with the context-required error, not a scope-mismatch error.
  await assert.rejects(
    () => ensureMultiUnitPaidOrphanCompletionReview({ ...params, expectedScope: scope }),
    (err) => {
      assert.ok(err instanceof MultiUnitPaidOrphanRecoveryError);
      assert.equal(err.code, 'MULTI_UNIT_PAID_ORPHAN_RECOVERY_CONTEXT_REQUIRED');
      return true;
    }
  );

  const count = await ManualReviewItem.countDocuments({
    recoveryDedupeKey: buildCompletionRecoveryDedupeKey(scope.recoveryExecutionId)
  });
  assert.equal(count, 0, 'neither failed attempt may have created a completion review');
});

/* ======================================================================== *
 * 10. setActiveRecoveryReviewItemId requires an active lease and rejects a
 *     foreign-review steal attempt.
 * ======================================================================== */

test('acceptance: setActiveRecoveryReviewItemId requires lease and rejects foreign review steal', async () => {
  const scope = buildFakeScope();
  const job = await CheckoutFinalizationJob.create({
    _id: scope.finalizationJobId,
    checkoutId: scope.checkoutId,
    paymentIntentId: scope.paymentIntentId,
    status: 'failed_permanent',
    stage: 'save_booking',
    createdReason: 'webhook',
    lastErrorCode: 'DUPLICATE_STAY_CONFLICT'
  });

  await runInMultiUnitPaidOrphanRecoveryContext(scope, async () => {
    // No lease yet: recoveryStatus is 'idle' and there is no owned/unexpired
    // visibility timeout — the update filter must match zero documents.
    await assert.rejects(
      () =>
        setActiveRecoveryReviewItemId({
          jobId: job._id,
          recoveryExecutionId: scope.recoveryExecutionId,
          expectedScope: scope,
          targetManualReviewItemId: scope.manualReviewItemId,
          expectedCurrentActiveReviewItemId: null,
          now: new Date()
        }),
      (err) => {
        assert.ok(err instanceof MultiUnitPaidOrphanRecoveryError);
        assert.equal(err.code, 'RECOVERY_JOB_LEASE_CONFLICT');
        return true;
      }
    );

    const now = new Date('2031-07-01T00:00:00.000Z');
    await acquireInitialMultiUnitRecoveryLease({
      jobId: job._id,
      checkoutId: scope.checkoutId,
      paymentIntentId: scope.paymentIntentId,
      recoveryExecutionId: scope.recoveryExecutionId,
      evidenceDigest: scope.evidenceDigest,
      operatorActorId: 'ops:test-operator',
      operatorIntentConfirmedAt: now,
      recoveryReason: 'Synthetic acceptance lease acquisition for active-review test',
      expectedScope: scope,
      now
    });

    const setA = await setActiveRecoveryReviewItemId({
      jobId: job._id,
      recoveryExecutionId: scope.recoveryExecutionId,
      expectedScope: scope,
      targetManualReviewItemId: scope.manualReviewItemId,
      expectedCurrentActiveReviewItemId: null,
      now
    });
    assert.equal(String(setA.job.activeRecoveryReviewItemId), scope.manualReviewItemId);
    assert.equal(setA.alreadySet, false);

    const foreignTarget = String(fakeObjectId('acc-foreign-review-steal'));
    await assert.rejects(
      () =>
        setActiveRecoveryReviewItemId({
          jobId: job._id,
          recoveryExecutionId: scope.recoveryExecutionId,
          expectedScope: scope,
          targetManualReviewItemId: foreignTarget,
          expectedCurrentActiveReviewItemId: null,
          now
        }),
      (err) => {
        assert.ok(err instanceof MultiUnitPaidOrphanRecoveryError);
        assert.equal(err.code, 'RECOVERY_HOSTILE_STATE_DRIFT');
        return true;
      }
    );
  });

  const stored = await CheckoutFinalizationJob.findById(job._id).lean();
  assert.equal(
    String(stored.activeRecoveryReviewItemId),
    scope.manualReviewItemId,
    'foreign steal attempt must not overwrite the legitimately set active review item'
  );
});

/* ======================================================================== *
 * 11. RECOVERY_UNIT_UNAVAILABLE aliases RECOVERY_TARGET_UNIT_UNAVAILABLE.
 * ======================================================================== */

test('acceptance: RECOVERY_UNIT_UNAVAILABLE aliases RECOVERY_TARGET_UNIT_UNAVAILABLE metadata', () => {
  const aliasEntry = getRecoveryErrorCatalogEntry('RECOVERY_UNIT_UNAVAILABLE');
  const canonicalEntry = getRecoveryErrorCatalogEntry('RECOVERY_TARGET_UNIT_UNAVAILABLE');

  assert.ok(aliasEntry);
  assert.ok(canonicalEntry);
  assert.equal(aliasEntry.permanent, canonicalEntry.permanent);
  assert.equal(aliasEntry.retryable, canonicalEntry.retryable);
  assert.equal(aliasEntry.resumable, canonicalEntry.resumable);
  assert.equal(aliasEntry.summary, canonicalEntry.summary);
  assert.equal(aliasEntry.recoveryStatusEffect, canonicalEntry.recoveryStatusEffect);
  assert.equal(aliasEntry.leaseEffect, canonicalEntry.leaseEffect);
  assert.equal(aliasEntry.reviewHoldEffect, canonicalEntry.reviewHoldEffect);

  // Constructing the error itself must also resolve to the canonical code.
  const constructedFromAlias = new MultiUnitPaidOrphanRecoveryError('RECOVERY_UNIT_UNAVAILABLE');
  assert.equal(constructedFromAlias.summary, canonicalEntry.summary);
  assert.equal(constructedFromAlias.permanent, canonicalEntry.permanent);
});

/* ======================================================================== *
 * 12. Money-safety: recovery service source never calls finalizePaidCheckout(.
 * ======================================================================== */

test('acceptance: recovery service source still never calls finalizePaidCheckout(', () => {
  const servicePath = path.join(
    __dirname,
    '..',
    'services',
    'checkout',
    'multiUnitPaidOrphanRecoveryService.js'
  );
  const source = fs.readFileSync(servicePath, 'utf8');

  assert.doesNotMatch(source, /\bfinalizePaidCheckout\s*\(/);
});
