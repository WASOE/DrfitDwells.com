'use strict';

const PaymentResolutionIssue = require('../../models/PaymentResolutionIssue');
const Payment = require('../../models/Payment');
const Booking = require('../../models/Booking');
const CheckoutSession = require('../../models/CheckoutSession');
const { openManualReviewItem } = require('../ops/ingestion/manualReviewService');
const {
  PAID_BOOKING_FINALIZATION_STAGES,
  normalizeFinalizationStage
} = require('./paidBookingFinalizationStages');

const LOG_EVENT_FAILURE = 'paid_booking_finalization_failure';
const LOG_EVENT_ISSUE_UPSERTED = 'paid_booking_resolution_issue_upserted';
const LOG_EVENT_ISSUE_WRITE_FAILED = 'paid_booking_resolution_issue_write_failed';
const MAX_SAFE_SUMMARY = 500;
const FAILURE_HISTORY_MAX_ENTRIES = 10;

function isFinalizeObservabilityEnabled() {
  const raw = process.env.FINALIZE_OBSERVABILITY;
  if (raw == null || raw === '') return true;
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no') {
    return false;
  }
  if (normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes') {
    return true;
  }
  // Unknown values: keep recording exact stage/error; only skip related-doc enrichment when explicitly off.
  return true;
}

function safeErrorSummary(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, MAX_SAFE_SUMMARY);
}

function clipString(value, max = 200) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, max);
}

function toIsoOrNull(value) {
  if (!value) return null;
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

/**
 * Structured log payload — no guest email/phone, no Stripe payloads, no stacks.
 */
function buildSafeLogFields({
  checkoutId = null,
  paymentIntentId = null,
  bookingId = null,
  issueId = null,
  errorCode = null,
  stage = null,
  issueType = null,
  occurrenceCount = null,
  paymentLinked = null,
  sessionFinalized = null
} = {}) {
  return {
    event: null,
    checkoutId: checkoutId ? String(checkoutId) : null,
    paymentIntentId: paymentIntentId ? String(paymentIntentId) : null,
    bookingId: bookingId ? String(bookingId) : null,
    issueId: issueId ? String(issueId) : null,
    errorCode: errorCode || null,
    stage: stage || null,
    issueType: issueType || null,
    occurrenceCount: Number.isFinite(occurrenceCount) ? occurrenceCount : null,
    paymentLinked: paymentLinked == null ? null : Boolean(paymentLinked),
    sessionFinalized: sessionFinalized == null ? null : Boolean(sessionFinalized)
  };
}

function logObservability(level, eventName, fields) {
  const payload = {
    ...buildSafeLogFields(fields),
    event: eventName
  };
  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
  } else {
    console.info(line);
  }
}

function buildGuestSnapshot(bookingAttempt) {
  const guestFirstName = String(bookingAttempt?.guestInfo?.firstName || '').trim();
  const guestLastName = String(bookingAttempt?.guestInfo?.lastName || '').trim();
  const guestName = [guestFirstName, guestLastName].filter(Boolean).join(' ').trim();
  return {
    name: guestName || null,
    email: String(bookingAttempt?.guestInfo?.email || '').trim().toLowerCase() || null,
    phone: String(bookingAttempt?.guestInfo?.phone || '').trim() || null
  };
}

function buildBookingAttemptSnapshot(bookingAttempt) {
  const totalGuests = Number(bookingAttempt?.adults || 0) + Number(bookingAttempt?.children || 0);
  return {
    entityType: bookingAttempt?.entityType || null,
    cabinId: bookingAttempt?.cabinId ? String(bookingAttempt.cabinId) : null,
    cabinTypeId: bookingAttempt?.cabinTypeId ? String(bookingAttempt.cabinTypeId) : null,
    checkIn: bookingAttempt?.checkInDate || bookingAttempt?.checkIn || null,
    checkOut: bookingAttempt?.checkOutDate || bookingAttempt?.checkOut || null,
    guests: Number.isFinite(totalGuests) ? totalGuests : null,
    promoCode: bookingAttempt?.promoCode || null
  };
}

