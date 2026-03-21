const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const Unit = require('../models/Unit');
const { normalizeExclusiveDateRange, normalizeDateToSofiaDayStart } = require('../utils/dateTime');

function addOneDay(date) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

async function resolveBookingCabinId(booking, cabinTypeToCabinMap) {
  if (booking.cabinId) return String(booking.cabinId);
  if (booking.cabinTypeId) {
    const mapped = cabinTypeToCabinMap.get(String(booking.cabinTypeId));
    return mapped ? String(mapped) : null;
  }
  return null;
}

async function runAvailabilityBackfillDryRun() {
  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      bookingBlocks: 0,
      blockedDateBlocks: 0,
      unitBlockedDateBlocks: 0,
      totalCandidates: 0,
      unresolvedBookingCabinIds: 0
    },
    issues: [],
    samples: {
      bookingBlocks: [],
      blockedDateBlocks: []
    }
  };

  const cabins = await Cabin.find({}).select('_id cabinTypeRef blockedDates').lean();
  const units = await Unit.find({}).select('_id cabinTypeId blockedDates').lean();
  const bookings = await Booking.find({}).select('_id cabinId cabinTypeId unitId checkIn checkOut status').lean();

  const cabinTypeToCabinMap = new Map();
  for (const cabin of cabins) {
    if (cabin.cabinTypeRef) {
      cabinTypeToCabinMap.set(String(cabin.cabinTypeRef), String(cabin._id));
    }
  }

  for (const booking of bookings) {
    if (!booking.checkIn || !booking.checkOut) {
      report.issues.push({
        type: 'booking_missing_dates',
        bookingId: String(booking._id)
      });
      continue;
    }

    const cabinId = await resolveBookingCabinId(booking, cabinTypeToCabinMap);
    if (!cabinId) {
      report.summary.unresolvedBookingCabinIds += 1;
      report.issues.push({
        type: 'booking_missing_cabin_mapping',
        bookingId: String(booking._id),
        cabinId: booking.cabinId ? String(booking.cabinId) : null,
        cabinTypeId: booking.cabinTypeId ? String(booking.cabinTypeId) : null
      });
      continue;
    }

    try {
      const { startDate, endDate } = normalizeExclusiveDateRange(booking.checkIn, booking.checkOut);
      const candidate = {
        blockType: 'reservation',
        source: 'internal',
        sourceReference: String(booking._id),
        reservationId: String(booking._id),
        cabinId,
        unitId: booking.unitId ? String(booking.unitId) : null,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        metadata: { bookingStatus: booking.status || null }
      };
      report.summary.bookingBlocks += 1;
      if (report.samples.bookingBlocks.length < 25) {
        report.samples.bookingBlocks.push(candidate);
      }
    } catch (err) {
      report.issues.push({
        type: 'booking_invalid_range',
        bookingId: String(booking._id),
        error: err.message
      });
    }
  }

  for (const cabin of cabins) {
    const blockedDates = Array.isArray(cabin.blockedDates) ? cabin.blockedDates : [];
    for (const rawDate of blockedDates) {
      const startDate = normalizeDateToSofiaDayStart(rawDate);
      const endDate = addOneDay(startDate);
      const candidate = {
        blockType: 'manual_block',
        source: 'legacy_cabin_blocked_dates',
        sourceReference: `${String(cabin._id)}:${startDate.toISOString().slice(0, 10)}`,
        cabinId: String(cabin._id),
        unitId: null,
        reservationId: null,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      };
      report.summary.blockedDateBlocks += 1;
      if (report.samples.blockedDateBlocks.length < 25) {
        report.samples.blockedDateBlocks.push(candidate);
      }
    }
  }

  for (const unit of units) {
    const blockedDates = Array.isArray(unit.blockedDates) ? unit.blockedDates : [];
    const mappedCabinId = cabinTypeToCabinMap.get(String(unit.cabinTypeId));
    if (!mappedCabinId && blockedDates.length > 0) {
      report.issues.push({
        type: 'unit_blocked_dates_missing_cabin_mapping',
        unitId: String(unit._id),
        cabinTypeId: unit.cabinTypeId ? String(unit.cabinTypeId) : null
      });
      continue;
    }
    for (const rawDate of blockedDates) {
      report.summary.unitBlockedDateBlocks += 1;
      // Candidate generation is counted and validated; samples are not required for unit blocks now.
      normalizeDateToSofiaDayStart(rawDate);
    }
  }

  report.summary.totalCandidates =
    report.summary.bookingBlocks +
    report.summary.blockedDateBlocks +
    report.summary.unitBlockedDateBlocks;

  return report;
}

module.exports = {
  runAvailabilityBackfillDryRun
};
