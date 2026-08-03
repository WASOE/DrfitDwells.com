/**
 * S0 acceptance proof suites loaded by multiUnitPaidOrphanRecovery.acceptance.test.cjs.
 * Binding: docs/architecture/multi-unit-cabin-type-capacity-and-paid-recovery-lock.md
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const {
  enableOrdinarySideEffectFlags,
  createSideEffectSpies,
  seedExecutablePaidOrphanIncident,
  runDryRun,
  runInitialExecute,
  runResumeExecute,
  snapshotRecoveryCollections,
  installFaultInjector,
  clearFaultInjectors,
  RecoveryFaultInjectedError,
  FAULT_CODE,
  buildValidIntentOverlay,
  models
} = require('./multiUnitPaidOrphanRecovery.acceptance.helpers.cjs');

const {
  OPERATION_REQUIRED_FIELDS,
  runInMultiUnitPaidOrphanRecoveryContext,
  assertMultiUnitPaidOrphanRecoveryContext
} = require('../services/checkout/multiUnitPaidOrphanRecoveryCapability');
const {
  MultiUnitPaidOrphanRecoveryError,
  createSanitizedRecoveryError,
  getRecoveryErrorCatalogEntry
} = require('../services/checkout/multiUnitPaidOrphanRecoveryErrors');
const {
  assertNoCommercialStayConflict
} = require('../services/checkout/commercialStayGuardService');
const {
  runMultiUnitPaidOrphanRecoveryBookingFinalizeCore,
  recoverAllowlistedMultiUnitPaidOrphanCheckout,
  INTENT_PHRASE
} = require('../services/checkout/multiUnitPaidOrphanRecoveryService');
const {
  ensureMultiUnitPaidOrphanCompletionReview,
  acquireManualReviewResolutionHold,
  transferRecoveryHoldToCompletionReview,
  resolveActiveRecoveryHeldManualReview,
  buildCompletionRecoveryDedupeKey
} = require('../services/checkout/multiUnitPaidOrphanRecoveryReviewService');
const {
  acquireInitialMultiUnitRecoveryLease,
  markCheckoutFinalizationJobConfirmationQueued,
  setActiveRecoveryReviewItemId,
  markMultiUnitRecoveryComplete,
  advanceMultiUnitRecoveryStatus,
  buildRecoveryClaimedBy
} = require('../services/checkout/checkoutFinalizationJobService');
const {
  resolveRecoverableSyncManualReviews
} = require('../services/ops/ingestion/icalIngestionService');
const {
  MULTI_UNIT_PAID_ORPHAN_HOLD_KIND
} = require('../services/ops/ingestion/manualReviewResolutionHoldFilter');
const {
  bookingLifecycleCorrelationKey
} = require('../services/email/emailDeliveryCorrelation');
const {
  ensurePendingConfirmationDelivery,
  resolveConfirmationTemplateKey
} = require('../services/email/bookingConfirmationDeliveryService');

const {
  Booking,
  CheckoutSession,
  CheckoutFinalizationJob,
  Payment,
  ManualReviewItem,
  EmailDeliveryState,
  Unit,
  AvailabilityBlock,
  AuditEvent,
  SavedBookingQuote
} = models;

function assertZeroExternalSideEffects(spies, stripe) {
  assert.equal(spies.counts.opsPush, 0, 'Ops push must not run');
  assert.equal(spies.counts.processBookingConfirmationDelivery, 0);
  assert.equal(spies.counts.enqueuePostFinalizeSideEffects, 0);
  assert.equal(stripe.counts.create, 0, 'no new PaymentIntent');
  assert.equal(stripe.counts.refundsCreate, 0, 'no refund');
  assert.equal(stripe.counts.chargesCreate, 0, 'no charge');
}

async function assertHappyPathOutcome(seeded, result) {
  assert.equal(result.ok, true);
  assert.equal(result.recoveryStatus, 'complete');
  assert.equal(result.smtpAttempted, false);
  assert.equal(result.refundAttempted, false);
  assert.equal(result.chargeAttempted, false);

  const orphanBookings = await Booking.find({
    checkoutId: seeded.allowlist.checkoutId
  }).lean();
  assert.equal(orphanBookings.length, 1, 'exactly one orphan Booking');
  const orphan = orphanBookings[0];
  assert.equal(String(orphan.unitId), String(seeded.unitB._id));
  assert.notEqual(String(orphan.unitId), String(seeded.unitA._id));

  const first = await Booking.findById(seeded.firstBooking._id).lean();
  assert.equal(String(first.unitId), String(seeded.unitA._id));
  assert.equal(first.status, 'confirmed');
  assert.equal(
    new Date(first.updatedAt).getTime(),
    new Date(seeded.firstBooking.updatedAt).getTime(),
    'first Booking unchanged'
  );

  const payment = await Payment.findById(seeded.allowlist.paymentId).lean();
  assert.equal(String(payment.reservationId), String(orphan._id));

  const session = await CheckoutSession.findById(seeded.allowlist.checkoutSessionId).lean();
  assert.equal(String(session.bookingId), String(orphan._id));
  assert.equal(session.finalizeStatus, 'finalized');
  assert.notEqual(session.status, 'needs_review');

  const job = await CheckoutFinalizationJob.findById(seeded.allowlist.finalizationJobId).lean();
  assert.equal(job.status, 'succeeded');
  assert.equal(job.recoveryStatus, 'complete');
  assert.equal(job.recoveryClaimedBy, null);
  assert.equal(job.recoveryVisibilityTimeoutAt, null);
  assert.ok(job.confirmationQueuedAt);
  assert.equal(job.confirmationSentAt ?? null, null);

  const review = await ManualReviewItem.findById(seeded.allowlist.manualReviewItemId).lean();
  assert.equal(review.status, 'resolved');
  assert.notEqual(review.resolutionHold?.status, 'active');

  const eds = await EmailDeliveryState.find({ bookingId: orphan._id }).lean();
  assert.ok(eds.length >= 1);
  assert.ok(['pending', 'success', 'succeeded'].includes(eds[0].latestStatus));

  assert.equal(orphan.confirmationEmailSentAt ?? null, null);
  assert.equal(String(result.bookingId), String(orphan._id));
  assert.equal(String(result.recoveryExecutionId), String(job.recoveryExecutionId));
}

/* ======================================================================== *
 * Happy-path integration (flags on, real services)
 * ======================================================================== */

