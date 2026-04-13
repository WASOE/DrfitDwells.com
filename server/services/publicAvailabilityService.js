/**
 * Canonical guest-facing availability: internal bookings + AvailabilityBlock rows
 * (external_hold, manual_block, maintenance, reservation) with exclusive-end semantics
 * and Europe/Sofia day alignment via normalizeExclusiveDateRange.
 */
const AvailabilityBlock = require('../models/AvailabilityBlock');
const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const Unit = require('../models/Unit');
const { availabilityBlockUnitScopeClause } = require('./calendar/unitCalendarShared');
const { normalizeExclusiveDateRange } = require('../utils/dateTime');
const { BLOCKING_BOOKING_STATUSES } = require('./calendar/blockingStatusConstants');

const BLOCKING_BLOCK_TYPES = ['external_hold', 'manual_block', 'maintenance', 'reservation'];

function cabinLegacyBlockedDatesOverlap(blockedDates, startDate, endDate) {
  const moment = require('moment');
  const arr = Array.isArray(blockedDates) ? blockedDates : [];
  return arr.some((blockedDate) => {
    const blocked = moment(blockedDate).startOf('day').toDate();
    return blocked >= startDate && blocked < endDate;
  });
}

async function findParentCabinForCabinType(cabinTypeId) {
  return Cabin.findOne({
    isActive: true,
    $or: [{ cabinTypeId }, { cabinTypeRef: cabinTypeId }]
  })
    .select('_id')
    .lean();
}

async function countBlockingBlocksForSingleCabin(cabinId, startDate, endDate) {
  return AvailabilityBlock.countDocuments({
    cabinId,
    status: 'active',
    blockType: { $in: BLOCKING_BLOCK_TYPES },
    startDate: { $lt: endDate },
    endDate: { $gt: startDate },
    $or: [{ unitId: null }, { unitId: { $exists: false } }]
  });
}

async function countBlockingBlocksForUnit(parentCabinId, unitId, startDate, endDate) {
  return AvailabilityBlock.countDocuments({
    cabinId: parentCabinId,
    status: 'active',
    blockType: { $in: BLOCKING_BLOCK_TYPES },
    startDate: { $lt: endDate },
    endDate: { $gt: startDate },
    ...availabilityBlockUnitScopeClause(unitId)
  });
}

/**
 * @returns {{ startDate: Date, endDate: Date }}
 */
function normalizeGuestStayRange(checkInInput, checkOutInput) {
  return normalizeExclusiveDateRange(checkInInput, checkOutInput);
}

/**
 * Single-cabin (cabinId) guest stay: bookings + blocks + legacy cabin.blockedDates.
 */
async function isSingleCabinGuestStayAvailable(cabin, checkInInput, checkOutInput) {
  const { startDate, endDate } = normalizeGuestStayRange(checkInInput, checkOutInput);

  if (cabinLegacyBlockedDatesOverlap(cabin.blockedDates, startDate, endDate)) {
    return false;
  }

  const [bookingCount, blockCount] = await Promise.all([
    Booking.countDocuments({
      cabinId: cabin._id,
      status: { $in: BLOCKING_BOOKING_STATUSES },
      checkIn: { $lt: endDate },
      checkOut: { $gt: startDate }
    }),
    countBlockingBlocksForSingleCabin(cabin._id, startDate, endDate)
  ]);

  return bookingCount === 0 && blockCount === 0;
}

/**
 * Multi-unit: one physical unit. Blocks keyed by parent Cabin + optional unitId.
 * @param {object|null} parentCabinHint - from findParentCabinForCabinType (avoid N+1 in loops)
 */
async function isUnitGuestStayAvailable(unitId, cabinTypeId, checkInInput, checkOutInput, parentCabinHint = null) {
  const unit = await Unit.findById(unitId);
  if (!unit || !unit.isActive) return false;
  if (String(unit.cabinTypeId) !== String(cabinTypeId)) return false;

  const { startDate, endDate } = normalizeGuestStayRange(checkInInput, checkOutInput);

  const unitBlocked = Array.isArray(unit.blockedDates) ? unit.blockedDates : [];
  if (cabinLegacyBlockedDatesOverlap(unitBlocked, startDate, endDate)) {
    return false;
  }

  const parentCabin = parentCabinHint !== undefined ? parentCabinHint : await findParentCabinForCabinType(cabinTypeId);
  const blockPromise = parentCabin
    ? countBlockingBlocksForUnit(parentCabin._id, unit._id, startDate, endDate)
    : Promise.resolve(0);

  const [bookingCount, blockCount] = await Promise.all([
    Booking.countDocuments({
      unitId: unit._id,
      status: { $in: BLOCKING_BOOKING_STATUSES },
      checkIn: { $lt: endDate },
      checkOut: { $gt: startDate }
    }),
    blockPromise
  ]);

  return bookingCount === 0 && blockCount === 0;
}

async function assertSingleCabinGuestStayAvailableOrThrow(cabin, checkInInput, checkOutInput) {
  const ok = await isSingleCabinGuestStayAvailable(cabin, checkInInput, checkOutInput);
  if (!ok) {
    const err = new Error('NOT_AVAILABLE');
    err.code = 'NOT_AVAILABLE';
    err.status = 409;
    throw err;
  }
}

async function assertUnitGuestStayAvailableOrThrow(unitId, cabinTypeId, checkInInput, checkOutInput) {
  const ok = await isUnitGuestStayAvailable(unitId, cabinTypeId, checkInInput, checkOutInput);
  if (!ok) {
    const err = new Error('NOT_AVAILABLE');
    err.code = 'NOT_AVAILABLE';
    err.status = 409;
    throw err;
  }
}

module.exports = {
  BLOCKING_BLOCK_TYPES,
  normalizeGuestStayRange,
  findParentCabinForCabinType,
  isSingleCabinGuestStayAvailable,
  isUnitGuestStayAvailable,
  assertSingleCabinGuestStayAvailableOrThrow,
  assertUnitGuestStayAvailableOrThrow,
  countBlockingBlocksForSingleCabin,
  countBlockingBlocksForUnit
};
