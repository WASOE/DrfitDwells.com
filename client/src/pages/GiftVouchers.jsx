import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import Seo from '../components/Seo';
import { giftVoucherAPI } from '../services/api';
import { getAttributionPayload } from '../tracking/attribution';
import { useSiteLanguage } from '../hooks/useSiteLanguage';

const stripePk = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
const stripePromise = stripePk ? loadStripe(stripePk) : null;

const MIN_AMOUNT_CENTS = 1500;
const PRESET_AMOUNTS = [1500, 5000, 10000, 25000];

const SOFT_ERROR_FALLBACK =
  'We could not prepare the payment right now. Please try again in a moment.';

const ERROR_COPY = {
  AMOUNT_BELOW_MINIMUM: 'The minimum gift voucher amount is EUR 15.',
  TERMS_NOT_ACCEPTED: 'Please accept the Terms & Conditions to continue.',
  PURCHASE_REQUEST_CONFLICT:
    'This purchase attempt has changed. Please refresh the page and try again.',
  PURCHASE_REQUEST_CLOSED:
    'This purchase attempt is no longer available. Please refresh the page and try again.'
};

function createPurchaseRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `gvr_${crypto.randomUUID()}`;
  }
  return `gvr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
}

function softMessageFromError(err) {
  const code = err?.response?.data?.code || err?.code;
  if (code && ERROR_COPY[code]) return ERROR_COPY[code];
  return SOFT_ERROR_FALLBACK;
}

function PaymentForm({ submitDisabled, onSubmit, loading, copy }) {
  const stripe = useStripe();
  const elements = useElements();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements || submitDisabled || loading) return;
    await onSubmit(stripe, elements);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="rounded-2xl border border-stone-200 bg-white p-5 md:p-6">
        <PaymentElement />
      </div>
      <button
        type="submit"
        disabled={!stripe || loading || submitDisabled}
        className="w-full rounded-full bg-[#81887A] px-8 py-4 text-sm font-medium uppercase tracking-[0.18em] text-white transition hover:bg-[#6f7669] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? copy.processing : copy.paySecurely}
      </button>
    </form>
  );
}

function AmountCard({ cents, selected, onClick, copy }) {
  const eur = (cents / 100).toLocaleString('en-GB');
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex flex-col items-start justify-between overflow-hidden rounded-2xl border px-5 py-6 text-left transition-all duration-300 md:px-6 md:py-7 ${
        selected
          ? 'border-stone-900 bg-stone-900 text-white shadow-[0_8px_32px_-12px_rgba(0,0,0,0.25)]'
          : 'border-stone-200 bg-white text-stone-800 hover:border-stone-400 hover:shadow-[0_4px_20px_-12px_rgba(0,0,0,0.15)]'
      }`}
    >
      <span
        className={`text-[10px] uppercase tracking-[0.24em] ${
          selected ? 'text-white/70' : 'text-stone-500'
        }`}
      >
        {copy.voucher}
      </span>
      <span
        className="mt-3 font-serif text-3xl leading-none tracking-tight md:text-4xl"
        style={{ fontFamily: 'var(--valley-font-primary, Georgia, serif)' }}
      >
        €{eur}
      </span>
      <span
        className={`mt-2 text-xs ${
          selected ? 'text-white/70' : 'text-stone-500'
        }`}
      >
        {copy.prepaid}
      </span>
    </button>
  );
}

