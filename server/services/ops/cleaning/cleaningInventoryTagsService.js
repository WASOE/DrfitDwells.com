const Cabin = require('../../../models/Cabin');
const CabinType = require('../../../models/CabinType');
const Unit = require('../../../models/Unit');
const { FIXTURE_CABIN_NAME_PATTERN } = require('../../../utils/fixtureExclusion');
const {
  CLEANING_TAG_VOCABULARY,
  sanitizeCleaningTags,
  inventoryHasPricingTag
} = require('../../../data/cleaning/cleaningTagVocabulary');

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function mapCabinRow(cabin) {
  const cleaningTags = Array.isArray(cabin.cleaningTags) ? cabin.cleaningTags : [];
  return {
    id: String(cabin._id),
    kind: 'cabin',
    name: cabin.name,
    propertyKind: cabin.propertyKind || 'cabin',
    cleaningTags,
    missingPricingTag:
      (cabin.propertyKind === 'valley' || cabin.propertyKind === 'cabin')
        ? !inventoryHasPricingTag(cleaningTags)
        : false
  };
}

function mapCabinTypeRow(cabinType) {
  const cleaningTags = Array.isArray(cabinType.cleaningTags) ? cabinType.cleaningTags : [];
  return {
    id: String(cabinType._id),
    kind: 'cabin_type',
    name: cabinType.name,
    slug: cabinType.slug,
    propertyKind: cabinType.propertyKind || 'valley',
    cleaningTags,
    missingPricingTag:
      cabinType.propertyKind === 'valley' ? !inventoryHasPricingTag(cleaningTags) : false
  };
}

async function getInventoryTagUsageSet() {
  const [cabins, cabinTypes] = await Promise.all([
    Cabin.find({
      name: { $not: FIXTURE_CABIN_NAME_PATTERN },
      $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }]
    })
      .select('cleaningTags propertyKind')
      .lean(),
    CabinType.find({ isActive: true }).select('cleaningTags propertyKind').lean()
  ]);

  const used = new Set();
  for (const row of [...cabins, ...cabinTypes]) {
    const { tags } = sanitizeCleaningTags(row.cleaningTags);
    tags.forEach((tag) => used.add(tag));
  }
  return used;
}

async function getCleaningInventoryTags({ propertyKind = null } = {}) {
  const archivedClause = { $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }] };
  const cabinFilter = {
    name: { $not: FIXTURE_CABIN_NAME_PATTERN },
    ...archivedClause
  };
  if (propertyKind) {
    cabinFilter.propertyKind = propertyKind;
  }

  const typeFilter = { isActive: true };
  if (propertyKind) {
    typeFilter.propertyKind = propertyKind;
  }

  const [cabins, cabinTypes, distinctTypeIds] = await Promise.all([
    Cabin.find(cabinFilter).sort({ propertyKind: 1, name: 1 }).select('name propertyKind cleaningTags').lean(),
    CabinType.find(typeFilter).sort({ propertyKind: 1, name: 1 }).select('name slug propertyKind cleaningTags').lean(),
    Unit.distinct('cabinTypeId')
  ]);

  const hasUnits = new Set(distinctTypeIds.map((id) => String(id)));
  const multiUnitTypes = cabinTypes.filter((ct) => hasUnits.has(String(ct._id)));

  const inventory = [
    ...cabins.map(mapCabinRow),
    ...multiUnitTypes.map(mapCabinTypeRow)
  ];

  const untaggedValley = inventory.filter(
    (row) => row.propertyKind === 'valley' && row.missingPricingTag
  );
  const untaggedCabin = inventory.filter(
    (row) => row.propertyKind === 'cabin' && row.missingPricingTag
  );

  return {
    vocabulary: [...CLEANING_TAG_VOCABULARY],
    inventory,
    untaggedValley,
    untaggedValleyCount: untaggedValley.length,
    untaggedCabin,
    untaggedCabinCount: untaggedCabin.length
  };
}

async function updateCabinCleaningTags(cabinId, cleaningTagsInput) {
  const cabin = await Cabin.findById(cabinId);
  if (!cabin) {
    throw createHttpError(404, 'Cabin not found.');
  }

  const { tags, rejected } = sanitizeCleaningTags(cleaningTagsInput);
  if (rejected.length > 0) {
    // Controlled vocabulary only — unknown tags are ignored, not persisted.
  }

  cabin.cleaningTags = tags;
  await cabin.save();

  return mapCabinRow(cabin.toObject());
}

async function updateCabinTypeCleaningTags(cabinTypeId, cleaningTagsInput) {
  const cabinType = await CabinType.findById(cabinTypeId);
  if (!cabinType) {
    throw createHttpError(404, 'Cabin type not found.');
  }

  const { tags, rejected } = sanitizeCleaningTags(cleaningTagsInput);
  if (rejected.length > 0) {
    // Controlled vocabulary only — unknown tags are ignored, not persisted.
  }

  cabinType.cleaningTags = tags;
  await cabinType.save();

  return mapCabinTypeRow(cabinType.toObject());
}

module.exports = {
  getInventoryTagUsageSet,
  getCleaningInventoryTags,
  updateCabinCleaningTags,
  updateCabinTypeCleaningTags
};
