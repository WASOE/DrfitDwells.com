/**
 * Pure Winter Village price calculator.
 * Uses proposed seasonal rates from winterVillageConfig — never live listing prices.
 */
import {
  CHILD_AGE_RULES,
  WINTER_VILLAGE_DEPOSIT,
  getWinterVillageProduct
} from './winterVillageConfig';

/**
 * @typedef {object} CalculatorInput
 * @property {string} productId
 * @property {string} accommodationId
 * @property {number} [nights]
 * @property {number} [guests] — stay / stone-house total guests
 * @property {number} [adults]
 * @property {number} [children4to12]
 * @property {number} [under4]
 * @property {boolean} [wellnessSelected]
 */

/**
 * @typedef {object} CalculatorResult
 * @property {number} total
 * @property {number} deposit
 * @property {number} balance
 * @property {string} depositLabel
 * @property {string} balanceLabel
 * @property {Array<{label: string, amount: number}>} lines
 * @property {string[]} warnings
 * @property {object} normalised
 */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toNonNegInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

/**
 * Normalise guest / night inputs against product + accommodation rules.
 * @param {CalculatorInput} input
 */
export function normaliseWinterVillageSelection(input) {
  const product = getWinterVillageProduct(input.productId);
  const accommodationId = input.accommodationId || 'a-frame';
  const unit = product.pricing.units[accommodationId];
  const warnings = [];

  let nights = product.nightsFixed ?? toNonNegInt(input.nights, product.defaultNights);
  if (product.nightsFixed == null) {
    const minNights = product.minNights || 1;
    if (nights < minNights) {
      nights = minNights;
      warnings.push(`Minimum stay is ${minNights} nights.`);
    }
  }

  let guests = toNonNegInt(input.guests, unit?.defaultGuests ?? unit?.guestsFixed ?? 2);
  let adults = toNonNegInt(input.adults, unit?.defaultAdults ?? 2);
  let children4to12 = toNonNegInt(input.children4to12, unit?.defaultChildren4to12 ?? 0);
  let under4 = toNonNegInt(input.under4, unit?.defaultUnder4 ?? 0);

  if (accommodationId === 'a-frame' || accommodationId === 'lux-cabin') {
    guests = unit?.guestsFixed ?? 2;
    adults = guests;
    children4to12 = 0;
    under4 = 0;
  }

  if (accommodationId === 'stone-house') {
    const min =
      unit?.minGuests ?? unit?.minOccupancy ?? 3;
    const max =
      unit?.maxGuests ?? unit?.maxOccupancy ?? 6;

    if (product.pricing.type === 'per-night') {
      if (guests < min) {
        guests = min;
        warnings.push(`Stone House minimum is ${min} people.`);
      }
      if (guests > max) {
        guests = max;
        warnings.push(`Stone House maximum is ${max} people.`);
      }
      adults = guests;
      children4to12 = 0;
      under4 = 0;
    } else {
      let occupancy = adults + children4to12 + under4;
      if (occupancy < min) {
        const needed = min - occupancy;
        adults += needed;
        occupancy = adults + children4to12 + under4;
        warnings.push(`Stone House minimum occupancy is ${min}.`);
      }
      if (occupancy > max) {
        let excess = occupancy - max;
        const reduceUnder4 = Math.min(under4, excess);
        under4 -= reduceUnder4;
        excess -= reduceUnder4;
        const reduceChildren = Math.min(children4to12, excess);
        children4to12 -= reduceChildren;
        excess -= reduceChildren;
        adults = Math.max(0, adults - excess);
        warnings.push(`Stone House maximum occupancy is ${max}.`);
      }
      guests = adults + children4to12 + under4;
    }
  }

  const wellnessSelected = Boolean(
    product.pricing.wellnessOptional && input.wellnessSelected
  );

  return {
    productId: product.id,
    accommodationId,
    nights,
    guests,
    adults,
    children4to12,
    under4,
    wellnessSelected,
    warnings,
    product,
    unit
  };
}

/**
 * @param {CalculatorInput} input
 * @returns {CalculatorResult}
 */
