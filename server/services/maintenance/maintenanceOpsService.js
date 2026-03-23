const Cabin = require('../../models/Cabin');
const Booking = require('../../models/Booking');
const AvailabilityBlock = require('../../models/AvailabilityBlock');
const CabinChannelSyncState = require('../../models/CabinChannelSyncState');
const { appendAuditEvent } = require('../auditWriter');
const { FIXTURE_CABIN_NAME_PATTERN, isFixtureCabinName } = require('../../utils/fixtureExclusion');
const {
  findStaleReservationBlockRows,
  runIntegrityPreviews
} = require('./maintenanceIntegrityPreviews');

const FIXTURE_BOOKING_EMAIL_RE = /^(sync-overlap-|batch4-|smoke-)/i;

function assertReason(reason) {
  const r = reason != null ? String(reason).trim() : '';
  if (r.length < 8) {
    const err = new Error('reason must be at least 8 characters');
    err.code = 'VALIDATION';
    err.status = 400;
    throw err;
  }
  return r;
}

function isFixtureBookingEmail(email) {
  return FIXTURE_BOOKING_EMAIL_RE.test(String(email || ''));
}

function isFixtureBookingDoc(booking) {
  if (!booking) return false;
  if (booking.isTest === true) return true;
  return isFixtureBookingEmail(booking.guestInfo?.email);
}

function ctxActor(ctx) {
  return {
    actorId: ctx.user?.id || 'admin',
    actorType: 'user',
    role: ctx.user?.role || 'admin'
  };
}

async function auditMaintenance(
  {
    req,
    action,
    entityType,
    entityId,
    beforeSnapshot,
    afterSnapshot,
    reason,
    metadata = {},
    route
  },
  ctx
) {
  const actor = ctxActor(ctx);
  await appendAuditEvent(
    {
      actorType: actor.actorType,
      actorId: actor.actorId,
      actorRole: actor.role,
      entityType,
      entityId: String(entityId),
      action,
      beforeSnapshot: beforeSnapshot ?? null,
      afterSnapshot: afterSnapshot ?? null,
      reason: reason || null,
      metadata,
      sourceContext: {
        route: route || null,
        namespace: 'maintenance'
      }
    },
    { req: req || ctx.req }
  );
}

function previewFixtureContamination() {
  const cabinQuery = { name: { $regex: FIXTURE_CABIN_NAME_PATTERN } };
  const bookingQuery = {
    $or: [{ 'guestInfo.email': { $regex: FIXTURE_BOOKING_EMAIL_RE } }, { isTest: true }]
  };
  return Promise.all([
    Cabin.find(cabinQuery).select('_id name isActive archivedAt').lean(),
    Booking.find(bookingQuery).select('_id cabinId status guestInfo.email isTest archivedAt').lean()
  ]).then(([fixtureCabins, fixtureBookings]) => ({
    fixtureCabins: fixtureCabins.map((c) => ({
      id: String(c._id),
      name: c.name,
      isActive: c.isActive,
      archivedAt: c.archivedAt || null
    })),
    fixtureBookings: fixtureBookings.map((b) => ({
      id: String(b._id),
      email: b.guestInfo?.email,
      status: b.status,
      cabinId: b.cabinId ? String(b.cabinId) : null,
      isTest: !!b.isTest,
      archivedAt: b.archivedAt || null
    }))
  }));
}

async function applyFixtureContaminationArchive(reason, ctx) {
  const r = assertReason(reason);
  const [fixtureCabins, fixtureBookings] = await Promise.all([
    Cabin.find({ name: { $regex: FIXTURE_CABIN_NAME_PATTERN } }).select('_id name isActive').lean(),
    Booking.find({
      $or: [{ 'guestInfo.email': { $regex: FIXTURE_BOOKING_EMAIL_RE } }, { isTest: true }]
    })
      .select('_id status')
      .lean()
  ]);

  const cabinIds = fixtureCabins.map((c) => c._id);
  const bookingIds = fixtureBookings.map((b) => b._id);

  const beforeSnapshot = {
    fixtureCabins: fixtureCabins.map((c) => ({ id: String(c._id), name: c.name })),
    fixtureBookings: fixtureBookings.map((b) => ({ id: String(b._id), status: b.status }))
  };

  await auditMaintenance(
    {
      req: ctx.req,
      action: 'maintenance_fixture_contamination_archive',
      entityType: 'MaintenanceBatch',
      entityId: 'fixture-contamination',
      beforeSnapshot,
      afterSnapshot: {
        cabinIds: cabinIds.map(String),
        bookingIds: bookingIds.map(String),
        cabinAction: 'deactivate_and_archive',
        bookingAction: 'cancel_and_flag_test'
      },
      reason: r,
      route: ctx.route || 'POST /api/maintenance/cleanup/fixture-contamination'
    },
    ctx
  );

  const now = new Date();
  if (cabinIds.length) {
    await Cabin.updateMany(
      { _id: { $in: cabinIds } },
      {
        $set: {
          isActive: false,
          archivedAt: now,
          archivedReason: r
        }
      }
    );
    await AvailabilityBlock.deleteMany({ cabinId: { $in: cabinIds } });
    await CabinChannelSyncState.deleteMany({ cabinId: { $in: cabinIds } });
  }

  if (bookingIds.length) {
    await Booking.updateMany(
      { _id: { $in: bookingIds } },
      {
        $set: {
          status: 'cancelled',
          isTest: true,
          archivedAt: now,
          archivedReason: r
        }
      }
    );
  }

  return {
    deactivatedCabins: cabinIds.length,
    cancelledOrArchivedBookings: bookingIds.length
  };
}