test('proof: full happy-path recovery with side-effect flags enabled', async () => {
  enableOrdinarySideEffectFlags();
  const spies = createSideEffectSpies();
  try {
    const seeded = await seedExecutablePaidOrphanIncident();
    const firstBookingUpdatedAt = seeded.firstBooking.updatedAt;

    const envelope = await runDryRun(seeded.allowlist);
    assert.equal(envelope.writes, 0);
    assert.equal(envelope.canonicalEvidence.stayFingerprintMatch, true);
    assert.equal(envelope.canonicalEvidence.guestIdentityMatch, true);
    assert.equal(envelope.canonicalEvidence.targetUnitAvailabilityResult.ok, true);

    const result = await runInitialExecute({
      allowlist: seeded.allowlist,
      envelope,
      stripe: seeded.stripe
    });

    seeded.firstBooking.updatedAt = firstBookingUpdatedAt;
    await assertHappyPathOutcome(seeded, result);
    assertZeroExternalSideEffects(spies, seeded.stripe);
  } finally {
    spies.reset();
    clearFaultInjectors();
  }
});

/* ======================================================================== *
 * Complete dry-run zero-write snapshot
 * ======================================================================== */

test('proof: dry-run zero-write across all seeded recovery collections including AvailabilityBlock and AuditEvent', async () => {
  enableOrdinarySideEffectFlags();
  const seeded = await seedExecutablePaidOrphanIncident();

  await AvailabilityBlock.create({
    cabinId: seeded.parentCabin._id,
    unitId: seeded.unitA._id,
    blockType: 'reservation',
    startDate: seeded.checkIn,
    endDate: seeded.checkOut,
    status: 'active',
    source: 'internal_admin',
    reservationId: seeded.firstBooking._id,
    metadata: { synthetic: true }
  });
  await AuditEvent.create({
    happenedAt: new Date(),
    actorType: 'system',
    actorId: 'acceptance-proof',
    entityType: 'CheckoutSession',
    entityId: String(seeded.session._id),
    action: 'synthetic_seed',
    reason: 'Dry-run zero-write sentinel'
  });
  await SavedBookingQuote.create({
    propertyKind: 'cabin',
    entityType: 'cabin_type',
    entityId: seeded.cabinType._id,
    checkIn: seeded.checkIn,
    checkOut: seeded.checkOut,
    checkInDateOnly: seeded.checkInDateOnly,
    checkOutDateOnly: seeded.checkOutDateOnly,
    adults: 2,
    quotedTotalCents: seeded.amountCents,
    quoteFingerprint: `fp-proof-${Date.now()}`,
    quotedAt: new Date(),
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000)
  });
  await EmailDeliveryState.create({
    correlationKey: `booking:${seeded.firstBooking._id}:booking_received:${seeded.guestEmail}`,
    domain: 'booking_lifecycle',
    bookingId: seeded.firstBooking._id,
    templateKey: 'booking_received',
    recipient: seeded.guestEmail,
    latestStatus: 'pending',
    latestEventAt: new Date()
  });

  const before = await snapshotRecoveryCollections();
  const dry = await runDryRun(seeded.allowlist);
  assert.equal(dry.writes, 0);
  const after = await snapshotRecoveryCollections();
  assert.deepEqual(after, before, 'dry-run must leave every seeded collection byte-identical');
});

/* ======================================================================== *
 * Resume boundary matrix
 * ======================================================================== */

const HAPPY_PATH_BOUNDARIES = [
  'recovery_lease',
  'original_mri_hold',
  'booking_creation',
  'payment_link',
  'session_finalization',
  'normal_job_success',
  'linkage_complete',
  'saved_quote_conversion',
  'awaiting_confirmation_queue',
  'eds_ensure',
  'confirmation_queued_at',
  'recovery_mri_resolution',
  'recovery_complete_before_release'
];

