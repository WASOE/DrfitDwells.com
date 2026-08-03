const mongoose = require('mongoose');
const CheckoutSession = require('../../models/CheckoutSession');
const {
  CHECKOUT_SESSION_ERROR_CODES,
  CheckoutSessionError
} = require('./checkoutSessionErrors');
const {
  loadSessionOrThrow,
  assertSessionUsable,
  isSessionExpired
} = require('./checkoutSessionService');
const { assertCanonicalPaymentIntentForSession } = require('./checkoutCanonicalPaymentIntentService');
const { assertNoCommercialStayConflict } = require('./commercialStayGuardService');
const {
  normalizeGuestEmail,
  buildCommercialStayFingerprintFromBookingPayload
} = require('./bookingCommercialStayFingerprint');

const FINALIZE_STATUS = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  FINALIZED: 'finalized',
  NEEDS_REVIEW: 'needs_review'
};

const NO_PAYMENT_CANONICAL_PI_OPTIONAL_STATUSES = new Set([
  'voucher_only_reserved',
  'payment_not_required'
]);

const BLOCKED_ACQUIRE_SESSION_STATUSES = ['expired', 'superseded', 'needs_review'];
const BLOCKED_ACQUIRE_SESSION_STATUSES_PAID_OVERRIDE = ['superseded', 'needs_review'];

const DEFAULT_FINALIZE_LOCK_VISIBILITY_MS = 5 * 60 * 1000;

function getFinalizeLockVisibilityMs() {
  const raw = process.env.FINALIZE_LOCK_VISIBILITY_MS;
  if (raw == null || raw === '') {
    return DEFAULT_FINALIZE_LOCK_VISIBILITY_MS;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return DEFAULT_FINALIZE_LOCK_VISIBILITY_MS;
  }
  return Math.floor(n);
}

function normalizeCheckoutId(checkoutId) {
  return String(checkoutId || '').trim();
}

function normalizeNow(now) {
  return now instanceof Date ? now : new Date();
}

function isPaidFinalizeOverrideEligible(session, paidFinalizeOverride = false) {
  if (paidFinalizeOverride === true) {
    return true;
  }
  return String(session?.paymentStatus || '').trim() === 'paid';
}

function toObjectId(value) {
  if (value == null || value === '') {
    return null;
  }
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }
  return new mongoose.Types.ObjectId(String(value));
}

function buildFinalizeReplayResponse(session) {
  if (!session) {
    return null;
  }
  const finalizeStatus = session.finalizeStatus;
  const bookingId = session.bookingId;
  if (finalizeStatus === FINALIZE_STATUS.FINALIZED && bookingId) {
    return {
      ok: true,
      idempotentReplay: true,
      bookingId: String(bookingId),
      checkoutId: session.checkoutId
    };
  }
  return null;
}

function hasPersistedStayFingerprint(session) {
  return Boolean(String(session?.stayFingerprint || '').trim());
}

function buildEmptyStayFingerprintFilter() {
  return {
    $or: [
      { stayFingerprint: null },
      { stayFingerprint: '' },
      { stayFingerprint: { $exists: false } }
    ]
  };
}

function deriveCommercialStayFingerprintForFinalize({ session, bookingPayload }) {
  if (hasPersistedStayFingerprint(session)) {
    return String(session.stayFingerprint).trim();
  }

  const derived = buildCommercialStayFingerprintFromBookingPayload(bookingPayload);
  if (!derived) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.COMMERCIAL_STAY_FINGERPRINT_REQUIRED,
      'commercial stay fingerprint could not be derived from booking payload'
    );
  }
  return derived;
}

function assertStayFingerprintMatchesExisting(existingFingerprint, derivedFingerprint) {
  const existing = String(existingFingerprint || '').trim();
  const derived = String(derivedFingerprint || '').trim();
  if (existing && derived && existing !== derived) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.COMMERCIAL_STAY_FINGERPRINT_MISMATCH,
      'Computed commercial stay fingerprint does not match persisted checkout session fingerprint',
      { existingFingerprint: existing, derivedFingerprint: derived }
    );
  }
}

