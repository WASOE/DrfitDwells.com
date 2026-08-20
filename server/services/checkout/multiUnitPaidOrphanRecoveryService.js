'use strict';

/**
 * S0 allowlisted multi-unit paid-orphan recovery service.
 * Binding: docs/architecture/multi-unit-cabin-type-capacity-and-paid-recovery-lock.md
 *
 * Sole importer of runInMultiUnitPaidOrphanRecoveryContext.
 * Does not export the runner.
 */

const crypto = require('crypto');
const mongoose = require('mongoose');

const Booking = require('../../models/Booking');
const CheckoutSession = require('../../models/CheckoutSession');
const CheckoutFinalizationJob = require('../../models/CheckoutFinalizationJob');
const Payment = require('../../models/Payment');
const ManualReviewItem = require('../../models/ManualReviewItem');
const Unit = require('../../models/Unit');
const EmailDeliveryState = require('../../models/EmailDeliveryState');

const featureFlags = require('../../utils/featureFlags');
const {
  runInMultiUnitPaidOrphanRecoveryContext,
  assertMultiUnitPaidOrphanRecoveryContext
} = require('./multiUnitPaidOrphanRecoveryCapability');
const {
  createSanitizedRecoveryError,
  MultiUnitPaidOrphanRecoveryError
} = require('./multiUnitPaidOrphanRecoveryErrors');
const {
  acquireManualReviewResolutionHold,
  ensureMultiUnitPaidOrphanCompletionReview,
  transferRecoveryHoldToCompletionReview,
  resolveActiveRecoveryHeldManualReview
} = require('./multiUnitPaidOrphanRecoveryReviewService');
const {
  acquireInitialMultiUnitRecoveryLease,
  reclaimMultiUnitRecoveryLease,
  renewMultiUnitRecoveryLease,
  markCheckoutFinalizationJobSucceededFromMultiUnitRecovery,
  advanceMultiUnitRecoveryStatus,
  markCheckoutFinalizationJobConfirmationQueued,
  markMultiUnitRecoveryComplete,
  setActiveRecoveryReviewItemId,
  RECOVERY_LEASE_TTL_MS,
  INCOMPLETE_RECOVERY_STATUSES
} = require('./checkoutFinalizationJobService');
const { runCheckoutFinalizeOrchestration } = require('./checkoutFinalizeService');
const { executeBookingFinalizeWork } = require('./executeBookingFinalizeWork');
const {
  buildFinalizeContextFromPersisted,
  findAdoptableBooking,
  verifySucceededPaymentIntentAgainstSession
} = require('./finalizePaidCheckout');
const { convertSavedQuoteForBooking } = require('./checkoutFinalizeSideEffects');
const { linkStripePaymentToBooking } = require('../payments/paymentLinkingService');
const { normalizeGuestEmail } = require('./bookingCommercialStayFingerprint');
const AssignmentEngine = require('../assignmentEngine');
const { BLOCKING_BOOKING_STATUSES } = require('../calendar/blockingStatusConstants');
const {
  formatSofiaDateOnly,
  normalizeDateToSofiaDayStart
} = require('../../utils/dateTime');
const Stripe = require('stripe');
const {
  ensurePendingConfirmationDelivery,
  resolveConfirmationTemplateKey
} = require('../email/bookingConfirmationDeliveryService');
const {
  bookingLifecycleCorrelationKey
} = require('../email/emailDeliveryCorrelation');

const SCHEMA_VERSION = 'multi-unit-paid-orphan-recovery/v1';
const MAX_DIGEST_AGE_MS = 24 * 60 * 60 * 1000;
const INTENT_PHRASE =
  'I CONFIRM THE GUEST INTENDS TO PURCHASE A SECOND PHYSICAL A-FRAME';

/** First-Booking statuses eligible to supply authoritative stay-date evidence. */
const FIRST_BOOKING_DATE_ELIGIBLE_STATUSES = Object.freeze([...BLOCKING_BOOKING_STATUSES]);

/** Test-only fault injector: async (boundaryName) => void|Promise. Throws to abort after durable writes. */
let recoveryFaultInjectorForTesting = null;

function __setRecoveryFaultInjectorForTesting(fn) {
  recoveryFaultInjectorForTesting = typeof fn === 'function' ? fn : null;
}

function __resetRecoveryFaultInjectorForTesting() {
  recoveryFaultInjectorForTesting = null;
}

async function maybeInjectRecoveryFault(boundary) {
  if (typeof recoveryFaultInjectorForTesting !== 'function') return;
  await recoveryFaultInjectorForTesting(String(boundary));
}

function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.normalize('NFC');
  if (value instanceof Date) return value.toISOString();
  if (value instanceof mongoose.Types.ObjectId) {
    return String(value).toLowerCase();
  }
  if (Array.isArray(value)) {
    const mapped = value
      .map((v) => canonicalize(v))
      .filter((v) => v !== undefined);
    const allScalar = mapped.every(
      (v) => v === null || typeof v !== 'object'
    );
    if (allScalar) {
      return mapped.slice().sort((a, b) => {
        const sa = JSON.stringify(a);
        const sb = JSON.stringify(b);
        return sa < sb ? -1 : sa > sb ? 1 : 0;
      });
    }
    return mapped;
  }
  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const next = canonicalize(value[key]);
      if (next !== undefined) out[key] = next;
    }
    return out;
  }
  return String(value);
}

function sha256Hex(canonicalEvidence) {
  return crypto
    .createHash('sha256')
    .update(stableStringify(canonicalEvidence), 'utf8')
    .digest('hex');
}

function hashAllowlistIdentity(allowlist) {
  return sha256Hex({
    checkoutId: allowlist.checkoutId,
    checkoutSessionId: String(allowlist.checkoutSessionId),
    paymentIntentId: allowlist.paymentIntentId,
    paymentId: String(allowlist.paymentId),
    finalizationJobId: String(allowlist.finalizationJobId),
    manualReviewItemId: String(allowlist.manualReviewItemId),
    cabinTypeId: String(allowlist.cabinTypeId),
    expectedTargetUnitId: String(allowlist.expectedTargetUnitId)
  });
}

function requireAllowlist(allowlist) {
  if (!allowlist || typeof allowlist !== 'object') {
    throw createSanitizedRecoveryError('RECOVERY_ALLOWLIST_MISMATCH');
  }
  const required = [
    'checkoutId',
    'checkoutSessionId',
    'paymentIntentId',
    'paymentId',
    'finalizationJobId',
    'manualReviewItemId',
    'cabinTypeId',
    'expectedTargetUnitId'
  ];
  for (const key of required) {
    if (allowlist[key] == null || String(allowlist[key]).trim() === '') {
      throw createSanitizedRecoveryError('RECOVERY_ALLOWLIST_MISMATCH', {
        reason: `missing_${key}`
      });
    }
  }
  return allowlist;
}

function isUsableStayDateInput(value) {
  if (value == null || value === '') return false;
  if (value instanceof Date && Number.isNaN(value.getTime())) return false;
  return true;
}

/**
 * Normalize a stay boundary pair to Sofia civil dates.
 * @returns {{ kind: 'absent' } | { kind: 'ok', checkIn: Date, checkOut: Date, checkInDateOnly: string, checkOutDateOnly: string }}
 */
function tryNormalizeStayDatePair(checkInRaw, checkOutRaw) {
  const hasIn = isUsableStayDateInput(checkInRaw);
  const hasOut = isUsableStayDateInput(checkOutRaw);
  if (!hasIn && !hasOut) return { kind: 'absent' };
  if (!hasIn || !hasOut) {
    throw createSanitizedRecoveryError('RECOVERY_HOSTILE_STATE_DRIFT', {
      reason: 'malformed_stay_date_evidence'
    });
  }

  const checkInDateOnly = formatSofiaDateOnly(checkInRaw);
  const checkOutDateOnly = formatSofiaDateOnly(checkOutRaw);
  if (!checkInDateOnly || !checkOutDateOnly) {
    throw createSanitizedRecoveryError('RECOVERY_HOSTILE_STATE_DRIFT', {
      reason: 'malformed_stay_date_evidence'
    });
  }

  const checkIn = normalizeDateToSofiaDayStart(checkInDateOnly);
  const checkOut = normalizeDateToSofiaDayStart(checkOutDateOnly);
  if (
    Number.isNaN(checkIn.getTime()) ||
    Number.isNaN(checkOut.getTime()) ||
    !(checkOut.getTime() > checkIn.getTime())
  ) {
    throw createSanitizedRecoveryError('RECOVERY_HOSTILE_STATE_DRIFT', {
      reason: 'invalid_exclusive_stay_range'
    });
  }

  return { kind: 'ok', checkIn, checkOut, checkInDateOnly, checkOutDateOnly };
}

