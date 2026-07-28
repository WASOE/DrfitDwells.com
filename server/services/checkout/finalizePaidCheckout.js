'use strict';

/**
 * Batch 4 — Authoritative paid checkout finalization domain service.
 * Binding: docs/checkout-payment-architecture/02_PAID_BOOKING_FINALIZATION_IMPLEMENTATION_SPEC.md §D
 *
 * Callers: frontend, future worker, reconcile, manual recovery.
 * No worker polling, no email redesign, no auto-refund, no new PaymentIntent.
 */

const Cabin = require('../../models/Cabin');
const CabinType = require('../../models/CabinType');
const Booking = require('../../models/Booking');
const CheckoutSession = require('../../models/CheckoutSession');
const GiftVoucherRedemption = require('../../models/GiftVoucherRedemption');
const {
  CHECKOUT_SESSION_ERROR_CODES,
  CheckoutSessionError
} = require('./checkoutSessionErrors');
const {
  FINALIZE_STATUS,
  NO_PAYMENT_CANONICAL_PI_OPTIONAL_STATUSES,
  buildFinalizeReplayResponse,
  reclaimStaleFinalizeLock,
  acquireFinalizeLock,
  markFinalizeSucceeded,
  runCheckoutFinalizeOrchestration,
  getFinalizeLockVisibilityMs
} = require('./checkoutFinalizeService');
const {
  executeBookingFinalizeWork,
  createDefaultDependencies
} = require('./executeBookingFinalizeWork');
const { buildTrustedBookingPayloadForFinalize } = require('./checkoutFinalizeHttpAdapter');
const {
  hashFinalizeIntent,
  sessionHasCompleteFinalizeIntent
} = require('./finalizeIntentService');
const { hashQuoteSnapshot } = require('./checkoutSessionSnapshot');
const { formatSofiaDateOnly, normalizeDateToSofiaDayStart } = require('../../utils/dateTime');
const { enqueuePostFinalizeSideEffects } = require('./checkoutFinalizeSideEffects');
const {
  PAID_BOOKING_FINALIZATION_STAGES
} = require('../payments/paidBookingFinalizationObservability');

const DOMAIN_VERIFICATION_CODES = Object.freeze({
  PAYMENT_NOT_SUCCEEDED: 'PAYMENT_NOT_SUCCEEDED',
  SUPERSEDED_PAYMENT_INTENT: 'SUPERSEDED_PAYMENT_INTENT',
  NONCANONICAL_PAYMENT_INTENT: 'NONCANONICAL_PAYMENT_INTENT',
  QUOTE_SNAPSHOT_HASH_MISMATCH: 'QUOTE_SNAPSHOT_HASH_MISMATCH',
  FINALIZE_INTENT_HASH_MISMATCH: 'FINALIZE_INTENT_HASH_MISMATCH',
  FINALIZE_INTENT_MISSING: 'FINALIZE_INTENT_MISSING',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  DATE_MISMATCH: 'DATE_MISMATCH',
  ENTITY_MISMATCH: 'ENTITY_MISMATCH',
  STRIPE_RETRIEVE_FAILED: 'STRIPE_RETRIEVE_FAILED',
  CONFIRM_BODY_MISMATCH: 'CONFIRM_BODY_MISMATCH',
  ADOPT_FINGERPRINT_MISMATCH: 'ADOPT_FINGERPRINT_MISMATCH',
  ADOPT_PAYMENT_INTENT_MISMATCH: 'ADOPT_PAYMENT_INTENT_MISMATCH'
});

function normalizeCheckoutId(checkoutId) {
  return String(checkoutId || '').trim();
}

function normalizeNow(now) {
  return now instanceof Date ? now : new Date();
}

function normalizeCurrency(value) {
  return String(value || '').trim().toLowerCase();
}

function dateOnlyFromValue(value) {
  if (!value) return null;
  try {
    return formatSofiaDateOnly(new Date(value));
  } catch {
    return null;
  }
}

function centsToEuros(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n) / 100;
}

function assertV2Session(session) {
  if (!session) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_FOUND,
      'Checkout session not found'
    );
  }
  if (session.flowVersion !== 'v2') {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE,
      'Checkout session is not a V2 flow session',
      { flowVersion: session.flowVersion }
    );
  }
}

