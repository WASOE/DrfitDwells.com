'use strict';

/**
 * Batch 3 — Verified accommodation payment_intent.succeeded → session paid + job enqueue.
 * No Booking creation. No job execution.
 *
 * Binding: docs/checkout-payment-architecture/02_PAID_BOOKING_FINALIZATION_IMPLEMENTATION_SPEC.md
 */

const CheckoutSession = require('../../models/CheckoutSession');
const Payment = require('../../models/Payment');
const featureFlags = require('../../utils/featureFlags');
const { formatSofiaDateOnly } = require('../../utils/dateTime');
const {
  hashFinalizeIntent,
  sessionHasCompleteFinalizeIntent
} = require('./finalizeIntentService');
const {
  ensureCheckoutFinalizationJob
} = require('./checkoutFinalizationJobService');
const {
  recordPaidBookingResolutionIssueSafe,
  PAID_BOOKING_FINALIZATION_STAGES,
  safeErrorSummary
} = require('../payments/paidBookingFinalizationObservability');

const PAYMENT_EVIDENCE_SCHEMA_VERSION = 1;

const VERIFICATION_ERROR_CODES = Object.freeze({
  CHECKOUT_SESSION_MISSING: 'CHECKOUT_SESSION_MISSING',
  NOT_V2_ACCOMMODATION_FLOW: 'NOT_V2_ACCOMMODATION_FLOW',
  NONCANONICAL_PAYMENT_INTENT: 'NONCANONICAL_PAYMENT_INTENT',
  SUPERSEDED_PAYMENT_INTENT: 'SUPERSEDED_PAYMENT_INTENT',
  QUOTE_SNAPSHOT_HASH_MISMATCH: 'QUOTE_SNAPSHOT_HASH_MISMATCH',
  FINALIZE_INTENT_HASH_MISMATCH: 'FINALIZE_INTENT_HASH_MISMATCH',
  FINALIZE_INTENT_REQUIRED: 'FINALIZE_INTENT_REQUIRED',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  DATE_MISMATCH: 'DATE_MISMATCH',
  ENTITY_MISMATCH: 'ENTITY_MISMATCH',
  PAYMENT_NOT_SUCCEEDED: 'PAYMENT_NOT_SUCCEEDED',
  PAYMENT_RECORD_NOT_PAID: 'PAYMENT_RECORD_NOT_PAID',
  SESSION_PAID_UPDATE_FAILED: 'SESSION_PAID_UPDATE_FAILED',
  JOB_ENQUEUE_FAILED: 'JOB_ENQUEUE_FAILED',
  ENQUEUE_WITHOUT_MARK_PAID: 'ENQUEUE_WITHOUT_MARK_PAID'
});

function logSafe(event, fields) {
  console.info(
    JSON.stringify({
      event,
      checkoutId: fields.checkoutId || null,
      paymentIntentId: fields.paymentIntentId || null,
      stripeEventId: fields.stripeEventId || null,
      quoteSnapshotHash: fields.quoteSnapshotHash || null,
      finalizeIntentHash: fields.finalizeIntentHash || null,
      stage: fields.stage || null,
      errorCode: fields.errorCode || null,
      resultCode: fields.resultCode || null,
      markPaid: fields.markPaid === true,
      enqueue: fields.enqueue === true
    })
  );
}

function extractPaymentIntentFromEvent(event) {
  const obj = event?.data?.object;
  if (!obj || obj.object !== 'payment_intent') return null;
  return obj;
}

function isGiftVoucherPaymentIntent(pi) {
  return pi?.metadata?.type === 'gift_voucher';
}

function isAccommodationPaymentIntentSucceededEvent(event) {
  if (event?.type !== 'payment_intent.succeeded') return false;
  const pi = extractPaymentIntentFromEvent(event);
  if (!pi) return false;
  if (isGiftVoucherPaymentIntent(pi)) return false;
  const checkoutId =
    typeof pi.metadata?.checkoutId === 'string' ? pi.metadata.checkoutId.trim() : '';
  return Boolean(checkoutId);
}

function dateOnlyFromIsoOrDate(value) {
  if (!value) return null;
  try {
    return formatSofiaDateOnly(new Date(value));
  } catch {
    return null;
  }
}

