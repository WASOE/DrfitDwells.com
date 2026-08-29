import { describe, expect, it } from 'vitest';
import {
  getSearchCardPetPolicyLabel,
  getSearchCardStatus
} from './searchCardStatus';

const tEn = (key) => {
  const map = {
    'search.dogsWelcome': 'Dogs welcome',
    'search.dogsNotPermitted': 'Dogs not permitted',
    'search.unavailableWithDogs': 'Not available with dogs',
    'search.unavailableForDates': 'Unavailable for these dates',
    'search.reasonMinGuests': 'Minimum guests',
    'search.reasonMaxGuests': 'Maximum guests',
    'search.reasonMinNights': 'Minimum nights',
    'search.reasonCriteria': 'Not available for this search'
  };
  return map[key] || key;
};

describe('searchCardStatus', () => {
  const lux = { _id: '1', slug: 'lux-cabin', name: 'Lux Cabin', available: true };
  const aFrame = {
    _id: '2',
    slug: 'a-frame',
    inventoryType: 'multi',
    name: 'A-Frame',
    available: true
  };
  const stone = { _id: '3', slug: 'stone-house', name: 'Stone House', available: true };
  const cabin = { _id: '4', slug: 'the-cabin', name: 'The Cabin', available: true };

  it('shows explicit dog policy on every known stay', () => {
    expect(getSearchCardPetPolicyLabel(aFrame, tEn)).toBe('Dogs welcome');
    expect(getSearchCardPetPolicyLabel(stone, tEn)).toBe('Dogs welcome');
    expect(getSearchCardPetPolicyLabel(cabin, tEn)).toBe('Dogs welcome');
    expect(getSearchCardPetPolicyLabel(lux, tEn)).toBe('Dogs not permitted');
  });

  it('keeps Lux bookable when pets = 0 and dates available', () => {
    const status = getSearchCardStatus(lux, tEn, { pets: 0 });
    expect(status.isBookable).toBe(true);
    expect(status.reasonCode).toBeNull();
    expect(getSearchCardPetPolicyLabel(lux, tEn)).toBe('Dogs not permitted');
  });

  it('marks Lux incompatible when pets > 0 even if dates available', () => {
    const status = getSearchCardStatus(lux, tEn, { pets: 1 });
    expect(status.isBookable).toBe(false);
    expect(status.reasonCode).toBe('pets');
    expect(status.banner).toBe('Not available with dogs');
    expect(status.disabledCta).toBe('Not available with dogs');
  });

  it('keeps dog-friendly stays bookable when pets > 0', () => {
    for (const stay of [aFrame, stone, cabin]) {
      const status = getSearchCardStatus(stay, tEn, { pets: 1 });
      expect(status.isBookable).toBe(true);
      expect(getSearchCardPetPolicyLabel(stay, tEn)).toBe('Dogs welcome');
    }
  });

  it('prefers ordinary date-unavailable over pet incompatibility', () => {
    const luxDatesBlocked = {
      ...lux,
      available: false,
      unavailabilityReason: 'dates'
    };
    const status = getSearchCardStatus(luxDatesBlocked, tEn, { pets: 1 });
    expect(status.isBookable).toBe(false);
    expect(status.reasonCode).toBe('dates');
    expect(status.banner).toBe('Unavailable for these dates');
  });

  it('resolves Lux by display name when slug missing', () => {
    const byName = { _id: 'x', name: 'Luxury Cabin', available: true };
    expect(getSearchCardPetPolicyLabel(byName, tEn)).toBe('Dogs not permitted');
    expect(getSearchCardStatus(byName, tEn, { pets: 2 }).reasonCode).toBe('pets');
  });
});