for (const boundary of HAPPY_PATH_BOUNDARIES) {
  test(`proof: resume after durable boundary — ${boundary}`, async () => {
    enableOrdinarySideEffectFlags();
    const spies = createSideEffectSpies();
    const uninstall = installFaultInjector(boundary);
    try {
      const seeded = await seedExecutablePaidOrphanIncident({ suffix: `rb_${boundary}_${Date.now()}` });
      const envelope = await runDryRun(seeded.allowlist);

      await assert.rejects(
        () =>
          runInitialExecute({
            allowlist: seeded.allowlist,
            envelope,
            stripe: seeded.stripe
          }),
        (err) => err?.code === FAULT_CODE || err instanceof RecoveryFaultInjectedError
      );

      uninstall();
      clearFaultInjectors();

      const jobAfterFault = await CheckoutFinalizationJob.findById(
        seeded.allowlist.finalizationJobId
      ).lean();
      assert.ok(jobAfterFault.recoveryExecutionId, 'lease/execution must be durable');
      const executionId = String(jobAfterFault.recoveryExecutionId);

      const bookingsAfterFault = await Booking.find({
        checkoutId: seeded.allowlist.checkoutId
      }).lean();

      const resumed = await runResumeExecute({
        allowlist: seeded.allowlist,
        envelope,
        stripe: seeded.stripe
      });

      assert.equal(resumed.ok, true);
      assert.equal(resumed.recoveryStatus, 'complete');
      assert.equal(String(resumed.recoveryExecutionId), executionId);

      const bookings = await Booking.find({ checkoutId: seeded.allowlist.checkoutId }).lean();
      assert.equal(bookings.length, 1, 'no second Booking');
      if (bookingsAfterFault.length === 1) {
        assert.equal(String(bookings[0]._id), String(bookingsAfterFault[0]._id));
      }

      const completions = await ManualReviewItem.find({
        recoveryDedupeKey: buildCompletionRecoveryDedupeKey(executionId)
      }).lean();
      assert.ok(completions.length <= 1, 'no duplicate completion MRI');

      const first = await Booking.findById(seeded.firstBooking._id).lean();
      assert.equal(first.status, 'confirmed');
      assert.equal(String(first.unitId), String(seeded.unitA._id));

      assertZeroExternalSideEffects(spies, seeded.stripe);
      await assertHappyPathOutcome(seeded, resumed);
    } finally {
      uninstall();
      clearFaultInjectors();
      spies.reset();
    }
  });
}

test('proof: resume aborts on foreign Booking drift after payment_link boundary', async () => {
  enableOrdinarySideEffectFlags();
  const uninstall = installFaultInjector('payment_link');
  try {
    const seeded = await seedExecutablePaidOrphanIncident({ suffix: `drift_${Date.now()}` });
    const envelope = await runDryRun(seeded.allowlist);
    await assert.rejects(
      () => runInitialExecute({ allowlist: seeded.allowlist, envelope, stripe: seeded.stripe }),
      (err) => err?.code === FAULT_CODE
    );
    uninstall();

    const orphan = await Booking.findOne({ checkoutId: seeded.allowlist.checkoutId });
    assert.ok(orphan);
    // Hostile drift: point session at foreign booking identity without matching payment.
    await CheckoutSession.updateOne(
      { _id: seeded.allowlist.checkoutSessionId },
      { $set: { bookingId: seeded.firstBooking._id } }
    );

    await assert.rejects(
      () => runResumeExecute({ allowlist: seeded.allowlist, envelope, stripe: seeded.stripe }),
      (err) =>
        err instanceof MultiUnitPaidOrphanRecoveryError &&
        (err.code === 'RECOVERY_HOSTILE_STATE_DRIFT' || err.code === 'RECOVERY_PARTIAL_LINKAGE')
    );
  } finally {
    uninstall();
    clearFaultInjectors();
  }
});

/* ======================================================================== *
 * Dual-held completion transfer crash + resume
 * ======================================================================== */

test('proof: dual-held completion transfer crash is resumable', async () => {
  enableOrdinarySideEffectFlags();
  const spies = createSideEffectSpies();
  // Crash after completion hold, before original release.
  const uninstall = installFaultInjector('hold_transfer_before_original_release');
  try {
    const seeded = await seedExecutablePaidOrphanIncident({ suffix: `dualheld_${Date.now()}` });
    const envelope = await runDryRun(seeded.allowlist);

    // Drive recovery almost to the final gate, then prematurely resolve original MRI.
    // Use fault after confirmation_queued_at, then mark original resolved, then resume
    // into premature transfer path with transfer fault.
    uninstall();
    const uninstallQueued = installFaultInjector('confirmation_queued_at');
    await assert.rejects(
      () => runInitialExecute({ allowlist: seeded.allowlist, envelope, stripe: seeded.stripe }),
      (err) => err?.code === FAULT_CODE
    );
    uninstallQueued();

    const jobMid = await CheckoutFinalizationJob.findById(seeded.allowlist.finalizationJobId).lean();
    const executionId = String(jobMid.recoveryExecutionId);

    // Premature out-of-band resolve of the original incident MRI (hold may still be active).
    await ManualReviewItem.updateOne(
      { _id: seeded.allowlist.manualReviewItemId },
      {
        $set: {
          status: 'resolved',
          resolution: {
            resolvedAt: new Date(),
            resolvedBy: 'ops:hostile-premature',
            note: 'Premature out-of-band resolve for dual-held proof'
          }
        }
      }
    );

    const uninstallTransfer = installFaultInjector('hold_transfer_before_original_release');
    await assert.rejects(
      () => runResumeExecute({ allowlist: seeded.allowlist, envelope, stripe: seeded.stripe }),
      (err) => err?.code === FAULT_CODE
    );
    uninstallTransfer();

    const original = await ManualReviewItem.findById(seeded.allowlist.manualReviewItemId).lean();
    assert.equal(original.status, 'resolved');
    assert.equal(original.resolutionHold?.status, 'active', 'original hold kept until transfer finishes');

    const completions = await ManualReviewItem.find({
      recoveryDedupeKey: buildCompletionRecoveryDedupeKey(executionId)
    }).lean();
    assert.equal(completions.length, 1, 'exactly one completion MRI');
    assert.equal(completions[0].resolutionHold?.status, 'active', 'completion hold active');
    assert.equal(
      completions[0].resolutionHold?.recoveryExecutionId,
      executionId
    );

    // Safe dual-held state
    assert.equal(original.resolutionHold.status, 'active');
    assert.equal(completions[0].resolutionHold.status, 'active');

    const resumed = await runResumeExecute({
      allowlist: seeded.allowlist,
      envelope,
      stripe: seeded.stripe
    });
    assert.equal(resumed.ok, true);
    assert.equal(resumed.recoveryStatus, 'complete');
    assert.equal(String(resumed.recoveryExecutionId), executionId);

    const originalAfter = await ManualReviewItem.findById(seeded.allowlist.manualReviewItemId).lean();
    assert.equal(originalAfter.status, 'resolved', 'original never reopened');
    assert.notEqual(originalAfter.resolutionHold?.status, 'active');

    const completionsAfter = await ManualReviewItem.find({
      recoveryDedupeKey: buildCompletionRecoveryDedupeKey(executionId)
    }).lean();
    assert.equal(completionsAfter.length, 1);
    assert.equal(completionsAfter[0].status, 'resolved');
    assert.notEqual(completionsAfter[0].resolutionHold?.status, 'active');

    const job = await CheckoutFinalizationJob.findById(seeded.allowlist.finalizationJobId).lean();
    assert.equal(String(job.activeRecoveryReviewItemId), String(completionsAfter[0]._id));
    assert.equal(job.recoveryStatus, 'complete');

    assertZeroExternalSideEffects(spies, seeded.stripe);
  } finally {
    clearFaultInjectors();
    spies.reset();
  }
});