/**
 * Best-effort related-document snapshot for ops. Never throws.
 */
async function collectRelatedObservabilityContext({
  paymentIntentId,
  checkoutId = null,
  bookingId = null
}) {
  const empty = {
    paymentId: null,
    paymentLinked: null,
    paymentStatus: null,
    paymentAmount: null,
    paymentCurrency: null,
    checkoutSessionId: null,
    quoteSnapshotHash: null,
    stayFingerprint: null,
    sessionFinalizeStatus: null,
    sessionFinalized: null,
    sessionPaymentStatus: null,
    sessionBookingId: null,
    bookingExists: false,
    resolvedBookingId: null,
    unitId: null,
    confirmationEmailSent: null,
    stripeEventIdFromPayment: null
  };

  if (!isFinalizeObservabilityEnabled()) {
    return empty;
  }

  try {
    const piId = paymentIntentId ? String(paymentIntentId).trim() : '';
    const checkoutKey = checkoutId ? String(checkoutId).trim() : '';
    const explicitBookingId = bookingId ? String(bookingId).trim() : '';

    const [payment, session, bookingByPi, bookingByCheckout, bookingById] = await Promise.all([
      piId
        ? Payment.findOne({ provider: 'stripe', providerReference: piId })
            .select('_id reservationId status amount currency sourceReference metadata')
            .lean()
        : null,
      checkoutKey
        ? CheckoutSession.findOne({ checkoutId: checkoutKey })
            .select(
              '_id checkoutId quoteSnapshotHash stayFingerprint finalizeStatus paymentStatus bookingId confirmationEmailSentAt'
            )
            .lean()
        : null,
      piId
        ? Booking.findOne({ stripePaymentIntentId: piId })
            .select('_id unitId confirmationEmailSentAt checkoutId')
            .lean()
        : null,
      checkoutKey
        ? Booking.findOne({ checkoutId: checkoutKey }).select('_id unitId confirmationEmailSentAt').lean()
        : null,
      explicitBookingId
        ? Booking.findById(explicitBookingId).select('_id unitId confirmationEmailSentAt').lean()
        : null
    ]);

    const booking = bookingById || bookingByPi || bookingByCheckout || null;

    return {
      paymentId: payment?._id ? String(payment._id) : null,
      paymentLinked: payment ? Boolean(payment.reservationId) : null,
      paymentStatus: payment?.status || null,
      paymentAmount: Number.isFinite(payment?.amount) ? payment.amount : null,
      paymentCurrency: payment?.currency ? String(payment.currency).toLowerCase() : null,
      checkoutSessionId: session?._id ? String(session._id) : null,
      quoteSnapshotHash: session?.quoteSnapshotHash || null,
      stayFingerprint: session?.stayFingerprint || null,
      sessionFinalizeStatus: session?.finalizeStatus || null,
      sessionFinalized: session ? session.finalizeStatus === 'finalized' : null,
      sessionPaymentStatus: session?.paymentStatus || null,
      sessionBookingId: session?.bookingId ? String(session.bookingId) : null,
      bookingExists: Boolean(booking),
      resolvedBookingId: booking?._id ? String(booking._id) : null,
      unitId: booking?.unitId ? String(booking.unitId) : null,
      confirmationEmailSent: booking
        ? Boolean(booking.confirmationEmailSentAt)
        : session
          ? Boolean(session.confirmationEmailSentAt)
          : null,
      stripeEventIdFromPayment:
        typeof payment?.sourceReference === 'string' ? payment.sourceReference : null
    };
  } catch {
    return empty;
  }
}

function stripUnsafeMetadata(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }
  const blocked = new Set([
    'raw',
    'payload',
    'stripePayload',
    'clientSecret',
    'paymentMethod',
    'card',
    'stack',
    'headers',
    'authorization',
    'cookie',
    'cookies'
  ]);
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (blocked.has(key)) continue;
    if (typeof value === 'string' && value.length > 500) {
      out[key] = value.slice(0, 500);
      continue;
    }
    if (value && typeof value === 'object') continue;
    out[key] = value;
  }
  return out;
}

