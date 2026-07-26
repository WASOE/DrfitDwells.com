'use strict';

const Booking = require('../../../models/Booking');
const LocationBooking = require('../../../models/LocationBooking');
const AvailabilityBlock = require('../../../models/AvailabilityBlock');
const InventoryOperatingPeriod = require('../../../models/InventoryOperatingPeriod');
const Cabin = require('../../../models/Cabin');
const CabinType = require('../../../models/CabinType');
const { baseBookingFilter } = require('./reportingFilters');
const { loadPropertyKindMaps, isAllowedPropertyKind } = require('./propertyKindJoin');
const { normalizeStayRow } = require('./normalizedStayRow');
const { computeStayNights } = require('./stayNights');
const { CONFIDENCE } = require('./historicalStayFactsService');
const { FIXTURE_BOOKING_EMAIL_PATTERN } = require('../../../utils/fixtureExclusion');
const { formatSofiaDateOnly } = require('../../../utils/dateTime');

function pushSample(arr, id, limit = 5) {
  if (arr.length >= limit) return;
  arr.push(String(id));
}

function emptyIssue(code) {
  return { code, count: 0, sampleIds: [], affectedMonths: new Set() };
}

function monthKey(date) {
  const d = formatSofiaDateOnly(date);
  return d ? d.slice(0, 7) : null;
}

/**
 * Historical data-quality report for Batch 5A. No guest PII.
 */
