'use strict';

const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const { WINTER_VILLAGE_INVENTORY } = require('../config/winterVillageCommercialCatalog');

function normalizedName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function findByStableIdentity(Model, lookup, session) {
  const options = session ? { session } : {};
  const bySlug = await Model.findOne({ slug: lookup.slug }, null, options).lean();
  if (bySlug) return bySlug;
  return Model.findOne(
    { name: new RegExp(`^${escapeRegex(normalizedName(lookup.name))}$`, 'i') },
    null,
    options
  ).lean();
}

async function resolveWinterVillageInventory({ session = null } = {}) {
  const aFrameType = await findByStableIdentity(
    CabinType,
    WINTER_VILLAGE_INVENTORY['a-frame'].lookup,
    session
  );
  const luxCabin = await findByStableIdentity(
    Cabin,
    WINTER_VILLAGE_INVENTORY['lux-cabin'].lookup,
    session
  );
  const stoneHouse = await findByStableIdentity(
    Cabin,
    WINTER_VILLAGE_INVENTORY['stone-house'].lookup,
    session
  );
  const aFrameUnits = aFrameType
    ? await Unit.find(
        { cabinTypeId: aFrameType._id, isActive: true },
        null,
        session ? { session } : {}
      ).lean()
    : [];

  return {
    'a-frame': {
      entityType: 'cabinType',
      entityId: aFrameType ? String(aFrameType._id) : null,
      document: aFrameType,
      resources: aFrameUnits
    },
    'lux-cabin': {
      entityType: 'cabin',
      entityId: luxCabin ? String(luxCabin._id) : null,
      document: luxCabin,
      resources: luxCabin ? [luxCabin] : []
    },
    'stone-house': {
      entityType: 'cabin',
      entityId: stoneHouse ? String(stoneHouse._id) : null,
      document: stoneHouse,
      resources: stoneHouse ? [stoneHouse] : []
    }
  };
}

function inventoryMappingIsUsable(mapping) {
  return Boolean(
    mapping &&
      mapping.entityId &&
      mapping.document &&
      mapping.document.isActive === true &&
      Array.isArray(mapping.resources) &&
      mapping.resources.length > 0
  );
}

module.exports = {
  normalizedName,
  escapeRegex,
  resolveWinterVillageInventory,
  inventoryMappingIsUsable
};