async function ensureCheckoutSessionStayFingerprint({
  checkoutId,
  bookingPayload,
  paidFinalizeOverride = false,
  recoveryCommercialStayIdentity = null
}) {
  const normalizedId = normalizeCheckoutId(checkoutId);
  const session = await loadSessionOrThrow(normalizedId);
  assertV2Flow(session);
  if (paidFinalizeOverride || isPaidFinalizeOverrideEligible(session, false)) {
    assertSessionUsableForFinalize(session, {
      paidFinalizeOverride: true,
      recoveryCommercialStayIdentity
    });
  } else {
    assertSessionUsable(session);
  }

  const existingFingerprint = hasPersistedStayFingerprint(session)
    ? String(session.stayFingerprint).trim()
    : null;

  if (existingFingerprint) {
    if (bookingPayload) {
      const derived = buildCommercialStayFingerprintFromBookingPayload(bookingPayload);
      if (derived) {
        assertStayFingerprintMatchesExisting(existingFingerprint, derived);
      }
    }
    return session;
  }

  const derivedFingerprint = deriveCommercialStayFingerprintForFinalize({
    session,
    bookingPayload
  });
  const guestEmail = normalizeGuestEmail(
    bookingPayload?.guestInfo?.email || session.guestEmail
  );

  const set = { stayFingerprint: derivedFingerprint };
  if (!String(session.guestEmail || '').trim() && guestEmail) {
    set.guestEmail = guestEmail;
  }

  const filter = {
    checkoutId: normalizedId,
    flowVersion: 'v2',
    status: { $nin: BLOCKED_ACQUIRE_SESSION_STATUSES },
    ...buildEmptyStayFingerprintFilter()
  };

  const updated = await CheckoutSession.findOneAndUpdate(
    filter,
    { $set: set, $inc: { sessionVersion: 1 } },
    { new: true }
  );

  if (updated) {
    return updated;
  }

  const current = await CheckoutSession.findOne({ checkoutId: normalizedId });
  if (!current) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_FOUND,
      'Checkout session not found'
    );
  }

  const reloadedFingerprint = hasPersistedStayFingerprint(current)
    ? String(current.stayFingerprint).trim()
    : null;

  if (reloadedFingerprint) {
    assertStayFingerprintMatchesExisting(reloadedFingerprint, derivedFingerprint);
    return current;
  }

  throw new CheckoutSessionError(
    CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_CONCURRENCY_CONFLICT,
    'Checkout session stay fingerprint could not be persisted',
    { checkoutId: normalizedId }
  );
}

function assertV2Flow(session) {
  if (session.flowVersion !== 'v2') {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE,
      'Checkout session is not a V2 flow session',
      { flowVersion: session.flowVersion }
    );
  }
}

function isRecoveryFinalizeIdentity(recoveryCommercialStayIdentity) {
  return Boolean(
    recoveryCommercialStayIdentity &&
      typeof recoveryCommercialStayIdentity === 'object' &&
      recoveryCommercialStayIdentity.evidenceDigest != null
  );
}

function buildAcquireLockFilter(
  checkoutId,
  expectedSessionVersion,
  now,
  { paidFinalizeOverride = false, recoveryCommercialStayIdentity = null } = {}
) {
  const recoveryFinalizeAllowed =
    paidFinalizeOverride === true && isRecoveryFinalizeIdentity(recoveryCommercialStayIdentity);

  const blocked = recoveryFinalizeAllowed
    ? ['superseded']
    : paidFinalizeOverride
      ? BLOCKED_ACQUIRE_SESSION_STATUSES_PAID_OVERRIDE
      : BLOCKED_ACQUIRE_SESSION_STATUSES;

  const filter = {
    checkoutId: normalizeCheckoutId(checkoutId),
    flowVersion: 'v2',
    finalizeStatus: recoveryFinalizeAllowed
      ? { $in: [FINALIZE_STATUS.OPEN, FINALIZE_STATUS.NEEDS_REVIEW] }
      : FINALIZE_STATUS.OPEN,
    status: { $nin: blocked }
  };

  if (paidFinalizeOverride) {
    // Verified paid / paymentStatus=paid: allow finalize after expiresAt.
  } else {
    filter.$or = [
      { expiresAt: null },
      { expiresAt: { $exists: false } },
      { expiresAt: { $gte: now } },
      { paymentStatus: 'paid' }
    ];
  }

  if (expectedSessionVersion != null && expectedSessionVersion !== '') {
    filter.sessionVersion = Number(expectedSessionVersion);
  }
  return filter;
}

