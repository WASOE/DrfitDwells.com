'use strict';

const moment = require('moment-timezone');
const InventoryOperatingPeriod = require('../../../models/InventoryOperatingPeriod');
const AvailabilityBlock = require('../../../models/AvailabilityBlock');
const Cabin = require('../../../models/Cabin');
const CabinType = require('../../../models/CabinType');
const Unit = require('../../../models/Unit');
const { PROPERTY_TIMEZONE } = require('../../../utils/dateTime');
const { eachSofiaNightInclusive } = require('./stayNights');
const { FIXTURE_CABIN_NAME_PATTERN } = require('../../../utils/fixtureExclusion');

/**
 * Verified non-sellable operational block types.
 * external_hold (iCal) is intentionally excluded — availability only, not confirmed paid stays,
 * and reason is usually unknown so we do not subtract from the denominator.
 */
const NON_SELLABLE_BLOCK_TYPES = Object.freeze(['maintenance', 'manual_block']);

function periodCoversNight(period, nightMoment) {
  const from = moment.tz(period.operatingFrom, PROPERTY_TIMEZONE).startOf('day');
  const to = period.operatingTo
    ? moment.tz(period.operatingTo, PROPERTY_TIMEZONE).startOf('day')
    : null;
  if (nightMoment.isBefore(from)) return false;
  if (to && nightMoment.isAfter(to)) return false;
  const weekday = nightMoment.day(); // 0=Sun
  const weekdays = Array.isArray(period.sellableWeekdays) ? period.sellableWeekdays : [0, 1, 2, 3, 4, 5, 6];
  if (!weekdays.includes(weekday)) return false;
  if (period.defaultSellable === false) return false;
  if (period.reason === 'closed') return false;
  return true;
}

function blockCoversNight(block, nightMoment) {
  const start = moment.tz(block.startDate, PROPERTY_TIMEZONE).startOf('day');
  const end = moment.tz(block.endDate, PROPERTY_TIMEZONE).startOf('day');
  // AvailabilityBlock uses exclusive end
  return nightMoment.isSameOrAfter(start) && nightMoment.isBefore(end);
}

async function loadOperatingPeriods({ propertyKind, entityType = null, entityId = null }) {
  const match = { propertyKind };
  if (entityType) match.entityType = entityType;
  if (entityId != null) match.entityId = entityId;
  return InventoryOperatingPeriod.find(match).lean();
}

function isMultiListingCabin(cabin) {
  return (
    cabin.inventoryType === 'multi' ||
    cabin.inventoryMode === 'multi' ||
    Boolean(cabin.cabinTypeId) ||
    Boolean(cabin.cabinTypeRef)
  );
}

/**
 * Canonical inventory rows for the occupancy denominator.
 *
 * Cabin propertyKind: single Cabin documents only.
 * Valley propertyKind: standalone Valley cabins (inventoryType !== multi, no cabinType link)
 *   PLUS unit-backed inventory. Aggregate multi listing Cabins are excluded (not guessed by name).
 */
