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
 *
 * B8F1B/B8F4A: checkout-owned AND booking-owned UnitNightClaims remove physical
 * units from the free set (booking-owned claims block even before Booking exists).
 */

const Unit = require('../../models/Unit');
const Booking = require('../../models/Booking');
const { normalizeExclusiveDateRange } = require('../../utils/dateTime');
const { BLOCKING_BOOKING_STATUSES } = require('../calendar/blockingStatusConstants');
const {
  listBlockingUnitCheckoutClaims,
  listBlockingUnitBookingOwnedClaims
} = require('./checkoutNightClaimVisibility');

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
  excludeUnitId = null,
  excludeCheckoutId = null,
  excludeLeaseId = null,
  now = null
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

  if (unitIdSet.size > 0) {
    const [checkoutBlocking, bookingOwnedBlocking] = await Promise.all([
      listBlockingUnitCheckoutClaims({
        unitIds: [...unitIdSet],
        startDate: normalized.startDate,
        endDate: normalized.endDate,
        now,
        excludeCheckoutId,
        excludeLeaseId
      }),
      listBlockingUnitBookingOwnedClaims({
        unitIds: [...unitIdSet],
        startDate: normalized.startDate,
        endDate: normalized.endDate,
        excludeBookingId
      })
    ]);
    for (const row of checkoutBlocking) {
      if (row.resourceId && unitIdSet.has(row.resourceId)) {
        allocatedUnitIds.add(row.resourceId);
      }
    }
    for (const row of bookingOwnedBlocking) {
      if (row.resourceId && unitIdSet.has(row.resourceId)) {
        allocatedUnitIds.add(row.resourceId);
      }
    }
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
  excludeBookingId = null,
  excludeCheckoutId = null,
  excludeLeaseId = null,
  now = null
} = {}) {
  const capacity = await evaluateCabinTypeCommercialCapacity({
    cabinTypeId,
    checkIn,
    checkOut,
    excludeBookingId,
    excludeCheckoutId,
    excludeLeaseId,
    now
  });
  if (capacity.commerciallyAvailableSlots <= 0) return false;
  return capacity.freePhysicalUnitIds.includes(String(unitId));
}

module.exports = {
  evaluateCabinTypeCommercialCapacity,
  isUnitCommerciallyAssignable
};
