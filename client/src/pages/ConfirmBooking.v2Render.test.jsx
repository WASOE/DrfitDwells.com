import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ConfirmBooking, {
  V2_CHECKOUT_RESTART_MESSAGE,
  V2_CHECKOUT_RETRY_PAYMENT_MESSAGE
} from './ConfirmBooking';
import { bookingAPI, cabinAPI } from '../services/api';
import { getStripePromise } from '../lib/stripeClient';
import { readCheckoutRecoveryState } from '../utils/checkoutRecoveryStorage';

const polling = vi.hoisted(() => ({ options: null, confirmPayment: vi.fn() }));

vi.mock('../lib/stripeClient', () => ({ getStripePromise: vi.fn() }));
vi.mock('../services/api', () => ({
  cabinAPI: { getById: vi.fn() },
  cabinTypeAPI: { getBySlug: vi.fn() },
  bookingAPI: {
    quote: vi.fn(),
    getConfig: vi.fn(),
    getCheckoutCapabilities: vi.fn(),
    createPaymentIntent: vi.fn(),
    persistFinalizeIntent: vi.fn(),
    create: vi.fn(),
    getCheckoutRecoveryStatus: vi.fn()
  }
}));
vi.mock('../utils/checkoutSessionV2Flags', () => ({ isCheckoutSessionV2Enabled: () => true }));
vi.mock('../utils/finalizeIntentFlags', () => ({
  isFinalizeIntentPersistEnabled: () => true,
  isFinalizeIntentRequiredForPiEnabled: () => false
}));
vi.mock('../utils/checkoutRecoveryUxFlags', () => ({ isCheckoutRecoveryUxEnabled: () => true }));
vi.mock('../utils/checkoutRecoveryStorage', () => ({
  readCheckoutRecoveryState: vi.fn(() => null),
  writeCheckoutRecoveryState: vi.fn(),
  clearCheckoutRecoveryState: vi.fn()
}));
vi.mock('../hooks/useCheckoutRecoveryPolling', () => ({
  useCheckoutRecoveryPolling: (options) => {
    polling.options = options;
    return { statusPayload: null, delayed: false, networkError: false };
  }
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
  Elements: ({ children, options }) => (
    <div data-testid="stripe-elements" data-secret={options.clientSecret}>{children}</div>
  ),
  PaymentElement: () => <div data-testid="payment-element">Secure card fields</div>,
  useStripe: () => ({ confirmPayment: polling.confirmPayment }),
  useElements: () => ({})
}));

const splitOffer = {
  totalCents: 60000,
  offerSnapshotHash: 'offer-hash',
  stayCreditProtectionText: 'Protected as StayCredit.',
  futureChargeConsent: {
    displayedText: 'I authorize a future charge.',
    consentVersion: '1',
    consentHash: 'consent-hash'
  },
  installments: [
    { sequence: 1, amountCents: 24000, dueAtDateOnly: '2026-10-01' },
    { sequence: 2, amountCents: 36000, dueAtDateOnly: '2026-11-01' }
  ]
};

function response({
  clientSecret = 'pi_secret_full',
  canonicalPaymentIntentId = 'pi_full',
  quoteSnapshotHash = 'quote-one',
  splitPaymentOffer = null,
  noPaymentRequired = false,
  fullVoucherCoverage = false,
  voucherRedemptionId = null,
  ...extra
} = {}) {
  return {
    data: {
      success: true, flowVersion: 'v2', checkoutId: 'chk_v2',
      sessionVersion: 1, clientSecret, canonicalPaymentIntentId, quoteSnapshotHash,
      stripeAmountCents: noPaymentRequired ? 0 : 60000,
      splitPaymentOffer, noPaymentRequired, fullVoucherCoverage,
      voucherRedemptionId, ...extra
    }
  };
}

function mountBooking() {
  render(
    <MemoryRouter initialEntries={[{
      pathname: '/booking/confirm/cabin-1',
      state: {
        cabinId: 'cabin-1',
        formData: {
          firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test',
          phone: '+359888000111', specialRequests: '',
          agreedToTerms: true, agreedToActivityRisk: true
        },
        searchCriteria: { checkIn: '2026-10-01', checkOut: '2026-10-03', adults: 2, children: 0 }
      }
    }]}>
      <Routes><Route path="/booking/confirm/:id" element={<ConfirmBooking />} /></Routes>
    </MemoryRouter>
  );
}

