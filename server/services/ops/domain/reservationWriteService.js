const Booking = require('../../../models/Booking');
const Cabin = require('../../../models/Cabin');
const Guest = require('../../../models/Guest');
const ReservationNote = require('../../../models/ReservationNote');
const AvailabilityBlock = require('../../../models/AvailabilityBlock');
const mongoose = require('mongoose');
const { requirePermission, ACTIONS } = require('../../permissionService');
const { appendAuditEvent } = require('../../auditWriter');
const { buildIdempotencyKey, getRememberedResult, rememberResult } = require('../../idempotencyService');
const { normalizeExclusiveDateRange, formatSofiaDateOnly } = require('../../../utils/dateTime');
const { evaluateCabinConflicts, evaluateTargetConflicts } = require('./conflictService');
const { createDomainError } = require('./errors');
const { isFixtureCabinName } = require('../../../utils/fixtureExclusion');
const {
  countBlockingBlocksForSingleCabin,
  findParentCabinForCabinType
} = require('../../publicAvailabilityService');
const { BLOCKING_BOOKING_STATUSES } = require('../../calendar/blockingStatusConstants');
const { canUseMongoTransactions } = require('../../../utils/mongoTransactions');
const { openManualReviewItem } = require('../ingestion/manualReviewService');
const { syncUnitNightClaimsShadow } = require('../../inventory/syncUnitNightClaimsShadow');
const {
  ensureUnitNightClaimsReleasedShadow,
  LIFECYCLE_SOURCES
} = require('../../inventory/ensureUnitNightClaimsReleasedShadow');
const {
  claimUnitNights,
  compensateClaimAttempt,
  releaseUnitNights,
  ERR: CLAIM_ERR
} = require('../../inventory/unitNightClaimService');
const { expandOccupiedSofiaNightDateOnlys } = require('../reporting/stayNights');
const { processMetaPurchaseAfterConfirm } = require('../../bookingPurchaseTracking');
const CabinType = require('../../../models/CabinType');
const bookingLifecycleEmailService = require('../../bookingLifecycleEmailService');
const { sendCancellationStayCreditEmail } = require('../../cancellationStayCreditEmailService');
const {
  issueCancellationCompensationVoucher,
  MIN_CREDIT_AMOUNT_CENTS
} = require('../../giftVouchers/issueCancellationCompensationVoucherService');
const {
  shouldSendAutomaticGuestConfirmation,
  normalizeManualReservationPurpose,
  resolveSendGuestConfirmationEmailAtIntake
} = require('../manualReservationEmailPolicy');

// MessageOrchestrator hooks (Batch 7). Lazy-required inside try/catch wrappers
// so import failure cannot break any write path. Default OFF
// (MESSAGE_ORCHESTRATOR_ENABLED=1 to enable).
function notifyMessageOrchestratorSafely(method, args) {
  try {
    const orchestrator = require('../../messaging/messageOrchestrator');
    if (typeof orchestrator?.[method] !== 'function') return;
    Promise.resolve()
      .then(() => orchestrator[method](args))
      .catch((err) => {
        console.error(
          JSON.stringify({
            source: 'message-orchestrator',
            phase: `${method}_async_error`,
            error: err?.message || String(err)
          })
        );
      });
  } catch (err) {
    console.error(
      JSON.stringify({
        source: 'message-orchestrator',
        phase: `${method}_require_error`,
        error: err?.message || String(err)
      })
    );
  }
}

function scheduleOpsPushSafely(method, args) {
  try {
    const orchestrator = require('../push/opsPushScheduleOrchestrator');
    if (typeof orchestrator?.[method] !== 'function') return;
    Promise.resolve()
      .then(() => orchestrator[method](args))
      .catch((err) => {
        console.error(
          JSON.stringify({
            source: 'ops-push-scheduler',
            phase: `${method}_async_error`,
            error: err?.message || String(err)
          })
        );
      });
  } catch (err) {
    console.error(
      JSON.stringify({
        source: 'ops-push-scheduler',
        phase: `${method}_require_error`,
        error: err?.message || String(err)
      })
    );
  }
}

const ALLOWED_TRANSITIONS = {
  confirm: { from: ['pending'], to: 'confirmed', action: ACTIONS.OPS_RESERVATION_CONFIRM },
  checkIn: { from: ['confirmed'], to: 'in_house', action: ACTIONS.OPS_RESERVATION_CHECK_IN },
  complete: { from: ['in_house'], to: 'completed', action: ACTIONS.OPS_RESERVATION_COMPLETE },
  cancel: { from: ['pending', 'confirmed', 'in_house'], to: 'cancelled', action: ACTIONS.OPS_RESERVATION_CANCEL }
};

function buildActor(ctx) {
  return {
    actorId: ctx.user?.id || 'admin',
    actorType: 'user',
    role: ctx.user?.role || 'admin'
  };
}

function getIdempotencyFromContext(ctx, action, bookingId) {
  const requestId = ctx.idempotencyKey || ctx.req?.headers?.['x-idempotency-key'] || null;
  return buildIdempotencyKey({
    action,
    actorId: ctx.user?.id || 'admin',
    entityId: bookingId,
    requestId
  });
}

async function loadBookingOrFail(bookingId) {
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw createDomainError('validation', 'Reservation not found', { bookingId }, 404);
  }
  return booking;
}

async function sendLifecycleStatusEmail({ booking, kind }) {
  if (!booking?.guestInfo?.email) {
    return { success: false, method: 'invalid', error: 'Guest email is missing for lifecycle email' };
  }

  const templateKey =
    kind === 'confirm'
      ? bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CONFIRMED
      : bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CANCELLED;

  if (
    kind === 'confirm' &&
    templateKey === bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CONFIRMED &&
    !shouldSendAutomaticGuestConfirmation(booking)
  ) {
    return { success: true, method: 'skipped-policy', skipped: true };
  }

  try {
    return await bookingLifecycleEmailService.sendBookingLifecycleEmail({
      booking,
      templateKey,
      overrideRecipient: null,
      lifecycleSource: 'automatic',
      actorContext: null
    });
  } catch (err) {
    return { success: false, method: 'error', error: err.message || String(err) };
  }
}

async function sendStayCreditEmailSafely({ booking, compensationVoucher, creditAmountCents, phase }) {
  if (!compensationVoucher?.code) return;
  try {
    const result = await sendCancellationStayCreditEmail({
      booking,
      compensationVoucher,
      creditAmountCents
    });
    if (!result?.success) {
      console.error('[reservation-email] Stay credit email failed:', {
        bookingId: String(booking._id),
        phase,
        method: result?.method,
        error: result?.error
      });
    }
  } catch (err) {
    console.error('[reservation-email] Stay credit email error:', {
      bookingId: String(booking._id),
      phase,
      error: err?.message || String(err)
    });
  }
}

const CANCEL_ALLOWED_OUTCOMES = new Set([
  'resolution_pending',
  'payment_retained',
  'credits_issued',
  'cash_refund_pending',
  'cash_refunded'
]);

const CANCEL_REJECTED_OUTCOMES = new Set(['unresolved', 'rebooked_or_moved']);

const RESOLVE_SETTLEMENT_IDEMPOTENCY_ACTION = 'ops.reservation.resolve_cancellation_settlement';

const RESOLVE_ALLOWED_TARGET_OUTCOMES = new Set([
  'payment_retained',
  'credits_issued',
  'cash_refund_pending',
  'cash_refunded'
]);

const RESOLVE_REJECTED_TARGET_OUTCOMES = new Set(['resolution_pending', 'unresolved', 'rebooked_or_moved']);

const RESOLVE_FINALIZED_SOURCE_OUTCOMES = new Set(['payment_retained', 'credits_issued', 'cash_refunded']);

const RESOLVE_UNSUPPORTED_SOURCE_OUTCOMES = new Set(['unresolved', 'rebooked_or_moved']);

const CASH_REFUND_METHODS = new Set(['bank_transfer', 'stripe_manual', 'cash', 'other']);

function buildCancelFinancialSnapshot(booking, recordedAt) {
  return {
    bookingTotalCents: Number.isFinite(booking?.totalPrice) ? Number(booking.totalPrice) : null,
    stripePaidAmountCents: Number.isFinite(booking?.stripePaidAmountCents)
      ? Number(booking.stripePaidAmountCents)
      : null,
    voucherAppliedCents: Number.isFinite(booking?.giftVoucherAppliedCents)
      ? Number(booking.giftVoucherAppliedCents)
      : null,
    netCashPaidCents: Number.isFinite(booking?.stripePaidAmountCents)
      ? Number(booking.stripePaidAmountCents)
      : null,
    currency: 'EUR',
    capturedAt: recordedAt
  };
}

