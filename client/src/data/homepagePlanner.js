import { formatDateOnlyLocal } from '../utils/dateOnly';
import { localizePath } from '../utils/localizedRoutes';

/** Published stay paths. Capacity matches the fixed overnight inventory. */
export const STAY_MATCHES = Object.freeze({
  cabin: Object.freeze({ path: '/stays/the-cabin', explorePath: '/cabin', maxGuests: 2 }),
  aframe: Object.freeze({ path: '/stays/a-frame', explorePath: '/valley', maxGuests: 2 }),
  lux: Object.freeze({ path: '/stays/lux-cabin', explorePath: '/valley', maxGuests: 2 }),
  stone: Object.freeze({ path: '/stays/stone-house', explorePath: '/valley', maxGuests: 6 }),
  /** Several Valley units for one party. Not a single bookable stay. */
  combination: Object.freeze({ path: '/valley', explorePath: '/valley', maxGuests: 18 }),
  buyout: Object.freeze({
    path: '/retreats/the-valley',
    explorePath: '/retreats/the-valley',
    maxGuests: 18,
  }),
});

/**
 * Verified overnight inventory. The Cabin is a separate property (offline, two guests)
 * and is never part of a Valley combination. Valley = 5*2 + 2 + 6 = 18.
 */
export const VALLEY_INVENTORY = Object.freeze({
  aframe: Object.freeze({ units: 5, perUnit: 2 }),
  lux: Object.freeze({ units: 1, perUnit: 2 }),
  stone: Object.freeze({ units: 1, perUnit: 6 }),
});
export const VALLEY_CAPACITY = 18;
const STONE_CAPACITY = 6;
const TWO_PERSON_UNITS = VALLEY_INVENTORY.aframe.units + VALLEY_INVENTORY.lux.units;
/** From this party size the plan is essentially the full Valley. */
const FULL_INVENTORY_FROM = 17;

/** Exact overnight guest counts offered in the planner (not bucket labels). */
export const PLANNER_PARTY_OPTIONS = Object.freeze(
  Array.from({ length: 18 }, (_, index) => String(index + 1))
);

const STEP_PARTY = Object.freeze({ id: 'party', options: PLANNER_PARTY_OPTIONS });
const STEP_SHARING = Object.freeze({
  id: 'sharing',
  options: Object.freeze(['share', 'pairs', 'own']),
});
const STEP_EXCLUSIVITY = Object.freeze({
  id: 'exclusivity',
  options: Object.freeze(['no', 'yes']),
});
const STEP_MOOD = Object.freeze({
  id: 'mood',
  options: Object.freeze(['quiet', 'couple', 'nature', 'group']),
});
const STEP_CONNECTIVITY = Object.freeze({
  id: 'connectivity',
  options: Object.freeze(['none', 'some', 'either']),
});
const STEP_NIGHTS = Object.freeze({
  id: 'nights',
  options: Object.freeze(['2', '3', '4', '1']),
});

/** Short flow for one or two guests. */
export const PLANNER_STEPS = Object.freeze([
  STEP_PARTY,
  STEP_MOOD,
  STEP_CONNECTIVITY,
  STEP_NIGHTS,
]);

/** Extra flow for three or more guests. */
export const PLANNER_GROUP_STEPS = Object.freeze([
  STEP_PARTY,
  STEP_SHARING,
  STEP_EXCLUSIVITY,
  STEP_MOOD,
  STEP_CONNECTIVITY,
  STEP_NIGHTS,
]);

const FULL_INVENTORY_STEPS = PLANNER_STEPS;

/**
 * Dynamic step list. One or two guests keep the original four questions. From three
 * guests we also ask about sharing and exclusivity. At 17-18 the plan is the whole
 * Valley, so those two questions are skipped.
 */
export function getPlannerSteps(party) {
  const count = parseGuestCount(party);
  if (count == null || count < 3) return PLANNER_STEPS;
  if (count >= FULL_INVENTORY_FROM) return FULL_INVENTORY_STEPS;
  return PLANNER_GROUP_STEPS;
}

export function parseGuestCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 1) return null;
  return Math.floor(count);
}

