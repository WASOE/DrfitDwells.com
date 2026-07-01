import { describe, expect, it } from 'vitest';
import {
  isSameBookingQuoteOutcome,
  mergeServerQuoteUpdate,
  resolveAmountDueTodayCents
} from './ConfirmBooking.jsx';

const baseQuote = {
  subtotalPrice: 360,
  discountAmount: 0,
  totalPrice: 360,
  promo: { applied: false, invalidReason: null },
  voucherAppliedCents: 0,
  remainingDueCents: 36000,
  fullVoucherCoverage: false,
  voucherMessage: null
};

describe('ConfirmBooking quote outcome', () => {
  it('same total price but changed voucher fields updates state', () => {
    const prev = { ...baseQuote };
    const next = {
      ...baseQuote,
      voucherAppliedCents: 25000,
      remainingDueCents: 11000,
      fullVoucherCoverage: false
    };

    expect(isSameBookingQuoteOutcome(prev, next)).toBe(false);
    expect(mergeServerQuoteUpdate(prev, next)).toBe(next);
    expect(mergeServerQuoteUpdate(prev, next).voucherAppliedCents).toBe(25000);
    expect(mergeServerQuoteUpdate(prev, next).remainingDueCents).toBe(11000);
  });

  it('removing voucher clears voucher fields', () => {
    const withVoucher = {
      ...baseQuote,
      voucherAppliedCents: 25000,
      remainingDueCents: 11000,
      fullVoucherCoverage: false
    };
    const cleared = {
      ...baseQuote,
      voucherAppliedCents: 0,
      remainingDueCents: 36000,
      fullVoucherCoverage: false,
      voucherMessage: null
    };

    expect(isSameBookingQuoteOutcome(withVoucher, cleared)).toBe(false);
    const merged = mergeServerQuoteUpdate(withVoucher, cleared);
    expect(merged).toBe(cleared);
    expect(merged.voucherAppliedCents).toBe(0);
    expect(merged.remainingDueCents).toBe(36000);
    expect(merged.fullVoucherCoverage).toBe(false);
    expect(merged.voucherMessage).toBeNull();
  });

  it('amount due today uses remainingDueCents', () => {
    expect(
      resolveAmountDueTodayCents(
        { totalPrice: 360, remainingDueCents: 11000 },
        360
      )
    ).toBe(11000);

    expect(
      resolveAmountDueTodayCents(
        { totalPrice: 360, remainingDueCents: 0, fullVoucherCoverage: true },
        360
      )
    ).toBe(0);

    expect(resolveAmountDueTodayCents({ totalPrice: 360 }, 360)).toBe(36000);
    expect(resolveAmountDueTodayCents(null, 360)).toBe(36000);
  });

  it('keeps previous quote when full pricing outcome is unchanged', () => {
    const prev = { ...baseQuote };
    const next = { ...baseQuote, promo: { applied: false, invalidReason: null } };
    expect(mergeServerQuoteUpdate(prev, next)).toBe(prev);
  });

  it('updates quote when voucher error message changes', () => {
    const prev = { ...baseQuote, voucherMessage: null };
    const next = {
      ...baseQuote,
      voucherAppliedCents: 0,
      remainingDueCents: 36000,
      voucherMessage: 'This voucher cannot be used.'
    };
    expect(mergeServerQuoteUpdate(prev, next)).toBe(next);
  });
});
