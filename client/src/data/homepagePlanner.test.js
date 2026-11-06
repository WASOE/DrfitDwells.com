import { describe, expect, it } from 'vitest';
import en from '../i18n/locales/en/home.json';
import bg from '../i18n/locales/bg/home.json';
import {
  PLANNER_PARTY_OPTIONS,
  buildAvailabilitySearch,
  buildBuyoutHandoff,
  buildItinerary,
  capacityExceeded,
  recommendStay,
} from './homepagePlanner';

function keyTree(value) {
  if (Array.isArray(value)) return value.map(keyTree);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, keyTree(value[key])]));
  }
  return typeof value;
}

describe('homepage planner', () => {
  it('keeps English and Bulgarian homepage copy in the same shape', () => {
    expect(keyTree(bg)).toEqual(keyTree(en));
  });

  it('offers exact party sizes instead of falsified buckets', () => {
    expect(PLANNER_PARTY_OPTIONS).toEqual(
      Array.from({ length: 18 }, (_, index) => String(index + 1))
    );
    for (const size of PLANNER_PARTY_OPTIONS) {
      expect(en.planner.steps.party.options[size]).toBeTruthy();
      expect(bg.planner.steps.party.options[size]).toBeTruthy();
    }
  });

  it('preserves exact guest counts for 3, 4, 6, 7, 10 and 18', () => {
    const cases = [
      { party: '3', stayId: 'stone' },
      { party: '4', stayId: 'stone' },
      { party: '6', stayId: 'stone' },
      { party: '7', stayId: 'buyout' },
      { party: '10', stayId: 'buyout' },
      { party: '18', stayId: 'buyout' },
    ];
    for (const { party, stayId } of cases) {
      const result = recommendStay({ party, mood: 'group', connectivity: 'either' });
      expect(result).toMatchObject({
        stayId,
        party: Number(party),
        searchAdults: Number(party),
      });
    }
  });

  it('sends two offline guests to The Cabin without clamping', () => {
    expect(recommendStay({ party: '2', mood: 'quiet', connectivity: 'none' })).toMatchObject({
      stayId: 'cabin',
      searchAdults: 2,
      capacityExceeded: false,
      offlineMismatch: false,
    });
  });

  it('does not put a guest who wants connectivity in the offline cabin', () => {
    expect(recommendStay({ party: '2', mood: 'couple', connectivity: 'some' }).stayId).toBe('lux');
  });

  it('flags capacity overflow without changing the exact party size', () => {
    const result = recommendStay({ party: '2', mood: 'quiet', connectivity: 'none' });
    expect(capacityExceeded('cabin', 4)).toBe(true);
    expect(result.searchAdults).toBe(2);
    expect(recommendStay({ party: '4', mood: 'quiet', connectivity: 'none' })).toMatchObject({
      stayId: 'stone',
      searchAdults: 4,
      capacityExceeded: false,
    });
  });

  it('builds a practical itinerary and flags a one-night request', () => {
    expect(buildItinerary('cabin', 2).map((day) => day.label)).toEqual(['arrival', 'full', 'departure']);
    expect(buildItinerary('buyout', 4).map((day) => day.body)).toContain('openDay');
    expect(buildItinerary('aframe', 1)[0]).toMatchObject({ body: 'arrivalValley', oneNight: true });
  });

  it('preserves children, babies and pets in the search query contract', () => {
    expect(buildAvailabilitySearch({
      checkIn: new Date(2026, 10, 12),
      checkOut: new Date(2026, 10, 14),
      adults: 4,
      children: 2,
      babies: 1,
      pets: 1,
      language: 'bg',
    })).toBe('/bg/search?checkIn=2026-11-12&checkOut=2026-11-14&adults=4&children=2&babies=1&pets=1');

    expect(buildAvailabilitySearch({
      checkIn: null,
      checkOut: new Date(2026, 10, 14),
      adults: 2,
      language: 'en',
    })).toBeNull();
  });

  it('carries exact guests and dates into the whole-Valley quote handoff', () => {
    expect(buildBuyoutHandoff({
      checkIn: new Date(2026, 10, 12),
      checkOut: new Date(2026, 10, 15),
      adults: 10,
      children: 2,
      babies: 0,
      pets: 1,
      language: 'en',
    })).toBe('/retreats/the-valley?adults=10&children=2&babies=0&pets=1&checkIn=2026-11-12&checkOut=2026-11-15');

    expect(buildBuyoutHandoff({
      adults: 18,
      children: 0,
      babies: 0,
      pets: 0,
      language: 'bg',
    })).toBe('/bg/retreats/the-valley?adults=18&children=0&babies=0&pets=0');
  });
});
