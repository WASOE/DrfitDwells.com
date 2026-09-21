const moment = require('moment-timezone');
const Booking = require('../../../models/Booking');
const AvailabilityBlock = require('../../../models/AvailabilityBlock');
const Cabin = require('../../../models/Cabin');
const Unit = require('../../../models/Unit');
const { normalizeExclusiveDateRange } = require('../../../utils/dateTime');
const { availabilityBlockUnitScopeClause } = require('../../calendar/unitCalendarShared');
const { BLOCKING_BOOKING_STATUSES } = require('../../calendar/blockingStatusConstants');
const { listBlockingCheckoutClaimConflicts } = require('../../inventory/checkoutNightClaimVisibility');
const { createDomainError } = require('./errors');

const HARD_BLOCK_TYPES = ['manual_block', 'maintenance', 'reservation', 'external_hold', 'checkout_hold'];

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function legacyBlockedDatesOverlap(blockedDates, startDate, endDate) {
  const arr = Array.isArray(blockedDates) ? blockedDates : [];
  return arr.some((blockedDate) => {
    const blocked = moment(blockedDate).startOf('day').toDate();
    return blocked >= startDate && blocked < endDate;
  });
}

function guestLabelFromBooking(booking) {
  const g = booking?.guestInfo || {};
  const first = String(g.firstName || '').trim();
  const last = String(g.lastName || '').trim();
  if (last) return `${first ? `${first[0]}. ` : ''}${last}`.trim();
  return first || null;
}

/**
 * Canonical multi-parent predicate — mirrors locationInventoryService
 * (`inventoryType: { $ne: 'multi' }` for single cabins).
 */
function isMultiInventoryParentCabin(cabin) {
  return Boolean(cabin && cabin.inventoryType === 'multi');
}

/**
 * Resolve which Unit / Cabin checkout-claim resources apply for an OPS target.
 * Multi parents expand via CabinType (cabinTypeId or cabinTypeRef).
 * Single-inventory cabins always use CabinNightClaim for the exact cabinId,
 * even when a stale cabinTypeId/cabinTypeRef is present.
 */
async function resolveCheckoutClaimResources({ cabinId = null, unitId = null, cabinTypeId = null }) {
  if (unitId) {
    return { unitIds: [unitId], cabinIds: [] };
  }

  let cabin = null;
  if (cabinId) {
    cabin = await Cabin.findById(cabinId).select('cabinTypeId cabinTypeRef inventoryType').lean();
  }

  if (isMultiInventoryParentCabin(cabin)) {
    const typeId = cabinTypeId || cabin.cabinTypeId || cabin.cabinTypeRef || null;
    if (!typeId) {
      throw createDomainError(
        'validation',
        'Multi-inventory parent cabin cannot resolve CabinType for checkout-claim conflict scope',
        {
          cabinId: String(cabinId),
          inventoryType: cabin.inventoryType,
          cabinTypeId: cabin.cabinTypeId ? String(cabin.cabinTypeId) : null,
          cabinTypeRef: cabin.cabinTypeRef ? String(cabin.cabinTypeRef) : null
        },
        422
      );
    }
    const units = await Unit.find({ cabinTypeId: typeId, isActive: { $ne: false } })
      .select('_id')
      .lean();
    if (units.length === 0) {
      throw createDomainError(
        'validation',
        'Multi-inventory parent cabin has no active Units for checkout-claim conflict scope',
        {
          cabinId: String(cabinId),
          cabinTypeId: String(typeId),
          inventoryType: cabin.inventoryType
        },
        422
      );
    }
    return { unitIds: units.map((u) => u._id), cabinIds: [] };
  }

  // Single-inventory (inventoryType !== 'multi'): exact Cabin only.
  // Stale cabinTypeId / cabinTypeRef must not expand to Units.
  if (cabinId) {
    return { unitIds: [], cabinIds: [cabinId] };
  }

  return { unitIds: [], cabinIds: [] };
}

async function appendCheckoutClaimHardConflicts(hardConflicts, {
  cabinId = null,
  unitId = null,
  cabinTypeId = null,
  startDate,
  endDate,
  now = null,
  excludeCheckoutId = null,
  excludeLeaseId = null
}) {
  const { unitIds, cabinIds } = await resolveCheckoutClaimResources({
    cabinId,
    unitId,
    cabinTypeId
  });
  if (unitIds.length === 0 && cabinIds.length === 0) return;

  const claimConflicts = await listBlockingCheckoutClaimConflicts({
    unitIds,
    cabinIds,
    startDate,
    endDate,
    now,
    excludeCheckoutId,
    excludeLeaseId
  });
  for (const entry of claimConflicts) {
    hardConflicts.push(entry);
  }
}