async function resolveInventoryEntities(propertyKind) {
  const archivedClause = { $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }] };
  const fixtureExclusion = { name: { $not: FIXTURE_CABIN_NAME_PATTERN } };
  const excludedAggregateListings = [];

  if (propertyKind === 'cabin') {
    const cabins = await Cabin.find({
      propertyKind: 'cabin',
      ...archivedClause,
      ...fixtureExclusion,
      isActive: { $ne: false }
    })
      .select('_id name inventoryType inventoryMode cabinTypeId')
      .lean();
    return {
      entities: cabins.map((c) => ({
        entityType: 'cabin',
        entityId: String(c._id),
        displayName: c.name || String(c._id),
        cabinId: c._id,
        cabinTypeId: null,
        unitId: null
      })),
      excludedAggregateListings
    };
  }

  // Valley: standalone cabins + units
  const [allValleyCabins, cabinTypes] = await Promise.all([
    Cabin.find({
      propertyKind: 'valley',
      ...archivedClause,
      ...fixtureExclusion,
      isActive: { $ne: false }
    })
      .select('_id name inventoryType inventoryMode cabinTypeId cabinTypeRef')
      .lean(),
    CabinType.find({ propertyKind: 'valley', isActive: { $ne: false } })
      .select('_id name')
      .lean()
  ]);

  const entities = [];
  for (const cabin of allValleyCabins) {
    if (isMultiListingCabin(cabin)) {
      excludedAggregateListings.push({
        entityType: 'cabin',
        entityId: String(cabin._id),
        displayName: cabin.name || String(cabin._id),
        reason: 'aggregate_listing_excluded',
        detail:
          'Cabin is a multi/listing parent (inventoryType multi or cabinTypeId link). Unit-backed inventory is the canonical denominator.'
      });
      continue;
    }
    entities.push({
      entityType: 'cabin',
      entityId: String(cabin._id),
      displayName: cabin.name || String(cabin._id),
      cabinId: cabin._id,
      cabinTypeId: null,
      unitId: null
    });
  }

  const typeIds = cabinTypes.map((t) => t._id);
  const units = typeIds.length
    ? await Unit.find({ cabinTypeId: { $in: typeIds }, isActive: { $ne: false } })
        .select('_id unitNumber displayName cabinTypeId')
        .lean()
    : [];
  const typeName = new Map(cabinTypes.map((t) => [String(t._id), t.name || String(t._id)]));
  for (const u of units) {
    entities.push({
      entityType: 'unit',
      entityId: String(u._id),
      displayName: `${typeName.get(String(u.cabinTypeId)) || 'Valley'} · ${u.displayName || u.unitNumber || u._id}`,
      cabinId: null,
      cabinTypeId: u.cabinTypeId,
      unitId: u._id
    });
  }

  return { entities, excludedAggregateListings };
}

function filterEntities(entities, { cabinId = null, cabinTypeId = null, unitId = null } = {}) {
  let out = entities;
  if (cabinId) {
    out = out.filter((e) => e.cabinId && String(e.cabinId) === String(cabinId));
  }
  if (unitId) {
    out = out.filter((e) => e.unitId && String(e.unitId) === String(unitId));
  }
  if (cabinTypeId) {
    // Cabin-type filter uses canonical units only (not standalone cabins).
    out = out.filter((e) => e.unitId && e.cabinTypeId && String(e.cabinTypeId) === String(cabinTypeId));
  }
  return out;
}

function periodsForEntity(periods, entity, propertyKind) {
  const entityPeriods = periods.filter((p) => {
    if (p.entityType === 'location' && propertyKind === 'valley') {
      // Location buyout periods are not part of the mixed cabin+unit denominator.
      return false;
    }
    return p.entityType === entity.entityType && String(p.entityId) === String(entity.entityId);
  });

  // Intentional fallback: cabin_type period covers all units of that type (each unit-night once).
  if (entity.entityType === 'unit' && entity.cabinTypeId) {
    for (const p of periods) {
      if (p.entityType === 'cabin_type' && String(p.entityId) === String(entity.cabinTypeId)) {
        entityPeriods.push(p);
      }
    }
  }
  return entityPeriods;
}

function blockMatchesEntity(block, entity) {
  if (entity.cabinId) {
    if (!block.cabinId || String(block.cabinId) !== String(entity.cabinId)) return false;
    // Standalone cabin blocks should not require a unitId match.
    if (block.unitId) return false;
    return true;
  }
  if (entity.unitId) {
    if (block.unitId && String(block.unitId) !== String(entity.unitId)) return false;
    if (!block.unitId && block.cabinId) return false;
    if (block.unitId && String(block.unitId) === String(entity.unitId)) return true;
    return false;
  }
  return false;
}