function normalizeTrimmedReason(reason) {
  if (reason == null) return null;
  const value = String(reason).trim();
  return value || null;
}

function deriveCancelRecipientEmail(settlement, booking) {
  if (settlement && typeof settlement === 'object' && settlement.recipientEmail != null) {
    const fromSettlement = String(settlement.recipientEmail).trim().toLowerCase();
    if (fromSettlement) return fromSettlement;
  }
  const fromGuest = booking?.guestInfo?.email ? String(booking.guestInfo.email).trim().toLowerCase() : '';
  return fromGuest || null;
}

function deriveCancelRecipientName(settlement, booking) {
  if (settlement && typeof settlement === 'object' && settlement.recipientName != null) {
    const fromSettlement = String(settlement.recipientName).trim();
    if (fromSettlement) return fromSettlement;
  }
  const first = booking?.guestInfo?.firstName ? String(booking.guestInfo.firstName).trim() : '';
  const last = booking?.guestInfo?.lastName ? String(booking.guestInfo.lastName).trim() : '';
  const combined = [first, last].filter(Boolean).join(' ');
  return combined || null;
}

function mapIssuerError(err) {
  if (err?.code === 'CREDIT_AMOUNT_MISMATCH') {
    throw createDomainError(
      'conflict',
      err.message,
      {
        code: err.code,
        existingAmountCents: err.existingAmountCents,
        requestedCreditAmountCents: err.requestedCreditAmountCents
      },
      409
    );
  }
  const validationCodes = new Set([
    'RESERVATION_ID_REQUIRED',
    'INVALID_RESERVATION_ID',
    'INVALID_CREDIT_AMOUNT',
    'CREDIT_AMOUNT_TOO_LOW',
    'ACTOR_REQUIRED',
    'REASON_REQUIRED',
    'REASON_TOO_LONG',
    'INVALID_EXPIRES_AT'
  ]);
  if (validationCodes.has(err?.code)) {
    throw createDomainError('validation', err.message, { code: err.code }, 400);
  }
  throw err;
}

function deriveSourceSettlementOutcome(cancellationSettlement) {
  if (!cancellationSettlement || typeof cancellationSettlement !== 'object') {
    return '';
  }
  return typeof cancellationSettlement.outcome === 'string'
    ? cancellationSettlement.outcome.trim()
    : '';
}

function assertResolveTargetAllowedForSource(sourceOutcome, targetOutcome) {
  if (sourceOutcome === 'cash_refund_pending' && targetOutcome !== 'cash_refunded') {
    throw createDomainError(
      'validation',
      'cash_refund_pending can only be resolved to cash_refunded',
      { currentOutcome: sourceOutcome, providedOutcome: targetOutcome },
      400
    );
  }
}

function assertResolveEligibleSourceSettlement(cancellationSettlement) {
  if (!cancellationSettlement || typeof cancellationSettlement !== 'object') {
    return;
  }
  const outcome =
    typeof cancellationSettlement.outcome === 'string'
      ? cancellationSettlement.outcome.trim()
      : '';
  if (!outcome || outcome === 'resolution_pending' || outcome === 'cash_refund_pending') {
    return;
  }
  if (RESOLVE_FINALIZED_SOURCE_OUTCOMES.has(outcome)) {
    throw createDomainError(
      'invalid_transition',
      'Cancellation settlement is already finalized',
      { currentOutcome: outcome },
      409
    );
  }
  if (RESOLVE_UNSUPPORTED_SOURCE_OUTCOMES.has(outcome)) {
    throw createDomainError(
      'validation',
      `Cannot resolve cancellation settlement from outcome "${outcome}"`,
      { currentOutcome: outcome },
      400
    );
  }
  throw createDomainError(
    'validation',
    `Cannot resolve cancellation settlement from outcome "${outcome}"`,
    { currentOutcome: outcome },
    400
  );
}

function requireResolveReason(reason) {
  const normalizedReason = normalizeTrimmedReason(reason);
  if (!normalizedReason) {
    throw createDomainError('validation', 'reason is required', {}, 400);
  }
  if (normalizedReason.length > 500) {
    throw createDomainError(
      'validation',
      'reason must be at most 500 characters',
      {},
      400
    );
  }
  return normalizedReason;
}

function parseResolveTargetOutcome(settlement) {
  if (!settlement || typeof settlement !== 'object') {
    throw createDomainError('validation', 'settlement is required', {}, 400);
  }
  const outcomeRaw = settlement.outcome;
  const targetOutcome = typeof outcomeRaw === 'string' ? outcomeRaw.trim() : '';
  if (!targetOutcome) {
    throw createDomainError('validation', 'settlement.outcome is required', {}, 400);
  }
  if (RESOLVE_REJECTED_TARGET_OUTCOMES.has(targetOutcome)) {
    throw createDomainError(
      'validation',
      `Settlement outcome "${targetOutcome}" is not supported on resolve`,
      { providedOutcome: targetOutcome },
      400
    );
  }
  if (!RESOLVE_ALLOWED_TARGET_OUTCOMES.has(targetOutcome)) {
    throw createDomainError(
      'validation',
      'Resolve supports settlement outcomes: payment_retained, credits_issued, cash_refund_pending, or cash_refunded',
      { allowedOutcomes: [...RESOLVE_ALLOWED_TARGET_OUTCOMES], providedOutcome: targetOutcome },
      400
    );
  }
  return targetOutcome;
}

function bookingHasRecordedCashPayment(booking) {
  return Number.isFinite(booking?.stripePaidAmountCents) && Number(booking.stripePaidAmountCents) > 0;
}

function extractCashRefundAmountRaw(settlement) {
  if (!settlement || typeof settlement !== 'object') return null;
  if (settlement.cashRefundAmountCents != null) return settlement.cashRefundAmountCents;
  if (settlement.cashRefund && typeof settlement.cashRefund === 'object') {
    return settlement.cashRefund.amountCents ?? null;
  }
  return null;
}

function extractCashRefundEvidenceInput(settlement) {
  if (!settlement || typeof settlement !== 'object') return {};
  if (settlement.cashRefundEvidence && typeof settlement.cashRefundEvidence === 'object') {
    return settlement.cashRefundEvidence;
  }
  if (settlement.cashRefund && typeof settlement.cashRefund === 'object') {
    return settlement.cashRefund;
  }
  return {};
}

function parseCashRefundAmountCents(settlement, booking, { required, outcome }) {
  const raw = extractCashRefundAmountRaw(settlement);
  if (raw == null) {
    if (required) {
      throw createDomainError(
        'validation',
        `settlement.cashRefundAmountCents is required for ${outcome} when a cash payment exists on the booking`,
        { outcome },
        400
      );
    }
    return null;
  }
  if (!Number.isInteger(raw) || raw <= 0) {
    throw createDomainError(
      'validation',
      'settlement.cashRefundAmountCents must be a positive integer',
      { cashRefundAmountCents: raw },
      400
    );
  }
  return raw;
}

function parseCashRefundNote(settlement) {
  if (!settlement || typeof settlement !== 'object') return null;
  const fromTop = settlement.cashRefundNote != null ? String(settlement.cashRefundNote).trim() : '';
  if (fromTop) return fromTop;
  const evidence = extractCashRefundEvidenceInput(settlement);
  const fromEvidence = evidence.note != null ? String(evidence.note).trim() : '';
  if (fromEvidence) return fromEvidence;
  const fromCashRefund =
    settlement.cashRefund && settlement.cashRefund.note != null
      ? String(settlement.cashRefund.note).trim()
      : '';
  return fromCashRefund || null;
}

function parseCashRefundRecordedAt(value, { defaultNow = false } = {}) {
  if (value == null || value === '') {
    if (defaultNow) return new Date();
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw createDomainError(
      'validation',
      'cashRefundEvidence.recordedAt must be a valid date',
      { recordedAt: value },
      400
    );
  }
  return date;
}