function classifyAcquireLockFailure(
  session,
  { paidFinalizeOverride = false, recoveryCommercialStayIdentity = null } = {}
) {
  if (!session) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_FOUND,
      'Checkout session not found'
    );
  }

  assertV2Flow(session);

  const replay = buildFinalizeReplayResponse(session);
  if (replay) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE,
      'Checkout session is already finalized',
      { idempotentReplay: true, replay }
    );
  }

  if (session.finalizeStatus === FINALIZE_STATUS.IN_PROGRESS) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.FINALIZE_IN_PROGRESS,
      'Checkout finalization is already in progress',
      { checkoutId: session.checkoutId }
    );
  }

  const recoveryFinalizeAllowed =
    paidFinalizeOverride === true && isRecoveryFinalizeIdentity(recoveryCommercialStayIdentity);

  if (
    !recoveryFinalizeAllowed &&
    (session.finalizeStatus === FINALIZE_STATUS.NEEDS_REVIEW ||
      session.status === 'needs_review')
  ) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE,
      'Checkout session requires review',
      { checkoutId: session.checkoutId }
    );
  }

  if (session.status === 'superseded') {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_SUPERSEDED,
      'Checkout session was superseded'
    );
  }

  if (
    isSessionExpired(session) &&
    !isPaidFinalizeOverrideEligible(session, paidFinalizeOverride)
  ) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_EXPIRED,
      'Checkout session has expired'
    );
  }

  if (session.finalizeStatus === FINALIZE_STATUS.FINALIZED) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE,
      'Checkout session is already finalized',
      { checkoutId: session.checkoutId }
    );
  }

  throw new CheckoutSessionError(
    CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_CONCURRENCY_CONFLICT,
    'Checkout session version or state changed during finalize lock acquisition',
    {
      checkoutId: session.checkoutId,
      sessionVersion: session.sessionVersion,
      finalizeStatus: session.finalizeStatus,
      status: session.status
    }
  );
}

/**
 * Reclaim stale in_progress finalize locks so crash recovery can continue.
 * @returns {Promise<object|null>} updated session when reclaim succeeded
 */
async function reclaimStaleFinalizeLock({
  checkoutId,
  now = new Date(),
  visibilityMs = getFinalizeLockVisibilityMs()
} = {}) {
  const at = normalizeNow(now);
  const normalizedId = normalizeCheckoutId(checkoutId);
  if (!normalizedId) {
    return null;
  }

  const cutoff = new Date(at.getTime() - visibilityMs);
  return CheckoutSession.findOneAndUpdate(
    {
      checkoutId: normalizedId,
      flowVersion: 'v2',
      finalizeStatus: FINALIZE_STATUS.IN_PROGRESS,
      finalizeStartedAt: { $ne: null, $lte: cutoff }
    },
    {
      $set: {
        finalizeStatus: FINALIZE_STATUS.OPEN,
        finalizeStartedAt: null,
        'metadata.finalizeLockReclaimedAt': at,
        'metadata.finalizeLockReclaimReason': 'stale_visibility_timeout'
      },
      $inc: { sessionVersion: 1 }
    },
    { new: true }
  );
}

function assertSessionUsableForFinalize(
  session,
  { paidFinalizeOverride = false, recoveryCommercialStayIdentity = null } = {}
) {
  if (!session) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_FOUND,
      'Checkout session not found'
    );
  }

  if (session.status === 'superseded') {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_SUPERSEDED,
      'Checkout session was superseded'
    );
  }

  if (
    isSessionExpired(session) &&
    !isPaidFinalizeOverrideEligible(session, paidFinalizeOverride)
  ) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_EXPIRED,
      'Checkout session has expired'
    );
  }

  const recoveryFinalizeAllowed =
    paidFinalizeOverride === true &&
    recoveryCommercialStayIdentity &&
    typeof recoveryCommercialStayIdentity === 'object' &&
    recoveryCommercialStayIdentity.evidenceDigest != null;

  if (session.status === 'needs_review' && !recoveryFinalizeAllowed) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE,
      'Checkout session requires review'
    );
  }

  if (session.finalizeStatus === 'finalized') {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE,
      'Checkout session is already finalized'
    );
  }
}

async function loadFinalizableCheckoutSession({
  checkoutId,
  paidFinalizeOverride = false,
  recoveryCommercialStayIdentity = null
} = {}) {
  const session = await loadSessionOrThrow(checkoutId);
  assertV2Flow(session);
  if (paidFinalizeOverride || isPaidFinalizeOverrideEligible(session, false)) {
    assertSessionUsableForFinalize(session, {
      paidFinalizeOverride: true,
      recoveryCommercialStayIdentity
    });
  } else {
    assertSessionUsable(session);
  }
  return session;
}

