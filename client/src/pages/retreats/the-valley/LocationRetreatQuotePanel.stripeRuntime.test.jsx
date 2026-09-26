import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import LocationRetreatQuotePanel from './LocationRetreatQuotePanel';
import { loadStripe } from '@stripe/stripe-js';
import useLocationRetreatBooking from '../../../hooks/useLocationRetreatBooking';

vi.mock('@stripe/stripe-js', () => ({ loadStripe: vi.fn() }));
vi.mock('../../../hooks/useLocationRetreatBooking', () => ({ default: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} }
}));
vi.mock('../../../components/GuestSelect', () => ({ default: () => null }));
vi.mock('../../../components/booking/PriceDetailsModal', () => ({ default: () => null }));
vi.mock('../../../components/booking/StayLodgingPriceBlock', () => ({
  StayLodgingPriceBlock: () => null
}));
vi.mock('./LocationPaymentForm', () => ({
  default: () => <div data-testid="location-payment-form" />
}));
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }) => <div data-testid="stripe-elements">{children}</div>
}));

const nodeProcess = globalThis.process;

function rejectingLoad() {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error('stripe.js blocked')), 0);
  });
}

function bookingState() {
  return {
    checkIn: null,
    checkOut: null,
    nights: 2,
    quote: null,
    quoteLoading: false,
    quoteError: null,
    dateError: null,
    runQuote: vi.fn(),
    checkoutStep: true,
    checkoutLoading: false,
    checkoutError: null,
    holdExpired: false,
    startCheckout: vi.fn(),
    clientSecret: 'pi_secret_123',
    handlePay: vi.fn(),
    payLoading: false,
    success: null,
    formData: { firstName: '', lastName: '', email: '', phone: '' },
    setFormData: vi.fn(),
    roomNotes: '',
    setRoomNotes: vi.fn(),
    roomAssignments: [],
    setRoomAssignments: vi.fn(),
    dateSummary: '',
    priceExtras: null,
    guestFormValid: true
  };
}

let unhandled;
const collectUnhandled = (reason) => unhandled.push(reason);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  useLocationRetreatBooking.mockReturnValue(bookingState());
  unhandled = [];
  nodeProcess.on('unhandledRejection', collectUnhandled);
});

afterEach(() => {
  nodeProcess.off('unhandledRejection', collectUnhandled);
  cleanup();
  vi.unstubAllEnvs();
});

describe('LocationRetreatQuotePanel runtime Stripe failures', () => {
  it('surfaces the unavailable state when Stripe.js resolves to null', async () => {
    vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', 'pk_test_runtimeNull');
    loadStripe.mockImplementation(() => Promise.resolve(null));

    render(<LocationRetreatQuotePanel />);

    await waitFor(() =>
      expect(screen.getByTestId('location-retreat-stripe-unavailable')).toBeInTheDocument()
    );
    expect(screen.queryByTestId('stripe-elements')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'confirm.paymentUnavailableRetry' })).toBeInTheDocument();
    expect(unhandled).toEqual([]);
  });

  it('surfaces the unavailable state when Stripe.js rejects, without an unhandled rejection', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', 'pk_test_runtimeReject');
    loadStripe.mockImplementation(() => rejectingLoad());

    render(<LocationRetreatQuotePanel />);

    await waitFor(() =>
      expect(screen.getByTestId('location-retreat-stripe-unavailable')).toBeInTheDocument()
    );
    expect(screen.queryByTestId('stripe-elements')).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(unhandled).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith(
      'Stripe client initialization failed:',
      expect.any(Error)
    );
    consoleError.mockRestore();
  });
});
