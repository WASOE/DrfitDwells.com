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
const {
  linkSavedQuoteToCheckout,
  scheduleSavedQuoteTask
} = require('../savedQuotes/savedQuoteService');
const {
  resolveSplitPaymentOfferForCheckout,
  PaymentScheduleError
} = require('../paymentScheduleService');
const {
  reserveStayCredit,
  releaseStayCreditReservation,
  StayCreditError
} = require('../stayCreditService');

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
    stayCreditCode: normalizePromoOrVoucherCode(input.stayCreditCode),
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
 * SP7B: reserve StayCredit when checkout applies it. Quote preview must not call this.
 * Returns authoritative reserved cents wired onto the quote before snapshot/payable.
 */
async function applyAuthoritativeStayCreditReservation({
  checkoutId,
  expiresAt,
  guestEmail,
  stayCreditCode,
  requestedApplyCents = null,
  priorCheckoutSessionId = null
} = {}) {
  const code = stayCreditCode ? String(stayCreditCode).trim().toUpperCase() : '';
  if (!code) {
    if (priorCheckoutSessionId || checkoutId) {
      try {
        await releaseStayCreditReservation({
          checkoutSessionId: String(priorCheckoutSessionId || checkoutId),
          reason: 'stay_credit_cleared_from_checkout'
        });
      } catch (err) {
        if (!(err instanceof StayCreditError && err.code === 'RESERVATION_CONSUMED')) {
          // Non-fatal clear: consumed reservations must not release.
        }
      }
    }
    return {
      stayCreditAppliedCents: 0,
      stayCreditCode: null,
      stayCreditId: null,
      stayCreditReservationId: null
    };
  }

  if (!guestEmail) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE,
      'Guest email is required to reserve stay credit'
    );
  }

  try {
    const { reservation, stayCredit } = await reserveStayCredit({
      code,
      amountCents:
        requestedApplyCents != null && Number(requestedApplyCents) > 0
          ? Math.trunc(Number(requestedApplyCents))
          : null,
      checkoutSessionId: String(checkoutId),
      guestEmail,
      expiresAt
    });
    return {
      stayCreditAppliedCents: Math.trunc(Number(reservation.amountCents)),
      stayCreditCode: String(stayCredit.code || reservation.stayCreditCode),
      stayCreditId: reservation.stayCreditId || stayCredit._id,
      stayCreditReservationId: reservation._id
    };
  } catch (err) {
    if (err instanceof StayCreditError) {
      throw new CheckoutSessionError(
        CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE,
        err.message || 'Stay credit reservation failed',
        { stayCreditCode: code, stayCreditError: err.code }
      );
    }
    throw err;
  }
}

