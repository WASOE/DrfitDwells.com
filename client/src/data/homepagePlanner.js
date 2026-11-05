import { formatDateOnlyLocal } from '../utils/dateOnly';
import { localizePath } from '../utils/localizedRoutes';

/** Published stay paths. Capacity matches the fixed overnight inventory. */
export const STAY_MATCHES = Object.freeze({
  cabin: Object.freeze({ path: '/stays/the-cabin', explorePath: '/cabin', maxAdults: 2 }),
  aframe: Object.freeze({ path: '/stays/a-frame', explorePath: '/valley', maxAdults: 2 }),
  lux: Object.freeze({ path: '/stays/lux-cabin', explorePath: '/valley', maxAdults: 2 }),
  stone: Object.freeze({ path: '/stays/stone-house', explorePath: '/valley', maxAdults: 6 }),
  buyout: Object.freeze({
    path: '/retreats/the-valley',
    explorePath: '/retreats/the-valley',
    maxAdults: null,
  }),
});

export const PLANNER_STEPS = Object.freeze([
  Object.freeze({
    id: 'party',
    options: Object.freeze(['1', '2', '4', '10']),
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

export function searchAdultsForStay(stayId, party) {
  const match = STAY_MATCHES[stayId];
  if (!match || match.maxAdults == null) return null;
  const count = Number(party);
  if (!Number.isFinite(count)) return 2;
  return Math.min(match.maxAdults, Math.max(1, count));
}

/**
 * Match a guest to a real stay. Capacity wins. Connectivity never invents Wi-Fi
 * inside The Cabin or an A-frame.
 */
export function recommendStay({ party, mood, connectivity }) {
  const count = Number(party) || 2;
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
    searchAdults: searchAdultsForStay(stayId, count),
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

/** Same query contract as SearchBar. Returns null until both dates exist. */
export function buildAvailabilitySearch({ checkIn, checkOut, adults, language }) {
  const checkInValue = formatDateOnlyLocal(checkIn);
  const checkOutValue = formatDateOnlyLocal(checkOut);
  const guestCount = Number(adults);
  if (!checkInValue || !checkOutValue || checkOutValue <= checkInValue) return null;
  if (!Number.isFinite(guestCount) || guestCount < 1) return null;

  const params = new URLSearchParams({
    checkIn: checkInValue,
    checkOut: checkOutValue,
    adults: String(guestCount),
    children: '0',
    babies: '0',
    pets: '0',
  });
  return `${localizePath('/search', language)}?${params.toString()}`;
}