function buildCashRefundPendingCancellationSettlement({
  settlement,
  reason,
  actorId,
  recordedAt,
  booking,
  missingReasonMessage
}) {
  const normalizedReason = normalizeTrimmedReason(reason);
  if (!normalizedReason) {
    throw createDomainError('validation', missingReasonMessage, { outcome: 'cash_refund_pending' }, 400);
  }

  const cashRefundAmountCents = parseCashRefundAmountCents(settlement, booking, {
    required: bookingHasRecordedCashPayment(booking),
    outcome: 'cash_refund_pending'
  });
  const cashRefundNote = parseCashRefundNote(settlement);

  return {
    cancellationSettlement: {
      outcome: 'cash_refund_pending',
      reason: normalizedReason,
      settlementRecordedAt: recordedAt,
      settlementRecordedByActorId: actorId,
      cashRefundAmountCents,
      cashRefundNote,
      financialSnapshot: buildCancelFinancialSnapshot(booking, recordedAt)
    },
    compensationVoucher: null
  };
}

function buildCashRefundedCancellationSettlement({
  settlement,
  reason,
  actorId,
  recordedAt,
  booking,
  missingReasonMessage
}) {
  const normalizedReason = normalizeTrimmedReason(reason);
  if (!normalizedReason) {
    throw createDomainError('validation', missingReasonMessage, { outcome: 'cash_refunded' }, 400);
  }

  const evidenceInput = extractCashRefundEvidenceInput(settlement);
  const amountRaw =
    evidenceInput.amountCents != null ? evidenceInput.amountCents : extractCashRefundAmountRaw(settlement);
  if (!Number.isInteger(amountRaw) || amountRaw <= 0) {
    throw createDomainError(
      'validation',
      'cashRefundEvidence.amountCents is required and must be a positive integer for cash_refunded',
      { amountCents: amountRaw ?? null },
      400
    );
  }

  const methodRaw = evidenceInput.method != null ? String(evidenceInput.method).trim() : '';
  if (!methodRaw || !CASH_REFUND_METHODS.has(methodRaw)) {
    throw createDomainError(
      'validation',
      'cashRefundEvidence.method is required for cash_refunded (bank_transfer, stripe_manual, cash, other)',
      { method: methodRaw || null },
      400
    );
  }

  const evidenceNote = evidenceInput.note != null ? String(evidenceInput.note).trim() : '';
  if (!evidenceNote) {
    throw createDomainError(
      'validation',
      'cashRefundEvidence.note is required for cash_refunded',
      { outcome: 'cash_refunded' },
      400
    );
  }

  const reference =
    evidenceInput.reference != null && String(evidenceInput.reference).trim()
      ? String(evidenceInput.reference).trim()
      : evidenceInput.stripeRefundId != null && String(evidenceInput.stripeRefundId).trim()
        ? String(evidenceInput.stripeRefundId).trim()
        : null;

  const cashRefundEvidence = {
    amountCents: amountRaw,
    method: methodRaw,
    reference,
    recordedAt: parseCashRefundRecordedAt(evidenceInput.recordedAt ?? evidenceInput.refundedAt, {
      defaultNow: true
    }),
    recordedByActorId: actorId,
    note: evidenceNote
  };

  if (evidenceInput.stripeRefundId != null && String(evidenceInput.stripeRefundId).trim()) {
    cashRefundEvidence.stripeRefundId = String(evidenceInput.stripeRefundId).trim();
  }
  if (evidenceInput.stripeChargeId != null && String(evidenceInput.stripeChargeId).trim()) {
    cashRefundEvidence.stripeChargeId = String(evidenceInput.stripeChargeId).trim();
  }
  if (evidenceInput.stripePaymentIntentId != null && String(evidenceInput.stripePaymentIntentId).trim()) {
    cashRefundEvidence.stripePaymentIntentId = String(evidenceInput.stripePaymentIntentId).trim();
  }

  return {
    cancellationSettlement: {
      outcome: 'cash_refunded',
      reason: normalizedReason,
      settlementRecordedAt: recordedAt,
      settlementRecordedByActorId: actorId,
      cashRefundAmountCents: amountRaw,
      cashRefundNote: evidenceNote,
      cashRefundEvidence,
      financialSnapshot: buildCancelFinancialSnapshot(booking, recordedAt)
    },
    compensationVoucher: null
  };
}

async function buildCreditsIssuedCancellationSettlement({
  settlement,
  reason,
  actorId,
  recordedAt,
  booking,
  ctx,
  missingReasonMessage
}) {
  const normalizedReason = normalizeTrimmedReason(reason);
  if (!normalizedReason) {
    throw createDomainError(
      'validation',
      missingReasonMessage,
      { outcome: 'credits_issued' },
      400
    );
  }

  const creditRaw = settlement?.creditAmountCents;
  if (!Number.isInteger(creditRaw)) {
    throw createDomainError(
      'validation',
      'settlement.creditAmountCents is required and must be an integer for credits_issued',
      { creditAmountCents: creditRaw ?? null },
      400
    );
  }
  if (creditRaw < MIN_CREDIT_AMOUNT_CENTS) {
    throw createDomainError(
      'validation',
      `settlement.creditAmountCents must be at least ${MIN_CREDIT_AMOUNT_CENTS}`,
      { creditAmountCents: creditRaw, minimumCreditAmountCents: MIN_CREDIT_AMOUNT_CENTS },
      400
    );
  }

  const recipientEmail = deriveCancelRecipientEmail(settlement, booking);
  if (!recipientEmail) {
    throw createDomainError(
      'validation',
      'recipientEmail is required for credits_issued (provide settlement.recipientEmail or booking guest email)',
      { outcome: 'credits_issued' },
      400
    );
  }

  const idempotencyKey = ctx?.idempotencyKey || ctx?.req?.headers?.['x-idempotency-key'] || null;

  let voucherResult;
  try {
    voucherResult = await issueCancellationCompensationVoucher({
      reservationId: booking._id,
      creditAmountCents: creditRaw,
      recipientEmail,
      recipientName: deriveCancelRecipientName(settlement, booking),
      actor: actorId,
      reason: normalizedReason,
      idempotencyKey
    });
  } catch (err) {
    mapIssuerError(err);
  }

  const financialSnapshot = buildCancelFinancialSnapshot(booking, recordedAt);
  const cancellationSettlement = {
    outcome: 'credits_issued',
    reason: normalizedReason,
    settlementRecordedAt: recordedAt,
    settlementRecordedByActorId: actorId,
    creditAmountCents: creditRaw,
    compensationGiftVoucherId: voucherResult.giftVoucherId,
    financialSnapshot
  };

  return {
    cancellationSettlement,
    compensationVoucher: {
      giftVoucherId: voucherResult.giftVoucherId,
      code: voucherResult.code,
      idempotentReplay: voucherResult.idempotentReplay,
      issuanceSource: voucherResult.issuanceSource,
      sourceReservationId: voucherResult.sourceReservationId
    }
  };
}

async function normalizeCancelSettlement({ settlement, reason, actorId, recordedAt, booking, ctx }) {
  const outcomeRaw = settlement && typeof settlement === 'object' ? settlement.outcome : null;
  const outcome = typeof outcomeRaw === 'string' ? outcomeRaw.trim() : '';
  const effectiveOutcome = outcome || 'resolution_pending';

  if (CANCEL_REJECTED_OUTCOMES.has(effectiveOutcome)) {
    throw createDomainError(
      'validation',
      `Cancel settlement outcome "${effectiveOutcome}" is not supported on cancel`,
      { providedOutcome: effectiveOutcome },
      400
    );
  }

  if (!CANCEL_ALLOWED_OUTCOMES.has(effectiveOutcome)) {
    throw createDomainError(
      'validation',
      'Cancel supports settlement outcomes: resolution_pending, payment_retained, credits_issued, cash_refund_pending, or cash_refunded',
      { allowedOutcomes: [...CANCEL_ALLOWED_OUTCOMES], providedOutcome: outcome || null },
      400
    );
  }

  if (effectiveOutcome === 'credits_issued') {
    return buildCreditsIssuedCancellationSettlement({
      settlement,
      reason,
      actorId,
      recordedAt,
      booking,
      ctx,
      missingReasonMessage: 'reason is required when issuing stay credit on cancel'
    });
  }

  if (effectiveOutcome === 'cash_refund_pending') {
    return buildCashRefundPendingCancellationSettlement({
      settlement,
      reason,
      actorId,
      recordedAt,
      booking,
      missingReasonMessage: 'reason is required when recording cash refund pending on cancel'
    });
  }

  if (effectiveOutcome === 'cash_refunded') {
    return buildCashRefundedCancellationSettlement({
      settlement,
      reason,
      actorId,
      recordedAt,
      booking,
      missingReasonMessage: 'reason is required when recording cash refunded on cancel'
    });
  }

  const normalizedReason = normalizeTrimmedReason(reason);
  const financialSnapshot = buildCancelFinancialSnapshot(booking, recordedAt);

  return {
    cancellationSettlement: {
      outcome: effectiveOutcome,
      reason: normalizedReason,
      settlementRecordedAt: recordedAt,
      settlementRecordedByActorId: actorId,
      financialSnapshot
    },
    compensationVoucher: null
  };
}