function throwVerificationFailure(errorCode, message, details = null) {
  const err = new CheckoutSessionError(
    CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE,
    message || errorCode,
    { ...(details || {}), verificationErrorCode: errorCode, permanent: true }
  );
  err.needsReview = true;
  err.verificationErrorCode = errorCode;
  return err;
}

function needsStripePayment(session) {
  return !NO_PAYMENT_CANONICAL_PI_OPTIONAL_STATUSES.has(session.status);
}

async function findAdoptableBooking({ checkoutId, paymentIntentId, BookingModel = Booking }) {
  const normalizedId = normalizeCheckoutId(checkoutId);
  let booking = null;
  if (normalizedId) {
    booking = await BookingModel.findOne({ checkoutId: normalizedId });
  }
  if (!booking && paymentIntentId) {
    booking = await BookingModel.findOne({
      stripePaymentIntentId: String(paymentIntentId).trim()
    });
  }
  return booking;
}

function assertAdoptableBookingMatches({ booking, session, paymentIntentId }) {
  if (!booking) return;

  if (
    booking.checkoutId &&
    session.checkoutId &&
    String(booking.checkoutId) !== String(session.checkoutId)
  ) {
    throw throwVerificationFailure(
      DOMAIN_VERIFICATION_CODES.ADOPT_FINGERPRINT_MISMATCH,
      'Existing Booking checkoutId does not match CheckoutSession',
      {
        bookingCheckoutId: String(booking.checkoutId),
        sessionCheckoutId: String(session.checkoutId)
      }
    );
  }

  const piId = paymentIntentId ? String(paymentIntentId).trim() : '';
  if (
    piId &&
    booking.stripePaymentIntentId &&
    String(booking.stripePaymentIntentId) !== piId
  ) {
    throw throwVerificationFailure(
      DOMAIN_VERIFICATION_CODES.ADOPT_PAYMENT_INTENT_MISMATCH,
      'Existing Booking PaymentIntent does not match finalize request',
      {
        bookingPaymentIntentId: String(booking.stripePaymentIntentId),
        paymentIntentId: piId
      }
    );
  }

  const bookingFp = String(booking.commercialStayFingerprint || '').trim();
  const sessionFp = String(session.stayFingerprint || '').trim();
  if (bookingFp && sessionFp && bookingFp !== sessionFp) {
    throw throwVerificationFailure(
      DOMAIN_VERIFICATION_CODES.ADOPT_FINGERPRINT_MISMATCH,
      'Existing Booking commercialStayFingerprint does not match CheckoutSession',
      { bookingFingerprint: bookingFp, sessionFingerprint: sessionFp }
    );
  }
}

/**
 * Verify a retrieved Stripe PaymentIntent against the CheckoutSession (no Payment row required).
 */