async function buildHistoricalDataQuality({ propertyKind }) {
  if (!isAllowedPropertyKind(propertyKind)) {
    const error = new Error('propertyKind must be cabin or valley');
    error.statusCode = 400;
    throw error;
  }

  const maps = await loadPropertyKindMaps();
  const issues = {
    missing_property_kind: emptyIssue('missing_property_kind'),
    missing_inventory_assignment: emptyIssue('missing_inventory_assignment'),
    missing_unit: emptyIssue('missing_unit'),
    overlapping_inventory_attribution: emptyIssue('overlapping_inventory_attribution'),
    duplicate_location_booking_children: emptyIssue('duplicate_location_booking_children'),
    invalid_date_ranges: emptyIssue('invalid_date_ranges'),
    zero_value_commercial_stays: emptyIssue('zero_value_commercial_stays'),
    unknown_operating_start: emptyIssue('unknown_operating_start'),
    incomplete_operational_blocks: emptyIssue('incomplete_operational_blocks'),
    unidentified_ical_blocks: emptyIssue('unidentified_ical_blocks'),
    occupancy_denominator_unavailable: emptyIssue('occupancy_denominator_unavailable'),
    ambiguous_cancellation_history: emptyIssue('ambiguous_cancellation_history')
  };

  const bookings = await Booking.find({
    ...baseBookingFilter(),
    excludeFromRevenueReporting: { $ne: true }
  })
    .select(
      '_id status checkIn checkOut createdAt totalPrice totalValueCents provenance cabinId cabinTypeId unitId cancellationSettlement'
    )
    .lean();

  const confidenceByMonth = new Map();
  let earliestReliableRevenue = null;
  let repairable = 0;

  for (const booking of bookings) {
    const row = normalizeStayRow(booking, maps);
    const stay = computeStayNights(booking.checkIn, booking.checkOut);
    const m = monthKey(booking.checkIn || booking.createdAt);
    const noteMonth = (issueKey) => {
      if (m) issues[issueKey].affectedMonths.add(m);
    };

    if (row.propertyKindIssue === 'both_cabin_and_cabin_type') {
      issues.overlapping_inventory_attribution.count += 1;
      pushSample(issues.overlapping_inventory_attribution.sampleIds, booking._id);
      noteMonth('overlapping_inventory_attribution');
      repairable += 1;
      continue;
    }
    if (row.propertyKindIssue === 'missing_inventory_ref') {
      issues.missing_inventory_assignment.count += 1;
      pushSample(issues.missing_inventory_assignment.sampleIds, booking._id);
      noteMonth('missing_inventory_assignment');
      repairable += 1;
      continue;
    }
    if (row.propertyKindIssue === 'missing_property_kind' || row.propertyKind == null) {
      issues.missing_property_kind.count += 1;
      pushSample(issues.missing_property_kind.sampleIds, booking._id);
      noteMonth('missing_property_kind');
      repairable += 1;
      continue;
    }
    if (row.propertyKind !== propertyKind) continue;

    if (stay.invalid) {
      issues.invalid_date_ranges.count += 1;
      pushSample(issues.invalid_date_ranges.sampleIds, booking._id);
      noteMonth('invalid_date_ranges');
    }
    if (row.isMissingUnitOnValley) {
      issues.missing_unit.count += 1;
      pushSample(issues.missing_unit.sampleIds, booking._id);
      noteMonth('missing_unit');
      repairable += 1;
    }
    if (row.isZeroPriceManual || row.bookedRevenueCents === 0) {
      issues.zero_value_commercial_stays.count += 1;
      pushSample(issues.zero_value_commercial_stays.sampleIds, booking._id);
      noteMonth('zero_value_commercial_stays');
    }
    if (booking.status === 'cancelled') {
      const snap = booking.cancellationSettlement?.financialSnapshot;
      if (!snap?.capturedAt) {
        issues.ambiguous_cancellation_history.count += 1;
        pushSample(issues.ambiguous_cancellation_history.sampleIds, booking._id);
        noteMonth('ambiguous_cancellation_history');
      }
    }

    if (m) {
      const prev = confidenceByMonth.get(m) || CONFIDENCE.VERIFIED;
      let next = prev;
      if (stay.invalid || row.propertyKindIssue) next = CONFIDENCE.UNRELIABLE;
      else if (row.isMissingUnitOnValley) next = CONFIDENCE.USABLE;
      confidenceByMonth.set(m, rankConfidence(next, prev));
    }

    if (!stay.invalid && row.propertyKind === propertyKind) {
      const d = booking.checkIn || booking.createdAt;
      if (d && (!earliestReliableRevenue || d < earliestReliableRevenue)) {
        earliestReliableRevenue = d;
      }
    }
  }

  if (propertyKind === 'valley') {
    const locs = await LocationBooking.find({
      locationKey: 'valley',
      'guestInfo.email': { $not: FIXTURE_BOOKING_EMAIL_PATTERN }
    })
      .select('_id childBookingIds checkIn createdAt status totalPrice')
      .lean();

    const childSeen = new Map();
    for (const loc of locs) {
      for (const childId of loc.childBookingIds || []) {
        const key = String(childId);
        if (childSeen.has(key)) {
          issues.duplicate_location_booking_children.count += 1;
          pushSample(issues.duplicate_location_booking_children.sampleIds, loc._id);
        } else {
          childSeen.set(key, String(loc._id));
        }
      }
      const m = monthKey(loc.checkIn || loc.createdAt);
      if (m && !confidenceByMonth.has(m)) confidenceByMonth.set(m, CONFIDENCE.VERIFIED);
      if (loc.checkIn && (!earliestReliableRevenue || loc.checkIn < earliestReliableRevenue)) {
        earliestReliableRevenue = loc.checkIn;
      }
    }
  }

  const periods = await InventoryOperatingPeriod.find({ propertyKind }).lean();
  if (!periods.length) {
    issues.unknown_operating_start.count += 1;
    issues.occupancy_denominator_unavailable.count += 1;
  }

  const icalBlocks = await AvailabilityBlock.countDocuments({
    status: 'active',
    blockType: 'external_hold',
    source: /ical|airbnb/i
  });
  issues.unidentified_ical_blocks.count = icalBlocks;

  // Incomplete operational blocks: active maintenance/manual missing endDate or inverted
  const badBlocks = await AvailabilityBlock.find({
    status: 'active',
    blockType: { $in: ['maintenance', 'manual_block'] },
    $expr: { $lte: ['$endDate', '$startDate'] }
  })
    .select('_id')
    .limit(20)
    .lean();
  issues.incomplete_operational_blocks.count = badBlocks.length;
  for (const b of badBlocks) pushSample(issues.incomplete_operational_blocks.sampleIds, b._id);

  let earliestReliableOccupancy = null;
  if (periods.length) {
    const opens = periods
      .filter((p) => p.reason === 'opened' || p.defaultSellable !== false)
      .map((p) => p.operatingFrom)
      .filter(Boolean)
      .sort((a, b) => a - b);
    earliestReliableOccupancy = opens[0] || null;
  }

  const serializedIssues = {};
  for (const [key, value] of Object.entries(issues)) {
    serializedIssues[key] = {
      code: value.code,
      count: value.count,
      sampleIds: value.sampleIds,
      affectedMonths: [...value.affectedMonths].sort()
    };
  }

  const confidenceByMonthOut = [...confidenceByMonth.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, dataConfidence]) => ({ month, dataConfidence }));

  // Inventory creation dates (not operating starts)
  const cabinCreated = await Cabin.find({ propertyKind })
    .sort({ createdAt: 1 })
    .limit(1)
    .select('createdAt name')
    .lean();
  const cabinTypeCreated = await CabinType.find({ propertyKind })
    .sort({ createdAt: 1 })
    .limit(1)
    .select('createdAt name')
    .lean();

  return {
    propertyKind,
    issues: serializedIssues,
    earliestReliableRevenueDate: earliestReliableRevenue
      ? formatSofiaDateOnly(earliestReliableRevenue)
      : null,
    earliestReliableOccupancyDate: earliestReliableOccupancy
      ? formatSofiaDateOnly(earliestReliableOccupancy)
      : null,
    confidenceByMonth: confidenceByMonthOut,
    repairableRecordCounts: {
      missingPropertyKindOrInventory: repairable,
      operatingPeriodsConfigured: periods.length
    },
    inventoryCreatedAtHints: {
      earliestCabinCreatedAt: cabinCreated[0]?.createdAt || null,
      earliestCabinTypeCreatedAt: cabinTypeCreated[0]?.createdAt || null,
      note: 'Mongo createdAt is not an approved operating start. Configure InventoryOperatingPeriod explicitly.'
    },
    provenance: {
      directBookingsOnly: true,
      externalChannelsIncluded: false,
      computedAt: new Date().toISOString()
    }
  };
}

function rankConfidence(a, b) {
  const order = [
    CONFIDENCE.VERIFIED,
    CONFIDENCE.USABLE,
    CONFIDENCE.REVENUE_ONLY,
    CONFIDENCE.UNRELIABLE
  ];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

module.exports = {
  buildHistoricalDataQuality
};