export function capacityForStay(stayId) {
  return STAY_MATCHES[stayId]?.maxGuests ?? null;
}

export function capacityExceeded(stayId, party) {
  const max = capacityForStay(stayId);
  const count = parseGuestCount(party);
  if (max == null || count == null) return false;
  return count > max;
}

const UNIT_ORDER = ['stone', 'aframe', 'lux'];

function unitCapacity(id) {
  if (id === 'cabin') return 2;
  return VALLEY_INVENTORY[id]?.perUnit ?? 0;
}

function capacityOfUnits(units) {
  return units.reduce((sum, unit) => sum + unitCapacity(unit.id) * unit.count, 0);
}

/**
 * Spread guests over two-person units: A-frames first, then the Luxury Cabin.
 * `perUnitGuests` lists how many guests each unit holds, fullest first.
 */
function twoPersonUnits(perUnitGuests) {
  const units = [];
  const aframes = perUnitGuests.slice(0, VALLEY_INVENTORY.aframe.units);
  const lux = perUnitGuests.slice(VALLEY_INVENTORY.aframe.units, TWO_PERSON_UNITS);
  if (aframes.length) {
    units.push({ id: 'aframe', count: aframes.length, guests: aframes.reduce((a, b) => a + b, 0) });
  }
  if (lux.length) {
    units.push({ id: 'lux', count: lux.length, guests: lux.reduce((a, b) => a + b, 0) });
  }
  return units;
}

function sortUnits(units) {
  return [...units].sort((a, b) => UNIT_ORDER.indexOf(a.id) - UNIT_ORDER.indexOf(b.id));
}

function perUnitFor(guests) {
  const list = [];
  let left = guests;
  while (left > 0) {
    const here = Math.min(2, left);
    list.push(here);
    left -= here;
  }
  return list;
}

/** Stone House first for the shared plan, then the fewest two-person units for the rest. */
function sharedAllocation(party) {
  const inStone = Math.min(party, STONE_CAPACITY);
  const rest = party - inStone;
  const units = [{ id: 'stone', count: 1, guests: inStone }];
  if (rest > 0) units.push(...twoPersonUnits(perUnitFor(rest)));
  return units;
}

/** Private places: one two-person unit per pair, one per single guest. */
function privateUnitsNeeded(party, sharing, couples) {
  const maxPairs = Math.floor(party / 2);
  let pairs = sharing === 'own' ? 0 : maxPairs;
  if (sharing !== 'own' && couples != null && Number.isFinite(Number(couples))) {
    pairs = Math.min(maxPairs, Math.max(0, Math.floor(Number(couples))));
  }
  const singles = party - pairs * 2;
  return { pairs, singles, needed: pairs + singles };
}

function privateAllocation(party, sharing, couples) {
  const { pairs, singles, needed } = privateUnitsNeeded(party, sharing, couples);
  if (needed > TWO_PERSON_UNITS) return null;
  const perUnit = [...Array(pairs).fill(2), ...Array(singles).fill(1)];
  return twoPersonUnits(perUnit);
}

function finish({
  stayId,
  party,
  units,
  whyKey,
  alternative = null,
  upgradeBuyout = false,
  bookingMode,
  offlineMismatch,
  privacyRelaxed = false,
}) {
  const capacityTotal = stayId === 'buyout' ? VALLEY_CAPACITY : capacityOfUnits(units);
  return {
    stayId,
    party,
    /** Exact adults for booking handoff — never clamped to a smaller capacity. */
    searchAdults: party,
    units,
    capacityTotal,
    capacityMax: capacityTotal,
    capacityExceeded: party > capacityTotal,
    whyKey,
    alternative,
    upgradeBuyout,
    bookingMode,
    offlineMismatch,
    privacyRelaxed,
  };
}

function buyoutResult(party, whyKey, offlineMismatch) {
  return finish({
    stayId: 'buyout',
    party,
    // Whole Valley: every unit, shown at its sleeping capacity.
    units: [
      { id: 'stone', count: 1, guests: STONE_CAPACITY },
      { id: 'lux', count: 1, guests: VALLEY_INVENTORY.lux.perUnit },
      {
        id: 'aframe',
        count: VALLEY_INVENTORY.aframe.units,
        guests: VALLEY_INVENTORY.aframe.units * VALLEY_INVENTORY.aframe.perUnit,
      },
    ],
    whyKey,
    alternative: party <= 16 ? 'combination' : null,
    bookingMode: 'buyout',
    offlineMismatch,
  });
}