function verifySucceededPaymentIntentAgainstSession({ session, paymentIntent }) {
  const pi = paymentIntent;
  if (!pi || typeof pi !== 'object') {
    throw throwVerificationFailure(
      DOMAIN_VERIFICATION_CODES.STRIPE_RETRIEVE_FAILED,
      'PaymentIntent could not be verified'
    );
  }

  const piId = String(pi.id || '').trim();
  if (String(pi.status || '').toLowerCase() !== 'succeeded') {
    throw throwVerificationFailure(
      DOMAIN_VERIFICATION_CODES.PAYMENT_NOT_SUCCEEDED,
      'PaymentIntent status is not succeeded',
      { paymentIntentId: piId || null }
    );
  }

  const superseded = (session.supersededPaymentIntentIds || []).map(String);
  if (piId && superseded.includes(piId)) {
    throw throwVerificationFailure(
      DOMAIN_VERIFICATION_CODES.SUPERSEDED_PAYMENT_INTENT,
      'PaymentIntent is superseded for this checkout session',
      { paymentIntentId: piId }
    );
  }

  const canonical = String(session.canonicalPaymentIntentId || '').trim();
  if (!canonical || canonical !== piId) {
    throw throwVerificationFailure(
      DOMAIN_VERIFICATION_CODES.NONCANONICAL_PAYMENT_INTENT,
      'PaymentIntent is not the canonical PaymentIntent for the session',
      { paymentIntentId: piId, canonicalPaymentIntentId: canonical || null }
    );
  }

  const sessionQuoteHash = String(session.quoteSnapshotHash || '');
  const metaQuoteHash = String(pi.metadata?.quoteSnapshotHash || '');
  if (!sessionQuoteHash || sessionQuoteHash !== metaQuoteHash) {
    throw throwVerificationFailure(
      DOMAIN_VERIFICATION_CODES.QUOTE_SNAPSHOT_HASH_MISMATCH,
      'quoteSnapshotHash mismatch between session and PaymentIntent metadata',
      { paymentIntentId: piId }
    );
  }

  if (session.quoteSnapshot) {
    try {
      const recomputedQuote = hashQuoteSnapshot(session.quoteSnapshot);
      if (recomputedQuote !== sessionQuoteHash) {
        throw throwVerificationFailure(
          DOMAIN_VERIFICATION_CODES.QUOTE_SNAPSHOT_HASH_MISMATCH,
          'Stored quoteSnapshot does not re-hash to quoteSnapshotHash',
          { paymentIntentId: piId }
        );
      }
    } catch (err) {
      if (err instanceof CheckoutSessionError) throw err;
      throw throwVerificationFailure(
        DOMAIN_VERIFICATION_CODES.QUOTE_SNAPSHOT_HASH_MISMATCH,
        'Stored quoteSnapshot could not be re-hashed',
        { paymentIntentId: piId }
      );
    }
  }

  if (!sessionHasCompleteFinalizeIntent(session)) {
    throw throwVerificationFailure(
      DOMAIN_VERIFICATION_CODES.FINALIZE_INTENT_MISSING,
      'finalizeIntent is required for paid checkout finalization',
      { paymentIntentId: piId }
    );
  }

  const sessionFinalizeHash = String(session.finalizeIntentHash || '');
  const metaFinalizeHash = String(pi.metadata?.finalizeIntentHash || '');
  if (!sessionFinalizeHash || sessionFinalizeHash !== metaFinalizeHash) {
    throw throwVerificationFailure(
      DOMAIN_VERIFICATION_CODES.FINALIZE_INTENT_HASH_MISMATCH,
      'finalizeIntentHash mismatch between session and PaymentIntent metadata',
      { paymentIntentId: piId }
    );
  }

  try {
    const recomputed = hashFinalizeIntent(session.finalizeIntent);
    if (recomputed !== sessionFinalizeHash) {
      throw throwVerificationFailure(
        DOMAIN_VERIFICATION_CODES.FINALIZE_INTENT_HASH_MISMATCH,
        'Stored finalizeIntent does not re-hash to finalizeIntentHash',
        { paymentIntentId: piId }
      );
    }
  } catch (err) {
    if (err instanceof CheckoutSessionError) throw err;
    throw throwVerificationFailure(
      DOMAIN_VERIFICATION_CODES.FINALIZE_INTENT_HASH_MISMATCH,
      'Stored finalizeIntent could not be re-hashed',
      { paymentIntentId: piId }
    );
  }

  const amountReceived = Number(pi.amount_received != null ? pi.amount_received : pi.amount);
  const expectedAmount = Number(session.stripeAmountCents);
  if (!Number.isFinite(amountReceived) || amountReceived !== expectedAmount) {
    throw throwVerificationFailure(
      DOMAIN_VERIFICATION_CODES.AMOUNT_MISMATCH,
      'amount_received does not equal CheckoutSession.stripeAmountCents',
      { paymentIntentId: piId, amountReceived, expectedAmount }
    );
  }

  const piCurrency = normalizeCurrency(pi.currency);
  const snapshotCurrency = normalizeCurrency(session.quoteSnapshot?.currency || 'eur');
  if (!piCurrency || piCurrency !== snapshotCurrency) {
    throw throwVerificationFailure(
      DOMAIN_VERIFICATION_CODES.CURRENCY_MISMATCH,
      'PaymentIntent currency does not match quote snapshot currency',
      { paymentIntentId: piId }
    );
  }

  const snapshot = session.quoteSnapshot || {};
  const metaCabinId = String(pi.metadata?.cabinId || '');
  const metaCabinTypeId = String(pi.metadata?.cabinTypeId || '');
  const snapCabinId = snapshot.cabinId ? String(snapshot.cabinId) : '';
  const snapCabinTypeId = snapshot.cabinTypeId ? String(snapshot.cabinTypeId) : '';
  const entityType = snapshot.entityType === 'cabinType' ? 'cabinType' : 'cabin';

  if (entityType === 'cabinType') {
    if (!snapCabinTypeId || snapCabinTypeId !== metaCabinTypeId) {
      throw throwVerificationFailure(
        DOMAIN_VERIFICATION_CODES.ENTITY_MISMATCH,
        'cabinTypeId mismatch between snapshot and PaymentIntent metadata',
        { paymentIntentId: piId }
      );
    }
  } else if (!snapCabinId || snapCabinId !== metaCabinId) {
    throw throwVerificationFailure(
      DOMAIN_VERIFICATION_CODES.ENTITY_MISMATCH,
      'cabinId mismatch between snapshot and PaymentIntent metadata',
      { paymentIntentId: piId }
    );
  }

  const snapCheckIn = snapshot.checkInDateOnly || dateOnlyFromValue(snapshot.checkInISO);
  const snapCheckOut = snapshot.checkOutDateOnly || dateOnlyFromValue(snapshot.checkOutISO);
  const metaCheckIn = dateOnlyFromValue(pi.metadata?.checkIn);
  const metaCheckOut = dateOnlyFromValue(pi.metadata?.checkOut);
  if (!snapCheckIn || !snapCheckOut || snapCheckIn !== metaCheckIn || snapCheckOut !== metaCheckOut) {
    throw throwVerificationFailure(
      DOMAIN_VERIFICATION_CODES.DATE_MISMATCH,
      'checkIn/checkOut date mismatch between snapshot and PaymentIntent metadata',
      { paymentIntentId: piId }
    );
  }

  return { paymentIntentId: piId, paymentIntent: pi };
}