function normalizeCurrency(value) {
  return String(value || '').trim().toLowerCase();
}

function buildPaymentEvidence({
  paymentIntentId,
  stripeEventId,
  amountReceivedCents,
  currency,
  quoteSnapshotHash,
  finalizeIntentHash,
  verifiedAt
}) {
  return {
    schemaVersion: PAYMENT_EVIDENCE_SCHEMA_VERSION,
    paymentIntentId: String(paymentIntentId),
    stripeEventId: stripeEventId ? String(stripeEventId) : null,
    amountReceivedCents: Number(amountReceivedCents) || 0,
    currency: normalizeCurrency(currency) || 'eur',
    verifiedAt: verifiedAt instanceof Date ? verifiedAt : new Date(verifiedAt),
    quoteSnapshotHash: quoteSnapshotHash ? String(quoteSnapshotHash) : null,
    finalizeIntentHash: finalizeIntentHash ? String(finalizeIntentHash) : null
  };
}

/**
 * Verify accommodation PI success against CheckoutSession + Payment row.
 * @returns {{ ok: true, session, pi, evidence } | { ok: false, permanent: boolean, errorCode, errorSummary, checkoutId?, paymentIntentId? }}
 */
async function verifyAccommodationPaymentSuccess({ event, payment = null }) {
  const pi = extractPaymentIntentFromEvent(event);
  const stripeEventId = event?.id ? String(event.id) : null;
  if (!pi) {
    return {
      ok: false,
      permanent: true,
      errorCode: VERIFICATION_ERROR_CODES.PAYMENT_NOT_SUCCEEDED,
      errorSummary: 'Event object is not a payment_intent'
    };
  }

  if (isGiftVoucherPaymentIntent(pi)) {
    return {
      ok: false,
      permanent: false,
      skipped: true,
      errorCode: 'GIFT_VOUCHER_EXCLUDED',
      errorSummary: 'Gift voucher PaymentIntent excluded from accommodation paid sync'
    };
  }

  if (String(pi.status || '').toLowerCase() !== 'succeeded') {
    return {
      ok: false,
      permanent: true,
      errorCode: VERIFICATION_ERROR_CODES.PAYMENT_NOT_SUCCEEDED,
      errorSummary: 'PaymentIntent status is not succeeded',
      paymentIntentId: pi.id || null
    };
  }

  const checkoutId =
    typeof pi.metadata?.checkoutId === 'string' ? pi.metadata.checkoutId.trim() : '';
  if (!checkoutId) {
    return {
      ok: false,
      permanent: false,
      skipped: true,
      errorCode: VERIFICATION_ERROR_CODES.NOT_V2_ACCOMMODATION_FLOW,
      errorSummary: 'No checkoutId on PaymentIntent metadata',
      paymentIntentId: pi.id || null
    };
  }

  const session = await CheckoutSession.findOne({ checkoutId });
  if (!session) {
    return {
      ok: false,
      permanent: true,
      errorCode: VERIFICATION_ERROR_CODES.CHECKOUT_SESSION_MISSING,
      errorSummary: 'CheckoutSession not found for checkoutId',
      checkoutId,
      paymentIntentId: pi.id || null
    };
  }

  if (session.flowVersion !== 'v2') {
    return {
      ok: false,
      permanent: true,
      errorCode: VERIFICATION_ERROR_CODES.NOT_V2_ACCOMMODATION_FLOW,
      errorSummary: 'CheckoutSession is not V2 accommodation flow',
      checkoutId,
      paymentIntentId: pi.id || null
    };
  }

  const piId = String(pi.id || '').trim();
  const superseded = (session.supersededPaymentIntentIds || []).map(String);
  if (superseded.includes(piId)) {
    return {
      ok: false,
      permanent: true,
      errorCode: VERIFICATION_ERROR_CODES.SUPERSEDED_PAYMENT_INTENT,
      errorSummary: 'PaymentIntent is superseded for this checkout session',
      checkoutId,
      paymentIntentId: piId
    };
  }

  const canonical = String(session.canonicalPaymentIntentId || '').trim();
  if (!canonical || canonical !== piId) {
    return {
      ok: false,
      permanent: true,
      errorCode: VERIFICATION_ERROR_CODES.NONCANONICAL_PAYMENT_INTENT,
      errorSummary: 'PaymentIntent is not the canonical PaymentIntent for the session',
      checkoutId,
      paymentIntentId: piId
    };
  }

  const sessionQuoteHash = String(session.quoteSnapshotHash || '');
  const metaQuoteHash = String(pi.metadata?.quoteSnapshotHash || '');
  if (!sessionQuoteHash || sessionQuoteHash !== metaQuoteHash) {
    return {
      ok: false,
      permanent: true,
      errorCode: VERIFICATION_ERROR_CODES.QUOTE_SNAPSHOT_HASH_MISMATCH,
      errorSummary: 'quoteSnapshotHash mismatch between session and PaymentIntent metadata',
      checkoutId,
      paymentIntentId: piId
    };
  }

  const sessionFinalizeHash = session.finalizeIntentHash
    ? String(session.finalizeIntentHash)
    : '';
  const metaFinalizeHash = pi.metadata?.finalizeIntentHash
    ? String(pi.metadata.finalizeIntentHash)
    : '';
  const required = featureFlags.isFinalizeIntentRequiredForPiEnabled();

  if (required && !sessionHasCompleteFinalizeIntent(session)) {
    return {
      ok: false,
      permanent: true,
      errorCode: VERIFICATION_ERROR_CODES.FINALIZE_INTENT_REQUIRED,
      errorSummary: 'finalizeIntent is required but missing or hash disagrees',
      checkoutId,
      paymentIntentId: piId
    };
  }

  if (sessionFinalizeHash) {
    if (sessionFinalizeHash !== metaFinalizeHash) {
      return {
        ok: false,
        permanent: true,
        errorCode: VERIFICATION_ERROR_CODES.FINALIZE_INTENT_HASH_MISMATCH,
        errorSummary: 'finalizeIntentHash mismatch between session and PaymentIntent metadata',
        checkoutId,
        paymentIntentId: piId
      };
    }
    if (session.finalizeIntent) {
      try {
        const recomputed = hashFinalizeIntent(session.finalizeIntent);
        if (recomputed !== sessionFinalizeHash) {
          return {
            ok: false,
            permanent: true,
            errorCode: VERIFICATION_ERROR_CODES.FINALIZE_INTENT_HASH_MISMATCH,
            errorSummary: 'Stored finalizeIntent does not re-hash to finalizeIntentHash',
            checkoutId,
            paymentIntentId: piId
          };
        }
      } catch {
        return {
          ok: false,
          permanent: true,
          errorCode: VERIFICATION_ERROR_CODES.FINALIZE_INTENT_HASH_MISMATCH,
          errorSummary: 'Stored finalizeIntent could not be re-hashed',
          checkoutId,
          paymentIntentId: piId
        };
      }
    }
  }

  const amountReceived = Number(pi.amount_received != null ? pi.amount_received : pi.amount);
  const expectedAmount = Number(session.stripeAmountCents);
  if (!Number.isFinite(amountReceived) || amountReceived !== expectedAmount) {
    return {
      ok: false,
      permanent: true,
      errorCode: VERIFICATION_ERROR_CODES.AMOUNT_MISMATCH,
      errorSummary: 'amount_received does not equal CheckoutSession.stripeAmountCents',
      checkoutId,
      paymentIntentId: piId
    };
  }

  const piCurrency = normalizeCurrency(pi.currency);
  const snapshotCurrency = normalizeCurrency(session.quoteSnapshot?.currency || 'eur');
  if (!piCurrency || piCurrency !== snapshotCurrency) {
    return {
      ok: false,
      permanent: true,
      errorCode: VERIFICATION_ERROR_CODES.CURRENCY_MISMATCH,
      errorSummary: 'PaymentIntent currency does not match quote snapshot currency',
      checkoutId,
      paymentIntentId: piId
    };
  }

  const snapshot = session.quoteSnapshot || {};
  const metaCabinId = String(pi.metadata?.cabinId || '');
  const metaCabinTypeId = String(pi.metadata?.cabinTypeId || '');
  const snapCabinId = snapshot.cabinId ? String(snapshot.cabinId) : '';
  const snapCabinTypeId = snapshot.cabinTypeId ? String(snapshot.cabinTypeId) : '';
  const entityType = snapshot.entityType === 'cabinType' ? 'cabinType' : 'cabin';

  if (entityType === 'cabinType') {
    if (!snapCabinTypeId || snapCabinTypeId !== metaCabinTypeId) {
      return {
        ok: false,
        permanent: true,
        errorCode: VERIFICATION_ERROR_CODES.ENTITY_MISMATCH,
        errorSummary: 'cabinTypeId mismatch between snapshot and PaymentIntent metadata',
        checkoutId,
        paymentIntentId: piId
      };
    }
  } else if (!snapCabinId || snapCabinId !== metaCabinId) {
    return {
      ok: false,
      permanent: true,
      errorCode: VERIFICATION_ERROR_CODES.ENTITY_MISMATCH,
      errorSummary: 'cabinId mismatch between snapshot and PaymentIntent metadata',
      checkoutId,
      paymentIntentId: piId
    };
  }

  const snapCheckIn = snapshot.checkInDateOnly || dateOnlyFromIsoOrDate(snapshot.checkInISO);
  const snapCheckOut = snapshot.checkOutDateOnly || dateOnlyFromIsoOrDate(snapshot.checkOutISO);
  const metaCheckIn = dateOnlyFromIsoOrDate(pi.metadata?.checkIn);
  const metaCheckOut = dateOnlyFromIsoOrDate(pi.metadata?.checkOut);
  if (!snapCheckIn || !snapCheckOut || snapCheckIn !== metaCheckIn || snapCheckOut !== metaCheckOut) {
    return {
      ok: false,
      permanent: true,
      errorCode: VERIFICATION_ERROR_CODES.DATE_MISMATCH,
      errorSummary: 'checkIn/checkOut date mismatch between snapshot and PaymentIntent metadata',
      checkoutId,
      paymentIntentId: piId
    };
  }

  let paymentDoc = payment;
  if (!paymentDoc) {
    paymentDoc = await Payment.findOne({
      provider: 'stripe',
      providerReference: piId
    }).lean();
  }
  const paymentStatus = paymentDoc?.status || null;
  if (paymentStatus !== 'paid') {
    return {
      ok: false,
      permanent: true,
      errorCode: VERIFICATION_ERROR_CODES.PAYMENT_RECORD_NOT_PAID,
      errorSummary: 'Canonical Payment record is missing or not paid',
      checkoutId,
      paymentIntentId: piId
    };
  }

  const verifiedAt = new Date();
  const evidence = buildPaymentEvidence({
    paymentIntentId: piId,
    stripeEventId,
    amountReceivedCents: amountReceived,
    currency: piCurrency,
    quoteSnapshotHash: sessionQuoteHash,
    finalizeIntentHash: sessionFinalizeHash || null,
    verifiedAt
  });

  return { ok: true, session, pi, evidence, checkoutId, paymentIntentId: piId };
}

