import { describe, expect, it } from 'vitest';
import {
  calculateWinterVillageTotal,
  normaliseWinterVillageSelection
} from './winterVillageCalculator';

describe('winterVillageCalculator', () => {
  it('prices A-frame Winter Village Stay for 2 nights', () => {
    const result = calculateWinterVillageTotal({
      productId: 'stay',
      accommodationId: 'a-frame',
      nights: 2
    });
    expect(result.total).toBe(150);
    expect(result.deposit).toBe(45);
    expect(result.balance).toBe(105);
    expect(result.normalised.nights).toBe(2);
    expect(result.normalised.guests).toBe(2);
  });

  it('prices Luxury Cabin Winter Village Stay for 3 nights', () => {
    const result = calculateWinterVillageTotal({
      productId: 'stay',
      accommodationId: 'lux-cabin',
      nights: 3
    });
    expect(result.total).toBe(330);
    expect(result.deposit).toBe(99);
    expect(result.balance).toBe(231);
  });

  it('enforces Stone House minimum occupancy on stays', () => {
    const result = calculateWinterVillageTotal({
      productId: 'stay',
      accommodationId: 'stone-house',
      nights: 2,
      guests: 1
    });
    expect(result.normalised.guests).toBe(3);
    expect(result.total).toBe(180); // 30 × 3 × 2
    expect(result.warnings.some((w) => /minimum/i.test(w))).toBe(true);
  });

  it('enforces Stone House maximum occupancy on stays', () => {
    const result = calculateWinterVillageTotal({
      productId: 'stay',
      accommodationId: 'stone-house',
      nights: 2,
      guests: 8
    });
    expect(result.normalised.guests).toBe(6);
    expect(result.total).toBe(360); // 30 × 6 × 2
    expect(result.warnings.some((w) => /maximum/i.test(w))).toBe(true);
  });

  it('adds optional €45 wellness on Winter Village Stay', () => {
    const result = calculateWinterVillageTotal({
      productId: 'stay',
      accommodationId: 'a-frame',
      nights: 2,
      wellnessSelected: true
    });
    expect(result.total).toBe(195);
    expect(result.lines.some((line) => /sauna/i.test(line.label))).toBe(true);
  });

  it('uses Parent & Child fixed package prices', () => {
    expect(
      calculateWinterVillageTotal({
        productId: 'parent-child',
        accommodationId: 'a-frame'
      }).total
    ).toBe(260);
    expect(
      calculateWinterVillageTotal({
        productId: 'parent-child',
        accommodationId: 'lux-cabin'
      }).total
    ).toBe(350);
  });

  it('uses Christmas fixed package prices', () => {
    expect(
      calculateWinterVillageTotal({
        productId: 'christmas',
        accommodationId: 'a-frame'
      }).total
    ).toBe(490);
    expect(
      calculateWinterVillageTotal({
        productId: 'christmas',
        accommodationId: 'lux-cabin'
      }).total
    ).toBe(590);
  });

  it('calculates Parent & Child Stone House adults and children', () => {
    const result = calculateWinterVillageTotal({
      productId: 'parent-child',
      accommodationId: 'stone-house',
      adults: 2,
      children4to12: 1,
      under4: 0
    });
    expect(result.total).toBe(320); // 2×130 + 1×60
  });

  it('calculates Christmas Stone House adults and children', () => {
    const result = calculateWinterVillageTotal({
      productId: 'christmas',
      accommodationId: 'stone-house',
      adults: 2,
      children4to12: 2,
      under4: 0
    });
    expect(result.total).toBe(540); // 2×180 + 2×90
  });

  it('keeps children under 4 free', () => {
    const result = calculateWinterVillageTotal({
      productId: 'christmas',
      accommodationId: 'stone-house',
      adults: 2,
      children4to12: 1,
      under4: 1
    });
    expect(result.total).toBe(450); // 2×180 + 1×90 + free under 4
    expect(result.lines.some((line) => /under 4/i.test(line.label) && line.amount === 0)).toBe(
      true
    );
  });

  it('prices Stone House stay for 6 guests, 2 nights, with wellness at €405', () => {
    const result = calculateWinterVillageTotal({
      productId: 'stay',
      accommodationId: 'stone-house',
      nights: 2,
      guests: 6,
      wellnessSelected: true
    });
    expect(result.normalised.guests).toBe(6);
    expect(result.normalised.nights).toBe(2);
    expect(result.normalised.wellnessSelected).toBe(true);
    expect(result.total).toBe(405); // 30 × 6 × 2 + 45
  });

  it('enforces Stone House min/max on hosted packages', () => {
    const tooFew = normaliseWinterVillageSelection({
      productId: 'parent-child',
      accommodationId: 'stone-house',
      adults: 1,
      children4to12: 0,
      under4: 0
    });
    expect(tooFew.guests).toBe(3);

    const tooMany = normaliseWinterVillageSelection({
      productId: 'christmas',
      accommodationId: 'stone-house',
      adults: 4,
      children4to12: 2,
      under4: 2
    });
    expect(tooMany.guests).toBe(6);
  });

  it('enforces minimum nights on Winter Village Stay', () => {
    const result = calculateWinterVillageTotal({
      productId: 'stay',
      accommodationId: 'a-frame',
      nights: 1
    });
    expect(result.normalised.nights).toBe(2);
    expect(result.total).toBe(150);
  });

  it('uses Christmas balance timing copy', () => {
    const result = calculateWinterVillageTotal({
      productId: 'christmas',
      accommodationId: 'a-frame'
    });
    expect(result.balanceLabel).toMatch(/45 days/i);
  });

  it('uses stay balance timing copy for Parent & Child', () => {
    const result = calculateWinterVillageTotal({
      productId: 'parent-child',
      accommodationId: 'a-frame'
    });
    expect(result.balanceLabel).toMatch(/30 days/i);
  });
});
