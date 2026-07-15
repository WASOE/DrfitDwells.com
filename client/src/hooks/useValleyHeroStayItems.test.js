import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VALLEY_STAY_SELECTOR_META } from '../data/valleyStaySelectorMeta';
import { formatListingFromPrice } from '../utils/listingFromPrice';
import {
  buildValleyHeroBuyoutItem,
  buildValleyHeroUnitBookingTo,
  buildValleyHeroUnitItems,
  VALLEY_STAY_SELECTOR_META as EXPORTED_META
} from '../utils/valleyHeroStayItems';

const __dirname = dirname(fileURLToPath(import.meta.url));
const hookSource = readFileSync(join(__dirname, 'useValleyHeroStayItems.js'), 'utf8');

const tValley = (key, options = {}) => {
  const map = {
    'hero.selector.sleepsPrefix': 'Sleeps',
    'hero.selector.stays.aFrame.title': 'A-Frames',
    'hero.selector.stays.aFrame.fit': 'Solo travelers or couples',
    'hero.selector.stays.luxCabin.title': 'Luxury Cabin',
    'hero.selector.stays.luxCabin.fit': 'Couples',
    'hero.selector.stays.stoneHouse.title': 'Stone House',
    'hero.selector.stays.stoneHouse.fit': 'Families or small groups',
    'hero.selector.buyout.title': 'The whole Valley',
    'hero.selector.buyout.fromPrice': `from €${options.nightly}/night, ${options.nights}-night minimum`
  };
  return map[key] ?? key;
};

const tBooking = (key, options = {}) => {
  if (key === 'search.priceFromPerNight') {
    return `From €${options.price}/night`;
  }
  return key;
};

const listingIndex = {
  'a-frame': {
    kind: 'cabinType',
    listing: { capacity: 2, pricePerNight: 60 },
    slug: 'a-frame'
  },
  'lux-cabin': {
    kind: 'cabin',
    listing: { capacity: 2, pricePerNight: 85 },
    slug: 'lux-cabin'
  },
  'stone-house': {
    kind: 'cabin',
    listing: {
      capacity: 6,
      pricePerNight: 25,
      pricingModel: 'per_person',
      minGuests: 3
    },
    slug: 'stone-house'
  }
};

const coversBySlug = {
  'a-frame': { url: '/covers/a-frame.jpg', alt: 'A-Frames' },
  'lux-cabin': { url: '/covers/lux-cabin.jpg', alt: 'Luxury Cabin' },
  'stone-house': { url: '/covers/stone-house.jpg', alt: 'Stone House' }
};

describe('useValleyHeroStayItems data builders', () => {
  it('VALLEY_STAY_SELECTOR_META order is a-frame, lux-cabin, stone-house', () => {
    expect(VALLEY_STAY_SELECTOR_META.map((item) => item.listingSlug)).toEqual([
      'a-frame',
      'lux-cabin',
      'stone-house'
    ]);
    expect(EXPORTED_META).toBe(VALLEY_STAY_SELECTOR_META);
  });

  it('buildValleyHeroUnitItems returns unit shape and order', () => {
    const units = buildValleyHeroUnitItems(
      listingIndex,
      coversBySlug,
      'en',
      tValley,
      tBooking
    );

    expect(units).toHaveLength(3);
    expect(units.map((item) => item.slug)).toEqual(['a-frame', 'lux-cabin', 'stone-house']);

    const stoneHouse = units[2];
    expect(stoneHouse).toMatchObject({
      id: 'stone-house',
      kind: 'unit',
      slug: 'stone-house',
      titleKey: 'hero.selector.stays.stoneHouse.title',
      fitKey: 'hero.selector.stays.stoneHouse.fit',
      title: 'Stone House',
      fit: 'Families or small groups',
      sleeps: 'Sleeps 6',
      fromPrice: 'From €25/night',
      cover: { url: '/covers/stone-house.jpg', alt: 'Stone House' }
    });
  });

  it('buildValleyHeroUnitBookingTo localizes EN and BG routes with booking hash', () => {
    expect(buildValleyHeroUnitBookingTo('/stays/a-frame', 'en')).toEqual({
      pathname: '/stays/a-frame',
      hash: '#booking'
    });
    expect(buildValleyHeroUnitBookingTo('/stays/stone-house', 'bg')).toEqual({
      pathname: '/bg/stays/stone-house',
      hash: '#booking'
    });
  });

  it('Stone House from-price matches CabinDetails priceFromPerNight behavior', () => {
    const listing = listingIndex['stone-house'].listing;
    const formatted = formatListingFromPrice(listing, tBooking);

    expect(formatted).toBe(
      tBooking('search.priceFromPerNight', {
        price: listing.pricePerNight.toLocaleString()
      })
    );
    expect(formatted).toBe('From €25/night');
  });

  it('buildValleyHeroBuyoutItem exposes inventory pricing and localized route', () => {
    const buyout = buildValleyHeroBuyoutItem(
      'bg',
      {
        totalSleeps: 12,
        fromPrice: { nightlyTotal: 355, nights: 2 }
      },
      tValley
    );

    expect(buyout).toMatchObject({
      id: 'buyout',
      kind: 'buyout',
      titleKey: 'hero.selector.buyout.title',
      title: 'The whole Valley',
      bookingTo: { pathname: '/bg/retreats/the-valley' },
      fromPriceNightly: 355,
      minNights: 2,
      totalSleeps: 12,
      fromPriceLabel: 'from €355/night, 2-night minimum'
    });
  });

  it('buildValleyHeroBuyoutItem degrades gracefully when inventory is missing', () => {
    const buyout = buildValleyHeroBuyoutItem('en', null, tValley);

    expect(buyout).toMatchObject({
      id: 'buyout',
      kind: 'buyout',
      title: 'The whole Valley',
      bookingTo: { pathname: '/retreats/the-valley' },
      fromPriceNightly: null,
      minNights: null,
      totalSleeps: null,
      fromPriceLabel: null
    });
  });
});

describe('useValleyHeroStayItems module', () => {
  it('contains no hardcoded euro price literals', () => {
    expect(hookSource).not.toMatch(/€\s*\d/);
    expect(hookSource).not.toMatch(/['"]\d+\/night['"]/);
  });
});
