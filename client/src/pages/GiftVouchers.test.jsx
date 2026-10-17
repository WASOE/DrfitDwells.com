import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import commonEn from '../i18n/locales/en/common.json';
import commonBg from '../i18n/locales/bg/common.json';
import en from '../i18n/locales/en/giftVoucher.json';
import bg from '../i18n/locales/bg/giftVoucher.json';

const mocks = vi.hoisted(() => ({
  api: { getConfig: vi.fn(), quote: vi.fn(), createPaymentIntent: vi.fn() },
  stripe: { confirmPayment: vi.fn() },
  elements: {},
  stripeReady: true,
  elementsReady: true,
  language: 'en',
  loadStripe: vi.fn(),
  elementsProps: vi.fn(),
  setLanguage: vi.fn()
}));

vi.mock('@stripe/stripe-js', () => ({ loadStripe: mocks.loadStripe }));
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children, ...props }) => {
    mocks.elementsProps(props);
    return <div data-testid="stripe-elements">{children}</div>;
  },
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => mocks.stripeReady ? mocks.stripe : null,
  useElements: () => mocks.elementsReady ? mocks.elements : null
}));
vi.mock('../services/api', () => ({ giftVoucherAPI: mocks.api }));
vi.mock('../context/BookingSearchContext', () => ({
  useBookingSearch: () => ({ openModal: vi.fn() })
}));
vi.mock('../tracking/attribution', () => ({
  getAttributionPayload: () => ({ referralCode: 'voucher-referral' })
}));
vi.mock('../hooks/useSiteLanguage', () => ({
  useSiteLanguage: () => ({ language: mocks.language })
}));
vi.mock('../context/LanguageContext', async () => {
  const { useLocation: useCurrentLocation, useNavigate } = await vi.importActual('react-router-dom');
  return {
    useLanguage: () => {
      const location = useCurrentLocation();
      const navigate = useNavigate();
      return {
        setLanguage: (nextLanguage) => {
          mocks.setLanguage(nextLanguage);
          mocks.language = nextLanguage;
          const basePath = location.pathname.replace(/^\/bg(?=\/|$)/, '') || '/';
          const localizedPath = nextLanguage === 'bg'
            ? (basePath === '/' ? '/bg' : `/bg${basePath}`)
            : basePath;
          navigate(`${localizedPath}${location.search}${location.hash}`);
        }
      };
    }
  };
});
vi.mock('../components/Seo', () => ({ default: () => null }));
vi.mock('../i18n/ns/giftVoucher', () => ({}));
vi.mock('react-i18next', () => ({
  useTranslation: (namespace = 'common') => ({
    t: (key, options = {}) => {
      const isBg = (options.lng || mocks.language) === 'bg';
      const resource = namespace === 'giftVoucher'
        ? (isBg ? bg : en)
        : (isBg ? commonBg : commonEn);
      const value = key.split('.').reduce((obj, part) => obj?.[part], resource);
      if (typeof value !== 'string') return value ?? options.defaultValue ?? key;
      return value.replace(/\{\{(\w+)\}\}/g, (_, name) => options[name] ?? '');
    }
  })
}));

vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', 'pk_test_mockonly');
mocks.loadStripe.mockResolvedValue(mocks.stripe);
const { resetStripePromise } = await import('../lib/stripeClient');
const { default: GiftVouchers } = await import('./GiftVouchers');
const { default: Header } = await import('../components/Header');
const { default: ConsentBanner } = await import('../components/ConsentBanner');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function response(data) {
  return { data: { data } };
}

function quote(amount = 5000, fee = 0) {
  return response({ amountOriginalCents: amount, physicalCardFeeCents: fee, totalDueCents: amount + fee, currency: 'EUR' });
}

function intent(purchaseRequestId) {
  return response({ clientSecret: 'pi_test_secret_mock', stripePaymentIntentId: 'pi_test', purchaseRequestId });
}

async function renderPage(path = '/gift-vouchers', { includeHeader = false } = {}) {
  function CurrentPath() {
    const location = useLocation();
    return <span data-testid="current-path">{location.pathname}</span>;
  }
  const result = render(
    <MemoryRouter initialEntries={[path]}>
      {includeHeader && <Header />}
      <Routes>
        <Route path="/gift-vouchers" element={<GiftVouchers />} />
        <Route path="/bg/gift-vouchers" element={<GiftVouchers />} />
      </Routes>
      <CurrentPath />
    </MemoryRouter>
  );
  await waitFor(() => expect(mocks.api.getConfig).toHaveBeenCalledTimes(1));
  await act(async () => {});
  return result;
}

function change(label, value) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function fillBuyer() {
  change(en.v2.name, 'Elena Petrova');
  change(en.v2.from, 'Peter Novak');
  change(en.v2.buyer, 'peter@example.com');
  fireEvent.click(screen.getByRole('checkbox'));
}

function fillRecipient() {
  fillBuyer();
  change(en.v2.recipient, 'elena@example.com');
}

function openReview() {
  fireEvent.submit(document.querySelector('form.gv2-details'));
  return screen.getByRole('dialog');
}

function continueReview() {
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Continue to secure payment/ }));
}

async function prepare() {
  openReview();
  continueReview();
  await screen.findByTestId('payment-element');
}

