const moment = require('moment');
const Cabin = require('../../models/Cabin');
const CabinType = require('../../models/CabinType');
const { resolveCabinSlugFromDoc } = require('../../utils/staySlug');
const {
  resolveBuyoutRatePerNight,
  calculateFlatBuyoutLodgingSubtotal
} = require('./locationBuyoutPricing');
const {
  normalizeBedConfig,
  resolveSleepsFromBedConfig
} = require('../../utils/bedSleeps');

const PRICE_DISCLAIMER =
  'Estimated lodging total for exclusive use of The Valley. Transport, activities, food, and custom arrangements are quoted separately.';

/**
 * Build flat buyout lodging breakdown for all inventory targets at a location.
 * Guest count is informational only and never affects price.
 */
async function buildLocationLodgingQuote({ inventory, checkInDate, checkOutDate }) {
  const nights = moment(checkOutDate).diff(moment(checkInDate), 'days');

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

  for (const cabin of cabins) {
    const slug = resolveCabinSlugFromDoc(cabin);
    const bedConfig = normalizeBedConfig(cabin.bedConfig);
    const sleeps = resolveSleepsFromBedConfig(bedConfig, cabin.capacity || 0);
    totalSleeps += sleeps;
    maxMinNights = Math.max(maxMinNights, cabin.minNights || 1);

    const buyoutRatePerNight = resolveBuyoutRatePerNight(cabin);
    const lodgingSubtotal = calculateFlatBuyoutLodgingSubtotal(buyoutRatePerNight, nights, 1);

    includedTargets.push({
      name: cabin.name,
      kind: 'single_cabin',
      slug,
      unitCount: 1,
      capacity: cabin.capacity || 0,
      bedConfig,
      sleeps,
      buyoutRatePerNight,
      pricingModel: 'flat_buyout',
      lodgingSubtotal,
      nights
    });
  }

  for (const [typeId, unitCount] of unitCountByType) {
    const cabinType = cabinTypeById.get(typeId);
    if (!cabinType) continue;

    const bedConfig = normalizeBedConfig(cabinType.bedConfig);
    const perUnitSleeps = resolveSleepsFromBedConfig(bedConfig, cabinType.capacity || 0);
    totalSleeps += perUnitSleeps * unitCount;
    maxMinNights = Math.max(maxMinNights, cabinType.minNights || 1);

    const buyoutRatePerNight = resolveBuyoutRatePerNight(cabinType);
    const lodgingSubtotal = calculateFlatBuyoutLodgingSubtotal(
      buyoutRatePerNight,
      nights,
      unitCount
    );

    includedTargets.push({
      name: cabinType.name,
      kind: 'cabin_type_units',
      slug: cabinType.slug,
      unitCount,
      capacity: cabinType.capacity || 0,
      bedConfig,
      sleeps: perUnitSleeps * unitCount,
      buyoutRatePerNight,
      pricingModel: 'flat_buyout',
      lodgingSubtotal,
      nights
    });
  }

  includedTargets.sort((a, b) => a.name.localeCompare(b.name));

  const lodgingSubtotal =
    Math.round(includedTargets.reduce((sum, row) => sum + row.lodgingSubtotal, 0) * 100) / 100;

  return {
    ok: true,
    nights,
    maxMinNights,
    totalSleeps,
    lodgingSubtotal,
    totalPrice: lodgingSubtotal,
    includedTargets,
    priceDisclaimer: PRICE_DISCLAIMER
  };
}

/**
 * Per physical inventory target (one row per unit for A-frames) with flat buyout share.
 */
function buildPerTargetBuyoutShares({ inventory, entityByTargetKey, nights }) {
  const shares = [];
  for (const target of inventory.targets) {
    let entity = null;
    const label = target.label;
    let slug = null;

    if (target.kind === 'single_cabin') {
      entity = entityByTargetKey.get(`cabin:${String(target.cabinId)}`);
      slug = entity ? resolveCabinSlugFromDoc(entity) : null;
    } else if (target.kind === 'unit') {
      entity = entityByTargetKey.get(`cabinType:${String(target.cabinTypeId)}`);
      slug = entity?.slug || null;
    }

    const buyoutRatePerNight = resolveBuyoutRatePerNight(entity);
    const childPriceShare = calculateFlatBuyoutLodgingSubtotal(buyoutRatePerNight, nights, 1);

    shares.push({
      targetKey: target.targetKey,
      kind: target.kind,
      label,
      slug,
      cabinId: target.cabinId,
      cabinTypeId: target.cabinTypeId || null,
      unitId: target.unitId || null,
      buyoutRatePerNight,
      childPriceShare
    });
  }
  return shares;
}

module.exports = {
  PRICE_DISCLAIMER,
  buildLocationLodgingQuote,
  buildPerTargetBuyoutShares,
  normalizeBedConfig,
  resolveSleepsFromBedConfig
};