function extractQuoteSnapshotStayDates(session) {
  const qs = session?.quoteSnapshot;
  if (!qs || typeof qs !== 'object') return { kind: 'absent' };
  return tryNormalizeStayDatePair(
    qs.checkInDate ?? qs.checkInISO ?? qs.checkInDateOnly,
    qs.checkOutDate ?? qs.checkOutISO ?? qs.checkOutDateOnly
  );
}

function extractFinalizeIntentStayDates(session) {
  const fi = session?.finalizeIntent;
  if (!fi || typeof fi !== 'object') return { kind: 'absent' };
  return tryNormalizeStayDatePair(
    fi.checkInDate ?? fi.checkInISO ?? fi.checkInDateOnly,
    fi.checkOutDate ?? fi.checkOutISO ?? fi.checkOutDateOnly
  );
}

function extractDirectSessionStayDates(session) {
  if (!session || typeof session !== 'object') return { kind: 'absent' };
  return tryNormalizeStayDatePair(session.checkInDate, session.checkOutDate);
}

function stayDatePairsEqual(a, b) {
  return (
    a.checkInDateOnly === b.checkInDateOnly &&
    a.checkOutDateOnly === b.checkOutDateOnly
  );
}

/**
 * Decide whether the allowlisted first Booking may supply stay dates.
 * Fail-closed on fingerprint mismatch when the Booking is otherwise the only
 * candidate (caller maps codes). Returns { ok:true } or { ok:false, code?, reason }.
 */
function evaluateFirstBookingDateAdoption({ allowlist, firstBooking, session }) {
  if (!allowlist?.firstBookingId) {
    return { ok: false, reason: 'no_first_booking_id' };
  }
  if (!firstBooking) {
    return { ok: false, reason: 'first_booking_missing' };
  }
  if (String(firstBooking._id) !== String(allowlist.firstBookingId)) {
    return { ok: false, reason: 'first_booking_id_mismatch' };
  }
  if (!FIRST_BOOKING_DATE_ELIGIBLE_STATUSES.includes(String(firstBooking.status || ''))) {
    return { ok: false, reason: 'first_booking_status_ineligible' };
  }
  if (!session?.stayFingerprint || !firstBooking.commercialStayFingerprint) {
    return { ok: false, reason: 'fingerprint_missing' };
  }
  if (
    String(firstBooking.commercialStayFingerprint) !== String(session.stayFingerprint)
  ) {
    return { ok: false, code: 'RECOVERY_FINGERPRINT_MISMATCH', reason: 'fingerprint_mismatch' };
  }
  if (
    !firstBooking.cabinTypeId ||
    String(firstBooking.cabinTypeId) !== String(allowlist.cabinTypeId)
  ) {
    return { ok: false, reason: 'first_booking_cabin_type_mismatch' };
  }
  const sessionCabinTypeId =
    session.quoteSnapshot?.cabinTypeId ||
    session.finalizeIntent?.cabinTypeId ||
    session.cabinTypeId ||
    null;
  if (
    sessionCabinTypeId &&
    String(sessionCabinTypeId) !== String(allowlist.cabinTypeId)
  ) {
    return { ok: false, reason: 'session_cabin_type_mismatch' };
  }
  return { ok: true };
}

/**
 * Authoritative fail-closed stay-date resolver for paid-orphan recovery evidence.
 *
 * Precedence among session sources: quoteSnapshot → finalizeIntent → direct fields.
 * Allowlisted first Booking supplies dates only for the legacy empty-session case,
 * and only when identity / fingerprint / cabin-type checks pass.
 * Two populated authoritative sources with conflicting Sofia dates → hostile drift.
 */
function resolveRecoveryStayDates({ allowlist, session, firstBooking }) {
  const sessionSources = [
    { name: 'quoteSnapshot', pair: extractQuoteSnapshotStayDates(session) },
    { name: 'finalizeIntent', pair: extractFinalizeIntentStayDates(session) },
    { name: 'sessionDirect', pair: extractDirectSessionStayDates(session) }
  ];

  const populatedSession = [];
  for (const entry of sessionSources) {
    if (entry.pair.kind === 'ok') populatedSession.push(entry);
  }

  let sessionResolved = null;
  if (populatedSession.length > 0) {
    sessionResolved = populatedSession[0].pair;
    for (let i = 1; i < populatedSession.length; i += 1) {
      if (!stayDatePairsEqual(sessionResolved, populatedSession[i].pair)) {
        throw createSanitizedRecoveryError('RECOVERY_HOSTILE_STATE_DRIFT', {
          reason: 'conflicting_session_stay_date_sources',
          sources: `${populatedSession[0].name},${populatedSession[i].name}`
        });
      }
    }
  }

  const adoption = evaluateFirstBookingDateAdoption({
    allowlist,
    firstBooking,
    session
  });

  if (sessionResolved) {
    if (adoption.ok === true) {
      const bookingPair = tryNormalizeStayDatePair(
        firstBooking.checkIn,
        firstBooking.checkOut
      );
      if (bookingPair.kind === 'ok' && !stayDatePairsEqual(sessionResolved, bookingPair)) {
        throw createSanitizedRecoveryError('RECOVERY_HOSTILE_STATE_DRIFT', {
          reason: 'conflicting_session_and_first_booking_stay_dates'
        });
      }
    }
    return {
      checkIn: sessionResolved.checkIn,
      checkOut: sessionResolved.checkOut,
      checkInDateOnly: sessionResolved.checkInDateOnly,
      checkOutDateOnly: sessionResolved.checkOutDateOnly,
      source: populatedSession[0].name
    };
  }

  // Legacy session: no usable session dates — first Booking may supply.
  if (adoption.ok !== true) {
    if (adoption.code === 'RECOVERY_FINGERPRINT_MISMATCH') {
      throw createSanitizedRecoveryError('RECOVERY_FINGERPRINT_MISMATCH');
    }
    throw createSanitizedRecoveryError('RECOVERY_HOSTILE_STATE_DRIFT', {
      reason: adoption.reason || 'missing_stay_date_evidence'
    });
  }

  const bookingPair = tryNormalizeStayDatePair(
    firstBooking.checkIn,
    firstBooking.checkOut
  );
  if (bookingPair.kind !== 'ok') {
    throw createSanitizedRecoveryError('RECOVERY_HOSTILE_STATE_DRIFT', {
      reason: 'missing_stay_date_evidence'
    });
  }

  return {
    checkIn: bookingPair.checkIn,
    checkOut: bookingPair.checkOut,
    checkInDateOnly: bookingPair.checkInDateOnly,
    checkOutDateOnly: bookingPair.checkOutDateOnly,
    source: 'firstBooking'
  };
}