/**
 * Upsert PaymentResolutionIssue + payment_finalization_failure ManualReviewItem.
 * Identity remains paymentIntentId (existing unique index).
 * Repeated reports update the same issue, preserve firstFailedAt, bump occurrenceCount.
 */
async function recordPaidBookingResolutionIssue({
  issueType,
  errorCode,
  errorSummary,
  paymentIntentId,
  paymentIntent = null,
  bookingAttempt = null,
  attribution = null,
  checkoutId = null,
  finalizationStage = null,
  failureSource = 'booking_route',
  stripePaymentVerified = null,
  bookingId = null,
  stripeEventId = null,
  unitId = null,
  extraMetadata = null
} = {}) {
  if (!paymentIntentId) return null;

  const piId = String(paymentIntentId).trim();
  const stage = normalizeFinalizationStage(finalizationStage);
  const now = new Date();
  const checkoutKey = checkoutId ? String(checkoutId).trim() : null;
  const related = await collectRelatedObservabilityContext({
    paymentIntentId: piId,
    checkoutId: checkoutKey,
    bookingId
  });

  const amountFromPi =
    typeof paymentIntent?.amount === 'number' ? paymentIntent.amount / 100 : null;
  const currencyFromPi = paymentIntent?.currency
    ? String(paymentIntent.currency).toLowerCase()
    : null;

  const resolvedBookingId = bookingId
    ? String(bookingId)
    : related.resolvedBookingId;
  const resolvedUnitId = unitId ? String(unitId) : related.unitId;

  const observability = {
    schemaVersion: 1,
    finalizationStage: stage,
    failureSource: clipString(failureSource, 80) || 'booking_route',
    checkoutId: checkoutKey,
    stripeEventId: clipString(stripeEventId || related.stripeEventIdFromPayment, 200),
    paymentId: related.paymentId,
    checkoutSessionId: related.checkoutSessionId,
    quoteSnapshotHash: related.quoteSnapshotHash,
    stayFingerprint: related.stayFingerprint,
    unitId: resolvedUnitId,
    stripePaymentVerified:
      stripePaymentVerified == null ? null : Boolean(stripePaymentVerified),
    bookingExists: Boolean(resolvedBookingId) || related.bookingExists,
    bookingId: resolvedBookingId,
    paymentLinked: related.paymentLinked,
    paymentStatus: related.paymentStatus,
    sessionFinalizeStatus: related.sessionFinalizeStatus,
    sessionFinalized: related.sessionFinalized,
    sessionPaymentStatus: related.sessionPaymentStatus,
    confirmationEmailSent: related.confirmationEmailSent,
    paymentIntentStatus: paymentIntent?.status || null,
    sourceRoute: failureSource === 'booking_route' ? 'POST /api/bookings' : failureSource
  };

  const safeExtra = stripUnsafeMetadata(extraMetadata);

  const guest = buildGuestSnapshot(bookingAttempt);
  const bookingAttemptSnapshot = buildBookingAttemptSnapshot(bookingAttempt);

  const ALLOWED_ISSUE_TYPES = new Set([
    'paid_booking_conflict',
    'paid_booking_save_failed',
    'paid_booking_unknown_failure'
  ]);
  const resolvedIssueType = ALLOWED_ISSUE_TYPES.has(issueType)
    ? issueType
    : 'paid_booking_unknown_failure';

  const historyEntry = {
    at: now,
    finalizationStage: stage,
    issueType: resolvedIssueType,
    errorCode: errorCode ? String(errorCode).slice(0, 120) : null,
    errorSummary: safeErrorSummary(errorSummary),
    failureSource: observability.failureSource,
    bookingId: resolvedBookingId
  };

  const existing = await PaymentResolutionIssue.findOne({ paymentIntentId: piId })
    .select('status resolvedAt resolutionNote')
    .lean();

  const metadataBase = {
    ...safeExtra,
    sourceRoute: observability.sourceRoute,
    paymentIntentStatus: observability.paymentIntentStatus,
    originalIssueType: issueType || null,
    observability
  };

  if (existing && existing.status === 'resolved') {
    metadataBase.previousResolution = {
      resolvedAt: existing.resolvedAt || null,
      resolutionNote: existing.resolutionNote || null,
      reopenedAt: now
    };
  }

  const update = {
    $set: {
      status: 'needs_review',
      issueType: resolvedIssueType,
      amount: amountFromPi != null ? amountFromPi : related.paymentAmount,
      currency: currencyFromPi || related.paymentCurrency,
      guest,
      bookingAttempt: bookingAttemptSnapshot,
      attribution: attribution && typeof attribution === 'object' ? attribution : {},
      errorSummary: safeErrorSummary(errorSummary),
      errorCode: errorCode ? String(errorCode).slice(0, 120) : null,
      finalizationStage: stage,
      checkoutId: checkoutKey,
      lastFailedAt: now,
      resolvedAt: null,
      resolutionNote: null,
      metadata: metadataBase
    },
    $setOnInsert: {
      firstFailedAt: now
    },
    $inc: {
      occurrenceCount: 1
    },
    $push: {
      failureHistory: {
        $each: [historyEntry],
        $slice: -FAILURE_HISTORY_MAX_ENTRIES
      }
    }
  };

  const issue = await PaymentResolutionIssue.findOneAndUpdate(
    { paymentIntentId: piId },
    update,
    { new: true, upsert: true }
  );

  if (!issue.firstFailedAt) {
    await PaymentResolutionIssue.updateOne(
      { _id: issue._id, $or: [{ firstFailedAt: null }, { firstFailedAt: { $exists: false } }] },
      { $set: { firstFailedAt: issue.createdAt || now } }
    );
    issue.firstFailedAt = issue.createdAt || now;
  }

  const evidence = {
    classification: 'booking_finalization_failure',
    paymentIntentId: piId,
    issueType: resolvedIssueType,
    originalIssueType: issueType || null,
    errorCode: errorCode || null,
    errorSummary: safeErrorSummary(errorSummary),
    issueId: String(issue._id),
    finalizationStage: stage,
    failureSource: observability.failureSource,
    checkoutId: checkoutKey,
    stripeEventId: observability.stripeEventId,
    paymentId: related.paymentId,
    checkoutSessionId: related.checkoutSessionId,
    quoteSnapshotHash: related.quoteSnapshotHash,
    stayFingerprint: related.stayFingerprint,
    unitId: resolvedUnitId,
    bookingId: resolvedBookingId,
    bookingExists: observability.bookingExists,
    paymentLinked: related.paymentLinked,
    sessionFinalized: related.sessionFinalized,
    confirmationEmailSent: related.confirmationEmailSent,
    stripePaymentVerified: observability.stripePaymentVerified,
    occurrenceCount: issue.occurrenceCount,
    firstFailedAt: toIsoOrNull(issue.firstFailedAt),
    lastFailedAt: toIsoOrNull(issue.lastFailedAt),
    failureHistoryCount: Array.isArray(issue.failureHistory) ? issue.failureHistory.length : 0,
    amount: issue.amount,
    currency: issue.currency,
    guest: {
      name: guest.name || null
      // email/phone intentionally omitted from MRI evidence logs surface; still on PRI doc
    },
    bookingAttempt: {
      entityType: bookingAttemptSnapshot.entityType,
      cabinId: bookingAttemptSnapshot.cabinId,
      cabinTypeId: bookingAttemptSnapshot.cabinTypeId,
      checkIn: toIsoOrNull(bookingAttemptSnapshot.checkIn),
      checkOut: toIsoOrNull(bookingAttemptSnapshot.checkOut),
      guests: bookingAttemptSnapshot.guests,
      promoCode: bookingAttemptSnapshot.promoCode
    }
  };

  await openManualReviewItem({
    category: 'payment_finalization_failure',
    severity: 'high',
    entityType: 'PaymentResolutionIssue',
    entityId: String(issue._id),
    title: 'Paid booking could not be finalized automatically',
    details: `PaymentIntent ${piId} requires manual booking/payment resolution (stage=${stage}, code=${errorCode || 'unknown'})`,
    provenance: {
      source: observability.failureSource || 'booking_route',
      sourceReference: checkoutKey || piId
    },
    evidence
  });

  logObservability('info', LOG_EVENT_ISSUE_UPSERTED, {
    checkoutId: checkoutKey,
    paymentIntentId: piId,
    bookingId: resolvedBookingId,
    issueId: String(issue._id),
    errorCode,
    stage,
    issueType: resolvedIssueType,
    occurrenceCount: issue.occurrenceCount,
    paymentLinked: related.paymentLinked,
    sessionFinalized: related.sessionFinalized
  });

  return issue;
}

