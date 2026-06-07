import { describe, expect, it } from 'vitest';
import { getBuildOptionPriceLabel } from '../../components/build/BuildOptionPriceTag.jsx';

describe('BuildOptionPriceTag', () => {
  it('shows Price at consultation for consultation options', () => {
    expect(
      getBuildOptionPriceLabel({ priceOnConsultation: true, priceDelta: 2400 })
    ).toBe('Price at consultation');
  });

  it('shows Included for included options', () => {
    expect(getBuildOptionPriceLabel({ included: true, priceDelta: 0 })).toBe('Included');
  });

  it('shows formatted delta for fixed-price add-ons', () => {
    expect(getBuildOptionPriceLabel({ priceDelta: 2800 })).toBe('+ €2,800');
  });
});