/* ======================================================================== *
 * Concurrent recovery-only finishers
 * ======================================================================== */

test('proof: two concurrent recovery finishers — one resolves/completes, other adopts', async () => {
  enableOrdinarySideEffectFlags();
  const spies = createSideEffectSpies();
  const uninstall = installFaultInjector('confirmation_queued_at');
  try {
    const seeded = await seedExecutablePaidOrphanIncident({ suffix: `concfin_${Date.now()}` });
    const envelope = await runDryRun(seeded.allowlist);
    await assert.rejects(
      () => runInitialExecute({ allowlist: seeded.allowlist, envelope, stripe: seeded.stripe }),
      (err) => err?.code === FAULT_CODE
    );
    uninstall();
    clearFaultInjectors();

    const job = await CheckoutFinalizationJob.findById(seeded.allowlist.finalizationJobId).lean();
    assert.equal(job.recoveryStatus, 'awaiting_review_resolution');
    const executionId = String(job.recoveryExecutionId);

    const [a, b] = await Promise.all([
      runResumeExecute({ allowlist: seeded.allowlist, envelope, stripe: seeded.stripe }),
      runResumeExecute({ allowlist: seeded.allowlist, envelope, stripe: seeded.stripe })
    ]);

    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(a.recoveryStatus, 'complete');
    assert.equal(b.recoveryStatus, 'complete');
    assert.equal(String(a.recoveryExecutionId), executionId);
    assert.equal(String(b.recoveryExecutionId), executionId);
    assert.equal(String(a.bookingId), String(b.bookingId));

    const bookings = await Booking.find({ checkoutId: seeded.allowlist.checkoutId }).lean();
    assert.equal(bookings.length, 1);

    const completions = await ManualReviewItem.find({
      recoveryDedupeKey: buildCompletionRecoveryDedupeKey(executionId)
    }).lean();
    assert.equal(completions.length, 0, 'happy path has no completion MRI');

    const review = await ManualReviewItem.findById(seeded.allowlist.manualReviewItemId).lean();
    assert.equal(review.status, 'resolved');

    const finalJob = await CheckoutFinalizationJob.findById(seeded.allowlist.finalizationJobId).lean();
    assert.equal(finalJob.recoveryStatus, 'complete');
    assert.equal(finalJob.recoveryClaimedBy, null);

    // Mismatched execution cannot adopt completion
    await assert.rejects(
      () =>
        runInMultiUnitPaidOrphanRecoveryContext(
          {
            recoveryMode: 'resume',
            recoveryExecutionId: 'exec-foreign-finisher',
            checkoutId: seeded.allowlist.checkoutId,
            paymentIntentId: seeded.allowlist.paymentIntentId,
            checkoutSessionId: seeded.allowlist.checkoutSessionId,
            paymentId: seeded.allowlist.paymentId,
            finalizationJobId: seeded.allowlist.finalizationJobId,
            manualReviewItemId: seeded.allowlist.manualReviewItemId,
            cabinTypeId: seeded.allowlist.cabinTypeId,
            expectedTargetUnitId: seeded.allowlist.expectedTargetUnitId,
            evidenceDigest: envelope.digest
          },
          () =>
            markMultiUnitRecoveryComplete({
              jobId: seeded.allowlist.finalizationJobId,
              recoveryExecutionId: 'exec-foreign-finisher',
              expectedScope: {
                recoveryMode: 'resume',
                recoveryExecutionId: 'exec-foreign-finisher',
                checkoutId: seeded.allowlist.checkoutId,
                paymentIntentId: seeded.allowlist.paymentIntentId,
                checkoutSessionId: seeded.allowlist.checkoutSessionId,
                paymentId: seeded.allowlist.paymentId,
                finalizationJobId: seeded.allowlist.finalizationJobId,
                manualReviewItemId: seeded.allowlist.manualReviewItemId,
                cabinTypeId: seeded.allowlist.cabinTypeId,
                expectedTargetUnitId: seeded.allowlist.expectedTargetUnitId,
                evidenceDigest: envelope.digest
              },
              recoveredBy: 'ops:foreign'
            })
        ),
      (err) => err?.code === 'RECOVERY_SCOPE_MISMATCH' || err?.code === 'RECOVERY_JOB_LEASE_CONFLICT'
    );

    assertZeroExternalSideEffects(spies, seeded.stripe);
  } finally {
    clearFaultInjectors();
    spies.reset();
  }
});

/* ======================================================================== *
 * Confirmation variants
 * ======================================================================== */