/**
 * Per-inventory-target conflict evaluation for location-wide blocks.
 * Supports single cabins (cabinId only) and multi-unit targets (parent cabinId + unitId + cabinTypeId).
 *
 * @param {object} opts
 * @param {boolean} [opts.treatExternalHoldAsHard=false] — true for location-wide operations
 */
async function evaluateTargetConflicts({
  cabinId,
  unitId = null,
  cabinTypeId = null,
  startDate,
  endDate,
  treatExternalHoldAsHard = false,
  excludeCheckoutSessionId = null,
  excludeReservationId = null,
  excludeCheckoutId = null,
  excludeLeaseId = null,
  now = null
}) {
  const normalized = normalizeExclusiveDateRange(startDate, endDate);
  const hardConflicts = [];
  const warnings = [];

  const legacyTasks = [];
  if (unitId) {
    legacyTasks.push(
      Unit.findById(unitId).select('blockedDates cabinTypeId').lean().then((unit) => {
        if (!unit) return;
        if (legacyBlockedDatesOverlap(unit.blockedDates, normalized.startDate, normalized.endDate)) {
          hardConflicts.push({
            kind: 'legacy_blocked_date',
            targetType: 'unit',
            unitId: String(unitId)
          });
        }
      })
    );
  } else if (cabinId) {
    legacyTasks.push(
      Cabin.findById(cabinId).select('blockedDates').lean().then((cabin) => {
        if (!cabin) return;
        if (legacyBlockedDatesOverlap(cabin.blockedDates, normalized.startDate, normalized.endDate)) {
          hardConflicts.push({
            kind: 'legacy_blocked_date',
            targetType: 'cabin',
            cabinId: String(cabinId)
          });
        }
      })
    );
  }

  const bookingClauses = [];
  if (unitId && cabinTypeId) {
    bookingClauses.push({ unitId });
    bookingClauses.push({
      cabinTypeId,
      $or: [{ unitId: null }, { unitId: { $exists: false } }]
    });
  } else if (cabinId) {
    bookingClauses.push({ cabinId });
  }

  const bookingFilter = bookingClauses.length
    ? {
        $or: bookingClauses,
        status: { $in: BLOCKING_BOOKING_STATUSES },
        isTest: { $ne: true },
        $and: [{ $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }] }],
        checkIn: { $lt: normalized.endDate },
        checkOut: { $gt: normalized.startDate }
      }
    : null;
  if (bookingFilter && excludeReservationId) {
    bookingFilter._id = { $ne: excludeReservationId };
  }

  const blockFilter = {
    cabinId,
    status: 'active',
    blockType: { $in: HARD_BLOCK_TYPES },
    startDate: { $lt: normalized.endDate },
    endDate: { $gt: normalized.startDate }
  };
  if (unitId) {
    Object.assign(blockFilter, availabilityBlockUnitScopeClause(unitId));
  } else {
    blockFilter.$or = [{ unitId: null }, { unitId: { $exists: false } }];
  }

  await Promise.all(legacyTasks);

  const [bookings, blocks] = await Promise.all([
    bookingFilter ? Booking.find(bookingFilter).select('_id checkIn checkOut status unitId cabinTypeId guestInfo').lean() : [],
    AvailabilityBlock.find(blockFilter)
      .select('_id blockType startDate endDate unitId checkoutSessionId expiresAt reservationId')
      .lean()
  ]);

  for (const booking of bookings) {
    if (rangesOverlap(booking.checkIn, booking.checkOut, normalized.startDate, normalized.endDate)) {
      const isPooled = Boolean(cabinTypeId) && !booking.unitId;
      hardConflicts.push({
        kind: 'reservation',
        reservationId: String(booking._id),
        startDate: booking.checkIn,
        endDate: booking.checkOut,
        pooled: isPooled,
        unitId: booking.unitId ? String(booking.unitId) : null,
        guestLabel: guestLabelFromBooking(booking)
      });
    }
  }

  const clock = now || new Date();
  const excludedSession = excludeCheckoutSessionId ? String(excludeCheckoutSessionId).trim() : '';

  for (const block of blocks) {
    if (!rangesOverlap(block.startDate, block.endDate, normalized.startDate, normalized.endDate)) continue;

    // Self-exclusion: reservation-backed blocks for the reservation being edited
    // must not hard-conflict against that same reservation's date change.
    if (
      excludeReservationId &&
      block.reservationId &&
      String(block.reservationId) === String(excludeReservationId)
    ) {
      continue;
    }

    if (block.blockType === 'checkout_hold') {
      if (block.expiresAt && block.expiresAt <= clock) continue;
      if (excludedSession && String(block.checkoutSessionId || '') === excludedSession) continue;
    }

    const entry = {
      kind: 'availability_block',
      blockId: String(block._id),
      blockType: block.blockType,
      startDate: block.startDate,
      endDate: block.endDate,
      unitId: block.unitId ? String(block.unitId) : null,
      parentWide: !block.unitId
    };
    if (block.blockType === 'external_hold' && !treatExternalHoldAsHard) {
      warnings.push(entry);
    } else {
      hardConflicts.push(entry);
    }
  }

  await appendCheckoutClaimHardConflicts(hardConflicts, {
    cabinId,
    unitId,
    cabinTypeId,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    now: clock,
    excludeCheckoutId,
    excludeLeaseId
  });

  return {
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    hardConflicts,
    warnings,
    hasHardConflicts: hardConflicts.length > 0
  };
}