async function initiate() {
  await waitFor(
    () => expect(screen.getByRole('button', { name: 'Continue to secure payment' })).toBeEnabled(),
    { timeout: 5000 }
  );
  fireEvent.click(screen.getByRole('button', { name: 'Continue to secure payment' }));
}

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  polling.options = null;
  getStripePromise.mockReturnValue(Promise.resolve({}));
  readCheckoutRecoveryState.mockReturnValue(null);
  cabinAPI.getById.mockResolvedValue({
    data: { success: true, data: { cabin: { name: 'Cabin', capacity: 4, pricePerNight: 300 } } }
  });
  bookingAPI.quote.mockResolvedValue({ data: { success: true, data: { totalPrice: 600, subtotalPrice: 600 } } });
  bookingAPI.getConfig.mockResolvedValue({ data: { success: true, data: { stripeEnabled: true } } });
  bookingAPI.getCheckoutCapabilities.mockRejectedValue(new Error('advisory unavailable'));
  bookingAPI.createPaymentIntent.mockResolvedValue(response());
  bookingAPI.persistFinalizeIntent.mockResolvedValue({
    data: { success: true, finalizeIntentHash: 'finalize-hash', sessionVersion: 2 }
  });
  polling.confirmPayment.mockResolvedValue({ error: { message: 'Payment was not completed.' } });
});
afterEach(() => cleanup());