function paymentForm() {
  return screen.getByRole('button', { name: /Pay securely/ }).closest('form');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', 'pk_test_mockonly');
  resetStripePromise();
  mocks.loadStripe.mockResolvedValue(mocks.stripe);
  mocks.language = 'en';
  mocks.stripeReady = true;
  mocks.elementsReady = true;
  mocks.setLanguage.mockClear();
  mocks.api.getConfig.mockResolvedValue(response({ scheduledDeliveryEnabled: true }));
  mocks.api.quote.mockImplementation(({ amountOriginalCents, deliveryOption }) =>
    Promise.resolve(quote(amountOriginalCents, deliveryOption === 'postal' ? 500 : 0)));
  mocks.api.createPaymentIntent.mockImplementation(({ purchaseRequestId }) => Promise.resolve(intent(purchaseRequestId)));
  mocks.stripe.confirmPayment.mockResolvedValue({});
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  delete HTMLElement.prototype.scrollIntoView;
  vi.restoreAllMocks();
});

describe('GiftVouchers purchase attempt isolation', () => {
  it.each([15, 50, 100, 250, 500])('prepares EUR%i preset credit without adding a fee for email', async (eur) => {
    await renderPage();
    fillRecipient();
    fireEvent.click(screen.getByRole('button', { name: `€${eur}`, exact: true }));
    await prepare();
    expect(mocks.api.createPaymentIntent.mock.calls[0][0].amountOriginalCents).toBe(eur * 100);
    expect(document.querySelector('.gv2-paywrap')).toHaveTextContent(`€${eur.toFixed(2)}`);
  });

  it.each([['15', 1500], ['75.25', 7525], ['10000.01', 1000001]])(
    'prepares custom EUR%s without an invented upper business cap', async (input, cents) => {
      await renderPage();
      fillRecipient();
      fireEvent.click(screen.getByRole('button', { name: en.v2.custom }));
      const field = screen.getByLabelText(en.amount.customAmount);
      expect(field).toHaveAttribute('step', '0.01');
      expect(field).not.toHaveAttribute('max');
      fireEvent.change(field, { target: { value: input } });
      await prepare();
      expect(mocks.api.quote.mock.calls[0][0].amountOriginalCents).toBe(cents);
      expect(mocks.api.createPaymentIntent.mock.calls[0][0].amountOriginalCents).toBe(cents);
    }
  );

  it.each(['en', 'bg'])('shows localized %s invalid-input feedback and never requests preparation', async (language) => {
    mocks.language = language;
    const copy = language === 'bg' ? bg : en;
    await renderPage(language === 'bg' ? '/bg/gift-vouchers' : '/gift-vouchers');
    for (const [label, value] of [[copy.v2.name, 'Elena'], [copy.v2.from, 'Peter'], [copy.v2.buyer, 'peter@example.com'], [copy.v2.recipient, 'elena@example.com']]) {
      change(label, value);
    }
    fireEvent.click(screen.getByRole('checkbox'));
    const check = async (expected) => {
      const modal = openReview();
      fireEvent.click(within(modal).getByRole('button', { name: new RegExp(copy.payment.continue) }));
      expect(within(modal).getAllByRole('alert')[0]).toHaveTextContent(expected);
      expect(mocks.api.quote).not.toHaveBeenCalled();
      fireEvent.click(within(modal).getByRole('button', { name: copy.v2.close }));
    };
    fireEvent.click(screen.getByRole('button', { name: copy.v2.custom }));
    change(copy.amount.customAmount, '14.99');
    await check(copy.errors.minimum);
    change(copy.amount.customAmount, '15.001');
    await check(copy.errors.wholeAmount);
    change(copy.amount.customAmount, '15.01');
    change(copy.v2.buyer, 'invalid-email');
    await check(copy.errors.buyerEmail);
    change(copy.v2.buyer, 'peter@example.com');
    change(copy.v2.name, 'a'.repeat(121));
    await check(copy.errors.namesTooLong);
    change(copy.v2.name, 'Elena');
    change(copy.v2.note, 'a'.repeat(251));
    await check(copy.errors.messageTooLong);
  });

  it('restores default postal EUR50 credit plus EUR5 fee and optional blank email', async () => {
    await renderPage();
    fillBuyer();
    fireEvent.click(screen.getByRole('button', { name: /Physical card/ }));
    change(en.postal.address1, '10 Forest Road');
    change(en.postal.city, 'Sofia');
    change(en.postal.postalCode, '1000');
    change(en.postal.country, 'Bulgaria');
    expect(screen.getByLabelText(en.postal.address1)).toHaveAttribute('maxlength', '200');
    expect(screen.getByLabelText(en.postal.postalCode)).toHaveAttribute('maxlength', '40');
    const modal = openReview();
    expect(modal).toHaveTextContent(en.delivery.postal);
    expect(modal).toHaveTextContent(en.summary.validity);
    expect(modal).toHaveTextContent('€55.00');
    continueReview();
    await screen.findByTestId('payment-element');
    const payload = mocks.api.createPaymentIntent.mock.calls[0][0];
    expect(payload.amountOriginalCents).toBe(5000);
    expect(payload).not.toHaveProperty('physicalCardFeeCents');
    expect(payload).not.toHaveProperty('totalDueCents');
    expect(payload).not.toHaveProperty('recipientEmail');
    expect(document.querySelector('.gv2-paywrap')).toHaveTextContent('€55.00');
  });

  it('validates optional postal email and required address before requesting a quote', async () => {
    await renderPage();
    fillBuyer();
    fireEvent.click(screen.getByRole('button', { name: /Physical card/ }));
    change(en.fields.recipientEmailOptional, 'bad');
    openReview();
    continueReview();
    expect(within(screen.getByRole('dialog')).getAllByRole('alert')[0]).toHaveTextContent(en.errors.recipientEmail);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.v2.close }));
    change(en.fields.recipientEmailOptional, '');
    openReview();
    continueReview();
    expect(within(screen.getByRole('dialog')).getAllByRole('alert')[0]).toHaveTextContent(en.errors.postalRequired);
    expect(mocks.api.quote).not.toHaveBeenCalled();
  });

  it.each(['en', 'bg'])('shows localized %s scheduling errors for missing and out-of-range dates', async (language) => {
    mocks.language = language;
    const copy = language === 'bg' ? bg : en;
    await renderPage(language === 'bg' ? '/bg/gift-vouchers' : '/gift-vouchers');
    for (const [label, value] of [[copy.v2.name, 'Elena'], [copy.v2.from, 'Peter'], [copy.v2.buyer, 'peter@example.com'], [copy.v2.recipient, 'elena@example.com']]) change(label, value);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(copy.v2.delivery[3]) }));
    for (const [date, expected] of [['', copy.errors.scheduledDateRequired], ['2099-01-01', copy.errors.scheduledDateInvalid]]) {
      change(copy.delivery.scheduledDate, date);
      const modal = openReview();
      fireEvent.click(within(modal).getByRole('button', { name: new RegExp(copy.payment.continue) }));
      expect(within(modal).getAllByRole('alert')[0]).toHaveTextContent(expected);
      expect(mocks.api.quote).not.toHaveBeenCalled();
      fireEvent.click(within(modal).getByRole('button', { name: copy.v2.close }));
    }
  });

  it.each([['Parchment', 'forest'], ['After dark', 'minimal'], ['Golden hour', 'romantic']])(
    'keeps website choice %s mapped to existing template %s', async (label, id) => {
      await renderPage();
      fillRecipient();
      fireEvent.click(screen.getByRole('button', { name: label }));
      change(en.occasions.label, 'anniversary');
      change(en.cardLocale.label, 'bg');
      expect(document.querySelector('article.gv2-card')).toHaveClass(id);
      expect(document.querySelector('article.gv2-card')).toHaveAttribute('lang', 'bg');
      await prepare();
      expect(mocks.api.createPaymentIntent.mock.calls[0][0]).toMatchObject({
        cardTemplateId: id, cardOccasion: 'anniversary', cardLocale: 'bg'
      });
    }
  );

  it('keeps an English card independent of a Bulgarian page and preserves the choice after other edits', async () => {
    mocks.language = 'bg';
    await renderPage('/bg/gift-vouchers');
    change(bg.cardLocale.label, 'en');
    change(bg.v2.name, 'Elena');
    change(bg.v2.from, 'Peter');
    change(bg.v2.buyer, 'peter@example.com');
    change(bg.v2.recipient, 'elena@example.com');
    change(bg.occasions.label, 'wedding');
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByLabelText(bg.cardLocale.label)).toHaveValue('en');
    expect(document.querySelector('article.gv2-card')).toHaveAttribute('lang', 'en');
    openReview();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: new RegExp(bg.payment.continue) }));
    await screen.findByTestId('payment-element');
    expect(mocks.api.createPaymentIntent.mock.calls[0][0]).toMatchObject({ cardLocale: 'en', cardOccasion: 'wedding' });
  });

  it('prepares valid customization with attribution, then mounts Stripe with the matched secret', async () => {
    await renderPage();
    fillRecipient();
    change(en.occasions.label, 'birthday');
    change(en.cardLocale.label, 'bg');
    change(en.v2.note, 'A quiet weekend for you.');
    await prepare();
    expect(mocks.api.quote).toHaveBeenCalledWith({ amountOriginalCents: 5000, currency: 'EUR', deliveryOption: 'recipient_now' });
    expect(mocks.api.createPaymentIntent).toHaveBeenCalledWith(expect.objectContaining({
      buyerName: 'Peter Novak', buyerEmail: 'peter@example.com', recipientName: 'Elena Petrova',
      recipientEmail: 'elena@example.com', termsAccepted: true, cardLocale: 'bg', cardOccasion: 'birthday',
      cardTemplateId: 'forest', message: 'A quiet weekend for you.', attribution: { referralCode: 'voucher-referral' },
      purchaseRequestId: expect.stringMatching(/^gvr_/)
    }));
    expect(mocks.elementsProps).toHaveBeenLastCalledWith({
      stripe: mocks.stripe, options: { clientSecret: 'pi_test_secret_mock', locale: 'en' }
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('article.gv2-card')).toHaveAttribute('lang', 'bg');
  });

  it('routes detail/Enter submission to review only and never nests the two forms', async () => {
    await renderPage();
    fillRecipient();
    const detail = document.querySelector('form.gv2-details');
    fireEvent.submit(detail);
    expect(mocks.api.quote).not.toHaveBeenCalled();
    continueReview();
    await screen.findByTestId('payment-element');
    expect(document.querySelectorAll('form')).toHaveLength(2);
    expect(document.querySelector('form form')).toBeNull();
    fireEvent.submit(paymentForm());
    await waitFor(() => expect(mocks.stripe.confirmPayment).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.api.quote).toHaveBeenCalledTimes(1);
    expect(mocks.api.createPaymentIntent).toHaveBeenCalledTimes(1);
  });

  it('blocks rapid preparation clicks and detail submits during both pending requests', async () => {
    const quoted = deferred(), created = deferred();
    mocks.api.quote.mockReturnValue(quoted.promise);
    mocks.api.createPaymentIntent.mockReturnValue(created.promise);
    await renderPage();
    fillRecipient();
    const modal = openReview();
    const button = within(modal).getByRole('button', { name: /Continue to secure payment/ });
    act(() => { button.click(); button.click(); });
    fireEvent.submit(document.querySelector('form.gv2-details'));
    expect(mocks.api.quote).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(en.v2.name)).toBeDisabled();
    change(en.v2.name, 'Ignored while preparing');
    expect(screen.getByLabelText(en.v2.name)).toHaveValue('Elena Petrova');
    await act(async () => quoted.resolve(quote()));
    act(() => { button.click(); button.click(); });
    expect(mocks.api.createPaymentIntent).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('payment-element')).not.toBeInTheDocument();
    await act(async () => created.resolve(intent()));
    await screen.findByTestId('payment-element');
    openReview();
    continueReview();
    expect(mocks.api.quote).toHaveBeenCalledTimes(1);
    expect(mocks.api.createPaymentIntent).toHaveBeenCalledTimes(1);
  });

  it('releases a failed quote lock and retries without creating a payment intent prematurely', async () => {
    mocks.api.quote.mockRejectedValueOnce(new Error('network unavailable'));
    await renderPage();
    fillRecipient();
    openReview();
    continueReview();
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent(en.errors.paymentFallback));
    expect(mocks.api.createPaymentIntent).not.toHaveBeenCalled();
    continueReview();
    await screen.findByTestId('payment-element');
    expect(mocks.api.quote).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText(en.v2.name)).toBeEnabled();
  });

  it('keeps the same purchase ID on failed intent retry and clears incomplete quote state', async () => {
    mocks.api.createPaymentIntent.mockRejectedValueOnce(new Error('response lost'));
    await renderPage();
    fillRecipient();
    openReview();
    continueReview();
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent(en.errors.paymentFallback));
    const first = mocks.api.createPaymentIntent.mock.calls[0][0];
    expect(screen.queryByTestId('stripe-elements')).not.toBeInTheDocument();
    continueReview();
    await screen.findByTestId('payment-element');
    expect(mocks.api.createPaymentIntent.mock.calls[1][0].purchaseRequestId).toBe(first.purchaseRequestId);
  });

  it.each([
    ['arithmetic mismatch', { amountOriginalCents: 5000, physicalCardFeeCents: 500, totalDueCents: 5000, currency: 'EUR' }],
    ['different credit', { amountOriginalCents: 10000, physicalCardFeeCents: 0, totalDueCents: 10000, currency: 'EUR' }],
    ['different currency', { amountOriginalCents: 5000, physicalCardFeeCents: 0, totalDueCents: 5000, currency: 'USD' }],
    ['missing total', { amountOriginalCents: 5000, physicalCardFeeCents: 0, currency: 'EUR' }]
  ])('rejects a quote with %s before creating a payable intent', async (_, data) => {
    mocks.api.quote.mockResolvedValueOnce(response(data));
    await renderPage();
    fillRecipient();
    openReview();
    continueReview();
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent(en.errors.paymentFallback));
    expect(mocks.api.createPaymentIntent).not.toHaveBeenCalled();
    expect(screen.queryByTestId('stripe-elements')).not.toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: /Continue to secure payment/ })).toBeEnabled();
  });

  it.each([
    ['missing secret', { stripePaymentIntentId: 'pi_test' }],
    ['missing intent ID', { clientSecret: 'secret_test' }],
    ['different purchase ID', { clientSecret: 'secret_test', stripePaymentIntentId: 'pi_test', purchaseRequestId: 'gvr_other_attempt' }]
  ])('rejects an intent response with %s without publishing a partial payment', async (_, data) => {
    mocks.api.createPaymentIntent.mockResolvedValueOnce(response(data));
    await renderPage();
    fillRecipient();
    openReview();
    continueReview();
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent(en.errors.paymentFallback));
    expect(screen.queryByTestId('stripe-elements')).not.toBeInTheDocument();
  });

  it('invalidates the payable quote/secret and changes the purchase ID after edits', async () => {
    await renderPage();
    fillRecipient();
    await prepare();
    const firstId = mocks.api.createPaymentIntent.mock.calls[0][0].purchaseRequestId;
    change(en.v2.name, 'Maya Petrova');
    expect(screen.queryByTestId('stripe-elements')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pay securely/ })).not.toBeInTheDocument();
    await prepare();
    expect(mocks.api.createPaymentIntent.mock.calls[1][0]).toMatchObject({ recipientName: 'Maya Petrova' });
    expect(mocks.api.createPaymentIntent.mock.calls[1][0].purchaseRequestId).not.toBe(firstId);
  });

  it('explicit edit cancels the local prepared attempt without discarding customer fields', async () => {
    await renderPage();
    fillRecipient();
    await prepare();
    const firstId = mocks.api.createPaymentIntent.mock.calls[0][0].purchaseRequestId;
    fireEvent.click(screen.getByRole('button', { name: en.payment.editDetails }));
    expect(screen.queryByTestId('payment-element')).not.toBeInTheDocument();
    expect(screen.getByLabelText(en.v2.name)).toHaveValue('Elena Petrova');
    await prepare();
    expect(mocks.api.createPaymentIntent.mock.calls[1][0].purchaseRequestId).not.toBe(firstId);
  });

  it('uses server postal fee and total, preserves credit and optional recipient email', async () => {
    await renderPage();
    fillRecipient();
    fireEvent.click(screen.getByRole('button', { name: /Physical card/ }));
    for (const [key, value] of [['address1', '10 Forest Road'], ['city', 'Sofia'], ['postalCode', '1000'], ['country', 'Bulgaria']]) {
      change(en.postal[key], value);
    }
    mocks.api.quote.mockResolvedValueOnce(quote(5000, 750));
    await prepare();
    expect(mocks.api.createPaymentIntent.mock.calls[0][0]).toMatchObject({
      amountOriginalCents: 5000, deliveryOption: 'postal', recipientEmail: 'elena@example.com',
      deliveryAddress: { addressLine1: '10 Forest Road', city: 'Sofia', postalCode: '1000', country: 'Bulgaria' }
    });
    expect(document.querySelector('.gv2-paywrap')).toHaveTextContent('€57.50');
    expect(document.querySelector('.gv2-fees')).toHaveTextContent('€7.50');
    fireEvent.click(screen.getByRole('button', { name: /Email to me/ }));
    expect(screen.queryByTestId('payment-element')).not.toBeInTheDocument();
    await prepare();
    const second = mocks.api.createPaymentIntent.mock.calls[1][0];
    expect(second.deliveryOption).toBe('send_to_buyer');
    expect(second).not.toHaveProperty('recipientEmail');
    expect(second).not.toHaveProperty('deliveryAddress');
    expect(document.querySelector('.gv2-paywrap')).toHaveTextContent('€50.00');
  });

  it('preserves scheduled date payload and clears it when changing delivery mode', async () => {
    await renderPage();
    fillRecipient();
    fireEvent.click(screen.getByRole('button', { name: /Schedule email/ }));
    const date = screen.getByLabelText(en.delivery.scheduledDate);
    fireEvent.change(date, { target: { value: date.min } });
    await prepare();
    expect(mocks.api.createPaymentIntent.mock.calls[0][0]).toMatchObject({ deliveryOption: 'scheduled', deliveryDate: date.min });
    fireEvent.click(screen.getByRole('button', { name: /Email to them/ }));
    expect(screen.queryByTestId('payment-element')).not.toBeInTheDocument();
    await prepare();
    expect(mocks.api.createPaymentIntent.mock.calls[1][0]).not.toHaveProperty('deliveryDate');
  });

  it('hides disabled scheduled delivery and never prepares invalid customer data', async () => {
    mocks.api.getConfig.mockResolvedValueOnce(response({ scheduledDeliveryEnabled: false }));
    await renderPage();
    expect(screen.queryByRole('button', { name: /Schedule email/ })).not.toBeInTheDocument();
    openReview();
    continueReview();
    expect(within(screen.getByRole('dialog')).getAllByRole('alert')[0]).toHaveTextContent(en.errors.namesRequired);
    expect(mocks.api.quote).not.toHaveBeenCalled();
  });

  it('fails closed on configuration errors and allows retry from the review dialog', async () => {
    mocks.api.getConfig.mockRejectedValueOnce(new Error('configuration unavailable'));
    await renderPage();
    fillRecipient();
    const modal = openReview();
    expect(within(modal).getByRole('alert')).toHaveTextContent(en.v2.configError);
    expect(within(modal).getByRole('button', { name: /Continue to secure payment/ })).toBeDisabled();
    expect(mocks.api.quote).not.toHaveBeenCalled();
    fireEvent.click(within(modal).getByRole('button', { name: en.v2.retry }));
    await waitFor(() => expect(within(modal).getByRole('button', { name: /Continue to secure payment/ })).toBeEnabled());
    continueReview();
    await screen.findByTestId('payment-element');
    expect(mocks.api.getConfig).toHaveBeenCalledTimes(2);
  });

  it('can cancel review and return without preparing a purchase or dropping customer fields', async () => {
    await renderPage();
    fillRecipient();
    const modal = openReview();
    fireEvent.click(within(modal).getByRole('button', { name: en.v2.close }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.api.quote).not.toHaveBeenCalled();
    expect(screen.getByLabelText(en.v2.name)).toHaveValue('Elena Petrova');
    await prepare();
    expect(mocks.api.createPaymentIntent).toHaveBeenCalledTimes(1);
  });

  it('blocks confirmation until Stripe hooks are ready', async () => {
    await renderPage();
    fillRecipient();
    mocks.stripeReady = false;
    mocks.elementsReady = false;
    await prepare();
    expect(screen.getByRole('button', { name: /Pay securely/ })).toBeDisabled();
    fireEvent.submit(paymentForm());
    expect(mocks.stripe.confirmPayment).not.toHaveBeenCalled();
  });

  it('locks repeated payment submissions, preserves prepared state on Stripe error and retries', async () => {
    const confirmation = deferred();
    mocks.stripe.confirmPayment.mockReturnValueOnce(confirmation.promise);
    await renderPage();
    fillRecipient();
    await prepare();
    const form = paymentForm();
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(mocks.stripe.confirmPayment).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(en.v2.name)).toBeDisabled();
    expect(screen.getByRole('button', { name: en.payment.editDetails })).toBeDisabled();
    await act(async () => confirmation.resolve({ error: { message: 'Your card was declined.' } }));
    expect(screen.getByRole('alert')).toHaveTextContent('Your card was declined.');
    expect(screen.getByLabelText(en.v2.name)).toBeEnabled();
    fireEvent.submit(paymentForm());
    await waitFor(() => expect(mocks.stripe.confirmPayment).toHaveBeenCalledTimes(2));
    expect(mocks.api.createPaymentIntent).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.confirmPayment).toHaveBeenLastCalledWith({
      elements: mocks.elements,
      confirmParams: { return_url: `${window.location.origin}/gift-vouchers/success` }
    });
  });

  it('releases a thrown confirmation error and retains the same prepared payment for retry', async () => {
    mocks.stripe.confirmPayment.mockRejectedValueOnce(new Error('network unavailable'));
    await renderPage();
    fillRecipient();
    await prepare();
    fireEvent.submit(paymentForm());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(en.errors.paymentFallback));
    expect(screen.getByRole('button', { name: /Pay securely/ })).toBeEnabled();
    fireEvent.submit(paymentForm());
    await waitFor(() => expect(mocks.stripe.confirmPayment).toHaveBeenCalledTimes(2));
    expect(mocks.api.quote).toHaveBeenCalledTimes(1);
  });

  it('does not continue preparation after unmount during the quote request', async () => {
    const quoted = deferred();
    mocks.api.quote.mockReturnValueOnce(quoted.promise);
    const { unmount } = await renderPage();
    fillRecipient();
    openReview();
    continueReview();
    expect(sessionStorage.getItem('dd_payment_flow_active')).toBe('1');
    unmount();
    await act(async () => quoted.resolve(quote()));
    expect(mocks.api.createPaymentIntent).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('dd_payment_flow_active')).toBeNull();
    expect(document.body).not.toHaveClass('gv2-active');
  });

  it('does not publish a late intent response into a new page instance', async () => {
    const created = deferred();
    mocks.api.createPaymentIntent.mockReturnValueOnce(created.promise);
    const { unmount } = await renderPage();
    fillRecipient();
    openReview();
    continueReview();
    await waitFor(() => expect(mocks.api.createPaymentIntent).toHaveBeenCalledTimes(1));
    unmount();
    mocks.api.getConfig.mockClear();
    await renderPage();
    await act(async () => created.resolve(intent()));
    expect(screen.queryByTestId('stripe-elements')).not.toBeInTheDocument();
    expect(screen.getByLabelText(en.v2.name)).toHaveValue('');
  });

  it('uses Bulgarian Stripe locale and the Bulgarian success route', async () => {
    mocks.language = 'bg';
    await renderPage('/bg/gift-vouchers');
    change(bg.v2.name, 'Елена Петрова');
    change(bg.v2.from, 'Петър Петров');
    change(bg.v2.buyer, 'peter@example.com');
    change(bg.v2.recipient, 'elena@example.com');
    fireEvent.click(screen.getByRole('checkbox'));
    openReview();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: new RegExp(bg.payment.continue) }));
    await screen.findByTestId('payment-element');
    expect(mocks.elementsProps).toHaveBeenLastCalledWith({
      stripe: mocks.stripe, options: { clientSecret: 'pi_test_secret_mock', locale: 'bg' }
    });
    fireEvent.submit(screen.getByRole('button', { name: new RegExp(bg.payment.paySecurely) }).closest('form'));
    await waitFor(() => expect(mocks.stripe.confirmPayment).toHaveBeenCalledWith({
      elements: mocks.elements,
      confirmParams: { return_url: `${window.location.origin}/bg/gift-vouchers/success` }
    }));
  });
});