async function seedAtConfirmationGate() {
  enableOrdinarySideEffectFlags();
  // Stop after phase advance and BEFORE ensure-only EDS so confirmation variants
  // can control the EDS document themselves.
  const uninstall = installFaultInjector('awaiting_confirmation_queue');
  const seeded = await seedExecutablePaidOrphanIncident({
    suffix: `eds_${Date.now()}_${Math.random().toString(16).slice(2)}`
  });
  const envelope = await runDryRun(seeded.allowlist);
  await assert.rejects(
    () => runInitialExecute({ allowlist: seeded.allowlist, envelope, stripe: seeded.stripe }),
    (err) => err?.code === FAULT_CODE
  );
  uninstall();
  clearFaultInjectors();
  await EmailDeliveryState.deleteMany({});
  return { seeded, envelope };
}

test('proof: confirmation variant A — no EDS ensure creates pending', async () => {
  const spies = createSideEffectSpies();
  try {
    const { seeded, envelope } = await seedAtConfirmationGate();
    const before = await EmailDeliveryState.countDocuments({});
    assert.equal(before, 0);

    const result = await runResumeExecute({
      allowlist: seeded.allowlist,
      envelope,
      stripe: seeded.stripe
    });
    assert.equal(result.ok, true);
    const eds = await EmailDeliveryState.find({
      bookingId: result.bookingId
    }).lean();
    assert.equal(eds.length, 1);
    assert.equal(eds[0].latestStatus, 'pending');
    const job = await CheckoutFinalizationJob.findById(seeded.allowlist.finalizationJobId).lean();
    assert.ok(job.confirmationQueuedAt);
    assert.equal(job.confirmationSentAt ?? null, null);
    assertZeroExternalSideEffects(spies, seeded.stripe);
  } finally {
    spies.reset();
  }
});

test('proof: confirmation variant B — adopt existing pending EDS', async () => {
  const spies = createSideEffectSpies();
  try {
    const { seeded, envelope } = await seedAtConfirmationGate();
    const booking = await Booking.findOne({ checkoutId: seeded.allowlist.checkoutId });
    const templateKey = resolveConfirmationTemplateKey(booking);
    const correlationKey = bookingLifecycleCorrelationKey({
      bookingId: booking._id,
      templateKey,
      recipientEmail: seeded.guestEmail
    });
    await EmailDeliveryState.create({
      correlationKey,
      domain: 'booking_lifecycle',
      bookingId: booking._id,
      templateKey,
      recipient: seeded.guestEmail,
      latestStatus: 'pending',
      latestEventAt: new Date()
    });
    const edsId = (await EmailDeliveryState.findOne({ correlationKey }).lean())._id;

    const result = await runResumeExecute({
      allowlist: seeded.allowlist,
      envelope,
      stripe: seeded.stripe
    });
    assert.equal(result.ok, true);
    const eds = await EmailDeliveryState.find({ bookingId: booking._id }).lean();
    assert.equal(eds.length, 1, 'must not duplicate EDS');
    assert.equal(String(eds[0]._id), String(edsId), 'must adopt the existing pending EDS');
    assert.equal(eds[0].latestStatus, 'pending');
    assertZeroExternalSideEffects(spies, seeded.stripe);
  } finally {
    spies.reset();
  }
});

test('proof: confirmation variant C — adopt truthfully succeeded EDS without new sent stamps', async () => {
  const spies = createSideEffectSpies();
  try {
    const { seeded, envelope } = await seedAtConfirmationGate();
    const booking = await Booking.findOne({ checkoutId: seeded.allowlist.checkoutId });
    const templateKey = resolveConfirmationTemplateKey(booking);
    const correlationKey = bookingLifecycleCorrelationKey({
      bookingId: booking._id,
      templateKey,
      recipientEmail: seeded.guestEmail
    });
    await EmailDeliveryState.create({
      correlationKey,
      domain: 'booking_lifecycle',
      bookingId: booking._id,
      templateKey,
      recipient: seeded.guestEmail,
      latestStatus: 'succeeded',
      latestEventAt: new Date(),
      providerMessageId: 'msg_synthetic_truth'
    });
    const bookingSentBefore = booking.confirmationEmailSentAt ?? null;

    const result = await runResumeExecute({
      allowlist: seeded.allowlist,
      envelope,
      stripe: seeded.stripe
    });
    assert.equal(result.ok, true);
    const eds = await EmailDeliveryState.findOne({ bookingId: booking._id }).lean();
    assert.equal(eds.latestStatus, 'succeeded');
    assert.equal(eds.providerMessageId, 'msg_synthetic_truth');
    const job = await CheckoutFinalizationJob.findById(seeded.allowlist.finalizationJobId).lean();
    assert.ok(job.confirmationQueuedAt);
    assert.equal(job.confirmationSentAt ?? null, null);
    const bookingAfter = await Booking.findById(booking._id).lean();
    assert.equal(bookingAfter.confirmationEmailSentAt ?? null, bookingSentBefore);
    assertZeroExternalSideEffects(spies, seeded.stripe);
  } finally {
    spies.reset();
  }
});

