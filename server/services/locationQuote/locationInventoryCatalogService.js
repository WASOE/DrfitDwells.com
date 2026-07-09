const Cabin = require('../../models/Cabin');
const CabinType = require('../../models/CabinType');
const { resolveLocationTargets } = require('../ops/domain/locationInventoryService');
const { createDomainError } = require('../ops/domain/errors');
const { resolveCabinSlugFromDoc } = require('../../utils/staySlug');
const {
  resolveBuyoutRatePerNight,
  calculateFlatBuyoutLodgingSubtotal
} = require('./locationBuyoutPricing');
const {
  normalizeBedConfig,
  resolveSleepsFromBedConfig
} = require('../../utils/bedSleeps');
const { getPublicSlugForLocationKey } = require('./locationSlugRegistry');

const PRICE_DISCLAIMER =
  'Estimated lodging total for exclusive use of The Valley. Transport, activities, food, and custom arrangements are quoted separately.';

/**
 * Date-independent inventory catalog for a whole-location buyout.
 * No availability, conflict checks, or holds.
 *
 * @param {{ targets: object[] }} inventory — from resolveLocationTargets
 */
async function buildLocationInventoryCatalog(inventory) {
  const singleCabinIds = inventory.targets
    .filter((t) => t.kind === 'single_cabin')
    .map((t) => t.cabinId);
  const cabinTypeIds = [
    ...new Set(inventory.targets.filter((t) => t.kind === 'unit').map((t) => String(t.cabinTypeId)))
  ];

  const [cabins, cabinTypes] = await Promise.all([
    singleCabinIds.length
      ? Cabin.find({ _id: { $in: singleCabinIds } })
          .select(
            'name slug capacity pricePerNight buyoutPricePerNight minNights bedConfig propertyKind'
          )
          .lean()
      : [],
    cabinTypeIds.length
      ? CabinType.find({ _id: { $in: cabinTypeIds } })
          .select(
            'name slug capacity pricePerNight buyoutPricePerNight minNights bedConfig propertyKind'
          )
          .lean()
      : []
  ]);

  const cabinById = new Map(cabins.map((c) => [String(c._id), c]));
  const cabinTypeById = new Map(cabinTypes.map((ct) => [String(ct._id), ct]));

  const unitCountByType = new Map();
  for (const target of inventory.targets) {
    if (target.kind === 'unit') {
      const key = String(target.cabinTypeId);
      unitCountByType.set(key, (unitCountByType.get(key) || 0) + 1);
    }
  }

  let maxMinNights = 1;
  let totalSleeps = 0;
  const includedTargets = [];

  for (const target of inventory.targets) {
    if (target.kind !== 'single_cabin') continue;
    const cabin = cabinById.get(String(target.cabinId));
    if (!cabin) continue;

    const slug = resolveCabinSlugFromDoc(cabin);
    const bedConfig = normalizeBedConfig(cabin.bedConfig);
    const sleeps = resolveSleepsFromBedConfig(bedConfig, cabin.capacity || 0);
    totalSleeps += sleeps;
    maxMinNights = Math.max(maxMinNights, cabin.minNights || 1);

    includedTargets.push({
      name: cabin.name,
      kind: 'single_cabin',
      slug,
      unitCount: 1,
      capacity: cabin.capacity || 0,
      bedConfig,
      sleeps,
      buyoutRatePerNight: resolveBuyoutRatePerNight(cabin)
    });
  }

  for (const [typeId, unitCount] of unitCountByType) {
    const cabinType = cabinTypeById.get(typeId);
    if (!cabinType) continue;

    const bedConfig = normalizeBedConfig(cabinType.bedConfig);
    const perUnitSleeps = resolveSleepsFromBedConfig(bedConfig, cabinType.capacity || 0);
    totalSleeps += perUnitSleeps * unitCount;
    maxMinNights = Math.max(maxMinNights, cabinType.minNights || 1);

    includedTargets.push({
      name: cabinType.name,
      kind: 'cabin_type_units',
      slug: cabinType.slug,
      unitCount,
      capacity: cabinType.capacity || 0,
      bedConfig,
      sleeps: perUnitSleeps * unitCount,
      buyoutRatePerNight: resolveBuyoutRatePerNight(cabinType)
    });
  }

  includedTargets.sort((a, b) => a.name.localeCompare(b.name));

  const buildingCount = includedTargets.reduce((sum, row) => sum + row.unitCount, 0);

  return {
    maxMinNights,
    totalSleeps,
    buildingCount,
    includedTargets
  };
}

/**
 * Compute the bookable "from" floor from flat buyout rates (no seasonal calendar today).
 *
 * @param {{ includedTargets: object[], maxMinNights: number }} catalog
 */
function computeLocationFromPrice(catalog) {
  const nightlyTotal = Math.round(
    catalog.includedTargets.reduce(
      (sum, row) => sum + row.buyoutRatePerNight * row.unitCount,
      0
    ) * 100
  ) / 100;

  const fromNights = Math.max(1, catalog.maxMinNights || 1);
  const amount =
    Math.round(
      calculateFlatBuyoutLodgingSubtotal(nightlyTotal, fromNights, 1) * 100
    ) / 100;

  return {
    label: 'from',
    amount,
    currency: 'EUR',
    nights: fromNights,
    nightlyTotal,
    basis: fromNights > 1 ? 'minimum_stay' : 'per_night',
    hasSeasonalCalendar: false,
    derivation: 'flat_buyout_rates'
  };
}

/**
 * @param {string} locationKey
 */
async function buildPublicLocationInventory(locationKey) {
  const inventory = await resolveLocationTargets(locationKey);
  if (inventory.inventoryGaps.length > 0) {
    throw createDomainError(
      'validation',
      'Location inventory is incomplete',
      { inventoryGaps: inventory.inventoryGaps },
      422
    );
  }

  const catalog = await buildLocationInventoryCatalog(inventory);
  const fromPrice = computeLocationFromPrice(catalog);
  const locationSlug = getPublicSlugForLocationKey(locationKey);

  return {
    locationKey,
    locationSlug,
    locationLabel: inventory.locationLabel,
    currency: 'EUR',
    totalSleeps: catalog.totalSleeps,
    buildingCount: catalog.buildingCount,
    maxMinNights: catalog.maxMinNights,
    includedTargets: catalog.includedTargets,
    fromPrice,
    priceDisclaimer: PRICE_DISCLAIMER
  };
}

module.exports = {
  buildLocationInventoryCatalog,
  computeLocationFromPrice,
  buildPublicLocationInventory
};