async function retrieveSucceededPaymentIntent({ stripe, paymentIntentId }) {
  const piId = String(paymentIntentId || '').trim();
  if (!piId) {
    throw throwVerificationFailure(
      DOMAIN_VERIFICATION_CODES.STRIPE_RETRIEVE_FAILED,
      'paymentIntentId is required'
    );
  }
  if (!stripe?.paymentIntents?.retrieve) {
    throw throwVerificationFailure(
      DOMAIN_VERIFICATION_CODES.STRIPE_RETRIEVE_FAILED,
      'Stripe client is not available for PaymentIntent verification'
    );
  }
  try {
    return await stripe.paymentIntents.retrieve(piId);
  } catch (err) {
    throw throwVerificationFailure(
      DOMAIN_VERIFICATION_CODES.STRIPE_RETRIEVE_FAILED,
      err?.message || 'Failed to retrieve PaymentIntent from Stripe',
      { paymentIntentId: piId }
    );
  }
}

function assertConfirmBodyMatchesPersisted({ confirmBody, session }) {
  if (!confirmBody || typeof confirmBody !== 'object') {
    return;
  }

  const intent = session.finalizeIntent || {};
  const snapshot = session.quoteSnapshot || {};
  const guest = confirmBody.guestInfo || {};
  const intentGuest = intent.guestInfo || {};

  const mismatches = [];

  if (guest.email && intentGuest.email) {
    if (String(guest.email).trim().toLowerCase() !== String(intentGuest.email).trim().toLowerCase()) {
      mismatches.push('guestInfo.email');
    }
  }
  if (guest.firstName && intentGuest.firstName) {
    if (String(guest.firstName).trim() !== String(intentGuest.firstName).trim()) {
      mismatches.push('guestInfo.firstName');
    }
  }
  if (guest.lastName && intentGuest.lastName) {
    if (String(guest.lastName).trim() !== String(intentGuest.lastName).trim()) {
      mismatches.push('guestInfo.lastName');
    }
  }
  if (guest.phone && intentGuest.phone) {
    if (String(guest.phone).trim() !== String(intentGuest.phone).trim()) {
      mismatches.push('guestInfo.phone');
    }
  }

  const bodyCabinId = confirmBody.cabinId != null ? String(confirmBody.cabinId) : '';
  const bodyCabinTypeId = confirmBody.cabinTypeId != null ? String(confirmBody.cabinTypeId) : '';
  if (bodyCabinId && snapshot.cabinId && bodyCabinId !== String(snapshot.cabinId)) {
    mismatches.push('cabinId');
  }
  if (bodyCabinTypeId && snapshot.cabinTypeId && bodyCabinTypeId !== String(snapshot.cabinTypeId)) {
    mismatches.push('cabinTypeId');
  }

  const bodyCheckIn = dateOnlyFromValue(confirmBody.checkIn || confirmBody.checkInDate);
  const bodyCheckOut = dateOnlyFromValue(confirmBody.checkOut || confirmBody.checkOutDate);
  const snapCheckIn = snapshot.checkInDateOnly || dateOnlyFromValue(snapshot.checkInISO);
  const snapCheckOut = snapshot.checkOutDateOnly || dateOnlyFromValue(snapshot.checkOutISO);
  if (bodyCheckIn && snapCheckIn && bodyCheckIn !== snapCheckIn) {
    mismatches.push('checkIn');
  }
  if (bodyCheckOut && snapCheckOut && bodyCheckOut !== snapCheckOut) {
    mismatches.push('checkOut');
  }

  if (mismatches.length > 0) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_INVALID,
      'Request body does not match persisted finalizeIntent/quoteSnapshot',
      {
        verificationErrorCode: DOMAIN_VERIFICATION_CODES.CONFIRM_BODY_MISMATCH,
        permanent: true,
        mismatches
      }
    );
  }
}