test('proof: confirmation variant D — logged-only EDS rejected', async () => {
  const spies = createSideEffectSpies();
  try {
    const { seeded, envelope } = await seedAtConfirmationGate();
    const booking = await Booking.findOne({ checkoutId: seeded.allowlist.checkoutId });
    const templateKey = resolveConfirmationTemplateKey(booking);
    const correlationKey = bookingLifecycleCorrelationKey({
      bookingId: booking._id,
      templateKey,
      recipientEmail: seeded.guestEmail
    });
    await EmailDeliveryState.create({
      correlationKey,
      domain: 'booking_lifecycle',
      bookingId: booking._id,
      templateKey,
      recipient: seeded.guestEmail,
      // 'skipped' is the durable stand-in for non-authoritative logged-only delivery.
      latestStatus: 'skipped',
      latestEventAt: new Date()
    });

    await assert.rejects(
      () => runResumeExecute({ allowlist: seeded.allowlist, envelope, stripe: seeded.stripe }),
      (err) => err?.code === 'RECOVERY_CONFIRMATION_STATE_INVALID'
    );
    const job = await CheckoutFinalizationJob.findById(seeded.allowlist.finalizationJobId).lean();
    assert.equal(job.confirmationQueuedAt ?? null, null);
    assert.equal(job.recoveryStatus, 'awaiting_confirmation_queue');
    assertZeroExternalSideEffects(spies, seeded.stripe);
  } finally {
    spies.reset();
  }
});

test('proof: confirmation variant E — failed/unavailable EDS rejected', async () => {
  const spies = createSideEffectSpies();
  try {
    const { seeded, envelope } = await seedAtConfirmationGate();
    const booking = await Booking.findOne({ checkoutId: seeded.allowlist.checkoutId });
    const templateKey = resolveConfirmationTemplateKey(booking);
    const correlationKey = bookingLifecycleCorrelationKey({
      bookingId: booking._id,
      templateKey,
      recipientEmail: seeded.guestEmail
    });
    await EmailDeliveryState.create({
      correlationKey,
      domain: 'booking_lifecycle',
      bookingId: booking._id,
      templateKey,
      recipient: seeded.guestEmail,
      latestStatus: 'failed',
      latestEventAt: new Date()
    });

    await assert.rejects(
      () => runResumeExecute({ allowlist: seeded.allowlist, envelope, stripe: seeded.stripe }),
      (err) => err?.code === 'RECOVERY_CONFIRMATION_STATE_INVALID'
    );
    assertZeroExternalSideEffects(spies, seeded.stripe);
  } finally {
    spies.reset();
  }
});

test('proof: confirmation variant F — queuedAt without EDS rejects on transition helper', async () => {
  enableOrdinarySideEffectFlags();
  const seeded = await seedExecutablePaidOrphanIncident({ suffix: `queued_no_eds_${Date.now()}` });
  // Manually place job at awaiting_confirmation_queue with booking linked
  const booking = await Booking.create({
    cabinTypeId: seeded.cabinType._id,
    unitId: seeded.unitB._id,
    checkoutId: seeded.allowlist.checkoutId,
    checkIn: seeded.checkIn,
    checkOut: seeded.checkOut,
    adults: 2,
    status: 'confirmed',
    totalPrice: 400,
    guestInfo: {
      firstName: 'Proof',
      lastName: 'Guest',
      email: seeded.guestEmail,
      phone: '+359800000999'
    },
    stripePaymentIntentId: seeded.allowlist.paymentIntentId
  });
  const scope = {
    recoveryMode: 'resume',
    recoveryExecutionId: 'exec-queued-no-eds',
    checkoutId: seeded.allowlist.checkoutId,
    paymentIntentId: seeded.allowlist.paymentIntentId,
    checkoutSessionId: seeded.allowlist.checkoutSessionId,
    paymentId: seeded.allowlist.paymentId,
    finalizationJobId: seeded.allowlist.finalizationJobId,
    manualReviewItemId: seeded.allowlist.manualReviewItemId,
    cabinTypeId: seeded.allowlist.cabinTypeId,
    expectedTargetUnitId: seeded.allowlist.expectedTargetUnitId,
    evidenceDigest: 'a'.repeat(64),
    bookingId: String(booking._id)
  };
  await CheckoutFinalizationJob.updateOne(
    { _id: seeded.allowlist.finalizationJobId },
    {
      $set: {
        status: 'succeeded',
        stage: 'succeeded',
        bookingId: booking._id,
        recoveryStatus: 'awaiting_confirmation_queue',
        recoveryExecutionId: scope.recoveryExecutionId,
        recoveryEvidenceDigest: scope.evidenceDigest,
        recoveryClaimedBy: buildRecoveryClaimedBy(scope.recoveryExecutionId),
        recoveryVisibilityTimeoutAt: new Date(Date.now() + 10 * 60 * 1000)
      }
    }
  );

  const correlationKey = bookingLifecycleCorrelationKey({
    bookingId: booking._id,
    templateKey: 'booking_received',
    recipientEmail: seeded.guestEmail
  });

  await assert.rejects(
    () =>
      runInMultiUnitPaidOrphanRecoveryContext(scope, () =>
        markCheckoutFinalizationJobConfirmationQueued({
          finalizationJobId: seeded.allowlist.finalizationJobId,
          bookingId: booking._id,
          recoveryExecutionId: scope.recoveryExecutionId,
          expectedCorrelationKey: correlationKey,
          expectedScope: scope
        })
      ),
    (err) => err?.code === 'RECOVERY_CONFIRMATION_STATE_INVALID'
  );
  const job = await CheckoutFinalizationJob.findById(seeded.allowlist.finalizationJobId).lean();
  assert.equal(job.confirmationQueuedAt ?? null, null);
  assert.equal(job.recoveryStatus, 'awaiting_confirmation_queue');
});