function withAuthoritativeStayCreditOnQuote(quote, reservation) {
  const next = quote && typeof quote === 'object' ? { ...quote } : {};
  next.stayCreditAppliedCents = reservation.stayCreditAppliedCents || 0;
  next.stayCreditCode = reservation.stayCreditCode || null;
  next.stayCreditId = reservation.stayCreditId || null;
  if (next.stayCreditAppliedCents > 0 && next.remainingDueCents != null) {
    // Rebuild remaining due from commercial total when present.
    const total =
      next.totalValueCents != null
        ? Number(next.totalValueCents)
        : next.totalPrice != null
          ? Math.round(Number(next.totalPrice) * 100)
          : null;
    const voucher = Math.max(0, Number(next.voucherAppliedCents) || 0);
    if (Number.isFinite(total)) {
      next.remainingDueCents = Math.max(
        0,
        Math.trunc(total) - voucher - reservation.stayCreditAppliedCents
      );
    }
  }
  return next;
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
 * Optional `checkoutId` lets a client-minted identity be adopted on cold start.
 */
async function createCheckoutSession({ input, quote, metadata = null, checkoutId = null } = {}) {
  const normalizedInput = normalizeCheckoutSessionInput(input);
  const resolvedCheckoutId =
    typeof checkoutId === 'string' && checkoutId.trim()
      ? (() => {
          assertValidCheckoutId(checkoutId.trim());
          return checkoutId.trim();
        })()
      : mintCheckoutId();

  const expiresAt = computeExpiresAt();
  const stayReservation = await applyAuthoritativeStayCreditReservation({
    checkoutId: resolvedCheckoutId,
    expiresAt,
    guestEmail: normalizedInput.guestEmail,
    stayCreditCode:
      (quote && quote.stayCreditCode) ||
      normalizedInput.stayCreditCode ||
      null,
    requestedApplyCents: quote && quote.stayCreditAppliedCents != null
      ? quote.stayCreditAppliedCents
      : null
  });
  const authoritativeQuote = withAuthoritativeStayCreditOnQuote(quote, stayReservation);
  const quoteSnapshot = buildQuoteSnapshot({
    normalizedInput,
    quote: authoritativeQuote
  });
  // Pin reservation fields on snapshot even if quote builder omitted id.
  quoteSnapshot.stayCreditAppliedCents = stayReservation.stayCreditAppliedCents;
  quoteSnapshot.stayCreditCode = stayReservation.stayCreditCode || '';
  quoteSnapshot.stayCreditId = stayReservation.stayCreditId || null;
  if (stayReservation.stayCreditAppliedCents > 0) {
    const voucher = Math.max(0, Number(quoteSnapshot.voucherAppliedCents) || 0);
    const total = Math.max(0, Number(quoteSnapshot.totalValueCents) || 0);
    quoteSnapshot.stripeAmountCents = Math.max(
      0,
      total - voucher - stayReservation.stayCreditAppliedCents
    );
  }
  const quoteSnapshotHash = hashQuoteSnapshot(quoteSnapshot);
  const payable = resolvePayableState(quoteSnapshot);

  const splitOffer = await resolveSplitPaymentOfferForCheckout({
    quote: authoritativeQuote,
    quoteSnapshot,
    stripeAmountCents: payable.stripeAmountCents
  });

  const session = await CheckoutSession.create({
    checkoutId: resolvedCheckoutId,
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
    stayCreditAppliedCents: stayReservation.stayCreditAppliedCents || 0,
    stayCreditCode: stayReservation.stayCreditCode || null,
    stayCreditId: stayReservation.stayCreditId || null,
    stayCreditReservationId: stayReservation.stayCreditReservationId || null,
    splitPaymentOfferSnapshot: splitOffer.splitPaymentOfferSnapshot,
    splitPaymentOfferSnapshotHash: splitOffer.splitPaymentOfferSnapshotHash,
    canonicalPaymentIntentId: null,
    expiresAt,
    sessionVersion: 1,
    metadata: {
      commercialBoundaryKey: buildCommercialBoundaryKey(normalizedInput),
      ...(metadata && typeof metadata === 'object' ? metadata : {})
    }
  });

  scheduleSavedQuoteTask('link-checkout-create', () =>
    linkSavedQuoteToCheckout({
      checkoutId: session.checkoutId,
      checkoutSessionId: session._id,
      checkoutExpiresAt: session.expiresAt,
      sessionKey: normalizedInput.funnelSessionKey || metadata?.funnelSessionKey || null,
      visitorKey: normalizedInput.funnelVisitorKey || metadata?.funnelVisitorKey || null,
      cabinId: quoteSnapshot.cabinId || null,
      cabinTypeId: quoteSnapshot.cabinTypeId || null,
      checkInDateOnly: quoteSnapshot.checkInDateOnly,
      checkOutDateOnly: quoteSnapshot.checkOutDateOnly,
      adults: quoteSnapshot.adults,
      children: quoteSnapshot.children,
      quotedTotalCents: quoteSnapshot.totalValueCents,
      guestEmail: normalizedInput.guestEmail || null
    })
  );

  return {
    session,
    quoteSnapshotHash,
    requiresPaymentIntentRefresh: false,
    created: true
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

  const stayReservation = await applyAuthoritativeStayCreditReservation({
    checkoutId: String(checkoutId),
    expiresAt: session.expiresAt || computeExpiresAt(),
    guestEmail: normalizedInput.guestEmail || session.guestEmail,
    stayCreditCode:
      (quote && quote.stayCreditCode) ||
      normalizedInput.stayCreditCode ||
      null,
    requestedApplyCents: quote && quote.stayCreditAppliedCents != null
      ? quote.stayCreditAppliedCents
      : null,
    priorCheckoutSessionId: String(checkoutId)
  });
  const authoritativeQuote = withAuthoritativeStayCreditOnQuote(quote, stayReservation);
  const quoteSnapshot = buildQuoteSnapshot({
    normalizedInput,
    quote: authoritativeQuote
  });
  quoteSnapshot.stayCreditAppliedCents = stayReservation.stayCreditAppliedCents;
  quoteSnapshot.stayCreditCode = stayReservation.stayCreditCode || '';
  quoteSnapshot.stayCreditId = stayReservation.stayCreditId || null;
  if (stayReservation.stayCreditAppliedCents > 0) {
    const voucher = Math.max(0, Number(quoteSnapshot.voucherAppliedCents) || 0);
    const total = Math.max(0, Number(quoteSnapshot.totalValueCents) || 0);
    quoteSnapshot.stripeAmountCents = Math.max(
      0,
      total - voucher - stayReservation.stayCreditAppliedCents
    );
  }
  const quoteSnapshotHash = hashQuoteSnapshot(quoteSnapshot);
  const payable = resolvePayableState(quoteSnapshot);
  const hashChanged = previousQuoteSnapshotHash !== quoteSnapshotHash;
  const requiresPaymentIntentRefresh =
    hashChanged && Boolean(session.canonicalPaymentIntentId);

  const splitOffer = await resolveSplitPaymentOfferForCheckout({
    quote: authoritativeQuote,
    quoteSnapshot,
    stripeAmountCents: payable.stripeAmountCents
  });

  const {
    sessionHasSnapshotProtectedLease,
    snapshotWriteAllowedWithoutProtectedLeasePredicate,
    toCheckoutSessionLeaseActiveError
  } = require('./checkoutResourceLeaseService');

  // Exact same-hash refresh with a protected lease: idempotent no-op.
  // Must not replace lease identity or reduce expiry.
  // Offer fields are left unchanged on this path (commercial hash unchanged).
  if (!hashChanged && sessionHasSnapshotProtectedLease(session)) {
    return {
      session,
      previousQuoteSnapshotHash,
      quoteSnapshotHash,
      quoteSnapshotHashChanged: false,
      requiresPaymentIntentRefresh: false,
      created: false,
      idempotentLeaseProtectedRefresh: true
    };
  }

  if (hashChanged && sessionHasSnapshotProtectedLease(session)) {
    throw toCheckoutSessionLeaseActiveError();
  }

  const expectedSessionVersion = Number(session.sessionVersion || 1);
  const nowIso = new Date().toISOString();
  const nextMetadata = {
    ...(session.metadata || {}),
    commercialBoundaryKey: incomingBoundary,
    lastQuoteRefreshAt: nowIso
  };

  // Atomic Mongo predicate — JS precheck alone is insufficient (B8F3 TOCTOU close).
  const updated = await CheckoutSession.findOneAndUpdate(
    {
      checkoutId: String(checkoutId),
      sessionVersion: expectedSessionVersion,
      ...snapshotWriteAllowedWithoutProtectedLeasePredicate()
    },
    {
      $set: {
        quoteSnapshot,
        quoteSnapshotHash,
        stayFingerprint: buildStayFingerprint(normalizedInput),
        replayFingerprint: buildReplayFingerprint(normalizedInput),
        guestEmail: normalizedInput.guestEmail || session.guestEmail,
        stripeAmountCents: payable.stripeAmountCents,
        giftVoucherAppliedCents: quoteSnapshot.voucherAppliedCents,
        stayCreditAppliedCents: stayReservation.stayCreditAppliedCents || 0,
        stayCreditCode: stayReservation.stayCreditCode || null,
        stayCreditId: stayReservation.stayCreditId || null,
        stayCreditReservationId: stayReservation.stayCreditReservationId || null,
        splitPaymentOfferSnapshot: splitOffer.splitPaymentOfferSnapshot,
        splitPaymentOfferSnapshotHash: splitOffer.splitPaymentOfferSnapshotHash,
        status: payable.status,
        paymentStatus: payable.paymentStatus,
        metadata: nextMetadata
      },
      $inc: { sessionVersion: 1 }
    },
    { new: true }
  );

  if (!updated) {
    const latest = await CheckoutSession.findOne({ checkoutId: String(checkoutId) });
    if (latest && sessionHasSnapshotProtectedLease(latest)) {
      // Race: lease attached between precheck and update — commercial lease wins.
      if (String(latest.quoteSnapshotHash) === String(quoteSnapshotHash)) {
        return {
          session: latest,
          previousQuoteSnapshotHash,
          quoteSnapshotHash: latest.quoteSnapshotHash,
          quoteSnapshotHashChanged: false,
          requiresPaymentIntentRefresh: false,
          created: false,
          idempotentLeaseProtectedRefresh: true
        };
      }
      throw toCheckoutSessionLeaseActiveError();
    }
    // Same-hash concurrent refresh: another writer already applied the same commercial
    // snapshot — treat as idempotent success (preserves gate-off ensure races).
    if (latest && String(latest.quoteSnapshotHash) === String(quoteSnapshotHash)) {
      return {
        session: latest,
        previousQuoteSnapshotHash,
        quoteSnapshotHash: latest.quoteSnapshotHash,
        quoteSnapshotHashChanged: false,
        requiresPaymentIntentRefresh: Boolean(
          previousQuoteSnapshotHash !== latest.quoteSnapshotHash &&
            latest.canonicalPaymentIntentId
        ),
        created: false,
        idempotentConcurrentRefresh: true
      };
    }
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_CONCURRENCY_CONFLICT,
      'Checkout session quote refresh lost a concurrency race',
      { checkoutId: String(checkoutId), expectedSessionVersion }
    );
  }

  scheduleSavedQuoteTask('link-checkout-refresh', () =>
    linkSavedQuoteToCheckout({
      checkoutId: updated.checkoutId,
      checkoutSessionId: updated._id,
      checkoutExpiresAt: updated.expiresAt,
      cabinId: quoteSnapshot.cabinId || null,
      cabinTypeId: quoteSnapshot.cabinTypeId || null,
      checkInDateOnly: quoteSnapshot.checkInDateOnly,
      checkOutDateOnly: quoteSnapshot.checkOutDateOnly,
      adults: quoteSnapshot.adults,
      children: quoteSnapshot.children,
      quotedTotalCents: quoteSnapshot.totalValueCents,
      guestEmail: updated.guestEmail || normalizedInput.guestEmail || null
    })
  );

  return {
    session: updated,
    previousQuoteSnapshotHash,
    quoteSnapshotHash,
    quoteSnapshotHashChanged: hashChanged,
    requiresPaymentIntentRefresh,
    created: false
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
    finalizeIntentHash: session.finalizeIntentHash || null,
    finalizeIntentCapturedAt: session.finalizeIntentCapturedAt || null,
    expiresAt: session.expiresAt,
    guestEmail: session.guestEmail || null,
    stayFingerprint: session.stayFingerprint || null,
    replayFingerprint: session.replayFingerprint || null,
    paymentChoice: session.paymentChoice?.choice || 'full',
    splitPaymentOffer: (() => {
      try {
        const { formatPublicSplitOffer } = require('../splitPaymentChoiceService');
        return formatPublicSplitOffer(session);
      } catch {
        return null;
      }
    })()
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
  isSessionExpired,
  PaymentScheduleError
};