async function transitionReservation({ bookingId, kind, reason = null, settlement = null, ctx = {} }) {
  const config = ALLOWED_TRANSITIONS[kind];
  if (!config) {
    throw createDomainError('validation', `Unknown reservation transition kind: ${kind}`);
  }

  requirePermission({
    role: ctx.user?.role,
    action: config.action
  });

  const idemKey = getIdempotencyFromContext(ctx, config.action, bookingId);
  const remembered = getRememberedResult(idemKey);
  if (remembered) {
    if (kind === 'cancel' || kind === 'complete') {
      try {
        await ensureUnitNightClaimsReleasedShadow({
          bookingId,
          lifecycleSource:
            kind === 'cancel' ? LIFECYCLE_SOURCES.CANCEL : LIFECYCLE_SOURCES.COMPLETE
        });
      } catch {
        /* shadow release must not invalidate remembered canonical success */
      }
    }
    return remembered;
  }

  const booking = await loadBookingOrFail(bookingId);
  if (!config.from.includes(booking.status)) {
    throw createDomainError(
      'invalid_transition',
      `Cannot ${kind} reservation from status ${booking.status}`,
      { status: booking.status, allowedFrom: config.from },
      409
    );
  }

  const before = { status: booking.status, cancellationSettlement: booking.cancellationSettlement || null };
  const nextStatus = config.to;
  const actorId = ctx.user?.id || 'admin';
  const settlementRecordedAt = new Date();
  let cancellationSettlement = null;
  let compensationVoucher = null;

  if (kind === 'cancel') {
    const normalized = await normalizeCancelSettlement({
      settlement,
      reason,
      actorId,
      recordedAt: settlementRecordedAt,
      booking,
      ctx
    });
    cancellationSettlement = normalized.cancellationSettlement;
    compensationVoucher = normalized.compensationVoucher;
  }

  const auditMetadata = { legacyModel: 'Booking' };
  if (compensationVoucher) {
    auditMetadata.compensationGiftVoucherId = compensationVoucher.giftVoucherId;
    auditMetadata.compensationVoucherIdempotentReplay = compensationVoucher.idempotentReplay;
  }

  await appendAuditEvent(
    {
      actorType: 'user',
      actorId,
      entityType: 'Reservation',
      entityId: booking._id.toString(),
      action: `reservation_${kind}`,
      beforeSnapshot: before,
      afterSnapshot: {
        status: nextStatus,
        ...(cancellationSettlement ? { cancellationSettlement } : {})
      },
      metadata: auditMetadata,
      reason: reason || null,
      sourceContext: {
        route: ctx.route || null,
        namespace: 'ops'
      }
    },
    { req: ctx.req }
  );

  booking.status = nextStatus;
  if (cancellationSettlement) {
    booking.cancellationSettlement = cancellationSettlement;
    booking.markModified('cancellationSettlement');
  }
  if (!booking.provenance) {
    booking.provenance = {};
  }
  booking.provenance.lastTransitionAt = settlementRecordedAt;
  booking.provenance.lastTransition = kind;
  booking.markModified('provenance');
  await booking.save({ validateBeforeSave: false });

  if (kind === 'confirm' || kind === 'cancel') {
    const lifecycleEmailResult = await sendLifecycleStatusEmail({ booking, kind });
    if (!lifecycleEmailResult.success) {
      console.error('[reservation-email] Lifecycle email failed:', {
        bookingId: String(booking._id),
        kind,
        method: lifecycleEmailResult.method,
        error: lifecycleEmailResult.error
      });
    }
  }

  if (kind === 'cancel' && compensationVoucher) {
    await sendStayCreditEmailSafely({
      booking,
      compensationVoucher,
      creditAmountCents: cancellationSettlement?.creditAmountCents,
      phase: 'cancel'
    });
  }

  if (kind === 'confirm' && nextStatus === 'confirmed') {
    void processMetaPurchaseAfterConfirm(String(booking._id), ctx.req || {}).catch((err) => {
      console.error('[meta-purchase] OPS confirm CAPI error:', err);
    });
  }

  // Canonical AvailabilityBlock surface: reservation-backed rows must not outlive non-blocking booking status.
  // I4: attempt tombstone, then always shadow-release by bookingId when status is already durable terminal.
  // Preserve existing semantics: tombstone failure still surfaces as transition failure after release attempt.
  if (nextStatus === 'cancelled' || nextStatus === 'completed') {
    let tombstoneError = null;
    try {
      await AvailabilityBlock.updateMany(
        { reservationId: booking._id, blockType: 'reservation', status: 'active' },
        {
          $set: {
            status: 'tombstoned',
            tombstonedAt: new Date(),
            tombstoneReason: nextStatus === 'cancelled' ? 'reservation_cancelled' : 'reservation_completed'
          }
        }
      );
    } catch (err) {
      tombstoneError = err;
    }

    await ensureUnitNightClaimsReleasedShadow({
      booking,
      bookingId: booking._id,
      lifecycleSource:
        nextStatus === 'cancelled' ? LIFECYCLE_SOURCES.CANCEL : LIFECYCLE_SOURCES.COMPLETE
    });

    if (tombstoneError) {
      throw tombstoneError;
    }
  }

  notifyMessageOrchestratorSafely('notifyBookingStatusChange', {
    bookingId: booking._id,
    previousStatus: before.status,
    nextStatus,
    transitionKind: kind
  });

  scheduleOpsPushSafely('notifyOpsPushBookingStatusChange', {
    bookingId: booking._id,
    previousStatus: before.status,
    nextStatus
  });

  const result = {
    reservationId: String(booking._id),
    status: booking.status,
    ...(cancellationSettlement
      ? { cancellationSettlement: booking.cancellationSettlement || cancellationSettlement }
      : {}),
    ...(compensationVoucher ? { compensationVoucher } : {})
  };
  rememberResult(idemKey, result);
  return result;
}