/**
 * Compute sellable nights for a propertyKind over [from, to] inclusive Sofia dates.
 * Returns null occupancyDenominator when no operating periods cover any entity-night.
 */
async function computeSellableNights({
  propertyKind,
  fromDateOnly,
  toDateOnly,
  cabinId = null,
  cabinTypeId = null,
  unitId = null
} = {}) {
  const periods = await loadOperatingPeriods({ propertyKind });
  if (!periods.length) {
    return {
      sellableNights: null,
      occupancyDenominatorAvailable: false,
      reason: 'unknown_operating_start',
      entitySellable: [],
      excludedAggregateListings: [],
      excludedUnknownBlocks: 0,
      limitations: [
        'No InventoryOperatingPeriod rows configured. Occupancy cannot be verified.',
        'Mongo createdAt is not used as an operating start without explicit review.'
      ]
    };
  }

  const resolved = await resolveInventoryEntities(propertyKind);
  let entities = filterEntities(resolved.entities, { cabinId, cabinTypeId, unitId });

  if (!entities.length) {
    return {
      sellableNights: null,
      occupancyDenominatorAvailable: false,
      reason: 'no_inventory_entities',
      entitySellable: [],
      excludedAggregateListings: resolved.excludedAggregateListings,
      excludedUnknownBlocks: 0,
      limitations: ['No inventory entities matched the requested filters.']
    };
  }

  const cabinIds = [
    ...new Set(entities.map((e) => (e.cabinId ? String(e.cabinId) : null)).filter(Boolean))
  ];
  const unitIds = entities.map((e) => e.unitId).filter(Boolean);

  const blockQuery = {
    status: 'active',
    blockType: { $in: [...NON_SELLABLE_BLOCK_TYPES, 'external_hold'] },
    startDate: { $lt: moment.tz(toDateOnly, 'YYYY-MM-DD', PROPERTY_TIMEZONE).add(1, 'day').toDate() },
    endDate: { $gt: moment.tz(fromDateOnly, 'YYYY-MM-DD', PROPERTY_TIMEZONE).toDate() }
  };
  const or = [];
  if (cabinIds.length) or.push({ cabinId: { $in: cabinIds } });
  if (unitIds.length) or.push({ unitId: { $in: unitIds } });
  if (or.length) blockQuery.$or = or;

  const blocks = or.length ? await AvailabilityBlock.find(blockQuery).lean() : [];
  let excludedUnknownBlocks = 0;
  const verifiedBlocks = [];
  for (const b of blocks) {
    if (b.blockType === 'external_hold') {
      excludedUnknownBlocks += 1;
      continue;
    }
    if (NON_SELLABLE_BLOCK_TYPES.includes(b.blockType)) {
      verifiedBlocks.push(b);
    }
  }

  const entitySellable = [];
  let total = 0;
  let anyCovered = false;

  for (const entity of entities) {
    const entityPeriods = periodsForEntity(periods, entity, propertyKind);
    let sellable = 0;
    let coveredNights = 0;
    eachSofiaNightInclusive(fromDateOnly, toDateOnly, (_dateOnly, nightMoment) => {
      const covered = entityPeriods.some((p) => periodCoversNight(p, nightMoment));
      if (!covered) return;
      coveredNights += 1;
      anyCovered = true;
      const blocked = verifiedBlocks.some(
        (b) => blockMatchesEntity(b, entity) && blockCoversNight(b, nightMoment)
      );
      if (!blocked) sellable += 1;
    });

    entitySellable.push({
      entityType: entity.entityType,
      entityId: entity.entityId,
      displayName: entity.displayName,
      sellableNights: coveredNights === 0 ? null : sellable,
      coveredNights,
      cabinId: entity.cabinId ? String(entity.cabinId) : null,
      cabinTypeId: entity.cabinTypeId ? String(entity.cabinTypeId) : null,
      unitId: entity.unitId ? String(entity.unitId) : null
    });
    if (coveredNights > 0) total += sellable;
  }

  const limitations = anyCovered
    ? [
        'Sellable nights = operating nights minus verified maintenance and manual (owner/ops) blocks.',
        'Unidentified iCal external_hold blocks are not subtracted.',
        'Direct bookings only — Airbnb stays are excluded from occupied nights and revenue.',
        propertyKind === 'valley'
          ? 'Valley denominator mixes standalone Valley cabins and unit-backed inventory; multi/listing parent Cabins are excluded.'
          : null
      ].filter(Boolean)
    : [
        'Operating periods exist but do not cover the requested date range for matched inventory.',
        'Occupancy unavailable until operating periods are configured for this window.'
      ];

  return {
    sellableNights: anyCovered ? total : null,
    occupancyDenominatorAvailable: anyCovered,
    reason: anyCovered ? null : 'unknown_operating_start',
    entitySellable,
    excludedAggregateListings: resolved.excludedAggregateListings,
    excludedUnknownBlocks,
    limitations
  };
}

