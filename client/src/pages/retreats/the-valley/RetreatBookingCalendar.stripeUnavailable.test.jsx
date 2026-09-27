import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import RetreatBookingCalendar from './RetreatBookingCalendar';
import { useStripeAvailability } from '../../../lib/stripeClient';
import useLocationRetreatBooking from '../../../hooks/useLocationRetreatBooking';
import { CONTACT_EMAIL } from '../../../data/gmbLocations';

vi.mock('../../../lib/stripeClient', () => ({ useStripeAvailability: vi.fn() }));
vi.mock('../../../hooks/useLocationRetreatBooking', () => ({ default: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} }
}));
vi.mock('../../../context/BookingSearchContext', () => ({
  useBookingSearch: () => ({ updateDates: vi.fn() })
}));
vi.mock('../../../hooks/useSiteLanguage', () => ({ useSiteLanguage: () => ({ language: 'en' }) }));
vi.mock('../../../components/booking/StayLodgingPriceBlock', () => ({
  StayLodgingPriceBlock: () => null
}));
vi.mock('react-day-picker', () => ({ DayPicker: () => <div data-testid="day-picker" /> }));
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
    adults: 2,
    children: 0,
    nights: 2,
    updateGuests: vi.fn(),
    range: undefined,
    handleSelect: vi.fn(),
    minStayDate: new Date('2026-10-01T00:00:00'),
    quote: null,
    quoteLoading: false,
    quoteError: null,
    dateError: null,
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
    dateSummary: '',
    guestFormValid: true,
    showUnavailable: false,
    showAvailablePrice: false,
    availabilityStatus: 'idle',
    blockedNights: [],
    loadAvailability: vi.fn()
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useLocationRetreatBooking.mockReturnValue(bookingState());
});

afterEach(() => {
  cleanup();
});

describe('RetreatBookingCalendar stripe availability', () => {
  it('shows an explicit unavailable notice instead of an empty checkout area', () => {
    useStripeAvailability.mockReturnValue({
      stripePromise: null,
      status: 'error',
      unavailable: true,
      ready: false,
      retry
    });

    render(<RetreatBookingCalendar />);

    const notice = screen.getByTestId('retreat-calendar-stripe-unavailable');
    expect(notice).toHaveAttribute('role', 'alert');
    expect(screen.getByText('confirm.paymentUnavailableTitle')).toBeInTheDocument();
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

    render(<RetreatBookingCalendar />);

    expect(screen.queryByTestId('retreat-calendar-stripe-unavailable')).not.toBeInTheDocument();
    expect(screen.getByTestId('stripe-elements')).toBeInTheDocument();
    expect(screen.getByTestId('location-payment-form')).toBeInTheDocument();
  });

  it('shows unavailable guidance even before a client secret exists', () => {
    const state = bookingState();
    state.clientSecret = null;
    useLocationRetreatBooking.mockReturnValue(state);
    useStripeAvailability.mockReturnValue({
      stripePromise: null, status: 'unavailable', unavailable: true, ready: false, retry
    });

    render(<RetreatBookingCalendar />);
    expect(screen.getByTestId('retreat-calendar-stripe-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('stripe-elements')).not.toBeInTheDocument();
  });
});