async function resolveCancellationSettlement({ bookingId, reason, settlement, ctx = {} }) {
  requirePermission({
    role: ctx.user?.role,
    action: ACTIONS.OPS_RESERVATION_CANCEL
  });

  if (!bookingId) {
    throw createDomainError('validation', 'bookingId is required', {}, 400);
  }

  const idemKey = buildIdempotencyKey({
    action: RESOLVE_SETTLEMENT_IDEMPOTENCY_ACTION,
    actorId: ctx.user?.id || 'admin',
    entityId: bookingId,
    requestId: ctx.idempotencyKey || ctx.req?.headers?.['x-idempotency-key'] || null
  });
  const remembered = getRememberedResult(idemKey);
  if (remembered) return remembered;

  const booking = await loadBookingOrFail(bookingId);
  if (booking.status !== 'cancelled') {
    throw createDomainError(
      'invalid_transition',
      `Cannot resolve cancellation settlement for reservation in status ${booking.status}`,
      { status: booking.status },
      409
    );
  }

  const normalizedReason = requireResolveReason(reason);
  const targetOutcome = parseResolveTargetOutcome(settlement);
  const sourceOutcome = deriveSourceSettlementOutcome(booking.cancellationSettlement);
  assertResolveEligibleSourceSettlement(booking.cancellationSettlement);
  assertResolveTargetAllowedForSource(sourceOutcome, targetOutcome);

  const actorId = ctx.user?.id || 'admin';
  const settlementRecordedAt = new Date();
  const before = {
    status: booking.status,
    cancellationSettlement: booking.cancellationSettlement || null
  };

  let cancellationSettlement;
  let compensationVoucher = null;

  if (targetOutcome === 'payment_retained') {
    cancellationSettlement = {
      outcome: 'payment_retained',
      reason: normalizedReason,
      settlementRecordedAt,
      settlementRecordedByActorId: actorId,
      financialSnapshot: buildCancelFinancialSnapshot(booking, settlementRecordedAt)
    };
  } else if (targetOutcome === 'credits_issued') {
    const built = await buildCreditsIssuedCancellationSettlement({
      settlement,
      reason: normalizedReason,
      actorId,
      recordedAt: settlementRecordedAt,
      booking,
      ctx,
      missingReasonMessage: 'reason is required when issuing stay credit on resolve'
    });
    cancellationSettlement = built.cancellationSettlement;
    compensationVoucher = built.compensationVoucher;
  } else if (targetOutcome === 'cash_refund_pending') {
    const built = buildCashRefundPendingCancellationSettlement({
      settlement,
      reason: normalizedReason,
      actorId,
      recordedAt: settlementRecordedAt,
      booking,
      missingReasonMessage: 'reason is required when recording cash refund pending on resolve'
    });
    cancellationSettlement = built.cancellationSettlement;
  } else if (targetOutcome === 'cash_refunded') {
    const built = buildCashRefundedCancellationSettlement({
      settlement,
      reason: normalizedReason,
      actorId,
      recordedAt: settlementRecordedAt,
      booking,
      missingReasonMessage: 'reason is required when recording cash refunded on resolve'
    });
    cancellationSettlement = built.cancellationSettlement;
  } else {
    throw createDomainError(
      'validation',
      `Unsupported resolve settlement outcome: ${targetOutcome}`,
      { providedOutcome: targetOutcome },
      400
    );
  }

  const auditMetadata = { legacyModel: 'Booking' };
  if (compensationVoucher) {
    auditMetadata.compensationGiftVoucherId = compensationVoucher.giftVoucherId;
    auditMetadata.compensationVoucherIdempotentReplay = compensationVoucher.idempotentReplay;
  }

  await appendAuditEvent(
    {
      actorType: 'user',
      actorId,
      entityType: 'Reservation',
      entityId: booking._id.toString(),
      action: 'reservation_resolve_cancellation_settlement',
      beforeSnapshot: before,
      afterSnapshot: {
        status: booking.status,
        cancellationSettlement
      },
      metadata: auditMetadata,
      reason: normalizedReason,
      sourceContext: {
        route: ctx.route || null,
        namespace: 'ops'
      }
    },
    { req: ctx.req }
  );

  booking.cancellationSettlement = cancellationSettlement;
  booking.markModified('cancellationSettlement');
  await booking.save({ validateBeforeSave: false });

  if (targetOutcome === 'credits_issued' && compensationVoucher) {
    await sendStayCreditEmailSafely({
      booking,
      compensationVoucher,
      creditAmountCents: cancellationSettlement?.creditAmountCents,
      phase: 'resolve'
    });
  }

  const result = {
    reservationId: String(booking._id),
    status: booking.status,
    cancellationSettlement: booking.cancellationSettlement,
    ...(compensationVoucher ? { compensationVoucher } : {})
  };
  rememberResult(idemKey, result);
  return result;
}

async function reassignReservation({ bookingId, toCabinId, acceptExternalHoldWarnings = false, reason = null, ctx = {} }) {
  requirePermission({
    role: ctx.user?.role,
    action: ACTIONS.OPS_RESERVATION_REASSIGN
  });
  if (!toCabinId) {
    throw createDomainError('validation', 'toCabinId is required');
  }

  const idemKey = getIdempotencyFromContext(ctx, ACTIONS.OPS_RESERVATION_REASSIGN, bookingId);
  const remembered = getRememberedResult(idemKey);
  if (remembered) return remembered;

  const booking = await loadBookingOrFail(bookingId);

  // I6: legacy cabin reassign must not mutate multi-inventory / allocated records.
  if (booking.cabinTypeId || booking.unitId) {
    throw createDomainError(
      'conflict',
      'Multi-unit and cabinType reservations cannot use legacy cabin reassign; REALLOCATE is not available',
      {
        code: 'LEGACY_REASSIGN_NOT_ALLOWED_FOR_MULTI_INVENTORY',
        cabinTypeId: booking.cabinTypeId ? String(booking.cabinTypeId) : null,
        unitId: booking.unitId ? String(booking.unitId) : null,
        cabinId: booking.cabinId ? String(booking.cabinId) : null
      },
      409
    );
  }
  if (booking.cabinId && booking.cabinTypeId) {
    throw createDomainError(
      'conflict',
      'Malformed multi-inventory reservation cannot use legacy cabin reassign',
      { code: 'LEGACY_REASSIGN_MALFORMED_IDENTITY' },
      409
    );
  }

  const check = await evaluateCabinConflicts({
    cabinId: toCabinId,
    startDate: booking.checkIn,
    endDate: booking.checkOut,
    excludeReservationId: booking._id
  });

  if (check.hasHardConflicts) {
    throw createDomainError('conflict', 'Target cabin has hard conflicts', { hardConflicts: check.hardConflicts }, 409);
  }
  if (check.warnings.length > 0 && !acceptExternalHoldWarnings) {
    throw createDomainError(
      'conflict',
      'Target cabin has warning conflicts (external hold acceptance required)',
      { warnings: check.warnings },
      409
    );
  }

  const before = { cabinId: booking.cabinId ? String(booking.cabinId) : null };
  await appendAuditEvent(
    {
      actorType: 'user',
      actorId: ctx.user?.id || 'admin',
      entityType: 'Reservation',
      entityId: String(booking._id),
      action: 'reservation_reassign',
      beforeSnapshot: before,
      afterSnapshot: { cabinId: String(toCabinId) },
      metadata: {
        warningsAccepted: check.warnings.length > 0
      },
      reason: reason || null,
      sourceContext: {
        route: ctx.route || null,
        namespace: 'ops'
      }
    },
    { req: ctx.req }
  );

  const previousCabinId = before.cabinId;
  booking.cabinId = toCabinId;
  await booking.save({ validateBeforeSave: false });

  notifyMessageOrchestratorSafely('notifyReservationReassigned', {
    bookingId: booking._id,
    previousCabinId
  });

  scheduleOpsPushSafely('notifyOpsPushReservationReassigned', {
    bookingId: booking._id
  });

  const result = {
    reservationId: String(booking._id),
    cabinId: String(booking.cabinId),
    warnings: check.warnings
  };
  rememberResult(idemKey, result);
  return result;
}

const DATE_EDIT_ALLOWED_STATUSES = ['pending', 'confirmed', 'in_house'];
const DATE_EDIT_CANONICAL_MRI_CATEGORY = 'reservation_date_edit_canonical_inconsistency';

function buildEditDatesIdempotencyKey(ctx, bookingId, normalized) {
  const fingerprint = `${bookingId}:${normalized.startDate.toISOString()}:${normalized.endDate.toISOString()}`;
  return getIdempotencyFromContext(ctx, ACTIONS.OPS_RESERVATION_EDIT_DATES, fingerprint);
}

function sofiaDatesEqual(a, b) {
  const left = formatSofiaDateOnly(a);
  const right = formatSofiaDateOnly(b);
  return Boolean(left && right && left === right);
}

async function ensureReservationBlocksMatchBookingDates(booking, startDate, endDate, session = null) {
  const filter = {
    reservationId: booking._id,
    blockType: 'reservation',
    status: 'active'
  };
  const update = { $set: { startDate, endDate } };
  if (session) {
    return AvailabilityBlock.updateMany(filter, update, { session });
  }
  return AvailabilityBlock.updateMany(filter, update);
}

async function recordDateEditCanonicalInconsistencyMri({
  bookingId,
  previousCheckIn,
  previousCheckOut,
  requestedCheckIn,
  requestedCheckOut,
  failureStage,
  error
}) {
  try {
    await openManualReviewItem({
      category: DATE_EDIT_CANONICAL_MRI_CATEGORY,
      severity: 'critical',
      entityType: 'Booking',
      entityId: String(bookingId),
      title: 'Reservation date edit left Booking/AvailabilityBlock inconsistent',
      details:
        'Canonical Booking dates and reservation AvailabilityBlocks diverged during Edit Dates; compensation failed',
      provenance: {
        source: 'ops_reservation_edit_dates',
        sourceReference: String(bookingId)
      },
      evidence: {
        bookingId: String(bookingId),
        previousCheckIn: previousCheckIn || null,
        previousCheckOut: previousCheckOut || null,
        requestedCheckIn: requestedCheckIn || null,
        requestedCheckOut: requestedCheckOut || null,
        failureStage: failureStage || null,
        errorCode: error?.code || error?.name || null,
        errorMessage: error?.message
          ? String(error.message).slice(0, 500)
          : String(error || '').slice(0, 500)
      }
    });
  } catch {
    /* MRI must not mask the hard failure */
  }
}