async function acquireFinalizeLock({
  checkoutId,
  expectedSessionVersion,
  now = new Date(),
  paidFinalizeOverride = false,
  visibilityMs = getFinalizeLockVisibilityMs(),
  recoveryCommercialStayIdentity = null
} = {}) {
  const at = normalizeNow(now);
  const normalizedId = normalizeCheckoutId(checkoutId);
  if (!normalizedId) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.INVALID_CHECKOUT_ID,
      'checkoutId is required'
    );
  }

  await reclaimStaleFinalizeLock({
    checkoutId: normalizedId,
    now: at,
    visibilityMs
  });

  const acquireFilter = buildAcquireLockFilter(normalizedId, expectedSessionVersion, at, {
    paidFinalizeOverride: paidFinalizeOverride === true,
    recoveryCommercialStayIdentity
  });

  const updated = await CheckoutSession.findOneAndUpdate(
    acquireFilter,
    {
      $set: {
        finalizeStatus: FINALIZE_STATUS.IN_PROGRESS,
        finalizeStartedAt: at
      },
      $inc: { sessionVersion: 1 }
    },
    { new: true }
  );

  if (updated) {
    return updated;
  }

  const current = await CheckoutSession.findOne({ checkoutId: normalizedId });
  classifyAcquireLockFailure(current, {
    paidFinalizeOverride:
      paidFinalizeOverride === true || isPaidFinalizeOverrideEligible(current, false),
    recoveryCommercialStayIdentity
  });
}

async function releaseFinalizeLock({ checkoutId, note = null }) {
  const normalizedId = normalizeCheckoutId(checkoutId);
  const current = await CheckoutSession.findOne({
    checkoutId: normalizedId,
    finalizeStatus: FINALIZE_STATUS.IN_PROGRESS
  });

  if (!current) {
    return CheckoutSession.findOne({ checkoutId: normalizedId });
  }

  const set = {
    finalizeStatus: FINALIZE_STATUS.OPEN,
    finalizeStartedAt: null
  };
  if (note != null && String(note).trim()) {
    set.metadata = {
      ...(current.metadata && typeof current.metadata === 'object' ? current.metadata : {}),
      finalizeReleaseNote: String(note).trim()
    };
  }

  const updated = await CheckoutSession.findOneAndUpdate(
    {
      checkoutId: normalizedId,
      finalizeStatus: FINALIZE_STATUS.IN_PROGRESS,
      sessionVersion: current.sessionVersion
    },
    { $set: set, $inc: { sessionVersion: 1 } },
    { new: true }
  );

  return updated || CheckoutSession.findOne({ checkoutId: normalizedId });
}

async function markFinalizeNeedsReview({ checkoutId, reason, details = null }) {
  const normalizedId = normalizeCheckoutId(checkoutId);
  const session = await CheckoutSession.findOne({ checkoutId: normalizedId });
  if (!session) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_FOUND,
      'Checkout session not found'
    );
  }

  const safeDetails =
    details && typeof details === 'object' && !Array.isArray(details) ? details : null;
  const metadata = {
    ...(session.metadata && typeof session.metadata === 'object' ? session.metadata : {}),
    finalizeNeedsReview: {
      reason: reason != null ? String(reason).trim() : null,
      details: safeDetails,
      markedAt: new Date()
    }
  };

  const updated = await CheckoutSession.findOneAndUpdate(
    { checkoutId: normalizedId },
    {
      $set: {
        finalizeStatus: FINALIZE_STATUS.NEEDS_REVIEW,
        status: 'needs_review',
        metadata
      },
      $inc: { sessionVersion: 1 }
    },
    { new: true }
  );

  return updated;
}

