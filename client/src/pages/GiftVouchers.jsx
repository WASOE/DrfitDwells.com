import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import Seo from '../components/Seo';
import GiftVoucherCardPreview from '../components/giftVoucher/GiftVoucherCardPreview';
import {
  buildPreviewVoucher,
  buildSubmitPayload,
  CARD_OCCASIONS,
  CARD_TEMPLATE_IDS,
  computeEffectiveAmountCents,
  createInitialBuilderState,
  getScheduledDeliveryDateBounds,
  MESSAGE_MAX_LENGTH,
  PHYSICAL_CARD_FEE_CENTS,
  PRESET_AMOUNTS,
  validateBuilderState
} from '../components/giftVoucher/giftVoucherBuilderState';
import { giftVoucherAPI } from '../services/api';
import { getAttributionPayload } from '../tracking/attribution';
import { useSiteLanguage } from '../hooks/useSiteLanguage';
import { getStripeElementsLocale } from '../payments/stripeElementsLocale';
import { getLanguageFromPath } from '../utils/localizedRoutes';
import '../i18n/ns/giftVoucher';

const stripePk = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
const stripePromise = stripePk ? loadStripe(stripePk) : null;

const VALIDATION_I18N_KEYS = {
  WHOLE_AMOUNT: 'errors.wholeAmount',
  AMOUNT_BELOW_MINIMUM: 'errors.minimum',
  NAMES_REQUIRED: 'errors.namesRequired',
  BUYER_EMAIL: 'errors.buyerEmail',
  RECIPIENT_EMAIL: 'errors.recipientEmail',
  POSTAL_REQUIRED: 'errors.postalRequired',
  TERMS_NOT_ACCEPTED: 'errors.termsRequired',
  MESSAGE_TOO_LONG: 'errors.messageTooLong',
  MISSING_SCHEDULED_DELIVERY_DATE: 'errors.scheduledDateRequired',
  INVALID_SCHEDULED_DELIVERY_DATE: 'errors.scheduledDateInvalid',
  SCHEDULED_NOT_ENABLED: 'errors.scheduledNotEnabled'
};

function createPurchaseRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `gvr_${crypto.randomUUID()}`;
  }
  return `gvr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function PaymentForm({ submitDisabled, onSubmit, loading }) {
  const { t } = useTranslation('giftVoucher');
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
        {loading ? t('payment.processing') : t('payment.paySecurely')}
      </button>
    </form>
  );
}

function AmountCard({ cents, selected, onClick }) {
  const { t } = useTranslation('giftVoucher');
  const eur = (cents / 100).toLocaleString('en-GB');

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex min-h-[6.75rem] flex-col items-start justify-between overflow-hidden rounded-2xl border px-4 py-5 text-left transition-all duration-300 ${
        selected
          ? 'border-stone-900 bg-stone-900 text-white shadow-[0_8px_32px_-12px_rgba(0,0,0,0.25)]'
          : 'border-stone-200 bg-white text-stone-800 hover:border-stone-400 hover:shadow-[0_4px_20px_-12px_rgba(0,0,0,0.15)]'
      }`}
    >
      <span
        className={`text-[10px] uppercase tracking-[0.2em] ${
          selected ? 'text-white/70' : 'text-stone-500'
        }`}
      >
        {t('amount.voucher')}
      </span>
      <span
        className="mt-2 whitespace-nowrap font-serif text-2xl leading-none tracking-tight"
        style={{ fontFamily: 'var(--valley-font-primary, Georgia, serif)' }}
      >
        €{eur}
      </span>
      <span className={`mt-1 text-[11px] leading-snug ${selected ? 'text-white/70' : 'text-stone-500'}`}>
        {t('amount.prepaid')}
      </span>
    </button>
  );
}

