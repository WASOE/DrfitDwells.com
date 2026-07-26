const CheckoutSession = require('../models/CheckoutSession');
const featureFlags = require('../utils/featureFlags');
const {
  ensureCanonicalPaymentIntent: ensureCanonicalPaymentIntentDefault,
  assertCanonicalPaymentIntentForSession
} = require('../services/checkout/checkoutCanonicalPaymentIntentService');

let ensureCanonicalPaymentIntentFn = ensureCanonicalPaymentIntentDefault;
const {
  getCheckoutSessionState,
  loadSessionOrThrow,
  assertSessionUsable,
  CHECKOUT_SESSION_ERROR_CODES
} = require('../services/checkout/checkoutSessionService');
const { isCheckoutSessionError, CheckoutSessionError } = require('../services/checkout/checkoutSessionErrors');
const {
  CHECKOUT_SESSION_C3_ERROR_HTTP_STATUS,
  mapCheckoutSessionErrorToHttpStatus: mapFinalizeCheckoutSessionErrorToHttpStatus
} = require('../services/checkout/checkoutFinalizeHttpAdapter');

const STRIPE_MINIMUM_CHARGE_CENTS = 50;

const NO_PAYMENT_FINALIZE_STATUSES = new Set(['voucher_only_reserved', 'payment_not_required']);

const ROUTE_AMOUNT_ERROR_CODES = {
  CHECKOUT_INVALID_AMOUNT: 'CHECKOUT_INVALID_AMOUNT',
  CHECKOUT_AMOUNT_BELOW_STRIPE_MINIMUM: 'CHECKOUT_AMOUNT_BELOW_STRIPE_MINIMUM'
};

const CHECKOUT_SESSION_ERROR_HTTP = {
  [CHECKOUT_SESSION_ERROR_CODES.INVALID_CHECKOUT_ID]: 400,
  [CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_FOUND]: 404,
  [CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_EXPIRED]: 410,
  [CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_SUPERSEDED]: 409,
  [CHECKOUT_SESSION_ERROR_CODES.COMMERCIAL_BOUNDARY_CHANGED]: 409,
  [CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE]: 409,
  [CHECKOUT_SESSION_ERROR_CODES.SUPERSEDED_PAYMENT_INTENT]: 409,
  [CHECKOUT_SESSION_ERROR_CODES.CANONICAL_PAYMENT_INTENT_MISMATCH]: 409,
  [CHECKOUT_SESSION_ERROR_CODES.STALE_CLIENT_SECRET]: 409,
  [CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_CONCURRENCY_CONFLICT]: 409,
  [CHECKOUT_SESSION_ERROR_CODES.VOUCHER_PAYMENT_INTENT_ATTACH_FAILED]: 409,
  ...CHECKOUT_SESSION_C3_ERROR_HTTP_STATUS
};

function mapCheckoutSessionErrorToHttp(err) {
  const code = err?.code || CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE;
  const status =
    mapFinalizeCheckoutSessionErrorToHttpStatus(code, err) ??
    CHECKOUT_SESSION_ERROR_HTTP[code] ??
    409;
  return {
    status,
    body: {
      success: false,
      code,
      message: err?.message || code,
      details: err?.details ?? null
    }
  };
}

function sendCheckoutSessionError(res, err) {
  if (isCheckoutSessionError(err)) {
    const mapped = mapCheckoutSessionErrorToHttp(err);
    return res.status(mapped.status).json(mapped.body);
  }
  throw err;
}

/**
 * V2 when an existing session is pinned to flowVersion v2, else when env flag is on.
 */
async function shouldUseCheckoutSessionV2(checkoutId) {
  const normalized =
    typeof checkoutId === 'string' && checkoutId.trim() ? checkoutId.trim() : null;
  if (normalized) {
    const session = await CheckoutSession.findOne({ checkoutId: normalized })
      .select('flowVersion')
      .lean();
    if (session?.flowVersion === 'v2') {
      return true;
    }
  }
  return featureFlags.isCheckoutSessionV2Enabled();
}