async function markFinalizeSucceeded({
  checkoutId,
  bookingId,
  now = new Date(),
  setPaymentStatusPaid = false
} = {}) {
  const normalizedId = normalizeCheckoutId(checkoutId);
  const bookingObjectId = toObjectId(bookingId);
  if (!bookingObjectId) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE,
      'bookingId is required to mark finalize succeeded'
    );
  }

  const at = normalizeNow(now);
  const set = {
    finalizeStatus: FINALIZE_STATUS.FINALIZED,
    bookingId: bookingObjectId,
    finalizedAt: at
  };
  if (setPaymentStatusPaid === true) {
    set.paymentStatus = 'paid';
  }

  const updated = await CheckoutSession.findOneAndUpdate(
    { checkoutId: normalizedId, finalizeStatus: FINALIZE_STATUS.IN_PROGRESS },
    {
      $set: set,
      $inc: { sessionVersion: 1 }
    },
    { new: true }
  );

  if (!updated) {
    const current = await CheckoutSession.findOne({ checkoutId: normalizedId });
    if (!current) {
      throw new CheckoutSessionError(
        CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_FOUND,
        'Checkout session not found'
      );
    }
    const replay = buildFinalizeReplayResponse(current);
    if (replay) {
      throw new CheckoutSessionError(
        CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE,
        'Checkout session is already finalized',
        { idempotentReplay: true, replay }
      );
    }
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE,
      'Checkout session is not in finalize in_progress state',
      {
        checkoutId: current.checkoutId,
        finalizeStatus: current.finalizeStatus
      }
    );
  }

  return updated;
}

async function assertPaymentIntentReadyForFinalize(
  session,
  paymentIntentId,
  { paidFinalizeOverride = false } = {}
) {
  const piId = paymentIntentId ? String(paymentIntentId).trim() : '';
  const canonical = session.canonicalPaymentIntentId
    ? String(session.canonicalPaymentIntentId).trim()
    : null;

  if (NO_PAYMENT_CANONICAL_PI_OPTIONAL_STATUSES.has(session.status)) {
    if (!piId) {
      return;
    }
    if (canonical) {
      await assertCanonicalPaymentIntentForSession({
        checkoutId: session.checkoutId,
        paymentIntentId: piId,
        skipSessionUsableGuard: paidFinalizeOverride === true
      });
    }
    return;
  }

  if (!canonical) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE,
      'Checkout session is not ready for payment finalization',
      { status: session.status }
    );
  }

  await assertCanonicalPaymentIntentForSession({
    checkoutId: session.checkoutId,
    paymentIntentId: piId,
    skipSessionUsableGuard:
      paidFinalizeOverride === true || isPaidFinalizeOverrideEligible(session, false)
  });
}

function safeFinalizeErrorDetails(err) {
  if (!err || typeof err !== 'object') {
    return null;
  }
  return {
    code: err.code || null,
    message: err.message || null,
    needsReview: err.needsReview === true,
    requiresManualReview: err.requiresManualReview === true
  };
}

function shouldMarkNeedsReviewOnFinalizeError(err) {
  if (!err || typeof err !== 'object') {
    return false;
  }
  if (err.needsReview === true || err.requiresManualReview === true) {
    return true;
  }
  const code = err.code;
  return code === 'PAID_BOOKING_SAVE_FAILED' || code === 'VOUCHER_CONFIRM_FAILED';
}

async function assertOrchestrationBookingPayload(checkoutId, bookingPayload) {
  if (bookingPayload != null && typeof bookingPayload === 'object') {
    return;
  }

  const session = await CheckoutSession.findOne({ checkoutId: normalizeCheckoutId(checkoutId) });
  if (!session) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_FOUND,
      'Checkout session not found'
    );
  }

  if (hasPersistedStayFingerprint(session)) {
    return;
  }

  throw new CheckoutSessionError(
    CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE,
    'bookingPayload is required when checkout session stayFingerprint is not set',
    { checkoutId: session.checkoutId }
  );
}

async function evaluatePreLockOrchestrationState(
  checkoutId,
  {
    now = new Date(),
    visibilityMs = getFinalizeLockVisibilityMs(),
    paidFinalizeOverride = false,
    recoveryCommercialStayIdentity = null
  } = {}
) {
  const at = normalizeNow(now);
  const normalizedId = normalizeCheckoutId(checkoutId);

  await reclaimStaleFinalizeLock({
    checkoutId: normalizedId,
    now: at,
    visibilityMs
  });

  const session = await loadSessionOrThrow(normalizedId);
  assertV2Flow(session);

  const replay = buildFinalizeReplayResponse(session);
  if (replay) {
    return { replay };
  }

  if (session.finalizeStatus === FINALIZE_STATUS.IN_PROGRESS) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.FINALIZE_IN_PROGRESS,
      'Checkout finalization is already in progress',
      { checkoutId: session.checkoutId }
    );
  }

  // S0 paid-orphan recovery finalizes allowlisted needs_review sessions via
  // paidFinalizeOverride + independently scoped recoveryCommercialStayIdentity.
  // Ordinary callers must still hard-stop on needs_review.
  const recoveryFinalizeAllowed =
    paidFinalizeOverride === true &&
    recoveryCommercialStayIdentity &&
    typeof recoveryCommercialStayIdentity === 'object' &&
    recoveryCommercialStayIdentity.evidenceDigest != null;

  if (
    !recoveryFinalizeAllowed &&
    (session.finalizeStatus === FINALIZE_STATUS.NEEDS_REVIEW ||
      session.status === 'needs_review')
  ) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE,
      'Checkout session requires review',
      { checkoutId: session.checkoutId }
    );
  }

  return { session };
}

