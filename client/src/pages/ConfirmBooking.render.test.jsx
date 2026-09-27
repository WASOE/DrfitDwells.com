import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ConfirmBooking from './ConfirmBooking';
import { bookingAPI, cabinAPI } from '../services/api';
import { getStripePromise } from '../lib/stripeClient';
import { readCheckoutRecoveryState } from '../utils/checkoutRecoveryStorage';

vi.mock('../lib/stripeClient', () => ({ getStripePromise: vi.fn() }));
vi.mock('../services/api', () => ({
  cabinAPI: { getById: vi.fn() },
  cabinTypeAPI: { getBySlug: vi.fn() },
  bookingAPI: {
    quote: vi.fn(),
    getConfig: vi.fn(),
    createPaymentIntent: vi.fn(),
    getCheckoutRecoveryStatus: vi.fn()
  }
}));
vi.mock('../utils/checkoutSessionV2Flags', () => ({ isCheckoutSessionV2Enabled: () => false }));
vi.mock('../utils/checkoutRecoveryUxFlags', () => ({ isCheckoutRecoveryUxEnabled: () => true }));
vi.mock('../utils/checkoutRecoveryStorage', () => ({
  readCheckoutRecoveryState: vi.fn(() => null),
  writeCheckoutRecoveryState: vi.fn(),
  clearCheckoutRecoveryState: vi.fn()
}));
vi.mock('../hooks/useCheckoutRecoveryPolling', () => ({
  useCheckoutRecoveryPolling: () => ({ statusPayload: null, delayed: false, networkError: false })
}));
vi.mock('../hooks/useSiteLanguage', () => ({ useSiteLanguage: () => ({ language: 'en' }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, options) => options?.amount ? `${key} ${options.amount}` : key })
}));
vi.mock('../components/Seo', () => ({ default: () => null }));
vi.mock('../components/booking/ChangeDatesModal', () => ({ default: () => null }));
vi.mock('../components/booking/ChangeGuestsModal', () => ({ default: () => null }));
vi.mock('../components/booking/PriceDetailsModal', () => ({ default: () => null }));
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children, stripe, options }) => (
    <div data-testid="stripe-elements" data-secret={options.clientSecret} data-available={Boolean(stripe)}>
      {children}
    </div>
  ),
  PaymentElement: ({ onReady }) => (
    <button type="button" onClick={onReady}>Mock card form</button>
  ),
  useStripe: () => ({}),
  useElements: () => ({})
}));

const offer = {
  totalCents: 60000,
  stayCreditProtectionText: 'Your reservation payment is protected as StayCredit.',
  futureChargeConsent: { displayedText: 'I authorize the future charge.' },
  installments: [
    { sequence: 1, amountCents: 24000, dueAtDateOnly: '2026-10-01' },
    { sequence: 2, amountCents: 36000, dueAtDateOnly: '2026-11-01' }
  ]
};

function mountBooking() {
  return render(
    <MemoryRouter initialEntries={[{
      pathname: '/booking/confirm/cabin-1',
      state: {
        cabinId: 'cabin-1',
        formData: {
          firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test',
          phone: '+359888000111', agreedToTerms: true, agreedToActivityRisk: true
        },
        searchCriteria: { checkIn: '2026-10-01', checkOut: '2026-10-03', adults: 2, children: 0 }
      }
    }]}>
      <Routes><Route path="/booking/confirm/:id" element={<ConfirmBooking />} /></Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  getStripePromise.mockReturnValue(Promise.resolve({}));
  readCheckoutRecoveryState.mockReturnValue(null);
  cabinAPI.getById.mockResolvedValue({
    data: { success: true, data: { cabin: { name: 'Cabin', capacity: 4, pricePerNight: 300 } } }
  });
  bookingAPI.quote.mockResolvedValue({ data: { success: true, data: { totalPrice: 600, subtotalPrice: 600 } } });
  bookingAPI.getConfig.mockResolvedValue({ data: { success: true, data: { stripeEnabled: true } } });
  bookingAPI.createPaymentIntent.mockResolvedValue({
    data: { success: true, clientSecret: 'pi_secret_fixture', stripeAmountCents: 60000 }
  });
});
afterEach(() => cleanup());

