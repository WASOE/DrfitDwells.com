const mongoose = require('mongoose');
const moment = require('moment-timezone');
const Booking = require('../../models/Booking');
const AvailabilityBlock = require('../../models/AvailabilityBlock');
const Unit = require('../../models/Unit');
const { findParentCabinForCabinType } = require('../publicAvailabilityService');
const { normalizeExclusiveDateRange, PROPERTY_TIMEZONE } = require('../../utils/dateTime');
const { BLOCKING_BOOKING_STATUSES } = require('./blockingStatusConstants');
const { isPublicIcsStrictEligibility } = require('../../config/publicIcsConfig');
const { loadPaidOrPartialReservationIdSet, isBookingEligibleForPublicIcs } = require('./icsBlockingEligibility');
const { availabilityBlockUnitScopeClause } = require('./unitCalendarShared');

/**
 * Legacy unit.blockedDates → exclusive-end spans (merged consecutive Sofia days).
 * @param {Date[]} blockedDates
 * @returns {Array<{ startDateInclusive: Date, endDateExclusive: Date }>}
 */
function unitBlockedDatesToExclusiveSpans(blockedDates) {
  const arr = Array.isArray(blockedDates) ? blockedDates : [];
  const dayKeys = [
    ...new Set(arr.map((d) => moment.tz(d, PROPERTY_TIMEZONE).format('YYYY-MM-DD')))
  ].sort();
  if (dayKeys.length === 0) return [];

  const spans = [];
  let runStartYmd = dayKeys[0];
  let runEndExclusiveYmd = moment
    .tz(dayKeys[0], PROPERTY_TIMEZONE)
    .add(1, 'day')
    .format('YYYY-MM-DD');

  for (let i = 1; i < dayKeys.length; i += 1) {
    const k = dayKeys[i];
    if (k === runEndExclusiveYmd) {
      runEndExclusiveYmd = moment.tz(k, PROPERTY_TIMEZONE).add(1, 'day').format('YYYY-MM-DD');
    } else {
      spans.push({
        startDateInclusive: moment.tz(runStartYmd, PROPERTY_TIMEZONE).startOf('day').toDate(),
        endDateExclusive: moment.tz(runEndExclusiveYmd, PROPERTY_TIMEZONE).startOf('day').toDate()
      });
      runStartYmd = k;
      runEndExclusiveYmd = moment.tz(k, PROPERTY_TIMEZONE).add(1, 'day').format('YYYY-MM-DD');
    }
  }
  spans.push({
    startDateInclusive: moment.tz(runStartYmd, PROPERTY_TIMEZONE).startOf('day').toDate(),
    endDateExclusive: moment.tz(runEndExclusiveYmd, PROPERTY_TIMEZONE).startOf('day').toDate()
  });
  return spans;
}

/**
 * Outbound Airbnb ICS for one physical unit only (not pooled). See product spec; never includes external_hold.
 *
 * @param {mongoose.Types.ObjectId|string} unitId
 * @param {{ strictIcsEligibility?: boolean }} [options]
 * @returns {Promise<Array<{ kind: string, sourceId: string, startDateInclusive: Date, endDateExclusive: Date, dtstamp: Date, lastModified?: Date }>>}
 */
async function selectBlockingSpansForUnit(unitId, options = {}) {
  const unitOid = typeof unitId === 'string' ? new mongoose.Types.ObjectId(unitId) : unitId;
  const strictIcs =
    typeof options.strictIcsEligibility === 'boolean' ? options.strictIcsEligibility : isPublicIcsStrictEligibility();

  const unit = await Unit.findById(unitOid).lean();
  if (!unit || unit.isActive === false) {
    return [];
  }

  const cabinTypeOid = unit.cabinTypeId;
  const parentCabin = await findParentCabinForCabinType(cabinTypeOid);
  if (!parentCabin) {
    return [];
  }

  const unitScope = availabilityBlockUnitScopeClause(unitOid);

  const [bookings, rawBlocks] = await Promise.all([
    Booking.find({
      cabinTypeId: cabinTypeOid,
      unitId: unitOid,
      status: { $in: BLOCKING_BOOKING_STATUSES }
    })
      .select('checkIn checkOut createdAt updatedAt status isProductionSafe isTest provenance')
      .lean(),
    AvailabilityBlock.find({
      cabinId: parentCabin._id,
      status: 'active',
      blockType: { $in: ['manual_block', 'maintenance', 'reservation'] },
      ...unitScope
    })
      .select('startDate endDate createdAt updatedAt blockType reservationId')
      .lean()
  ]);

  const allBlockingIds = bookings.map((b) => String(b._id));
  const paidSet =
    allBlockingIds.length > 0 ? await loadPaidOrPartialReservationIdSet(allBlockingIds) : new Set();

  const exportedEligibleBookingIds = new Set();
  const spans = [];

  for (const b of bookings) {
    if (!isBookingEligibleForPublicIcs(b, paidSet, strictIcs)) {
      continue;
    }
    try {
      const { startDate, endDate } = normalizeExclusiveDateRange(b.checkIn, b.checkOut);
      const lm = b.updatedAt || b.createdAt;
      exportedEligibleBookingIds.add(String(b._id));
      spans.push({
        kind: 'booking',
        sourceId: String(b._id),
        startDateInclusive: startDate,
        endDateExclusive: endDate,
        dtstamp: lm || new Date(0),
        lastModified: lm || undefined
      });
    } catch {
      // Skip invalid legacy rows
    }
  }

  for (const blk of rawBlocks) {
    if (blk.blockType === 'reservation') {
      const rid = blk.reservationId ? String(blk.reservationId) : null;
      if (rid && exportedEligibleBookingIds.has(rid)) {
        continue;
      }
    }
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

  unitBlockedDatesToExclusiveSpans(unit.blockedDates).forEach((bd, idx) => {
    spans.push({
      kind: 'unit_blocked_dates',
      sourceId: `${unitOid.toString()}-bd-${idx}`,
      startDateInclusive: bd.startDateInclusive,
      endDateExclusive: bd.endDateExclusive,
      dtstamp: unit.updatedAt || unit.createdAt || new Date(0),
      lastModified: unit.updatedAt || undefined
    });
  });

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
  selectBlockingSpansForUnit,
  unitBlockedDatesToExclusiveSpans
};
