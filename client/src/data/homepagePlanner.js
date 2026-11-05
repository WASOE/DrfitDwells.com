import { formatDateOnlyLocal } from '../utils/dateOnly';
import { localizePath } from '../utils/localizedRoutes';

/** Published stay paths. Capacity matches the fixed overnight inventory. */
export const STAY_MATCHES = Object.freeze({
  cabin: Object.freeze({ path: '/stays/the-cabin', explorePath: '/cabin', maxGuests: 2 }),
  aframe: Object.freeze({ path: '/stays/a-frame', explorePath: '/valley', maxGuests: 2 }),
  lux: Object.freeze({ path: '/stays/lux-cabin', explorePath: '/valley', maxGuests: 2 }),
  stone: Object.freeze({ path: '/stays/stone-house', explorePath: '/valley', maxGuests: 6 }),
  buyout: Object.freeze({
    path: '/retreats/the-valley',
    explorePath: '/retreats/the-valley',
    maxGuests: 18,
  }),
});

/** Exact overnight guest counts offered in the planner (not bucket labels). */
export const PLANNER_PARTY_OPTIONS = Object.freeze([
  '1', '2', '3', '4', '5', '6', '7', '8', '10', '12', '16', '18',
]);

export const PLANNER_STEPS = Object.freeze([
  Object.freeze({
    id: 'party',
    options: PLANNER_PARTY_OPTIONS,
  }),
  Object.freeze({
    id: 'mood',
    options: Object.freeze(['quiet', 'couple', 'nature', 'group']),
  }),
  Object.freeze({
    id: 'connectivity',
    options: Object.freeze(['none', 'some', 'either']),
  }),
  Object.freeze({
    id: 'nights',
    options: Object.freeze(['2', '3', '4', '1']),
  }),
]);

export function parseGuestCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 1) return null;
  return Math.min(18, Math.floor(count));
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

/**
 * Match a guest to a real stay. Capacity wins. Connectivity never invents Wi-Fi
 * inside The Cabin or an A-frame. Exact party size is preserved — never falsified.
 */
export function recommendStay({ party, mood, connectivity }) {
  const count = parseGuestCount(party) || 2;
  let stayId;
  if (count >= 7) stayId = 'buyout';
  else if (count >= 3) stayId = 'stone';
  else if (connectivity === 'none' || mood === 'quiet' || mood === 'couple') stayId = 'cabin';
  else if (mood === 'nature') stayId = 'aframe';
  else stayId = 'lux';

  if (connectivity === 'some' && stayId === 'cabin') stayId = 'lux';

  return {
    stayId,
    party: count,
    /** Exact adults for booking handoff — never clamped to a smaller capacity. */
    searchAdults: count,
    capacityMax: capacityForStay(stayId),
    capacityExceeded: capacityExceeded(stayId, count),
    offlineMismatch: connectivity === 'none' && stayId !== 'cabin',
  };
}

export function buildItinerary(stayId, nights) {
  const nightCount = Math.max(1, Number(nights) || 2);
  const arrivalBody = stayId === 'cabin' ? 'arrivalCabin' : 'arrivalValley';
  const dayBody = stayId === 'cabin' ? 'dayCabin' : stayId === 'buyout' ? 'dayBuyout' : 'dayValley';
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
