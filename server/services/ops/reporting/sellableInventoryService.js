'use strict';

const moment = require('moment-timezone');
const InventoryOperatingPeriod = require('../../../models/InventoryOperatingPeriod');
const AvailabilityBlock = require('../../../models/AvailabilityBlock');
const Cabin = require('../../../models/Cabin');
const CabinType = require('../../../models/CabinType');
const Unit = require('../../../models/Unit');
const { PROPERTY_TIMEZONE } = require('../../../utils/dateTime');
const { eachSofiaNightInclusive } = require('./stayNights');

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

async function resolveInventoryEntities(propertyKind) {
  if (propertyKind === 'cabin') {
    const cabins = await Cabin.find({
      propertyKind: 'cabin',
      $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }],
      isActive: { $ne: false }
    })
      .select('_id name')
      .lean();
    return cabins.map((c) => ({
      entityType: 'cabin',
      entityId: String(c._id),
      displayName: c.name || String(c._id),
      cabinId: c._id,
      unitId: null
    }));
  }

  const types = await CabinType.find({ propertyKind: 'valley', isActive: { $ne: false } })
    .select('_id name')
    .lean();
  const typeIds = types.map((t) => t._id);
  const units = await Unit.find({ cabinTypeId: { $in: typeIds }, isActive: { $ne: false } })
    .select('_id unitNumber cabinTypeId')
    .lean();
  const typeName = new Map(types.map((t) => [String(t._id), t.name || String(t._id)]));
  return units.map((u) => ({
    entityType: 'unit',
    entityId: String(u._id),
    displayName: `${typeName.get(String(u.cabinTypeId)) || 'Valley'} · ${u.unitNumber || u._id}`,
    cabinId: null,
    cabinTypeId: u.cabinTypeId,
    unitId: u._id
  }));
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
      excludedUnknownBlocks: 0,
      limitations: [
        'No InventoryOperatingPeriod rows configured. Occupancy cannot be verified.',
        'Mongo createdAt is not used as an operating start without explicit review.'
      ]
    };
  }

  let entities = await resolveInventoryEntities(propertyKind);
  if (cabinId) {
    entities = entities.filter((e) => String(e.cabinId) === String(cabinId));
  }
  if (unitId) {
    entities = entities.filter((e) => String(e.unitId) === String(unitId));
  }
  if (cabinTypeId) {
    entities = entities.filter((e) => String(e.cabinTypeId) === String(cabinTypeId));
  }

  if (!entities.length) {
    return {
      sellableNights: null,
      occupancyDenominatorAvailable: false,
      reason: 'no_inventory_entities',
      entitySellable: [],
      excludedUnknownBlocks: 0,
      limitations: ['No inventory entities matched the requested filters.']
    };
  }

  const cabinIds = [
    ...new Set(entities.map((e) => (e.cabinId ? String(e.cabinId) : null)).filter(Boolean))
  ];
  // Valley units may share cabinType-level blocks keyed by a representative cabin — load by unitId too
  const unitIds = entities.map((e) => e.unitId).filter(Boolean);

  const blockQuery = {
    status: 'active',
    blockType: { $in: [...NON_SELLABLE_BLOCK_TYPES, 'external_hold'] },
    startDate: { $lt: moment.tz(toDateOnly, 'YYYY-MM-DD', PROPERTY_TIMEZONE).add(1, 'day').toDate() },
    endDate: { $gt: moment.tz(fromDateOnly, 'YYYY-MM-DD', PROPERTY_TIMEZONE).toDate() }
  };
  if (propertyKind === 'cabin' && cabinIds.length) {
    blockQuery.cabinId = { $in: cabinIds };
  } else if (unitIds.length) {
    blockQuery.$or = [{ unitId: { $in: unitIds } }, { cabinId: { $in: cabinIds } }];
  }

  const blocks = await AvailabilityBlock.find(blockQuery).lean();
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
    const entityPeriods = periods.filter((p) => {
      if (p.entityType === 'location' && propertyKind === 'valley') {
        return String(p.entityId) === 'valley' || String(p.entityId) === entity.entityId;
      }
      return p.entityType === entity.entityType && String(p.entityId) === String(entity.entityId);
    });

    // Also allow cabin_type periods to cover units
    if (entity.entityType === 'unit' && entity.cabinTypeId) {
      for (const p of periods) {
        if (p.entityType === 'cabin_type' && String(p.entityId) === String(entity.cabinTypeId)) {
          entityPeriods.push(p);
        }
      }
    }

    let sellable = 0;
    let coveredNights = 0;
    eachSofiaNightInclusive(fromDateOnly, toDateOnly, (dateOnly, nightMoment) => {
      const covered = entityPeriods.some((p) => periodCoversNight(p, nightMoment));
      if (!covered) return;
      coveredNights += 1;
      anyCovered = true;
      const blocked = verifiedBlocks.some((b) => {
        if (entity.cabinId && b.cabinId && String(b.cabinId) !== String(entity.cabinId)) return false;
        if (entity.unitId) {
          if (b.unitId && String(b.unitId) !== String(entity.unitId)) return false;
          if (!b.unitId && b.cabinId) return false;
        }
        return blockCoversNight(b, nightMoment);
      });
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

  return {
    sellableNights: anyCovered ? total : null,
    occupancyDenominatorAvailable: anyCovered,
    reason: anyCovered ? null : 'unknown_operating_start',
    entitySellable,
    excludedUnknownBlocks,
    limitations: anyCovered
      ? [
          'Sellable nights = operating nights minus verified maintenance and manual (owner/ops) blocks.',
          'Unidentified iCal external_hold blocks are not subtracted.',
          'Direct bookings only — Airbnb stays are excluded from occupied nights and revenue.'
        ]
      : [
          'Operating periods exist but do not cover the requested date range for matched inventory.',
          'Occupancy unavailable until operating periods are configured for this window.'
        ]
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

  // Recompute per-night attribution into period buckets (entity-summed).
  const periods = await loadOperatingPeriods({ propertyKind });
  let entities = await resolveInventoryEntities(propertyKind);
  if (cabinId) entities = entities.filter((e) => String(e.cabinId) === String(cabinId));
  if (unitId) entities = entities.filter((e) => String(e.unitId) === String(unitId));
  if (cabinTypeId) entities = entities.filter((e) => String(e.cabinTypeId) === String(cabinTypeId));

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
  if (propertyKind === 'cabin' && cabinIds.length) blockQuery.cabinId = { $in: cabinIds };
  else if (unitIds.length) blockQuery.$or = [{ unitId: { $in: unitIds } }];

  const verifiedBlocks = await AvailabilityBlock.find(blockQuery).lean();

  for (const entity of entities) {
    const entityPeriods = periods.filter(
      (p) => p.entityType === entity.entityType && String(p.entityId) === String(entity.entityId)
    );
    if (entity.entityType === 'unit' && entity.cabinTypeId) {
      for (const p of periods) {
        if (p.entityType === 'cabin_type' && String(p.entityId) === String(entity.cabinTypeId)) {
          entityPeriods.push(p);
        }
      }
    }
    eachSofiaNightInclusive(fromDateOnly, toDateOnly, (dateOnly, nightMoment) => {
      const covered = entityPeriods.some((p) => periodCoversNight(p, nightMoment));
      if (!covered) return;
      const blocked = verifiedBlocks.some((b) => {
        if (entity.cabinId && b.cabinId && String(b.cabinId) !== String(entity.cabinId)) return false;
        if (entity.unitId && b.unitId && String(b.unitId) !== String(entity.unitId)) return false;
        if (entity.unitId && !b.unitId) return false;
        return blockCoversNight(b, nightMoment);
      });
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
  resolveInventoryEntities
};