async function applyTombstoneStaleReservationBlocks(reason, ctx) {
  const r = assertReason(reason);
  const stale = await findStaleReservationBlockRows();

  if (stale.length === 0) {
    return { modified: 0, matched: 0 };
  }

  const beforeSnapshot = {
    count: stale.length,
    sample: stale.slice(0, 15).map((row) => ({
      blockId: String(row._id),
      reservationId: String(row.reservationId),
      bookingStatus: row.bookingStatus
    }))
  };

  await auditMaintenance(
    {
      req: ctx.req,
      action: 'maintenance_stale_reservation_blocks_tombstone',
      entityType: 'MaintenanceBatch',
      entityId: 'stale-reservation-blocks',
      beforeSnapshot,
      afterSnapshot: { count: stale.length },
      reason: r,
      route: ctx.route || 'POST /api/maintenance/cleanup/stale-reservation-blocks'
    },
    ctx
  );

  const ids = stale.map((row) => row._id);
  const now = new Date();
  const result = await AvailabilityBlock.updateMany(
    { _id: { $in: ids } },
    {
      $set: {
        status: 'tombstoned',
        tombstonedAt: now,
        tombstoneReason: 'integrity_cleanup_stale_reservation_block'
      }
    }
  );

  return {
    modified: result.modifiedCount || 0,
    matched: result.matchedCount || 0
  };
}

async function archiveCabin(cabinId, reason, ctx) {
  const r = assertReason(reason);
  const cabin = await Cabin.findById(cabinId);
  if (!cabin) {
    const err = new Error('Cabin not found');
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }

  const before = {
    archivedAt: cabin.archivedAt || null,
    isActive: cabin.isActive,
    name: cabin.name
  };

  await auditMaintenance(
    {
      req: ctx.req,
      action: 'maintenance_cabin_archive',
      entityType: 'Cabin',
      entityId: cabinId,
      beforeSnapshot: before,
      afterSnapshot: { archivedAt: new Date(), isActive: false },
      reason: r,
      route: ctx.route || 'POST /api/maintenance/cabins/:id/archive'
    },
    ctx
  );

  const now = new Date();
  cabin.archivedAt = now;
  cabin.archivedReason = r;
  cabin.isActive = false;
  await cabin.save({ validateBeforeSave: false });

  return { cabinId: String(cabin._id), archivedAt: now };
}

async function deleteFixtureCabin(cabinId, reason, ctx) {
  const r = assertReason(reason);
  const cabin = await Cabin.findById(cabinId);
  if (!cabin) {
    const err = new Error('Cabin not found');
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }
  if (!isFixtureCabinName(cabin.name)) {
    const err = new Error('Hard delete is only allowed for fixture-named cabins');
    err.code = 'FORBIDDEN_DELETE';
    err.status = 403;
    throw err;
  }

  const before = { name: cabin.name, id: String(cabin._id) };

  await auditMaintenance(
    {
      req: ctx.req,
      action: 'maintenance_cabin_delete_fixture',
      entityType: 'Cabin',
      entityId: cabinId,
      beforeSnapshot: before,
      afterSnapshot: { deleted: true },
      reason: r,
      route: ctx.route || 'POST /api/maintenance/cabins/:id/delete-fixture'
    },
    ctx
  );

  const cid = cabin._id;
  await AvailabilityBlock.deleteMany({ cabinId: cid });
  await CabinChannelSyncState.deleteMany({ cabinId: cid });
  await Cabin.deleteOne({ _id: cid });

  return { cabinId: String(cid), deleted: true };
}

async function archiveReservation(bookingId, reason, ctx) {
  const r = assertReason(reason);
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    const err = new Error('Reservation not found');
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }

  const before = {
    status: booking.status,
    archivedAt: booking.archivedAt || null,
    isTest: booking.isTest
  };

  await auditMaintenance(
    {
      req: ctx.req,
      action: 'maintenance_reservation_archive',
      entityType: 'Reservation',
      entityId: bookingId,
      beforeSnapshot: before,
      afterSnapshot: { status: 'cancelled', archivedAt: new Date() },
      reason: r,
      route: ctx.route || 'POST /api/maintenance/reservations/:id/archive'
    },
    ctx
  );

  const now = new Date();
  booking.status = 'cancelled';
  booking.archivedAt = now;
  booking.archivedReason = r;
  await booking.save({ validateBeforeSave: false });

  await AvailabilityBlock.updateMany(
    { reservationId: booking._id, blockType: 'reservation', status: 'active' },
    {
      $set: {
        status: 'tombstoned',
        tombstonedAt: now,
        tombstoneReason: 'reservation_archived_maintenance'
      }
    }
  );

  return { reservationId: String(booking._id), archivedAt: now };
}