function buildEnsureQuoteFromPublicResult(quoteResult) {
  return {
    entityType: quoteResult.entityType,
    entity: quoteResult.entity,
    checkInDate: quoteResult.checkInDate,
    checkOutDate: quoteResult.checkOutDate,
    subtotalPrice: quoteResult.subtotalPrice,
    discountAmount: quoteResult.discountAmount,
    totalPrice: quoteResult.totalPrice,
    appliedPromoCode: quoteResult.appliedPromoCode,
    promo: quoteResult.promo,
    voucherAppliedCents: quoteResult.voucherAppliedCents,
    remainingDueCents: quoteResult.remainingDueCents,
    fullVoucherCoverage: quoteResult.fullVoucherCoverage
  };
}

function formatPublicCheckoutSessionState(state) {
  if (!state) return null;
  const sessionStatus = state.status;
  return {
    checkoutId: state.checkoutId,
    flowVersion: state.flowVersion,
    sessionStatus,
    paymentStatus: state.paymentStatus,
    quoteSnapshotHash: state.quoteSnapshotHash,
    sessionVersion: state.sessionVersion,
    canonicalPaymentIntentId: state.canonicalPaymentIntentId,
    stripeAmountCents: state.stripeAmountCents,
    giftVoucherAppliedCents: state.giftVoucherAppliedCents,
    fullVoucherCoverage: Boolean(state.fullVoucherCoverage),
    voucherRedemptionId: state.voucherRedemptionId || null,
    noPaymentRequired:
      sessionStatus === 'voucher_only_reserved' || sessionStatus === 'payment_not_required',
    expiresAt: state.expiresAt
  };
}

function formatV2CreatePaymentIntentResponse(dto) {
  return {
    success: true,
    checkoutId: dto.checkoutId,
    flowVersion: dto.flowVersion,
    sessionStatus: dto.sessionStatus,
    paymentStatus: dto.paymentStatus,
    quoteSnapshotHash: dto.quoteSnapshotHash,
    sessionVersion: dto.sessionVersion,
    clientSecret: dto.clientSecret ?? null,
    canonicalPaymentIntentId: dto.canonicalPaymentIntentId ?? null,
    stripeAmountCents: dto.stripeAmountCents,
    giftVoucherAppliedCents: dto.giftVoucherAppliedCents,
    fullVoucherCoverage: Boolean(dto.fullVoucherCoverage),
    voucherRedemptionId: dto.voucherRedemptionId ?? null,
    idempotentReplay: Boolean(dto.idempotentReplay),
    noPaymentRequired: Boolean(dto.noPaymentRequired)
  };
}

/**
 * Effective card-due cents from buildPublicBookingQuote (matches snapshot / ensure inputs).
 */
function resolveRemainingCardAmountCents(quoteResult) {
  if (quoteResult.fullVoucherCoverage) {
    return 0;
  }
  if (quoteResult.remainingDueCents != null) {
    return Number(quoteResult.remainingDueCents);
  }
  return Math.round(Number(quoteResult.totalPrice) * 100);
}

function cardPaymentRequiredFromQuote(quoteResult) {
  return !quoteResult.fullVoucherCoverage && resolveRemainingCardAmountCents(quoteResult) > 0;
}

/**
 * Guards card-due amounts before ensureCanonicalPaymentIntent (V2 only).
 */
function validateV2QuoteAmountsBeforeEnsure(quoteResult) {
  const totalPrice = Number(quoteResult.totalPrice);
  if (!Number.isFinite(totalPrice) || totalPrice < 0) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        code: ROUTE_AMOUNT_ERROR_CODES.CHECKOUT_INVALID_AMOUNT,
        message: 'Booking amount is invalid',
        details: { totalPrice: quoteResult.totalPrice }
      }
    };
  }

  const stripeAmountCents = resolveRemainingCardAmountCents(quoteResult);
  if (!Number.isFinite(stripeAmountCents)) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        code: ROUTE_AMOUNT_ERROR_CODES.CHECKOUT_INVALID_AMOUNT,
        message: 'Booking amount is invalid',
        details: {
          stripeAmountCents: quoteResult.remainingDueCents ?? quoteResult.totalPrice
        }
      }
    };
  }

  if (stripeAmountCents < 0) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        code: ROUTE_AMOUNT_ERROR_CODES.CHECKOUT_INVALID_AMOUNT,
        message: 'Booking amount is invalid',
        details: { stripeAmountCents }
      }
    };
  }

  const needsCard = !quoteResult.fullVoucherCoverage && stripeAmountCents > 0;
  if (needsCard && stripeAmountCents < STRIPE_MINIMUM_CHARGE_CENTS) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        code: ROUTE_AMOUNT_ERROR_CODES.CHECKOUT_AMOUNT_BELOW_STRIPE_MINIMUM,
        message: 'Card payment amount is below the minimum charge amount',
        details: { stripeAmountCents }
      }
    };
  }

  return { ok: true, stripeAmountCents, needsCard };
}