async function loadTransportOptions(snapshot) {
  if (snapshot?.cabinId) {
    const cabin = await Cabin.findById(snapshot.cabinId).select('transportOptions').lean();
    return Array.isArray(cabin?.transportOptions) ? cabin.transportOptions : [];
  }
  if (snapshot?.cabinTypeId) {
    const cabinType = await CabinType.findById(snapshot.cabinTypeId)
      .select('transportOptions')
      .lean();
    return Array.isArray(cabinType?.transportOptions) ? cabinType.transportOptions : [];
  }
  return [];
}

async function resolveVoucherReservationContext(session) {
  const checkoutId = session.checkoutId;
  let redemption = null;
  if (session.voucherRedemptionId) {
    redemption = await GiftVoucherRedemption.findById(session.voucherRedemptionId);
  }
  if (!redemption) {
    redemption = await GiftVoucherRedemption.findOne({ checkoutId }).sort({ createdAt: -1 });
  }
  if (!redemption || String(redemption.status || '') !== 'reserved') {
    return null;
  }
  return {
    redemptionId: redemption._id,
    checkoutId,
    giftVoucherId: redemption.giftVoucherId || null,
    confirmed: false
  };
}

function buildVoucherEvidenceFromSnapshot(snapshot, stripePaidAmountCents) {
  return {
    subtotalCents: Number(snapshot.subtotalCents) || 0,
    discountAmountCents: Number(snapshot.discountAmountCents) || 0,
    giftVoucherAppliedCents: Number(snapshot.voucherAppliedCents) || 0,
    stripePaidAmountCents: Number(stripePaidAmountCents) || 0,
    totalValueCents: Number(snapshot.totalValueCents) || 0
  };
}

/**
 * Build finalizeContext solely from quoteSnapshot + finalizeIntent + verified PI.
 */