describe('Stripe client initialization', () => {
  async function renderFreshPage() {
    vi.resetModules();
    const { default: Page } = await import('./GiftVouchers');
    render(<MemoryRouter><Page /></MemoryRouter>);
    await act(async () => {});
    fillRecipient();
    return openReview();
  }

  it('waits for the Stripe client before allowing preparation', async () => {
    const initialization = deferred();
    mocks.loadStripe.mockReturnValueOnce(initialization.promise);
    const modal = await renderFreshPage();
    const button = within(modal).getByRole('button', { name: /Continue to secure payment/ });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(mocks.api.quote).not.toHaveBeenCalled();
    await act(async () => initialization.resolve(mocks.stripe));
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await screen.findByTestId('payment-element');
  });

  it('reports Stripe initialization rejection and never prepares a purchase', async () => {
    const initialization = deferred();
    mocks.loadStripe.mockReturnValueOnce(initialization.promise);
    const modal = await renderFreshPage();
    await act(async () => initialization.reject(new Error('Stripe script unavailable')));
    expect(within(modal).getByRole('alert')).toHaveTextContent(en.payment.unavailableBody);
    expect(within(modal).getByRole('button', { name: /Continue to secure payment/ })).toBeDisabled();
    expect(mocks.api.quote).not.toHaveBeenCalled();
  });

  it('reports a null Stripe client as unavailable', async () => {
    mocks.loadStripe.mockResolvedValueOnce(null);
    const modal = await renderFreshPage();
    expect(within(modal).getByRole('alert')).toHaveTextContent(en.payment.unavailableBody);
    expect(within(modal).getByRole('button', { name: /Continue to secure payment/ })).toBeDisabled();
  });

  it('reports missing publishable-key configuration without calling Stripe', async () => {
    vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', '');
    try {
      const modal = await renderFreshPage();
      expect(mocks.loadStripe).not.toHaveBeenCalled();
      expect(within(modal).getByRole('alert')).toHaveTextContent(en.payment.unavailableBody);
      expect(within(modal).getByRole('button', { name: /Continue to secure payment/ })).toBeDisabled();
      expect(mocks.api.createPaymentIntent).not.toHaveBeenCalled();
    } finally {
      vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', 'pk_test_mockonly');
    }
  });
});

