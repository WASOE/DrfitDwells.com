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
  markFinalizeNeedsReview,
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
  PAID_BOOKING_FINALIZATION_STAGES,
  recordPaidBookingResolutionIssueSafe,
  safeErrorSummary
} = require('../payments/paidBookingFinalizationObservability');
const {
  verifySplitOffSessionPaymentMethod,
  SplitOffSessionVerificationError
} = require('../splitPaymentOffSessionVerificationService');
const { getPaymentChoice } = require('../splitPaymentChoiceService');
const {
  reconcileBookingInstallmentsForSplit,
  BookingInstallmentReconciliationError
} = require('../bookingInstallmentReconciliationService');
const BookingInstallment = require('../../models/BookingInstallment');

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
  ADOPT_PAYMENT_INTENT_MISMATCH: 'ADOPT_PAYMENT_INTENT_MISMATCH',
  SPLIT_OFF_SESSION_VERIFICATION_FAILED: 'SPLIT_OFF_SESSION_VERIFICATION_FAILED',
  INSTALLMENT_RECONCILE_FAILED: 'INSTALLMENT_RECONCILE_FAILED'
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

const LEASE_AWARE_PAYABLE_STATUSES = new Set([
  'active',
  'cancel_pending',
  'expired',
  'paid'
]);
const LEASE_AWARE_FAIL_CLOSED_STATUSES = new Set(['released', 'needs_review']);

/**
 * Durable selector: any non-null resourceLease object is lease-aware.
 * Missing/null resourceLease → legacy. Malformed/unknown status fail closed
 * inside lease validation — never legacy claim creation.
 */
function isLeaseAwareFinalizeSession(session) {
  const rl = session && session.resourceLease;
  if (rl == null) return false;
  return typeof rl === 'object';
}

function createLeaseFinalizeNeedsReviewError(code, message, details = {}) {
  const err = new CheckoutSessionError(
    CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE,
    message,
    details
  );
  err.code = code;
  err.needsReview = true;
  err.requiresManualReview = true;
  return err;
}

/**
 * Canonical full-voucher proof (shared with B8F4A promote). Wraps hold-service
 * errors into lease finalize needs_review without duplicating predicates.
 */
async function proveFullVoucherAuthorityForLeasePaid(session, resourceLease, deps = {}) {
  const {
    proveFullVoucherPaidAuthority
  } = require('./accommodationCheckoutHoldService');
  const checkoutId = String(session.checkoutId);
  try {
    const proof = await proveFullVoucherPaidAuthority(
      session,
      resourceLease,
      checkoutId,
      deps
    );
    return {
      paymentAuthorityType: 'full_voucher',
      voucherRedemptionId: proof.voucherRedemptionId,
      voucherOperationId: proof.voucherOperationId,
      totalCents: proof.totalCents
    };
  } catch (err) {
    throw createLeaseFinalizeNeedsReviewError(
      err && err.code ? String(err.code) : 'LEASE_FINALIZE_NEEDS_REVIEW',
      err && err.message
        ? String(err.message)
        : 'Full-voucher authority failed for lease finalization',
      {
        stage: 'lease_paid',
        checkoutId,
        failureCode: err && err.code ? String(err.code) : null,
        retryable: false
      }
    );
  }
}

function assertStripeLeasePaymentIdentity(session, resourceLease) {
  const checkoutId = String(session.checkoutId);
  const canonicalPi =
    session.canonicalPaymentIntentId != null
      ? String(session.canonicalPaymentIntentId).trim()
      : '';
  const leasePi =
    resourceLease.paymentIntentId != null
      ? String(resourceLease.paymentIntentId).trim()
      : '';
  if (String(session.paymentStatus || '') !== 'paid') {
    throw createLeaseFinalizeNeedsReviewError(
      'LEASE_FINALIZE_NEEDS_REVIEW',
      'Stripe lease finalization requires paymentStatus paid',
      { stage: 'lease_paid', checkoutId, retryable: false }
    );
  }
  if (!canonicalPi || !leasePi || canonicalPi !== leasePi) {
    throw createLeaseFinalizeNeedsReviewError(
      'LEASE_FINALIZE_NEEDS_REVIEW',
      'Stripe lease PaymentIntent identity mismatch',
      { stage: 'lease_paid', checkoutId, retryable: false }
    );
  }
  return { paymentAuthorityType: 'stripe', canonicalPaymentIntentId: canonicalPi };
}

