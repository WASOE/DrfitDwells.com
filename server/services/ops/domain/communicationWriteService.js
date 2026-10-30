const Booking = require('../../../models/Booking');
const { requirePermission, ACTIONS } = require('../../permissionService');
const { appendAuditEvent } = require('../../auditWriter');
const { buildIdempotencyKey, getRememberedResult, rememberResult } = require('../../idempotencyService');
const { createDomainError } = require('./errors');
const { isArrivalEmailV2Enabled } = require('../../messaging/arrival/arrivalFeatureFlags');
const { sendArrivalEmailV2 } = require('../../messaging/arrival/arrivalEmailSendService');

async function loadBooking(bookingId) {
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw createDomainError('validation', 'Reservation not found', { bookingId }, 404);
  }
  return booking;
}

function idemKey(ctx, action, bookingId) {
  return buildIdempotencyKey({
    action,
    actorId: ctx.user?.id || 'admin',
    entityId: bookingId,
    requestId: ctx.idempotencyKey || ctx.req?.headers?.['x-idempotency-key'] || null
  });
}

function resolveResendOperationId(ctx) {
  const fromCtx = ctx.idempotencyKey || ctx.req?.headers?.['x-idempotency-key'];
  if (fromCtx && String(fromCtx).trim()) return String(fromCtx).trim();
  const fromBody = ctx.req?.body?.resendOperationId || ctx.req?.body?.operationId;
  if (fromBody && String(fromBody).trim()) return String(fromBody).trim();
  return null;
}

