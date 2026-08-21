/**
 * S0 multi-unit paid-orphan recovery — main acceptance tests.
 * Binding: docs/architecture/multi-unit-cabin-type-capacity-and-paid-recovery-lock.md
 *
 * Covers (grouped to match architecture concerns):
 *   A. Dry-run / digest determinism, envelope invariants, zero-write guarantee.
 *   B. Atomic manual-review resolution hold filters (ordinary writers excluded
 *      from resolving a recovery-held review).
 *   C. Completion ManualReviewItem create/adopt/conflict semantics.
 *   D. Capability-gated lease + confirmation-queue helpers (ALS context).
 *   E. Side-effect-free finalize seam (source inspection).
 *   F. Money-safety assertions (CLI source + error taxonomy).
 *   G. Feature flag defaults.
 *
 * Only fake/synthetic IDs are used (24-hex ObjectId-shaped strings derived
 * from md5 of a label, and fake provider ids like `chk_test_orphan_001` /
 * `pi_test_orphan_001`). No production identifiers.
 *
 * Run:
 *   node --test --test-concurrency=1 server/scripts/multiUnitPaidOrphanRecovery.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const CheckoutSession = require('../models/CheckoutSession');
const CheckoutFinalizationJob = require('../models/CheckoutFinalizationJob');
const Payment = require('../models/Payment');
const ManualReviewItem = require('../models/ManualReviewItem');
const Unit = require('../models/Unit');
const Booking = require('../models/Booking');
const EmailDeliveryState = require('../models/EmailDeliveryState');

const {
  recoverAllowlistedMultiUnitPaidOrphanCheckout,
  dryRunMultiUnitPaidOrphanRecovery,
  runMultiUnitPaidOrphanRecoveryBookingFinalizeCore,
  sha256Hex,
  stableStringify,
  MAX_DIGEST_AGE_MS,
  RECOVERY_LEASE_TTL_MS,
  INTENT_PHRASE,
  MultiUnitPaidOrphanRecoveryError
} = require('../services/checkout/multiUnitPaidOrphanRecoveryService');

const {
  RECOVERY_ERROR_CATALOG
} = require('../services/checkout/multiUnitPaidOrphanRecoveryErrors');

const {
  runInMultiUnitPaidOrphanRecoveryContext
} = require('../services/checkout/multiUnitPaidOrphanRecoveryCapability');

const {
  buildOrdinaryManualReviewResolutionFilter,
  withOrdinaryManualReviewHoldExclusion,
  MULTI_UNIT_PAID_ORPHAN_HOLD_KIND
} = require('../services/ops/ingestion/manualReviewResolutionHoldFilter');

const { resolveManualReviewItem } = require('../services/ops/ingestion/manualReviewService');
const {
  resolvePaymentUnlinkedReviews
} = require('../services/payments/paymentReviewResolutionService');

const {
  ensureMultiUnitPaidOrphanCompletionReview,
  buildCompletionRecoveryDedupeKey,
  COMPLETION_SOURCE
} = require('../services/checkout/multiUnitPaidOrphanRecoveryReviewService');

const {
  RECOVERY_LEASE_TTL_MS: JOB_SERVICE_LEASE_TTL_MS,
  acquireInitialMultiUnitRecoveryLease,
  markCheckoutFinalizationJobConfirmationQueued,
  buildRecoveryClaimedBy
} = require('../services/checkout/checkoutFinalizationJobService');

const {
  bookingLifecycleCorrelationKey
} = require('../services/email/emailDeliveryCorrelation');

const featureFlags = require('../utils/featureFlags');

const fs = require('fs');
const path = require('path');

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
  const { ensureAuthoritativeUniqueIndexForTests } = require('../services/inventory/unitNightClaimService');
  await ensureAuthoritativeUniqueIndexForTests();

  await CheckoutSession.syncIndexes();
  await CheckoutFinalizationJob.syncIndexes();
  await Payment.syncIndexes();
  await ManualReviewItem.syncIndexes();
  await Unit.syncIndexes();
  await Booking.syncIndexes();
  await EmailDeliveryState.syncIndexes();
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
    EmailDeliveryState.deleteMany({})
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

/**
 * Extract a named function's full source (brace-counted, so it safely spans
 * destructured-parameter defaults containing their own braces) for source
 * inspection assertions. Returns null when the function name isn't found.
 */