async function loadIncidentDocuments(allowlist) {
  const [
    session,
    job,
    payment,
    review,
    targetUnit,
    firstBooking
  ] = await Promise.all([
    CheckoutSession.findById(allowlist.checkoutSessionId).lean(),
    CheckoutFinalizationJob.findById(allowlist.finalizationJobId).lean(),
    Payment.findById(allowlist.paymentId).lean(),
    ManualReviewItem.findById(allowlist.manualReviewItemId).lean(),
    Unit.findById(allowlist.expectedTargetUnitId).lean(),
    allowlist.firstBookingId
      ? Booking.findById(allowlist.firstBookingId).lean()
      : null
  ]);

  if (!session || String(session.checkoutId) !== String(allowlist.checkoutId)) {
    throw createSanitizedRecoveryError('RECOVERY_ALLOWLIST_MISMATCH', {
      reason: 'checkout_session'
    });
  }
  if (
    !job ||
    String(job.checkoutId) !== String(allowlist.checkoutId) ||
    String(job.paymentIntentId) !== String(allowlist.paymentIntentId)
  ) {
    throw createSanitizedRecoveryError('RECOVERY_ALLOWLIST_MISMATCH', {
      reason: 'finalization_job'
    });
  }
  if (!payment) {
    throw createSanitizedRecoveryError('RECOVERY_ALLOWLIST_MISMATCH', {
      reason: 'payment'
    });
  }
  if (!review) {
    throw createSanitizedRecoveryError('RECOVERY_ALLOWLIST_MISMATCH', {
      reason: 'manual_review'
    });
  }
  if (!targetUnit) {
    throw createSanitizedRecoveryError('RECOVERY_TARGET_UNIT_UNAVAILABLE', {
      reason: 'unit_missing'
    });
  }

  return { session, job, payment, review, targetUnit, firstBooking };
}

function computeGuestIdentityProof({ firstBooking, session }) {
  const firstEmail = normalizeGuestEmail(firstBooking?.guestInfo?.email);
  const sessionEmail = normalizeGuestEmail(session?.guestEmail);
  const intentEmail = normalizeGuestEmail(session?.finalizeIntent?.guestInfo?.email);

  if (!firstEmail || !sessionEmail) {
    return { guestIdentityMatch: false, stayFingerprintMatch: null, missing: true };
  }
  if (intentEmail && intentEmail !== sessionEmail) {
    return { guestIdentityMatch: false, stayFingerprintMatch: null, missing: false };
  }
  const guestIdentityMatch = firstEmail === sessionEmail;
  let stayFingerprintMatch = null;
  if (firstBooking?.commercialStayFingerprint && session?.stayFingerprint) {
    stayFingerprintMatch =
      String(firstBooking.commercialStayFingerprint) === String(session.stayFingerprint);
  }
  return { guestIdentityMatch, stayFingerprintMatch, missing: false };
}

async function evaluateTargetUnitAvailability({
  expectedTargetUnitId,
  cabinTypeId,
  checkIn,
  checkOut
}) {
  if (!isUsableStayDateInput(checkIn) || !isUsableStayDateInput(checkOut)) {
    throw createSanitizedRecoveryError('RECOVERY_HOSTILE_STATE_DRIFT', {
      reason: 'missing_stay_date_evidence'
    });
  }
  let result;
  try {
    result = await AssignmentEngine.validateUnitForCabinTypeBooking(
      expectedTargetUnitId,
      cabinTypeId,
      checkIn,
      checkOut
    );
  } catch (err) {
    if (err instanceof MultiUnitPaidOrphanRecoveryError) throw err;
    throw createSanitizedRecoveryError('RECOVERY_HOSTILE_STATE_DRIFT', {
      reason: 'stay_date_validation_failed'
    });
  }
  return {
    ok: result?.ok === true,
    code: result?.ok ? null : result?.code || 'UNIT_NOT_AVAILABLE'
  };
}

async function buildCanonicalEvidence(allowlist, docs, dryRunGeneratedAt) {
  const { session, job, payment, review, targetUnit, firstBooking } = docs;
  const stayDates = resolveRecoveryStayDates({ allowlist, session, firstBooking });

  const availability = await evaluateTargetUnitAvailability({
    expectedTargetUnitId: allowlist.expectedTargetUnitId,
    cabinTypeId: allowlist.cabinTypeId,
    checkIn: stayDates.checkIn,
    checkOut: stayDates.checkOut
  });

  const identity = computeGuestIdentityProof({ firstBooking, session });

  return {
    schemaVersion: SCHEMA_VERSION,
    dryRunGeneratedAt:
      dryRunGeneratedAt instanceof Date
        ? dryRunGeneratedAt.toISOString()
        : String(dryRunGeneratedAt),
    checkoutId: String(allowlist.checkoutId),
    checkoutSessionMongoId: String(session._id),
    paymentIntentId: String(allowlist.paymentIntentId),
    paymentRecordId: String(payment._id),
    finalizationJobId: String(job._id),
    manualReviewItemId: String(review._id),
    expectedCabinTypeId: String(allowlist.cabinTypeId),
    expectedTargetUnitId: String(allowlist.expectedTargetUnitId),
    expectedCheckInDateOnly: stayDates.checkInDateOnly,
    expectedCheckOutDateOnly: stayDates.checkOutDateOnly,
    expectedAmountCents:
      payment.amountCents != null
        ? Number(payment.amountCents)
        : session.quoteSnapshot?.totalCents != null
          ? Number(session.quoteSnapshot.totalCents)
          : null,
    expectedCurrency: String(
      payment.currency || session.quoteSnapshot?.currency || 'eur'
    ).toLowerCase(),
    expectedQuoteSnapshotHash: session.quoteSnapshotHash || null,
    expectedFinalizeIntentHash: session.finalizeIntentHash || null,
    expectedFailureCode: allowlist.expectedFailureCode || 'DUPLICATE_STAY_CONFLICT',
    session: {
      status: session.status || null,
      finalizeStatus: session.finalizeStatus || null,
      paymentStatus: session.paymentStatus || null,
      bookingId: session.bookingId ? String(session.bookingId) : null
    },
    job: {
      status: job.status || null,
      lastErrorCode: job.lastErrorCode || null,
      stage: job.stage || null,
      recoveryStatus: job.recoveryStatus || 'idle'
    },
    payment: {
      status: payment.status || null,
      reservationId: payment.reservationId ? String(payment.reservationId) : null
    },
    MRI: {
      status: review.status || null,
      category: review.category || null
    },
    firstBookingId: firstBooking ? String(firstBooking._id) : null,
    firstBookingUnitId: firstBooking?.unitId ? String(firstBooking.unitId) : null,
    firstBookingStatus: firstBooking?.status || null,
    targetUnit: {
      isActive: targetUnit.isActive !== false,
      updatedAt: targetUnit.updatedAt
        ? new Date(targetUnit.updatedAt).toISOString()
        : null
    },
    targetUnitAvailabilityResult: availability,
    guestIdentityMatch: identity.guestIdentityMatch === true,
    stayFingerprintMatch: identity.stayFingerprintMatch
  };
}

async function dryRunMultiUnitPaidOrphanRecovery({
  allowlist,
  now = new Date()
} = {}) {
  const row = requireAllowlist(allowlist);
  const docs = await loadIncidentDocuments(row);
  const at = now instanceof Date ? now : new Date(now);
  const canonicalEvidence = await buildCanonicalEvidence(row, docs, at);
  const digest = sha256Hex(canonicalEvidence);

  if (canonicalEvidence.dryRunGeneratedAt !== String(at.toISOString())) {
    // invariant enforced by construction
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    dryRunGeneratedAt: canonicalEvidence.dryRunGeneratedAt,
    canonicalEvidence,
    digest,
    writes: 0
  };
}

function verifyOriginalEvidence({ originalEvidence, digest }) {
  if (!originalEvidence || typeof originalEvidence !== 'object') {
    throw createSanitizedRecoveryError('RECOVERY_DIGEST_MISMATCH');
  }
  const { schemaVersion, dryRunGeneratedAt, canonicalEvidence } = originalEvidence;
  if (schemaVersion !== SCHEMA_VERSION || !canonicalEvidence) {
    throw createSanitizedRecoveryError('RECOVERY_DIGEST_MISMATCH', {
      reason: 'schema'
    });
  }
  if (dryRunGeneratedAt !== canonicalEvidence.dryRunGeneratedAt) {
    throw createSanitizedRecoveryError('RECOVERY_DIGEST_MISMATCH', {
      reason: 'envelope_timestamp'
    });
  }
  const recomputed = sha256Hex(canonicalEvidence);
  const provided = String(digest || originalEvidence.digest || '').toLowerCase();
  if (recomputed !== provided) {
    throw createSanitizedRecoveryError('RECOVERY_DIGEST_MISMATCH');
  }
  return { canonicalEvidence, digest: recomputed };
}

