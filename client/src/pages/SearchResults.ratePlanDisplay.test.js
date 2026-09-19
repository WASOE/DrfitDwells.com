import { describe, expect, it } from 'vitest';
import {
  clampSearchCardDescription,
  resolveSearchCardEffectiveNightly
} from './SearchResults.jsx';

const winter = (overrides) => ({
  pricingMode: 'exact_stay',
  pricingSource: 'rate_plan',
  totalNights: 6,
  pricePerNight: 60, // entity — must never be used as winter display
  pricingModel: 'per_night',
  ...overrides
});

describe('resolveSearchCardEffectiveNightly', () => {
  it('RatePlan A-frame: €450 total → €75/night (not entity €60)', () => {
    const nightly = resolveSearchCardEffectiveNightly(
      winter({ name: 'A-frame', totalPrice: 450, pricePerNight: 60 }),
      2,
      0
    );
    expect(nightly).toBe(75);
    expect(nightly).not.toBe(60);
  });

  it('RatePlan Luxury: €660 → €110/night (not entity €85)', () => {
    expect(
      resolveSearchCardEffectiveNightly(
        winter({ totalPrice: 660, pricePerNight: 85 }),
        2,
        0
      )
    ).toBe(110);
  });

  it('RatePlan Stone: €540 → €90/night for 2 guests', () => {
    expect(
      resolveSearchCardEffectiveNightly(
        winter({
          totalPrice: 540,
          pricePerNight: 75,
          pricingModel: 'base_plus_extra',
          includedGuests: 3,
          extraGuestPricePerNight: 25
        }),
        2,
        0
      )
    ).toBe(90);
  });

  it('guest-sensitive Stone RatePlan nightlies', () => {
    const stone = {
      pricingMode: 'exact_stay',
      pricingSource: 'rate_plan',
      totalNights: 6,
      pricePerNight: 75,
      pricingModel: 'base_plus_extra',
      includedGuests: 3,
      extraGuestPricePerNight: 25
    };
    expect(resolveSearchCardEffectiveNightly({ ...stone, totalPrice: 720 }, 4, 0)).toBe(120);
    expect(resolveSearchCardEffectiveNightly({ ...stone, totalPrice: 900 }, 5, 0)).toBe(150);
    expect(resolveSearchCardEffectiveNightly({ ...stone, totalPrice: 1080 }, 6, 0)).toBe(180);
  });

  it('The Cabin remains €330 total / €55/night', () => {
    expect(
      resolveSearchCardEffectiveNightly(
        winter({ totalPrice: 330, pricePerNight: 55 }),
        2,
        0
      )
    ).toBe(55);
  });

  it('outside-window entity display uses entity nightly, not total÷nights override', () => {
    const entity = {
      pricingMode: 'exact_stay',
      pricingSource: 'entity',
      totalPrice: 360,
      totalNights: 6,
      pricePerNight: 60,
      pricingModel: 'per_night'
    };
    expect(resolveSearchCardEffectiveNightly(entity, 2, 0)).toBe(60);
  });

  it('RatePlan and entity share the same nightly footnote shape (price number only)', () => {
    const rp = resolveSearchCardEffectiveNightly(winter({ totalPrice: 450 }), 2, 0);
    const ent = resolveSearchCardEffectiveNightly(
      {
        pricingMode: 'exact_stay',
        pricingSource: 'entity',
        totalPrice: 330,
        totalNights: 6,
        pricePerNight: 55,
        pricingModel: 'per_night'
      },
      2,
      0
    );
    expect(typeof rp).toBe('number');
    expect(typeof ent).toBe('number');
    expect(rp).toBe(75);
    expect(ent).toBe(55);
  });
});

describe('clampSearchCardDescription', () => {
  it('does not end with dangling conjunctions', () => {
    const long =
      'A peaceful mountain retreat with forest views and creek access and more words here to force a truncation boundary near a conjunction word.';
    const out = clampSearchCardDescription(long, 80);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/\b(and|or|with|the)\s*…$/i);
    expect(out).not.toMatch(/\.{4,}/);
    expect(out).not.toMatch(/\w…\w/); // no mid-word ellipsis between letters oddly
  });

  it('does not produce duplicated ellipsis punctuation', () => {
    const out = clampSearchCardDescription('Word. '.repeat(40), 100);
    expect(out).not.toMatch(/\.\.\.\./);
    expect(out).not.toMatch(/……/);
  });

  it('does not cut a word in half', () => {
    const out = clampSearchCardDescription(
      'Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november',
      50
    );
    const beforeEllipsis = out.replace(/…$/, '');
    expect(beforeEllipsis).not.toMatch(/\s\w{1,2}$/); // ends on a full word token
    expect(out).toMatch(/…$/);
  });
});

describe('RatePlan layout source invariants', () => {
  it('SearchResults source has no Exact-total RatePlan hint', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(dir, 'SearchResults.jsx'), 'utf8');
    expect(src).not.toContain('exactStayPriceHint');
    expect(src).not.toContain('Exact total for your selected dates and guests');
    // Same structural nightly footnote class for RatePlan and entity
    expect(src).toContain("t('search.pricePerNight'");
    expect(src).toContain('StayLodgingPriceBlock');
  });
});
