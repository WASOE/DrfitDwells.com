import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useStripeAvailability } from '../lib/stripeClient';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import Seo from '../components/Seo';
import { buildPreviewVoucher, buildSubmitPayload, CARD_OCCASIONS, computeEffectiveAmountCents, createInitialBuilderState, EMAIL_MAX_LENGTH, getScheduledDeliveryDateBounds, MESSAGE_MAX_LENGTH, NAME_MAX_LENGTH, PHYSICAL_CARD_FEE_CENTS, POSTAL_MAX_LENGTHS, PRESET_AMOUNTS, validateBuilderState } from '../components/giftVoucher/giftVoucherBuilderState';
import GiftVoucherWebsitePreview from '../components/giftVoucher/GiftVoucherWebsitePreview';
import { giftVoucherAPI } from '../services/api';
import { getAttributionPayload } from '../tracking/attribution';
import { CONTACT_EMAIL } from '../data/gmbLocations';
import { useSiteLanguage } from '../hooks/useSiteLanguage';
import { getLanguageFromPath, localizePath } from '../utils/localizedRoutes';
import '../i18n/ns/giftVoucher';
import './GiftVouchersV2.css';

const ERR = { WHOLE_AMOUNT:'errors.wholeAmount', AMOUNT_BELOW_MINIMUM:'errors.minimum', NAMES_REQUIRED:'errors.namesRequired', NAMES_TOO_LONG:'errors.namesTooLong', BUYER_EMAIL:'errors.buyerEmail', RECIPIENT_EMAIL:'errors.recipientEmail', POSTAL_REQUIRED:'errors.postalRequired', POSTAL_TOO_LONG:'errors.postalTooLong', INVALID_DELIVERY_OPTION:'errors.invalidDelivery', INVALID_CUSTOMIZATION_FIELD:'errors.invalidCustomization', TERMS_NOT_ACCEPTED:'errors.termsRequired', MESSAGE_TOO_LONG:'errors.messageTooLong', MISSING_SCHEDULED_DELIVERY_DATE:'errors.scheduledDateRequired', INVALID_SCHEDULED_DELIVERY_DATE:'errors.scheduledDateInvalid', SCHEDULED_NOT_ENABLED:'errors.scheduledNotEnabled' };
const requestId = () => `gvr_${typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`}`;
const heroWidths = [480, 800, 1200, 1600, 2400];
const heroSrcSet = (extension) => heroWidths
  .map((width) => `/media/gift-vouchers/gift-voucher-v2-hero-${width}w.${extension} ${width}w`)
  .join(', ');

function Pay({ loading, disabled, onPay }) {
  const { t } = useTranslation('giftVoucher');
  const stripe = useStripe();
  const elements = useElements();
  return (
    <form className="gv2-pay" onSubmit={async (e) => {
      e.preventDefault();
      if (!stripe || !elements || loading || disabled) return;
      await onPay(stripe, elements);
    }}>
      <PaymentElement />
      {loading && <p className="gv2-sr-only" role="status" aria-live="polite">{t('payment.processing')}</p>}
      <button type="submit" className="btn btn-primary submit-btn gv2-submit" aria-live="polite" disabled={!stripe || !elements || loading || disabled}>
        {loading ? t('payment.processing') : t('payment.paySecurely')} ↗
      </button>
    </form>
  );
}

export default function GiftVouchers() {
  const { t } = useTranslation('giftVoucher');
  const {
    stripePromise,
    unavailable: stripeUnavailable,
    retry: retryStripe
  } = useStripeAvailability();
  const { language } = useSiteLanguage();
  const location = useLocation();
  const locale = getLanguageFromPath(location.pathname) === 'bg' ? 'bg' : 'en';
  const c = t('v2', { returnObjects: true });
  const [b, setB] = useState(() => createInitialBuilderState(locale));
  const [scheduled, setScheduled] = useState(false);
  const [ready, setReady] = useState(false);
  const [configError, setConfigError] = useState(false);
  const [configAttempt, setConfigAttempt] = useState(0);
  const [rid, setRid] = useState(requestId);
  const [prepared, setPrepared] = useState(null);
  const [stripeClient, setStripeClient] = useState(null);
  const [stripeFailed, setStripeFailed] = useState(stripeUnavailable);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [review, setReview] = useState(false);
  const [validationRequested, setValidationRequested] = useState(false);
  const [mobileCtaVisible, setMobileCtaVisible] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(false);
  const attempt = useRef({ version: 0, prepared: null });
  const dialog = useRef(null);
  const modalOpener = useRef(null);
  const secret = prepared?.clientSecret || '';
  const paymentIntentId = prepared?.stripePaymentIntentId || '';
  const quote = prepared?.quote || null;
  const bounds = getScheduledDeliveryDateBounds();
  const config = useMemo(() => ({ scheduledDeliveryEnabled: scheduled }), [scheduled]);
  const amount = useMemo(() => computeEffectiveAmountCents(b), [b]);
  const previewFields = useMemo(() => buildPreviewVoucher(b, amount), [b, amount]);
  const validation = validateBuilderState(b, config);
  const validationText = validation.ok ? '' : t(ERR[validation.code] || 'errors.paymentFallback');

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      attempt.current.version += 1;
      attempt.current.prepared = null;
    };
  }, []);

  useEffect(() => {
    let live = true;
    if (!stripePromise || stripeUnavailable) {
      setStripeClient(null);
      setStripeFailed(true);
      return () => { live = false; };
    }
    setStripeFailed(false);
    Promise.resolve(stripePromise).then((client) => {
      if (!live) return;
      if (!client) {
        setStripeClient(null);
        setStripeFailed(true);
      } else {
        setStripeClient(client);
      }
    }).catch(() => {
      if (live) {
        setStripeClient(null);
        setStripeFailed(true);
      }
    });
    return () => { live = false; };
  }, [stripePromise, stripeUnavailable]);

  useEffect(() => {
    let live = true;
    setReady(false);
    setConfigError(false);
    giftVoucherAPI.getConfig().then((r) => {
      if (typeof r?.data?.data?.scheduledDeliveryEnabled !== 'boolean') {
        throw new Error('Invalid voucher configuration');
      }
      if (live) {
        setScheduled(r.data.data.scheduledDeliveryEnabled);
        setReady(true);
      }
    }).catch(() => {
      if (live) {
        setScheduled(false);
        setConfigError(true);
      }
    });
    return () => { live = false; };
  }, [configAttempt]);

  useEffect(() => {
    document.body.classList.add('gv2-active');
    try { sessionStorage.setItem('dd_payment_flow_active', '1'); } catch {
      // Storage can be unavailable in privacy mode.
    }
    return () => {
      document.body.classList.remove('gv2-active');
      try { sessionStorage.removeItem('dd_payment_flow_active'); } catch {
        // Match the existing payment flow marker's best-effort cleanup.
      }
    };
  }, []);

  useEffect(() => {
    let builderVisible = false;
    const update = () => {
      setMobileCtaVisible(
        window.innerWidth <= 760 &&
        window.scrollY > Math.min(550, window.innerHeight * 0.75) &&
        !builderVisible
      );
    };
    const builder = document.getElementById('create');
    const observer = builder && 'IntersectionObserver' in window
      ? new IntersectionObserver(([entry]) => {
        builderVisible = entry.isIntersecting;
        update();
      })
      : null;
    if (builder && observer) observer.observe(builder);
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  useEffect(() => {
    if (!review) return;
    const modal = dialog.current;
    if (!modal) return undefined;
    const previous = modalOpener.current || document.activeElement;
    const focusableSelector = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
    const getFocusable = () => [...modal.querySelectorAll(focusableSelector)]
      .filter((node) => !node.closest('[hidden]'));
    (getFocusable()[0] || modal).focus();
    const isolated = [];
    let branch = modal;
    while (branch && branch !== document.body) {
      const parent = branch.parentElement;
      if (!parent) break;
      for (const sibling of parent.children) {
        if (sibling === branch) continue;
        isolated.push({ element: sibling, inert: sibling.inert, ariaHidden: sibling.getAttribute('aria-hidden') });
        sibling.inert = true;
        sibling.setAttribute('aria-hidden', 'true');
      }
      branch = parent;
    }
    const bodyOverflow = document.body.style.overflow;
    const htmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy.current) setReview(false);
      if (e.key !== 'Tab') return;
      const focusable = getFocusable();
      if (!focusable.length) {
        e.preventDefault();
        modal.focus();
        return;
      }
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (!modal.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    const onFocus = (e) => {
      if (!modal.contains(e.target)) (getFocusable()[0] || modal).focus();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
      isolated.forEach(({ element, inert, ariaHidden }) => {
        element.inert = Boolean(inert);
        if (ariaHidden == null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', ariaHidden);
      });
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = htmlOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [review]);

  function resetAttempt() {
    if (busy.current) return;
    attempt.current.version += 1;
    attempt.current.prepared = null;
    setPrepared(null);
    setRid(requestId());
    setError('');
  }

  function patch(changes) {
    if (busy.current) return;
    setB((s) => ({ ...s, ...changes }));
    resetAttempt();
  }

  function delivery(id) {
    const changes = { deliveryOption: id };
    if (id === 'send_to_buyer') changes.recipientEmail = '';
    if (id !== 'scheduled') changes.deliveryDate = '';
    patch(changes);
  }

  function softError(e) {
    const code = e?.response?.data?.code || e?.code;
    return code ? t(`errors.${code}`, { defaultValue: t('errors.paymentFallback') }) : t('errors.paymentFallback');
  }

  async function start() {
    if (busy.current) return;
    if (!ready) { setError(c.configError); return; }
    if (!stripeClient) { setError(c.stripeUnavailable); return; }
    const currentValidation = validateBuilderState(b, config);
    if (!currentValidation.ok) { setError(t(ERR[currentValidation.code] || 'errors.paymentFallback')); return; }
    if (attempt.current.prepared) { setReview(false); return; }
    const payload = buildSubmitPayload(b, { purchaseRequestId: rid, attribution: getAttributionPayload() }, config);
    if (!payload) { setError(validationText || t('errors.paymentFallback')); return; }
    busy.current = true;
    const version = attempt.current.version;
    const isCurrent = () => mounted.current && attempt.current.version === version;
    setLoading(true);
    setError('');
    try {
      const response = await giftVoucherAPI.quote({
        amountOriginalCents: payload.amountOriginalCents, currency: 'EUR', deliveryOption: payload.deliveryOption
      });
      const q = response?.data?.data;
      if (!q || ![q.amountOriginalCents, q.physicalCardFeeCents, q.totalDueCents].every(Number.isSafeInteger) ||
        q.amountOriginalCents !== payload.amountOriginalCents || q.currency !== payload.currency || q.physicalCardFeeCents < 0 ||
        q.totalDueCents !== q.amountOriginalCents + q.physicalCardFeeCents) {
        throw new Error('Invalid voucher quote');
      }
      if (!isCurrent()) return;
      const pi = await giftVoucherAPI.createPaymentIntent(payload);
      const data = pi?.data?.data;
      if (typeof data?.clientSecret !== 'string' || !data.clientSecret.trim() ||
        typeof data?.stripePaymentIntentId !== 'string' || !data.stripePaymentIntentId.trim() ||
        (data.purchaseRequestId != null && data.purchaseRequestId !== payload.purchaseRequestId)) {
        throw new Error('Invalid voucher payment response');
      }
      if (!isCurrent()) return;
      const payment = { clientSecret: data.clientSecret, stripePaymentIntentId: data.stripePaymentIntentId, quote: q };
      attempt.current.prepared = payment;
      setPrepared(payment);
      if (data.purchaseRequestId) setRid(data.purchaseRequestId);
      setReview(false);
      requestAnimationFrame(() => {
        if (isCurrent()) document.querySelector('.gv2-paywrap')?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
      });
    } catch (e) {
      if (isCurrent()) {
        attempt.current.prepared = null;
        setPrepared(null);
        setError(softError(e));
      }
    } finally {
      busy.current = false;
      if (isCurrent()) setLoading(false);
    }
  }

  async function pay(stripe, elements) {
    if (busy.current || !validation.ok || !ready || !prepared || attempt.current.prepared !== prepared) return;
    const version = attempt.current.version;
    const isCurrent = () => mounted.current && attempt.current.version === version;
    busy.current = true;
    setLoading(true);
    setError('');
    try {
      const path = locale === 'bg' ? '/bg/gift-vouchers/success' : '/gift-vouchers/success';
      const result = await stripe.confirmPayment({
        elements, confirmParams: { return_url: `${window.location.origin}${path}` }
      });
      if (isCurrent() && result.error) setError(result.error.message || t('errors.paymentFallback'));
    } catch (e) {
      if (isCurrent()) setError(softError(e));
    } finally {
      busy.current = false;
      if (isCurrent()) setLoading(false);
    }
  }

  const money = (cents) => Number.isFinite(cents)
    ? new Intl.NumberFormat(locale === 'bg' ? 'bg-BG' : 'en-IE', { style: 'currency', currency: 'EUR' }).format(cents / 100) : '—';
  const fee = quote?.physicalCardFeeCents ?? (b.deliveryOption === 'postal' ? PHYSICAL_CARD_FEE_CENTS : 0);
  const value = quote?.amountOriginalCents ?? amount;
  const total = quote?.totalDueCents ?? value + fee;
  const templates = [['forest', c.styles[0]], ['minimal', c.styles[1]], ['romantic', c.styles[2]]];
  const deliveries = [['recipient_now', '↗', c.delivery[0], c.subs[0]], ['send_to_buyer', '✉', c.delivery[1], c.subs[1]], ['postal', '▤', c.delivery[2], c.subs[2]], ...(scheduled ? [['scheduled', '◷', c.delivery[3], c.subs[3]]] : [])];
  const scrollBehavior = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  const scrollToBuilder = () => document.getElementById('create')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  const fieldErrorFor = (field) => {
    const fieldsByError = {
      WHOLE_AMOUNT: ['amount'], AMOUNT_BELOW_MINIMUM: ['amount'],
      NAMES_REQUIRED: ['buyerName', 'recipientName'], NAMES_TOO_LONG: ['buyerName', 'recipientName'],
      BUYER_EMAIL: ['buyerEmail'], RECIPIENT_EMAIL: ['recipientEmail'],
      TERMS_NOT_ACCEPTED: ['termsAccepted'],
      POSTAL_REQUIRED: ['addressLine1', 'city', 'postalCode', 'country'],
      POSTAL_TOO_LONG: ['addressLine1', 'addressLine2', 'city', 'postalCode', 'country'],
      MISSING_SCHEDULED_DELIVERY_DATE: ['deliveryDate'], INVALID_SCHEDULED_DELIVERY_DATE: ['deliveryDate'],
      SCHEDULED_NOT_ENABLED: ['deliveryDate'], MESSAGE_TOO_LONG: ['message'],
      INVALID_CUSTOMIZATION_FIELD: ['cardTemplateId', 'cardOccasion', 'cardLocale'],
      INVALID_DELIVERY_OPTION: ['deliveryOption']
    };
    return validationRequested && !validation.ok && fieldsByError[validation.code]?.includes(field);
  };
  const fieldA11y = (field) => fieldErrorFor(field)
    ? { 'aria-invalid': true, 'aria-describedby': 'gv2-validation-description' }
    : {};
  const reference = t('reference', { returnObjects: true });
  const openReview = (event) => {
    event.preventDefault();
    if (busy.current) return;
    modalOpener.current = event.currentTarget.querySelector('[type="submit"]');
    setValidationRequested(true);
    setReview(true);
  };
  return (
    <>
      <Seo title={t('seo.title')} description={t('seo.description')} canonicalPath="/gift-vouchers" />
      <div className="gv2" lang={locale}>
        <section className="hero gv2-hero" id="top">
          <div className="hero-copy">
            <div className="hero-index caps"><i aria-hidden="true" />{reference.hero.kicker}</div>
            <h1>{reference.hero.first}<br /><em>{reference.hero.middle}</em><br />{reference.hero.last}</h1>
            <p>{reference.hero.lead}</p>
            <div className="hero-actions">
              <button className="btn btn-primary" type="button" onClick={scrollToBuilder}>{reference.hero.create}<span>↗</span></button>
              <a className="hero-link" href="#discover">{reference.hero.discover}</a>
            </div>
            <div className="hero-foot"><span>{reference.hero.from}</span><span>✳ {reference.hero.instant}</span><span>✳ {reference.hero.valid}</span></div>
          </div>
          <div className="hero-image">
            <picture>
              <source type="image/avif" srcSet={heroSrcSet('avif')} sizes="(max-width: 760px) 100vw, 45vw" />
              <source type="image/webp" srcSet={heroSrcSet('webp')} sizes="(max-width: 760px) 100vw, 45vw" />
              <img
                className="photo"
                src="/media/gift-vouchers/gift-voucher-v2-hero-1200w.jpg"
                srcSet={heroSrcSet('jpg')}
                sizes="(max-width: 760px) 100vw, 45vw"
                width={460}
                height={583}
                alt={reference.hero.imageAlt}
              />
            </picture>
            <div className="hero-vertical" aria-hidden="true">DRIFT &amp; DWELLS · {reference.hero.vertical}</div>
            <div className="photo-caption"><span>{reference.hero.caption}</span><span>{t('hero.valley')} · {t('hero.cabin')}</span></div>
          </div>
        </section>

        <div className="bottom-ribbon">
          <div className="max ribbon-in">{reference.ribbon.map(([title, text], index) =>
            <div className="ribbon-item" key={title}><span className="ribbon-number">0{index + 1}.</span>
              <div><strong>{title}</strong><small>{text}</small></div></div>)}</div>
        </div>

        <section className="experience" id="discover">
          <div className="max">
            <div className="section-intro">
              <div><div className="caps">{reference.experience.kicker}</div><h2>{reference.experience.title} <em>{reference.experience.titleEm}</em></h2></div>
              <p>{reference.experience.lead}</p>
            </div>
            <div className="escape-grid">
              {reference.experience.cards.map(([kicker, title, description], index) => (
                <article key={kicker} className={`escape-card${index === 0 ? ' dark' : ''}${index === 2 ? ' ochre' : ''}`}>
                  <div className="caps">{kicker}</div>
                  <div className="escape-art" aria-hidden="true">
                    <div className="sun" />
                    {index === 0 && <svg viewBox="0 0 400 300"><path d="M0 255 105 112 174 204 262 61 400 254M25 269 109 151 157 208M147 272 268 115 383 269M0 290h400" /><path d="M80 280v-95m0 0-19 33m19-26 22 37m-22-18-26 45m26-38 31 46M332 280V153m0 21-29 41m29-34 21 34m-21-8-40 56m40-50 36 53" /></svg>}
                    {index === 1 && <svg viewBox="0 0 400 300"><path d="m-10 277 100-135 103 129 81-115 140 131M20 295l82-114 92 108M185 294l94-111 110 107" /><path d="M240 264h125l-62-100-63 100Zm25-14 38-58 38 58M303 164v100M254 270v16m99-16v16" /></svg>}
                    {index === 2 && <svg viewBox="0 0 400 300"><path d="M40 208q80-65 150 0t190 0M40 238q80-65 150 0t190 0M40 268q80-65 150 0t190 0M40 298q80-65 150 0t190 0" /><path d="M40 65h170M40 82h112M40 99h145M40 116h98" /></svg>}
                  </div>
                  <div className="card-bottom"><h3>{title}</h3><p>{description}</p></div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="builder" id="create">
          <div className="max">
            <div className="builder-head">
              <div><div className="caps">{reference.builder.kicker}</div><h2>{reference.builder.title} <em>{reference.builder.titleEm}</em></h2></div>
              <p>{reference.builder.previewIntro}</p>
            </div>
            <div className="builder-layout">
              <aside className="preview-wrap" aria-label={t('aria.preview')}>
                <div className="preview-label"><span className="caps">{c.before}</span><span className="caps">↗ {c.live}</span></div>
                <div className="preview-stage">
                  <div className="stage-grain" aria-hidden="true" /><div className="envelope" aria-hidden="true" /><div className="seal" aria-hidden="true">D&amp;D</div>
                  <GiftVoucherWebsitePreview fields={previewFields} copy={reference.builder} />
                </div>
                <div className="preview-under"><b>{reference.builder.previewUnder}</b><span>{reference.builder.previewUnderText}</span></div>
              </aside>
              <div className="order-form">
                <form className="gv2-details builder-form" aria-labelledby="gv2-builder-title" noValidate onSubmit={openReview}>
                  <fieldset className="form-fieldset" disabled={loading}>
                    <legend className="gv2-sr-only">{t('aria.builder')}</legend>
                    <div className="form-head"><h3 id="gv2-builder-title">{c.build}</h3><div className="caps">{c.personal}</div></div>
                    <div className="form-section">
                      <div className="form-section-title" id="gv2-amount-label"><span className="count">01</span><h4>{c.choose}</h4><span className="tip">{c.thoughtful}</span></div>
                      <div className="amounts" role="group" aria-label={t('aria.amount')}>
                        {PRESET_AMOUNTS.map((amountCents) => <button key={amountCents} type="button" className={`amount-btn${!b.useCustomAmount && b.amountOriginalCents === amountCents ? ' active' : ''}`}
                          aria-pressed={!b.useCustomAmount && b.amountOriginalCents === amountCents} onClick={() => patch({ useCustomAmount: false, amountOriginalCents: amountCents })}>€{amountCents / 100}</button>)}
                        <button type="button" className={`amount-btn custom${b.useCustomAmount ? ' active' : ''}`} aria-pressed={b.useCustomAmount} onClick={() => patch({ useCustomAmount: true })}>{c.custom}</button>
                      </div>
                      {b.useCustomAmount && <label className="custom-wrap visible" htmlFor="gv2-custom-amount"><span>€</span><input id="gv2-custom-amount" {...fieldA11y('amount')} aria-label={t('amount.customAmount')} autoFocus type="number" inputMode="decimal" min="15" step="0.01" placeholder={t('amount.customPlaceholder')} value={b.customAmountEur} onChange={(e) => patch({ customAmountEur: e.target.value })} /></label>}
                      <p className="microcopy">{c.credit}</p>
                    </div>
                    <div className="form-section">
                      <div className="form-section-title"><span className="count">02</span><h4>{c.personalize}</h4></div>
                      <div className="form-fields">
                        <div className="field"><label className="label" htmlFor="gv2-recipient-name">{c.name}</label><input id="gv2-recipient-name" {...fieldA11y('recipientName')} maxLength={NAME_MAX_LENGTH} placeholder={t('fields.recipientNamePlaceholder')} value={b.recipientName} onChange={(e) => patch({ recipientName: e.target.value })} /></div>
                        <div className="field"><label className="label" htmlFor="gv2-buyer-name">{c.from}</label><input id="gv2-buyer-name" {...fieldA11y('buyerName')} maxLength={NAME_MAX_LENGTH} placeholder={t('fields.buyerNamePlaceholder')} value={b.buyerName} onChange={(e) => patch({ buyerName: e.target.value })} /></div>
                      </div>
                      <label className="label" htmlFor="gv2-message">{c.note}</label>
                      <div className="sample-messages" role="group" aria-label={t('aria.messageSuggestions')}>
                        {reference.messageChips.map(([label, message]) => <button key={label} className="tiny-chip" type="button" onClick={() => patch({ message })}>{label}</button>)}
                      </div>
                      <div className="field"><textarea id="gv2-message" {...fieldA11y('message')} maxLength={MESSAGE_MAX_LENGTH} placeholder={t('fields.messagePlaceholder')} value={b.message} onChange={(e) => patch({ message: e.target.value })} /></div>
                      <p className="microcopy">{t('fields.messageCounter', { count: b.message.length, max: MESSAGE_MAX_LENGTH })}</p>
                      <div className="label">{c.look}</div>
                      <div className="variants" id="gv2-template-group" role="group" aria-label={t('aria.design')} aria-invalid={fieldErrorFor('cardTemplateId') || undefined} aria-describedby={fieldErrorFor('cardTemplateId') ? 'gv2-validation-description' : undefined}>
                        {templates.map(([id, label], index) => <button key={id} type="button" className={`variant-btn${b.cardTemplateId === id ? ' active' : ''}`} aria-pressed={b.cardTemplateId === id} onClick={() => patch({ cardTemplateId: id })}>
                          <i className={`swatch${index === 1 ? ' night' : ''}${index === 2 ? ' clay' : ''}`} aria-hidden="true" />{label}</button>)}
                      </div>
                      <div className="form-fields gv2-customization">
                        <div><label className="label" htmlFor="gv2-card-occasion">{t('occasions.label')}</label><select id="gv2-card-occasion" {...fieldA11y('cardOccasion')} value={b.cardOccasion} onChange={(e) => patch({ cardOccasion: e.target.value })}>{CARD_OCCASIONS.map((id) => <option key={id} value={id}>{t(`occasions.${id}`)}</option>)}</select></div>
                        <div><label className="label" htmlFor="gv2-card-locale">{t('cardLocale.label')}</label><select id="gv2-card-locale" {...fieldA11y('cardLocale')} value={b.cardLocale} onChange={(e) => patch({ cardLocale: e.target.value })}>{['en', 'bg'].map((id) => <option key={id} value={id}>{t(`cardLocale.${id}`)}</option>)}</select></div>
                      </div>
                    </div>
                    <div className="form-section">
                      <div className="form-section-title" id="gv2-delivery-label"><span className="count">03</span><h4>{c.arrive}</h4></div>
                      <div className="delivery-grid" role="group" aria-labelledby="gv2-delivery-label" aria-invalid={fieldErrorFor('deliveryOption') || undefined} aria-describedby={fieldErrorFor('deliveryOption') ? 'gv2-validation-description' : undefined}>
                        {deliveries.map(([id, icon, title, sub]) => <button key={id} type="button" className={`delivery-option${b.deliveryOption === id ? ' active' : ''}`} aria-pressed={b.deliveryOption === id} onClick={() => delivery(id)}>
                          <span className="icon" aria-hidden="true">{icon}</span><strong>{title}</strong><small>{sub}</small></button>)}
                      </div>
                      {b.deliveryOption === 'send_to_buyer' && <p className="delivery-note">{t('delivery.sendToBuyerHint')}</p>}
                      {['recipient_now', 'scheduled', 'postal'].includes(b.deliveryOption) &&
                        <div className="field"><label className="label" htmlFor="gv2-recipient-email">{b.deliveryOption === 'postal' ? t('fields.recipientEmailOptional') : c.recipient}</label><input id="gv2-recipient-email" {...fieldA11y('recipientEmail')} type="email" maxLength={EMAIL_MAX_LENGTH} placeholder={t('fields.emailPlaceholder')} value={b.recipientEmail} onChange={(e) => patch({ recipientEmail: e.target.value })} /></div>}
                      {b.deliveryOption === 'scheduled' && <div className="field"><label className="label" htmlFor="gv2-delivery-date">{t('delivery.scheduledDate')}</label><input id="gv2-delivery-date" {...fieldA11y('deliveryDate')} type="date" min={bounds.minIso} max={bounds.maxIso} value={b.deliveryDate} onChange={(e) => patch({ deliveryDate: e.target.value })} /><p className="delivery-note">{t('delivery.scheduledDateHint')}</p></div>}
                      {b.deliveryOption === 'postal' && <div className="form-fields gv2-postal">
                        {[['addressLine1', 'postal.address1'], ['addressLine2', 'postal.address2'], ['city', 'postal.city'], ['postalCode', 'postal.postalCode'], ['country', 'postal.country']].map(([key, label]) =>
                          <div className="field" key={key}><label className="label" htmlFor={`gv2-${key}`}>{t(label)}</label><input id={`gv2-${key}`} {...fieldA11y(key)} maxLength={POSTAL_MAX_LENGTHS[key]} value={b[key]} onChange={(e) => patch({ [key]: e.target.value })} /></div>)}
                      </div>}
                      <div className="field"><label className="label" htmlFor="gv2-buyer-email">{c.buyer}</label><input id="gv2-buyer-email" {...fieldA11y('buyerEmail')} type="email" maxLength={EMAIL_MAX_LENGTH} placeholder={t('fields.emailPlaceholder')} value={b.buyerEmail} onChange={(e) => patch({ buyerEmail: e.target.value })} /></div>
                    </div>
                    {validationRequested && !validation.ok && <p id="gv2-validation-description" className="validation" role="alert">{validationText}</p>}
                    {configError && <p role="alert" className="validation">{c.configError} <button type="button" onClick={() => setConfigAttempt((n) => n + 1)}>{c.retry}</button></p>}
                    {stripeUnavailable && (
                      <div
                        role="alert"
                        data-testid="gift-voucher-stripe-unavailable"
                        className="mb-6 rounded-2xl border border-stone-300 bg-white px-5 py-4 text-sm text-stone-700"
                      >
                        <p className="font-medium text-stone-900">{t('payment.unavailableTitle')}</p>
                        <p className="mt-1">{t('payment.unavailableBody')}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-4">
                          <button
                            type="button"
                            onClick={retryStripe}
                            className="text-xs uppercase tracking-[0.2em] text-stone-800 underline underline-offset-4"
                          >
                            {t('payment.unavailableRetry')}
                          </button>
                          <a
                            href={`mailto:${CONTACT_EMAIL}`}
                            className="text-xs uppercase tracking-[0.2em] text-stone-500 underline underline-offset-4 hover:text-stone-800"
                          >
                            {t('payment.unavailableContact')}
                          </a>
                        </div>
                      </div>
                    )}
                    {stripeFailed && !stripeUnavailable && <p role="alert" className="validation">{c.stripeUnavailable}</p>}
                    {error && <p role="alert" className="validation">{error}</p>}
                    <div className="summary"><span><small>{c.voucher} · {c.valid}</small><strong>{money(value)}</strong></span>
                      {b.deliveryOption === 'postal' && <div className="summary-extra gv2-fees"><small>{t('summary.physicalFee')}: {money(fee)}</small><strong>{t('summary.total')}: {money(total)}</strong></div>}</div>
                    <label className="terms"><input type="checkbox" aria-label={t('aria.terms')} aria-invalid={fieldErrorFor('termsAccepted') || undefined} aria-describedby={fieldErrorFor('termsAccepted') ? 'gv2-validation-description' : undefined} checked={b.termsAccepted} onChange={(e) => patch({ termsAccepted: e.target.checked })} />
                      <span>{t('terms.prefix')}<Link to={localizePath('/terms', language)}>{t('terms.terms')}</Link>{t('terms.and')}<Link to={localizePath('/cancellation-policy', language)}>{t('terms.cancellation')}</Link>.</span></label>
                    <button className="btn btn-primary submit-btn" type="submit" disabled={loading}>{c.preview}<span>↗</span></button>
                    <p className="prototypenote">{c.fine}</p>
                  </fieldset>
                </form>
                {secret && quote && <div className="gv2-payment gv2-paywrap">
                  <div className="summary"><span><small>{t('summary.total')}</small><strong>{money(quote.totalDueCents)}</strong></span></div>
                  <p className="microcopy">{t('summary.reference')} · {paymentIntentId}</p>
                  {!stripeUnavailable && stripeClient && (
                    <Elements key={secret} stripe={stripeClient} options={{ clientSecret: secret, locale }}>
                      <Pay loading={loading} disabled={!validation.ok || !ready} onPay={pay} />
                    </Elements>
                  )}
                  <button type="button" className="gv2-edit" disabled={loading} onClick={resetAttempt}>{t('payment.editDetails')}</button>
                </div>}
                <a className="corporate-link" href={`mailto:jose@driftdwells.com?subject=${encodeURIComponent(reference.footer.corporate)}`}>
                  <span>{c.team}</span><strong>{c.talk}</strong>
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="promise" id="how-it-works">
          <div className="max promise-grid">
            <div><div className="caps">{reference.promise.kicker}</div><h2>{reference.promise.title}<br /><em>{reference.promise.titleEm}</em></h2>
              <p>{reference.promise.body}</p><a className="btn btn-white" href="#create">{reference.promise.cta} ↗</a></div>
            <div className="promise-list">{reference.promise.rows.map(([title, text], index) =>
              <div className="promise-row" key={title}><span>0{index + 1}.</span><div><strong>{title}</strong><p>{text}</p></div></div>)}</div>
          </div>
        </section>

        <section className="faq" id="faq">
          <div className="max faq-grid">
            <div><div className="caps">{reference.faq.kicker}</div><h2>{reference.faq.title}<br /><em>{reference.faq.titleEm}</em></h2><p className="intro">{reference.faq.intro}</p></div>
            <div>{reference.faq.items.map(([question, answer]) =>
              <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div>
          </div>
        </section>

        <div id="mobileBuy" className={`mobile-buy gv2-mobile${mobileCtaVisible ? '' : ' hidden'}`} aria-hidden={!mobileCtaVisible}>
          <span>{reference.hero.first} {reference.hero.middle} {reference.hero.last}</span>
          <button type="button" aria-controls="create" onClick={scrollToBuilder}>{reference.hero.create} ↗</button>
        </div>
        {review && <div ref={dialog} className="modal open" role="dialog" aria-modal="true" aria-labelledby="gv2-review-title" aria-label={t('aria.review')} tabIndex="-1" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy.current) setReview(false); }}>
          <div className="modal-panel">
            <button type="button" className="close-modal" aria-label={c.close} disabled={loading} onClick={() => setReview(false)}>×</button>
            <div className="caps">{c.reviewKicker}</div><h3 id="gv2-review-title">{c.reviewTitle}<br />{c.reviewTitleEm}</h3>
            <p>{t('reference.builder.previewIntro')}</p>
            <div className="modal-item"><span>{t('summary.voucherValue')}</span><strong>{money(value)}</strong></div>
            <div className="modal-item"><span>{t('fields.for')}</span><strong>{b.recipientName || '—'}</strong></div>
            <div className="modal-item"><span>{t('fields.from')}</span><strong>{b.buyerName || '—'}</strong></div>
            <div className="modal-item"><span>{t('delivery.title')}</span><strong>{t(`delivery.${{ recipient_now: 'recipientNow', send_to_buyer: 'sendToBuyer', postal: 'postal', scheduled: 'scheduled' }[b.deliveryOption]}`)}</strong></div>
            {b.deliveryOption === 'scheduled' && <div className="modal-item"><span>{t('delivery.scheduledDate')}</span><strong>{b.deliveryDate || '—'}</strong></div>}
            <div className="modal-item"><span>{t('summary.validity')}</span><strong>{c.valid}</strong></div>
            {b.deliveryOption === 'postal' && <><div className="modal-item"><span>{t('summary.physicalFee')}</span><strong>{money(fee)}</strong></div><div className="modal-item"><span>{t('summary.total')}</span><strong>{money(total)}</strong></div></>}
            {!validation.ok && <p id="gv2-modal-validation" role="alert" className="validation">{validationText}</p>}
            {configError && <p role="alert" className="validation">{c.configError} <button type="button" disabled={loading} onClick={() => setConfigAttempt((n) => n + 1)}>{c.retry}</button></p>}
            {stripeUnavailable && (
              <div role="alert" className="validation">
                <p>{t('payment.unavailableTitle')}</p>
                <p>{t('payment.unavailableBody')}</p>
                <button type="button" disabled={loading} onClick={retryStripe}>{t('payment.unavailableRetry')}</button>
                {' '}
                <a href={`mailto:${CONTACT_EMAIL}`}>{t('payment.unavailableContact')}</a>
              </div>
            )}
            {stripeFailed && !stripeUnavailable && <p role="alert" className="validation">{c.stripeUnavailable}</p>}
            {error && <p role="alert" className="validation">{error}</p>}
            {loading && <p className="gv2-sr-only" role="status" aria-live="polite">{t('payment.preparing')}</p>}
            <button type="button" className="btn btn-primary submit-btn" aria-describedby={!validation.ok ? 'gv2-modal-validation' : undefined} aria-live="polite" onClick={start} disabled={loading || !ready || !stripeClient || stripeUnavailable}>{loading ? t('payment.preparing') : t('payment.continue')} ↗</button>
            <button type="button" className="gv2-edit" disabled={loading} onClick={() => setReview(false)}>{t('payment.editDetails')}</button>
          </div>
        </div>}
      </div>
    </>
  );
}