async function markCheckoutSessionPaid({ session, evidence, now = new Date() }) {
  const checkoutId = session.checkoutId;
  const set = {
    paymentStatus: 'paid'
  };

  if (
    session.status === 'pi_active' ||
    session.status === 'payment_required' ||
    session.status === 'quoted' ||
    session.status === 'draft'
  ) {
    set.status = 'paid';
  }

  if (!session.paymentSucceededAt) {
    set.paymentSucceededAt = now;
  }
  if (!session.finalizeIntentImmutableAt) {
    set.finalizeIntentImmutableAt = now;
  }

  if (!session.paymentEvidence) {
    set.paymentEvidence = evidence;
  } else if (
    String(session.paymentEvidence.paymentIntentId || '') === String(evidence.paymentIntentId)
  ) {
    if (!session.paymentEvidence.stripeEventId && evidence.stripeEventId) {
      set['paymentEvidence.stripeEventId'] = evidence.stripeEventId;
    }
  }

  const updated = await CheckoutSession.findOneAndUpdate(
    { checkoutId },
    { $set: set },
    { new: true }
  );

  if (!updated || updated.paymentStatus !== 'paid') {
    throw new Error('CheckoutSession paymentStatus update did not persist as paid');
  }

  return updated;
}

async function recordVerificationFailure({
  result,
  event,
  failureSource = 'stripe_webhook'
}) {
  if (!result?.paymentIntentId) return null;
  const issueType =
    result.errorCode === VERIFICATION_ERROR_CODES.SUPERSEDED_PAYMENT_INTENT ||
    result.errorCode === VERIFICATION_ERROR_CODES.NONCANONICAL_PAYMENT_INTENT ||
    result.errorCode === VERIFICATION_ERROR_CODES.QUOTE_SNAPSHOT_HASH_MISMATCH ||
    result.errorCode === VERIFICATION_ERROR_CODES.FINALIZE_INTENT_HASH_MISMATCH ||
    result.errorCode === VERIFICATION_ERROR_CODES.AMOUNT_MISMATCH ||
    result.errorCode === VERIFICATION_ERROR_CODES.CURRENCY_MISMATCH ||
    result.errorCode === VERIFICATION_ERROR_CODES.DATE_MISMATCH ||
    result.errorCode === VERIFICATION_ERROR_CODES.ENTITY_MISMATCH
      ? 'paid_booking_conflict'
      : 'paid_booking_unknown_failure';

  return recordPaidBookingResolutionIssueSafe({
    issueType,
    errorCode: result.errorCode,
    errorSummary: result.errorSummary,
    paymentIntentId: result.paymentIntentId,
    checkoutId: result.checkoutId || null,
    finalizationStage: PAID_BOOKING_FINALIZATION_STAGES.PAYMENT_VERIFIED,
    failureSource,
    stripePaymentVerified: true,
    stripeEventId: event?.id || null,
    extraMetadata: {
      permanent: result.permanent === true,
      webhookSync: 'batch3'
    }
  });
}