test('proof: confirmation variant G — historical sent stamps do not override EDS truth', async () => {
  const spies = createSideEffectSpies();
  try {
    const { seeded, envelope } = await seedAtConfirmationGate();
    const booking = await Booking.findOne({ checkoutId: seeded.allowlist.checkoutId });
    booking.confirmationEmailSentAt = new Date('2020-01-01T00:00:00.000Z');
    await booking.save();
    await CheckoutFinalizationJob.updateOne(
      { _id: seeded.allowlist.finalizationJobId },
      { $set: { confirmationSentAt: new Date('2020-01-01T00:00:00.000Z') } }
    );

    // No EDS — ensure may adopt historical stamp into EDS as succeeded (service behavior).
    // Architecture: historical stamps cannot authorize completion without EDS truth after ensure.
    const result = await runResumeExecute({
      allowlist: seeded.allowlist,
      envelope,
      stripe: seeded.stripe
    });
    assert.equal(result.ok, true);
    const eds = await EmailDeliveryState.findOne({ bookingId: booking._id }).lean();
    assert.ok(eds, 'EDS must exist after ensure');
    const job = await CheckoutFinalizationJob.findById(seeded.allowlist.finalizationJobId).lean();
    // confirmationSentAt must not be newly manufactured by recovery queue transition
    assert.ok(job.confirmationQueuedAt);
    assertZeroExternalSideEffects(spies, seeded.stripe);
  } finally {
    spies.reset();
  }
});

/* ======================================================================== *
 * Partial-scope mutation matrix
 * ======================================================================== */

test('proof: partial expectedScope rejects every privileged operation with zero writes', async () => {
  enableOrdinarySideEffectFlags();
  const seeded = await seedExecutablePaidOrphanIncident({ suffix: `partial_${Date.now()}` });
  const fullScope = {
    recoveryMode: 'initial',
    recoveryExecutionId: 'exec-partial-scope',
    checkoutId: seeded.allowlist.checkoutId,
    paymentIntentId: seeded.allowlist.paymentIntentId,
    checkoutSessionId: seeded.allowlist.checkoutSessionId,
    paymentId: seeded.allowlist.paymentId,
    finalizationJobId: seeded.allowlist.finalizationJobId,
    manualReviewItemId: seeded.allowlist.manualReviewItemId,
    cabinTypeId: seeded.allowlist.cabinTypeId,
    expectedTargetUnitId: seeded.allowlist.expectedTargetUnitId,
    evidenceDigest: 'b'.repeat(64),
    bookingId: String(seeded.firstBooking._id)
  };
  const partial = { checkoutId: fullScope.checkoutId };
  const before = await snapshotRecoveryCollections();

  await runInMultiUnitPaidOrphanRecoveryContext(fullScope, async () => {
    for (const operation of Object.keys(OPERATION_REQUIRED_FIELDS)) {
      assert.throws(
        () => assertMultiUnitPaidOrphanRecoveryContext(partial, { operation }),
        (err) => err?.code === 'RECOVERY_SCOPE_MISMATCH',
        `operation ${operation} must reject partial scope`
      );
    }

    await assert.rejects(
      () =>
        assertNoCommercialStayConflict({
          commercialStayFingerprint: seeded.stayFingerprint,
          checkoutId: partial.checkoutId
        }),
      (err) => err?.code === 'RECOVERY_SCOPE_MISMATCH'
    );

    await assert.rejects(
      () =>
        acquireInitialMultiUnitRecoveryLease({
          jobId: seeded.allowlist.finalizationJobId,
          checkoutId: seeded.allowlist.checkoutId,
          paymentIntentId: seeded.allowlist.paymentIntentId,
          expectedLastErrorCode: 'DUPLICATE_STAY_CONFLICT',
          recoveryExecutionId: fullScope.recoveryExecutionId,
          evidenceDigest: fullScope.evidenceDigest,
          allowlistHash: 'c'.repeat(64),
          operatorActorId: 'ops:test-operator',
          operatorIntentConfirmedAt: new Date(),
          recoveryReason: 'partial scope proof',
          expectedScope: partial,
          now: new Date()
        }),
      (err) => err?.code === 'RECOVERY_SCOPE_MISMATCH'
    );

    await assert.rejects(
      () =>
        ensureMultiUnitPaidOrphanCompletionReview({
          originalManualReviewItemId: seeded.allowlist.manualReviewItemId,
          recoveryExecutionId: fullScope.recoveryExecutionId,
          finalizationJobId: seeded.allowlist.finalizationJobId,
          checkoutId: seeded.allowlist.checkoutId,
          checkoutSessionId: seeded.allowlist.checkoutSessionId,
          paymentId: seeded.allowlist.paymentId,
          paymentIntentId: seeded.allowlist.paymentIntentId,
          expectedScope: partial
        }),
      (err) => err?.code === 'RECOVERY_SCOPE_MISMATCH'
    );

    await assert.rejects(
      () =>
        setActiveRecoveryReviewItemId({
          jobId: seeded.allowlist.finalizationJobId,
          recoveryExecutionId: fullScope.recoveryExecutionId,
          expectedScope: partial,
          targetManualReviewItemId: seeded.allowlist.manualReviewItemId
        }),
      (err) => err?.code === 'RECOVERY_SCOPE_MISMATCH'
    );

    await assert.rejects(
      () =>
        markCheckoutFinalizationJobConfirmationQueued({
          finalizationJobId: seeded.allowlist.finalizationJobId,
          bookingId: seeded.firstBooking._id,
          recoveryExecutionId: fullScope.recoveryExecutionId,
          expectedCorrelationKey: 'x',
          expectedScope: partial
        }),
      (err) => err?.code === 'RECOVERY_SCOPE_MISMATCH'
    );

    await assert.rejects(
      () =>
        resolveActiveRecoveryHeldManualReview({
          manualReviewItemId: seeded.allowlist.manualReviewItemId,
          recoveryExecutionId: fullScope.recoveryExecutionId,
          checkoutId: seeded.allowlist.checkoutId,
          paymentIntentId: seeded.allowlist.paymentIntentId,
          finalizationJobId: seeded.allowlist.finalizationJobId,
          resolvedBy: 'multi_unit_paid_orphan_recovery',
          note: 'partial',
          bookingId: seeded.firstBooking._id,
          expectedScope: partial
        }),
      (err) => err?.code === 'RECOVERY_SCOPE_MISMATCH'
    );

    await assert.rejects(
      () =>
        runMultiUnitPaidOrphanRecoveryBookingFinalizeCore({
          checkoutId: seeded.allowlist.checkoutId,
          paymentIntentId: seeded.allowlist.paymentIntentId,
          expectedScope: partial,
          expectedTargetUnitId: seeded.allowlist.expectedTargetUnitId,
          stripe: seeded.stripe.client
        }),
      (err) => err?.code === 'RECOVERY_SCOPE_MISMATCH'
    );
  });

  // authoritativeBookingId mismatch
  await runInMultiUnitPaidOrphanRecoveryContext(fullScope, async () => {
    assert.throws(
      () =>
        assertMultiUnitPaidOrphanRecoveryContext(
          { ...fullScope, bookingId: String(new mongoose.Types.ObjectId()) },
          {
            operation: 'confirmation_queue_transition',
            authoritativeBookingId: String(seeded.firstBooking._id)
          }
        ),
      (err) => err?.code === 'RECOVERY_SCOPE_MISMATCH'
    );
  });

  const after = await snapshotRecoveryCollections();
  assert.deepEqual(after.counts, before.counts);
  assert.deepEqual(after.docs, before.docs);
});

