const Booking = require('../../../models/Booking');
const Cabin = require('../../../models/Cabin');
const Guest = require('../../../models/Guest');
const ReservationNote = require('../../../models/ReservationNote');
const AvailabilityBlock = require('../../../models/AvailabilityBlock');
const mongoose = require('mongoose');
const { requirePermission, ACTIONS } = require('../../permissionService');
const { appendAuditEvent } = require('../../auditWriter');
const { buildIdempotencyKey, getRememberedResult, rememberResult } = require('../../idempotencyService');
const { normalizeExclusiveDateRange } = require('../../../utils/dateTime');
const { evaluateCabinConflicts } = require('./conflictService');
const { createDomainError } = require('./errors');
const { isFixtureCabinName } = require('../../../utils/fixtureExclusion');
const { countBlockingBlocksForSingleCabin } = require('../../publicAvailabilityService');
const { BLOCKING_BOOKING_STATUSES } = require('../../calendar/blockingStatusConstants');
const { processMetaPurchaseAfterConfirm } = require('../../bookingPurchaseTracking');
const CabinType = require('../../../models/CabinType');
const bookingLifecycleEmailService = require('../../bookingLifecycleEmailService');
const {
  issueCancellationCompensationVoucher,
  MIN_CREDIT_AMOUNT_CENTS
} = require('../../giftVouchers/issueCancellationCompensationVoucherService');

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

const CANCEL_ALLOWED_OUTCOMES = new Set(['resolution_pending', 'payment_retained', 'credits_issued']);

const CANCEL_REJECTED_OUTCOMES = new Set([
  'unresolved',
  'cash_refund_pending',
  'cash_refunded',
  'rebooked_or_moved'
]);

const RESOLVE_SETTLEMENT_IDEMPOTENCY_ACTION = 'ops.reservation.resolve_cancellation_settlement';

const RESOLVE_ALLOWED_TARGET_OUTCOMES = new Set(['payment_retained', 'credits_issued']);

const RESOLVE_REJECTED_TARGET_OUTCOMES = new Set([
  'resolution_pending',
  'unresolved',
  'cash_refund_pending',
  'cash_refunded',
  'rebooked_or_moved'
]);

const RESOLVE_UNSUPPORTED_SOURCE_OUTCOMES = new Set([
  'payment_retained',
  'credits_issued',
  'unresolved',
  'cash_refund_pending',
  'cash_refunded',
  'rebooked_or_moved'
]);

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

function assertResolveEligibleSourceSettlement(cancellationSettlement) {
  if (!cancellationSettlement || typeof cancellationSettlement !== 'object') {
    return;
  }
  const outcome =
    typeof cancellationSettlement.outcome === 'string'
      ? cancellationSettlement.outcome.trim()
      : '';
  if (!outcome || outcome === 'resolution_pending') {
    return;
  }
  if (outcome === 'payment_retained' || outcome === 'credits_issued') {
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
      'Resolve supports settlement outcomes: payment_retained or credits_issued',
      { allowedOutcomes: [...RESOLVE_ALLOWED_TARGET_OUTCOMES], providedOutcome: targetOutcome },
      400
    );
  }
  return targetOutcome;
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
      'Cancel supports settlement outcomes: resolution_pending, payment_retained, or credits_issued',
      { allowedOutcomes: [...CANCEL_ALLOWED_OUTCOMES], providedOutcome: outcome || null },
      400
    );
  }

  const normalizedReason = normalizeTrimmedReason(reason);
  const financialSnapshot = buildCancelFinancialSnapshot(booking, recordedAt);

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
  if (remembered) return remembered;

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

  if (kind === 'confirm' && nextStatus === 'confirmed') {
    void processMetaPurchaseAfterConfirm(String(booking._id), ctx.req || {}).catch((err) => {
      console.error('[meta-purchase] OPS confirm CAPI error:', err);
    });
  }

  // Canonical AvailabilityBlock surface: reservation-backed rows must not outlive non-blocking booking status.
  if (nextStatus === 'cancelled' || nextStatus === 'completed') {
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
  }

  notifyMessageOrchestratorSafely('notifyBookingStatusChange', {
    bookingId: booking._id,
    previousStatus: before.status,
    nextStatus,
    transitionKind: kind
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
  assertResolveEligibleSourceSettlement(booking.cancellationSettlement);

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
  } else {
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

  const result = {
    reservationId: String(booking._id),
    cabinId: String(booking.cabinId),
    warnings: check.warnings
  };
  rememberResult(idemKey, result);
  return result;
}

async function editReservationDates({ bookingId, checkInDate, checkOutDate, reason = null, ctx = {} }) {
  requirePermission({
    role: ctx.user?.role,
    action: ACTIONS.OPS_RESERVATION_EDIT_DATES
  });
  const normalized = normalizeExclusiveDateRange(checkInDate, checkOutDate);

  const idemKey = getIdempotencyFromContext(ctx, ACTIONS.OPS_RESERVATION_EDIT_DATES, bookingId);
  const remembered = getRememberedResult(idemKey);
  if (remembered) return remembered;

  const booking = await loadBookingOrFail(bookingId);
  const conflictCheck = await evaluateCabinConflicts({
    cabinId: booking.cabinId,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    excludeReservationId: booking._id
  });

  if (conflictCheck.hasHardConflicts) {
    throw createDomainError('conflict', 'Date edit creates hard conflicts', { hardConflicts: conflictCheck.hardConflicts }, 409);
  }

  const before = {
    checkIn: booking.checkIn,
    checkOut: booking.checkOut
  };

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

  const previousCheckIn = before.checkIn;
  const previousCheckOut = before.checkOut;
  booking.checkIn = normalized.startDate;
  booking.checkOut = normalized.endDate;
  await booking.save({ validateBeforeSave: false });

  // keep reservation-backed canonical surface in sync where present
  await AvailabilityBlock.updateMany(
    { reservationId: booking._id, blockType: 'reservation', status: 'active' },
    { $set: { startDate: normalized.startDate, endDate: normalized.endDate } }
  );

  notifyMessageOrchestratorSafely('notifyReservationDatesChanged', {
    bookingId: booking._id,
    previousCheckIn,
    previousCheckOut
  });

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
    }
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
        provenanceSource
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

  if (initialStatus === 'confirmed') {
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

  const result = {
    reservationId: String(booking._id),
    status: booking.status,
    cabinId: String(booking.cabinId),
    provenanceSource
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
  createManualReservation
};