function singleResult(stayId, party, whyKey, alternative, offlineMismatch) {
  return finish({
    stayId,
    party,
    units: [{ id: stayId, count: 1, guests: party }],
    whyKey,
    alternative,
    bookingMode: 'single',
    offlineMismatch,
  });
}

/**
 * Deterministic accommodation engine. Capacity wins, the exact party size is never
 * clamped or falsified, and we use the fewest units that fit — never extra units to
 * raise value. The Cabin (offline, two guests) is never part of a Valley combination.
 *
 * Inputs: party, mood, connectivity, plus for three or more guests
 * `sharing` ('share' | 'pairs' | 'own'), `exclusivity` ('yes' | 'no') and an
 * optional `couples` count for the 'pairs' preference.
 */
export function recommendStay({
  party,
  mood,
  connectivity,
  sharing = 'share',
  exclusivity = 'no',
  couples,
}) {
  const count = parseGuestCount(party) || 2;
  const offline = connectivity === 'none';

  // 1. Whole Valley: asked for, or the party needs essentially all of it.
  if (exclusivity === 'yes' || count >= FULL_INVENTORY_FROM) {
    return buyoutResult(count, count >= FULL_INVENTORY_FROM ? 'buyoutFull' : 'buyoutChosen', offline);
  }

  // 2. One or two guests: single stay by mood and connectivity.
  if (count <= 2) {
    let stayId;
    if (offline || mood === 'quiet' || mood === 'couple') stayId = 'cabin';
    else if (mood === 'nature') stayId = 'aframe';
    else stayId = 'lux';
    if (connectivity === 'some' && stayId === 'cabin') stayId = 'lux';

    const why = {
      cabin: offline ? 'cabinOffline' : 'cabinQuiet',
      aframe: 'aframeNature',
      lux: connectivity === 'some' ? 'luxConnected' : 'luxDefault',
    }[stayId];
    const alternative = { cabin: 'cabinToValley', aframe: 'aframeToLux', lux: 'luxToAframe' }[stayId];
    return singleResult(stayId, count, why, alternative, offline && stayId !== 'cabin');
  }

  // 3. Valley units for three or more guests.
  if (sharing === 'share') {
    const units = sharedAllocation(count);
    if (units.length === 1) {
      return singleResult('stone', count, connectivity === 'some' ? 'stoneStarlink' : 'stoneShared', 'privateUnits', offline);
    }
    return finish({
      stayId: 'combination',
      party: count,
      units: sortUnits(units),
      whyKey: 'stoneAndCabins',
      alternative: 'privateUnits',
      upgradeBuyout: count >= 10,
      bookingMode: 'enquiry',
      offlineMismatch: offline,
    });
  }

  // Private places: pairs or everyone on their own.
  const privateUnits = privateAllocation(count, sharing, couples);
  if (!privateUnits) {
    // More private places than the Valley has: keep pairs together with the Stone House.
    return finish({
      stayId: 'combination',
      party: count,
      units: sortUnits(sharedAllocation(count)),
      whyKey: 'privacyRelaxed',
      alternative: null,
      upgradeBuyout: true,
      bookingMode: 'enquiry',
      offlineMismatch: offline,
      privacyRelaxed: true,
    });
  }
  const unitTotal = privateUnits.reduce((sum, unit) => sum + unit.count, 0);
  const unitsSorted = sortUnits(privateUnits);
  const why = connectivity === 'some' ? 'privateNoStarlink' : sharing === 'own' ? 'privateOwn' : 'privatePairs';
  const alternative = count <= STONE_CAPACITY ? 'sharedStone' : null;
  if (unitTotal === 1) {
    return singleResult(unitsSorted[0].id, count, why, alternative, offline);
  }
  return finish({
    stayId: 'combination',
    party: count,
    units: unitsSorted,
    whyKey: why,
    alternative,
    upgradeBuyout: unitTotal >= 4 || count >= 10,
    bookingMode: 'enquiry',
    offlineMismatch: offline,
  });
}