/**
 * V2 CheckoutSession finalization guard (C2D-B). No-op when no session or non-v2 flow.
 */
async function assertV2CheckoutSessionCanFinalize({ checkoutId, paymentIntentId = null }) {
  const normalized = typeof checkoutId === 'string' ? checkoutId.trim() : '';
  if (!normalized) {
    return { applied: false };
  }

  const sessionLean = await CheckoutSession.findOne({ checkoutId: normalized })
    .select(
      'checkoutId flowVersion status paymentStatus canonicalPaymentIntentId supersededPaymentIntentIds finalizeStatus expiresAt'
    )
    .lean();

  if (!sessionLean) {
    return { applied: false };
  }

  if (sessionLean.flowVersion !== 'v2') {
    return { applied: false };
  }

  const session = await loadSessionOrThrow(normalized);
  assertSessionUsable(session);

  const canonical = session.canonicalPaymentIntentId
    ? String(session.canonicalPaymentIntentId).trim()
    : null;
  const piId = paymentIntentId ? String(paymentIntentId).trim() : '';

  if (NO_PAYMENT_FINALIZE_STATUSES.has(session.status)) {
    if (!piId) {
      return { applied: true, ok: true, noPaymentRequired: true };
    }
    if (canonical) {
      await assertCanonicalPaymentIntentForSession({
        checkoutId: normalized,
        paymentIntentId: piId
      });
    }
    return { applied: true, ok: true, noPaymentRequired: true };
  }

  if (!canonical) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE,
      'Checkout session is not ready for payment finalization',
      { status: session.status }
    );
  }

  await assertCanonicalPaymentIntentForSession({
    checkoutId: normalized,
    paymentIntentId: piId
  });

  return { applied: true, ok: true, noPaymentRequired: false };
}

async function handleGetCheckoutSession(checkoutId) {
  const session = await loadSessionOrThrow(checkoutId);
  assertSessionUsable(session);
  const state = getCheckoutSessionState(session);
  return {
    ...state,
    voucherRedemptionId: session.voucherRedemptionId
      ? String(session.voucherRedemptionId)
      : null
  };
}

