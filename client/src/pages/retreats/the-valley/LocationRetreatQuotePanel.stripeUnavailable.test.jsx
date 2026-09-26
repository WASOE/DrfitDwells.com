import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import LocationRetreatQuotePanel from './LocationRetreatQuotePanel';
import { useStripeAvailability } from '../../../lib/stripeClient';
import useLocationRetreatBooking from '../../../hooks/useLocationRetreatBooking';
import { CONTACT_EMAIL } from '../../../data/gmbLocations';

vi.mock('../../../lib/stripeClient', () => ({ useStripeAvailability: vi.fn() }));
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

const retry = vi.fn();

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

beforeEach(() => {
  vi.clearAllMocks();
  useLocationRetreatBooking.mockReturnValue(bookingState());
});

afterEach(() => {
  cleanup();
});

describe('LocationRetreatQuotePanel stripe availability', () => {
  it('shows an explicit unavailable notice instead of an empty checkout area', () => {
    useStripeAvailability.mockReturnValue({
      stripePromise: null,
      status: 'unavailable',
      unavailable: true,
      ready: false,
      retry
    });

    render(<LocationRetreatQuotePanel />);

    const notice = screen.getByTestId('location-retreat-stripe-unavailable');
    expect(notice).toHaveAttribute('role', 'alert');
    expect(screen.getByText('confirm.paymentUnavailableBody')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'confirm.paymentUnavailableContact' })).toHaveAttribute(
      'href',
      `mailto:${CONTACT_EMAIL}`
    );
    expect(screen.queryByTestId('stripe-elements')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'confirm.paymentUnavailableRetry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('renders the payment form when Stripe is available', () => {
    useStripeAvailability.mockReturnValue({
      stripePromise: Promise.resolve({}),
      status: 'ready',
      unavailable: false,
      ready: true,
      retry
    });

    render(<LocationRetreatQuotePanel />);

    expect(screen.queryByTestId('location-retreat-stripe-unavailable')).not.toBeInTheDocument();
    expect(screen.getByTestId('stripe-elements')).toBeInTheDocument();
    expect(screen.getByTestId('location-payment-form')).toBeInTheDocument();
  });

  it('blocks preparation and shows support before checkout starts if Stripe is unavailable', () => {
    const state = bookingState();
    state.checkoutStep = false;
    state.clientSecret = null;
    state.quote = { checkIn: '2026-10-01', checkOut: '2026-10-03', available: true, totalPrice: 600 };
    state.checkIn = new Date(2026, 9, 1);
    state.checkOut = new Date(2026, 9, 3);
    useLocationRetreatBooking.mockReturnValue(state);
    useStripeAvailability.mockReturnValue({
      stripePromise: null, status: 'unavailable', unavailable: true, ready: false, retry
    });

    render(<LocationRetreatQuotePanel />);
    expect(screen.getByTestId('location-retreat-stripe-unavailable')).toBeInTheDocument();
    const continueButton = screen.getByRole('button', { name: 'details.continueToPaymentShort' });
    expect(continueButton).toBeDisabled();
    fireEvent.click(continueButton);
    expect(state.startCheckout).not.toHaveBeenCalled();
  });
});
