const moment = require('moment');
const Cabin = require('../../models/Cabin');
const CabinType = require('../../models/CabinType');
const { calculateBaseLodgingPrice } = require('../pricingService');
const { resolveCabinSlugFromDoc } = require('../../utils/staySlug');

const PRICE_DISCLAIMER =
  'Estimated lodging total. Transport, activities, food, and custom arrangements are quoted separately.';

/**
 * Build lodging-only price breakdown for all inventory targets at a location.
 *
 * @param {object} params
 * @param {object} params.inventory — resolveLocationTargets result
 * @param {Date} params.checkInDate
 * @param {Date} params.checkOutDate
 * @param {number} params.adults
 * @param {number} params.children
 */
async function buildLocationLodgingQuote({
  inventory,
  checkInDate,
  checkOutDate,
  adults,
  children
}) {
  const adultsNum = Math.max(0, parseInt(adults, 10) || 0);
  const childrenNum = Math.max(0, parseInt(children, 10) || 0);
  const totalGuests = adultsNum + childrenNum;
  const nights = moment(checkOutDate).diff(moment(checkInDate), 'days');

  const singleCabinIds = inventory.targets
    .filter((t) => t.kind === 'single_cabin')
    .map((t) => t.cabinId);
  const cabinTypeIds = [
    ...new Set(inventory.targets.filter((t) => t.kind === 'unit').map((t) => String(t.cabinTypeId)))
  ];

  const [cabins, cabinTypes] = await Promise.all([
    singleCabinIds.length
      ? Cabin.find({ _id: { $in: singleCabinIds } }).lean()
      : [],
    cabinTypeIds.length
      ? CabinType.find({ _id: { $in: cabinTypeIds } }).lean()
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
  let maxGuests = 0;
  let requiresGuests = false;
  const includedAccommodations = [];

  for (const cabin of cabins) {
    const pricingModel = cabin.pricingModel || 'per_night';
    if (pricingModel === 'per_person') {
      requiresGuests = true;
      const minG = cabin.minGuests || 1;
      if (totalGuests < minG) {
        return {
          ok: false,
          status: 400,
          message: `${cabin.name} requires at least ${minG} guest${minG !== 1 ? 's' : ''} for pricing.`
        };
      }
    }

    maxMinNights = Math.max(maxMinNights, cabin.minNights || 1);
    maxGuests += cabin.capacity || 0;

    const lodgingSubtotal = calculateBaseLodgingPrice(
      cabin,
      checkInDate,
      checkOutDate,
      adultsNum,
      childrenNum
    );

    const row = {
      kind: 'single_cabin',
      slug: resolveCabinSlugFromDoc(cabin),
      label: cabin.name,
      pricePerNight: cabin.pricePerNight || 0,
      pricingModel,
      lodgingSubtotal,
      nights
    };

    if (pricingModel === 'per_person') {
      row.guestsUsed = Math.max(totalGuests, cabin.minGuests || 1);
    }

    includedAccommodations.push(row);
  }

  for (const [typeId, unitCount] of unitCountByType) {
    const cabinType = cabinTypeById.get(typeId);
    if (!cabinType) continue;

    const pricingModel = cabinType.pricingModel || 'per_night';
    if (pricingModel === 'per_person') {
      requiresGuests = true;
      const minG = cabinType.minGuests || 1;
      if (totalGuests < minG) {
        return {
          ok: false,
          status: 400,
          message: `${cabinType.name} requires at least ${minG} guest${minG !== 1 ? 's' : ''} for pricing.`
        };
      }
    }

    maxMinNights = Math.max(maxMinNights, cabinType.minNights || 1);
    maxGuests += (cabinType.capacity || 0) * unitCount;

    const perUnitLodging = calculateBaseLodgingPrice(
      cabinType,
      checkInDate,
      checkOutDate,
      adultsNum,
      childrenNum
    );
    const lodgingSubtotal = Math.round(perUnitLodging * unitCount * 100) / 100;

    const row = {
      kind: 'cabin_type_units',
      slug: cabinType.slug,
      label: cabinType.name,
      unitCount,
      pricePerNight: cabinType.pricePerNight || 0,
      pricingModel,
      lodgingSubtotal,
      nights
    };

    if (pricingModel === 'per_person') {
      row.guestsUsed = Math.max(totalGuests, cabinType.minGuests || 1);
    }

    includedAccommodations.push(row);
  }

  includedAccommodations.sort((a, b) => a.label.localeCompare(b.label));

  const lodgingSubtotal =
    Math.round(includedAccommodations.reduce((sum, row) => sum + row.lodgingSubtotal, 0) * 100) / 100;

  return {
    ok: true,
    nights,
    maxMinNights,
    maxGuests,
    requiresGuests,
    lodgingSubtotal,
    totalPrice: lodgingSubtotal,
    includedAccommodations,
    priceDisclaimer: PRICE_DISCLAIMER
  };
}

module.exports = {
  PRICE_DISCLAIMER,
  buildLocationLodgingQuote
};
