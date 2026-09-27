import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GiftVouchers from './GiftVouchers';
import { useStripeAvailability } from '../lib/stripeClient';
import { CONTACT_EMAIL } from '../data/gmbLocations';

vi.mock('../lib/stripeClient', () => ({ useStripeAvailability: vi.fn() }));
vi.mock('../services/api', () => ({
  giftVoucherAPI: {
    getConfig: vi.fn(() => Promise.resolve({ data: { data: { scheduledDeliveryEnabled: true } } })),
    quote: vi.fn(),
    createPaymentIntent: vi.fn()
  }
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} }
}));
vi.mock('../components/Seo', () => ({ default: () => null }));
vi.mock('../components/giftVoucher/GiftVoucherCardPreview', () => ({ default: () => null }));
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }) => <div data-testid="stripe-elements">{children}</div>,
  PaymentElement: () => <div />,
  useStripe: () => ({}),
  useElements: () => ({})
}));

const retry = vi.fn();

function mount() {
  return render(
    <MemoryRouter initialEntries={['/gift-vouchers']}>
      <GiftVouchers />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('GiftVouchers stripe availability', () => {
  it('shows an explicit unavailable notice and blocks payment when Stripe cannot load', () => {
    useStripeAvailability.mockReturnValue({
      stripePromise: null,
      status: 'unavailable',
      unavailable: true,
      ready: false,
      retry
    });

    mount();

    const notice = screen.getByTestId('gift-voucher-stripe-unavailable');
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveAttribute('role', 'alert');
    expect(screen.getByText('payment.unavailableTitle')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'payment.unavailableContact' })).toHaveAttribute(
      'href',
      `mailto:${CONTACT_EMAIL}`
    );
    expect(screen.getByRole('button', { name: 'payment.continue' })).toBeDisabled();
    expect(screen.queryByTestId('stripe-elements')).not.toBeInTheDocument();
  });

  it('offers a retry affordance that re-attempts Stripe loading', () => {
    useStripeAvailability.mockReturnValue({
      stripePromise: null,
      status: 'error',
      unavailable: true,
      ready: false,
      retry
    });

    mount();

    fireEvent.click(screen.getByRole('button', { name: 'payment.unavailableRetry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('keeps the normal payment flow when Stripe is available', () => {
    useStripeAvailability.mockReturnValue({
      stripePromise: Promise.resolve({}),
      status: 'ready',
      unavailable: false,
      ready: true,
      retry
    });

    mount();

    expect(screen.queryByTestId('gift-voucher-stripe-unavailable')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'payment.continue' })).toBeEnabled();
  });
});