async function evaluateCabinConflicts({
  cabinId,
  startDate,
  endDate,
  excludeReservationId = null,
  excludeCheckoutId = null,
  excludeLeaseId = null,
  now = null
}) {
  const normalized = normalizeExclusiveDateRange(startDate, endDate);

  const bookingFilter = {
    cabinId,
    status: { $in: ['pending', 'confirmed', 'in_house'] },
    isTest: { $ne: true },
    $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }],
    checkIn: { $lt: normalized.endDate },
    checkOut: { $gt: normalized.startDate }
  };
  if (excludeReservationId) {
    bookingFilter._id = { $ne: excludeReservationId };
  }

  const blockFilter = {
    cabinId,
    status: 'active',
    startDate: { $lt: normalized.endDate },
    endDate: { $gt: normalized.startDate }
  };

  const [bookings, blocks] = await Promise.all([
    Booking.find(bookingFilter).select('_id checkIn checkOut status').lean(),
    AvailabilityBlock.find(blockFilter).select('_id blockType startDate endDate status reservationId').lean()
  ]);

  const hardConflicts = [];
  const warnings = [];

  for (const booking of bookings) {
    if (rangesOverlap(booking.checkIn, booking.checkOut, normalized.startDate, normalized.endDate)) {
      hardConflicts.push({
        kind: 'reservation',
        reservationId: String(booking._id),
        startDate: booking.checkIn,
        endDate: booking.checkOut
      });
    }
  }

  for (const block of blocks) {
    if (rangesOverlap(block.startDate, block.endDate, normalized.startDate, normalized.endDate)) {
      if (
        excludeReservationId &&
        block.reservationId &&
        String(block.reservationId) === String(excludeReservationId)
      ) {
        continue;
      }
      if (block.blockType === 'external_hold') {
        warnings.push({
          kind: 'availability_block',
          blockId: String(block._id),
          blockType: block.blockType,
          startDate: block.startDate,
          endDate: block.endDate
        });
      } else {
        hardConflicts.push({
          kind: 'availability_block',
          blockId: String(block._id),
          blockType: block.blockType,
          startDate: block.startDate,
          endDate: block.endDate
        });
      }
    }
  }

  await appendCheckoutClaimHardConflicts(hardConflicts, {
    cabinId,
    unitId: null,
    cabinTypeId: null,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    now: now || new Date(),
    excludeCheckoutId,
    excludeLeaseId
  });

  return {
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    hardConflicts,
    warnings,
    hasHardConflicts: hardConflicts.length > 0
  };
}

module.exports = {
  BLOCKING_BOOKING_STATUSES,
  HARD_BLOCK_TYPES,
  evaluateCabinConflicts,
  evaluateTargetConflicts,
  resolveCheckoutClaimResources,
  isMultiInventoryParentCabin
};
