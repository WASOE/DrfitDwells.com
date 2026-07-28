/**
 * Batch 9 — Frontend recovery UX helpers / panel.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  shouldEnterRecoveryAfterPayment,
  mapStatusToPanelPhase,
  shouldHidePaymentControls,
  shouldStartPollingAfterBookingCreateFailure
} from '../utils/checkoutRecoveryFlow.js';
import {
  computeNextPollIntervalMs,
  isTerminalRecoveryStatus,
  shouldShowDelayedCopy,
  RECOVERY_DELAYED_THRESHOLD_MS,
  RECOVERY_INITIAL_INTERVAL_MS,
  RECOVERY_DELAYED_INTERVAL_MS,
  RECOVERY_HIDDEN_INTERVAL_MS
} from '../utils/checkoutRecoveryPolling.js';
import {
  writeCheckoutRecoveryState,
  readCheckoutRecoveryState,
  clearCheckoutRecoveryState
} from '../utils/checkoutRecoveryStorage.js';
import CheckoutRecoveryPanel from '../components/booking/CheckoutRecoveryPanel.jsx';

describe('checkout recovery flow helpers', () => {
  it('13/15) recovery enters only when flag on and payment may have succeeded', () => {
    expect(
      shouldEnterRecoveryAfterPayment({ flagEnabled: false, paymentMayHaveSucceeded: true })
    ).toBe(false);
    expect(
      shouldEnterRecoveryAfterPayment({ flagEnabled: true, paymentMayHaveSucceeded: true })
    ).toBe(true);
    expect(
      shouldHidePaymentControls({
        flagEnabled: true,
        recoveryActive: false,
        paymentMayHaveSucceeded: true
      })
    ).toBe(true);
  });

  it('14) booking create failure after payment starts polling', () => {
    expect(
      shouldStartPollingAfterBookingCreateFailure({
        flagEnabled: true,
        paymentMayHaveSucceeded: true
      })
    ).toBe(true);
  });

  it('16) finalizing maps to confirming phase', () => {
    expect(mapStatusToPanelPhase({ status: 'finalizing', delayed: false })).toBe('finalizing');
  });

  it('17–18) delayed state after ~60s', () => {
    expect(shouldShowDelayedCopy(RECOVERY_DELAYED_THRESHOLD_MS)).toBe(true);
    expect(mapStatusToPanelPhase({ status: 'finalizing', delayed: true })).toBe('delayed');
  });

  it('20–22) terminal statuses', () => {
    expect(isTerminalRecoveryStatus('confirmed')).toBe(true);
    expect(isTerminalRecoveryStatus('needs_review')).toBe(true);
    expect(isTerminalRecoveryStatus('payment_failed')).toBe(true);
    expect(isTerminalRecoveryStatus('finalizing')).toBe(false);
    expect(mapStatusToPanelPhase({ status: 'needs_review' })).toBe('needs_review');
    expect(mapStatusToPanelPhase({ status: 'payment_failed' })).toBe('payment_failed');
  });

  it('19/25) network backoff and hidden tab intervals', () => {
    expect(computeNextPollIntervalMs({ elapsedMs: 0, consecutiveErrors: 0 })).toBe(
      RECOVERY_INITIAL_INTERVAL_MS
    );
    expect(
      computeNextPollIntervalMs({ elapsedMs: 0, consecutiveErrors: 0, documentHidden: true })
    ).toBe(RECOVERY_HIDDEN_INTERVAL_MS);
    expect(
      computeNextPollIntervalMs({
        elapsedMs: RECOVERY_DELAYED_THRESHOLD_MS,
        consecutiveErrors: 0
      })
    ).toBe(RECOVERY_DELAYED_INTERVAL_MS);
    expect(computeNextPollIntervalMs({ elapsedMs: 0, consecutiveErrors: 2 })).toBeGreaterThan(
      RECOVERY_INITIAL_INTERVAL_MS
    );
  });
});

describe('checkout recovery storage (23)', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    sessionStorage.clear();
  });

  it('persists and restores recovery state for refresh', () => {
    writeCheckoutRecoveryState('chk_test_1', {
      paymentMayHaveSucceeded: true,
      guestEmail: 'Guest@Example.com'
    });
    const read = readCheckoutRecoveryState('chk_test_1');
    expect(read.paymentMayHaveSucceeded).toBe(true);
    expect(read.guestEmail).toBe('guest@example.com');
    clearCheckoutRecoveryState('chk_test_1');
    expect(readCheckoutRecoveryState('chk_test_1')).toBeNull();
  });
});

describe('CheckoutRecoveryPanel copy', () => {
  it('16) finalizing shows Confirming your reservation', () => {
    render(<CheckoutRecoveryPanel phase="finalizing" checkoutId="chk_x" />);
    expect(screen.getByText('Confirming your reservation')).toBeTruthy();
    expect(screen.getByText('Please keep this page open and do not make another payment.')).toBeTruthy();
  });

  it('17–18) delayed copy', () => {
    render(<CheckoutRecoveryPanel phase="delayed" checkoutId="chk_x" />);
    expect(screen.getByText('Your payment was received')).toBeTruthy();
    expect(
      screen.getByText(
        /Your reservation is taking a little longer than usual to confirm\. You do not need to make another payment\./
      )
    ).toBeTruthy();
    expect(screen.getByText('Check reservation status')).toBeTruthy();
  });

  it('21) needs_review has no retry payment', () => {
    render(<CheckoutRecoveryPanel phase="needs_review" checkoutId="chk_x" />);
    expect(screen.queryByText('Try payment again')).toBeNull();
    expect(screen.getByText('Please do not make another payment.')).toBeTruthy();
  });

  it('22) payment_failed retry only when allowed', () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <CheckoutRecoveryPanel
        phase="payment_failed"
        canRetryPayment={false}
        onRetryPayment={onRetry}
      />
    );
    expect(screen.queryByText('Try payment again')).toBeNull();
    rerender(
      <CheckoutRecoveryPanel
        phase="payment_failed"
        canRetryPayment
        onRetryPayment={onRetry}
      />
    );
    expect(screen.getByText('Try payment again')).toBeTruthy();
  });
});
