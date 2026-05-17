import { describe, expect, it } from 'vitest';
import { formatPaymentSubline, isValleyLocation } from './bookingConfirmationDisplay';

const t = (key, opts) => {
  if (key === 'success.paymentCardAndVoucher') {
    return `voucher:${opts.voucherAmount};card:${opts.cardAmount}`;
  }
  return key;
};

describe('bookingConfirmationDisplay', () => {
  it('isValleyLocation matches valley stays', () => {
    expect(isValleyLocation('The Valley')).toBe(true);
    expect(isValleyLocation('Bansko')).toBe(false);
  });

  it('formatPaymentSubline uses pending copy when unpaid', () => {
    expect(
      formatPaymentSubline(t, {
        paid: false,
        copyKey: 'success.paymentPendingOnArrival'
      })
    ).toBe('success.paymentPendingOnArrival');
  });

  it('formatPaymentSubline uses paid online copy for card', () => {
    expect(
      formatPaymentSubline(t, {
        paid: true,
        method: 'stripe',
        copyKey: 'success.paymentPaidOnline'
      })
    ).toBe('success.paymentPaidOnline');
  });

  it('formatPaymentSubline formats mixed voucher+card', () => {
    expect(
      formatPaymentSubline(t, {
        paid: true,
        method: 'stripe_plus_gift_voucher',
        voucherAppliedAmount: 250,
        cardPaidAmount: 110,
        copyKey: 'success.paymentCardAndVoucher'
      })
    ).toBe('voucher:250;card:110');
  });
});