async function buildFinalizeContextFromPersisted({
  session,
  paymentIntent = null,
  stripePaymentVerified = false,
  source = 'frontend'
}) {
  const snapshot = session.quoteSnapshot || {};
  const intent = session.finalizeIntent || {};

  if (!sessionHasCompleteFinalizeIntent(session) && needsStripePayment(session)) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_MISSING,
      'finalizeIntent is required for paid checkout finalization'
    );
  }

  const checkInDateOnly =
    snapshot.checkInDateOnly || dateOnlyFromValue(snapshot.checkInISO);
  const checkOutDateOnly =
    snapshot.checkOutDateOnly || dateOnlyFromValue(snapshot.checkOutISO);
  if (!checkInDateOnly || !checkOutDateOnly) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE,
      'quoteSnapshot is missing check-in/check-out dates'
    );
  }

  const checkInDate = normalizeDateToSofiaDayStart(checkInDateOnly);
  const checkOutDate = normalizeDateToSofiaDayStart(checkOutDateOnly);

  const subtotalCents = Number(snapshot.subtotalCents) || 0;
  const discountAmountCents = Number(snapshot.discountAmountCents) || 0;
  const giftVoucherAppliedCents = Number(snapshot.voucherAppliedCents) || 0;
  const totalValueCents = Number(snapshot.totalValueCents) || 0;
  const stripeAmountCents = Number(
    session.stripeAmountCents != null ? session.stripeAmountCents : snapshot.stripeAmountCents
  ) || 0;

  const amountReceived =
    paymentIntent != null
      ? Number(
          paymentIntent.amount_received != null
            ? paymentIntent.amount_received
            : paymentIntent.amount
        )
      : stripeAmountCents;
  const stripePaidAmountCents = stripePaymentVerified
    ? amountReceived
    : stripeAmountCents;

  const cabinId = snapshot.cabinId || null;
  const cabinTypeId = snapshot.cabinTypeId || null;
  const guestInfo = intent.guestInfo || null;
  const legalAcceptance = intent.legalAcceptance || null;
  const transportOptions = await loadTransportOptions(snapshot);
  const voucherReservationContext = await resolveVoucherReservationContext(session);

  const paymentIntentId = paymentIntent?.id
    ? String(paymentIntent.id)
    : session.canonicalPaymentIntentId
      ? String(session.canonicalPaymentIntentId)
      : null;

  return {
    cabinId,
    cabinTypeId,
    assignedUnitId: null,
    parentCabinForUnit: null,
    bookingAttemptContext: {
      entityType: cabinTypeId ? 'cabinType' : 'cabin',
      cabinId,
      cabinTypeId,
      checkInDate,
      checkOutDate,
      adults: Number(snapshot.adults) || 1,
      children: Number(snapshot.children) || 0,
      guestInfo,
      promoCode: snapshot.appliedPromoCode || snapshot.promoCode || null
    },
    checkInDate,
    checkOutDate,
    adults: Number(snapshot.adults) || 1,
    children: Number(snapshot.children) || 0,
    guestInfo,
    specialRequests: intent.specialRequests ?? null,
    totalPrice: centsToEuros(totalValueCents),
    subtotalPrice: centsToEuros(subtotalCents),
    discountAmount: centsToEuros(discountAmountCents),
    subtotalCents,
    discountAmountCents,
    giftVoucherAppliedCents,
    stripePaidAmountCents,
    totalValueCents,
    paymentMethod: stripePaymentVerified ? 'stripe' : 'gift_voucher',
    stripePaymentVerified,
    sessionPaymentStatus: session.paymentStatus || null,
    paymentIntentId,
    appliedPromoCode: snapshot.appliedPromoCode || snapshot.promoCode || null,
    promoSnapshot: snapshot.promoSnapshot || null,
    voucherReservationContext,
    voucherEvidence: buildVoucherEvidenceFromSnapshot(snapshot, stripePaidAmountCents),
    attribution: intent.attribution || null,
    metaClientContext: intent.metaClientContext || null,
    legalAcceptance,
    requestMeta: intent.requestMeta || {},
    transportOptions,
    tripType: intent.tripType || null,
    transportMethod:
      intent.transportMethod || snapshot.transportMethod || null,
    romanticSetup:
      intent.romanticSetup != null
        ? Boolean(intent.romanticSetup)
        : Boolean(snapshot.romanticSetup),
    customTripType: intent.customTripType || null,
    checkoutId: session.checkoutId,
    finalizeSource: source
  };
}

function buildTrustedPayloadFromSession(session, finalizeContext) {
  return buildTrustedBookingPayloadForFinalize({
    cabinId: finalizeContext.cabinId,
    cabinTypeId: finalizeContext.cabinTypeId,
    unitId: finalizeContext.assignedUnitId,
    checkInDate: finalizeContext.checkInDate,
    checkOutDate: finalizeContext.checkOutDate,
    guestInfo: finalizeContext.guestInfo
  });
}