async function commitBookingDatesAndReservationBlocks({
  booking,
  previousCheckIn,
  previousCheckOut,
  startDate,
  endDate
}) {
  const usesTxn = await canUseMongoTransactions();
  if (usesTxn) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        booking.checkIn = startDate;
        booking.checkOut = endDate;
        await booking.save({ session, validateBeforeSave: false });
        await ensureReservationBlocksMatchBookingDates(booking, startDate, endDate, session);
      });
    } finally {
      await session.endSession();
    }
    return;
  }

  booking.checkIn = startDate;
  booking.checkOut = endDate;
  await booking.save({ validateBeforeSave: false });

  try {
    await ensureReservationBlocksMatchBookingDates(booking, startDate, endDate);
  } catch (blockErr) {
    try {
      booking.checkIn = previousCheckIn;
      booking.checkOut = previousCheckOut;
      await booking.save({ validateBeforeSave: false });
    } catch (compensateErr) {
      await recordDateEditCanonicalInconsistencyMri({
        bookingId: booking._id,
        previousCheckIn,
        previousCheckOut,
        requestedCheckIn: startDate,
        requestedCheckOut: endDate,
        failureStage: 'block_update_compensate_failed',
        error: compensateErr
      });
      throw createDomainError(
        'dependency_failure',
        'Date edit failed and Booking/block compensation could not restore prior dates',
        {
          bookingId: String(booking._id),
          failureStage: 'block_update_compensate_failed',
          blockError: blockErr?.message || String(blockErr),
          compensateError: compensateErr?.message || String(compensateErr)
        },
        500
      );
    }
    throw createDomainError(
      'dependency_failure',
      'Date edit failed while updating reservation AvailabilityBlocks; Booking dates restored',
      {
        bookingId: String(booking._id),
        failureStage: 'block_update_failed_compensated',
        blockError: blockErr?.message || String(blockErr)
      },
      500
    );
  }
}

async function evaluateEditDatesConflicts(booking, normalized) {
  const isAllocatedMulti = Boolean(booking.cabinTypeId && booking.unitId);
  if (isAllocatedMulti) {
    const parentCabin = await findParentCabinForCabinType(booking.cabinTypeId);
    if (!parentCabin?._id) {
      throw createDomainError(
        'validation',
        'Parent cabin not found for multi-unit reservation date edit',
        { cabinTypeId: String(booking.cabinTypeId) },
        409
      );
    }
    return evaluateTargetConflicts({
      cabinId: parentCabin._id,
      unitId: booking.unitId,
      cabinTypeId: booking.cabinTypeId,
      startDate: normalized.startDate,
      endDate: normalized.endDate,
      treatExternalHoldAsHard: false,
      excludeReservationId: booking._id
    });
  }

  return evaluateCabinConflicts({
    cabinId: booking.cabinId,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    excludeReservationId: booking._id
  });
}

async function repairEditDatesConvergence(booking) {
  await ensureReservationBlocksMatchBookingDates(booking, booking.checkIn, booking.checkOut);
  return syncUnitNightClaimsShadow({
    booking,
    source: 'date_edit'
  });
}

async function editReservationDates({ bookingId, checkInDate, checkOutDate, reason = null, ctx = {} }) {
  requirePermission({
    role: ctx.user?.role,
    action: ACTIONS.OPS_RESERVATION_EDIT_DATES
  });
  const normalized = normalizeExclusiveDateRange(checkInDate, checkOutDate);

  const idemKey = buildEditDatesIdempotencyKey(ctx, bookingId, normalized);
  const remembered = getRememberedResult(idemKey);
  if (remembered) {
    try {
      const bookingForRepair = await loadBookingOrFail(bookingId);
      if (DATE_EDIT_ALLOWED_STATUSES.includes(bookingForRepair.status)) {
        await repairEditDatesConvergence(bookingForRepair);
      }
    } catch {
      /* repair is best-effort on remembered success; do not invalidate prior success */
    }
    return remembered;
  }

  const booking = await loadBookingOrFail(bookingId);

  if (!DATE_EDIT_ALLOWED_STATUSES.includes(booking.status)) {
    throw createDomainError(
      'invalid_transition',
      `Cannot edit dates for reservation in status ${booking.status}`,
      { status: booking.status, allowedFrom: DATE_EDIT_ALLOWED_STATUSES },
      409
    );
  }

  if (booking.cabinTypeId && !booking.unitId) {
    throw createDomainError(
      'conflict',
      'Date edit requires unit allocation for multi-unit reservations',
      {
        code: 'UNIT_ALLOCATION_REQUIRED',
        cabinTypeId: String(booking.cabinTypeId),
        unitId: null
      },
      409
    );
  }

  if (booking.status === 'in_house' && !sofiaDatesEqual(booking.checkIn, normalized.startDate)) {
    throw createDomainError(
      'invalid_transition',
      'Cannot change check-in date for an in-house reservation',
      {
        status: booking.status,
        code: 'IN_HOUSE_CHECKIN_IMMUTABLE',
        currentCheckIn: booking.checkIn,
        requestedCheckIn: normalized.startDate
      },
      409
    );
  }

  const sameDates =
    sofiaDatesEqual(booking.checkIn, normalized.startDate) &&
    sofiaDatesEqual(booking.checkOut, normalized.endDate);

  if (sameDates) {
    await repairEditDatesConvergence(booking);
    const result = {
      reservationId: String(booking._id),
      checkInDate: booking.checkIn,
      checkOutDate: booking.checkOut,
      warnings: [],
      repaired: true
    };
    rememberResult(idemKey, result);
    return result;
  }

  const conflictCheck = await evaluateEditDatesConflicts(booking, normalized);
  if (conflictCheck.hasHardConflicts) {
    throw createDomainError(
      'conflict',
      'Date edit creates hard conflicts',
      { hardConflicts: conflictCheck.hardConflicts },
      409
    );
  }

  const before = {
    checkIn: booking.checkIn,
    checkOut: booking.checkOut
  };

  const previousCheckIn = before.checkIn;
  const previousCheckOut = before.checkOut;

  const oldExpanded = expandOccupiedSofiaNightDateOnlys(previousCheckIn, previousCheckOut);
  const newExpanded = expandOccupiedSofiaNightDateOnlys(normalized.startDate, normalized.endDate);
  if (!oldExpanded.ok || !newExpanded.ok) {
    throw createDomainError(
      'validation',
      'Invalid date range for inventory claims',
      {
        oldReason: oldExpanded.reason || null,
        newReason: newExpanded.reason || null
      },
      400
    );
  }
  const oldSet = new Set(oldExpanded.dateOnlys);
  const newSet = new Set(newExpanded.dateOnlys);
  const newTarget = newExpanded.dateOnlys.filter((n) => !oldSet.has(n));
  const surplus = oldExpanded.dateOnlys.filter((n) => !newSet.has(n));

  let newTargetClaim = null;
  const isAllocatedMulti = Boolean(booking.cabinTypeId && booking.unitId);
  if (isAllocatedMulti && newTarget.length > 0) {
    try {
      newTargetClaim = await claimUnitNights({
        bookingId: booking._id,
        unitId: booking.unitId,
        nights: newTarget,
        source: 'date_edit'
      });
    } catch (err) {
      if (err?.code === CLAIM_ERR.FOREIGN_OWNER || err?.code === CLAIM_ERR.INDEX_MISSING) {
        throw createDomainError(
          'conflict',
          err.code === CLAIM_ERR.INDEX_MISSING
            ? 'Inventory exclusivity is not available; try again later'
            : 'Date edit target nights conflict with another booking',
          {
            code: err.code,
            hardConflicts: err.details?.conflicts || [],
            details: err.details || null
          },
          409
        );
      }
      throw err;
    }
  }

  try {
    await commitBookingDatesAndReservationBlocks({
      booking,
      previousCheckIn,
      previousCheckOut,
      startDate: normalized.startDate,
      endDate: normalized.endDate
    });
  } catch (commitErr) {
    if (newTargetClaim?.insertedNightsThisAttempt?.length) {
      try {
        await compensateClaimAttempt({
          bookingId: booking._id,
          unitId: booking.unitId,
          insertedNightsThisAttempt: newTargetClaim.insertedNightsThisAttempt
        });
      } catch (compErr) {
        try {
          await openManualReviewItem({
            category: 'unit_night_claim_shadow_failure',
            severity: 'critical',
            entityType: 'Booking',
            entityId: String(booking._id),
            title: 'UnitNightClaim date-edit compensation failed',
            details: compErr?.message || 'Compensation failed after date-edit commit failure',
            provenance: {
              source: 'unit_night_claim_authoritative',
              sourceReference: `${String(booking._id)}:sync`
            },
            evidence: {
              operation: 'sync',
              errorCode: compErr?.code || null
            }
          });
        } catch {
          /* MRI best-effort */
        }
      }
    }
    throw commitErr;
  }

  // Mutation audit only after canonical Booking + reservation-block convergence.
  await appendAuditEvent(
    {
      actorType: 'user',
      actorId: ctx.user?.id || 'admin',
      entityType: 'Reservation',
      entityId: String(booking._id),
      action: 'reservation_edit_dates',
      beforeSnapshot: before,
      afterSnapshot: {
        checkIn: normalized.startDate,
        checkOut: normalized.endDate
      },
      metadata: {
        warningConflicts: conflictCheck.warnings.length
      },
      reason: reason || null,
      sourceContext: {
        route: ctx.route || null,
        namespace: 'ops'
      }
    },
    { req: ctx.req }
  );

  notifyMessageOrchestratorSafely('notifyReservationDatesChanged', {
    bookingId: booking._id,
    previousCheckIn,
    previousCheckOut
  });

  scheduleOpsPushSafely('notifyOpsPushReservationDatesChanged', {
    bookingId: booking._id
  });

  // Release surplus only AFTER successful canonical commit.
  if (isAllocatedMulti && surplus.length > 0) {
    try {
      await releaseUnitNights({
        bookingId: booking._id,
        unitId: booking.unitId,
        nights: surplus
      });
    } catch (releaseErr) {
      try {
        await openManualReviewItem({
          category: 'unit_night_claim_shadow_failure',
          severity: 'critical',
          entityType: 'Booking',
          entityId: String(booking._id),
          title: 'UnitNightClaim surplus release failed after date edit',
          details: releaseErr?.message || 'Surplus release failed; stale claims remain conservative',
          provenance: {
            source: 'unit_night_claim_authoritative',
            sourceReference: `${String(booking._id)}:sync`
          },
          evidence: {
            operation: 'sync',
            surplusNights: surplus,
            errorCode: releaseErr?.code || null
          }
        });
      } catch {
        /* MRI best-effort */
      }
    }
  } else if (!isAllocatedMulti) {
    await syncUnitNightClaimsShadow({
      booking,
      source: 'date_edit'
    });
  }

  const result = {
    reservationId: String(booking._id),
    checkInDate: booking.checkIn,
    checkOutDate: booking.checkOut,
    warnings: conflictCheck.warnings
  };
  rememberResult(idemKey, result);
  return result;
}