/**
 * Record paid finalization failure without throwing — preserves original error path.
 */
async function recordPaidBookingResolutionIssueSafe(params) {
  const piId = params?.paymentIntentId ? String(params.paymentIntentId).trim() : null;
  const stage = normalizeFinalizationStage(params?.finalizationStage);
  try {
    logObservability('error', LOG_EVENT_FAILURE, {
      checkoutId: params?.checkoutId || null,
      paymentIntentId: piId,
      bookingId: params?.bookingId || null,
      errorCode: params?.errorCode || null,
      stage,
      issueType: params?.issueType || null
    });
    return await recordPaidBookingResolutionIssue(params);
  } catch (issueErr) {
    logObservability('error', LOG_EVENT_ISSUE_WRITE_FAILED, {
      checkoutId: params?.checkoutId || null,
      paymentIntentId: piId,
      bookingId: params?.bookingId || null,
      errorCode: params?.errorCode || null,
      stage,
      issueType: params?.issueType || null
    });
    console.error(
      JSON.stringify({
        event: LOG_EVENT_ISSUE_WRITE_FAILED,
        message: safeErrorSummary(issueErr?.message || issueErr)
      })
    );
    return null;
  }
}

/**
 * Enrich payment_unlinked evidence for ordinary Stripe ingest races.
 * Does NOT classify as booking finalization failure.
 */
