import { describe, expect, it } from 'vitest';
import {
  buildCabinAvailabilityRequestKey,
  normalizeCabinDetailsPromoCode,
  resolveCabinDetailsLodgingPresentation
} from './CabinDetails.jsx';
import { effectiveDisplayNightlyFromStayTotal } from '../utils/lodgingPrice';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const luxEntityNightly = 85;
const luxEntityTotal6 = 510;

/** Mock promo tokens only — never production credentials. */
const MOCK_PROMO_A = 'TESTPROMOA';
const MOCK_PROMO_B = 'TESTPROMOB';

describe('normalizeCabinDetailsPromoCode', () => {
  it('trims and uppercases; whitespace-only becomes empty', () => {
    expect(normalizeCabinDetailsPromoCode('  abcd  ')).toBe('ABCD');
    expect(normalizeCabinDetailsPromoCode('')).toBe('');
    expect(normalizeCabinDetailsPromoCode('   ')).toBe('');
    expect(normalizeCabinDetailsPromoCode(null)).toBe('');
    expect(normalizeCabinDetailsPromoCode(undefined)).toBe('');
  });
});

describe('buildCabinAvailabilityRequestKey', () => {
  const base = {
    cabinId: 'lux',
    checkIn: '2026-12-04',
    checkOut: '2026-12-10',
    adults: 2,
    children: 0,
    locale: 'en'
  };

  it('changes when dates, guests, or locale change', () => {
    const a = buildCabinAvailabilityRequestKey(base);
    expect(a).not.toBe(
      buildCabinAvailabilityRequestKey({ ...base, checkIn: '2026-12-06' })
    );
    expect(a).not.toBe(buildCabinAvailabilityRequestKey({ ...base, adults: 4 }));
    expect(a).not.toBe(buildCabinAvailabilityRequestKey({ ...base, locale: 'bg' }));
  });

  it('differs between no promo, promo A, and promo B', () => {
    const none = buildCabinAvailabilityRequestKey(base);
    const a = buildCabinAvailabilityRequestKey({ ...base, promoCode: MOCK_PROMO_A });
    const b = buildCabinAvailabilityRequestKey({ ...base, promoCode: MOCK_PROMO_B });
    expect(none).not.toBe(a);
    expect(none).not.toBe(b);
    expect(a).not.toBe(b);
  });

  it('whitespace-only promo behaves as no promo', () => {
    const none = buildCabinAvailabilityRequestKey(base);
    const blank = buildCabinAvailabilityRequestKey({ ...base, promoCode: '   ' });
    const empty = buildCabinAvailabilityRequestKey({ ...base, promoCode: '' });
    expect(blank).toBe(none);
    expect(empty).toBe(none);
  });
});