export default function GiftVouchers() {
  const { t } = useTranslation('giftVoucher');
  const { language } = useSiteLanguage();
  const stripeElementsLocale = getStripeElementsLocale(language);
  const location = useLocation();
  const isBg = language === 'bg';
  const routeLanguage = getLanguageFromPath(location.pathname);

  const [builder, setBuilder] = useState(() => createInitialBuilderState(routeLanguage));
  const [scheduledDeliveryEnabled, setScheduledDeliveryEnabled] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);

  const [purchaseRequestId, setPurchaseRequestId] = useState(createPurchaseRequestId);
  const [quotedAmountCents, setQuotedAmountCents] = useState(null);
  const [quotedPhysicalCardFeeCents, setQuotedPhysicalCardFeeCents] = useState(null);
  const [quotedTotalDueCents, setQuotedTotalDueCents] = useState(null);
  const [clientSecret, setClientSecret] = useState('');
  const [paymentIntentId, setPaymentIntentId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const purchaseConfig = useMemo(
    () => ({ scheduledDeliveryEnabled }),
    [scheduledDeliveryEnabled]
  );

  const scheduledBounds = useMemo(() => getScheduledDeliveryDateBounds(), []);

  useEffect(() => {
    let cancelled = false;
    giftVoucherAPI
      .getConfig()
      .then((res) => {
        if (cancelled) return;
        setScheduledDeliveryEnabled(Boolean(res?.data?.data?.scheduledDeliveryEnabled));
      })
      .catch(() => {
        if (!cancelled) setScheduledDeliveryEnabled(false);
      })
      .finally(() => {
        if (!cancelled) setConfigLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!configLoaded) return;
    if (!scheduledDeliveryEnabled && builder.deliveryOption === 'scheduled') {
      setBuilder((prev) => ({ ...prev, deliveryOption: 'recipient_now', deliveryDate: '' }));
    }
  }, [configLoaded, scheduledDeliveryEnabled, builder.deliveryOption]);

  useEffect(() => {
    setBuilder((prev) => {
      if (prev.cardLocale === routeLanguage) return prev;
      return { ...prev, cardLocale: routeLanguage };
    });
  }, [routeLanguage]);

  const effectiveAmountCents = useMemo(() => computeEffectiveAmountCents(builder), [builder]);

  const validation = useMemo(
    () => validateBuilderState(builder, purchaseConfig),
    [builder, purchaseConfig]
  );

  const validationMessage = useMemo(() => {
    if (validation.ok) return '';
    const key = VALIDATION_I18N_KEYS[validation.code];
    return key ? t(key) : t('errors.paymentFallback');
  }, [validation, t]);

  const previewFields = useMemo(
    () => buildPreviewVoucher(builder, effectiveAmountCents),
    [builder, effectiveAmountCents]
  );

  const deliveryOptions = useMemo(() => {
    const options = [
      { value: 'recipient_now', label: t('delivery.recipientNow') },
      { value: 'send_to_buyer', label: t('delivery.sendToBuyer') }
    ];
    if (scheduledDeliveryEnabled) {
      options.push({ value: 'scheduled', label: t('delivery.scheduled') });
    }
    options.push({ value: 'postal', label: t('delivery.postal') });
    return options;
  }, [scheduledDeliveryEnabled, t]);

  function patchBuilder(patch) {
    setBuilder((prev) => ({ ...prev, ...patch }));
    resetAttempt();
  }

  function resetAttempt() {
    setClientSecret('');
    setPaymentIntentId('');
    setQuotedAmountCents(null);
    setQuotedPhysicalCardFeeCents(null);
    setQuotedTotalDueCents(null);
    setPurchaseRequestId(createPurchaseRequestId());
  }

  function softMessageFromError(err) {
    const code = err?.response?.data?.code || err?.code;
    if (code) {
      const translated = t(`errors.${code}`, { defaultValue: '' });
      if (translated) return translated;
    }
    return t('errors.paymentFallback');
  }

  async function initializePayment() {
    if (!validation.ok) {
      setError(validationMessage);
      return;
    }

    const payload = buildSubmitPayload(
      builder,
      { purchaseRequestId, attribution: getAttributionPayload() },
      purchaseConfig
    );
    if (!payload) {
      setError(validationMessage);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const quoteRes = await giftVoucherAPI.quote({
        amountOriginalCents: payload.amountOriginalCents,
        currency: 'EUR',
        deliveryOption: payload.deliveryOption
      });
      const q = quoteRes?.data?.data;
      setQuotedAmountCents(q?.amountOriginalCents ?? null);
      setQuotedPhysicalCardFeeCents(q?.physicalCardFeeCents ?? null);
      setQuotedTotalDueCents(q?.totalDueCents ?? null);

      const piRes = await giftVoucherAPI.createPaymentIntent(payload);
      const data = piRes?.data?.data || {};
      setClientSecret(data.clientSecret || '');
      setPaymentIntentId(data.stripePaymentIntentId || '');
      if (data.purchaseRequestId) setPurchaseRequestId(data.purchaseRequestId);
    } catch (e) {
      setClientSecret('');
      setPaymentIntentId('');
      setError(softMessageFromError(e));
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
        setError(stripeError.message || t('errors.paymentFallback'));
      }
    } finally {
      setLoading(false);
    }
  }

  const previewPhysicalCardFeeCents =
    builder.deliveryOption === 'postal' ? PHYSICAL_CARD_FEE_CENTS : 0;
  const voucherValueCents = quotedAmountCents ?? effectiveAmountCents;
  const physicalCardFeeCents = quotedPhysicalCardFeeCents ?? previewPhysicalCardFeeCents;
  const totalDueCents =
    quotedTotalDueCents ??
    (Number.isFinite(voucherValueCents) ? voucherValueCents + physicalCardFeeCents : NaN);
  const formattedVoucherValue = Number.isFinite(voucherValueCents)
    ? (voucherValueCents / 100).toLocaleString('en-GB')
    : '—';
  const formattedPhysicalFee = (physicalCardFeeCents / 100).toLocaleString('en-GB');
  const formattedSummary = Number.isFinite(totalDueCents)
    ? (totalDueCents / 100).toLocaleString('en-GB')
    : '—';

  const inputClass =
    'mt-2 w-full border-0 border-b border-stone-300 bg-transparent px-0 py-3 text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-stone-700';
  const labelClass = 'block text-[11px] font-light uppercase tracking-[0.2em] text-stone-500';

  return (
    <>
      <Seo
        title={t('seo.title')}
        description={t('seo.description')}
        canonicalPath="/gift-vouchers"
      />

      <main className="bg-white">
        <section className="relative overflow-hidden bg-[#F7F4EE]">
          <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-10 px-4 pb-16 pt-20 sm:px-8 md:items-start md:gap-12 md:pb-24 md:pt-28 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:gap-16 lg:pb-32 lg:pt-36">
            <div>
              <p className="text-[11px] uppercase tracking-[0.32em] text-stone-500">{t('hero.kicker')}</p>
              <h1
                className="mt-6 max-w-3xl font-serif text-4xl leading-[1.05] tracking-tight text-stone-900 sm:text-5xl md:text-6xl lg:text-[5rem]"
                style={{ fontFamily: 'var(--valley-font-primary, Georgia, serif)' }}
              >
                {t('hero.title')}
              </h1>
              <p className="mt-8 max-w-2xl text-base leading-relaxed text-stone-700 md:text-lg">
                {t('hero.lead')}
              </p>
              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-stone-600 md:text-base">
                {t('hero.textBefore')}{' '}
                <span className="italic">{t('hero.cabin')}</span> {t('hero.or')}{' '}
                <span className="italic">{t('hero.valley')}</span>. {t('hero.tail')}
              </p>
              <div className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-3 text-xs uppercase tracking-[0.22em] text-stone-500">
                <span>{t('hero.deliveryTag')}</span>
                <span className="hidden h-px w-6 bg-stone-300 md:inline-block" />
                <span>{t('hero.validTag')}</span>
                <span className="hidden h-px w-6 bg-stone-300 md:inline-block" />
                <span>{t('hero.fromTag')}</span>
              </div>
            </div>
            <div className="mx-auto w-full max-w-sm md:sticky md:top-24 md:max-w-none">
              <figure className="overflow-hidden rounded-md border-8 border-white bg-white shadow-[0_22px_55px_-25px_rgba(0,0,0,0.35)] md:rotate-[2deg]">
                <img
                  src="/media/gift-vouchers/gift-voucher-hero.jpg"
                  alt={t('hero.imageAlt')}
                  className="aspect-[4/5] w-full object-cover"
                  loading="eager"
                />
              </figure>
            </div>
          </div>
        </section>

        <section className="bg-white py-16 md:py-24">
          <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-10 px-4 sm:px-8 md:grid-cols-3 md:gap-12">
            <div className="md:col-span-1">
              <p className="text-[11px] uppercase tracking-[0.28em] text-stone-500">{t('howItWorks.title')}</p>
              <div className="mt-3 h-px w-12 bg-stone-300" />
            </div>
            <div className="md:col-span-2 space-y-6 text-base leading-relaxed text-stone-700 md:text-[17px]">
              <p>
                {t('howItWorks.line1')} {t('howItWorks.line2')}
              </p>
              <p>{t('howItWorks.line3')}</p>
            </div>
          </div>
        </section>

        <section className="bg-[#FAFAF7] py-16 md:py-24">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-8">
            <div className="mb-10 md:mb-14">
              <p className="text-[11px] uppercase tracking-[0.28em] text-stone-500">{t('order.kicker')}</p>
              <h2
                className="mt-3 font-serif text-2xl leading-tight tracking-tight text-stone-900 md:text-3xl"
                style={{ fontFamily: 'var(--valley-font-primary, Georgia, serif)' }}
              >
                {t('order.customize')}
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-stone-600">{t('order.minimumText')}</p>
            </div>

            <div className="grid grid-cols-1 gap-10 lg:grid-cols-[3fr_2fr] lg:gap-12">
              <div className="min-w-0 lg:sticky lg:top-24 lg:self-start">
                <p className="mb-4 text-[11px] uppercase tracking-[0.28em] text-stone-500">
                  {t('order.previewLabel')}
                </p>
                <GiftVoucherCardPreview fields={previewFields} />
              </div>

              <div className="min-w-0 w-full space-y-10 lg:space-y-12">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.28em] text-stone-500">{t('order.chooseAmount')}</p>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    {PRESET_AMOUNTS.map((preset) => (
                      <AmountCard
                        key={preset}
                        cents={preset}
                        selected={!builder.useCustomAmount && builder.amountOriginalCents === preset}
                        onClick={() =>
                          patchBuilder({ useCustomAmount: false, amountOriginalCents: preset })
                        }
                      />
                    ))}
                  </div>
                  <div className="mt-6 rounded-2xl border border-stone-200 bg-white px-5 py-5 md:px-6">
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={builder.useCustomAmount}
                        onChange={(e) => patchBuilder({ useCustomAmount: e.target.checked })}
                        className="mt-1 h-4 w-4 rounded border-stone-400 text-stone-900 focus:ring-stone-700"
                      />
                      <span className="text-sm text-stone-700">{t('amount.customAmount')}</span>
                    </label>
                    {builder.useCustomAmount && (
                      <div className="mt-4 flex items-center gap-3">
                        <span className="font-serif text-2xl text-stone-700">€</span>
                        <input
                          type="number"
                          min="15"
                          step="1"
                          value={builder.customAmountEur}
                          onChange={(e) => patchBuilder({ customAmountEur: e.target.value })}
                          className="w-full border-0 border-b border-stone-300 bg-transparent px-0 py-2 font-serif text-2xl text-stone-900 outline-none transition focus:border-stone-700"
                          placeholder={t('amount.customPlaceholder')}
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <p className={labelClass}>{t('templates.label')}</p>
                  <div className="mt-4 grid grid-cols-3 gap-3">
                    {CARD_TEMPLATE_IDS.map((templateId) => (
                      <button
                        key={templateId}
                        type="button"
                        onClick={() => patchBuilder({ cardTemplateId: templateId })}
                        className={`rounded-xl border px-3 py-4 text-center text-xs uppercase tracking-[0.18em] transition ${
                          builder.cardTemplateId === templateId
                            ? 'border-stone-900 bg-stone-900 text-white'
                            : 'border-stone-200 bg-white text-stone-700 hover:border-stone-400'
                        }`}
                      >
                        {t(`templates.${templateId}`)}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className={labelClass}>{t('occasions.label')}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {CARD_OCCASIONS.map((occasion) => (
                      <button
                        key={occasion}
                        type="button"
                        onClick={() => patchBuilder({ cardOccasion: occasion })}
                        className={`rounded-full border px-4 py-2 text-xs transition ${
                          builder.cardOccasion === occasion
                            ? 'border-stone-900 bg-stone-900 text-white'
                            : 'border-stone-200 bg-white text-stone-700 hover:border-stone-400'
                        }`}
                      >
                        {t(`occasions.${occasion}`)}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className={labelClass}>{t('fields.message')}</label>
                  <textarea
                    className={`${inputClass} resize-none`}
                    rows={3}
                    maxLength={MESSAGE_MAX_LENGTH}
                    placeholder={t('fields.messagePlaceholder')}
                    value={builder.message}
                    onChange={(e) => patchBuilder({ message: e.target.value })}
                  />
                  <p className="mt-1 text-right text-xs text-stone-500">
                    {t('fields.messageCounter', {
                      count: builder.message.length,
                      max: MESSAGE_MAX_LENGTH
                    })}
                  </p>
                </div>

                <div>
                  <p className="text-[11px] uppercase tracking-[0.28em] text-stone-500">{t('fields.for')}</p>
                  <div className="mt-2 h-px w-12 bg-stone-300" />
                  <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
                    <div>
                      <label className={labelClass}>{t('fields.recipientName')}</label>
                      <input
                        className={inputClass}
                        placeholder={t('fields.recipientNamePlaceholder')}
                        value={builder.recipientName}
                        onChange={(e) => patchBuilder({ recipientName: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>{t('fields.from')}</label>
                      <input
                        className={inputClass}
                        placeholder={t('fields.buyerNamePlaceholder')}
                        value={builder.buyerName}
                        onChange={(e) => patchBuilder({ buyerName: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <p className={labelClass}>{t('cardLocale.label')}</p>
                  <div className="mt-4 flex gap-2">
                    {['en', 'bg'].map((loc) => (
                      <button
                        key={loc}
                        type="button"
                        onClick={() => patchBuilder({ cardLocale: loc })}
                        className={`rounded-full border px-4 py-2 text-xs transition ${
                          builder.cardLocale === loc
                            ? 'border-stone-900 bg-stone-900 text-white'
                            : 'border-stone-200 bg-white text-stone-700 hover:border-stone-400'
                        }`}
                      >
                        {t(`cardLocale.${loc}`)}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-[11px] uppercase tracking-[0.28em] text-stone-500">{t('delivery.title')}</p>
                  <div className="mt-2 h-px w-12 bg-stone-300" />
                  <p className="mt-3 text-sm text-stone-600">{t('delivery.hint')}</p>
                  <fieldset className="mt-6 space-y-3">
                    <legend className="sr-only">{t('delivery.sendMethod')}</legend>
                    {deliveryOptions.map((opt) => (
                      <label
                        key={opt.value}
                        className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition ${
                          builder.deliveryOption === opt.value
                            ? 'border-stone-900 bg-white'
                            : 'border-stone-200 bg-white hover:border-stone-400'
                        }`}
                      >
                        <input
                          type="radio"
                          name="deliveryOption"
                          value={opt.value}
                          checked={builder.deliveryOption === opt.value}
                          onChange={() => {
                            const patch = { deliveryOption: opt.value };
                            if (opt.value === 'send_to_buyer') patch.recipientEmail = '';
                            if (opt.value !== 'scheduled') patch.deliveryDate = '';
                            patchBuilder(patch);
                          }}
                          className="mt-1"
                        />
                        <span className="text-sm text-stone-800">{opt.label}</span>
                      </label>
                    ))}
                  </fieldset>
                  {builder.deliveryOption === 'send_to_buyer' && (
                    <p className="mt-3 text-sm text-stone-600">{t('delivery.sendToBuyerHint')}</p>
                  )}
                  {builder.deliveryOption === 'scheduled' && (
                    <div className="mt-6">
                      <label className={labelClass}>{t('delivery.scheduledDate')}</label>
                      <input
                        type="date"
                        className={inputClass}
                        min={scheduledBounds.minIso}
                        max={scheduledBounds.maxIso}
                        value={builder.deliveryDate}
                        onChange={(e) => patchBuilder({ deliveryDate: e.target.value })}
                      />
                      <p className="mt-2 text-xs text-stone-500">{t('delivery.scheduledDateHint')}</p>
                    </div>
                  )}
                  {builder.deliveryOption === 'postal' && (
                    <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
                      <div>
                        <label className={labelClass}>{t('postal.address1')}</label>
                        <input
                          className={inputClass}
                          placeholder={t('postal.address1Placeholder')}
                          value={builder.addressLine1}
                          onChange={(e) => patchBuilder({ addressLine1: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>{t('postal.address2')}</label>
                        <input
                          className={inputClass}
                          placeholder={t('postal.address2Placeholder')}
                          value={builder.addressLine2}
                          onChange={(e) => patchBuilder({ addressLine2: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>{t('postal.city')}</label>
                        <input
                          className={inputClass}
                          value={builder.city}
                          onChange={(e) => patchBuilder({ city: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>{t('postal.postalCode')}</label>
                        <input
                          className={inputClass}
                          value={builder.postalCode}
                          onChange={(e) => patchBuilder({ postalCode: e.target.value })}
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className={labelClass}>{t('postal.country')}</label>
                        <input
                          className={inputClass}
                          value={builder.country}
                          onChange={(e) => patchBuilder({ country: e.target.value })}
                        />
                      </div>
                    </div>
                  )}
                  {(builder.deliveryOption === 'recipient_now' ||
                    builder.deliveryOption === 'scheduled') && (
                    <div className="mt-6">
                      <label className={labelClass}>{t('fields.recipientEmail')}</label>
                      <input
                        type="email"
                        className={inputClass}
                        placeholder={t('fields.emailPlaceholder')}
                        value={builder.recipientEmail}
                        onChange={(e) => patchBuilder({ recipientEmail: e.target.value })}
                      />
                    </div>
                  )}
                  {builder.deliveryOption === 'postal' && (
                    <div className="mt-6">
                      <label className={labelClass}>{t('fields.recipientEmailOptional')}</label>
                      <input
                        type="email"
                        className={inputClass}
                        placeholder={t('fields.emailPlaceholder')}
                        value={builder.recipientEmail}
                        onChange={(e) => patchBuilder({ recipientEmail: e.target.value })}
                      />
                    </div>
                  )}
                </div>

                <div>
                  <label className={labelClass}>{t('fields.buyerEmail')}</label>
                  <input
                    type="email"
                    className={inputClass}
                    placeholder={t('fields.emailPlaceholder')}
                    value={builder.buyerEmail}
                    onChange={(e) => patchBuilder({ buyerEmail: e.target.value })}
                  />
                </div>

                <div className="rounded-2xl border border-stone-200 bg-white p-6 md:p-8">
                  {builder.deliveryOption === 'postal' ? (
                    <div className="space-y-3 text-sm text-stone-700">
                      <div className="flex items-baseline justify-between gap-4">
                        <p className="text-[11px] uppercase tracking-[0.28em] text-stone-500">
                          {t('summary.voucherValue')}
                        </p>
                        <p className="font-serif text-xl tracking-tight text-stone-900">€{formattedVoucherValue}</p>
                      </div>
                      <div className="flex items-baseline justify-between gap-4">
                        <p className="text-[11px] uppercase tracking-[0.28em] text-stone-500">
                          {t('summary.physicalFee')}
                        </p>
                        <p className="font-serif text-xl tracking-tight text-stone-900">€{formattedPhysicalFee}</p>
                      </div>
                      <div className="flex items-baseline justify-between gap-4 border-t border-stone-200 pt-3">
                        <p className="text-[11px] uppercase tracking-[0.28em] text-stone-500">{t('summary.total')}</p>
                        <p
                          className="font-serif text-3xl tracking-tight text-stone-900 md:text-4xl"
                          style={{ fontFamily: 'var(--valley-font-primary, Georgia, serif)' }}
                        >
                          €{formattedSummary}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-baseline justify-between gap-4">
                      <p className="text-[11px] uppercase tracking-[0.28em] text-stone-500">{t('summary.total')}</p>
                      <p
                        className="font-serif text-3xl tracking-tight text-stone-900 md:text-4xl"
                        style={{ fontFamily: 'var(--valley-font-primary, Georgia, serif)' }}
                      >
                        €{formattedSummary}
                      </p>
                    </div>
                  )}
                  <p className="mt-3 text-xs leading-relaxed text-stone-500">{t('summary.line')}</p>
                  {paymentIntentId && (
                    <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-stone-400">
                      {t('summary.reference')} · {paymentIntentId}
                    </p>
                  )}
                </div>

                <label className="flex items-start gap-3 text-sm text-stone-700">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded border-stone-400 text-stone-900 focus:ring-stone-700"
                    checked={builder.termsAccepted}
                    onChange={(e) => patchBuilder({ termsAccepted: e.target.checked })}
                  />
                  <span>
                    {t('terms.prefix')}
                    <Link
                      to="/terms"
                      className="underline decoration-stone-400 underline-offset-4 hover:decoration-stone-700"
                    >
                      {t('terms.terms')}
                    </Link>{' '}
                    {t('terms.and')}
                    <Link
                      to="/cancellation-policy"
                      className="underline decoration-stone-400 underline-offset-4 hover:decoration-stone-700"
                    >
                      {t('terms.cancellation')}
                    </Link>
                    .
                  </span>
                </label>

                <div>
                  {!clientSecret ? (
                    <button
                      type="button"
                      onClick={initializePayment}
                      disabled={loading}
                      className="w-full rounded-full bg-[#81887A] px-8 py-4 text-sm font-medium uppercase tracking-[0.18em] text-white transition hover:bg-[#6f7669] disabled:cursor-not-allowed disabled:opacity-50 md:w-auto md:min-w-[280px]"
                    >
                      {loading ? t('payment.preparing') : t('payment.continue')}
                    </button>
                  ) : (
                    <div className="space-y-4">
                      <Elements
                        key={`gift-voucher:${language}`}
                        stripe={stripePromise}
                        options={{ clientSecret, locale: stripeElementsLocale }}
                      >
                        <PaymentForm
                          submitDisabled={!validation.ok}
                          onSubmit={handleStripeSubmit}
                          loading={loading}
                        />
                      </Elements>
                      <button
                        type="button"
                        onClick={resetAttempt}
                        className="text-xs uppercase tracking-[0.2em] text-stone-500 underline-offset-4 hover:text-stone-800 hover:underline"
                      >
                        {t('payment.editDetails')}
                      </button>
                    </div>
                  )}

                  {(error || validationMessage) && (
                    <div
                      role="alert"
                      className="mt-6 rounded-2xl border border-stone-300 bg-white px-5 py-4 text-sm text-stone-700"
                    >
                      {error || validationMessage}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white py-12 md:py-16">
          <div className="mx-auto w-full max-w-5xl px-4 sm:px-8">
            <div className="grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-10">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-stone-500">
                  {t('reassurance.prepaidTitle')}
                </p>
                <p className="mt-3 text-sm leading-relaxed text-stone-600">{t('reassurance.prepaidText')}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-stone-500">
                  {t('reassurance.durationTitle')}
                </p>
                <p className="mt-3 text-sm leading-relaxed text-stone-600">{t('reassurance.durationText')}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-stone-500">
                  {t('reassurance.helpTitle')}
                </p>
                <p className="mt-3 text-sm leading-relaxed text-stone-600">
                  {t('reassurance.helpText')}{' '}
                  <Link
                    to="/contact"
                    className="underline decoration-stone-400 underline-offset-4 hover:decoration-stone-700"
                  >
                    {t('reassurance.contactUs')}
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