async function sendArrivalInstructions({ bookingId, kind = 'send', ctx = {} }) {
  const action =
    kind === 'send'
      ? ACTIONS.OPS_COMMUNICATION_SEND_ARRIVAL
      : kind === 'resend'
      ? ACTIONS.OPS_COMMUNICATION_RESEND_ARRIVAL
      : ACTIONS.OPS_COMMUNICATION_MARK_ARRIVAL_COMPLETED;

  requirePermission({ role: ctx.user?.role, action });
  const key = idemKey(ctx, action, bookingId);
  const remembered = getRememberedResult(key);
  if (remembered) return remembered;

  const booking = await loadBooking(bookingId);

  if (kind === 'complete') {
    await appendAuditEvent(
      {
        actorType: 'user',
        actorId: ctx.user?.id || 'admin',
        entityType: 'Reservation',
        entityId: String(booking._id),
        action: 'arrival_flow_completed',
        beforeSnapshot: { arrivalStatus: 'sent_or_unknown' },
        afterSnapshot: { arrivalStatus: 'completed' },
        metadata: { communicationChannel: 'email' },
        reason: null,
        sourceContext: { route: ctx.route || null, namespace: 'ops' }
      },
      { req: ctx.req }
    );
    const result = {
      reservationId: String(booking._id),
      arrivalStatus: 'completed'
    };
    rememberResult(key, result);
    return result;
  }

  if (!isArrivalEmailV2Enabled()) {
    throw createDomainError(
      'validation',
      'Arrival email V2 is disabled. The legacy placeholder arrival email is not available.',
      { flag: 'ARRIVAL_EMAIL_V2' },
      409
    );
  }

  if (kind !== 'send' && kind !== 'resend') {
    throw createDomainError('validation', `Unsupported arrival action kind: ${kind}`);
  }

  const operationId = kind === 'resend' ? resolveResendOperationId(ctx) : null;
  if (kind === 'resend' && !operationId) {
    throw createDomainError(
      'validation',
      'Resend requires a stable operationId (x-idempotency-key or body.resendOperationId)',
      null,
      400
    );
  }

  const sendResult = await sendArrivalEmailV2({
    booking,
    kind,
    operationId,
    actor: { id: ctx.user?.id || 'admin', role: ctx.user?.role || null }
  });

  if (!sendResult.ok) {
    if (sendResult.duplicate && sendResult.status === 'accepted') {
      // Should be handled as ok by mapExisting — defensive
    } else if (sendResult.uncertain || sendResult.code === 'dispatch_pending_requires_review') {
      throw createDomainError(
        'dependency_failure',
        sendResult.message || 'Arrival send outcome requires review',
        {
          dispatchId: sendResult.dispatchId || null,
          code: sendResult.code || null,
          status: sendResult.status || null
        },
        502
      );
    } else if (sendResult.duplicate && sendResult.status !== 'accepted') {
      throw createDomainError(
        'dependency_failure',
        sendResult.message || 'Prior arrival dispatch is not in an accepted state',
        { dispatchId: sendResult.dispatchId || null, status: sendResult.status || null },
        502
      );
    } else {
      throw createDomainError(
        'dependency_failure',
        sendResult.message || 'Failed to send arrival instructions',
        {
          dispatchId: sendResult.dispatchId || null,
          code: sendResult.code || null,
          classification: sendResult.classification || null,
          method: sendResult.method || null,
          retriable: sendResult.retriable === true
        },
        502
      );
    }
  }

  // Duplicate accepted initial/resend: treat as success without re-auditing SMTP.
  const authoritative = sendResult.ok && sendResult.authoritative !== false && sendResult.status === 'accepted';
  if (!authoritative && !(sendResult.duplicate && sendResult.status === 'accepted')) {
    throw createDomainError(
      'dependency_failure',
      'Arrival email was not authoritatively accepted by the provider',
      { dispatchId: sendResult.dispatchId || null },
      502
    );
  }

  const result = {
    reservationId: String(booking._id),
    arrivalStatus: 'sent',
    communication: {
      sent: true,
      messageId: sendResult.providerMessageId || sendResult.messageId || null,
      dispatchId: sendResult.dispatchId || null,
      duplicate: Boolean(sendResult.duplicate),
      arrivalEmailV2: true
    }
  };

  // Only audit a newly accepted provider send — not durable-idempotency replays.
  if (!sendResult.duplicate) {
    await appendAuditEvent(
      {
        actorType: 'user',
        actorId: ctx.user?.id || 'admin',
        entityType: 'Reservation',
        entityId: String(booking._id),
        action: kind === 'send' ? 'arrival_instructions_send' : 'arrival_instructions_resend',
        beforeSnapshot: { arrivalStatus: 'not_sent_or_unknown' },
        afterSnapshot: { arrivalStatus: 'sent' },
        metadata: {
          email: booking.guestInfo?.email || null,
          dispatchId: sendResult.dispatchId || null,
          providerMessageId: sendResult.providerMessageId || sendResult.messageId || null,
          duplicate: false,
          arrivalEmailV2: true,
          propertyKind: sendResult.propertyKind || null
        },
        reason: null,
        sourceContext: { route: ctx.route || null, namespace: 'ops' }
      },
      { req: ctx.req }
    );
  }

  // PR2: baseline automation state after a *newly accepted* initial manual
  // send only. Never baseline on durable-idempotency replays — that would
  // reset lastCommunicatedRevision to 0 and could hide a pending correction.
  if (kind === 'send' && sendResult.status === 'accepted' && !sendResult.duplicate) {
    try {
      const { resolveArrivalStayContext } = require('../../messaging/arrival/arrivalStayResolver');
      const {
        buildArrivalStateKey
      } = require('../../messaging/arrival/arrivalCommunicationRevision');
      const { markInitialBaseline } = require('../../messaging/arrival/arrivalAutomationScheduler');
      const stay = await resolveArrivalStayContext(booking);
      if (stay.ok) {
        await markInitialBaseline({
          bookingId: booking._id,
          stateKey: buildArrivalStateKey(booking, stay.propertyKind)
        });
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          source: 'arrival-automation-v2',
          phase: 'manual_send_baseline_failed',
          bookingId: String(booking._id),
          error: err?.message || String(err)
        })
      );
    }
  }

  rememberResult(key, result);
  return result;
}

module.exports = {
  sendArrivalInstructions
};