function verifyDigestAge(canonicalEvidence, now) {
  const generatedAt = new Date(canonicalEvidence.dryRunGeneratedAt);
  if (Number.isNaN(generatedAt.getTime())) {
    throw createSanitizedRecoveryError('RECOVERY_DIGEST_MISMATCH', {
      reason: 'bad_timestamp'
    });
  }
  if (now.getTime() - generatedAt.getTime() > MAX_DIGEST_AGE_MS) {
    throw createSanitizedRecoveryError('RECOVERY_DIGEST_EXPIRED');
  }
}

function verifyIntentOverlay(intentOverlay) {
  if (!intentOverlay || typeof intentOverlay !== 'object') {
    throw createSanitizedRecoveryError('RECOVERY_INTENT_NOT_CONFIRMED');
  }
  if (String(intentOverlay.confirmationPhrase || '') !== INTENT_PHRASE) {
    throw createSanitizedRecoveryError('RECOVERY_INTENT_MISMATCH');
  }
  const actor = String(intentOverlay.operatorActorId || '');
  if (!/^ops:[A-Za-z0-9._-]{1,64}$/.test(actor)) {
    throw createSanitizedRecoveryError('RECOVERY_INTENT_NOT_CONFIRMED', {
      reason: 'operator_actor'
    });
  }
  const intentAt = new Date(intentOverlay.operatorIntentConfirmedAt);
  if (Number.isNaN(intentAt.getTime())) {
    throw createSanitizedRecoveryError('RECOVERY_INTENT_NOT_CONFIRMED', {
      reason: 'intent_timestamp'
    });
  }
  const reason = String(intentOverlay.recoveryReason || '').trim();
  if (!reason || reason.length > 500) {
    throw createSanitizedRecoveryError('RECOVERY_INTENT_NOT_CONFIRMED', {
      reason: 'recovery_reason'
    });
  }
  return {
    operatorActorId: actor,
    operatorIntentConfirmedAt: intentAt,
    recoveryReason: reason,
    resumedBy: intentOverlay.resumedBy
      ? String(intentOverlay.resumedBy)
      : null
  };
}

/** Binding §13: material paths compared between original (digest-verified) and live evidence. */
const MATERIAL_EVIDENCE_PATHS = Object.freeze([
  'checkoutId',
  'checkoutSessionMongoId',
  'paymentIntentId',
  'paymentRecordId',
  'finalizationJobId',
  'manualReviewItemId',
  'expectedCabinTypeId',
  'expectedTargetUnitId',
  'expectedCheckInDateOnly',
  'expectedCheckOutDateOnly',
  'expectedAmountCents',
  'expectedCurrency',
  'expectedQuoteSnapshotHash',
  'expectedFinalizeIntentHash',
  'expectedFailureCode',
  'guestIdentityMatch',
  'stayFingerprintMatch',
  'firstBookingId',
  'firstBookingUnitId',
  'firstBookingStatus',
  'session.status',
  'session.finalizeStatus',
  'session.paymentStatus',
  'session.bookingId',
  'job.status',
  'job.lastErrorCode',
  'job.stage',
  'job.recoveryStatus',
  'payment.status',
  'payment.reservationId',
  'MRI.status',
  'MRI.category',
  'targetUnit.isActive',
  'targetUnit.updatedAt'
]);

const OBJECT_ID_STRING_RE = /^[a-f0-9]{24}$/i;

function getNestedEvidenceValue(source, path) {
  return path
    .split('.')
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), source);
}

function normalizeMaterialEvidenceValue(value) {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof mongoose.Types.ObjectId) return String(value).toLowerCase();
  if (typeof value === 'object' && typeof value.toHexString === 'function') {
    try {
      return String(value.toHexString()).toLowerCase();
    } catch {
      return String(value);
    }
  }
  if (typeof value === 'string') {
    return OBJECT_ID_STRING_RE.test(value) ? value.toLowerCase() : value;
  }
  return value;
}

/** Nullish values on either side are treated as equal; every other mismatch fails closed. */
function materialEvidenceFieldMismatches(a, b) {
  const na = normalizeMaterialEvidenceValue(a);
  const nb = normalizeMaterialEvidenceValue(b);
  if (na === null && nb === null) return false;
  if (na === null || nb === null) return true;
  return na !== nb;
}

/**
 * Sole authoritative original-vs-live evidence comparison. Fail-closed: any
 * mismatched path is reported and the caller MUST abort before lease
 * acquisition. No stableStringify fallback may override a reported mismatch.
 */
function compareMaterialEvidence(original, live) {
  if (!original || typeof original !== 'object' || !live || typeof live !== 'object') {
    return { ok: false, mismatchedFields: ['__evidence_shape'] };
  }

  const mismatchedFields = [];
  for (const path of MATERIAL_EVIDENCE_PATHS) {
    const a = getNestedEvidenceValue(original, path);
    const b = getNestedEvidenceValue(live, path);
    if (materialEvidenceFieldMismatches(a, b)) {
      mismatchedFields.push(path);
    }
  }

  const availabilityA = stableStringify(original.targetUnitAvailabilityResult ?? null);
  const availabilityB = stableStringify(live.targetUnitAvailabilityResult ?? null);
  if (availabilityA !== availabilityB) {
    mismatchedFields.push('targetUnitAvailabilityResult');
  }

  return mismatchedFields.length === 0 ? { ok: true } : { ok: false, mismatchedFields };
}

function buildExpectedScope({
  recoveryMode,
  recoveryExecutionId,
  allowlist,
  evidenceDigest
}) {
  return {
    recoveryMode,
    recoveryExecutionId,
    checkoutId: String(allowlist.checkoutId),
    checkoutSessionId: String(allowlist.checkoutSessionId),
    paymentIntentId: String(allowlist.paymentIntentId),
    paymentId: String(allowlist.paymentId),
    finalizationJobId: String(allowlist.finalizationJobId),
    manualReviewItemId: String(allowlist.manualReviewItemId),
    cabinTypeId: String(allowlist.cabinTypeId),
    expectedTargetUnitId: String(allowlist.expectedTargetUnitId),
    evidenceDigest: String(evidenceDigest).toLowerCase()
  };
}