function buildPaymentUnlinkedObservabilityEvidence({
  payment,
  paymentIntentId = null,
  eventId = null,
  metadata = null
} = {}) {
  const meta = metadata && typeof metadata === 'object' ? metadata : payment?.metadata || {};
  const checkoutId =
    typeof meta.checkoutId === 'string' && meta.checkoutId.trim()
      ? meta.checkoutId.trim()
      : null;
  return {
    classification: 'payment_observed_before_booking_linkage',
    isFinalizationFailure: false,
    providerReference: payment?.providerReference || null,
    status: payment?.status || null,
    paymentIntentId: paymentIntentId ? String(paymentIntentId) : payment?.providerReference || null,
    paymentId: payment?._id ? String(payment._id) : null,
    stripeEventId: eventId ? String(eventId) : null,
    checkoutId,
    quoteSnapshotHash:
      typeof meta.quoteSnapshotHash === 'string' ? meta.quoteSnapshotHash : null,
    amount: Number.isFinite(payment?.amount) ? payment.amount : null,
    currency: payment?.currency ? String(payment.currency).toLowerCase() : null,
    entityType: meta.entityType || null,
    cabinId: meta.cabinId || null,
    cabinTypeId: meta.cabinTypeId || null
  };
}

module.exports = {
  PAID_BOOKING_FINALIZATION_STAGES,
  FAILURE_HISTORY_MAX_ENTRIES,
  isFinalizeObservabilityEnabled,
  safeErrorSummary,
  buildSafeLogFields,
  collectRelatedObservabilityContext,
  recordPaidBookingResolutionIssue,
  recordPaidBookingResolutionIssueSafe,
  buildPaymentUnlinkedObservabilityEvidence,
  normalizeFinalizationStage
};