async function adoptExistingBooking({
  session,
  booking,
  paymentIntentId = null,
  source = 'frontend',
  now = new Date(),
  visibilityMs = getFinalizeLockVisibilityMs(),
  paidFinalizeOverride = false
}) {
  const at = normalizeNow(now);
  const checkoutId = normalizeCheckoutId(session.checkoutId);

  assertAdoptableBookingMatches({ booking, session, paymentIntentId });

  const replay = buildFinalizeReplayResponse(session);
  if (replay && String(replay.bookingId) === String(booking._id)) {
    return {
      ok: true,
      bookingId: String(booking._id),
      booking,
      checkoutId,
      idempotentReplay: true,
      adoptedExisting: false,
      session,
      jobHints: {}
    };
  }

  if (session.finalizeStatus === FINALIZE_STATUS.FINALIZED) {
    if (session.bookingId && String(session.bookingId) === String(booking._id)) {
      return {
        ok: true,
        bookingId: String(booking._id),
        booking,
        checkoutId,
        idempotentReplay: true,
        adoptedExisting: false,
        session,
        jobHints: {}
      };
    }
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE,
      'Checkout session is finalized with a different bookingId',
      {
        checkoutId,
        sessionBookingId: session.bookingId ? String(session.bookingId) : null,
        bookingId: String(booking._id)
      }
    );
  }

  await reclaimStaleFinalizeLock({ checkoutId, now: at, visibilityMs });

  let lockedSession = await CheckoutSession.findOne({ checkoutId });
  if (lockedSession?.finalizeStatus === FINALIZE_STATUS.OPEN) {
    lockedSession = await acquireFinalizeLock({
      checkoutId,
      expectedSessionVersion: lockedSession.sessionVersion,
      now: at,
      paidFinalizeOverride:
        paidFinalizeOverride || String(session.paymentStatus || '') === 'paid',
      visibilityMs
    });
  } else if (lockedSession?.finalizeStatus === FINALIZE_STATUS.IN_PROGRESS) {
    // Fresh lock held by another worker/frontend — retryable.
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.FINALIZE_IN_PROGRESS,
      'Checkout finalization is already in progress',
      { checkoutId }
    );
  } else if (lockedSession?.finalizeStatus === FINALIZE_STATUS.FINALIZED) {
    const reloaded = await Booking.findById(lockedSession.bookingId);
    return {
      ok: true,
      bookingId: String(lockedSession.bookingId),
      booking: reloaded || booking,
      checkoutId,
      idempotentReplay: true,
      adoptedExisting: false,
      session: lockedSession,
      jobHints: {}
    };
  } else {
    lockedSession = await acquireFinalizeLock({
      checkoutId,
      now: at,
      paidFinalizeOverride:
        paidFinalizeOverride || String(session.paymentStatus || '') === 'paid',
      visibilityMs
    });
  }

  const setPaid = Boolean(paymentIntentId) || String(session.paymentStatus || '') === 'paid';
  const finalizedSession = await markFinalizeSucceeded({
    checkoutId,
    bookingId: booking._id,
    now: at,
    setPaymentStatusPaid: setPaid
  });

  const sideEffects = await enqueuePostFinalizeSideEffects({
    booking,
    session: finalizedSession,
    source,
    adoptedExisting: true
  });

  return {
    ok: true,
    bookingId: String(booking._id),
    booking,
    checkoutId,
    idempotentReplay: false,
    adoptedExisting: true,
    session: finalizedSession,
    jobHints: { sideEffects }
  };
}

/**
 * Authoritative paid checkout finalization.
 */