/**
 * Main Batch 3 webhook sync entry (idempotent).
 */
async function syncAccommodationCheckoutPaidFromWebhook({ event, payment = null }) {
  const markPaidEnabled = featureFlags.isCheckoutMarkPaidOnWebhookEnabled();
  const enqueueEnabled = featureFlags.isFinalizeJobEnqueueEnabled();

  if (!markPaidEnabled && !enqueueEnabled) {
    return {
      ok: true,
      skipped: true,
      reason: 'flags_disabled',
      markPaid: false,
      enqueue: false
    };
  }

  if (!markPaidEnabled && enqueueEnabled) {
    logSafe('checkout_paid_webhook_sync', {
      resultCode: 'enqueue_without_mark_paid_skipped',
      errorCode: VERIFICATION_ERROR_CODES.ENQUEUE_WITHOUT_MARK_PAID,
      markPaid: false,
      enqueue: false,
      stripeEventId: event?.id || null,
      paymentIntentId: extractPaymentIntentFromEvent(event)?.id || null
    });
    return {
      ok: true,
      skipped: true,
      reason: 'enqueue_requires_mark_paid',
      markPaid: false,
      enqueue: false,
      warning: VERIFICATION_ERROR_CODES.ENQUEUE_WITHOUT_MARK_PAID
    };
  }

  const verified = await verifyAccommodationPaymentSuccess({ event, payment });
  if (verified.skipped) {
    return {
      ok: true,
      skipped: true,
      reason: verified.errorCode,
      markPaid: false,
      enqueue: false
    };
  }

  if (!verified.ok) {
    if (verified.permanent) {
      await recordVerificationFailure({ result: verified, event });
    }
    logSafe('checkout_paid_webhook_sync', {
      checkoutId: verified.checkoutId || null,
      paymentIntentId: verified.paymentIntentId || null,
      stripeEventId: event?.id || null,
      stage: PAID_BOOKING_FINALIZATION_STAGES.PAYMENT_VERIFIED,
      errorCode: verified.errorCode,
      resultCode: 'verification_failed',
      markPaid: false,
      enqueue: false
    });
    return {
      ok: false,
      skipped: false,
      permanent: verified.permanent === true,
      errorCode: verified.errorCode,
      markPaid: false,
      enqueue: false
    };
  }

  let session;
  try {
    session = await markCheckoutSessionPaid({
      session: verified.session,
      evidence: verified.evidence
    });
  } catch (err) {
    await recordPaidBookingResolutionIssueSafe({
      issueType: 'paid_booking_unknown_failure',
      errorCode: VERIFICATION_ERROR_CODES.SESSION_PAID_UPDATE_FAILED,
      errorSummary: safeErrorSummary(err?.message || 'session paid update failed'),
      paymentIntentId: verified.paymentIntentId,
      checkoutId: verified.checkoutId,
      finalizationStage: PAID_BOOKING_FINALIZATION_STAGES.SESSION_FINALIZE,
      failureSource: 'stripe_webhook',
      stripePaymentVerified: true,
      stripeEventId: event?.id || null
    });
    logSafe('checkout_paid_webhook_sync', {
      checkoutId: verified.checkoutId,
      paymentIntentId: verified.paymentIntentId,
      stripeEventId: event?.id || null,
      errorCode: VERIFICATION_ERROR_CODES.SESSION_PAID_UPDATE_FAILED,
      resultCode: 'session_paid_update_failed',
      markPaid: false,
      enqueue: false
    });
    return {
      ok: false,
      permanent: false,
      retryable: true,
      errorCode: VERIFICATION_ERROR_CODES.SESSION_PAID_UPDATE_FAILED,
      markPaid: false,
      enqueue: false
    };
  }

  let enqueueResult = null;
  if (enqueueEnabled) {
    try {
      enqueueResult = await ensureCheckoutFinalizationJob({
        checkoutId: verified.checkoutId,
        paymentIntentId: verified.paymentIntentId,
        stripeEventId: event?.id || null,
        quoteSnapshotHash: verified.evidence.quoteSnapshotHash,
        finalizeIntentHash: verified.evidence.finalizeIntentHash,
        createdReason: 'webhook'
      });
    } catch (err) {
      await recordPaidBookingResolutionIssueSafe({
        issueType: 'paid_booking_unknown_failure',
        errorCode: VERIFICATION_ERROR_CODES.JOB_ENQUEUE_FAILED,
        errorSummary: safeErrorSummary(err?.message || 'job enqueue failed'),
        paymentIntentId: verified.paymentIntentId,
        checkoutId: verified.checkoutId,
        finalizationStage: PAID_BOOKING_FINALIZATION_STAGES.PAYMENT_INGESTED,
        failureSource: 'stripe_webhook',
        stripePaymentVerified: true,
        stripeEventId: event?.id || null
      });
      logSafe('checkout_paid_webhook_sync', {
        checkoutId: verified.checkoutId,
        paymentIntentId: verified.paymentIntentId,
        stripeEventId: event?.id || null,
        errorCode: VERIFICATION_ERROR_CODES.JOB_ENQUEUE_FAILED,
        resultCode: 'job_enqueue_failed',
        markPaid: true,
        enqueue: false
      });
      return {
        ok: false,
        permanent: false,
        retryable: true,
        errorCode: VERIFICATION_ERROR_CODES.JOB_ENQUEUE_FAILED,
        markPaid: true,
        enqueue: false,
        sessionPaymentStatus: session.paymentStatus
      };
    }
  }

  logSafe('checkout_paid_webhook_sync', {
    checkoutId: verified.checkoutId,
    paymentIntentId: verified.paymentIntentId,
    stripeEventId: event?.id || null,
    quoteSnapshotHash: verified.evidence.quoteSnapshotHash,
    finalizeIntentHash: verified.evidence.finalizeIntentHash,
    resultCode: 'synced',
    markPaid: true,
    enqueue: Boolean(enqueueResult)
  });

  return {
    ok: true,
    skipped: false,
    markPaid: true,
    enqueue: Boolean(enqueueEnabled),
    checkoutId: verified.checkoutId,
    paymentIntentId: verified.paymentIntentId,
    sessionPaymentStatus: session.paymentStatus,
    job: enqueueResult
  };
}

module.exports = {
  PAYMENT_EVIDENCE_SCHEMA_VERSION,
  VERIFICATION_ERROR_CODES,
  isAccommodationPaymentIntentSucceededEvent,
  isGiftVoucherPaymentIntent,
  extractPaymentIntentFromEvent,
  buildPaymentEvidence,
  verifyAccommodationPaymentSuccess,
  markCheckoutSessionPaid,
  syncAccommodationCheckoutPaidFromWebhook
};
