import { describe, expect, it } from 'vitest';
import en from '../i18n/locales/en/home.json';
import bg from '../i18n/locales/bg/home.json';
import {
  buildAvailabilitySearch,
  buildItinerary,
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

  it('sends two offline guests to The Cabin', () => {
    expect(recommendStay({ party: '2', mood: 'quiet', connectivity: 'none' })).toMatchObject({
      stayId: 'cabin',
      searchAdults: 2,
      offlineMismatch: false,
    });
  });

  it('does not put a guest who wants connectivity in the offline cabin', () => {
    expect(recommendStay({ party: '2', mood: 'couple', connectivity: 'some' }).stayId).toBe('lux');
  });

  it('sends a family to the Stone House and a large group to the whole Valley', () => {
    expect(recommendStay({ party: '4', mood: 'group', connectivity: 'either' })).toMatchObject({
      stayId: 'stone',
      searchAdults: 4,
    });
    expect(recommendStay({ party: '10', mood: 'group', connectivity: 'none' })).toMatchObject({
      stayId: 'buyout',
      searchAdults: null,
      offlineMismatch: true,
    });
  });

  it('builds a practical itinerary and flags a one-night request', () => {
    expect(buildItinerary('cabin', 2).map((day) => day.label)).toEqual(['arrival', 'full', 'departure']);
    expect(buildItinerary('buyout', 4).map((day) => day.body)).toContain('openDay');
    expect(buildItinerary('aframe', 1)[0]).toMatchObject({ body: 'arrivalValley', oneNight: true });
  });

  it('uses the existing search query contract and refuses missing dates', () => {
    expect(buildAvailabilitySearch({
      checkIn: new Date(2026, 10, 12),
      checkOut: new Date(2026, 10, 14),
      adults: 2,
      language: 'bg',
    })).toBe('/bg/search?checkIn=2026-11-12&checkOut=2026-11-14&adults=2&children=0&babies=0&pets=0');

    expect(buildAvailabilitySearch({
      checkIn: null,
      checkOut: new Date(2026, 10, 14),
      adults: 2,
      language: 'en',
    })).toBeNull();
  });
});
