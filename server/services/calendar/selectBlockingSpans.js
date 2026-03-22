const mongoose = require('mongoose');
const Booking = require('../../models/Booking');
const AvailabilityBlock = require('../../models/AvailabilityBlock');
const { normalizeExclusiveDateRange } = require('../../utils/dateTime');
const { BLOCKING_BOOKING_STATUSES } = require('./blockingStatusConstants');
const { isPublicIcsStrictEligibility } = require('../../config/publicIcsConfig');
const { loadPaidOrPartialReservationIdSet, isBookingEligibleForPublicIcs } = require('./icsBlockingEligibility');

/**
 * Load blocking date spans for a single-cabin property (source truth only).
 * - Guest stays: Booking rows (not cancelled/completed).
 * - Ops blocks: AvailabilityBlock manual_block + maintenance (active, no unit).
 * - Excludes external_hold and reservation-backed blocks (stays come from Booking only).
 *
 * @param {mongoose.Types.ObjectId|string} cabinId
 * @param {{ strictIcsEligibility?: boolean }} [options] strictIcsEligibility defaults from env (production => strict pending requires paid/partial Payment)
 * @returns {Promise<Array<{ kind: string, sourceId: string, startDateInclusive: Date, endDateExclusive: Date, dtstamp: Date, lastModified?: Date }>>}
 */
async function selectBlockingSpansForSingleCabin(cabinId, options = {}) {
  const oid = typeof cabinId === 'string' ? new mongoose.Types.ObjectId(cabinId) : cabinId;
  const strictIcs =
    typeof options.strictIcsEligibility === 'boolean' ? options.strictIcsEligibility : isPublicIcsStrictEligibility();

  const [bookings, blocks] = await Promise.all([
    Booking.find({
      cabinId: oid,
      $or: [{ cabinTypeId: null }, { cabinTypeId: { $exists: false } }],
      status: { $in: BLOCKING_BOOKING_STATUSES }
    })
      .select('checkIn checkOut createdAt updatedAt status isProductionSafe isTest provenance')
      .lean(),
    AvailabilityBlock.find({
      cabinId: oid,
      status: 'active',
      blockType: { $in: ['manual_block', 'maintenance'] },
      $or: [{ unitId: null }, { unitId: { $exists: false } }]
    })
      .select('startDate endDate createdAt updatedAt')
      .lean()
  ]);

  const allBlockingIds = bookings.map((b) => String(b._id));
  const paidSet =
    allBlockingIds.length > 0 ? await loadPaidOrPartialReservationIdSet(allBlockingIds) : new Set();

  const spans = [];

  for (const b of bookings) {
    if (!isBookingEligibleForPublicIcs(b, paidSet, strictIcs)) {
      continue;
    }
    try {
      const { startDate, endDate } = normalizeExclusiveDateRange(b.checkIn, b.checkOut);
      const lm = b.updatedAt || b.createdAt;
      spans.push({
        kind: 'booking',
        sourceId: String(b._id),
        startDateInclusive: startDate,
        endDateExclusive: endDate,
        dtstamp: lm || new Date(0),
        lastModified: lm || undefined
      });
    } catch {
      // Skip invalid legacy rows rather than failing the whole feed
    }
  }

  for (const blk of blocks) {
    try {
      const { startDate, endDate } = normalizeExclusiveDateRange(blk.startDate, blk.endDate);
      const lm = blk.updatedAt || blk.createdAt;
      spans.push({
        kind: 'availability_block',
        sourceId: String(blk._id),
        startDateInclusive: startDate,
        endDateExclusive: endDate,
        dtstamp: lm || new Date(0),
        lastModified: lm || undefined
      });
    } catch {
      // Skip invalid blocks
    }
  }

  spans.sort((a, b) => {
    const as = a.startDateInclusive.getTime();
    const bs = b.startDateInclusive.getTime();
    if (as !== bs) return as - bs;
    const ae = a.endDateExclusive.getTime();
    const be = b.endDateExclusive.getTime();
    if (ae !== be) return ae - be;
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.sourceId.localeCompare(b.sourceId);
  });

  return spans;
}

module.exports = {
  selectBlockingSpansForSingleCabin,
  BLOCKING_BOOKING_STATUSES
};
