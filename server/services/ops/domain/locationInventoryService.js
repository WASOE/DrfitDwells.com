const Cabin = require('../../../models/Cabin');
const CabinType = require('../../../models/CabinType');
const Unit = require('../../../models/Unit');
const { findParentCabinForCabinType } = require('../../publicAvailabilityService');
const { FIXTURE_CABIN_NAME_PATTERN } = require('../../../utils/fixtureExclusion');
const { getLocationEntry } = require('./locationRegistry');
const { createDomainError } = require('./errors');

function buildTargetKey(kind, id) {
  return `${kind}:${String(id)}`;
}

/**
 * @typedef {object} LocationInventoryTarget
 * @property {string} targetKey
 * @property {'single_cabin'|'unit'} kind
 * @property {string} label
 * @property {import('mongoose').Types.ObjectId} cabinId
 * @property {import('mongoose').Types.ObjectId|null} unitId
 * @property {import('mongoose').Types.ObjectId|null} cabinTypeId
 */

/**
 * Resolve every blockable inventory row for a location key.
 * Multi parent Cabin stubs are excluded; A-frame units are individual targets.
 *
 * @param {string} locationKey
 * @returns {Promise<{ locationKey: string, locationLabel: string, propertyKind: string, targets: LocationInventoryTarget[], inventoryGaps: object[] }>}
 */
async function resolveLocationTargets(locationKey) {
  const { locationKey: key, propertyKind, label } = getLocationEntry(locationKey);
  const archivedClause = { $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }] };
  const fixtureExclusion = { name: { $not: FIXTURE_CABIN_NAME_PATTERN } };

  const [singleCabins, cabinTypes] = await Promise.all([
    Cabin.find({
      propertyKind,
      inventoryType: { $ne: 'multi' },
      isActive: true,
      ...fixtureExclusion,
      ...archivedClause
    })
      .select('_id name')
      .sort({ name: 1 })
      .lean(),
    CabinType.find({
      propertyKind,
      isActive: { $ne: false }
    })
      .select('_id name slug')
      .sort({ name: 1 })
      .lean()
  ]);

  /** @type {LocationInventoryTarget[]} */
  const targets = [];
  /** @type {object[]} */
  const inventoryGaps = [];

  for (const cabin of singleCabins) {
    targets.push({
      targetKey: buildTargetKey('cabin', cabin._id),
      kind: 'single_cabin',
      label: cabin.name,
      cabinId: cabin._id,
      unitId: null,
      cabinTypeId: null
    });
  }

  if (cabinTypes.length > 0) {
    const typeIds = cabinTypes.map((ct) => ct._id);
    const units = await Unit.find({ cabinTypeId: { $in: typeIds }, isActive: { $ne: false } })
      .select('_id cabinTypeId unitNumber displayName')
      .sort({ unitNumber: 1 })
      .lean();

    const unitsByType = new Map();
    for (const unit of units) {
      const typeKey = String(unit.cabinTypeId);
      if (!unitsByType.has(typeKey)) unitsByType.set(typeKey, []);
      unitsByType.get(typeKey).push(unit);
    }

    for (const cabinType of cabinTypes) {
      const parentCabin = await findParentCabinForCabinType(cabinType._id);
      if (!parentCabin?._id) {
        inventoryGaps.push({
          kind: 'missing_parent_cabin',
          cabinTypeId: String(cabinType._id),
          cabinTypeName: cabinType.name,
          message: `No active parent Cabin found for ${cabinType.name}`
        });
        continue;
      }

      const typeUnits = unitsByType.get(String(cabinType._id)) || [];
      for (const unit of typeUnits) {
        const unitLabel = unit.displayName || unit.unitNumber || `Unit ${unit._id}`;
        targets.push({
          targetKey: buildTargetKey('unit', unit._id),
          kind: 'unit',
          label: `${cabinType.name} — ${unitLabel}`,
          cabinId: parentCabin._id,
          unitId: unit._id,
          cabinTypeId: cabinType._id
        });
      }
    }
  }

  if (targets.length === 0 && inventoryGaps.length === 0) {
    throw createDomainError(
      'validation',
      `No active inventory found for location "${key}"`,
      { locationKey: key },
      422
    );
  }

  return {
    locationKey: key,
    locationLabel: label,
    propertyKind,
    targets,
    inventoryGaps
  };
}

module.exports = {
  resolveLocationTargets,
  buildTargetKey
};