const DAY_BY_MOOD = Object.freeze({
  quiet: 'dayQuiet',
  couple: 'dayCouple',
  nature: 'dayNature',
  group: 'dayGroup',
});

export function buildItinerary(stayId, nights, mood) {
  const nightCount = Math.max(1, Number(nights) || 2);
  const arrivalBody = stayId === 'cabin' ? 'arrivalCabin' : 'arrivalValley';
  let dayBody;
  if (stayId === 'cabin') dayBody = 'dayCabin';
  else if (stayId === 'buyout') dayBody = 'dayBuyout';
  else dayBody = DAY_BY_MOOD[mood] || 'dayValley';
  const days = [{ label: 'arrival', body: arrivalBody, oneNight: nightCount === 1 }];
  if (nightCount > 1) days.push({ label: 'full', body: dayBody });
  if (nightCount >= 3) days.push({ label: 'extra', body: 'openDay' });
  days.push({ label: 'departure', body: 'departure' });
  return days;
}

function guestParams({ adults, children = 0, babies = 0, pets = 0 }) {
  const adultCount = Number(adults);
  if (!Number.isFinite(adultCount) || adultCount < 1) return null;
  return {
    adults: String(Math.floor(adultCount)),
    children: String(Math.max(0, Number(children) || 0)),
    babies: String(Math.max(0, Number(babies) || 0)),
    pets: String(Math.max(0, Number(pets) || 0)),
  };
}

/** Same query contract as SearchBar. Returns null until both dates exist. */
export function buildAvailabilitySearch({
  checkIn,
  checkOut,
  adults,
  children = 0,
  babies = 0,
  pets = 0,
  language,
}) {
  const checkInValue = formatDateOnlyLocal(checkIn);
  const checkOutValue = formatDateOnlyLocal(checkOut);
  const guests = guestParams({ adults, children, babies, pets });
  if (!checkInValue || !checkOutValue || checkOutValue <= checkInValue || !guests) return null;

  const params = new URLSearchParams({
    checkIn: checkInValue,
    checkOut: checkOutValue,
    ...guests,
  });
  return `${localizePath('/search', language)}?${params.toString()}`;
}

/**
 * Whole-Valley quote handoff. Always carries exact guest counts.
 * Dates are included when present so the retreat calendar can quote the same stay.
 */
export function buildBuyoutHandoff({
  checkIn,
  checkOut,
  adults,
  children = 0,
  babies = 0,
  pets = 0,
  language,
}) {
  const guests = guestParams({ adults, children, babies, pets });
  if (!guests) return null;

  const params = new URLSearchParams(guests);
  const checkInValue = formatDateOnlyLocal(checkIn);
  const checkOutValue = formatDateOnlyLocal(checkOut);
  if (checkInValue && checkOutValue && checkOutValue > checkInValue) {
    params.set('checkIn', checkInValue);
    params.set('checkOut', checkOutValue);
  }

  return `${localizePath('/retreats/the-valley', language)}?${params.toString()}`;
}

/** Compact, readable encoding of a unit list for the enquiry link: `stone:1,aframe:2`. */
export function encodeUnits(units = []) {
  return units
    .filter((unit) => unit && unit.id && unit.count > 0)
    .map((unit) => `${unit.id}:${unit.count}`)
    .join(',');
}

/**
 * Multi-unit enquiry. Public checkout takes one unit per transaction, so a combination
 * goes to the Valley page as an enquiry with exact guests and units. Dates are only
 * included when both exist — never invented.
 */
export function buildCombinationEnquiryHandoff({ units, ...rest }) {
  const base = buildBuyoutHandoff(rest);
  if (!base) return null;
  const encoded = encodeUnits(units);
  const joiner = base.includes('?') ? '&' : '?';
  const extra = new URLSearchParams({ planner: 'combination' });
  if (encoded) extra.set('units', encoded);
  return `${base}${joiner}${extra.toString().replace(/%3A/g, ':').replace(/%2C/g, ',')}`;
}
