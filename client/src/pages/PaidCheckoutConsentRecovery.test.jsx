import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PaidCheckoutConsentRecovery from './PaidCheckoutConsentRecovery';
import { bookingAPI } from '../services/api';

vi.mock('../services/api', () => ({
  bookingAPI: {
    submitPaidCheckoutRecoveryConsent: vi.fn(),
    createPaymentIntent: vi.fn()
  }
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PaidCheckoutConsentRecovery', () => {
  it('records only guest details and legal consent for the existing checkout', async () => {
    bookingAPI.submitPaidCheckoutRecoveryConsent.mockResolvedValue({
      data: { success: true, noPaymentAttempted: true }
    });
    render(
      <MemoryRouter initialEntries={['/booking-recovery/consent/opaque-checkout-token']}>
        <Routes>
          <Route
            path="/booking-recovery/consent/:checkoutId"
            element={<PaidCheckoutConsentRecovery />}
          />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Lovelace' } });
    fireEvent.change(screen.getByLabelText('Booking email'), {
      target: { value: 'ada@example.test' }
    });
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+359888000111' } });
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Terms & Conditions and Cancellation Policy/ })
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: /participating in any outdoor or transport activity/ })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save details and consent' }));

    await waitFor(() => {
      expect(bookingAPI.submitPaidCheckoutRecoveryConsent).toHaveBeenCalledWith(
        'opaque-checkout-token',
        expect.objectContaining({
          guestInfo: {
            firstName: 'Ada',
            lastName: 'Lovelace',
            email: 'ada@example.test',
            phone: '+359888000111'
          },
          legalAcceptance: expect.objectContaining({
            acceptedTermsAndCancellation: true,
            acceptedActivityRisk: true
          })
        })
      );
    });
    expect(bookingAPI.createPaymentIntent).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Do not make another payment');
  });
});