/**
 * Series of sellable nights by period key (day|week|month).
 */
async function computeSellableNightsSeries({
  propertyKind,
  fromDateOnly,
  toDateOnly,
  groupBy = 'month',
  cabinId = null,
  cabinTypeId = null,
  unitId = null
}) {
  const base = await computeSellableNights({
    propertyKind,
    fromDateOnly,
    toDateOnly,
    cabinId,
    cabinTypeId,
    unitId
  });
  if (!base.occupancyDenominatorAvailable) {
    return { ...base, seriesByPeriod: new Map() };
  }

  const { periodKeyForDate } = require('./stayNights');
  const seriesByPeriod = new Map();

  const periods = await loadOperatingPeriods({ propertyKind });
  const resolved = await resolveInventoryEntities(propertyKind);
  const entities = filterEntities(resolved.entities, { cabinId, cabinTypeId, unitId });

  const cabinIds = [
    ...new Set(entities.map((e) => (e.cabinId ? String(e.cabinId) : null)).filter(Boolean))
  ];
  const unitIds = entities.map((e) => e.unitId).filter(Boolean);
  const blockQuery = {
    status: 'active',
    blockType: { $in: NON_SELLABLE_BLOCK_TYPES },
    startDate: { $lt: moment.tz(toDateOnly, 'YYYY-MM-DD', PROPERTY_TIMEZONE).add(1, 'day').toDate() },
    endDate: { $gt: moment.tz(fromDateOnly, 'YYYY-MM-DD', PROPERTY_TIMEZONE).toDate() }
  };
  const or = [];
  if (cabinIds.length) or.push({ cabinId: { $in: cabinIds } });
  if (unitIds.length) or.push({ unitId: { $in: unitIds } });
  if (or.length) blockQuery.$or = or;

  const verifiedBlocks = or.length ? await AvailabilityBlock.find(blockQuery).lean() : [];

  for (const entity of entities) {
    const entityPeriods = periodsForEntity(periods, entity, propertyKind);
    eachSofiaNightInclusive(fromDateOnly, toDateOnly, (dateOnly, nightMoment) => {
      const covered = entityPeriods.some((p) => periodCoversNight(p, nightMoment));
      if (!covered) return;
      const blocked = verifiedBlocks.some(
        (b) => blockMatchesEntity(b, entity) && blockCoversNight(b, nightMoment)
      );
      if (blocked) return;
      const key = periodKeyForDate(dateOnly, groupBy);
      seriesByPeriod.set(key, (seriesByPeriod.get(key) || 0) + 1);
    });
  }

  return { ...base, seriesByPeriod };
}

module.exports = {
  NON_SELLABLE_BLOCK_TYPES,
  computeSellableNights,
  computeSellableNightsSeries,
  loadOperatingPeriods,
  resolveInventoryEntities,
  filterEntities,
  isMultiListingCabin
};
