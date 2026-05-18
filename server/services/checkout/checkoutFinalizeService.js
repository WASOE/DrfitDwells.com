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

function normalizeCheckoutId(checkoutId) {
  return String(checkoutId || '').trim();
}

function normalizeNow(now) {
  return now instanceof Date ? now : new Date();
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

function assertV2Flow(session) {
  if (session.flowVersion !== 'v2') {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE,
      'Checkout session is not a V2 flow session',
      { flowVersion: session.flowVersion }
    );
  }
}

function buildAcquireLockFilter(checkoutId, expectedSessionVersion, now) {
  const filter = {
    checkoutId: normalizeCheckoutId(checkoutId),
    flowVersion: 'v2',
    finalizeStatus: FINALIZE_STATUS.OPEN,
    status: { $nin: BLOCKED_ACQUIRE_SESSION_STATUSES },
    $or: [
      { expiresAt: null },
      { expiresAt: { $exists: false } },
      { expiresAt: { $gte: now } }
    ]
  };
  if (expectedSessionVersion != null && expectedSessionVersion !== '') {
    filter.sessionVersion = Number(expectedSessionVersion);
  }
  return filter;
}

function classifyAcquireLockFailure(session) {
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

  if (
    session.finalizeStatus === FINALIZE_STATUS.NEEDS_REVIEW ||
    session.status === 'needs_review'
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

  if (isSessionExpired(session)) {
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

async function loadFinalizableCheckoutSession({ checkoutId }) {
  const session = await loadSessionOrThrow(checkoutId);
  assertV2Flow(session);
  assertSessionUsable(session);
  return session;
}

async function acquireFinalizeLock({ checkoutId, expectedSessionVersion, now = new Date() }) {
  const at = normalizeNow(now);
  const normalizedId = normalizeCheckoutId(checkoutId);
  if (!normalizedId) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.INVALID_CHECKOUT_ID,
      'checkoutId is required'
    );
  }

  const filter = buildAcquireLockFilter(normalizedId, expectedSessionVersion, at);
  const updated = await CheckoutSession.findOneAndUpdate(
    filter,
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
  classifyAcquireLockFailure(current);
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

async function markFinalizeSucceeded({ checkoutId, bookingId, now = new Date() }) {
  const normalizedId = normalizeCheckoutId(checkoutId);
  const bookingObjectId = toObjectId(bookingId);
  if (!bookingObjectId) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE,
      'bookingId is required to mark finalize succeeded'
    );
  }

  const at = normalizeNow(now);
  const updated = await CheckoutSession.findOneAndUpdate(
    { checkoutId: normalizedId, finalizeStatus: FINALIZE_STATUS.IN_PROGRESS },
    {
      $set: {
        finalizeStatus: FINALIZE_STATUS.FINALIZED,
        bookingId: bookingObjectId,
        finalizedAt: at
      },
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

async function assertPaymentIntentReadyForFinalize(session, paymentIntentId) {
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
        paymentIntentId: piId
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
    paymentIntentId: piId
  });
}

async function assertCheckoutSessionReadyForFinalize({
  checkoutId,
  paymentIntentId = null,
  bookingPayload = null
}) {
  const session = await loadFinalizableCheckoutSession({ checkoutId });
  await assertPaymentIntentReadyForFinalize(session, paymentIntentId);

  const fingerprint = session.stayFingerprint;
  if (fingerprint) {
    await assertNoCommercialStayConflict({
      commercialStayFingerprint: fingerprint,
      checkoutId: session.checkoutId,
      bookingId: bookingPayload?.bookingId ?? bookingPayload?._id ?? null
    });
  }

  return { ok: true, session };
}

module.exports = {
  FINALIZE_STATUS,
  NO_PAYMENT_CANONICAL_PI_OPTIONAL_STATUSES,
  buildFinalizeReplayResponse,
  loadFinalizableCheckoutSession,
  acquireFinalizeLock,
  releaseFinalizeLock,
  markFinalizeNeedsReview,
  markFinalizeSucceeded,
  assertCheckoutSessionReadyForFinalize
};
