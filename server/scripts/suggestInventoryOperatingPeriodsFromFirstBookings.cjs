#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Read-only helper: suggest InventoryOperatingPeriod opening dates from the
 * earliest verified commercial check-in per Cabin / CabinType / Unit / Location.
 *
 *   MONGODB_URI=... node server/scripts/suggestInventoryOperatingPeriodsFromFirstBookings.cjs
 *
 * Never writes. Connection banner → stderr. JSON report → stdout.
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const Booking = require('../models/Booking');
const LocationBooking = require('../models/LocationBooking');
const { baseBookingFilter } = require('../services/ops/reporting/reportingFilters');
const {
  loadPropertyKindMaps,
  resolveBookingPropertyKind
} = require('../services/ops/reporting/propertyKindJoin');
const { computeStayNights } = require('../services/ops/reporting/stayNights');
const { formatSofiaDateOnly } = require('../utils/dateTime');
const { FIXTURE_BOOKING_EMAIL_PATTERN } = require('../utils/fixtureExclusion');
const {
  connectScriptMongo,
  exitFromScriptError
} = require('./lib/scriptMongoSafety.cjs');

const CONFIRMED_STATUSES = Object.freeze(['confirmed', 'in_house', 'completed']);

function bumpExclusion(bucket, reason, id) {
  if (!bucket[reason]) {
    bucket[reason] = { reason, count: 0, sampleIds: [] };
  }
  bucket[reason].count += 1;
  if (id && bucket[reason].sampleIds.length < 5) {
    bucket[reason].sampleIds.push(String(id));
  }
}

function considerEarliest(map, key, candidate) {
  const prev = map.get(key);
  if (!prev || candidate.checkIn.getTime() < prev.checkIn.getTime()) {
    map.set(key, candidate);
  }
}

/**
 * Pure aggregation over already-loaded docs (testable without live Mongo).
 */