function deriveCommercialStayGuardIdentities(session, recoveryCommercialStayIdentity = null) {
  const cabinTypeId =
    session?.quoteSnapshot?.cabinTypeId ||
    session?.finalizeIntent?.cabinTypeId ||
    session?.cabinTypeId ||
    null;
  const paymentIntentId =
    session?.canonicalPaymentIntentId ||
    (recoveryCommercialStayIdentity && recoveryCommercialStayIdentity.paymentIntentId) ||
    null;
  return {
    checkoutSessionId: session?._id != null ? String(session._id) : null,
    paymentIntentId: paymentIntentId != null ? String(paymentIntentId) : null,
    cabinTypeId: cabinTypeId != null ? String(cabinTypeId) : null,
    // evidenceDigest must come from recovery orchestration — never from ALS/session echo
    evidenceDigest:
      recoveryCommercialStayIdentity?.evidenceDigest != null
        ? String(recoveryCommercialStayIdentity.evidenceDigest)
        : null
  };
}

async function assertCommercialStayClearAfterLock(
  lockedSession,
  checkoutId,
  recoveryCommercialStayIdentity = null
) {
  const identities = deriveCommercialStayGuardIdentities(
    lockedSession,
    recoveryCommercialStayIdentity
  );
  await assertNoCommercialStayConflict({
    commercialStayFingerprint: String(lockedSession.stayFingerprint).trim(),
    checkoutId: normalizeCheckoutId(checkoutId),
    bookingId: null,
    checkoutSessionId: identities.checkoutSessionId,
    paymentIntentId: identities.paymentIntentId,
    cabinTypeId: identities.cabinTypeId,
    evidenceDigest: identities.evidenceDigest
  });
}

async function runCheckoutFinalizeOrchestration({
  checkoutId,
  paymentIntentId = null,
  bookingPayload = null,
  expectedSessionVersion = null,
  now = new Date(),
  finalizeWork,
  source = 'frontend',
  paidFinalizeOverride = false,
  setPaymentStatusPaid = false,
  visibilityMs = getFinalizeLockVisibilityMs(),
  /** Ordinary non-authorizing bag: { evidenceDigest, paymentIntentId? } for S0 recovery only */
  recoveryCommercialStayIdentity = null
}) {
  const normalizedId = normalizeCheckoutId(checkoutId);
  const at = normalizeNow(now);

  if (!normalizedId) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.INVALID_CHECKOUT_ID,
      'checkoutId is required'
    );
  }

  if (typeof finalizeWork !== 'function') {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE,
      'finalizeWork must be a function',
      { checkoutId: normalizedId }
    );
  }

  await assertOrchestrationBookingPayload(normalizedId, bookingPayload);

  const preLock = await evaluatePreLockOrchestrationState(normalizedId, {
    now: at,
    visibilityMs,
    paidFinalizeOverride,
    recoveryCommercialStayIdentity
  });
  if (preLock.replay) {
    return preLock.replay;
  }

  const ready = await assertCheckoutSessionReadyForFinalize({
    checkoutId: normalizedId,
    paymentIntentId,
    bookingPayload,
    paidFinalizeOverride,
    recoveryCommercialStayIdentity
  });

  const lockedSession = await acquireFinalizeLock({
    checkoutId: normalizedId,
    expectedSessionVersion: expectedSessionVersion ?? ready.session.sessionVersion,
    now: at,
    paidFinalizeOverride:
      paidFinalizeOverride === true ||
      isPaidFinalizeOverrideEligible(ready.session, false),
    visibilityMs,
    recoveryCommercialStayIdentity
  });

  try {
    await assertCommercialStayClearAfterLock(
      lockedSession,
      normalizedId,
      recoveryCommercialStayIdentity
    );
  } catch (conflictErr) {
    await releaseFinalizeLock({
      checkoutId: normalizedId,
      note: 'commercial_stay_conflict_after_lock'
    });
    throw conflictErr;
  }

  let workResult;
  try {
    workResult = await finalizeWork({
      session: lockedSession,
      checkoutId: normalizedId,
      paymentIntentId,
      bookingPayload,
      source
    });
  } catch (err) {
    if (shouldMarkNeedsReviewOnFinalizeError(err)) {
      await markFinalizeNeedsReview({
        checkoutId: normalizedId,
        reason: err.code || 'finalize_work_needs_review',
        details: safeFinalizeErrorDetails(err)
      });
      throw err;
    }

    await releaseFinalizeLock({
      checkoutId: normalizedId,
      note: 'finalize_work_failed'
    });
    throw err;
  }

  const workBookingId = workResult?.bookingId;
  if (!workBookingId) {
    await markFinalizeNeedsReview({
      checkoutId: normalizedId,
      reason: 'finalize_work_missing_booking_id',
      details: { source }
    });
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE,
      'finalizeWork did not return a bookingId',
      { checkoutId: normalizedId, source }
    );
  }

  const workerIdempotentReplay = workResult?.result?.idempotentReplay === true;

  const shouldSetPaid =
    setPaymentStatusPaid === true ||
    String(lockedSession.paymentStatus || '').trim() === 'paid' ||
    Boolean(paymentIntentId);

  const finalizedSession = await markFinalizeSucceeded({
    checkoutId: normalizedId,
    bookingId: workBookingId,
    now: at,
    setPaymentStatusPaid: shouldSetPaid && Boolean(paymentIntentId)
  });

  return {
    ok: true,
    bookingId: String(toObjectId(workBookingId)),
    booking: workResult?.booking ?? null,
    checkoutId: normalizedId,
    idempotentReplay: workerIdempotentReplay,
    session: finalizedSession
  };
}