async function editGuestContact({ bookingId, firstName, lastName, email, phone, ctx = {} }) {
  requirePermission({
    role: ctx.user?.role,
    action: ACTIONS.OPS_RESERVATION_EDIT_GUEST_CONTACT
  });

  const idemKey = getIdempotencyFromContext(ctx, ACTIONS.OPS_RESERVATION_EDIT_GUEST_CONTACT, bookingId);
  const remembered = getRememberedResult(idemKey);
  if (remembered) return remembered;

  const booking = await loadBookingOrFail(bookingId);
  const before = {
    firstName: booking.guestInfo?.firstName || null,
    lastName: booking.guestInfo?.lastName || null,
    email: booking.guestInfo?.email || null,
    phone: booking.guestInfo?.phone || null
  };

  const next = {
    firstName: firstName || booking.guestInfo?.firstName,
    lastName: lastName || booking.guestInfo?.lastName,
    email: email || booking.guestInfo?.email,
    phone: phone || booking.guestInfo?.phone
  };

  await appendAuditEvent(
    {
      actorType: 'user',
      actorId: ctx.user?.id || 'admin',
      entityType: 'Reservation',
      entityId: String(booking._id),
      action: 'reservation_edit_guest_contact',
      beforeSnapshot: before,
      afterSnapshot: next,
      metadata: { legacyModel: 'Booking' },
      reason: null,
      sourceContext: {
        route: ctx.route || null,
        namespace: 'ops'
      }
    },
    { req: ctx.req }
  );

  booking.guestInfo.firstName = next.firstName;
  booking.guestInfo.lastName = next.lastName;
  booking.guestInfo.email = next.email;
  booking.guestInfo.phone = next.phone;
  await booking.save({ validateBeforeSave: false });

  try {
    const { syncGuestContactPreferencesForBooking } = require('../../messaging/guestContactPreferenceSync');
    await syncGuestContactPreferencesForBooking(booking);
  } catch (err) {
    console.error(
      JSON.stringify({
        source: 'guestContactPreferenceSync',
        phase: 'ops_edit_guest_contact',
        bookingId: String(booking._id),
        error: err?.message || String(err)
      })
    );
  }

  await Guest.findOneAndUpdate(
    { email: before.email || next.email },
    {
      $set: {
        firstName: next.firstName,
        lastName: next.lastName,
        email: next.email,
        phone: next.phone,
        source: 'internal_admin'
      },
      $setOnInsert: {
        importedAt: new Date(),
        sourceReference: String(booking._id)
      }
    },
    { new: true, upsert: true }
  );

  const result = {
    reservationId: String(booking._id),
    guest: next
  };
  rememberResult(idemKey, result);
  return result;
}