/**
 * Mark exact resource lease paid via markExactResourceLeasePaidForFinalize.
 * Verifies generation/attempt/quote/accommodation identity before and after.
 */
async function ensureResourceLeasePaidForFinalize(session, { paymentMode, deps = {} } = {}) {
  const leaseService = require('./checkoutResourceLeaseService');
  const Model = deps.CheckoutSession || CheckoutSession;
  const checkoutId = String(session.checkoutId);
  let live = await Model.findOne({ checkoutId }).lean();
  if (!live || !isLeaseAwareFinalizeSession(live)) {
    throw createLeaseFinalizeNeedsReviewError(
      'LEASE_FINALIZE_NEEDS_REVIEW',
      'Lease-aware finalization requires durable resource lease',
      { stage: 'lease_paid', checkoutId, retryable: false }
    );
  }
  const rl = live.resourceLease;
  if (!rl || typeof rl !== 'object') {
    throw createLeaseFinalizeNeedsReviewError(
      'LEASE_FINALIZE_NEEDS_REVIEW',
      'resourceLease object is required for lease-aware finalization',
      { stage: 'lease_paid', checkoutId, retryable: false }
    );
  }
  const status = rl.status == null ? '' : String(rl.status);
  if (LEASE_AWARE_FAIL_CLOSED_STATUSES.has(status)) {
    throw createLeaseFinalizeNeedsReviewError(
      'RESOURCE_LEASE_PAID_FAILED',
      `resourceLease.status ${status} cannot be marked paid`,
      {
        stage: 'lease_paid',
        checkoutId,
        resourceLeaseGeneration: rl.generation,
        resourceLeaseAttemptId: rl.attemptId,
        quoteSnapshotHash: rl.quoteSnapshotHash,
        retryable: false
      }
    );
  }
  if (!LEASE_AWARE_PAYABLE_STATUSES.has(status)) {
    throw createLeaseFinalizeNeedsReviewError(
      'RESOURCE_LEASE_PAID_FAILED',
      'resourceLease.status is not payable for finalization',
      { stage: 'lease_paid', checkoutId, status: status || null, retryable: false }
    );
  }

  const acc = rl.accommodation && typeof rl.accommodation === 'object' ? rl.accommodation : null;
  const accommodationLeaseId =
    acc && (acc.leaseId != null || acc.holdId != null)
      ? String(acc.leaseId || acc.holdId).trim()
      : '';
  if (!accommodationLeaseId) {
    throw createLeaseFinalizeNeedsReviewError(
      'RESOURCE_LEASE_PAID_FAILED',
      'resourceLease.accommodation.leaseId is required',
      { stage: 'lease_paid', checkoutId, retryable: false }
    );
  }

  const expectedGeneration = Number(rl.generation);
  const expectedAttemptId = String(rl.attemptId || '').trim();
  const expectedQuoteHash = String(rl.quoteSnapshotHash || '').trim();
  if (!Number.isInteger(expectedGeneration) || expectedGeneration < 1) {
    throw createLeaseFinalizeNeedsReviewError(
      'RESOURCE_LEASE_PAID_FAILED',
      'resourceLease.generation is required',
      { stage: 'lease_paid', checkoutId, retryable: false }
    );
  }
  if (!expectedAttemptId || !expectedQuoteHash) {
    throw createLeaseFinalizeNeedsReviewError(
      'RESOURCE_LEASE_PAID_FAILED',
      'resourceLease attemptId and quoteSnapshotHash are required',
      { stage: 'lease_paid', checkoutId, retryable: false }
    );
  }
  if (String(live.quoteSnapshotHash || '') !== expectedQuoteHash) {
    throw createLeaseFinalizeNeedsReviewError(
      'RESOURCE_LEASE_PAID_FAILED',
      'Session quoteSnapshotHash does not match resourceLease',
      { stage: 'lease_paid', checkoutId, retryable: false }
    );
  }
  if (live.bookingId == null || String(live.bookingId).trim() === '') {
    throw createLeaseFinalizeNeedsReviewError(
      'RESOURCE_LEASE_PAID_FAILED',
      'Bound Booking ID is required before marking resource lease paid',
      { stage: 'lease_paid', checkoutId, retryable: true }
    );
  }

  let authorityMeta;
  if (paymentMode === 'full_voucher') {
    authorityMeta = await proveFullVoucherAuthorityForLeasePaid(live, rl, deps);
  } else {
    authorityMeta = assertStripeLeasePaymentIdentity(live, rl);
  }

  const markArgs = {
    checkoutId,
    expectedGeneration,
    expectedAttemptId,
    expectedQuoteSnapshotHash: expectedQuoteHash,
    expectedAccommodationLeaseId: accommodationLeaseId,
    expectedBookingId: live.bookingId,
    paymentMode: paymentMode === 'full_voucher' ? 'full_voucher' : 'stripe'
  };
  if (paymentMode === 'full_voucher') {
    markArgs.expectedVoucherRedemptionId = authorityMeta.voucherRedemptionId;
    markArgs.expectedVoucherOperationId = authorityMeta.voucherOperationId;
  } else {
    markArgs.expectedPaymentIntentId = authorityMeta.canonicalPaymentIntentId;
  }

  try {
    const updated = await leaseService.markExactResourceLeasePaidForFinalize(markArgs, deps);
    live = updated && updated.toObject ? updated.toObject() : updated;
  } catch (markErr) {
    throw createLeaseFinalizeNeedsReviewError(
      'RESOURCE_LEASE_PAID_FAILED',
      markErr.message || 'Failed to CAS resourceLease.status to paid',
      {
        stage: 'lease_paid',
        checkoutId,
        resourceLeaseGeneration: expectedGeneration,
        resourceLeaseAttemptId: expectedAttemptId,
        quoteSnapshotHash: expectedQuoteHash,
        failureCode: markErr.code || null,
        retryable: true
      }
    );
  }

  live = await Model.findOne({ checkoutId }).lean();
  const paidLease = live && live.resourceLease;
  if (
    !paidLease ||
    String(paidLease.status || '') !== 'paid' ||
    Number(paidLease.generation) !== expectedGeneration ||
    String(paidLease.attemptId || '') !== expectedAttemptId ||
    String(paidLease.quoteSnapshotHash || '') !== expectedQuoteHash
  ) {
    throw createLeaseFinalizeNeedsReviewError(
      'RESOURCE_LEASE_PAID_FAILED',
      'Paid resourceLease identity verification failed after transition',
      {
        stage: 'lease_paid',
        checkoutId,
        resourceLeaseGeneration: expectedGeneration,
        resourceLeaseAttemptId: expectedAttemptId,
        quoteSnapshotHash: expectedQuoteHash,
        retryable: true
      }
    );
  }

  return { session: live, authorityMeta };
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
  const {
    resolveExpectedChargeCents
  } = require('../splitPaymentChoiceService');
  let expectedAmount;
  try {
    expectedAmount = Number(resolveExpectedChargeCents(session));
  } catch {
    expectedAmount = Number(session.stripeAmountCents);
  }
  if (!Number.isFinite(amountReceived) || amountReceived !== expectedAmount) {
    throw throwVerificationFailure(
      DOMAIN_VERIFICATION_CODES.AMOUNT_MISMATCH,
      'amount_received does not equal expected charge amount for payment choice',
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

  if (getPaymentChoice(session) === 'split') {
    // Adopt / early-existing Booking paths must still converge installments.
    const Stripe = require('stripe');
    const { STRIPE_API_VERSION } = require('../../config/stripeApiVersion');
    const stripeClient = process.env.STRIPE_SECRET_KEY
      ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION })
      : null;
    await assertSplitOffSessionVerifiedForFinalize({
      stripe: stripeClient,
      session,
      paymentIntent: paymentIntentId || session.canonicalPaymentIntentId
    });
    await reconcileSplitInstallmentsForFinalizePath({
      booking,
      session,
      paymentIntentId: paymentIntentId || session.canonicalPaymentIntentId
    });
  }

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

async function assertSplitOffSessionVerifiedForFinalize({ stripe, session, paymentIntent }) {
  if (getPaymentChoice(session) !== 'split') return null;
  try {
    const verified = await verifySplitOffSessionPaymentMethod({
      stripe,
      session,
      paymentIntent
    });
    if (verified?.paymentMethodId) {
      const CheckoutSession = require('../../models/CheckoutSession');
      await CheckoutSession.updateOne(
        { checkoutId: String(session.checkoutId) },
        {
          $set: {
            stripeReusablePaymentMethodId: verified.paymentMethodId,
            stripeCustomerId: verified.customerId
          }
        }
      );
      session.stripeReusablePaymentMethodId = verified.paymentMethodId;
      session.stripeCustomerId = verified.customerId;
    }
    return verified;
  } catch (err) {
    await recordPaidBookingResolutionIssueSafe({
      issueType: 'paid_booking_unknown_failure',
      errorCode: err.code || DOMAIN_VERIFICATION_CODES.SPLIT_OFF_SESSION_VERIFICATION_FAILED,
      errorSummary: safeErrorSummary(
        err.message || 'Split off-session PaymentMethod verification failed'
      ),
      paymentIntentId:
        (paymentIntent && paymentIntent.id) ||
        session.canonicalPaymentIntentId ||
        null,
      checkoutId: session.checkoutId || null,
      finalizationStage: PAID_BOOKING_FINALIZATION_STAGES.PAYMENT_VERIFIED,
      failureSource: 'finalize_paid_checkout',
      stripePaymentVerified: true,
      extraMetadata: { details: err.details || null }
    });
    try {
      await markFinalizeNeedsReview({
        checkoutId: session.checkoutId,
        reason: err.code || DOMAIN_VERIFICATION_CODES.SPLIT_OFF_SESSION_VERIFICATION_FAILED,
        details: err.details || { message: err.message }
      });
    } catch {
      /* best-effort */
    }
    throw throwVerificationFailure(
      err.code || DOMAIN_VERIFICATION_CODES.SPLIT_OFF_SESSION_VERIFICATION_FAILED,
      err.message || 'Split off-session PaymentMethod verification failed',
      err.details || null
    );
  }
}

async function reconcileSplitInstallmentsForFinalizePath({
  booking,
  session,
  paymentIntentId = null
}) {
  if (!booking || getPaymentChoice(session) !== 'split') return null;
  try {
    return await reconcileBookingInstallmentsForSplit({
      booking,
      session,
      paymentIntentId:
        paymentIntentId ||
        booking.stripePaymentIntentId ||
        session.canonicalPaymentIntentId ||
        null,
      BookingInstallmentModel: BookingInstallment
    });
  } catch (err) {
    await recordPaidBookingResolutionIssueSafe({
      issueType: 'paid_booking_save_failed',
      errorCode: err.code || DOMAIN_VERIFICATION_CODES.INSTALLMENT_RECONCILE_FAILED,
      errorSummary: safeErrorSummary(err.message || 'BookingInstallment reconciliation failed'),
      paymentIntentId:
        paymentIntentId ||
        booking.stripePaymentIntentId ||
        session.canonicalPaymentIntentId ||
        null,
      checkoutId: session.checkoutId || null,
      bookingId: booking._id ? String(booking._id) : null,
      finalizationStage: PAID_BOOKING_FINALIZATION_STAGES.BOOKING_SAVE,
      failureSource: 'finalize_paid_checkout',
      stripePaymentVerified: true,
      extraMetadata: { details: err.details || null }
    });
    try {
      await markFinalizeNeedsReview({
        checkoutId: session.checkoutId,
        reason: err.code || DOMAIN_VERIFICATION_CODES.INSTALLMENT_RECONCILE_FAILED,
        details: err.details || { message: err.message }
      });
    } catch {
      /* best-effort */
    }
    const wrapped = new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE,
      err.message || 'BookingInstallment reconciliation failed',
      {
        checkoutId: session.checkoutId,
        installmentReconcileCode: err.code || null,
        details: err.details || null
      }
    );
    wrapped.needsReview = true;
    throw wrapped;
  }
}

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
    if (booking && getPaymentChoice(session) === 'split') {
      await assertSplitOffSessionVerifiedForFinalize({
        stripe,
        session,
        paymentIntent: session.canonicalPaymentIntentId
      });
      await reconcileSplitInstallmentsForFinalizePath({
        booking,
        session,
        paymentIntentId: session.canonicalPaymentIntentId
      });
    }
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

  // 3. Adopt existing Booking before lock rejection.
  // Lease-aware sessions must not short-circuit here: an existing Booking may
  // still need promote / facilities / tombstone before markFinalizeSucceeded.
  // Exact adoption continues inside the lease-aware finalize work path.
  const existingBooking = await findAdoptableBooking({
    checkoutId: normalizedId,
    paymentIntentId: piIdInput,
    BookingModel
  });
  if (existingBooking && !isLeaseAwareFinalizeSession(session)) {
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
  if (existingBooking && isLeaseAwareFinalizeSession(session)) {
    // Hard-conflict checks still apply (foreign checkout / PI misuse).
    assertAdoptableBookingMatches({
      booking: existingBooking,
      session,
      paymentIntentId: piIdInput
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
    if (getPaymentChoice(session) === 'split') {
      await assertSplitOffSessionVerifiedForFinalize({
        stripe,
        session,
        paymentIntent: verifiedPi
      });
    }
  } else if (!sessionHasCompleteFinalizeIntent(session)) {
    // Voucher-only / no-payment still needs finalizeIntent when using domain service.
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_MISSING,
      'finalizeIntent is required for domain checkout finalization'
    );
  }

  // Frontend may pass body only to confirm it matches stored intent
  assertConfirmBodyMatchesPersisted({ confirmBody, session });

  // Extra Stripe/lease PI identity for lease-aware path before lock/mutation.
  const leaseAware = isLeaseAwareFinalizeSession(session);
  if (leaseAware && (needsStripePayment(session) || piIdInput)) {
    const leasePi =
      session.resourceLease?.paymentIntentId != null
        ? String(session.resourceLease.paymentIntentId).trim()
        : '';
    const canonical =
      session.canonicalPaymentIntentId != null
        ? String(session.canonicalPaymentIntentId).trim()
        : '';
    if (!leasePi || !canonical || leasePi !== canonical) {
      throw throwVerificationFailure(
        DOMAIN_VERIFICATION_CODES.NONCANONICAL_PAYMENT_INTENT,
        'Lease PaymentIntent does not match canonical PaymentIntent',
        { leasePaymentIntentId: leasePi || null, canonicalPaymentIntentId: canonical || null }
      );
    }
  }

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
    stripe,
    leaseAwareFinalize: leaseAware,
    paymentAuthorityType: leaseAware
      ? needsStripePayment(session) || piIdInput
        ? 'stripe'
        : 'full_voucher'
      : null,
    afterLeasePaid: deps.afterLeasePaid,
    afterAccommodationPromote: deps.afterAccommodationPromote,
    afterBookingSave: deps.afterBookingSave,
    afterVoucherConfirm: deps.afterVoucherConfirm,
    afterFacilityConfirm: deps.afterFacilityConfirm,
    afterBookingFacilitySnapshot: deps.afterBookingFacilitySnapshot,
    afterAccommodationTombstone: deps.afterAccommodationTombstone,
    beforeMarkFinalizeSucceeded: deps.beforeMarkFinalizeSucceeded
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
    afterBookingIdBind: deps.afterBookingIdBind || null,
    finalizeWork: async (workInput) => {
      let workSession = workInput.session;
      if (leaseAware) {
        const paymentMode =
          needsStripePayment(session) || piIdInput ? 'stripe' : 'full_voucher';
        const paid = await ensureResourceLeasePaidForFinalize(workSession, {
          paymentMode,
          deps: finalizeWorkDependencies
        });
        workSession = paid.session;
        finalizeWorkDependencies.paymentAuthorityMeta = paid.authorityMeta;
        if (typeof finalizeWorkDependencies.afterLeasePaid === 'function') {
          await finalizeWorkDependencies.afterLeasePaid({
            checkoutId: normalizedId,
            session: workSession,
            authorityMeta: paid.authorityMeta
          });
        }
      }
      return executeBookingFinalizeWork({
        session: workSession,
        checkoutId: workInput.checkoutId,
        paymentIntentId: workInput.paymentIntentId,
        bookingPayload: workInput.bookingPayload,
        finalizeContext: {
          ...finalizeContext,
          leaseAwareFinalize: leaseAware,
          paymentAuthorityType: finalizeWorkDependencies.paymentAuthorityType,
          paymentAuthorityMeta: finalizeWorkDependencies.paymentAuthorityMeta || null,
          boundBookingId:
            workInput.boundBookingId ||
            (workSession.bookingId != null ? String(workSession.bookingId) : null)
        },
        source: workInput.source || source,
        dependencies: finalizeWorkDependencies
      });
    }
  });

  if (typeof deps.beforeMarkFinalizeSucceeded === 'function') {
    // Hook already available inside work; no-op here — success already marked in orch.
  }

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
  isLeaseAwareFinalizeSession,
  ensureResourceLeasePaidForFinalize,
  assertSplitOffSessionVerifiedForFinalize,
  reconcileSplitInstallmentsForFinalizePath,
  PAID_BOOKING_FINALIZATION_STAGES
};
