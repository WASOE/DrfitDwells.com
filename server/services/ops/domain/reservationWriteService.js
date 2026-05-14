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
  if (!booking.provenance) {
    booking.provenance = {};
  }
  booking.provenance.lastTransitionAt = new Date();
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
  reassignReservation,
  editReservationDates,
  editGuestContact,
  addReservationNote,
  createManualReservation
};
