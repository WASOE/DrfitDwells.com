'use strict';

/**
 * Canonical cabinType commercial capacity (I6).
 *
 * PHYSICAL exclusivity = UnitNightClaim
 * COMMERCIAL capacity = ALL overlapping blocking Bookings for the cabinType
 *   (allocated unitId set AND unallocated unitId null)
 *
 * Unallocated bookings consume anonymous slots against free physical units.
 * Binding: docs/stay-change-implementation-plan.md — I6 pooled capacity.
 */

const Unit = require('../../models/Unit');
const Booking = require('../../models/Booking');
const { normalizeExclusiveDateRange } = require('../../utils/dateTime');
const { BLOCKING_BOOKING_STATUSES } = require('../calendar/blockingStatusConstants');

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

/**
 * @returns {Promise<{
 *   totalUnits: number,
 *   freePhysicalUnitIds: string[],
 *   allocatedUnitIds: string[],
 *   unallocatedCount: number,
 *   commerciallyAvailableSlots: number,
 *   commerciallyFull: boolean
 * }>}
 */
async function evaluateCabinTypeCommercialCapacity({
  cabinTypeId,
  checkIn,
  checkOut,
  excludeBookingId = null,
  excludeUnitId = null
} = {}) {
  if (!cabinTypeId) {
    throw new Error('cabinTypeId is required');
  }
  const normalized = normalizeExclusiveDateRange(checkIn, checkOut);

  const units = await Unit.find({
    cabinTypeId,
    isActive: true
  })
    .select('_id')
    .lean();

  const unitIdSet = new Set(units.map((u) => String(u._id)));
  const totalUnits = units.length;

  const bookingFilter = {
    cabinTypeId,
    status: { $in: BLOCKING_BOOKING_STATUSES },
    isTest: { $ne: true },
    $and: [{ $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }] }],
    checkIn: { $lt: normalized.endDate },
    checkOut: { $gt: normalized.startDate }
  };
  if (excludeBookingId) {
    bookingFilter._id = { $ne: excludeBookingId };
  }

  const bookings = await Booking.find(bookingFilter)
    .select('_id unitId checkIn checkOut')
    .lean();

  const allocatedUnitIds = new Set();
  let unallocatedCount = 0;

  for (const b of bookings) {
    if (!rangesOverlap(b.checkIn, b.checkOut, normalized.startDate, normalized.endDate)) {
      continue;
    }
    if (b.unitId) {
      const uid = String(b.unitId);
      if (unitIdSet.has(uid)) {
        allocatedUnitIds.add(uid);
      }
    } else {
      unallocatedCount += 1;
    }
  }

  if (excludeUnitId) {
    allocatedUnitIds.add(String(excludeUnitId));
  }

  const freePhysicalUnitIds = [...unitIdSet].filter((id) => !allocatedUnitIds.has(id));
  const commerciallyAvailableSlots = Math.max(0, freePhysicalUnitIds.length - unallocatedCount);

  return {
    totalUnits,
    freePhysicalUnitIds,
    allocatedUnitIds: [...allocatedUnitIds],
    unallocatedCount,
    commerciallyAvailableSlots,
    commerciallyFull: commerciallyAvailableSlots <= 0 && totalUnits > 0
  };
}

/**
 * Whether a specific physically free unit may be commercially assigned.
 */
async function isUnitCommerciallyAssignable({
  unitId,
  cabinTypeId,
  checkIn,
  checkOut,
  excludeBookingId = null
} = {}) {
  const capacity = await evaluateCabinTypeCommercialCapacity({
    cabinTypeId,
    checkIn,
    checkOut,
    excludeBookingId
  });
  if (capacity.commerciallyAvailableSlots <= 0) return false;
  return capacity.freePhysicalUnitIds.includes(String(unitId));
}

module.exports = {
  evaluateCabinTypeCommercialCapacity,
  isUnitCommerciallyAssignable
};