function buildSuggestions({
  bookings,
  locationBookings,
  cabins,
  cabinTypes,
  units,
  maps
}) {
  const excluded = {};
  const ambiguous = {};
  const cabinFirst = new Map();
  const cabinTypeFirst = new Map();
  const unitFirst = new Map();
  const locationFirst = new Map();

  const cabinById = new Map(cabins.map((c) => [String(c._id), c]));
  const cabinTypeById = new Map(cabinTypes.map((ct) => [String(ct._id), ct]));
  const unitById = new Map(units.map((u) => [String(u._id), u]));

  for (const booking of bookings) {
    const stay = computeStayNights(booking.checkIn, booking.checkOut);
    if (stay.invalid || !booking.checkIn || !booking.checkOut) {
      bumpExclusion(excluded, 'invalid_date_range', booking._id);
      continue;
    }

    const resolved = resolveBookingPropertyKind(booking, maps);
    if (resolved.issue === 'both_cabin_and_cabin_type') {
      bumpExclusion(ambiguous, 'both_cabin_and_cabin_type', booking._id);
      continue;
    }
    if (resolved.issue === 'missing_inventory_ref') {
      bumpExclusion(excluded, 'missing_inventory_ref', booking._id);
      continue;
    }
    if (resolved.issue === 'missing_property_kind' || !resolved.propertyKind) {
      bumpExclusion(ambiguous, 'missing_property_kind', booking._id);
      continue;
    }

    const checkIn = new Date(booking.checkIn);
    const base = {
      checkIn,
      operatingFrom: formatSofiaDateOnly(checkIn),
      propertyKind: resolved.propertyKind,
      bookingId: String(booking._id),
      locationBookingId: null
    };

    if (booking.cabinId && !booking.cabinTypeId) {
      const cabinId = String(booking.cabinId);
      considerEarliest(cabinFirst, cabinId, {
        ...base,
        entityType: 'cabin',
        entityId: cabinId
      });
    }

    if (booking.cabinTypeId && !booking.cabinId) {
      const cabinTypeId = String(booking.cabinTypeId);
      considerEarliest(cabinTypeFirst, cabinTypeId, {
        ...base,
        entityType: 'cabin_type',
        entityId: cabinTypeId
      });

      if (booking.unitId) {
        const unitId = String(booking.unitId);
        const unit = unitById.get(unitId);
        if (unit && String(unit.cabinTypeId) !== cabinTypeId) {
          bumpExclusion(ambiguous, 'unit_cabin_type_mismatch', booking._id);
        } else {
          considerEarliest(unitFirst, unitId, {
            ...base,
            entityType: 'unit',
            entityId: unitId,
            cabinTypeId
          });
        }
      } else if (resolved.propertyKind === 'valley') {
        bumpExclusion(excluded, 'valley_booking_missing_unit_no_unit_suggestion', booking._id);
      }
    }
  }

  for (const loc of locationBookings) {
    const stay = computeStayNights(loc.checkIn, loc.checkOut);
    if (stay.invalid || !loc.checkIn || !loc.checkOut) {
      bumpExclusion(excluded, 'location_invalid_date_range', loc._id);
      continue;
    }
    if (loc.locationKey !== 'valley') {
      bumpExclusion(ambiguous, 'location_unknown_key', loc._id);
      continue;
    }
    const checkIn = new Date(loc.checkIn);
    const entityId = String(loc.locationKey);
    considerEarliest(locationFirst, entityId, {
      checkIn,
      operatingFrom: formatSofiaDateOnly(checkIn),
      propertyKind: 'valley',
      entityType: 'location',
      entityId,
      bookingId: null,
      locationBookingId: String(loc._id)
    });
  }

  const suggestions = [];

  for (const [entityId, row] of cabinFirst.entries()) {
    const cabin = cabinById.get(entityId);
    suggestions.push({
      propertyKind: row.propertyKind,
      entityType: 'cabin',
      entityId,
      displayName: cabin?.name || entityId,
      operatingFrom: row.operatingFrom,
      operatingTo: null,
      reason: 'opened',
      source: 'first_verified_booking',
      confidence: 'usable_with_limitations',
      evidence: {
        bookingId: row.bookingId,
        checkIn: row.checkIn.toISOString()
      }
    });
  }

  for (const [entityId, row] of cabinTypeFirst.entries()) {
    const cabinType = cabinTypeById.get(entityId);
    suggestions.push({
      propertyKind: row.propertyKind,
      entityType: 'cabin_type',
      entityId,
      displayName: cabinType?.name || entityId,
      operatingFrom: row.operatingFrom,
      operatingTo: null,
      reason: 'opened',
      source: 'first_verified_booking',
      confidence: 'usable_with_limitations',
      evidence: {
        bookingId: row.bookingId,
        checkIn: row.checkIn.toISOString()
      }
    });
  }

  for (const [entityId, row] of unitFirst.entries()) {
    const unit = unitById.get(entityId);
    const typeName = unit?.cabinTypeId
      ? cabinTypeById.get(String(unit.cabinTypeId))?.name
      : null;
    suggestions.push({
      propertyKind: row.propertyKind,
      entityType: 'unit',
      entityId,
      displayName:
        unit?.displayName ||
        (typeName ? `${typeName} · ${unit?.unitNumber || entityId}` : unit?.unitNumber || entityId),
      operatingFrom: row.operatingFrom,
      operatingTo: null,
      reason: 'opened',
      source: 'first_verified_booking',
      confidence: 'usable_with_limitations',
      evidence: {
        bookingId: row.bookingId,
        checkIn: row.checkIn.toISOString()
      }
    });
  }

  for (const [entityId, row] of locationFirst.entries()) {
    suggestions.push({
      propertyKind: row.propertyKind,
      entityType: 'location',
      entityId,
      displayName: entityId === 'valley' ? 'The Valley (buyout)' : entityId,
      operatingFrom: row.operatingFrom,
      operatingTo: null,
      reason: 'opened',
      source: 'first_verified_booking',
      confidence: 'usable_with_limitations',
      evidence: {
        locationBookingId: row.locationBookingId,
        checkIn: row.checkIn.toISOString()
      }
    });
  }

  suggestions.sort((a, b) => {
    const ak = `${a.propertyKind}:${a.entityType}:${a.entityId}`;
    const bk = `${b.propertyKind}:${b.entityType}:${b.entityId}`;
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });

  const inventoryWithoutSuggestion = [];
  for (const cabin of cabins) {
    const id = String(cabin._id);
    if (!cabinFirst.has(id) && cabin.propertyKind) {
      inventoryWithoutSuggestion.push({
        entityType: 'cabin',
        entityId: id,
        propertyKind: cabin.propertyKind,
        reason: 'no_verified_booking'
      });
    }
  }
  for (const cabinType of cabinTypes) {
    const id = String(cabinType._id);
    if (!cabinTypeFirst.has(id) && cabinType.propertyKind) {
      inventoryWithoutSuggestion.push({
        entityType: 'cabin_type',
        entityId: id,
        propertyKind: cabinType.propertyKind,
        reason: 'no_verified_booking'
      });
    }
  }
  for (const unit of units) {
    const id = String(unit._id);
    if (!unitFirst.has(id)) {
      const kind = maps.cabinTypeKindById.get(String(unit.cabinTypeId)) || null;
      inventoryWithoutSuggestion.push({
        entityType: 'unit',
        entityId: id,
        propertyKind: kind,
        reason: 'no_verified_booking_with_unitId'
      });
    }
  }

  return {
    suggestedAt: new Date().toISOString(),
    readOnly: true,
    notes: [
      'operatingFrom is the Sofia civil date of the earliest verified commercial check-in.',
      'Never derived from Mongo createdAt.',
      'confidence usable_with_limitations — operator must review before upsert.',
      'Valley Unit suggestions require persisted unitId; missing unitId does not invent units.',
      'Location suggestions come only from LocationBooking records.'
    ],
    suggestions,
    excluded: Object.values(excluded).sort((a, b) => a.reason.localeCompare(b.reason)),
    ambiguous: Object.values(ambiguous).sort((a, b) => a.reason.localeCompare(b.reason)),
    inventoryWithoutSuggestion,
    summary: {
      suggestionCount: suggestions.length,
      excludedCount: Object.values(excluded).reduce((n, r) => n + r.count, 0),
      ambiguousCount: Object.values(ambiguous).reduce((n, r) => n + r.count, 0),
      inventoryWithoutSuggestionCount: inventoryWithoutSuggestion.length
    }
  };
}