describe('ConfirmBooking payment render states', () => {
  it('shows the full-payment initiation before preparation', async () => {
    mountBooking();
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Continue to secure payment' })).toBeEnabled(),
      { timeout: 5000 }
    );
    expect(screen.queryByTestId('stripe-elements')).not.toBeInTheDocument();
  });

  it('shows the split offer after preparation and requires future-charge consent to retry as split', async () => {
    bookingAPI.createPaymentIntent
      .mockResolvedValueOnce({
        data: { success: true, splitPaymentOffer: offer, stripeAmountCents: 60000 }
      })
      .mockResolvedValueOnce({
        data: { success: true, splitPaymentOffer: offer, clientSecret: 'pi_split_secret', stripeAmountCents: 24000 }
      });
    mountBooking();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue to secure payment' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Continue to secure payment' }));
    expect(await screen.findByText('Pay in full')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('radio')[1]);
    expect(screen.getByRole('button', { name: 'Continue to secure payment' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /I authorize the future charge/ }));
    expect(screen.getByRole('button', { name: 'Continue to secure payment' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to secure payment' }));
    expect(await screen.findByTestId('stripe-elements')).toHaveAttribute('data-secret', 'pi_split_secret');
    expect(bookingAPI.createPaymentIntent).toHaveBeenLastCalledWith(
      expect.objectContaining({ paymentChoice: 'split', futureChargeConsent: expect.any(Object) })
    );
  });

  it('mounts the PaymentElement successor after successful preparation', async () => {
    mountBooking();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue to secure payment' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Continue to secure payment' }));
    const elements = await screen.findByTestId('stripe-elements');
    expect(elements).toHaveAttribute('data-secret', 'pi_secret_fixture');
    expect(elements).toHaveAttribute('data-available', 'true');
    expect(within(elements).getByRole('button', { name: 'Mock card form' })).toBeInTheDocument();
    expect(screen.getByText(/Loading secure card form/)).toBeInTheDocument();
  });

  it('shows an explicit unavailable state if the server offers card payment but Stripe is missing', async () => {
    getStripePromise.mockReturnValue(null);
    mountBooking();
    expect(await screen.findByRole('alert')).toHaveTextContent('Secure card payment is temporarily unavailable');
    expect(screen.getByRole('button', { name: 'Refresh checkout' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue to secure payment' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('stripe-elements')).not.toBeInTheDocument();
    expect(bookingAPI.createPaymentIntent).not.toHaveBeenCalled();
  });

  it('does not hide controls without displaying the recovery panel', async () => {
    readCheckoutRecoveryState.mockReturnValue({ paymentMayHaveSucceeded: true });
    mountBooking();
    expect(await screen.findByTestId('checkout-recovery-panel')).toHaveTextContent('Confirming your reservation');
    expect(screen.queryByRole('button', { name: 'Continue to secure payment' })).not.toBeInTheDocument();
  });

  it('shows pay-on-arrival only when the server explicitly disables card payments', async () => {
    bookingAPI.getConfig.mockResolvedValue({ data: { success: true, data: { stripeEnabled: false } } });
    mountBooking();
    expect(await screen.findByRole('button', { name: /confirmPayWithAmount/ })).toBeInTheDocument();
    expect(screen.queryByTestId('stripe-elements')).not.toBeInTheDocument();
  });

  it('shows a safe unavailable state if Stripe initialization fails', async () => {
    getStripePromise.mockReturnValue(Promise.resolve(null));
    mountBooking();
    expect(await screen.findByRole('alert')).toHaveTextContent('Secure card payment is temporarily unavailable');
    expect(screen.getByRole('button', { name: 'Refresh checkout' })).toBeInTheDocument();
  });

  it('uses a safe visible fallback for invalid capability data', async () => {
    bookingAPI.getConfig.mockResolvedValue({ data: { success: true, data: {} } });
    mountBooking();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Secure card payment is temporarily unavailable'));
    expect(screen.queryByRole('button', { name: /confirmPayWithAmount/ })).not.toBeInTheDocument();
  });
});
