const crypto = require('crypto');
const CheckoutSession = require('../../models/CheckoutSession');
const { CheckoutSessionError, CHECKOUT_SESSION_ERROR_CODES } = require('./checkoutSessionErrors');
const {
  buildCommercialBoundaryKey,
  buildStayFingerprint,
  buildReplayFingerprint,
  boundaryKeyFromSnapshot,
  toDateOnly
} = require('./checkoutSessionFingerprints');
const { buildQuoteSnapshot, hashQuoteSnapshot } = require('./checkoutSessionSnapshot');

const CHECKOUT_ID_PATTERN = /^[A-Za-z0-9:_-]{8,128}$/;
const DEFAULT_SESSION_TTL_MS = 48 * 60 * 60 * 1000;

function mintCheckoutId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `chk_${crypto.randomBytes(16).toString('hex')}`;
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePromoOrVoucherCode(value) {
  const trimmed = trimString(value);
  return trimmed ? trimmed.toUpperCase() : '';
}

function normalizeExperienceKeys(keys) {
  const list = Array.isArray(keys) ? keys.map((k) => trimString(k)).filter(Boolean) : [];
  return [...new Set(list)].sort();
}

function parseGuestCount(value, fallback = 0) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Normalize raw checkout input without mutating the caller object.
 */
function normalizeCheckoutSessionInput(input = {}) {
  const cabinId = input.cabinId != null ? String(input.cabinId).trim() : '';
  const cabinTypeId = input.cabinTypeId != null ? String(input.cabinTypeId).trim() : '';
  const entityType = cabinTypeId && !cabinId ? 'cabinType' : 'cabin';

  const checkInDateOnly = toDateOnly(input.checkIn);
  const checkOutDateOnly = toDateOnly(input.checkOut);

  const normalized = {
    cabinId: cabinId || null,
    cabinTypeId: cabinTypeId || null,
    entityType,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    checkInDateOnly,
    checkOutDateOnly,
    adults: parseGuestCount(input.adults, 1),
    children: parseGuestCount(input.children, 0),
    experienceKeys: normalizeExperienceKeys(input.experienceKeys),
    transportMethod: trimString(input.transportMethod),
    romanticSetup: Boolean(input.romanticSetup),
    promoCode: normalizePromoOrVoucherCode(input.promoCode),
    voucherCode: normalizePromoOrVoucherCode(input.voucherCode),
    guestEmail: trimString(input.guestEmail).toLowerCase() || null
  };

  return normalized;
}

function assertValidCheckoutId(checkoutId) {
  if (!checkoutId || !CHECKOUT_ID_PATTERN.test(String(checkoutId))) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.INVALID_CHECKOUT_ID,
      'Invalid checkout session id'
    );
  }
}

function resolvePayableState(snapshot) {
  const stripeAmountCents = Math.max(0, Number(snapshot.stripeAmountCents || 0));
  const voucherAppliedCents = Math.max(0, Number(snapshot.voucherAppliedCents || 0));
  const fullVoucher =
    Boolean(snapshot.fullVoucherCoverage) &&
    stripeAmountCents === 0 &&
    voucherAppliedCents > 0;

  if (fullVoucher) {
    return {
      status: 'voucher_only_reserved',
      paymentStatus: 'not_required',
      stripeAmountCents: 0
    };
  }

  if (stripeAmountCents > 0) {
    return {
      status: 'payment_required',
      paymentStatus: 'unpaid',
      stripeAmountCents
    };
  }

  // Zero due without voucher reservation (e.g. 100% promo): no Stripe card, not finalized yet.
  return {
    status: 'payment_not_required',
    paymentStatus: 'not_required',
    stripeAmountCents: 0
  };
}

function computeExpiresAt(fromDate = new Date()) {
  return new Date(fromDate.getTime() + DEFAULT_SESSION_TTL_MS);
}

function isSessionExpired(session, now = new Date()) {
  return Boolean(session?.expiresAt && new Date(session.expiresAt) < now);
}

/**
 * Shared guard for load/mutate paths.
 */
function assertSessionUsable(session) {
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

  if (isSessionExpired(session)) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_EXPIRED,
      'Checkout session has expired'
    );
  }

  if (session.status === 'needs_review') {
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

async function loadSessionOrThrow(checkoutId) {
  assertValidCheckoutId(checkoutId);
  const session = await CheckoutSession.findOne({ checkoutId: String(checkoutId) });
  if (!session) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_FOUND,
      'Checkout session not found'
    );
  }
  return session;
}

/**
 * Create session after a successful quote (C2D: first payment-intent request).
 * Skips `quoted` — payable state is set immediately from snapshot cents.
 */
