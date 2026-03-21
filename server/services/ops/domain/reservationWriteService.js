const Booking = require('../../../models/Booking');
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

async function transitionReservation({ bookingId, kind, reason = null, ctx = {} }) {
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

  const before = { status: booking.status };
  const nextStatus = config.to;

  await appendAuditEvent(
    {
      actorType: 'user',
      actorId: ctx.user?.id || 'admin',
      entityType: 'Reservation',
      entityId: booking._id.toString(),
      action: `reservation_${kind}`,
      beforeSnapshot: before,
      afterSnapshot: { status: nextStatus },
      metadata: { legacyModel: 'Booking' },
      reason: reason || null,
      sourceContext: {
        route: ctx.route || null,
        namespace: 'ops'
      }
    },
    { req: ctx.req }
  );

  booking.status = nextStatus;
  await booking.save({ validateBeforeSave: false });

  const result = {
    reservationId: String(booking._id),
    status: booking.status
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

  booking.cabinId = toCabinId;
  await booking.save({ validateBeforeSave: false });

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

  booking.checkIn = normalized.startDate;
  booking.checkOut = normalized.endDate;
  await booking.save({ validateBeforeSave: false });

  // keep reservation-backed canonical surface in sync where present
  await AvailabilityBlock.updateMany(
    { reservationId: booking._id, blockType: 'reservation', status: 'active' },
    { $set: { startDate: normalized.startDate, endDate: normalized.endDate } }
  );

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
  reassignReservation,
  editReservationDates,
  editGuestContact,
  addReservationNote
};