async function deleteFixtureReservation(bookingId, reason, ctx) {
  const r = assertReason(reason);
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    const err = new Error('Reservation not found');
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }
  if (!isFixtureBookingDoc(booking)) {
    const err = new Error('Hard delete is only allowed for fixture/test reservations');
    err.code = 'FORBIDDEN_DELETE';
    err.status = 403;
    throw err;
  }

  const before = {
    id: String(booking._id),
    status: booking.status,
    email: booking.guestInfo?.email,
    isTest: booking.isTest
  };

  await auditMaintenance(
    {
      req: ctx.req,
      action: 'maintenance_reservation_delete_fixture',
      entityType: 'Reservation',
      entityId: bookingId,
      beforeSnapshot: before,
      afterSnapshot: { deleted: true },
      reason: r,
      route: ctx.route || 'POST /api/maintenance/reservations/:id/delete-fixture'
    },
    ctx
  );

  const bid = booking._id;
  await AvailabilityBlock.deleteMany({ reservationId: bid });
  await Booking.deleteOne({ _id: bid });

  return { reservationId: String(bid), deleted: true };
}

async function listMaintenanceCabins({ page = 1, limit = 20, includeFixtures = false, includeArchived = false, q = '' }) {
  const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const and = [];
  if (!includeFixtures) {
    and.push({ name: { $not: FIXTURE_CABIN_NAME_PATTERN } });
  }
  if (!includeArchived) {
    and.push({ $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }] });
  }
  if (q) {
    const rx = escapeRegex(q);
    and.push({
      $or: [{ name: { $regex: rx, $options: 'i' } }, { location: { $regex: rx, $options: 'i' } }]
    });
  }

  const filter = and.length === 0 ? {} : and.length === 1 ? and[0] : { $and: and };
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const [items, total] = await Promise.all([
    Cabin.find(filter).sort({ name: 1 }).skip(skip).limit(limitNum).lean(),
    Cabin.countDocuments(filter)
  ]);

  return {
    items: items.map((c) => ({
      id: String(c._id),
      name: c.name,
      location: c.location,
      isActive: c.isActive !== false,
      archivedAt: c.archivedAt || null,
      archivedReason: c.archivedReason || null,
      isFixtureName: isFixtureCabinName(c.name)
    })),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum) || 1
    },
    filters: { includeFixtures, includeArchived }
  };
}

async function listMaintenanceReservations({
  page = 1,
  limit = 20,
  includeFixtures = false,
  includeArchived = false,
  q = ''
}) {
  const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const and = [];

  if (!includeFixtures) {
    and.push({ isTest: { $ne: true } });
    and.push({ 'guestInfo.email': { $not: FIXTURE_BOOKING_EMAIL_RE } });
  }
  if (!includeArchived) {
    and.push({ $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }] });
  }
  if (q) {
    const rx = escapeRegex(q);
    and.push({
      $or: [
        { 'guestInfo.firstName': { $regex: rx, $options: 'i' } },
        { 'guestInfo.lastName': { $regex: rx, $options: 'i' } },
        { 'guestInfo.email': { $regex: rx, $options: 'i' } }
      ]
    });
  }

  const filter = and.length === 0 ? {} : and.length === 1 ? and[0] : { $and: and };
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const [items, total] = await Promise.all([
    Booking.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate('cabinId', 'name')
      .lean(),
    Booking.countDocuments(filter)
  ]);

  return {
    items: items.map((b) => ({
      id: String(b._id),
      status: b.status,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      guest: b.guestInfo,
      cabinName: b.cabinId?.name || null,
      isTest: !!b.isTest,
      archivedAt: b.archivedAt || null,
      archivedReason: b.archivedReason || null,
      isFixtureEmail: isFixtureBookingEmail(b.guestInfo?.email)
    })),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum) || 1
    },
    filters: { includeFixtures, includeArchived }
  };
}

module.exports = {
  previewFixtureContamination,
  applyFixtureContaminationArchive,
  applyTombstoneStaleReservationBlocks,
  runIntegrityPreviews,
  findStaleReservationBlockRows,
  archiveCabin,
  deleteFixtureCabin,
  archiveReservation,
  deleteFixtureReservation,
  listMaintenanceCabins,
  listMaintenanceReservations,
  isFixtureCabinName,
  isFixtureBookingDoc
};