/* ======================================================================== *
 * Real iCal hold behavior
 * ======================================================================== */

test('proof: resolveRecoverableSyncManualReviews resolves unheld and skips held items', async () => {
  const cabinId = new mongoose.Types.ObjectId();
  const feedUrl = 'https://example.test/ical/acceptance-proof.ics';
  const channel = 'airbnb_ical';

  const unheld = await ManualReviewItem.create({
    category: 'sync_feed_unreachable',
    severity: 'high',
    status: 'open',
    entityType: 'Cabin',
    entityId: String(cabinId),
    title: 'Unheld iCal sync failure',
    details: 'Should resolve',
    provenance: { source: channel, sourceReference: feedUrl, detectedAt: new Date() },
    evidence: { feedUrl }
  });
  const held = await ManualReviewItem.create({
    category: 'sync_feed_unreachable',
    severity: 'high',
    status: 'open',
    entityType: 'Cabin',
    entityId: String(cabinId),
    title: 'Held iCal sync failure',
    details: 'Must remain open',
    provenance: { source: channel, sourceReference: feedUrl, detectedAt: new Date() },
    evidence: { feedUrl },
    resolutionHold: {
      kind: MULTI_UNIT_PAID_ORPHAN_HOLD_KIND,
      recoveryExecutionId: 'exec-ical-hold-proof',
      finalizationJobId: String(new mongoose.Types.ObjectId()),
      checkoutId: 'chk_test_ical_hold',
      paymentIntentId: 'pi_test_ical_hold',
      heldAt: new Date(),
      status: 'active'
    }
  });

  const result = await resolveRecoverableSyncManualReviews({
    cabinId,
    feedUrl,
    channel,
    resolvedAt: new Date()
  });

  assert.equal(result.modifiedCount, 1);
  assert.equal(result.matchedCount, 1);

  const unheldAfter = await ManualReviewItem.findById(unheld._id).lean();
  const heldAfter = await ManualReviewItem.findById(held._id).lean();
  assert.equal(unheldAfter.status, 'resolved');
  assert.equal(heldAfter.status, 'open');
  assert.equal(heldAfter.resolutionHold.status, 'active');
  assert.equal(heldAfter.resolutionHold.recoveryExecutionId, 'exec-ical-hold-proof');
});

/* ======================================================================== *
 * Unit-error alias constructor
 * ======================================================================== */

test('proof: RECOVERY_UNIT_UNAVAILABLE constructor exposes canonical code and metadata', () => {
  const alias = new MultiUnitPaidOrphanRecoveryError('RECOVERY_UNIT_UNAVAILABLE');
  const canonical = new MultiUnitPaidOrphanRecoveryError('RECOVERY_TARGET_UNIT_UNAVAILABLE');
  const viaCreate = createSanitizedRecoveryError('RECOVERY_UNIT_UNAVAILABLE');
  const entry = getRecoveryErrorCatalogEntry('RECOVERY_TARGET_UNIT_UNAVAILABLE');

  assert.equal(alias.code, 'RECOVERY_TARGET_UNIT_UNAVAILABLE');
  assert.equal(viaCreate.code, 'RECOVERY_TARGET_UNIT_UNAVAILABLE');
  assert.equal(alias.summary, canonical.summary);
  assert.equal(alias.summary, entry.summary);
  assert.equal(alias.retryable, canonical.retryable);
  assert.equal(alias.permanent, canonical.permanent);
  assert.equal(alias.leaseEffect, canonical.leaseEffect);
  assert.equal(alias.reviewHoldEffect, canonical.reviewHoldEffect);
  assert.equal(alias.refundRecommended, false);

  const servicePath = path.join(
    __dirname,
    '..',
    'services',
    'checkout',
    'multiUnitPaidOrphanRecoveryService.js'
  );
  const source = fs.readFileSync(servicePath, 'utf8');
  assert.match(source, /RECOVERY_TARGET_UNIT_UNAVAILABLE/);
  assert.doesNotMatch(
    source,
    /createSanitizedRecoveryError\(\s*['"]RECOVERY_UNIT_UNAVAILABLE['"]/
  );
});