async function createCheckoutSession({ input, quote, metadata = null }) {
  const normalizedInput = normalizeCheckoutSessionInput(input);
  const quoteSnapshot = buildQuoteSnapshot({ normalizedInput, quote });
  const quoteSnapshotHash = hashQuoteSnapshot(quoteSnapshot);
  const payable = resolvePayableState(quoteSnapshot);

  const session = await CheckoutSession.create({
    checkoutId: mintCheckoutId(),
    flowVersion: 'v2',
    status: payable.status,
    paymentStatus: payable.paymentStatus,
    stayFingerprint: buildStayFingerprint(normalizedInput),
    replayFingerprint: buildReplayFingerprint(normalizedInput),
    guestEmail: normalizedInput.guestEmail,
    quoteSnapshot,
    quoteSnapshotHash,
    stripeAmountCents: payable.stripeAmountCents,
    giftVoucherAppliedCents: quoteSnapshot.voucherAppliedCents,
    canonicalPaymentIntentId: null,
    expiresAt: computeExpiresAt(),
    sessionVersion: 1,
    metadata: {
      commercialBoundaryKey: buildCommercialBoundaryKey(normalizedInput),
      ...(metadata && typeof metadata === 'object' ? metadata : {})
    }
  });

  return {
    session,
    quoteSnapshotHash,
    requiresPaymentIntentRefresh: false
  };
}

async function refreshCheckoutSessionQuote({ checkoutId, input, quote }) {
  const session = await loadSessionOrThrow(checkoutId);
  assertSessionUsable(session);

  const normalizedInput = normalizeCheckoutSessionInput(input);
  const incomingBoundary = buildCommercialBoundaryKey(normalizedInput);
  const storedBoundary =
    session.metadata?.commercialBoundaryKey || boundaryKeyFromSnapshot(session.quoteSnapshot);

  if (incomingBoundary !== storedBoundary) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.COMMERCIAL_BOUNDARY_CHANGED,
      'Commercial boundary changed; create a new checkout session',
      { storedBoundary, incomingBoundary }
    );
  }

  const previousQuoteSnapshotHash = session.quoteSnapshotHash;
  const quoteSnapshot = buildQuoteSnapshot({ normalizedInput, quote });
  const quoteSnapshotHash = hashQuoteSnapshot(quoteSnapshot);
  const payable = resolvePayableState(quoteSnapshot);
  const hashChanged = previousQuoteSnapshotHash !== quoteSnapshotHash;
  const requiresPaymentIntentRefresh =
    hashChanged && Boolean(session.canonicalPaymentIntentId);

  session.quoteSnapshot = quoteSnapshot;
  session.quoteSnapshotHash = quoteSnapshotHash;
  session.stayFingerprint = buildStayFingerprint(normalizedInput);
  session.replayFingerprint = buildReplayFingerprint(normalizedInput);
  session.guestEmail = normalizedInput.guestEmail || session.guestEmail;
  session.stripeAmountCents = payable.stripeAmountCents;
  session.giftVoucherAppliedCents = quoteSnapshot.voucherAppliedCents;
  session.status = payable.status;
  session.paymentStatus = payable.paymentStatus;
  session.sessionVersion = Number(session.sessionVersion || 1) + 1;
  session.metadata = {
    ...(session.metadata || {}),
    commercialBoundaryKey: incomingBoundary,
    lastQuoteRefreshAt: new Date().toISOString()
  };

  await session.save();

  return {
    session,
    previousQuoteSnapshotHash,
    quoteSnapshotHash,
    quoteSnapshotHashChanged: hashChanged,
    requiresPaymentIntentRefresh
  };
}

function getCheckoutSessionState(sessionDoc) {
  const session = sessionDoc?.toObject ? sessionDoc.toObject() : sessionDoc;
  if (!session) return null;

  return {
    checkoutId: session.checkoutId,
    flowVersion: session.flowVersion,
    status: session.status,
    paymentStatus: session.paymentStatus,
    finalizeStatus: session.finalizeStatus,
    quoteSnapshotHash: session.quoteSnapshotHash,
    sessionVersion: session.sessionVersion,
    stripeAmountCents: session.stripeAmountCents,
    giftVoucherAppliedCents: session.giftVoucherAppliedCents,
    fullVoucherCoverage: Boolean(session.quoteSnapshot?.fullVoucherCoverage),
    canonicalPaymentIntentId: session.canonicalPaymentIntentId || null,
    expiresAt: session.expiresAt,
    guestEmail: session.guestEmail || null,
    stayFingerprint: session.stayFingerprint || null,
    replayFingerprint: session.replayFingerprint || null
  };
}

async function getCheckoutSessionStateById(checkoutId) {
  const session = await loadSessionOrThrow(checkoutId);
  return getCheckoutSessionState(session);
}

module.exports = {
  CHECKOUT_ID_PATTERN,
  DEFAULT_SESSION_TTL_MS,
  CHECKOUT_SESSION_ERROR_CODES,
  CheckoutSessionError,
  normalizeCheckoutSessionInput,
  buildCommercialBoundaryKey,
  buildStayFingerprint,
  buildReplayFingerprint,
  buildQuoteSnapshot,
  hashQuoteSnapshot,
  createCheckoutSession,
  refreshCheckoutSessionQuote,
  getCheckoutSessionState,
  getCheckoutSessionStateById,
  assertSessionUsable,
  assertValidCheckoutId,
  loadSessionOrThrow,
  resolvePayableState,
  computeExpiresAt,
  isSessionExpired
};