export default function GiftVouchers() {
  const { language } = useSiteLanguage();
  const isBg = language === 'bg';
  const copy = {
    giftNav: isBg ? 'Подари престой' : 'Gift a stay',
    title: isBg ? 'Подари време офлайн | Подаръчни ваучери Drift & Dwells' : 'The Gift of Time Offline | Drift & Dwells Gift Vouchers',
    description: isBg
      ? 'Подаръчен ваучер от Drift & Dwells, изпратен по имейл или като физическа карта по пощата.'
      : 'Give someone a few days away from noise, screens, and schedules. A Drift & Dwells gift voucher, delivered by email or as a physical card by post.',
    kicker: isBg ? 'Drift & Dwells · Подаръчни ваучери' : 'Drift & Dwells · Gift Vouchers',
    heroTitle: isBg ? 'Подари време офлайн' : 'The Gift of Time Offline',
    heroLead: isBg ? 'Подари няколко дни далеч от шума, екраните и графика.' : 'Give someone a few days away from noise, screens, and schedules.',
    heroText: isBg
      ? 'Подаръчен ваучер от Drift & Dwells, изпратен по имейл или като физическа карта по пощата — предплатен кредит за бъдещ престой в'
      : 'A Drift & Dwells gift voucher, delivered by email or as a physical card by post — prepaid credit toward a future stay at',
    heroTail: isBg
      ? 'Това не е отстъпка. Това е тиха покана, която може да се използва, когато моментът е подходящ.'
      : 'It is not a discount. It is a quiet invitation, redeemable when the moment is right.',
    deliveryTag: isBg ? 'Имейл или пощенска доставка' : 'Email or post delivery',
    validTag: isBg ? 'Валиден 12 месеца' : 'Valid 12 months',
    fromTag: isBg ? 'От €15' : 'From €15',
    howItWorks: isBg ? 'Как работи' : 'How it works',
    howLine1: isBg
      ? 'Избираш сума. Изпращаме подаръка по имейл или подготвяме физическа карта по пощата.'
      : 'You choose an amount. We send your gift by email or prepare a physical card by post.',
    howLine2: isBg
      ? 'Получателят го използва при резервация, когато избере кога и къде да си почине.'
      : 'They redeem it during booking when they decide where and when to slow down.',
    howLine3: isBg
      ? 'Ваучерите са валидни 12 месеца и могат да се използват за всяка свободна нощувка в The Cabin или The Valley. Оставащият баланс остава във ваучера за бъдещи престои, докато бъде използван напълно или изтече.'
      : 'Vouchers are valid for twelve months and can be applied to any available night at The Cabin or The Valley. The remaining balance stays on the voucher for future stays until it is fully used or expires.',
    orderKicker: isBg ? 'Поръчай подаръчен ваучер' : 'Order your gift voucher',
    chooseAmount: isBg ? 'Избери сума' : 'Choose an amount',
    minimumText: isBg ? 'Минимум €15. Ваучерите са в EUR.' : 'Minimum €15. Vouchers are issued in EUR.',
    voucher: isBg ? 'Ваучер' : 'Voucher',
    prepaid: isBg ? 'Предплатен кредит' : 'Prepaid credit',
    customAmount: isBg ? 'Персонална сума' : 'Choose a custom amount',
    from: isBg ? 'От' : 'From',
    yourName: isBg ? 'Име на купувача' : 'Your name',
    yourEmail: isBg ? 'Имейл на купувача' : 'Your email',
    yourNamePlaceholder: isBg ? 'Вашето име' : 'Full name',
    emailPlaceholder: 'email@example.com',
    for: isBg ? 'За' : 'For',
    recipientName: isBg ? 'Име на получателя' : 'Recipient name',
    recipientEmail: isBg ? 'Имейл на получателя' : 'Recipient email',
    recipientEmailOptional: isBg ? 'Имейл на получателя (по желание)' : 'Recipient email (optional)',
    recipientNamePlaceholder: isBg ? 'Името на получателя' : 'Their name',
    message: isBg ? 'Послание (по желание)' : 'A short message (optional)',
    messagePlaceholder: isBg ? 'Кратко послание към ваучера' : 'A few quiet words to go with the voucher',
    delivery: isBg ? 'Доставка' : 'Delivery',
    deliveryHint: isBg
      ? 'Кажи ни дали да го изпратим дигитално или да подготвим физическа карта.'
      : 'Let us know whether to send it digitally or prepare a physical card.',
    sendMethod: isBg ? 'Начин на изпращане' : 'How to send it',
    digitalByEmail: isBg ? 'Дигитален ваучер по имейл' : 'Digital voucher by email',
    physicalByPost: isBg ? 'Физическа карта по пощата' : 'Physical card by post',
    sendOn: isBg ? 'Изпрати на дата (по желание)' : 'Send on (optional)',
    address1: isBg ? 'Адрес' : 'Address line 1',
    address2: isBg ? 'Адрес 2 (по желание)' : 'Address line 2 (optional)',
    city: isBg ? 'Град' : 'City',
    postalCode: isBg ? 'Пощенски код' : 'Postal code',
    country: isBg ? 'Държава' : 'Country',
    total: isBg ? 'Общо' : 'Total',
    summary: isBg
      ? 'Подаръчен ваучер Drift & Dwells · предплатен кредит · валиден 12 месеца от издаване.'
      : 'Drift & Dwells gift voucher · prepaid credit · valid 12 months from issuance.',
    reassurancePrepaidTitle: isBg ? 'ПРЕДПЛАТЕН КРЕДИТ' : 'PREPAID CREDIT',
    reassurancePrepaidText: isBg
      ? 'Ваучерът е реален кредит за престой в Drift & Dwells, не маркетингова отстъпка.'
      : 'A voucher is real credit on a Drift & Dwells stay, not a marketing discount.',
    reassuranceDurationTitle: isBg ? '12 МЕСЕЦА' : 'TWELVE MONTHS',
    reassuranceDurationText: isBg
      ? 'Получателят има цяла година, за да избере дати и да отседне в The Cabin или The Valley.'
      : 'Recipients have a full year to choose their dates and stay at The Cabin or The Valley.',
    reassuranceHelpTitle: isBg ? 'НУЖНА Е ПОМОЩ?' : 'NEED HELP?',
    reassuranceHelpText: isBg
      ? 'С радост помагаме с персонални суми или по-големи подаръци.'
      : 'We are happy to assist with custom amounts or larger gifts.',
    contactUs: isBg ? 'Свържете се с нас' : 'Contact us',
    reference: isBg ? 'Референция' : 'Reference',
    termsPrefix: isBg ? 'Приемам ' : 'I accept the ',
    terms: isBg ? 'Общи условия' : 'Terms & Conditions',
    and: isBg ? ' и ' : ' and ',
    cancellation: isBg ? 'Политика за анулации' : 'Cancellation Policy',
    preparing: isBg ? 'Подготвяме сигурното плащане...' : 'Preparing secure payment…',
    continue: isBg ? 'Продължи към сигурно плащане' : 'Continue to secure payment',
    processing: isBg ? 'Обработваме плащането...' : 'Processing payment…',
    paySecurely: isBg ? 'Плати сигурно' : 'Pay securely',
    editDetails: isBg ? 'Редактирай детайли' : 'Edit details',
    wholeAmountError: isBg ? 'Моля, въведете сума в цели евро.' : 'Please enter a whole-euro amount.',
    minimumError: isBg ? 'Минималната сума на ваучера е EUR 15.' : 'The minimum gift voucher amount is EUR 15.',
    namesRequired: isBg ? 'Моля, въведете име на купувач и получател.' : 'Please add a buyer and recipient name.',
    buyerEmailError: isBg ? 'Моля, въведете валиден имейл на купувача.' : 'Please add a valid buyer email.',
    recipientEmailError: isBg ? 'Моля, въведете валиден имейл на получателя.' : 'Please add a valid recipient email.',
    postalRequired: isBg ? 'Моля, въведете пълен пощенски адрес за физическа доставка.' : 'Please add a full postal address for physical delivery.',
    termsRequired: isBg ? 'Трябва да приемете Общите условия, за да продължите.' : 'Please accept the Terms & Conditions to continue.',
    paymentFallback: isBg
      ? 'Не успяхме да подготвим плащането в момента. Моля, опитайте отново след малко.'
      : 'We could not prepare the payment right now. Please try again in a moment.'
  };
  const [amountOriginalCents, setAmountOriginalCents] = useState(5000);
  const [customAmountEur, setCustomAmountEur] = useState('');
  const [useCustomAmount, setUseCustomAmount] = useState(false);

  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [message, setMessage] = useState('');
  const [deliveryMode, setDeliveryMode] = useState('email');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);

  const [purchaseRequestId, setPurchaseRequestId] = useState(createPurchaseRequestId());
  const [quotedAmountCents, setQuotedAmountCents] = useState(null);
  const [clientSecret, setClientSecret] = useState('');
  const [paymentIntentId, setPaymentIntentId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const effectiveAmountCents = useMemo(() => {
    if (!useCustomAmount) return amountOriginalCents;
    const eur = Number(customAmountEur);
    if (!Number.isFinite(eur)) return NaN;
    return Math.round(eur * 100);
  }, [useCustomAmount, amountOriginalCents, customAmountEur]);

  const validationError = useMemo(() => {
    if (!Number.isInteger(effectiveAmountCents)) return copy.wholeAmountError;
    if (effectiveAmountCents < MIN_AMOUNT_CENTS) return copy.minimumError;
    if (!buyerName.trim() || !recipientName.trim()) return copy.namesRequired;
    if (!isValidEmail(buyerEmail)) return copy.buyerEmailError;
    if (deliveryMode === 'email' && !isValidEmail(recipientEmail)) {
      return copy.recipientEmailError;
    }
    if (deliveryMode === 'postal' && (!addressLine1.trim() || !city.trim() || !postalCode.trim() || !country.trim())) {
      return copy.postalRequired;
    }
    if (!termsAccepted) return copy.termsRequired;
    return '';
  }, [effectiveAmountCents, buyerName, recipientName, buyerEmail, recipientEmail, deliveryMode, addressLine1, city, postalCode, country, termsAccepted, copy]);

  async function initializePayment() {
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const quoteRes = await giftVoucherAPI.quote({
        amountOriginalCents: effectiveAmountCents,
        currency: 'EUR'
      });
      const q = quoteRes?.data?.data;
      setQuotedAmountCents(q?.amountOriginalCents ?? null);

      const attr = getAttributionPayload();
      const payload = {
        amountOriginalCents: effectiveAmountCents,
        currency: 'EUR',
        buyerName: buyerName.trim(),
        buyerEmail: buyerEmail.trim(),
        recipientName: recipientName.trim(),
        recipientEmail: recipientEmail.trim() || null,
        message: message.trim() || null,
        deliveryMode,
        ...(deliveryMode === 'postal'
          ? {
              deliveryAddress: {
                addressLine1: addressLine1.trim(),
                addressLine2: addressLine2.trim() || null,
                city: city.trim(),
                postalCode: postalCode.trim(),
                country: country.trim()
              }
            }
          : {}),
        deliveryDate: deliveryDate || null,
        purchaseRequestId,
        termsAccepted: true,
        termsVersion: 'v1',
        ...(attr && Object.values(attr).some(Boolean) ? { attribution: attr } : {})
      };

      const piRes = await giftVoucherAPI.createPaymentIntent(payload);
      const data = piRes?.data?.data || {};
      setClientSecret(data.clientSecret || '');
      setPaymentIntentId(data.stripePaymentIntentId || '');
      if (data.purchaseRequestId) setPurchaseRequestId(data.purchaseRequestId);
    } catch (e) {
      setClientSecret('');
      setPaymentIntentId('');
      const fallback = softMessageFromError(e);
      setError(fallback === SOFT_ERROR_FALLBACK ? copy.paymentFallback : fallback);
    } finally {
      setLoading(false);
    }
  }

  async function handleStripeSubmit(stripe, elements) {
    setLoading(true);
    setError('');
    try {
      const successPath = window.location.pathname.startsWith('/bg/')
        ? '/bg/gift-vouchers/success'
        : '/gift-vouchers/success';
      const { error: stripeError } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}${successPath}`
        }
      });
      if (stripeError) {
        setError(stripeError.message || copy.paymentFallback);
      }
    } finally {
      setLoading(false);
    }
  }

  function resetAttempt() {
    setClientSecret('');
    setPaymentIntentId('');
    setQuotedAmountCents(null);
    setPurchaseRequestId(createPurchaseRequestId());
  }

  const summaryAmount = (quotedAmountCents ?? effectiveAmountCents) || 0;
  const formattedSummary = Number.isFinite(summaryAmount)
    ? (summaryAmount / 100).toLocaleString('en-GB')
    : '—';

  return (
    <>
      <Seo
        title={copy.title}
        description={copy.description}
        canonicalPath="/gift-vouchers"
      />

      <main className="bg-white">
        {/* Hero */}
        <section className="relative overflow-hidden bg-[#F7F4EE]">
          <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-10 px-4 pb-16 pt-20 sm:px-8 md:items-start md:gap-12 md:pb-24 md:pt-28 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:gap-16 lg:pb-32 lg:pt-36">
            <div>
              <p className="text-[11px] uppercase tracking-[0.32em] text-stone-500">
                {copy.kicker}
              </p>
              <h1
                className="mt-6 max-w-3xl font-serif text-4xl leading-[1.05] tracking-tight text-stone-900 sm:text-5xl md:text-6xl lg:text-[5rem]"
                style={{ fontFamily: 'var(--valley-font-primary, Georgia, serif)' }}
              >
                {copy.heroTitle}
              </h1>
              <p className="mt-8 max-w-2xl text-base leading-relaxed text-stone-700 md:text-lg">
                {copy.heroLead}
              </p>
              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-stone-600 md:text-base">
                {copy.heroText}{' '}
                <span className="italic">The Cabin</span> or <span className="italic">The Valley</span>.
                {' '}
                {copy.heroTail}
              </p>

              <div className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-3 text-xs uppercase tracking-[0.22em] text-stone-500">
                <span>{copy.deliveryTag}</span>
                <span className="hidden h-px w-6 bg-stone-300 md:inline-block" />
                <span>{copy.validTag}</span>
                <span className="hidden h-px w-6 bg-stone-300 md:inline-block" />
                <span>{copy.fromTag}</span>
              </div>
            </div>

            <div className="mx-auto w-full max-w-sm md:sticky md:top-24 md:max-w-none">
              <figure className="overflow-hidden rounded-md border-8 border-white bg-white shadow-[0_22px_55px_-25px_rgba(0,0,0,0.35)] md:rotate-[2deg]">
                <img
                  src="/media/hero/valley-summer-night-1200w.webp"
                  alt="The Valley postcard view"
                  className="aspect-[4/5] w-full object-cover"
                  loading="eager"
                />
              </figure>
            </div>
          </div>
        </section>

        {/* Editorial intro */}
        <section className="bg-white py-16 md:py-24">
          <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-10 px-4 sm:px-8 md:grid-cols-3 md:gap-12">
            <div className="md:col-span-1">
              <p className="text-[11px] uppercase tracking-[0.28em] text-stone-500">{copy.howItWorks}</p>
              <div className="mt-3 h-px w-12 bg-stone-300" />
            </div>
            <div className="md:col-span-2 space-y-6 text-base leading-relaxed text-stone-700 md:text-[17px]">
              <p>
                {copy.howLine1} {copy.howLine2}
              </p>
              <p>{copy.howLine3}</p>
            </div>
          </div>
        </section>

        {/* Purchase form */}
        <section className="bg-[#FAFAF7] py-16 md:py-24">
          <div className="mx-auto w-full max-w-3xl px-4 sm:px-8">
            <div className="mb-10 md:mb-14">
              <p className="text-[11px] uppercase tracking-[0.28em] text-stone-500">{copy.orderKicker}</p>
              <h2
                className="mt-3 font-serif text-2xl leading-tight tracking-tight text-stone-900 md:text-3xl"
                style={{ fontFamily: 'var(--valley-font-primary, Georgia, serif)' }}
              >
                {copy.chooseAmount}
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-stone-600">
                {copy.minimumText}
              </p>
            </div>

            {/* Amount cards */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
              {PRESET_AMOUNTS.map((preset) => (
                  <AmountCard
                  key={preset}
                  cents={preset}
                    copy={copy}
                  selected={!useCustomAmount && amountOriginalCents === preset}
                  onClick={() => {
                    setUseCustomAmount(false);
                    setAmountOriginalCents(preset);
                    resetAttempt();
                  }}
                />
              ))}
            </div>

            <div className="mt-6 rounded-2xl border border-stone-200 bg-white px-5 py-5 md:px-6">
              <label className="flex items-start gap-3">
                <input
                  id="custom-amount"
                  type="checkbox"
                  checked={useCustomAmount}
                  onChange={(e) => {
                    setUseCustomAmount(e.target.checked);
                    resetAttempt();
                  }}
                  className="mt-1 h-4 w-4 rounded border-stone-400 text-stone-900 focus:ring-stone-700"
                />
                <span className="text-sm text-stone-700">{copy.customAmount}</span>
              </label>
              {useCustomAmount && (
                <div className="mt-4 flex items-center gap-3">
                  <span className="font-serif text-2xl text-stone-700">€</span>
                  <input
                    type="number"
                    min="15"
                    step="1"
                    value={customAmountEur}
                    onChange={(e) => {
                      setCustomAmountEur(e.target.value);
                      resetAttempt();
                    }}
                    className="w-full border-0 border-b border-stone-300 bg-transparent px-0 py-2 font-serif text-2xl text-stone-900 outline-none transition focus:border-stone-700"
                    placeholder="e.g. 75"
                  />
                </div>
              )}
            </div>

            {/* Buyer + Recipient */}
            <div className="mt-12 md:mt-16">
              <p className="text-[11px] uppercase tracking-[0.28em] text-stone-500">{copy.from}</p>
              <div className="mt-2 h-px w-12 bg-stone-300" />
              <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
                <div>
                  <label className="block text-[11px] font-light uppercase tracking-[0.2em] text-stone-500">{copy.yourName}</label>
                  <input
                    className="mt-2 w-full border-0 border-b border-stone-300 bg-transparent px-0 py-3 text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-stone-700"
                    placeholder={copy.yourNamePlaceholder}
                    value={buyerName}
                    onChange={(e) => { setBuyerName(e.target.value); resetAttempt(); }}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-light uppercase tracking-[0.2em] text-stone-500">{copy.yourEmail}</label>
                  <input
                    type="email"
                    className="mt-2 w-full border-0 border-b border-stone-300 bg-transparent px-0 py-3 text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-stone-700"
                    placeholder={copy.emailPlaceholder}
                    value={buyerEmail}
                    onChange={(e) => { setBuyerEmail(e.target.value); resetAttempt(); }}
                  />
                </div>
              </div>
            </div>

            <div className="mt-12 md:mt-16">
              <p className="text-[11px] uppercase tracking-[0.28em] text-stone-500">{copy.for}</p>
              <div className="mt-2 h-px w-12 bg-stone-300" />
              <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
                <div>
                  <label className="block text-[11px] font-light uppercase tracking-[0.2em] text-stone-500">{copy.recipientName}</label>
                  <input
                    className="mt-2 w-full border-0 border-b border-stone-300 bg-transparent px-0 py-3 text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-stone-700"
                    placeholder={copy.recipientNamePlaceholder}
                    value={recipientName}
                    onChange={(e) => { setRecipientName(e.target.value); resetAttempt(); }}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-light uppercase tracking-[0.2em] text-stone-500">
                    {deliveryMode === 'postal' ? copy.recipientEmailOptional : copy.recipientEmail}
                  </label>
                  <input
                    type="email"
                    className="mt-2 w-full border-0 border-b border-stone-300 bg-transparent px-0 py-3 text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-stone-700"
                    placeholder={copy.emailPlaceholder}
                    value={recipientEmail}
                    onChange={(e) => { setRecipientEmail(e.target.value); resetAttempt(); }}
                  />
                </div>
              </div>

              <div className="mt-8">
                <label className="block text-[11px] font-light uppercase tracking-[0.2em] text-stone-500">{copy.message}</label>
                <textarea
                  className="mt-2 w-full resize-none border-0 border-b border-stone-300 bg-transparent px-0 py-3 text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-stone-700"
                  rows={3}
                  placeholder={copy.messagePlaceholder}
                  value={message}
                  onChange={(e) => {
                    setMessage(e.target.value);
                    resetAttempt();
                  }}
                />
              </div>
            </div>

            {/* Delivery */}
            <div className="mt-12 md:mt-16">
              <p className="text-[11px] uppercase tracking-[0.28em] text-stone-500">{copy.delivery}</p>
              <div className="mt-2 h-px w-12 bg-stone-300" />
              <p className="mt-3 text-sm text-stone-600">
                {copy.deliveryHint}
              </p>
              <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
                <div>
                  <label className="block text-[11px] font-light uppercase tracking-[0.2em] text-stone-500">{copy.sendMethod}</label>
                  <select
                    className="mt-2 w-full border-0 border-b border-stone-300 bg-transparent px-0 py-3 text-stone-900 outline-none transition focus:border-stone-700"
                    value={deliveryMode}
                    onChange={(e) => {
                      setDeliveryMode(e.target.value);
                      resetAttempt();
                    }}
                  >
                    <option value="email">{copy.digitalByEmail}</option>
                    <option value="postal">{copy.physicalByPost}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-light uppercase tracking-[0.2em] text-stone-500">{copy.sendOn}</label>
                  <input
                    type="date"
                    className="mt-2 w-full border-0 border-b border-stone-300 bg-transparent px-0 py-3 text-stone-900 outline-none transition focus:border-stone-700"
                    value={deliveryDate}
                    onChange={(e) => {
                      setDeliveryDate(e.target.value);
                      resetAttempt();
                    }}
                  />
                </div>
              </div>
              {deliveryMode === 'postal' && (
                <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
                  <div>
                    <label className="block text-[11px] font-light uppercase tracking-[0.2em] text-stone-500">{copy.address1}</label>
                    <input
                      className="mt-2 w-full border-0 border-b border-stone-300 bg-transparent px-0 py-3 text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-stone-700"
                      placeholder="Street and number"
                      value={addressLine1}
                      onChange={(e) => { setAddressLine1(e.target.value); resetAttempt(); }}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-light uppercase tracking-[0.2em] text-stone-500">{copy.address2}</label>
                    <input
                      className="mt-2 w-full border-0 border-b border-stone-300 bg-transparent px-0 py-3 text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-stone-700"
                      placeholder="Apartment, suite, unit"
                      value={addressLine2}
                      onChange={(e) => { setAddressLine2(e.target.value); resetAttempt(); }}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-light uppercase tracking-[0.2em] text-stone-500">{copy.city}</label>
                    <input
                      className="mt-2 w-full border-0 border-b border-stone-300 bg-transparent px-0 py-3 text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-stone-700"
                      value={city}
                      onChange={(e) => { setCity(e.target.value); resetAttempt(); }}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-light uppercase tracking-[0.2em] text-stone-500">{copy.postalCode}</label>
                    <input
                      className="mt-2 w-full border-0 border-b border-stone-300 bg-transparent px-0 py-3 text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-stone-700"
                      value={postalCode}
                      onChange={(e) => { setPostalCode(e.target.value); resetAttempt(); }}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[11px] font-light uppercase tracking-[0.2em] text-stone-500">{copy.country}</label>
                    <input
                      className="mt-2 w-full border-0 border-b border-stone-300 bg-transparent px-0 py-3 text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-stone-700"
                      value={country}
                      onChange={(e) => { setCountry(e.target.value); resetAttempt(); }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Summary */}
            <div className="mt-12 rounded-2xl border border-stone-200 bg-white p-6 md:mt-16 md:p-8">
              <div className="flex items-baseline justify-between gap-4">
                <p className="text-[11px] uppercase tracking-[0.28em] text-stone-500">{copy.total}</p>
                <p
                  className="font-serif text-3xl tracking-tight text-stone-900 md:text-4xl"
                  style={{ fontFamily: 'var(--valley-font-primary, Georgia, serif)' }}
                >
                  €{formattedSummary}
                </p>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-stone-500">
                {copy.summary}
              </p>
              {paymentIntentId && (
                <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-stone-400">
                  {copy.reference} · {paymentIntentId}
                </p>
              )}
            </div>

            {/* Terms */}
            <label className="mt-8 flex items-start gap-3 text-sm text-stone-700">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-stone-400 text-stone-900 focus:ring-stone-700"
                checked={termsAccepted}
                onChange={(e) => {
                  setTermsAccepted(e.target.checked);
                  resetAttempt();
                }}
              />
              <span>
                {copy.termsPrefix}
                <Link to="/terms" className="underline decoration-stone-400 underline-offset-4 hover:decoration-stone-700">
                  {copy.terms}
                </Link>{' '}
                {copy.and}
                <Link to="/cancellation-policy" className="underline decoration-stone-400 underline-offset-4 hover:decoration-stone-700">
                  {copy.cancellation}
                </Link>
                .
              </span>
            </label>

            {/* Action */}
            <div className="mt-10">
              {!clientSecret ? (
                <button
                  type="button"
                  onClick={initializePayment}
                  disabled={loading}
                  className="w-full rounded-full bg-[#81887A] px-8 py-4 text-sm font-medium uppercase tracking-[0.18em] text-white transition hover:bg-[#6f7669] disabled:cursor-not-allowed disabled:opacity-50 md:w-auto md:min-w-[280px]"
                >
                  {loading ? copy.preparing : copy.continue}
                </button>
              ) : (
                <div className="space-y-4">
                  <Elements stripe={stripePromise} options={{ clientSecret }}>
                    <PaymentForm
                      submitDisabled={Boolean(validationError)}
                      onSubmit={handleStripeSubmit}
                      loading={loading}
                      copy={copy}
                    />
                  </Elements>
                  <button
                    type="button"
                    onClick={resetAttempt}
                    className="text-xs uppercase tracking-[0.2em] text-stone-500 underline-offset-4 hover:text-stone-800 hover:underline"
                  >
                    {copy.editDetails}
                  </button>
                </div>
              )}

              {(error || validationError) && (
                <div
                  role="alert"
                  className="mt-6 rounded-2xl border border-stone-300 bg-white px-5 py-4 text-sm text-stone-700"
                >
                  {error || validationError}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Reassurance footer band */}
        <section className="bg-white py-12 md:py-16">
          <div className="mx-auto w-full max-w-5xl px-4 sm:px-8">
            <div className="grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-10">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-stone-500">{copy.reassurancePrepaidTitle}</p>
                <p className="mt-3 text-sm leading-relaxed text-stone-600">
                  {copy.reassurancePrepaidText}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-stone-500">{copy.reassuranceDurationTitle}</p>
                <p className="mt-3 text-sm leading-relaxed text-stone-600">
                  {copy.reassuranceDurationText}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-stone-500">{copy.reassuranceHelpTitle}</p>
                <p className="mt-3 text-sm leading-relaxed text-stone-600">
                  {copy.reassuranceHelpText}{' '}
                  <Link to="/contact" className="underline decoration-stone-400 underline-offset-4 hover:decoration-stone-700">
                    {copy.contactUs}
                  </Link>
                  .
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
