/**
 * Shared integrity preview logic (used by CLI script and maintenance API).
 */
const AvailabilityBlock = require('../../models/AvailabilityBlock');
const Booking = require('../../models/Booking');
const { BLOCKING_BOOKING_STATUSES } = require('../calendar/blockingStatusConstants');
const { loadPaidOrPartialReservationIdSet, isBookingEligibleForPublicIcs } = require('../calendar/icsBlockingEligibility');
const { resolveBookingExportSafety } = require('../calendar/bookingExportSafety');
const { isPublicIcsStrictEligibility } = require('../../config/publicIcsConfig');

const PREVIEW_LIMIT = 2000;

async function findStaleReservationBlockRows() {
  const rows = await AvailabilityBlock.aggregate([
    {
      $match: {
        blockType: 'reservation',
        status: 'active',
        reservationId: { $exists: true, $ne: null }
      }
    },
    {
      $lookup: {
        from: 'bookings',
        localField: 'reservationId',
        foreignField: '_id',
        as: 'b'
      }
    },
    {
      $match: {
        $or: [{ b: { $size: 0 } }, { 'b.0.status': { $in: ['cancelled', 'completed'] } }]
      }
    },
    { $project: { _id: 1, reservationId: 1, bookingStatus: { $arrayElemAt: ['$b.status', 0] } } }
  ]);
  return rows;
}

async function loadBlockingSingleCabinSample() {
  return Booking.find({
    status: { $in: BLOCKING_BOOKING_STATUSES },
    cabinId: { $exists: true, $ne: null },
    $or: [{ cabinTypeId: null }, { cabinTypeId: { $exists: false } }]
  })
    .select('_id status isProductionSafe isTest provenance checkIn checkOut guestInfo.email')
    .limit(PREVIEW_LIMIT)
    .sort({ checkIn: 1 })
    .lean();
}

async function runIntegrityPreviews() {
  const bookings = await loadBlockingSingleCabinSample();
  const ids = bookings.map((b) => String(b._id));
  const paidSet = ids.length > 0 ? await loadPaidOrPartialReservationIdSet(ids) : new Set();
  const strictIcs = isPublicIcsStrictEligibility();

  const unsafeBlocking = [];
  const icsExcluded = [];

  for (const b of bookings) {
    const safety = resolveBookingExportSafety(b, paidSet);
    if (!safety.effectiveSafe) {
      unsafeBlocking.push({
        bookingId: String(b._id),
        status: b.status,
        reasonCode: safety.reasonCode,
        uncertainty: safety.uncertainty,
        isTest: b.isTest,
        isProductionSafe: b.isProductionSafe,
        provenanceSource: b.provenance?.source || null
      });
    }
    const eligible = isBookingEligibleForPublicIcs(b, paidSet, strictIcs);
    if (!eligible) {
      icsExcluded.push({
        bookingId: String(b._id),
        status: b.status,
        strictIcs,
        exportSafetyEffectiveSafe: safety.effectiveSafe,
        exportSafetyReasonCode: safety.reasonCode,
        exportSafetyUncertainty: safety.uncertainty
      });
    }
  }

  return { unsafeBlocking, icsExcluded, previewLimit: PREVIEW_LIMIT, sampleSize: bookings.length };
}

module.exports = {
  PREVIEW_LIMIT,
  findStaleReservationBlockRows,
  runIntegrityPreviews
};
