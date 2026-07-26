'use strict';

const Cabin = require('../../../models/Cabin');
const CabinType = require('../../../models/CabinType');
const Unit = require('../../../models/Unit');
const Booking = require('../../../models/Booking');
const { baseBookingFilter } = require('./reportingFilters');
const { loadPropertyKindMaps, isAllowedPropertyKind } = require('./propertyKindJoin');
const { normalizeStayRow } = require('./normalizedStayRow');

function pushSample(samples, bookingId, limit = 5) {
  if (samples.length >= limit) return;
  samples.push(String(bookingId));
}

async function countInventoryHealth(propertyKind) {
  const cabinQuery = { $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }] };
  const cabins = await Cabin.find(cabinQuery).select('_id propertyKind').lean();
  const cabinTypes = await CabinType.find({ isActive: { $ne: false } }).select('_id propertyKind').lean();

  const cabinsInZone = cabins.filter((c) => c.propertyKind === propertyKind);
  const cabinsMissing = cabins.filter((c) => !c.propertyKind);
  const cabinTypesInZone = cabinTypes.filter((ct) => ct.propertyKind === propertyKind);
  const cabinTypesMissing = cabinTypes.filter((ct) => !ct.propertyKind);

  let activeUnits = null;
  if (propertyKind === 'valley' && cabinTypesInZone.length) {
    const typeIds = cabinTypesInZone.map((ct) => ct._id);
    activeUnits = await Unit.countDocuments({ cabinTypeId: { $in: typeIds }, isActive: { $ne: false } });
  }

  return {
    cabinsWithPropertyKind: cabinsInZone.length,
    cabinsMissingPropertyKind: cabinsMissing.length,
    cabinTypesWithPropertyKind: cabinTypesInZone.length,
    cabinTypesMissingPropertyKind: cabinTypesMissing.length,
    activeUnits
  };
}

async function buildInsightsDataQuality({ propertyKind }) {
  if (!isAllowedPropertyKind(propertyKind)) {
    const error = new Error('propertyKind must be cabin or valley');
    error.statusCode = 400;
    throw error;
  }

  const maps = await loadPropertyKindMaps();
  const bookings = await Booking.find(baseBookingFilter())
    .select('_id status totalPrice totalValueCents provenance cabinId cabinTypeId unitId')
    .lean();

  const issues = {
    missing_property_kind: { code: 'missing_property_kind', count: 0, sampleBookingIds: [] },
    both_cabin_and_cabin_type: {
      code: 'both_cabin_and_cabin_type',
      count: 0,
      sampleBookingIds: []
    },
    missing_inventory_ref: { code: 'missing_inventory_ref', count: 0, sampleBookingIds: [] },
    zero_price_manual: { code: 'zero_price_manual', count: 0, sampleBookingIds: [] },
    missing_unit_on_valley_booking: {
      code: 'missing_unit_on_valley_booking',
      count: 0,
      sampleBookingIds: []
    }
  };

  for (const booking of bookings) {
    const row = normalizeStayRow(booking, maps);

    if (row.propertyKindIssue === 'both_cabin_and_cabin_type') {
      issues.both_cabin_and_cabin_type.count += 1;
      pushSample(issues.both_cabin_and_cabin_type.sampleBookingIds, booking._id);
      continue;
    }

    if (row.propertyKindIssue === 'missing_inventory_ref') {
      issues.missing_inventory_ref.count += 1;
      pushSample(issues.missing_inventory_ref.sampleBookingIds, booking._id);
      continue;
    }

    if (row.propertyKindIssue === 'missing_property_kind' || row.propertyKind == null) {
      issues.missing_property_kind.count += 1;
      pushSample(issues.missing_property_kind.sampleBookingIds, booking._id);
      continue;
    }

    if (row.propertyKind !== propertyKind) continue;

    if (row.isZeroPriceManual) {
      issues.zero_price_manual.count += 1;
      pushSample(issues.zero_price_manual.sampleBookingIds, booking._id);
    }

    if (row.isMissingUnitOnValley) {
      issues.missing_unit_on_valley_booking.count += 1;
      pushSample(issues.missing_unit_on_valley_booking.sampleBookingIds, booking._id);
    }
  }

  const inventoryHealth = await countInventoryHealth(propertyKind);

  return {
    propertyKind,
    issues: Object.values(issues),
    inventoryHealth
  };
}

module.exports = {
  buildInsightsDataQuality
};
