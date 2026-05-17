const VALLEY_LOCATION_MARKERS = ['The Valley', 'Valley'];

export function isValleyLocation(location) {
  const loc = String(location || '').toLowerCase();
  return VALLEY_LOCATION_MARKERS.some((marker) => loc.includes(marker.toLowerCase()));
}

export function formatPaymentSubline(t, paymentSummary) {
  if (!paymentSummary) return '';
  if (
    paymentSummary.method === 'stripe_plus_gift_voucher' &&
    paymentSummary.paid &&
    paymentSummary.voucherAppliedAmount != null &&
    paymentSummary.cardPaidAmount != null
  ) {
    return t('success.paymentCardAndVoucher', {
      voucherAmount: paymentSummary.voucherAppliedAmount,
      cardAmount: paymentSummary.cardPaidAmount
    });
  }
  return t(paymentSummary.copyKey || 'success.paymentPendingOnArrival');
}