function stringEntries(value, path = '') {
  if (typeof value === 'string') return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((item, index) => stringEntries(item, `${path}[${index}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => stringEntries(item, path ? `${path}.${key}` : key));
  }
  return [];
}

describe('GiftVouchers localization and accessibility', () => {
  it('keeps route language independent from card language and preserves entered details while switching', async () => {
    await renderPage('/gift-vouchers', { includeHeader: true });
    change(en.v2.name, 'Elena Petrova');
    change(en.v2.from, 'Peter Novak');
    change(en.cardLocale.label, 'bg');
    expect(document.querySelector('.gv2')).toHaveAttribute('lang', 'en');
    expect(document.querySelector('.gv2-card')).toHaveAttribute('lang', 'bg');

    fireEvent.click(screen.getByRole('button', { name: 'language.bg' }));
    await waitFor(() => expect(screen.getByTestId('current-path')).toHaveTextContent('/bg/gift-vouchers'));
    expect(document.querySelector('.gv2')).toHaveAttribute('lang', 'bg');
    expect(document.querySelector('.gv2-card')).toHaveAttribute('lang', 'bg');
    expect(screen.getByLabelText(bg.v2.name)).toHaveValue('Elena Petrova');
    expect(screen.getByLabelText(bg.v2.from)).toHaveValue('Peter Novak');
    expect(screen.getByLabelText(bg.cardLocale.label)).toHaveValue('bg');

    change(bg.cardLocale.label, 'en');
    expect(document.querySelector('.gv2')).toHaveAttribute('lang', 'bg');
    expect(document.querySelector('.gv2-card')).toHaveAttribute('lang', 'en');
    fireEvent.click(screen.getByRole('button', { name: 'language.en' }));
    await waitFor(() => expect(screen.getByTestId('current-path')).toHaveTextContent('/gift-vouchers'));
    expect(document.querySelector('.gv2-card')).toHaveAttribute('lang', 'en');
    expect(screen.getByLabelText(en.v2.name)).toHaveValue('Elena Petrova');
    expect(mocks.setLanguage).toHaveBeenNthCalledWith(1, 'bg');
    expect(mocks.setLanguage).toHaveBeenNthCalledWith(2, 'en');
  });

  it('has matching, non-empty English and Bulgarian translation leaves', () => {
    const enEntries = stringEntries(en).sort(([left], [right]) => left.localeCompare(right));
    const bgEntries = stringEntries(bg).sort(([left], [right]) => left.localeCompare(right));
    expect(bgEntries.map(([path]) => path)).toEqual(enEntries.map(([path]) => path));
    expect(bgEntries.every(([, text]) => text.trim().length > 0)).toBe(true);
    const commonEnEntries = stringEntries(commonEn.consent).sort(([left], [right]) => left.localeCompare(right));
    const commonBgEntries = stringEntries(commonBg.consent).sort(([left], [right]) => left.localeCompare(right));
    expect(commonBgEntries.map(([path]) => path)).toEqual(commonEnEntries.map(([path]) => path));
    expect(commonBgEntries.every(([, text]) => text.trim().length > 0)).toBe(true);
  });

  it('localizes the shared consent overlay on the Bulgarian voucher route', async () => {
    const previousConsent = localStorage.getItem('dd_consent_v1');
    localStorage.removeItem('dd_consent_v1');
    mocks.language = 'bg';
    try {
      render(<MemoryRouter initialEntries={['/bg/gift-vouchers']}><ConsentBanner /></MemoryRouter>);
      const dialog = await screen.findByRole('dialog', { name: commonBg.consent.ariaLabel });
      expect(dialog).toHaveAttribute('lang', 'bg');
      expect(dialog).toHaveTextContent(commonBg.consent.message);
      expect(within(dialog).getByRole('link', { name: commonBg.consent.privacyLink })).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: commonBg.consent.decline })).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: commonBg.consent.accept })).toBeInTheDocument();
    } finally {
      if (previousConsent == null) localStorage.removeItem('dd_consent_v1');
      else localStorage.setItem('dd_consent_v1', previousConsent);
    }
  });

  it('traps keyboard focus, isolates the page, locks scrolling and restores focus on Escape', async () => {
    await renderPage('/gift-vouchers', { includeHeader: true });
    fillRecipient();
    const submit = document.querySelector('.gv2-details [type="submit"]');
    submit.focus();
    fireEvent.submit(document.querySelector('.gv2-details'));

    const modal = screen.getByRole('dialog', { name: `${en.v2.reviewTitle} ${en.v2.reviewTitleEm}` });
    const close = within(modal).getByRole('button', { name: en.v2.close });
    const edit = within(modal).getByRole('button', { name: en.payment.editDetails });
    expect(close).toHaveFocus();
    expect(document.querySelector('header.gv2-site-header')).toHaveProperty('inert', true);
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(edit).toHaveFocus();
    fireEvent.keyDown(edit, { key: 'Tab' });
    expect(close).toHaveFocus();
    submit.focus();
    expect(close).toHaveFocus();

    fireEvent.keyDown(close, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(submit).toHaveFocus();
    expect(document.querySelector('header.gv2-site-header')).toHaveProperty('inert', false);
    expect(document.body.style.overflow).toBe('');
  });

  it('associates localized validation feedback with the invalid field', async () => {
    await renderPage();
    fillBuyer();
    openReview();
    const recipientEmail = screen.getByLabelText(en.v2.recipient);
    expect(recipientEmail).toHaveAttribute('aria-invalid', 'true');
    const description = document.getElementById(recipientEmail.getAttribute('aria-describedby'));
    expect(description).toHaveTextContent(en.errors.recipientEmail);
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent(en.errors.recipientEmail);
  });

  it('announces preparation and Stripe processing state changes', async () => {
    const quoted = deferred();
    const confirmation = deferred();
    mocks.api.quote.mockReturnValueOnce(quoted.promise);
    mocks.stripe.confirmPayment.mockReturnValueOnce(confirmation.promise);
    await renderPage();
    fillRecipient();
    const modal = openReview();
    continueReview();
    expect(within(modal).getByRole('status')).toHaveTextContent(en.payment.preparing);

    await act(async () => quoted.resolve(quote()));
    await screen.findByTestId('payment-element');
    fireEvent.submit(paymentForm());
    expect(screen.getByRole('status')).toHaveTextContent(en.payment.processing);
    await act(async () => confirmation.resolve({}));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('exposes mobile call to action and all active inputs with accessible names', async () => {
    await renderPage();
    for (const name of [
      en.v2.name, en.v2.from, en.v2.note, en.cardLocale.label, en.occasions.label,
      en.v2.buyer, en.v2.recipient, en.aria.terms
    ]) expect(screen.getByLabelText(name)).toBeInTheDocument();
    const mobileCta = document.querySelector('.gv2-mobile button');
    expect(mobileCta).toHaveAttribute('aria-controls', 'create');
    expect(mobileCta).toHaveAccessibleName(`${en.v2.preview} ↗`);
    expect(document.querySelector('.gv2-card main')).toBeNull();
    expect(document.querySelector('.gv2-card-body')).toBeInTheDocument();
  });

  it('uses instant JavaScript scrolling when reduced motion is preferred', async () => {
    await renderPage();
    const previousDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true })
    });
    try {
      fireEvent.click(document.querySelector('.gv2-hero button'));
      expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
    } finally {
      if (previousDescriptor) Object.defineProperty(window, 'matchMedia', previousDescriptor);
      else delete window.matchMedia;
    }
  });

  it('shows the mobile call to action only after scrolling beyond the hero', async () => {
    const width = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    const scrollY = Object.getOwnPropertyDescriptor(window, 'scrollY');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 600 });
    try {
      await renderPage();
      const cta = document.querySelector('.gv2-mobile');
      expect(cta).not.toHaveClass('hidden');
      expect(cta).toHaveAttribute('aria-hidden', 'false');
      Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
      fireEvent.scroll(window);
      expect(cta).toHaveClass('hidden');
      expect(cta).toHaveAttribute('aria-hidden', 'true');
    } finally {
      if (width) Object.defineProperty(window, 'innerWidth', width);
      else delete window.innerWidth;
      if (scrollY) Object.defineProperty(window, 'scrollY', scrollY);
      else delete window.scrollY;
    }
  });

  it('keeps maximum Cyrillic personalization, custom values, occasions and card themes in the live preview', async () => {
    await renderPage();
    const recipientName = 'Ж'.repeat(120);
    const message = 'Пожелавам ти незабравими дни, спокойствие и много радост. '.repeat(5).slice(0, 250);
    change(en.v2.name, recipientName);
    change(en.v2.from, 'Георги Петров');
    change(en.v2.note, message);
    change(en.occasions.label, 'birthday');
    change(en.cardLocale.label, 'bg');
    fireEvent.click(screen.getByRole('button', { name: en.v2.custom }));
    change(en.amount.customAmount, '123.45');

    const card = document.querySelector('.voucher-card');
    expect(card).toHaveClass('long-content');
    expect(card).toHaveAttribute('lang', 'bg');
    expect(card.querySelector('.card-recipient')).toHaveTextContent(recipientName);
    expect(card.querySelector('.card-msg')).toHaveTextContent(message);
    expect(card.querySelector('.card-dear')).toHaveTextContent('Честит рожден ден');
    expect(card.querySelector('.card-value')).toHaveTextContent('123,45');

    fireEvent.click(screen.getByRole('button', { name: en.v2.styles[1] }));
    expect(card).toHaveClass('minimal', 'night');
    fireEvent.click(screen.getByRole('button', { name: en.v2.styles[2] }));
    expect(card).toHaveClass('romantic', 'clay');
    fireEvent.click(screen.getByRole('button', { name: en.v2.styles[0] }));
    expect(card).toHaveClass('forest');
    expect(card.querySelector('.card-recipient')).toHaveTextContent(recipientName);
  });

  it('renders the full localized reference composition around the production builder', async () => {
    await renderPage();
    expect(screen.getByText(en.reference.hero.lead)).toBeInTheDocument();
    expect(screen.getByText(en.reference.experience.lead)).toBeInTheDocument();
    expect(document.querySelectorAll('.escape-card')).toHaveLength(3);
    expect(document.querySelectorAll('.faq details')).toHaveLength(6);
    expect(document.querySelector('.gv2-nav')).not.toBeInTheDocument();
    expect(document.querySelector('.gv2 > footer')).not.toBeInTheDocument();
    expect(document.querySelector('.social-in')).not.toBeInTheDocument();
    expect(document.querySelector('.postmark')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Create their gift/ }).length).toBeGreaterThan(0);
    expect(document.querySelector('.hero-image source[type="image/avif"]')).toHaveAttribute('srcset', expect.stringContaining('gift-voucher-v2-hero-2400w.avif'));
    expect(document.querySelector('.hero-image source[type="image/webp"]')).toHaveAttribute('srcset', expect.stringContaining('gift-voucher-v2-hero-2400w.webp'));
    expect(document.querySelector('.hero-image img')).toHaveAttribute('src', '/media/gift-vouchers/gift-voucher-v2-hero-1200w.jpg');
    expect(document.querySelector('.voucher-card')).toBeInTheDocument();

    cleanup();
    mocks.language = 'bg';
    mocks.api.getConfig.mockClear();
    await renderPage('/bg/gift-vouchers');
    expect(screen.getByText(bg.reference.hero.lead)).toBeInTheDocument();
    expect(screen.getByText(bg.reference.promise.body)).toBeInTheDocument();
    expect(screen.getByText(bg.reference.faq.intro)).toBeInTheDocument();
  });
});