async function assertCheckoutSessionReadyForFinalize({
  checkoutId,
  paymentIntentId = null,
  bookingPayload = null,
  paidFinalizeOverride = false,
  recoveryCommercialStayIdentity = null
}) {
  const session = await loadFinalizableCheckoutSession({
    checkoutId,
    paidFinalizeOverride,
    recoveryCommercialStayIdentity
  });
  await assertPaymentIntentReadyForFinalize(session, paymentIntentId, {
    paidFinalizeOverride:
      paidFinalizeOverride === true || isPaidFinalizeOverrideEligible(session, false)
  });

  const sessionWithFingerprint = await ensureCheckoutSessionStayFingerprint({
    checkoutId,
    bookingPayload,
    paidFinalizeOverride:
      paidFinalizeOverride === true || isPaidFinalizeOverrideEligible(session, false),
    recoveryCommercialStayIdentity
  });

  const identities = deriveCommercialStayGuardIdentities(
    sessionWithFingerprint,
    recoveryCommercialStayIdentity
  );
  await assertNoCommercialStayConflict({
    commercialStayFingerprint: String(sessionWithFingerprint.stayFingerprint).trim(),
    checkoutId: sessionWithFingerprint.checkoutId,
    bookingId: bookingPayload?.bookingId ?? bookingPayload?._id ?? null,
    checkoutSessionId: identities.checkoutSessionId,
    paymentIntentId:
      identities.paymentIntentId ||
      (paymentIntentId != null ? String(paymentIntentId) : null),
    cabinTypeId: identities.cabinTypeId,
    evidenceDigest: identities.evidenceDigest
  });

  return { ok: true, session: sessionWithFingerprint };
}

module.exports = {
  FINALIZE_STATUS,
  NO_PAYMENT_CANONICAL_PI_OPTIONAL_STATUSES,
  DEFAULT_FINALIZE_LOCK_VISIBILITY_MS,
  getFinalizeLockVisibilityMs,
  isPaidFinalizeOverrideEligible,
  buildFinalizeReplayResponse,
  deriveCommercialStayFingerprintForFinalize,
  ensureCheckoutSessionStayFingerprint,
  loadFinalizableCheckoutSession,
  reclaimStaleFinalizeLock,
  acquireFinalizeLock,
  releaseFinalizeLock,
  markFinalizeNeedsReview,
  markFinalizeSucceeded,
  assertCheckoutSessionReadyForFinalize,
  runCheckoutFinalizeOrchestration
};
