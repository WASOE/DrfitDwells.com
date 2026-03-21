const Booking = require('../../../models/Booking');
const Cabin = require('../../../models/Cabin');
const EmailEvent = require('../../../models/EmailEvent');
const { requirePermission, ACTIONS } = require('../../permissionService');
const { appendAuditEvent } = require('../../auditWriter');
const { buildIdempotencyKey, getRememberedResult, rememberResult } = require('../../idempotencyService');
const emailService = require('../../emailService');
const { createDomainError } = require('./errors');

async function loadBookingWithCabin(bookingId) {
  const booking = await Booking.findById(bookingId).lean();
  if (!booking) {
    throw createDomainError('validation', 'Reservation not found', { bookingId }, 404);
  }
  const cabin = booking.cabinId ? await Cabin.findById(booking.cabinId).lean() : null;
  return { booking, cabin };
}

function idemKey(ctx, action, bookingId) {
  return buildIdempotencyKey({
    action,
    actorId: ctx.user?.id || 'admin',
    entityId: bookingId,
    requestId: ctx.idempotencyKey || ctx.req?.headers?.['x-idempotency-key'] || null
  });
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

  const { booking, cabin } = await loadBookingWithCabin(bookingId);
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

  if (!booking.guestInfo?.email) {
    throw createDomainError('validation', 'Guest email is missing for arrival instructions');
  }

  const subject = kind === 'send' ? 'Arrival Instructions - Drift & Dwells' : 'Arrival Instructions (Resent) - Drift & Dwells';
  const text = `Hello ${booking.guestInfo.firstName || 'Guest'},\n\nYour arrival instructions for Drift & Dwells.\nCheck-in date: ${booking.checkIn}\nCabin: ${cabin?.name || 'Unknown'}\n\nSafe travels.`;
  const html = `<p>Hello ${booking.guestInfo.firstName || 'Guest'},</p><p>Your arrival instructions for Drift & Dwells.</p>`;

  const sendResult = await emailService.sendEmail({
    to: booking.guestInfo.email,
    subject,
    html,
    text,
    trigger: kind === 'send' ? 'arrival_instructions_sent' : 'arrival_instructions_resent',
    bookingId: String(booking._id)
  });
  if (!sendResult.success) {
    throw createDomainError('dependency_failure', 'Failed to send arrival instructions', { provider: sendResult.method }, 502);
  }

  // External side effect (email delivery) cannot be rolled back atomically with DB writes.
  // If audit append fails below, DB commit is blocked, but provider delivery may already have occurred.
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
        email: booking.guestInfo.email,
        sendMethod: sendResult.method
      },
      reason: null,
      sourceContext: { route: ctx.route || null, namespace: 'ops' }
    },
    { req: ctx.req }
  );

  const emailEventPayload = {
    provider: 'internal',
    stream: 'transactional',
    type: kind === 'send' ? 'ArrivalSent' : 'ArrivalResent',
    bookingId: booking._id,
    to: booking.guestInfo.email,
    subject,
    tag: 'arrival_instructions',
    details: {
      sendMethod: sendResult.method
    }
  };
  if (sendResult.messageId) {
    emailEventPayload.messageId = sendResult.messageId;
  }
  await EmailEvent.create(emailEventPayload);

  const result = {
    reservationId: String(booking._id),
    arrivalStatus: 'sent',
    communication: {
      sent: true,
      messageId: sendResult.messageId || null
    }
  };
  rememberResult(key, result);
  return result;
}

module.exports = {
  sendArrivalInstructions
};
