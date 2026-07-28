/**
 * Pure helpers for Batch 9 recovery UX transitions (unit-tested).
 */

export function shouldEnterRecoveryAfterPayment({
  flagEnabled = false,
  paymentMayHaveSucceeded = false
} = {}) {
  return flagEnabled === true && paymentMayHaveSucceeded === true;
}

export function mapStatusToPanelPhase({ status = null, delayed = false } = {}) {
  const s = String(status || '');
  if (s === 'needs_review') return 'needs_review';
  if (s === 'payment_failed') return 'payment_failed';
  if (s === 'confirmed') return 'confirmed';
  if (delayed && (s === 'finalizing' || s === 'checking_payment' || !s)) {
    return 'delayed';
  }
  if (s === 'checking_payment') return 'checking_payment';
  return 'finalizing';
}

export function shouldHidePaymentControls({
  flagEnabled = false,
  recoveryActive = false,
  paymentMayHaveSucceeded = false
} = {}) {
  if (!flagEnabled) return false;
  return recoveryActive === true || paymentMayHaveSucceeded === true;
}

export function shouldStartPollingAfterBookingCreateFailure({
  flagEnabled = false,
  paymentMayHaveSucceeded = false
} = {}) {
  return shouldEnterRecoveryAfterPayment({ flagEnabled, paymentMayHaveSucceeded });
}