describe('ConfirmBooking V2 mounted payment transitions', () => {
  it('starts with full payment and mounts the card form after preparation', async () => {
    mountBooking();
    expect(await screen.findByRole('button', { name: 'Continue to secure payment' })).toBeInTheDocument();
    expect(screen.queryByTestId('payment-element')).not.toBeInTheDocument();
    await initiate();
    expect(within(await screen.findByTestId('stripe-elements')).getByTestId('payment-element')).toBeInTheDocument();
  });

  it('renders preparing until the server responds', async () => {
    let finish;
    bookingAPI.createPaymentIntent.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    mountBooking();
    await initiate();
    expect(await screen.findByRole('button', { name: 'Preparing secure payment…' })).toBeDisabled();
    await act(async () => finish(response()));
    expect(await screen.findByTestId('payment-element')).toBeInTheDocument();
  });

  it('shows split choice and consent before starting split payment', async () => {
    bookingAPI.createPaymentIntent.mockResolvedValueOnce(response({
      clientSecret: null, splitPaymentOffer: splitOffer
    })).mockResolvedValueOnce(response({
      clientSecret: 'pi_secret_split', canonicalPaymentIntentId: 'pi_split',
      splitPaymentOffer: splitOffer, paymentChoice: 'split'
    }));
    mountBooking();
    await initiate();
    expect(await screen.findByText('Pay in full')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('radio')[1]);
    expect(screen.getByRole('button', { name: 'Continue to secure payment' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /I authorize a future charge/ }));
    await initiate();
    expect(await screen.findByTestId('payment-element')).toBeInTheDocument();
    expect(bookingAPI.createPaymentIntent).toHaveBeenLastCalledWith(
      expect.objectContaining({ paymentChoice: 'split', splitOfferSnapshotHash: 'offer-hash' })
    );
  });

  it('shows classified preparation failures and retries successfully', async () => {
    bookingAPI.createPaymentIntent.mockRejectedValueOnce({
      response: { status: 409, data: { code: 'STALE_CLIENT_SECRET' } }
    }).mockResolvedValueOnce(response());
    mountBooking();
    await initiate();
    expect(await screen.findByRole('alert')).toHaveTextContent(V2_CHECKOUT_RETRY_PAYMENT_MESSAGE);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('payment-element')).toBeInTheDocument();
  });

  it.each([
    'FINALIZE_INTENT_IMMUTABLE',
    'FINALIZE_INTENT_SESSION_VERSION_CONFLICT',
    'CHECKOUT_SESSION_NOT_FOUND',
    'INVALID_CHECKOUT_ID'
  ])('preserves %s restart guidance and mints a new checkout identity', async (code) => {
    bookingAPI.createPaymentIntent.mockRejectedValueOnce({
      response: { status: 409, data: { code } }
    }).mockResolvedValueOnce(response());
    mountBooking();
    await initiate();
    const guidance = await screen.findByRole('alert');
    expect(guidance).toHaveTextContent(
      code.startsWith('FINALIZE_INTENT_') ? /refresh/ : V2_CHECKOUT_RESTART_MESSAGE
    );
    const previousId = bookingAPI.createPaymentIntent.mock.calls[0][0].checkoutId;
    fireEvent.click(within(guidance).getByRole('button', {
      name: code.startsWith('FINALIZE_INTENT_') ? 'Retry' : 'Continue to secure payment'
    }));
    expect(await screen.findByTestId('payment-element')).toBeInTheDocument();
    expect(bookingAPI.createPaymentIntent.mock.calls[1][0].checkoutId).not.toBe(previousId);
  });

  it('keeps failure guidance visible and offers refresh if Stripe fails after preparation', async () => {
    let resolveStripe;
    const stripePromise = new Promise((resolve) => { resolveStripe = resolve; });
    getStripePromise.mockReturnValue(stripePromise);
    bookingAPI.createPaymentIntent.mockRejectedValueOnce({
      response: { status: 409, data: { code: 'STALE_CLIENT_SECRET' } }
    });
    mountBooking();
    await initiate();
    expect(await screen.findByRole('alert')).toHaveTextContent(V2_CHECKOUT_RETRY_PAYMENT_MESSAGE);
    await act(async () => resolveStripe(null));
    expect(screen.getByRole('alert')).toHaveTextContent('Secure card payment is temporarily unavailable');
    expect(screen.getByRole('button', { name: 'Refresh checkout' })).toBeInTheDocument();
  });

  it('shows an unavailable replacement before V2 payment preparation when Stripe is absent', async () => {
    getStripePromise.mockReturnValue(null);
    mountBooking();
    expect(await screen.findByRole('alert')).toHaveTextContent('Secure card payment is temporarily unavailable');
    expect(screen.getByRole('button', { name: 'Refresh checkout' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue to secure payment' })).not.toBeInTheDocument();
    expect(bookingAPI.createPaymentIntent).not.toHaveBeenCalled();
  });

  it('shows an unavailable replacement when Stripe initialization rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      getStripePromise.mockReturnValue(Promise.reject(new Error('Stripe.js load failed')));
      mountBooking();
      expect(await screen.findByRole('alert')).toHaveTextContent('Secure card payment is temporarily unavailable');
      expect(screen.getByRole('button', { name: 'Refresh checkout' })).toBeInTheDocument();
      expect(bookingAPI.createPaymentIntent).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('blocks card preparation when Stripe is unavailable, including after a client secret arrives', async () => {
    let resolveStripe;
    getStripePromise.mockReturnValue(new Promise((resolve) => { resolveStripe = resolve; }));
    mountBooking();
    await initiate();
    expect(await screen.findByTestId('payment-element')).toBeInTheDocument();
    await act(async () => resolveStripe(null));
    expect(screen.getByRole('alert')).toHaveTextContent('Secure card payment is temporarily unavailable');
    expect(screen.queryByTestId('payment-element')).not.toBeInTheDocument();
  });

  it('shows recovery even when payment may have succeeded but recoveryActive is false', async () => {
    readCheckoutRecoveryState.mockReturnValue({ paymentMayHaveSucceeded: true });
    mountBooking();
    expect(await screen.findByTestId('checkout-recovery-panel')).toHaveTextContent('Confirming your reservation');
    expect(polling.options.enabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Continue to secure payment' })).not.toBeInTheDocument();
  });

  it('shows recoveryActive with no successful-payment marker and retains preparation guidance', async () => {
    bookingAPI.createPaymentIntent.mockRejectedValueOnce({
      response: { status: 409, data: { code: 'STALE_CLIENT_SECRET' } }
    });
    mountBooking();
    await initiate();
    expect(await screen.findByRole('alert')).toHaveTextContent(V2_CHECKOUT_RETRY_PAYMENT_MESSAGE);
    act(() => polling.options.onNeedsReview());
    expect(screen.getByTestId('checkout-recovery-panel')).toHaveTextContent('Confirming your reservation');
    expect(screen.getByRole('alert')).toHaveTextContent(V2_CHECKOUT_RETRY_PAYMENT_MESSAGE);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('submits full-voucher no-card booking through the V2 checkout', async () => {
    bookingAPI.createPaymentIntent.mockResolvedValue(response({
      clientSecret: null, noPaymentRequired: true, fullVoucherCoverage: true
    }));
    bookingAPI.create.mockResolvedValue({ data: { success: true, data: { booking: { _id: 'booking-1' } } } });
    mountBooking();
    await initiate();
    const complete = await screen.findByRole('button', { name: 'Complete booking' });
    expect(complete).toBeEnabled();
    fireEvent.click(complete);
    await waitFor(() => expect(bookingAPI.create).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('stripe-elements')).not.toBeInTheDocument();
  });

  it('remounts V2 Elements when finalizeIntent synchronization changes the quote identity', async () => {
    bookingAPI.createPaymentIntent.mockResolvedValueOnce(response()).mockResolvedValueOnce(
      response({ quoteSnapshotHash: 'quote-two', clientSecret: 'pi_secret_full' })
    );
    mountBooking();
    await initiate();
    const oldElements = await screen.findByTestId('stripe-elements');
    fireEvent.click(within(oldElements).getByRole('button', { name: 'cta.confirmAndPay' }));
    await waitFor(() => expect(bookingAPI.persistFinalizeIntent).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('stripe-elements')).not.toBe(oldElements));
    expect(screen.getByTestId('stripe-elements')).toHaveAttribute('data-secret', 'pi_secret_full');
    expect(polling.confirmPayment).toHaveBeenCalled();
  });
});