export function calculateWinterVillageTotal(input) {
  const normalised = normaliseWinterVillageSelection(input);
  const { product, unit, nights, guests, adults, children4to12, under4, wellnessSelected } =
    normalised;
  const lines = [];
  let total = 0;

  if (!unit) {
    return {
      total: 0,
      deposit: 0,
      balance: 0,
      depositLabel: WINTER_VILLAGE_DEPOSIT.depositLabel,
      balanceLabel: WINTER_VILLAGE_DEPOSIT.stayBalanceLabel,
      lines: [],
      warnings: [...normalised.warnings, 'Unknown accommodation option.'],
      normalised
    };
  }

  if (product.pricing.type === 'per-night') {
    if (unit.ratePerNight != null) {
      const amount = unit.ratePerNight * nights;
      lines.push({
        label: `${nights} night${nights === 1 ? '' : 's'} × €${unit.ratePerNight}`,
        amount
      });
      total += amount;
    } else if (unit.ratePerPersonPerNight != null) {
      const amount = unit.ratePerPersonPerNight * guests * nights;
      lines.push({
        label: `${guests} guest${guests === 1 ? '' : 's'} × ${nights} night${nights === 1 ? '' : 's'} × €${unit.ratePerPersonPerNight}`,
        amount
      });
      total += amount;
    }

    if (wellnessSelected && product.pricing.wellnessOptional) {
      const amount = product.pricing.wellnessOptional.pricePerBooking;
      lines.push({
        label: product.pricing.wellnessOptional.label,
        amount
      });
      total += amount;
    }
  } else if (unit.packagePrice != null) {
    lines.push({
      label: `Package for ${unit.guestsFixed || 2} people`,
      amount: unit.packagePrice
    });
    total += unit.packagePrice;
  } else {
    if (adults > 0) {
      const amount = adults * unit.adultPrice;
      lines.push({
        label: `${adults} adult${adults === 1 ? '' : 's'} × €${unit.adultPrice}`,
        amount
      });
      total += amount;
    }
    if (children4to12 > 0) {
      const amount = children4to12 * unit.childPrice;
      lines.push({
        label: `${children4to12} child${children4to12 === 1 ? '' : 'ren'} (ages ${CHILD_AGE_RULES.childMinAge}–${CHILD_AGE_RULES.childMaxAge}) × €${unit.childPrice}`,
        amount
      });
      total += amount;
    }
    if (under4 > 0 && unit.under4Free) {
      lines.push({
        label: `${under4} child${under4 === 1 ? '' : 'ren'} under ${CHILD_AGE_RULES.freeUnderAge} (free)`,
        amount: 0
      });
    }
  }

  const depositPercent = WINTER_VILLAGE_DEPOSIT.depositPercent / 100;
  const deposit = Math.round(total * depositPercent);
  const balance = total - deposit;
  const isChristmas = product.depositRule === 'christmas';

  return {
    total,
    deposit,
    balance,
    depositLabel: WINTER_VILLAGE_DEPOSIT.depositLabel,
    balanceLabel: isChristmas
      ? WINTER_VILLAGE_DEPOSIT.christmasBalanceLabel
      : WINTER_VILLAGE_DEPOSIT.stayBalanceLabel,
    lines,
    warnings: normalised.warnings,
    normalised
  };
}

export function formatEuro(amount) {
  return `€${Number(amount).toLocaleString('en-GB')}`;
}

/** Helper for UI steppers — apply clamp without mutating calculator output. */
export function clampStoneHouseOccupancy(adults, children4to12, under4, min, max) {
  let a = toNonNegInt(adults);
  let c = toNonNegInt(children4to12);
  let u = toNonNegInt(under4);
  let total = a + c + u;
  if (total < min) a += min - total;
  total = a + c + u;
  if (total > max) {
    let excess = total - max;
    const du = Math.min(u, excess);
    u -= du;
    excess -= du;
    const dc = Math.min(c, excess);
    c -= dc;
    excess -= dc;
    a = Math.max(0, a - excess);
  }
  return {
    adults: a,
    children4to12: c,
    under4: u,
    occupancy: a + c + u
  };
}

export { clamp };