async function handleCreatePaymentIntentV2(req, stripeClient) {
  const quoteResult = await require('../services/bookingQuoteService').buildPublicBookingQuote(
    req.body
  );
  if (!quoteResult.ok) {
    return {
      ok: false,
      status: quoteResult.status,
      body: {
        success: false,
        message: quoteResult.message,
        errors: quoteResult.errors
      }
    };
  }

  const amountGuard = validateV2QuoteAmountsBeforeEnsure(quoteResult);
  if (!amountGuard.ok) {
    return {
      ok: false,
      status: amountGuard.status,
      body: amountGuard.body
    };
  }

  const { needsCard } = amountGuard;
  if (needsCard && !stripeClient) {
    return {
      ok: false,
      status: 503,
      body: {
        success: false,
        message: 'Payment is not configured'
      }
    };
  }

  const checkoutId =
    typeof req.body.checkoutId === 'string' && req.body.checkoutId.trim()
      ? req.body.checkoutId.trim()
      : null;

  const dto = await ensureCanonicalPaymentIntentFn({
    checkoutId,
    input: req.body,
    quote: buildEnsureQuoteFromPublicResult(quoteResult),
    stripe: stripeClient
  });

  try {
    const {
      recordServerCheckoutStarted,
      recordServerPaymentEvent
    } = require('../services/conversion/funnelEventService');
    const { formatSofiaDateOnly } = require('../utils/dateTime');
    const entity = quoteResult.entity || {};
    const checkInDateOnly = req.body.checkIn
      ? formatSofiaDateOnly(new Date(req.body.checkIn))
      : null;
    const checkOutDateOnly = req.body.checkOut
      ? formatSofiaDateOnly(new Date(req.body.checkOut))
      : null;
    const quotedTotalCents = Number.isFinite(Number(quoteResult.totalPrice))
      ? Math.round(Number(quoteResult.totalPrice) * 100)
      : null;
    void recordServerCheckoutStarted({
      checkoutId: dto.checkoutId || checkoutId,
      paymentId: dto.paymentIntentId || dto.canonicalPaymentIntentId || null,
      sessionKey: req.body.funnelSessionKey || null,
      visitorKey: req.body.funnelVisitorKey || null,
      cabinId: entity.cabinId || req.body.cabinId || null,
      cabinTypeId: entity.cabinTypeId || req.body.cabinTypeId || null,
      propertyKind: entity.propertyKind || null,
      checkInDateOnly,
      checkOutDateOnly,
      adults: req.body.adults,
      children: req.body.children,
      quotedTotalCents
    }).catch(() => {});
    if (dto.paymentIntentId || dto.canonicalPaymentIntentId) {
      void recordServerPaymentEvent({
        eventName: 'payment_started',
        paymentId: dto.paymentIntentId || dto.canonicalPaymentIntentId,
        stateCode: 'requires_payment_method',
        sessionKey: req.body.funnelSessionKey || null,
        visitorKey: req.body.funnelVisitorKey || null,
        checkoutId: dto.checkoutId || checkoutId,
        cabinId: entity.cabinId || req.body.cabinId || null,
        cabinTypeId: entity.cabinTypeId || req.body.cabinTypeId || null,
        propertyKind: entity.propertyKind || null,
        checkInDateOnly,
        checkOutDateOnly,
        quotedTotalCents,
        origin: 'api'
      }).catch(() => {});
    }
  } catch {
    /* analytics must never block PI create */
  }

  const guestEmail =
    req.body.guestEmail || req.body.guestInfo?.email || dto?.guestEmail || null;
  if (guestEmail) {
    const {
      scheduleSavedQuoteTask
    } = require('../services/savedQuotes/savedQuoteService');
    const { captureQuoteContactConsent } = require('../services/savedQuotes/quoteContactConsentService');
    scheduleSavedQuoteTask('capture-consent-on-pi', () =>
      captureQuoteContactConsent({
        email: guestEmail,
        quoteDeliveryRequested: req.body.quoteDeliveryRequested,
        bookingReminderConsent: req.body.bookingReminderConsent,
        marketingConsent: req.body.marketingConsent,
        sourceSurface: 'confirm_booking',
        checkoutSessionId: dto.checkoutId || checkoutId,
        propertyKind: quoteResult.entity?.propertyKind || null,
        recordDeclines: true
      })
    );
  }

  return {
    ok: true,
    status: 200,
    body: formatV2CreatePaymentIntentResponse(dto)
  };
}

module.exports = {
  mapCheckoutSessionErrorToHttp,
  sendCheckoutSessionError,
  shouldUseCheckoutSessionV2,
  assertV2CheckoutSessionCanFinalize,
  NO_PAYMENT_FINALIZE_STATUSES,
  buildEnsureQuoteFromPublicResult,
  formatPublicCheckoutSessionState,
  formatV2CreatePaymentIntentResponse,
  ROUTE_AMOUNT_ERROR_CODES,
  STRIPE_MINIMUM_CHARGE_CENTS,
  resolveRemainingCardAmountCents,
  validateV2QuoteAmountsBeforeEnsure,
  cardPaymentRequiredFromQuote,
  handleGetCheckoutSession,
  handleCreatePaymentIntentV2,
  __setEnsureCanonicalPaymentIntentForTesting(fn) {
    ensureCanonicalPaymentIntentFn = fn || ensureCanonicalPaymentIntentDefault;
  },
  __resetEnsureCanonicalPaymentIntentForTesting() {
    ensureCanonicalPaymentIntentFn = ensureCanonicalPaymentIntentDefault;
  }
};
