const Booking = require('../../../models/Booking');
const AvailabilityBlock = require('../../../models/AvailabilityBlock');
const { normalizeExclusiveDateRange } = require('../../../utils/dateTime');

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

async function evaluateCabinConflicts({ cabinId, startDate, endDate, excludeReservationId = null }) {
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
    AvailabilityBlock.find(blockFilter).select('_id blockType startDate endDate status').lean()
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

  return {
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    hardConflicts,
    warnings,
    hasHardConflicts: hardConflicts.length > 0
  };
}

module.exports = {
  evaluateCabinConflicts
};