function extractFunctionSource(source, functionName) {
  const declRe = new RegExp(`(?:async\\s+)?function\\s+${functionName}\\s*\\(`);
  const declMatch = declRe.exec(source);
  if (!declMatch) return null;

  const parenStart = source.indexOf('(', declMatch.index);
  let parenDepth = 0;
  let parenEnd = -1;
  for (let i = parenStart; i < source.length; i += 1) {
    if (source[i] === '(') parenDepth += 1;
    else if (source[i] === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        parenEnd = i;
        break;
      }
    }
  }
  if (parenEnd === -1) return null;

  const bodyStart = source.indexOf('{', parenEnd);
  if (bodyStart === -1) return null;

  let braceDepth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === '{') braceDepth += 1;
    else if (source[i] === '}') {
      braceDepth -= 1;
      if (braceDepth === 0) {
        return source.slice(declMatch.index, i + 1);
      }
    }
  }
  return null;
}

let scopeSeq = 0;
function buildFakeScope(overrides = {}) {
  scopeSeq += 1;
  const n = scopeSeq;
  return {
    recoveryMode: 'initial',
    recoveryExecutionId: `exec-test-${n}`,
    checkoutId: `chk_test_orphan_${n}`,
    paymentIntentId: `pi_test_orphan_${n}`,
    checkoutSessionId: String(fakeObjectId(`checkoutSession-${n}`)),
    paymentId: String(fakeObjectId(`payment-${n}`)),
    finalizationJobId: String(fakeObjectId(`job-${n}`)),
    manualReviewItemId: String(fakeObjectId(`review-${n}`)),
    cabinTypeId: String(fakeObjectId(`cabinType-${n}`)),
    expectedTargetUnitId: String(fakeObjectId(`unit-${n}`)),
    evidenceDigest: fakeDigest(`evidence-${n}`),
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
  const checkoutId = overrides.checkoutId || `chk_test_orphan_${suffix}`;
  const paymentIntentId = overrides.paymentIntentId || `pi_test_orphan_${suffix}`;
  const checkoutSessionId = overrides.checkoutSessionId || new mongoose.Types.ObjectId();
  const paymentId = overrides.paymentId || new mongoose.Types.ObjectId();
  const finalizationJobId = overrides.finalizationJobId || new mongoose.Types.ObjectId();
  const manualReviewItemId = overrides.manualReviewItemId || new mongoose.Types.ObjectId();
  const cabinTypeId = overrides.cabinTypeId || new mongoose.Types.ObjectId();
  const expectedTargetUnitId = overrides.expectedTargetUnitId || new mongoose.Types.ObjectId();

  const checkIn = overrides.checkIn || new Date('2031-03-10T00:00:00.000Z');
  const checkOut = overrides.checkOut || new Date('2031-03-12T00:00:00.000Z');

  await CheckoutSession.create({
    _id: checkoutSessionId,
    checkoutId,
    status: 'needs_review',
    guestEmail: 'guest-orphan-test@example.com',
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
    lastErrorSummary: 'Synthetic duplicate stay conflict for tests'
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
    title: 'Synthetic duplicate stay conflict',
    details: 'Synthetic incident manual review for tests'
  });

  await Unit.create({
    _id: expectedTargetUnitId,
    cabinTypeId,
    unitNumber: `AF-TEST-${suffix}`.slice(0, 20),
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

  return { allowlist, checkIn, checkOut };
}

function buildValidIntentOverlay(overrides = {}) {
  return {
    confirmationPhrase: INTENT_PHRASE,
    operatorActorId: 'ops:test-operator',
    operatorIntentConfirmedAt: new Date().toISOString(),
    recoveryReason: 'Synthetic test: guest confirmed intent to purchase a second unit',
    ...overrides
  };
}

/* ======================================================================== *
 * A. Dry-run / digest
 * ======================================================================== */

test('A1. dry-run produces a deterministic digest for identical canonicalEvidence', async () => {
  const { allowlist } = await seedFullIncident();
  const now = new Date('2031-01-01T00:00:00.000Z');

  const first = await dryRunMultiUnitPaidOrphanRecovery({ allowlist, now });
  const second = await dryRunMultiUnitPaidOrphanRecovery({ allowlist, now });

  assert.equal(first.digest, second.digest);
  assert.equal(first.digest, sha256Hex(first.canonicalEvidence));
  assert.equal(stableStringify(first.canonicalEvidence), stableStringify(second.canonicalEvidence));
});

test('A2. dry-run envelope dryRunGeneratedAt equals canonicalEvidence.dryRunGeneratedAt', async () => {
  const { allowlist } = await seedFullIncident();
  const now = new Date('2031-01-02T00:00:00.000Z');

  const envelope = await dryRunMultiUnitPaidOrphanRecovery({ allowlist, now });

  assert.equal(envelope.dryRunGeneratedAt, envelope.canonicalEvidence.dryRunGeneratedAt);
  assert.equal(envelope.dryRunGeneratedAt, now.toISOString());
  assert.equal(envelope.writes, 0);
});

test('A3. digest older than 24h is rejected on execute with RECOVERY_DIGEST_EXPIRED', async () => {
  const { allowlist } = await seedFullIncident();
  const staleNow = new Date(Date.now() - (MAX_DIGEST_AGE_MS + 60 * 60 * 1000));

  const envelope = await dryRunMultiUnitPaidOrphanRecovery({ allowlist, now: staleNow });

  process.env.MULTI_UNIT_PAID_ORPHAN_RECOVERY = '1';
  assert.equal(featureFlags.isMultiUnitPaidOrphanRecoveryEnabled(), true);

  await assert.rejects(
    () =>
      recoverAllowlistedMultiUnitPaidOrphanCheckout({
        mode: 'initial',
        allowlist,
        originalEvidence: envelope,
        digest: envelope.digest,
        execute: true,
        intentOverlay: buildValidIntentOverlay(),
        now: new Date()
      }),
    (err) => {
      assert.ok(err instanceof MultiUnitPaidOrphanRecoveryError);
      assert.equal(err.code, 'RECOVERY_DIGEST_EXPIRED');
      return true;
    }
  );
});

test('A4. dry-run performs zero writes across all recovery-relevant collections', async () => {
  const { allowlist } = await seedFullIncident();

  const countsBefore = await Promise.all([
    CheckoutFinalizationJob.countDocuments({}),
    ManualReviewItem.countDocuments({}),
    Booking.countDocuments({}),
    Payment.countDocuments({}),
    EmailDeliveryState.countDocuments({}),
    CheckoutSession.countDocuments({}),
    Unit.countDocuments({})
  ]);

  await dryRunMultiUnitPaidOrphanRecovery({ allowlist, now: new Date() });
  await recoverAllowlistedMultiUnitPaidOrphanCheckout({ mode: 'dry-run', allowlist, execute: false });

  const countsAfter = await Promise.all([
    CheckoutFinalizationJob.countDocuments({}),
    ManualReviewItem.countDocuments({}),
    Booking.countDocuments({}),
    Payment.countDocuments({}),
    EmailDeliveryState.countDocuments({}),
    CheckoutSession.countDocuments({}),
    Unit.countDocuments({})
  ]);

  assert.deepEqual(countsAfter, countsBefore);
});

/* ======================================================================== *
 * B. Atomic manual-review resolution hold filters
 * ======================================================================== */

test('B1. buildOrdinaryManualReviewResolutionFilter excludes active resolution holds', () => {
  const manualReviewItemId = String(fakeObjectId('mri-filter'));
  const filter = buildOrdinaryManualReviewResolutionFilter({ manualReviewItemId });

  assert.equal(filter._id, manualReviewItemId);
  assert.equal(filter.status, 'open');
  assert.deepEqual(filter['resolutionHold.status'], { $ne: 'active' });
});

test('B2. resolveManualReviewItem cannot resolve a held open review (MANUAL_REVIEW_RESOLUTION_HELD)', async () => {
  const held = await ManualReviewItem.create({
    category: 'duplicate_stay_conflict',
    severity: 'critical',
    status: 'open',
    title: 'Held incident review',
    details: 'Under active recovery hold',
    resolutionHold: {
      kind: MULTI_UNIT_PAID_ORPHAN_HOLD_KIND,
      recoveryExecutionId: 'exec-hold-test',
      finalizationJobId: String(fakeObjectId('job-hold')),
      checkoutId: 'chk_test_orphan_hold',
      paymentIntentId: 'pi_test_orphan_hold',
      heldAt: new Date(),
      status: 'active'
    }
  });

  await assert.rejects(
    () =>
      resolveManualReviewItem({
        manualReviewItemId: held._id,
        resolvedBy: 'ops_user_test',
        note: 'Attempted ordinary resolve while recovery-held'
      }),
    (err) => {
      assert.equal(err.code, 'MANUAL_REVIEW_RESOLUTION_HELD');
      assert.equal(err.status, 409);
      return true;
    }
  );

  const stored = await ManualReviewItem.findById(held._id).lean();
  assert.equal(stored.status, 'open');
});

test('B3. resolvePaymentUnlinkedReviews updateMany excludes held items; only the unheld review resolves', async () => {
  const paymentIntentId = 'pi_test_orphan_unlinked';
  const paymentId = String(fakeObjectId('payment-unlinked'));
  const reservationId = String(fakeObjectId('reservation-unlinked'));

  const heldItem = await ManualReviewItem.create({
    category: 'payment_unlinked',
    severity: 'high',
    status: 'open',
    entityType: 'Payment',
    entityId: paymentId,
    title: 'Held payment_unlinked review',
    details: 'Under active recovery hold',
    evidence: { paymentIntentId },
    resolutionHold: {
      kind: MULTI_UNIT_PAID_ORPHAN_HOLD_KIND,
      recoveryExecutionId: 'exec-unlinked-test',
      finalizationJobId: String(fakeObjectId('job-unlinked')),
      checkoutId: 'chk_test_orphan_unlinked',
      paymentIntentId,
      heldAt: new Date(),
      status: 'active'
    }
  });

  const unheldItem = await ManualReviewItem.create({
    category: 'payment_unlinked',
    severity: 'high',
    status: 'open',
    entityType: 'Payment',
    entityId: paymentId,
    title: 'Unheld payment_unlinked review',
    details: 'No hold',
    evidence: { paymentIntentId }
  });

  const result = await resolvePaymentUnlinkedReviews({
    paymentId,
    paymentIntentId,
    reservationId,
    resolvedBy: 'payment_linking_service_test'
  });

  assert.equal(result.attempted, true);
  assert.equal(result.resolvedCount, 1);

  const heldAfter = await ManualReviewItem.findById(heldItem._id).lean();
  const unheldAfter = await ManualReviewItem.findById(unheldItem._id).lean();
  assert.equal(heldAfter.status, 'open', 'held review must remain open');
  assert.equal(unheldAfter.status, 'resolved', 'unheld review must resolve');
});

test('B4. icalIngestionService.resolveRecoverableSyncManualReviews wraps its updateMany query in withOrdinaryManualReviewHoldExclusion', () => {
  const icalSourcePath = path.join(__dirname, '..', 'services', 'ops', 'ingestion', 'icalIngestionService.js');
  const source = fs.readFileSync(icalSourcePath, 'utf8');

  assert.match(
    source,
    /require\(['"][^'"]*manualReviewResolutionHoldFilter['"]\)/,
    'icalIngestionService.js must import from manualReviewResolutionHoldFilter'
  );
  assert.match(
    source,
    /\bwithOrdinaryManualReviewHoldExclusion\b/,
    'icalIngestionService.js must reference withOrdinaryManualReviewHoldExclusion'
  );

  const fnBody = extractFunctionSource(source, 'resolveRecoverableSyncManualReviews');
  assert.ok(fnBody, 'expected to locate resolveRecoverableSyncManualReviews function body');
  assert.match(
    fnBody,
    /ManualReviewItem\.updateMany\(\s*withOrdinaryManualReviewHoldExclusion\(/,
    'resolveRecoverableSyncManualReviews must call ManualReviewItem.updateMany(withOrdinaryManualReviewHoldExclusion(...), ...)'
  );
});

test('B5. withOrdinaryManualReviewHoldExclusion merges hold exclusion into an arbitrary query without mutating the input', () => {
  const query = { status: 'open', category: 'sync_feed_unreachable' };
  const merged = withOrdinaryManualReviewHoldExclusion(query);

  assert.deepEqual(merged, {
    status: 'open',
    category: 'sync_feed_unreachable',
    'resolutionHold.status': { $ne: 'active' }
  });
  assert.equal(query['resolutionHold.status'], undefined, 'input query must not be mutated');
});

/* ======================================================================== *
 * C. Completion ManualReviewItem create/adopt/conflict
 * ======================================================================== */

test('C1. ensureMultiUnitPaidOrphanCompletionReview creates a review with the expected recoveryDedupeKey', async () => {
  const scope = buildFakeScope();

  await runInMultiUnitPaidOrphanRecoveryContext(scope, async () => {
    const { review, created } = await ensureMultiUnitPaidOrphanCompletionReview({
      originalManualReviewItemId: scope.manualReviewItemId,
      recoveryExecutionId: scope.recoveryExecutionId,
      finalizationJobId: scope.finalizationJobId,
      checkoutId: scope.checkoutId,
      checkoutSessionId: scope.checkoutSessionId,
      paymentId: scope.paymentId,
      paymentIntentId: scope.paymentIntentId,
      expectedScope: scope
    });

    assert.equal(created, true);
    assert.equal(review.recoveryDedupeKey, buildCompletionRecoveryDedupeKey(scope.recoveryExecutionId));
    assert.equal(review.provenance.source, COMPLETION_SOURCE);
    assert.equal(review.status, 'open');
  });

  const stored = await ManualReviewItem.findOne({
    recoveryDedupeKey: buildCompletionRecoveryDedupeKey(scope.recoveryExecutionId)
  }).lean();
  assert.ok(stored);
});

test('C2. concurrent duplicate-key ensure calls adopt the same completion review', async () => {
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

  const [resultA, resultB] = await runInMultiUnitPaidOrphanRecoveryContext(scope, () =>
    Promise.all([
      ensureMultiUnitPaidOrphanCompletionReview(params),
      ensureMultiUnitPaidOrphanCompletionReview(params)
    ])
  );

  assert.equal(String(resultA.review._id), String(resultB.review._id));
  assert.ok(resultA.created === true || resultB.created === true, 'exactly one call should create');
  assert.ok(resultA.created === false || resultB.created === false, 'exactly one call should adopt');

  const count = await ManualReviewItem.countDocuments({
    recoveryDedupeKey: buildCompletionRecoveryDedupeKey(scope.recoveryExecutionId)
  });
  assert.equal(count, 1, 'only one completion review document must exist');
});

test('C3. conflicting identity with the same recoveryDedupeKey aborts with RECOVERY_HOSTILE_STATE_DRIFT', async () => {
  const scope = buildFakeScope();
  const dedupeKey = buildCompletionRecoveryDedupeKey(scope.recoveryExecutionId);

  // Seed a conflicting completion review sharing the recoveryDedupeKey but a
  // different checkoutId — bypasses ensure() to simulate a corrupted/foreign row.
  await ManualReviewItem.create({
    category: 'multi_unit_paid_orphan_recovery_completion',
    severity: 'critical',
    status: 'open',
    entityType: 'CheckoutFinalizationJob',
    entityId: scope.finalizationJobId,
    title: 'Conflicting completion review',
    details: 'Seeded directly to simulate identity conflict',
    provenance: { source: COMPLETION_SOURCE, sourceReference: scope.recoveryExecutionId, detectedAt: new Date() },
    evidence: {
      recoveryExecutionId: scope.recoveryExecutionId,
      finalizationJobId: scope.finalizationJobId,
      checkoutId: 'chk_test_orphan_DIFFERENT',
      checkoutSessionId: scope.checkoutSessionId,
      paymentId: scope.paymentId,
      paymentIntentId: scope.paymentIntentId,
      originalManualReviewItemId: scope.manualReviewItemId
    },
    recoveryDedupeKey: dedupeKey
  });

  await runInMultiUnitPaidOrphanRecoveryContext(scope, async () => {
    await assert.rejects(
      () =>
        ensureMultiUnitPaidOrphanCompletionReview({
          originalManualReviewItemId: scope.manualReviewItemId,
          recoveryExecutionId: scope.recoveryExecutionId,
          finalizationJobId: scope.finalizationJobId,
          checkoutId: scope.checkoutId, // does not match the seeded conflicting doc
          checkoutSessionId: scope.checkoutSessionId,
          paymentId: scope.paymentId,
          paymentIntentId: scope.paymentIntentId,
          expectedScope: scope
        }),
      (err) => {
        assert.equal(err.code, 'RECOVERY_HOSTILE_STATE_DRIFT');
        return true;
      }
    );
  });
});

/* ======================================================================== *
 * D. Capability + lease helpers (ALS context)
 * ======================================================================== */

test('D1. RECOVERY_LEASE_TTL_MS is fixed at 15 minutes', () => {
  assert.equal(RECOVERY_LEASE_TTL_MS, 15 * 60 * 1000);
  assert.equal(JOB_SERVICE_LEASE_TTL_MS, 15 * 60 * 1000);
});

test('D2. acquireInitialMultiUnitRecoveryLease sets recoveryStatus=leased and a 15m visibility timeout', async () => {
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

  const now = new Date('2031-02-01T00:00:00.000Z');

  const updated = await runInMultiUnitPaidOrphanRecoveryContext(scope, () =>
    acquireInitialMultiUnitRecoveryLease({
      jobId: job._id,
      checkoutId: scope.checkoutId,
      paymentIntentId: scope.paymentIntentId,
      recoveryExecutionId: scope.recoveryExecutionId,
      evidenceDigest: scope.evidenceDigest,
      operatorActorId: 'ops:test-operator',
      operatorIntentConfirmedAt: now,
      recoveryReason: 'Synthetic lease acquisition test',
      expectedScope: scope,
      now
    })
  );

  assert.equal(updated.recoveryStatus, 'leased');
  assert.equal(updated.recoveryClaimedBy, buildRecoveryClaimedBy(scope.recoveryExecutionId));
  assert.equal(
    updated.recoveryVisibilityTimeoutAt.getTime() - now.getTime(),
    15 * 60 * 1000
  );
});

test('D3. acquireInitialMultiUnitRecoveryLease requires a matching ALS context (fails closed outside/mismatched)', async () => {
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

  await assert.rejects(
    () =>
      acquireInitialMultiUnitRecoveryLease({
        jobId: job._id,
        checkoutId: scope.checkoutId,
        paymentIntentId: scope.paymentIntentId,
        recoveryExecutionId: scope.recoveryExecutionId,
        evidenceDigest: scope.evidenceDigest,
        expectedScope: scope,
        now: new Date()
      }),
    (err) => {
      assert.equal(err.code, 'MULTI_UNIT_PAID_ORPHAN_RECOVERY_CONTEXT_REQUIRED');
      return true;
    }
  );
});

test('D4. markCheckoutFinalizationJobConfirmationQueued rejects without a valid EmailDeliveryState', async () => {
  const scope = buildFakeScope();
  const bookingId = fakeObjectId('booking-d4');
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
    recoveryClaimedBy: buildRecoveryClaimedBy(scope.recoveryExecutionId),
    recoveryVisibilityTimeoutAt: new Date(Date.now() + 10 * 60 * 1000)
  });

  const correlationKey = bookingLifecycleCorrelationKey({
    bookingId,
    templateKey: 'booking_received',
    recipientEmail: 'guest-d4@example.com'
  });

  const expectedScope = { ...scope, bookingId: String(bookingId) };
  await runInMultiUnitPaidOrphanRecoveryContext(scope, async () => {
    await assert.rejects(
      () =>
        markCheckoutFinalizationJobConfirmationQueued({
          finalizationJobId: scope.finalizationJobId,
          bookingId,
          recoveryExecutionId: scope.recoveryExecutionId,
          expectedCorrelationKey: correlationKey,
          expectedScope
        }),
      (err) => {
        assert.equal(err.code, 'RECOVERY_CONFIRMATION_STATE_INVALID');
        return true;
      }
    );
  });

  const stored = await CheckoutFinalizationJob.findById(scope.finalizationJobId).lean();
  assert.equal(stored.confirmationQueuedAt, null);
  assert.equal(stored.confirmationSentAt, null);
});

test('D5. markCheckoutFinalizationJobConfirmationQueued succeeds with a pending EDS, never sets confirmationSentAt, and a second call reports alreadyAdvanced', async () => {
  const scope = buildFakeScope();
  const bookingId = fakeObjectId('booking-d5');
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
    recoveryClaimedBy: buildRecoveryClaimedBy(scope.recoveryExecutionId),
    recoveryVisibilityTimeoutAt: new Date(Date.now() + 10 * 60 * 1000)
  });

  const correlationKey = bookingLifecycleCorrelationKey({
    bookingId,
    templateKey: 'booking_received',
    recipientEmail: 'guest-d5@example.com'
  });

  await EmailDeliveryState.create({
    correlationKey,
    domain: 'booking_lifecycle',
    bookingId,
    templateKey: 'booking_received',
    recipient: 'guest-d5@example.com',
    latestStatus: 'pending',
    latestEventAt: new Date()
  });

  const expectedScope = { ...scope, bookingId: String(bookingId) };
  const firstResult = await runInMultiUnitPaidOrphanRecoveryContext(scope, () =>
    markCheckoutFinalizationJobConfirmationQueued({
      finalizationJobId: scope.finalizationJobId,
      bookingId,
      recoveryExecutionId: scope.recoveryExecutionId,
      expectedCorrelationKey: correlationKey,
      expectedScope
    })
  );

  assert.equal(firstResult.alreadyAdvanced, false);
  assert.ok(firstResult.job.confirmationQueuedAt);
  assert.equal(firstResult.job.confirmationSentAt, null);
  assert.equal(firstResult.job.recoveryStatus, 'awaiting_review_resolution');

  const secondResult = await runInMultiUnitPaidOrphanRecoveryContext(scope, () =>
    markCheckoutFinalizationJobConfirmationQueued({
      finalizationJobId: scope.finalizationJobId,
      bookingId,
      recoveryExecutionId: scope.recoveryExecutionId,
      expectedCorrelationKey: correlationKey,
      expectedScope
    })
  );

  assert.equal(secondResult.alreadyAdvanced, true);
  assert.equal(
    new Date(secondResult.job.confirmationQueuedAt).getTime(),
    new Date(firstResult.job.confirmationQueuedAt).getTime(),
    'confirmationQueuedAt must never be overwritten once set'
  );
  assert.equal(secondResult.job.confirmationSentAt, null);
});

/* ======================================================================== *
 * E. Side-effect-free finalize seam (source inspection)
 * ======================================================================== */

test('E1. multiUnitPaidOrphanRecoveryService.js never calls finalizePaidCheckout(...)', () => {
  const servicePath = path.join(__dirname, '..', 'services', 'checkout', 'multiUnitPaidOrphanRecoveryService.js');
  const source = fs.readFileSync(servicePath, 'utf8');

  assert.doesNotMatch(source, /\bfinalizePaidCheckout\s*\(/);
});

test('E2. multiUnitPaidOrphanRecoveryService.js does not import enqueuePostFinalizeSideEffects (convertSavedQuoteForBooking is the only allowed checkoutFinalizeSideEffects import)', () => {
  const servicePath = path.join(__dirname, '..', 'services', 'checkout', 'multiUnitPaidOrphanRecoveryService.js');
  const source = fs.readFileSync(servicePath, 'utf8');

  const importMatch = source.match(
    /const\s*\{([^}]*)\}\s*=\s*require\(['"][^'"]*checkoutFinalizeSideEffects['"]\)/
  );
  assert.ok(importMatch, 'expected a destructured require from checkoutFinalizeSideEffects');
  assert.doesNotMatch(importMatch[1], /\benqueuePostFinalizeSideEffects\b/);
  assert.match(importMatch[1], /\bconvertSavedQuoteForBooking\b/);
});

test('E3. runMultiUnitPaidOrphanRecoveryBookingFinalizeCore is exported as a function', () => {
  assert.equal(typeof runMultiUnitPaidOrphanRecoveryBookingFinalizeCore, 'function');
});

/* ======================================================================== *
 * F. Money-safety assertions
 * ======================================================================== */

test('F1. CLI source never imports Stripe refund/charge/payment-intent-create surfaces', () => {
  const cliPath = path.join(__dirname, 'recoverMultiUnitPaidOrphanCheckout.js');
  const source = fs.readFileSync(cliPath, 'utf8');

  assert.doesNotMatch(source, /require\(['"]stripe['"]\)/);
  assert.doesNotMatch(source, /require\(['"][^'"]*config\/stripe['"]\)/);
  assert.doesNotMatch(source, /\.refunds\s*\.\s*create\s*\(/);
  assert.doesNotMatch(source, /paymentIntents\s*\.\s*create\s*\(/);
});

test('F1b. recovery service uses stripe package seam, not config/stripe, and never creates money-movement calls', () => {
  const servicePath = path.join(
    __dirname,
    '..',
    'services',
    'checkout',
    'multiUnitPaidOrphanRecoveryService.js'
  );
  const source = fs.readFileSync(servicePath, 'utf8');

  assert.doesNotMatch(source, /require\(['"][^'"]*config\/stripe['"]\)/);
  assert.match(source, /require\(['"]stripe['"]\)/);
  assert.doesNotMatch(source, /\.refunds\s*\.\s*create\s*\(/);
  assert.doesNotMatch(source, /\.charges\s*\.\s*create\s*\(/);
  assert.doesNotMatch(source, /paymentIntents\s*\.\s*create\s*\(/);
  assert.match(source, /paymentIntents\.retrieve/);
});

test('F1c. default Stripe client resolution does not throw MODULE_NOT_FOUND', () => {
  const {
    __getStripeClientForTesting
  } = require('../services/checkout/multiUnitPaidOrphanRecoveryService');

  const fake = { paymentIntents: { retrieve: async () => ({ id: 'pi_x', status: 'succeeded' }) } };
  assert.equal(__getStripeClientForTesting(fake), fake);

  const prev = process.env.STRIPE_SECRET_KEY;
  try {
    delete process.env.STRIPE_SECRET_KEY;
    assert.equal(__getStripeClientForTesting(null), null);

    process.env.STRIPE_SECRET_KEY = 'sk_test_recovery_dependency_probe_only';
    const client = __getStripeClientForTesting(null);
    assert.ok(client);
    assert.equal(typeof client.paymentIntents.retrieve, 'function');
  } finally {
    if (prev === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = prev;
  }
});

test('F2. every recovery error carries refundRecommended === false', () => {
  const codes = Object.keys(RECOVERY_ERROR_CATALOG);
  assert.ok(codes.length > 0);

  for (const code of codes) {
    const err = new MultiUnitPaidOrphanRecoveryError(code, { note: 'test' });
    assert.equal(err.refundRecommended, false, `${code} must never recommend a refund`);
    assert.equal(err.toJSON().refundRecommended, false, `${code} toJSON() must never recommend a refund`);
  }

  // Unknown code path also defaults safely.
  const unknown = new MultiUnitPaidOrphanRecoveryError('SOME_UNKNOWN_CODE_FOR_TEST');
  assert.equal(unknown.refundRecommended, false);
});

/* ======================================================================== *
 * G. Feature flag defaults
 * ======================================================================== */

test('G1. isMultiUnitPaidOrphanRecoveryEnabled defaults to false', () => {
  delete process.env.MULTI_UNIT_PAID_ORPHAN_RECOVERY;
  assert.equal(featureFlags.isMultiUnitPaidOrphanRecoveryEnabled(), false);
});

test('G2. isMultiUnitCapacityStayGuardEnabled defaults to false', () => {
  delete process.env.MULTI_UNIT_CAPACITY_STAY_GUARD;
  assert.equal(featureFlags.isMultiUnitCapacityStayGuardEnabled(), false);
});