async function finalizePaidCheckout({
  checkoutId,
  paymentIntentId = null,
  source = 'frontend',
  now = new Date(),
  confirmBody = null,
  dependencies = null
} = {}) {
  const at = normalizeNow(now);
  const normalizedId = normalizeCheckoutId(checkoutId);
  if (!normalizedId) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.INVALID_CHECKOUT_ID,
      'checkoutId is required'
    );
  }

  const deps = {
    ...createDefaultDependencies(),
    ...(dependencies || {})
  };
  const BookingModel = deps.Booking || Booking;
  const stripe = deps.stripe || null;
  const visibilityMs =
    deps.finalizeLockVisibilityMs != null
      ? Number(deps.finalizeLockVisibilityMs)
      : getFinalizeLockVisibilityMs();

  let session = await CheckoutSession.findOne({ checkoutId: normalizedId });
  assertV2Session(session);

  // 2. Replay if already finalized
  const replay = buildFinalizeReplayResponse(session);
  if (replay) {
    const booking = await BookingModel.findById(replay.bookingId);
    return {
      ok: true,
      bookingId: replay.bookingId,
      booking,
      checkoutId: normalizedId,
      idempotentReplay: true,
      adoptedExisting: false,
      session,
      jobHints: {}
    };
  }

  const piIdInput = paymentIntentId
    ? String(paymentIntentId).trim()
    : session.canonicalPaymentIntentId
      ? String(session.canonicalPaymentIntentId).trim()
      : null;

  // 3. Adopt existing Booking before lock rejection
  const existingBooking = await findAdoptableBooking({
    checkoutId: normalizedId,
    paymentIntentId: piIdInput,
    BookingModel
  });
  if (existingBooking) {
    const paidOverride =
      String(session.paymentStatus || '') === 'paid' || Boolean(piIdInput);
    return adoptExistingBooking({
      session,
      booking: existingBooking,
      paymentIntentId: piIdInput,
      source,
      now: at,
      visibilityMs,
      paidFinalizeOverride: paidOverride
    });
  }

  // 4–7. Retrieve + verify Stripe PI when payment is required / provided
  let verifiedPi = null;
  let stripePaymentVerified = false;
  let paidFinalizeOverride = String(session.paymentStatus || '') === 'paid';

  if (needsStripePayment(session) || piIdInput) {
    if (!piIdInput) {
      throw throwVerificationFailure(
        DOMAIN_VERIFICATION_CODES.STRIPE_RETRIEVE_FAILED,
        'paymentIntentId is required for paid checkout finalization'
      );
    }

    // Canonical / superseded checks happen in verifySucceededPaymentIntentAgainstSession
    // (avoid assertCanonicalPaymentIntentForSession assertSessionUsable — paid sessions may be expired).
    verifiedPi = await retrieveSucceededPaymentIntent({
      stripe,
      paymentIntentId: piIdInput
    });
    verifySucceededPaymentIntentAgainstSession({
      session,
      paymentIntent: verifiedPi
    });
    stripePaymentVerified = true;
    paidFinalizeOverride = true;
  } else if (!sessionHasCompleteFinalizeIntent(session)) {
    // Voucher-only / no-payment still needs finalizeIntent when using domain service.
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_MISSING,
      'finalizeIntent is required for domain checkout finalization'
    );
  }

  // Frontend may pass body only to confirm it matches stored intent
  assertConfirmBodyMatchesPersisted({ confirmBody, session });

  // 10. Build finalizeContext solely from persisted snapshot + intent
  const finalizeContext = await buildFinalizeContextFromPersisted({
    session,
    paymentIntent: verifiedPi,
    stripePaymentVerified,
    source
  });
  const bookingPayload = buildTrustedPayloadFromSession(session, finalizeContext);

  const finalizeWorkDependencies = {
    ...deps,
    recordPaidBookingResolutionIssue:
      deps.recordPaidBookingResolutionIssue ||
      (async () => null),
    openManualReviewItem: deps.openManualReviewItem || (async () => null),
    stripe
  };

  const orchResult = await runCheckoutFinalizeOrchestration({
    checkoutId: normalizedId,
    paymentIntentId: piIdInput,
    bookingPayload,
    now: at,
    source,
    paidFinalizeOverride,
    setPaymentStatusPaid: stripePaymentVerified,
    visibilityMs,
    finalizeWork: async (workInput) =>
      executeBookingFinalizeWork({
        session: workInput.session,
        checkoutId: workInput.checkoutId,
        paymentIntentId: workInput.paymentIntentId,
        bookingPayload: workInput.bookingPayload,
        finalizeContext,
        source: workInput.source || source,
        dependencies: finalizeWorkDependencies
      })
  });

  const sideEffects = await enqueuePostFinalizeSideEffects({
    booking: orchResult.booking,
    session: orchResult.session,
    source,
    adoptedExisting: false
  });

  return {
    ok: true,
    bookingId: orchResult.bookingId,
    booking: orchResult.booking,
    checkoutId: normalizedId,
    idempotentReplay: orchResult.idempotentReplay === true,
    adoptedExisting: false,
    session: orchResult.session,
    jobHints: { sideEffects }
  };
}

module.exports = {
  DOMAIN_VERIFICATION_CODES,
  finalizePaidCheckout,
  findAdoptableBooking,
  verifySucceededPaymentIntentAgainstSession,
  buildFinalizeContextFromPersisted,
  adoptExistingBooking,
  assertConfirmBodyMatchesPersisted,
  PAID_BOOKING_FINALIZATION_STAGES
};