function getStripeClient(stripeOverride = null) {
  if (stripeOverride) return stripeOverride;
  // Same authoritative seam as checkoutFinalizationWorker / reconcilePaidCheckoutFinalization.
  // Do not require a nonexistent server/config/stripe module.
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

async function runMultiUnitPaidOrphanRecoveryBookingFinalizeCore({
  checkoutId,
  paymentIntentId,
  expectedScope,
  expectedTargetUnitId,
  stripe = null,
  now = new Date(),
  source = 'multi_unit_paid_orphan_recovery'
}) {
  assertMultiUnitPaidOrphanRecoveryContext(
    {
      checkoutId: String(checkoutId),
      checkoutSessionId: String(expectedScope.checkoutSessionId),
      paymentIntentId: String(paymentIntentId),
      cabinTypeId: String(expectedScope.cabinTypeId),
      expectedTargetUnitId: String(expectedTargetUnitId),
      evidenceDigest: expectedScope.evidenceDigest
    },
    { operation: 'exact_unit_injection' }
  );

  const session = await CheckoutSession.findOne({ checkoutId }).lean();
  if (!session) {
    throw createSanitizedRecoveryError('RECOVERY_HOSTILE_STATE_DRIFT', {
      reason: 'session_missing'
    });
  }

  const stripeClient = getStripeClient(stripe);
  if (!stripeClient?.paymentIntents?.retrieve) {
    throw createSanitizedRecoveryError('RECOVERY_HOSTILE_STATE_DRIFT', {
      reason: 'stripe_client_unavailable'
    });
  }
  const pi = await stripeClient.paymentIntents.retrieve(String(paymentIntentId));
  verifySucceededPaymentIntentAgainstSession({
    session,
    paymentIntent: pi
  });

  const finalizeContext = await buildFinalizeContextFromPersisted({
    session,
    paymentIntent: pi,
    stripePaymentVerified: true,
    source
  });

  assertMultiUnitPaidOrphanRecoveryContext({
    checkoutId: String(checkoutId),
    checkoutSessionId: String(session._id),
    paymentIntentId: String(paymentIntentId),
    cabinTypeId: String(finalizeContext.cabinTypeId || expectedScope.cabinTypeId),
    expectedTargetUnitId: String(expectedTargetUnitId),
    evidenceDigest: expectedScope.evidenceDigest
  }, { operation: 'exact_unit_injection' });
  finalizeContext.assignedUnitId = String(expectedTargetUnitId);

  const bookingPayload = {
    cabinId: finalizeContext.cabinId,
    cabinTypeId: finalizeContext.cabinTypeId,
    unitId: finalizeContext.assignedUnitId,
    checkInDate: finalizeContext.checkInDate,
    checkOutDate: finalizeContext.checkOutDate,
    guestInfo: finalizeContext.guestInfo
  };

  const orchResult = await runCheckoutFinalizeOrchestration({
    checkoutId: String(checkoutId),
    paymentIntentId: String(paymentIntentId),
    bookingPayload,
    now,
    source,
    paidFinalizeOverride: true,
    setPaymentStatusPaid: true,
    recoveryCommercialStayIdentity: {
      evidenceDigest: expectedScope.evidenceDigest,
      paymentIntentId: String(paymentIntentId)
    },
    finalizeWork: async (workInput) =>
      executeBookingFinalizeWork({
        session: workInput.session,
        checkoutId: workInput.checkoutId,
        paymentIntentId: workInput.paymentIntentId,
        bookingPayload: workInput.bookingPayload,
        finalizeContext,
        source: workInput.source || source,
        dependencies: {
          openManualReviewItem: async () => null
        }
      })
  });

  return orchResult;
}

async function findExistingRecoveryBooking(allowlist) {
  const byCheckout = await Booking.findOne({
    checkoutId: String(allowlist.checkoutId)
  }).lean();
  if (byCheckout) return byCheckout;
  return findAdoptableBooking({
    checkoutId: String(allowlist.checkoutId),
    paymentIntentId: String(allowlist.paymentIntentId),
    BookingModel: Booking
  });
}

async function ensurePaymentAndSessionLinked({
  booking,
  allowlist,
  expectedScope,
  now
}) {
  assertMultiUnitPaidOrphanRecoveryContext(
    {
      checkoutId: expectedScope.checkoutId,
      checkoutSessionId: expectedScope.checkoutSessionId,
      paymentId: expectedScope.paymentId || String(allowlist.paymentId),
      paymentIntentId: expectedScope.paymentIntentId,
      manualReviewItemId: expectedScope.manualReviewItemId || String(allowlist.manualReviewItemId),
      evidenceDigest: expectedScope.evidenceDigest
    },
    { operation: 'payment_link_review_suppression' }
  );

  const payment = await Payment.findById(allowlist.paymentId);
  if (!payment) {
    throw createSanitizedRecoveryError('RECOVERY_IDENTITY_MISMATCH', {
      reason: 'payment_missing'
    });
  }
  if (String(payment.status) !== 'paid') {
    throw createSanitizedRecoveryError('RECOVERY_PAYMENT_NOT_PAID');
  }

  const existingReservationId = payment.reservationId
    ? String(payment.reservationId)
    : null;
  if (existingReservationId && existingReservationId !== String(booking._id)) {
    throw createSanitizedRecoveryError('RECOVERY_PAYMENT_ALREADY_LINKED_ELSEWHERE');
  }

  // Link via authoritative helper; MRI auto-resolve is hold-blocked.
  await linkStripePaymentToBooking({
    booking,
    linkedBy: 'multi_unit_paid_orphan_recovery',
    apply: true
  });

  const session = await CheckoutSession.findById(allowlist.checkoutSessionId);
  if (!session) {
    throw createSanitizedRecoveryError('RECOVERY_HOSTILE_STATE_DRIFT', {
      reason: 'session_missing_link'
    });
  }
  if (session.bookingId && String(session.bookingId) !== String(booking._id)) {
    throw createSanitizedRecoveryError('RECOVERY_HOSTILE_STATE_DRIFT', {
      reason: 'foreign_session_booking'
    });
  }

  let sessionDirty = false;
  if (!session.bookingId || session.finalizeStatus !== 'finalized') {
    session.bookingId = booking._id;
    session.finalizeStatus = 'finalized';
    session.paymentStatus = 'paid';
    session.finalizedAt = session.finalizedAt || now;
    sessionDirty = true;
  }
  // `finalized` is finalizeStatus only — CheckoutSession.status has no such enum value.
  // Clear durable needs_review so ordinary writers no longer treat the session as blocked.
  if (String(session.status || '') === 'needs_review') {
    session.status = 'paid';
    sessionDirty = true;
  }
  if (session.paymentStatus !== 'paid') {
    session.paymentStatus = 'paid';
    sessionDirty = true;
  }
  if (sessionDirty) {
    await session.save();
  }

  return { payment, session };
}

async function verifyCompletionGate({
  allowlist,
  booking,
  job,
  expectedScope
}) {
  assertMultiUnitPaidOrphanRecoveryContext(expectedScope, {
    operation: 'recovery_job_transition'
  });

  if (!booking || String(booking.unitId) !== String(allowlist.expectedTargetUnitId)) {
    throw createSanitizedRecoveryError('RECOVERY_HOSTILE_STATE_DRIFT', {
      reason: 'booking_unit'
    });
  }

  const payment = await Payment.findById(allowlist.paymentId).lean();
  if (!payment || String(payment.reservationId) !== String(booking._id)) {
    throw createSanitizedRecoveryError('RECOVERY_PARTIAL_LINKAGE', {
      reason: 'payment'
    });
  }

  const session = await CheckoutSession.findById(allowlist.checkoutSessionId).lean();
  if (
    !session ||
    String(session.bookingId) !== String(booking._id) ||
    session.finalizeStatus !== 'finalized'
  ) {
    throw createSanitizedRecoveryError('RECOVERY_PARTIAL_LINKAGE', {
      reason: 'session'
    });
  }

  if (job.status !== 'succeeded') {
    throw createSanitizedRecoveryError('RECOVERY_PARTIAL_STATE', {
      reason: 'job_not_succeeded'
    });
  }
  if (job.recoveryStatus !== 'awaiting_review_resolution') {
    throw createSanitizedRecoveryError('RECOVERY_RESUME_PHASE_MISMATCH', {
      reason: 'not_awaiting_review_resolution'
    });
  }
  if (!job.confirmationQueuedAt) {
    throw createSanitizedRecoveryError('RECOVERY_CONFIRMATION_STATE_INVALID', {
      reason: 'missing_queued_at'
    });
  }
  if (!job.activeRecoveryReviewItemId) {
    throw createSanitizedRecoveryError('RECOVERY_MRI_HOLD_CONFLICT', {
      reason: 'missing_active_review'
    });
  }

  const review = await ManualReviewItem.findById(job.activeRecoveryReviewItemId).lean();
  if (
    !review ||
    review.status !== 'open' ||
    review.resolutionHold?.status !== 'active' ||
    review.resolutionHold?.recoveryExecutionId !== job.recoveryExecutionId
  ) {
    if (review?.status === 'resolved') {
      // may be premature — handled by caller
      throw createSanitizedRecoveryError('RECOVERY_REVIEW_RESOLVED_PREMATURELY');
    }
    throw createSanitizedRecoveryError('RECOVERY_MRI_HOLD_CONFLICT', {
      reason: 'active_hold_missing'
    });
  }

  return { payment, session, review };
}

async function ensureConfirmationEds({ booking, session, now }) {
  const templateKey = resolveConfirmationTemplateKey(booking);
  const ensured = await ensurePendingConfirmationDelivery({
    booking,
    session,
    templateKey,
    source: 'automatic',
    now
  });
  return ensured;
}

async function buildCorrelationKeyForBooking(booking, session) {
  const templateKey = resolveConfirmationTemplateKey(booking);
  const recipient =
    normalizeGuestEmail(booking?.guestInfo?.email) ||
    normalizeGuestEmail(session?.guestEmail);
  return bookingLifecycleCorrelationKey({
    bookingId: String(booking._id),
    templateKey,
    recipientEmail: recipient
  });
}

async function executeRecoveryInsideContext({
  mode,
  allowlist,
  expectedScope,
  recoveryExecutionId,
  evidenceDigest,
  allowlistHash,
  operator,
  stripe,
  now
}) {
  const at = now instanceof Date ? now : new Date(now);
  assertMultiUnitPaidOrphanRecoveryContext(expectedScope, {
    operation: 'recovery_job_lease'
  });

  let job;
  if (mode === 'initial') {
    job = await acquireInitialMultiUnitRecoveryLease({
      jobId: allowlist.finalizationJobId,
      checkoutId: allowlist.checkoutId,
      paymentIntentId: allowlist.paymentIntentId,
      expectedLastErrorCode: allowlist.expectedFailureCode || 'DUPLICATE_STAY_CONFLICT',
      recoveryExecutionId,
      evidenceDigest,
      allowlistHash,
      operatorActorId: operator.operatorActorId,
      operatorIntentConfirmedAt: operator.operatorIntentConfirmedAt,
      recoveryReason: operator.recoveryReason,
      expectedScope,
      now: at,
      historyEntry: {
        at: at.toISOString(),
        recoveryExecutionId,
        actor: operator.operatorActorId,
        phase: 'leased',
        code: 'LEASE_ACQUIRED',
        summary: 'Initial recovery lease acquired',
        digestPrefix: evidenceDigest.slice(0, 16),
        mode: 'initial'
      }
    });
    await maybeInjectRecoveryFault('recovery_lease');
  } else {
    job = await reclaimMultiUnitRecoveryLease({
      jobId: allowlist.finalizationJobId,
      checkoutId: allowlist.checkoutId,
      paymentIntentId: allowlist.paymentIntentId,
      recoveryExecutionId,
      evidenceDigest,
      expectedScope,
      now: at,
      resumedBy: operator.resumedBy || operator.operatorActorId,
      historyEntry: {
        at: at.toISOString(),
        recoveryExecutionId,
        actor: operator.operatorActorId,
        resumedBy: operator.resumedBy || operator.operatorActorId,
        phase: 'lease_reclaim',
        code: 'LEASE_RECLAIMED',
        summary: 'Recovery lease reclaimed',
        digestPrefix: evidenceDigest.slice(0, 16),
        mode: 'resume'
      }
    });
    await maybeInjectRecoveryFault('recovery_lease');
  }

  // Hold on incident MRI (or verify existing / completion path)
  let activeReviewId = job.activeRecoveryReviewItemId
    ? String(job.activeRecoveryReviewItemId)
    : String(allowlist.manualReviewItemId);

  const incidentReview = await ManualReviewItem.findById(
    allowlist.manualReviewItemId
  ).lean();

  if (incidentReview?.status === 'resolved' && mode === 'resume') {
    // Premature path — ensure completion MRI + transfer
    const { review: completion } = await ensureMultiUnitPaidOrphanCompletionReview({
      originalManualReviewItemId: allowlist.manualReviewItemId,
      recoveryExecutionId,
      finalizationJobId: allowlist.finalizationJobId,
      checkoutId: allowlist.checkoutId,
      checkoutSessionId: allowlist.checkoutSessionId,
      paymentId: allowlist.paymentId,
      paymentIntentId: allowlist.paymentIntentId,
      bookingId: job.bookingId || null,
      expectedScope
    });
    await maybeInjectRecoveryFault('completion_mri_create');
    await transferRecoveryHoldToCompletionReview({
      originalManualReviewItemId: allowlist.manualReviewItemId,
      completionManualReviewItemId: completion._id,
      recoveryExecutionId,
      finalizationJobId: allowlist.finalizationJobId,
      checkoutId: allowlist.checkoutId,
      paymentIntentId: allowlist.paymentIntentId,
      expectedScope,
      now: at
    });
    activeReviewId = String(completion._id);
  } else {
    try {
      await acquireManualReviewResolutionHold({
        manualReviewItemId: activeReviewId,
        recoveryExecutionId,
        finalizationJobId: allowlist.finalizationJobId,
        checkoutId: allowlist.checkoutId,
        paymentIntentId: allowlist.paymentIntentId,
        expectedScope,
        now: at
      });
      await maybeInjectRecoveryFault('original_mri_hold');
    } catch (err) {
      if (err?.code === 'RECOVERY_REVIEW_RESOLVED_PREMATURELY') {
        const { review: completion } = await ensureMultiUnitPaidOrphanCompletionReview({
          originalManualReviewItemId: allowlist.manualReviewItemId,
          recoveryExecutionId,
          finalizationJobId: allowlist.finalizationJobId,
          checkoutId: allowlist.checkoutId,
          checkoutSessionId: allowlist.checkoutSessionId,
          paymentId: allowlist.paymentId,
          paymentIntentId: allowlist.paymentIntentId,
          bookingId: job.bookingId || null,
          expectedScope
        });
        await maybeInjectRecoveryFault('completion_mri_create');
        await transferRecoveryHoldToCompletionReview({
          originalManualReviewItemId: allowlist.manualReviewItemId,
          completionManualReviewItemId: completion._id,
          recoveryExecutionId,
          finalizationJobId: allowlist.finalizationJobId,
          checkoutId: allowlist.checkoutId,
          paymentIntentId: allowlist.paymentIntentId,
          expectedScope,
          now: at
        });
        activeReviewId = String(completion._id);
      } else {
        throw err;
      }
    }

    if (!job.activeRecoveryReviewItemId) {
      await setActiveRecoveryReviewItemId({
        jobId: allowlist.finalizationJobId,
        recoveryExecutionId,
        expectedScope,
        targetManualReviewItemId: activeReviewId,
        expectedCurrentActiveReviewItemId: null,
        now: at,
        historyEntry: {
          at: at.toISOString(),
          recoveryExecutionId,
          actor: operator.operatorActorId,
          phase: 'active_review_update',
          code: 'ACTIVE_REVIEW_SET',
          summary: 'activeRecoveryReviewItemId set after initial MRI hold acquisition'
        }
      });
    }
  }

  await renewMultiUnitRecoveryLease({
    jobId: allowlist.finalizationJobId,
    recoveryExecutionId,
    expectedRecoveryStatus: job.recoveryStatus || 'leased',
    expectedScope,
    now: at
  });

  // Adopt or create Booking
  let booking = await findExistingRecoveryBooking(allowlist);
  if (booking) {
    if (String(booking.unitId) !== String(allowlist.expectedTargetUnitId)) {
      throw createSanitizedRecoveryError('RECOVERY_HOSTILE_STATE_DRIFT', {
        reason: 'booking_wrong_unit'
      });
    }
    if (
      booking.stripePaymentIntentId &&
      String(booking.stripePaymentIntentId) !== String(allowlist.paymentIntentId)
    ) {
      throw createSanitizedRecoveryError('RECOVERY_EXISTING_BOOKING_CONFLICT');
    }
    // Adopt path: repair missing shadow claims idempotently (no second create-path writer).
    try {
      const {
        ensureUnitNightClaimsShadow,
        I2_SOURCES
      } = require('../inventory/ensureUnitNightClaimsShadow');
      await ensureUnitNightClaimsShadow({
        booking,
        source: I2_SOURCES.MULTI_UNIT_RECOVERY,
        paymentIntentId: allowlist.paymentIntentId,
        checkoutId: allowlist.checkoutId,
        stripePaymentVerified: true
      });
    } catch {
      /* shadow must never fail recovery adopt */
    }
  } else {
    if (mode === 'resume' && INCOMPLETE_RECOVERY_STATUSES.includes(job.recoveryStatus) &&
        ['linkage_complete', 'awaiting_confirmation_queue', 'awaiting_review_resolution'].includes(job.recoveryStatus)) {
      throw createSanitizedRecoveryError('RECOVERY_HOSTILE_STATE_DRIFT', {
        reason: 'booking_missing_after_linkage'
      });
    }
    const orch = await runMultiUnitPaidOrphanRecoveryBookingFinalizeCore({
      checkoutId: allowlist.checkoutId,
      paymentIntentId: allowlist.paymentIntentId,
      expectedScope,
      expectedTargetUnitId: allowlist.expectedTargetUnitId,
      stripe,
      now: at
    });
    booking = orch.booking || (await Booking.findById(orch.bookingId).lean());
    await maybeInjectRecoveryFault('booking_creation');
  }

  await renewMultiUnitRecoveryLease({
    jobId: allowlist.finalizationJobId,
    recoveryExecutionId,
    expectedRecoveryStatus: (
      await CheckoutFinalizationJob.findById(allowlist.finalizationJobId).lean()
    )?.recoveryStatus || 'leased',
    expectedScope,
    now: new Date()
  });

  await ensurePaymentAndSessionLinked({
    booking,
    allowlist,
    expectedScope,
    now: new Date()
  });
  await maybeInjectRecoveryFault('payment_link');
  await maybeInjectRecoveryFault('session_finalization');

  job = await CheckoutFinalizationJob.findById(allowlist.finalizationJobId).lean();
  if (job.status !== 'succeeded') {
    job = await markCheckoutFinalizationJobSucceededFromMultiUnitRecovery({
      jobId: allowlist.finalizationJobId,
      bookingId: booking._id,
      recoveryExecutionId,
      expectedScope,
      now: new Date(),
      historyEntry: {
        at: new Date().toISOString(),
        recoveryExecutionId,
        actor: operator.operatorActorId,
        phase: 'linkage_complete',
        code: 'JOB_SUCCEEDED',
        summary: 'Normal finalization job marked succeeded from recovery',
        digestPrefix: evidenceDigest.slice(0, 16),
        bookingId: String(booking._id),
        mode
      }
    });
    await maybeInjectRecoveryFault('normal_job_success');
    await maybeInjectRecoveryFault('linkage_complete');
  } else if (job.recoveryStatus === 'leased') {
    job = await advanceMultiUnitRecoveryStatus({
      jobId: allowlist.finalizationJobId,
      recoveryExecutionId,
      fromStatus: 'leased',
      toStatus: 'linkage_complete',
      expectedScope,
      now: new Date()
    });
    await maybeInjectRecoveryFault('linkage_complete');
  }

  // SavedQuote convert (non-blocking toward money truth)
  try {
    const sessionDoc = await CheckoutSession.findById(allowlist.checkoutSessionId);
    await convertSavedQuoteForBooking({
      booking,
      session: sessionDoc
    });
  } catch {
    /* non-blocking */
  }
  await maybeInjectRecoveryFault('saved_quote_conversion');

  job = await CheckoutFinalizationJob.findById(allowlist.finalizationJobId).lean();
  if (job.recoveryStatus === 'linkage_complete') {
    job = await advanceMultiUnitRecoveryStatus({
      jobId: allowlist.finalizationJobId,
      recoveryExecutionId,
      fromStatus: 'linkage_complete',
      toStatus: 'awaiting_confirmation_queue',
      expectedScope,
      now: new Date(),
      historyEntry: {
        at: new Date().toISOString(),
        recoveryExecutionId,
        actor: operator.operatorActorId,
        phase: 'awaiting_confirmation_queue',
        code: 'PHASE_ADVANCE',
        summary: 'Advanced to awaiting_confirmation_queue',
        digestPrefix: evidenceDigest.slice(0, 16),
        bookingId: String(booking._id),
        mode
      }
    });
    await maybeInjectRecoveryFault('awaiting_confirmation_queue');
  }

  // Ensure-only EDS
  const sessionForEds = await CheckoutSession.findById(allowlist.checkoutSessionId).lean();
  const bookingDoc = await Booking.findById(booking._id);
  await ensureConfirmationEds({
    booking: bookingDoc,
    session: sessionForEds,
    now: new Date()
  });
  await maybeInjectRecoveryFault('eds_ensure');

  const correlationKey = await buildCorrelationKeyForBooking(bookingDoc, sessionForEds);
  const queued = await markCheckoutFinalizationJobConfirmationQueued({
    finalizationJobId: allowlist.finalizationJobId,
    bookingId: booking._id,
    recoveryExecutionId,
    expectedCorrelationKey: correlationKey,
    queuedAt: new Date(),
    expectedScope: { ...expectedScope, bookingId: String(booking._id) },
    now: new Date(),
    historyEntry: {
      at: new Date().toISOString(),
      recoveryExecutionId,
      actor: operator.operatorActorId,
      phase: 'awaiting_review_resolution',
      code: 'CONFIRMATION_QUEUED',
      summary: 'confirmationQueuedAt phase transition',
      digestPrefix: evidenceDigest.slice(0, 16),
      bookingId: String(booking._id),
      mode
    }
  });
  await maybeInjectRecoveryFault('confirmation_queued_at');

  job = queued.job || (await CheckoutFinalizationJob.findById(allowlist.finalizationJobId).lean());
  activeReviewId = String(job.activeRecoveryReviewItemId || activeReviewId);

  async function buildCompleteResult(completedJob) {
    return {
      ok: true,
      mode,
      recoveryExecutionId,
      recoveryStatus: 'complete',
      bookingId: String(booking._id),
      finalizationJobId: String(allowlist.finalizationJobId),
      activeRecoveryReviewItemId: activeReviewId,
      confirmationQueuedAt:
        completedJob?.confirmationQueuedAt || job.confirmationQueuedAt || null,
      paymentLinked: true,
      sessionFinalized: true,
      refundAttempted: false,
      chargeAttempted: false,
      smtpAttempted: false
    };
  }

  // Peer finisher may have already completed while we were in-flight.
  if (job.recoveryStatus === 'complete') {
    return buildCompleteResult(job);
  }

  // Final gate + resolve
  let gate;
  try {
    gate = await verifyCompletionGate({
      allowlist,
      booking: await Booking.findById(booking._id).lean(),
      job,
      expectedScope
    });
  } catch (err) {
    const latestJob = await CheckoutFinalizationJob.findById(allowlist.finalizationJobId).lean();
    if (
      latestJob &&
      String(latestJob.recoveryStatus || '') === 'complete' &&
      String(latestJob.recoveryExecutionId || '') === String(recoveryExecutionId)
    ) {
      return buildCompleteResult(latestJob);
    }

    if (err?.code === 'RECOVERY_REVIEW_RESOLVED_PREMATURELY') {
      const activeReview = await ManualReviewItem.findById(activeReviewId).lean();
      const resolvedByRecovery =
        activeReview?.status === 'resolved' &&
        String(activeReview.resolution?.resolvedBy || '').includes(
          'multi_unit_paid_orphan_recovery'
        ) &&
        activeReview.resolutionHold?.recoveryExecutionId === String(recoveryExecutionId);

      if (resolvedByRecovery) {
        // Peer finisher already resolved the held review — finish or adopt complete.
        job = latestJob || job;
      } else {
        const { review: completion } = await ensureMultiUnitPaidOrphanCompletionReview({
          originalManualReviewItemId: allowlist.manualReviewItemId,
          recoveryExecutionId,
          finalizationJobId: allowlist.finalizationJobId,
          checkoutId: allowlist.checkoutId,
          checkoutSessionId: allowlist.checkoutSessionId,
          paymentId: allowlist.paymentId,
          paymentIntentId: allowlist.paymentIntentId,
          bookingId: booking._id,
          expectedScope
        });
        await maybeInjectRecoveryFault('completion_mri_create');
        await transferRecoveryHoldToCompletionReview({
          originalManualReviewItemId: allowlist.manualReviewItemId,
          completionManualReviewItemId: completion._id,
          recoveryExecutionId,
          finalizationJobId: allowlist.finalizationJobId,
          checkoutId: allowlist.checkoutId,
          paymentIntentId: allowlist.paymentIntentId,
          expectedScope,
          now: new Date()
        });
        activeReviewId = String(completion._id);
        job = await CheckoutFinalizationJob.findById(allowlist.finalizationJobId).lean();
        gate = await verifyCompletionGate({
          allowlist,
          booking: await Booking.findById(booking._id).lean(),
          job,
          expectedScope
        });
      }
    } else {
      throw err;
    }
  }

  const activeBeforeResolve = await ManualReviewItem.findById(activeReviewId).lean();
  if (
    !(
      activeBeforeResolve?.status === 'resolved' &&
      String(activeBeforeResolve.resolution?.resolvedBy || '').includes(
        'multi_unit_paid_orphan_recovery'
      )
    )
  ) {
    await resolveActiveRecoveryHeldManualReview({
      manualReviewItemId: activeReviewId,
      recoveryExecutionId,
      checkoutId: allowlist.checkoutId,
      paymentIntentId: allowlist.paymentIntentId,
      finalizationJobId: allowlist.finalizationJobId,
      resolvedBy: 'multi_unit_paid_orphan_recovery',
      note: 'Resolved after verified multi-unit paid-orphan recovery completion gate',
      bookingId: booking._id,
      expectedScope: { ...expectedScope, bookingId: String(booking._id) },
      now: new Date()
    });
  }
  await maybeInjectRecoveryFault('recovery_mri_resolution');
  await maybeInjectRecoveryFault('recovery_complete_before_release');

  const completed = await markMultiUnitRecoveryComplete({
    jobId: allowlist.finalizationJobId,
    recoveryExecutionId,
    expectedScope,
    recoveredBy: operator.operatorActorId,
    now: new Date(),
    historyEntry: {
      at: new Date().toISOString(),
      recoveryExecutionId,
      actor: operator.operatorActorId,
      phase: 'complete',
      code: 'RECOVERY_COMPLETE',
      summary: 'Recovery completed',
      digestPrefix: evidenceDigest.slice(0, 16),
      bookingId: String(booking._id),
      mode
    }
  });

  return buildCompleteResult(completed);
}

/**
 * Public entry: dry-run or execute (initial|resume).
 */
async function recoverAllowlistedMultiUnitPaidOrphanCheckout({
  mode = 'dry-run',
  allowlist,
  originalEvidence = null,
  digest = null,
  intentOverlay = null,
  execute = false,
  stripe = null,
  now = new Date()
} = {}) {
  const row = requireAllowlist(allowlist);
  const at = now instanceof Date ? now : new Date(now);

  if (mode === 'dry-run' || (!execute && mode !== 'resume' && mode !== 'initial')) {
    return dryRunMultiUnitPaidOrphanRecovery({ allowlist: row, now: at });
  }

  if (mode !== 'initial' && mode !== 'resume') {
    throw createSanitizedRecoveryError('RECOVERY_RESUME_PHASE_MISMATCH', {
      reason: 'invalid_mode'
    });
  }

  if (!featureFlags.isMultiUnitPaidOrphanRecoveryEnabled()) {
    throw createSanitizedRecoveryError('RECOVERY_FLAG_DISABLED');
  }

  const operator = verifyIntentOverlay(intentOverlay);
  const { canonicalEvidence, digest: verifiedDigest } = verifyOriginalEvidence({
    originalEvidence,
    digest
  });

  const docs = await loadIncidentDocuments(row);
  const liveEvidence = await buildCanonicalEvidence(row, docs, at);

  if (mode === 'initial') {
    verifyDigestAge(canonicalEvidence, at);

    const cmp = compareMaterialEvidence(canonicalEvidence, liveEvidence);
    if (!cmp.ok) {
      throw createSanitizedRecoveryError('RECOVERY_HOSTILE_STATE_DRIFT', {
        reason: 'initial_live_mismatch',
        mismatchedFields: cmp.mismatchedFields
      });
    }

    if (!liveEvidence.guestIdentityMatch) {
      throw createSanitizedRecoveryError('RECOVERY_GUEST_IDENTITY_MISMATCH');
    }
    if (liveEvidence.stayFingerprintMatch === false) {
      throw createSanitizedRecoveryError('RECOVERY_FINGERPRINT_MISMATCH');
    }
    if (!liveEvidence.targetUnitAvailabilityResult?.ok) {
      throw createSanitizedRecoveryError('RECOVERY_TARGET_UNIT_UNAVAILABLE');
    }
    if (liveEvidence.payment.status !== 'paid' || liveEvidence.payment.reservationId) {
      throw createSanitizedRecoveryError('RECOVERY_HOSTILE_STATE_DRIFT', {
        reason: 'payment_state'
      });
    }
    if (await findExistingRecoveryBooking(row)) {
      throw createSanitizedRecoveryError('RECOVERY_EXISTING_BOOKING_CONFLICT');
    }
    if (
      docs.job.recoveryStatus &&
      docs.job.recoveryStatus !== 'idle' &&
      docs.job.recoveryStatus !== 'failed'
    ) {
      throw createSanitizedRecoveryError('RECOVERY_RESUME_PHASE_MISMATCH', {
        reason: 'use_resume_mode'
      });
    }
  } else {
    // resume — keep using original approved date evidence; abort on hostile live date drift
    const dateDriftFields = [];
    for (const path of ['expectedCheckInDateOnly', 'expectedCheckOutDateOnly']) {
      if (
        materialEvidenceFieldMismatches(
          getNestedEvidenceValue(canonicalEvidence, path),
          getNestedEvidenceValue(liveEvidence, path)
        )
      ) {
        dateDriftFields.push(path);
      }
    }
    if (dateDriftFields.length > 0) {
      throw createSanitizedRecoveryError('RECOVERY_HOSTILE_STATE_DRIFT', {
        reason: 'resume_date_drift',
        mismatchedFields: dateDriftFields
      });
    }

    if (docs.job.recoveryStatus === 'complete') {
      return {
        ok: true,
        mode: 'resume',
        code: 'RECOVERY_ALREADY_COMPLETE',
        recoveryExecutionId: docs.job.recoveryExecutionId,
        recoveryStatus: 'complete',
        bookingId: docs.job.bookingId ? String(docs.job.bookingId) : null
      };
    }
    if (!INCOMPLETE_RECOVERY_STATUSES.includes(docs.job.recoveryStatus)) {
      throw createSanitizedRecoveryError('RECOVERY_RESUME_PHASE_MISMATCH');
    }
    if (
      String(docs.job.recoveryEvidenceDigest || '').toLowerCase() !==
      verifiedDigest
    ) {
      throw createSanitizedRecoveryError('RECOVERY_DIGEST_MISMATCH', {
        reason: 'stored_digest'
      });
    }
    if (String(docs.job.recoveryAllowlistHash || '') !== hashAllowlistIdentity(row)) {
      throw createSanitizedRecoveryError('RECOVERY_ALLOWLIST_MISMATCH', {
        reason: 'stored_allowlist_hash'
      });
    }
  }

  const recoveryExecutionId =
    mode === 'resume'
      ? String(docs.job.recoveryExecutionId)
      : crypto.randomUUID();

  const expectedScope = buildExpectedScope({
    recoveryMode: mode,
    recoveryExecutionId,
    allowlist: row,
    evidenceDigest: verifiedDigest
  });

  return runInMultiUnitPaidOrphanRecoveryContext(expectedScope, async () =>
    executeRecoveryInsideContext({
      mode,
      allowlist: row,
      expectedScope,
      recoveryExecutionId,
      evidenceDigest: verifiedDigest,
      allowlistHash: hashAllowlistIdentity(row),
      operator,
      stripe,
      now: at
    })
  );
}

module.exports = {
  SCHEMA_VERSION,
  MAX_DIGEST_AGE_MS,
  INTENT_PHRASE,
  RECOVERY_LEASE_TTL_MS,
  recoverAllowlistedMultiUnitPaidOrphanCheckout,
  dryRunMultiUnitPaidOrphanRecovery,
  runMultiUnitPaidOrphanRecoveryBookingFinalizeCore,
  __setRecoveryFaultInjectorForTesting,
  __resetRecoveryFaultInjectorForTesting,
  /** Test seam: production default uses STRIPE_SECRET_KEY + stripe package. */
  __getStripeClientForTesting: getStripeClient,
  sha256Hex,
  stableStringify,
  hashAllowlistIdentity,
  MultiUnitPaidOrphanRecoveryError
};