describe('resolveCabinDetailsLodgingPresentation', () => {
  const key = buildCabinAvailabilityRequestKey({
    cabinId: '69b2ff947f141a71ffa7c492',
    checkIn: '2026-12-04',
    checkOut: '2026-12-10',
    adults: 2,
    children: 0,
    locale: 'en'
  });

  const winterAvailRatePlan = {
    available: false,
    pricingSource: 'rate_plan',
    totalPrice: 660,
    totalNights: 6,
    pricePerNight: 85
  };

  it('unavailable winter Luxury: quote null + rate_plan availability → €660 / €110, booking disabled', () => {
    const r = resolveCabinDetailsLodgingPresentation({
      quoteTotal: null,
      entityLodgingTotal: luxEntityTotal6,
      entityNightly: luxEntityNightly,
      entityTotalNights: 6,
      experienceTotal: 0,
      availability: winterAvailRatePlan,
      availabilityRequestKey: key,
      currentRequestKey: key
    });
    expect(r.displayGrandTotal).toBe(660);
    expect(r.displayNightly).toBe(110);
    expect(r.displayNightly).toBe(effectiveDisplayNightlyFromStayTotal(660, 6));
    expect(r.displayGrandTotal).not.toBe(510);
    expect(r.displayNightly).not.toBe(85);
    expect(r.pricingSource).toBe('rate_plan');
    expect(r.usesNonEntityLodging).toBe(true);
    expect(r.stayUnavailable).toBe(true);
    expect(r.bookingDisabled).toBe(true);
    expect(r.authority).toBe('availability_rate_plan');
  });

  it('available winter Luxury quote €660 still wins over entity', () => {
    const r = resolveCabinDetailsLodgingPresentation({
      quoteTotal: 660,
      entityLodgingTotal: luxEntityTotal6,
      entityNightly: luxEntityNightly,
      entityTotalNights: 6,
      availability: {
        available: true,
        pricingSource: 'rate_plan',
        totalPrice: 660,
        totalNights: 6
      },
      availabilityRequestKey: key,
      currentRequestKey: key
    });
    expect(r.displayGrandTotal).toBe(660);
    expect(r.displayNightly).toBe(110);
    expect(r.authority).toBe('quote');
    expect(r.bookingDisabled).toBe(false);
  });

  it('outside-window entity Luxury uses entity result', () => {
    const outsideKey = buildCabinAvailabilityRequestKey({
      cabinId: 'lux',
      checkIn: '2026-06-10',
      checkOut: '2026-06-16',
      adults: 2,
      children: 0,
      locale: 'en'
    });
    const r = resolveCabinDetailsLodgingPresentation({
      quoteTotal: 510,
      entityLodgingTotal: 510,
      entityNightly: 85,
      entityTotalNights: 6,
      availability: {
        available: true,
        pricingSource: 'entity',
        totalPrice: 510,
        totalNights: 6
      },
      availabilityRequestKey: outsideKey,
      currentRequestKey: outsideKey
    });
    expect(r.displayGrandTotal).toBe(510);
    expect(r.displayNightly).toBe(85);
    expect(r.usesNonEntityLodging).toBe(false);
    expect(r.bookingDisabled).toBe(false);
  });

  it('malformed RatePlan availability does not fall back to €85 winter nightly', () => {
    const r = resolveCabinDetailsLodgingPresentation({
      quoteTotal: null,
      entityLodgingTotal: luxEntityTotal6,
      entityNightly: luxEntityNightly,
      entityTotalNights: 6,
      availability: {
        available: false,
        pricingSource: 'rate_plan',
        totalPrice: null,
        totalNights: 6,
        pricePerNight: 85
      },
      availabilityRequestKey: key,
      currentRequestKey: key
    });
    expect(r.displayGrandTotal).toBeNull();
    expect(r.displayNightly).toBeNull();
    expect(r.displayNightly).not.toBe(85);
    expect(r.authority).toBe('unavailable_neutral');
    expect(r.bookingDisabled).toBe(true);
  });

  it('stale availability from a previous request is not displayed', () => {
    const staleKey = buildCabinAvailabilityRequestKey({
      cabinId: 'lux',
      checkIn: '2026-12-01',
      checkOut: '2026-12-07',
      adults: 2,
      children: 0,
      locale: 'en'
    });
    const r = resolveCabinDetailsLodgingPresentation({
      quoteTotal: null,
      entityLodgingTotal: luxEntityTotal6,
      entityNightly: luxEntityNightly,
      entityTotalNights: 6,
      availability: winterAvailRatePlan,
      availabilityRequestKey: staleKey,
      currentRequestKey: key
    });
    expect(r.displayGrandTotal).toBeNull();
    expect(r.displayNightly).toBeNull();
    expect(r.authority).toBe('neutral');
    expect(r.stayUnavailable).toBe(false);
  });

  it('RatePlan A-frame quote path still €450 / €75', () => {
    const r = resolveCabinDetailsLodgingPresentation({
      quoteTotal: 450,
      entityLodgingTotal: 360,
      entityNightly: 60,
      entityTotalNights: 6
    });
    expect(r.displayNightly).toBe(75);
    expect(r.displayGrandTotal).toBe(450);
  });

  it('guest-sensitive Stone RatePlan nightly from quote', () => {
    expect(
      resolveCabinDetailsLodgingPresentation({
        quoteTotal: 720,
        entityLodgingTotal: 600,
        entityNightly: 100,
        entityTotalNights: 6
      }).displayNightly
    ).toBe(120);
  });

  it('quote 409 + RatePlan availability with promo displays availability promo total', () => {
    const promoKey = buildCabinAvailabilityRequestKey({
      cabinId: '69b2ff947f141a71ffa7c492',
      checkIn: '2026-12-04',
      checkOut: '2026-12-10',
      adults: 2,
      children: 0,
      locale: 'en',
      promoCode: MOCK_PROMO_A
    });
    // Mock server-authoritative discounted availability total (not computed client-side).
    const promoAvail = {
      available: false,
      pricingSource: 'rate_plan',
      totalPrice: 594,
      totalNights: 6,
      pricePerNight: 85
    };
    const r = resolveCabinDetailsLodgingPresentation({
      quoteTotal: null,
      entityLodgingTotal: luxEntityTotal6,
      entityNightly: luxEntityNightly,
      entityTotalNights: 6,
      availability: promoAvail,
      availabilityRequestKey: promoKey,
      currentRequestKey: promoKey
    });
    expect(r.displayGrandTotal).toBe(594);
    expect(r.displayNightly).toBe(99);
    expect(r.displayNightly).toBe(effectiveDisplayNightlyFromStayTotal(594, 6));
    expect(r.displayGrandTotal).not.toBe(660);
    expect(r.displayGrandTotal).not.toBe(510);
    expect(r.bookingDisabled).toBe(true);
    expect(r.authority).toBe('availability_rate_plan');
  });

  it('promo is not applied twice: displayed total equals server availability total', () => {
    const promoKey = buildCabinAvailabilityRequestKey({
      cabinId: 'lux',
      checkIn: '2026-12-04',
      checkOut: '2026-12-10',
      adults: 2,
      children: 0,
      locale: 'en',
      promoCode: MOCK_PROMO_A
    });
    const serverTotal = 594;
    const r = resolveCabinDetailsLodgingPresentation({
      quoteTotal: null,
      entityLodgingTotal: luxEntityTotal6,
      entityNightly: luxEntityNightly,
      entityTotalNights: 6,
      availability: {
        available: true,
        pricingSource: 'rate_plan',
        totalPrice: serverTotal,
        totalNights: 6
      },
      availabilityRequestKey: promoKey,
      currentRequestKey: promoKey
    });
    expect(r.displayGrandTotal).toBe(serverTotal);
    expect(r.displayGrandTotal).not.toBe(serverTotal * 0.9);
    expect(r.displayNightly).toBe(effectiveDisplayNightlyFromStayTotal(serverTotal, 6));
  });

  it('successful quote remains higher authority than promo availability', () => {
    const promoKey = buildCabinAvailabilityRequestKey({
      cabinId: 'lux',
      checkIn: '2026-12-06',
      checkOut: '2026-12-12',
      adults: 2,
      children: 0,
      locale: 'en',
      promoCode: MOCK_PROMO_A
    });
    const r = resolveCabinDetailsLodgingPresentation({
      quoteTotal: 561,
      quoteBaseLodgingPrice: 561,
      entityLodgingTotal: luxEntityTotal6,
      entityNightly: luxEntityNightly,
      entityTotalNights: 6,
      availability: {
        available: true,
        pricingSource: 'rate_plan',
        totalPrice: 594,
        totalNights: 6
      },
      availabilityRequestKey: promoKey,
      currentRequestKey: promoKey
    });
    expect(r.displayGrandTotal).toBe(561);
    expect(r.authority).toBe('quote');
    expect(r.displayGrandTotal).not.toBe(594);
  });

  it('promo A then promo B: only matching promo B key may display B total', () => {
    const base = {
      cabinId: 'lux',
      checkIn: '2026-12-04',
      checkOut: '2026-12-10',
      adults: 2,
      children: 0,
      locale: 'en'
    };
    const keyA = buildCabinAvailabilityRequestKey({ ...base, promoCode: MOCK_PROMO_A });
    const keyB = buildCabinAvailabilityRequestKey({ ...base, promoCode: MOCK_PROMO_B });
    const availA = {
      available: false,
      pricingSource: 'rate_plan',
      totalPrice: 580,
      totalNights: 6
    };
    const availB = {
      available: false,
      pricingSource: 'rate_plan',
      totalPrice: 570,
      totalNights: 6
    };
    // B is current; A response must not apply
    const staleA = resolveCabinDetailsLodgingPresentation({
      quoteTotal: null,
      entityLodgingTotal: luxEntityTotal6,
      entityNightly: luxEntityNightly,
      entityTotalNights: 6,
      availability: availA,
      availabilityRequestKey: keyA,
      currentRequestKey: keyB
    });
    expect(staleA.displayGrandTotal).toBeNull();
    expect(staleA.authority).toBe('neutral');

    const currentB = resolveCabinDetailsLodgingPresentation({
      quoteTotal: null,
      entityLodgingTotal: luxEntityTotal6,
      entityNightly: luxEntityNightly,
      entityTotalNights: 6,
      availability: availB,
      availabilityRequestKey: keyB,
      currentRequestKey: keyB
    });
    expect(currentB.displayGrandTotal).toBe(570);
    expect(currentB.bookingDisabled).toBe(true);
  });

  it('previous non-promo response cannot overwrite a promo request', () => {
    const base = {
      cabinId: 'lux',
      checkIn: '2026-12-04',
      checkOut: '2026-12-10',
      adults: 2,
      children: 0,
      locale: 'en'
    };
    const keyNone = buildCabinAvailabilityRequestKey(base);
    const keyPromo = buildCabinAvailabilityRequestKey({
      ...base,
      promoCode: MOCK_PROMO_A
    });
    const r = resolveCabinDetailsLodgingPresentation({
      quoteTotal: null,
      entityLodgingTotal: luxEntityTotal6,
      entityNightly: luxEntityNightly,
      entityTotalNights: 6,
      availability: winterAvailRatePlan,
      availabilityRequestKey: keyNone,
      currentRequestKey: keyPromo
    });
    expect(r.displayGrandTotal).toBeNull();
    expect(r.displayNightly).toBeNull();
    expect(r.authority).toBe('neutral');
  });
});

describe('CabinDetails source invariants', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(dir, 'CabinDetails.jsx'), 'utf8');

  it('does not reintroduce Exact-total wording', () => {
    expect(src).not.toContain('exactStayPriceHint');
    expect(src).not.toContain('Exact total for your selected dates and guests');
  });

  it('availability request receives promoCode when present', () => {
    expect(src).toContain('availabilityQuery.promoCode = searchCriteria.promoCode');
    expect(src).toContain('availabilityAPI.search(availabilityQuery)');
    expect(src).toMatch(
      /if\s*\(\s*searchCriteria\.promoCode\s*\)\s*\{\s*availabilityQuery\.promoCode/
    );
  });

  it('availability request key includes promoCode', () => {
    expect(src).toContain('promoCode: searchCriteria.promoCode');
    expect(src).toContain('normalizeCabinDetailsPromoCode(promoCode)');
    expect(src).toContain('searchCriteria.promoCode');
  });
});