async function createManualReservation({
  cabinId,
  checkInDate,
  checkOutDate,
  adults = 2,
  children = 0,
  guestInfo,
  initialStatus = 'pending',
  note = null,
  acceptExternalHoldWarnings = false,
  paymentPlaceholderNote = null,
  manualReservationPurpose = null,
  sendGuestConfirmationEmail = null,
  reason = null,
  ctx = {}
}) {
  requirePermission({
    role: ctx.user?.role,
    action: ACTIONS.OPS_RESERVATION_MANUAL_CREATE
  });

  if (!cabinId) {
    throw createDomainError('validation', 'cabinId is required');
  }
  if (!guestInfo || !guestInfo.firstName || !guestInfo.lastName || !guestInfo.email || !guestInfo.phone) {
    throw createDomainError('validation', 'guestInfo must include firstName, lastName, email, and phone');
  }

  const allowedInitial = ['pending', 'confirmed'];
  if (!allowedInitial.includes(initialStatus)) {
    throw createDomainError('validation', 'initialStatus must be pending or confirmed');
  }

  const normalized = normalizeExclusiveDateRange(checkInDate, checkOutDate);
  const fingerprint = `${cabinId}:${normalized.startDate.toISOString()}:${normalized.endDate.toISOString()}:${String(guestInfo.email).toLowerCase()}`;
  const idemKey = getIdempotencyFromContext(ctx, ACTIONS.OPS_RESERVATION_MANUAL_CREATE, fingerprint);
  const remembered = getRememberedResult(idemKey);
  if (remembered) return remembered;

  const cabin = await Cabin.findById(cabinId).lean();
  if (!cabin) {
    throw createDomainError('validation', 'Cabin not found', { cabinId }, 404);
  }
  if (cabin.archivedAt) {
    throw createDomainError('validation', 'Cabin is archived', { cabinId }, 409);
  }

  if (isFixtureCabinName(cabin.name)) {
    const allowFixture = process.env.ALLOW_FIXTURE_ENTITY_OPS_WRITE === '1';
    if (process.env.NODE_ENV === 'production') {
      throw createDomainError('validation', 'Manual reservations cannot be created on fixture cabins');
    }
    if (!allowFixture) {
      throw createDomainError(
        'validation',
        'Fixture cabins are blocked for manual reservations (set ALLOW_FIXTURE_ENTITY_OPS_WRITE=1 in non-production to override)'
      );
    }
  }

  const check = await evaluateCabinConflicts({
    cabinId,
    startDate: normalized.startDate,
    endDate: normalized.endDate
  });
  if (check.hasHardConflicts) {
    throw createDomainError(
      'conflict',
      'Dates conflict with existing reservations or blocks',
      { hardConflicts: check.hardConflicts },
      409
    );
  }
  if (check.warnings.length > 0 && !acceptExternalHoldWarnings) {
    throw createDomainError(
      'conflict',
      'External channel holds overlap this range (pass acceptExternalHoldWarnings to proceed)',
      { warnings: check.warnings },
      409
    );
  }

  const provenanceSource = ctx.user?.role === 'operator' ? 'operator_manual' : 'admin_manual';
  const paymentNote = paymentPlaceholderNote != null && String(paymentPlaceholderNote).trim()
    ? String(paymentPlaceholderNote).trim().slice(0, 450)
    : '';

  let normalizedPurpose = null;
  try {
    normalizedPurpose = normalizeManualReservationPurpose(manualReservationPurpose);
  } catch (err) {
    throw createDomainError('validation', err.message, { manualReservationPurpose }, 400);
  }
  const resolvedSendGuestConfirmationEmail = resolveSendGuestConfirmationEmailAtIntake(
    normalizedPurpose,
    sendGuestConfirmationEmail
  );

  const booking = new Booking({
    _id: new mongoose.Types.ObjectId(),
    cabinId,
    checkIn: normalized.startDate,
    checkOut: normalized.endDate,
    adults: Math.max(1, parseInt(adults, 10) || 1),
    children: Math.max(0, parseInt(children, 10) || 0),
    guestInfo: {
      firstName: String(guestInfo.firstName).trim(),
      lastName: String(guestInfo.lastName).trim(),
      email: String(guestInfo.email).trim().toLowerCase(),
      phone: String(guestInfo.phone).trim()
    },
    specialRequests: paymentNote ? `[payment placeholder] ${paymentNote}` : undefined,
    totalPrice: 0,
    status: initialStatus,
    isTest: false,
    isProductionSafe: true,
    provenance: {
      source: provenanceSource,
      channel: 'staff',
      intakeRevision: 1,
      createdByRoute: ctx.route || null
    },
    manualReservationPurpose: normalizedPurpose,
    sendGuestConfirmationEmail: resolvedSendGuestConfirmationEmail
  });

  await appendAuditEvent(
    {
      actorType: 'user',
      actorId: ctx.user?.id || 'admin',
      entityType: 'Reservation',
      entityId: String(booking._id),
      action: 'reservation_manual_create',
      beforeSnapshot: null,
      afterSnapshot: {
        cabinId: String(cabinId),
        checkIn: normalized.startDate,
        checkOut: normalized.endDate,
        initialStatus,
        guestEmail: booking.guestInfo.email,
        provenanceSource,
        manualReservationPurpose: normalizedPurpose,
        sendGuestConfirmationEmail: resolvedSendGuestConfirmationEmail
      },
      metadata: { legacyModel: 'Booking' },
      reason: reason || null,
      sourceContext: {
        route: ctx.route || null,
        namespace: 'ops'
      }
    },
    { req: ctx.req }
  );

  await booking.save({ validateBeforeSave: false });

  const overlaps = await Booking.countDocuments({
    cabinId,
    _id: { $ne: booking._id },
    status: { $in: BLOCKING_BOOKING_STATUSES },
    isTest: { $ne: true },
    $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }],
    checkIn: { $lt: normalized.endDate },
    checkOut: { $gt: normalized.startDate }
  });
  const blockRace = await countBlockingBlocksForSingleCabin(cabinId, normalized.startDate, normalized.endDate);
  if (overlaps > 0 || blockRace > 0) {
    await Booking.deleteOne({ _id: booking._id });
    throw createDomainError(
      'conflict',
      'Availability changed while saving; please retry',
      { overlaps, blockRace },
      409
    );
  }

  await Guest.findOneAndUpdate(
    { email: booking.guestInfo.email },
    {
      $set: {
        firstName: booking.guestInfo.firstName,
        lastName: booking.guestInfo.lastName,
        email: booking.guestInfo.email,
        phone: booking.guestInfo.phone,
        source: 'internal_admin'
      },
      $setOnInsert: {
        importedAt: new Date(),
        sourceReference: String(booking._id)
      }
    },
    { new: true, upsert: true }
  );

  try {
    const { syncGuestContactPreferencesForBooking } = require('../../messaging/guestContactPreferenceSync');
    await syncGuestContactPreferencesForBooking(booking);
  } catch (err) {
    console.error(
      JSON.stringify({
        source: 'guestContactPreferenceSync',
        phase: 'ops_manual_reservation_create',
        bookingId: String(booking._id),
        error: err?.message || String(err)
      })
    );
  }

  if (note != null && String(note).trim()) {
    await addReservationNote({
      bookingId: String(booking._id),
      content: String(note).trim(),
      metadata: { kind: 'manual_intake' },
      ctx
    });
  }

  if (initialStatus === 'confirmed' && shouldSendAutomaticGuestConfirmation(booking)) {
    try {
      const guestOutcome = await bookingLifecycleEmailService.sendBookingLifecycleEmail({
        booking,
        templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CONFIRMED,
        overrideRecipient: null,
        lifecycleSource: 'automatic',
        actorContext: null,
        entity: cabin
      });
      if (!guestOutcome.success) {
        console.error('[reservation-email] Guest booking_confirmed not sent:', {
          bookingId: String(booking._id),
          method: guestOutcome.sendResult?.method,
          error: guestOutcome.sendResult?.error
        });
      }
    } catch (err) {
      console.error('[reservation-email] Guest booking_confirmed error:', {
        bookingId: String(booking._id),
        message: err?.message || String(err)
      });
    }
  }

  notifyMessageOrchestratorSafely('notifyManualReservationCreated', {
    bookingId: booking._id
  });

  void (async () => {
    try {
      const { notifyOpsPushManualReservationCreated } = require('../push/opsPushEventNotifications');
      await notifyOpsPushManualReservationCreated({ bookingId: booking._id });
    } catch (err) {
      console.error(
        JSON.stringify({
          source: 'ops-push',
          phase: 'manual_reservation_hook_error',
          bookingId: String(booking._id),
          error: err?.message || String(err)
        })
      );
    }
  })();

  scheduleOpsPushSafely('scheduleOpsPushForBooking', {
    bookingId: booking._id
  });

  const result = {
    reservationId: String(booking._id),
    status: booking.status,
    cabinId: String(booking.cabinId),
    provenanceSource,
    manualReservationPurpose: booking.manualReservationPurpose || null,
    sendGuestConfirmationEmail: booking.sendGuestConfirmationEmail ?? null
  };
  rememberResult(idemKey, result);
  return result;
}

async function addReservationNote({ bookingId, content, metadata = {}, ctx = {} }) {
  requirePermission({
    role: ctx.user?.role,
    action: ACTIONS.OPS_RESERVATION_ADD_NOTE
  });

  if (!content || !String(content).trim()) {
    throw createDomainError('validation', 'Note content is required');
  }

  const booking = await loadBookingOrFail(bookingId);
  const actor = buildActor(ctx);
  const noteId = new mongoose.Types.ObjectId();
  const normalizedContent = String(content).trim();

  await appendAuditEvent(
    {
      actorType: 'user',
      actorId: ctx.user?.id || 'admin',
      entityType: 'Reservation',
      entityId: String(booking._id),
      action: 'reservation_note_add',
      beforeSnapshot: null,
      afterSnapshot: {
        noteId: String(noteId),
        contentLength: normalizedContent.length
      },
      metadata: {
        noteId: String(noteId)
      },
      reason: null,
      sourceContext: {
        route: ctx.route || null,
        namespace: 'ops'
      }
    },
    { req: ctx.req }
  );

  const note = await ReservationNote.create({
    _id: noteId,
    reservationId: booking._id,
    author: {
      actorType: actor.actorType,
      actorId: actor.actorId,
      role: actor.role
    },
    content: normalizedContent,
    metadata
  });

  return {
    reservationId: String(booking._id),
    note: {
      noteId: String(note._id),
      content: note.content,
      createdAt: note.createdAt,
      author: note.author
    }
  };
}

module.exports = {
  transitionReservation,
  resolveCancellationSettlement,
  reassignReservation,
  editReservationDates,
  editGuestContact,
  addReservationNote,
  createManualReservation,
  // Test / diagnostics
  DATE_EDIT_CANONICAL_MRI_CATEGORY,
  DATE_EDIT_ALLOWED_STATUSES
};