async function loadAndSuggest() {
  const maps = await loadPropertyKindMaps();

  const bookingMatch = {
    ...baseBookingFilter(),
    excludeFromRevenueReporting: { $ne: true },
    status: { $in: [...CONFIRMED_STATUSES] },
    checkIn: { $type: 'date' },
    checkOut: { $type: 'date' }
  };

  const [bookings, locationBookings, cabins, cabinTypes, units] = await Promise.all([
    Booking.find(bookingMatch)
      .select('_id status checkIn checkOut cabinId cabinTypeId unitId')
      .lean(),
    LocationBooking.find({
      status: { $in: [...CONFIRMED_STATUSES] },
      checkIn: { $type: 'date' },
      checkOut: { $type: 'date' },
      'guestInfo.email': { $not: FIXTURE_BOOKING_EMAIL_PATTERN }
    })
      .select('_id status checkIn checkOut locationKey')
      .lean(),
    Cabin.find({}).select('_id name propertyKind').lean(),
    CabinType.find({}).select('_id name propertyKind').lean(),
    Unit.find({}).select('_id unitNumber displayName cabinTypeId').lean()
  ]);

  return buildSuggestions({
    bookings,
    locationBookings,
    cabins,
    cabinTypes,
    units,
    maps
  });
}

async function main(env = process.env) {
  await connectScriptMongo(mongoose, {
    readOnly: true,
    mode: 'read-only',
    env
  });
  try {
    const report = await loadAndSuggest();
    console.log(JSON.stringify(report, null, 2));
    return report;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    if (err?.code === 'MONGO_URI_REQUIRED' || err?.code === 'PRODUCTION_WRITE_CONFIRM_REQUIRED') {
      exitFromScriptError(err);
    }
    console.error(JSON.stringify({ ok: false, error: err.message }));
    process.exit(2);
  });
}

module.exports = {
  CONFIRMED_STATUSES,
  buildSuggestions,
  loadAndSuggest,
  main
};
