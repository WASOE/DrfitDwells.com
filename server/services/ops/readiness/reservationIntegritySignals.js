const AvailabilityBlock = require('../../../models/AvailabilityBlock');
const Booking = require('../../../models/Booking');
const { isPublicIcsStrictEligibility, isPublicIcsExportSafetyEnforced } = require('../../../config/publicIcsConfig');
const { loadPaidOrPartialReservationIdSet, isBookingEligibleForPublicIcs } = require('../../calendar/icsBlockingEligibility');
const { BLOCKING_BOOKING_STATUSES } = require('../../calendar/blockingStatusConstants');
const { resolveBookingExportSafety } = require('../../calendar/bookingExportSafety');

const MAX_BLOCKING_SCAN = 5000;

/**
 * Read-only contamination / readiness signals for ops health (no mutations).
 */
async function getReservationIntegritySignals() {
  const strictIcs = isPublicIcsStrictEligibility();
  const exportSafetyEnforced = isPublicIcsExportSafetyEnforced();

  const staleActiveReservationBlocks = await AvailabilityBlock.aggregate([
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
    { $count: 'n' }
  ]);
  const staleReservationBlockCount = staleActiveReservationBlocks[0]?.n || 0;

  const blockingSingleCabinQuery = {
    status: { $in: BLOCKING_BOOKING_STATUSES },
    cabinId: { $exists: true, $ne: null },
    $or: [{ cabinTypeId: null }, { cabinTypeId: { $exists: false } }]
  };

  const blockingTotal = await Booking.countDocuments(blockingSingleCabinQuery);

  const blockingSample = await Booking.find(blockingSingleCabinQuery)
    .select('_id status isProductionSafe isTest provenance checkIn checkOut')
    .limit(MAX_BLOCKING_SCAN)
    .lean();

  const scannedCount = blockingSample.length;
  const scanTruncated = blockingTotal > scannedCount;

  const blockingIds = blockingSample.map((b) => String(b._id));
  const paidSet = blockingIds.length > 0 ? await loadPaidOrPartialReservationIdSet(blockingIds) : new Set();

  let blockingNotProductionSafeForOutboundIcs = 0;
  let excludedFromPublicIcsByExportSafety = 0;
  let icsEligibleWithUncertainty = 0;
  let blockingMissingProvenanceSource = 0;
  let blockingUnsafeProvenanceSource = 0;

  for (const b of blockingSample) {
    const safety = resolveBookingExportSafety(b, paidSet);
    if (!safety.effectiveSafe) {
      blockingNotProductionSafeForOutboundIcs += 1;
      if (exportSafetyEnforced) excludedFromPublicIcsByExportSafety += 1;
    }
    const src = String(b.provenance?.source || '')
      .trim()
      .toLowerCase();
    if (!src) blockingMissingProvenanceSource += 1;
    if (
      src &&
      [
        'seed',
        'demo',
        'validation',
        'test',
        'internal',
        'migration',
        'fixture',
        'script',
        'backfill',
        'dry_run'
      ].includes(src)
    ) {
      blockingUnsafeProvenanceSource += 1;
    }

    const fullEligible = isBookingEligibleForPublicIcs(b, paidSet, strictIcs);
    if (fullEligible && safety.uncertainty) {
      icsEligibleWithUncertainty += 1;
    }
  }

  const pendingSingleCabins = blockingSample.filter((b) => b.status === 'pending');
  const pendingExcludedFromStrictIcs = pendingSingleCabins.filter(
    (p) => !isBookingEligibleForPublicIcs(p, paidSet, strictIcs)
  ).length;

  const blockingWithoutProvenanceSource = await Booking.countDocuments({
    status: { $in: BLOCKING_BOOKING_STATUSES },
    $or: [{ provenance: { $exists: false } }, { 'provenance.source': { $exists: false } }, { 'provenance.source': null }]
  });

  const warnings = [];
  if (staleReservationBlockCount > 0) {
    warnings.push({
      code: 'stale_active_reservation_blocks',
      severity: 'high',
      count: staleReservationBlockCount,
      hint: 'Active reservation AvailabilityBlocks for cancelled/completed/missing bookings; run cleanup:reservation-integrity --apply'
    });
  }
  if (exportSafetyEnforced && blockingNotProductionSafeForOutboundIcs > 0) {
    warnings.push({
      code: 'blocking_not_production_safe_for_public_ics',
      severity: 'medium',
      count: blockingNotProductionSafeForOutboundIcs,
      scanTruncated,
      hint: 'Bookings block inventory but are excluded from public ICS until isProductionSafe=true or provenance.source is guest_portal (pending still needs paid Payment when strict ICS is on)'
    });
  }
  if (strictIcs && pendingExcludedFromStrictIcs > 0) {
    warnings.push({
      code: 'pending_without_payment_ics_excluded',
      severity: 'low',
      count: pendingExcludedFromStrictIcs,
      hint: 'Strict public ICS excludes unpaid pending; confirm Payment webhook evidence or set PUBLIC_ICS_STRICT_ELIGIBILITY=0 for dev'
    });
  }
  if (blockingWithoutProvenanceSource > 0) {
    warnings.push({
      code: 'blocking_bookings_missing_provenance_source',
      severity: 'low',
      count: blockingWithoutProvenanceSource,
      hint: 'Legacy bookings lack provenance.source; export uses conservative rules — review cleanup --preview-unsafe-blocking'
    });
  }
  if (icsEligibleWithUncertainty > 0) {
    warnings.push({
      code: 'public_ics_eligible_but_uncertain_provenance',
      severity: 'low',
      count: icsEligibleWithUncertainty,
      scanTruncated,
      hint: 'ICS-eligible rows flagged for manual review (uncertainty); Phase 2c policy does not use paid-without-provenance export'
    });
  }
  if (scanTruncated) {
    warnings.push({
      code: 'integrity_scan_truncated',
      severity: 'low',
      count: blockingTotal,
      hint: `Only first ${MAX_BLOCKING_SCAN} blocking single-cabin bookings scanned; totals are lower bounds`
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    publicIcsStrictEligibility: strictIcs,
    publicIcsExportSafetyEnforced: exportSafetyEnforced,
    blockingSingleCabinTotalCount: blockingTotal,
    blockingSingleCabinScannedCount: scannedCount,
    blockingSingleCabinScanTruncated: scanTruncated,
    staleActiveReservationBlockCount: staleReservationBlockCount,
    blockingNotProductionSafeForOutboundIcsCount: blockingNotProductionSafeForOutboundIcs,
    blockingExcludedFromPublicIcsByExportSafetyCount: exportSafetyEnforced ? excludedFromPublicIcsByExportSafety : 0,
    publicIcsEligibleBookingWithUncertaintyCount: icsEligibleWithUncertainty,
    blockingMissingProvenanceSourceInSampleCount: blockingMissingProvenanceSource,
    blockingUnsafeProvenanceSourceInSampleCount: blockingUnsafeProvenanceSource,
    pendingSingleCabinsExcludedFromStrictIcsCount: strictIcs ? pendingExcludedFromStrictIcs : 0,
    blockingBookingsMissingProvenanceSourceCount: blockingWithoutProvenanceSource,
    warnings
  };
}

module.exports = {
  getReservationIntegritySignals
};
