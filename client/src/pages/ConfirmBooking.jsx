import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { cabinAPI, cabinTypeAPI, bookingAPI } from '../services/api';
import { CONFIRM_BOOKING_SIMPLE_KEY } from '../hooks/useBookingNavigation';
import ChangeDatesModal from '../components/booking/ChangeDatesModal';
import ChangeGuestsModal from '../components/booking/ChangeGuestsModal';
import PriceDetailsModal from '../components/booking/PriceDetailsModal';
import Seo from '../components/Seo';
import { daysBetweenDateOnly, formatDateOnlyLocal, parseDateOnlyLocal } from '../utils/dateOnly';
import { getAttributionPayload } from '../tracking/attribution';
import { trackFunnelEvent } from '../tracking/funnel';
import { trackPaymentResilienceEvent } from '../tracking/paymentResilienceTelemetry';
import { getMetaClientContextPayload } from '../tracking/metaClientContext';
import { readGuestPromo, writeGuestPromo } from '../utils/guestPromo';
import { useSiteLanguage } from '../hooks/useSiteLanguage';
import { formatStayDayLong } from '../utils/localeDates';
import { isInAppBrowser } from '../utils/inAppBrowser';
import { useStripeLoader } from '../payments/useStripeLoader';
import { useStripeElementsGuard } from '../payments/useStripeElementsGuard';
import PaymentRecoveryNotice from '../payments/PaymentRecoveryNotice';
import {
  LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
  LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT,
  LEGAL_ACCEPTANCE_TERMS_VERSION
} from '../constants/legalAcceptance';
import { getListingCoverImage } from '../utils/listingGalleryUtils';
import { isCheckoutSessionV2Enabled } from '../utils/checkoutSessionV2Flags';
import {
  buildCheckoutSessionV2BoundaryKey,
  clearCheckoutSessionV2Storage,
  isSameCheckoutSessionV2Identity,
  readCheckoutSessionV2Storage,
  writeCheckoutSessionV2Storage
} from '../utils/checkoutSessionV2Storage';

const stripePk = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
const CHECKOUT_SESSION_KEY = 'confirm-booking-checkout-session';
const checkoutSessionV2Enabled = isCheckoutSessionV2Enabled();

export const V2_CHECKOUT_CONFIG_MISMATCH_MESSAGE =
  'Checkout is misconfigured (server did not return a checkout session). Please refresh or contact support.';

export const V2_CHECKOUT_RETRY_PAYMENT_MESSAGE =
  'Your payment session was refreshed. Please tap Continue to secure payment again.';

export const V2_CHECKOUT_RESTART_MESSAGE =
  'Your checkout session expired or changed. Please tap Continue to secure payment to start again.';

const V2_CHECKOUT_RESTART_ERROR_CODES = new Set([
  'CHECKOUT_SESSION_EXPIRED',
  'CHECKOUT_SESSION_SUPERSEDED',
  'COMMERCIAL_BOUNDARY_CHANGED'
]);

const V2_CHECKOUT_CLEAR_PAYMENT_KEEP_SESSION_CODES = new Set([
  'STALE_CLIENT_SECRET',
  'SUPERSEDED_PAYMENT_INTENT',
  'CANONICAL_PAYMENT_INTENT_MISMATCH'
]);

const V2_CHECKOUT_CLEAR_SECRET_KEEP_CHECKOUT_CODES = new Set([
  'CHECKOUT_SESSION_CONCURRENCY_CONFLICT',
  'VOUCHER_PAYMENT_INTENT_ATTACH_FAILED',
  'CHECKOUT_SESSION_NOT_USABLE'
]);

function createCheckoutId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `chk_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function buildCheckoutAttemptKey({ bookingEntityType, bookingEntityId, checkIn, checkOut, adults, children }) {
  const inDate = checkIn ? formatDateOnlyLocal(checkIn) : '';
  const outDate = checkOut ? formatDateOnlyLocal(checkOut) : '';
  return [bookingEntityType || '', bookingEntityId || '', inDate, outDate, adults ?? '', children ?? ''].join('|');
}

export function readLegacyCheckoutSession(attemptKey) {
  if (!attemptKey) return null;
  try {
    const raw = sessionStorage.getItem(CHECKOUT_SESSION_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (
      parsed &&
      parsed.attemptKey === attemptKey &&
      typeof parsed.checkoutId === 'string' &&
      parsed.checkoutId.trim().length > 0
    ) {
      return parsed.checkoutId.trim();
    }
  } catch {
    // ignore storage parse errors
  }
  return null;
}

export function validateV2CreatePaymentIntentResponse(data) {
  if (!data || data.flowVersion !== 'v2') {
    return { ok: false, error: V2_CHECKOUT_CONFIG_MISMATCH_MESSAGE };
  }
  const checkoutId = typeof data.checkoutId === 'string' ? data.checkoutId.trim() : '';
  if (!checkoutId) {
    return { ok: false, error: V2_CHECKOUT_CONFIG_MISMATCH_MESSAGE };
  }
  return { ok: true, checkoutId };
}

export function buildV2StorageRecordFromPaymentResponse(data, commercialBoundaryKey) {
  const noPaymentRequired = Boolean(data.noPaymentRequired);
  return {
    checkoutId: String(data.checkoutId).trim(),
    commercialBoundaryKey,
    quoteSnapshotHash: String(data.quoteSnapshotHash || '').trim(),
    sessionVersion: Number(data.sessionVersion) || 1,
    canonicalPaymentIntentId: data.canonicalPaymentIntentId || null,
    clientSecretPresent: Boolean(data.clientSecret) && !noPaymentRequired,
    voucherRedemptionId: data.voucherRedemptionId || data.redemptionId || null,
    stripeAmountCents: Number(data.stripeAmountCents) || 0,
    noPaymentRequired
  };
}

export function shouldBlockCardPaymentPrecheck(
  serverQuote,
  { noPaymentRequired, fullVoucherCoverage, checkoutSessionV2Enabled: v2Enabled = checkoutSessionV2Enabled }
) {
  if (!serverQuote) return true;
  if (v2Enabled && (noPaymentRequired || fullVoucherCoverage)) {
    return false;
  }
  return serverQuote.totalPrice < 0.5;
}

/**
 * Normalized pricing outcome from POST /bookings/quote (used for dedupe + display helpers).
 */
export function normalizeBookingQuoteOutcome(quote) {
  if (!quote || typeof quote !== 'object') return null;

  const totalPrice = Number(quote.totalPrice);
  const subtotalPrice = Number(quote.subtotalPrice);
  const discountAmount = Number(quote.discountAmount ?? 0);
  const voucherAppliedCents = Number(quote.voucherAppliedCents ?? 0);
  const remainingDueCents =
    quote.remainingDueCents != null && Number.isFinite(Number(quote.remainingDueCents))
      ? Number(quote.remainingDueCents)
      : Math.round((Number.isFinite(totalPrice) ? totalPrice : 0) * 100);

  return {
    subtotalPrice: Number.isFinite(subtotalPrice) ? subtotalPrice : null,
    discountAmount: Number.isFinite(discountAmount) ? discountAmount : 0,
    totalPrice: Number.isFinite(totalPrice) ? totalPrice : null,
    promoApplied: Boolean(quote.promo?.applied),
    promoInvalidReason: quote.promo?.invalidReason || null,
    voucherAppliedCents: Number.isFinite(voucherAppliedCents) ? voucherAppliedCents : 0,
    remainingDueCents,
    fullVoucherCoverage: Boolean(quote.fullVoucherCoverage),
    voucherMessage: quote.voucherMessage || null
  };
}

export function isSameBookingQuoteOutcome(prev, next) {
  if (prev === next) return true;
  if (!prev || !next) return false;

  const a = normalizeBookingQuoteOutcome(prev);
  const b = normalizeBookingQuoteOutcome(next);
  if (!a || !b) return false;

  return (
    a.subtotalPrice === b.subtotalPrice &&
    a.discountAmount === b.discountAmount &&
    a.totalPrice === b.totalPrice &&
    a.promoApplied === b.promoApplied &&
    a.promoInvalidReason === b.promoInvalidReason &&
    a.voucherAppliedCents === b.voucherAppliedCents &&
    a.remainingDueCents === b.remainingDueCents &&
    a.fullVoucherCoverage === b.fullVoucherCoverage &&
    a.voucherMessage === b.voucherMessage
  );
}

export function mergeServerQuoteUpdate(prev, next) {
  if (!next) return next;
  if (prev && isSameBookingQuoteOutcome(prev, next)) return prev;
  return next;
}

export function resolveAmountDueTodayCents(serverQuote, fallbackTotalEuros = 0) {
  if (!serverQuote) {
    return Math.max(0, Math.round(Number(fallbackTotalEuros || 0) * 100));
  }
  if (serverQuote.remainingDueCents != null && Number.isFinite(Number(serverQuote.remainingDueCents))) {
    return Math.max(0, Number(serverQuote.remainingDueCents));
  }
  const total = Number(serverQuote.totalPrice ?? fallbackTotalEuros ?? 0);
  return Math.max(0, Math.round((Number.isFinite(total) ? total : 0) * 100));
}

export function extractCheckoutApiErrorCode(err) {
  return err?.response?.data?.code || err?.response?.data?.error?.code || err?.code || null;
}

export function classifyV2CheckoutInitError(code) {
  if (!code) {
    return { kind: 'unknown' };
  }
  if (V2_CHECKOUT_RESTART_ERROR_CODES.has(code)) {
    return { kind: 'restart' };
  }
  if (V2_CHECKOUT_CLEAR_PAYMENT_KEEP_SESSION_CODES.has(code)) {
    return { kind: 'clearPaymentKeepCheckout' };
  }
  if (V2_CHECKOUT_CLEAR_SECRET_KEEP_CHECKOUT_CODES.has(code)) {
    return { kind: 'clearSecretKeepCheckout' };
  }
  return { kind: 'unknown' };
}

export function getV2CheckoutInitErrorHandling(code) {
  const { kind } = classifyV2CheckoutInitError(code);
  if (kind === 'restart') {
    return {
      kind,
      message: V2_CHECKOUT_RESTART_MESSAGE,
      clearAll: true,
      clearPaymentIdentity: true,
      clearClientSecret: true
    };
  }
  if (kind === 'clearPaymentKeepCheckout') {
    return {
      kind,
      message: V2_CHECKOUT_RETRY_PAYMENT_MESSAGE,
      clearAll: false,
      clearPaymentIdentity: true,
      clearClientSecret: true
    };
  }
  if (kind === 'clearSecretKeepCheckout') {
    return {
      kind,
      message: V2_CHECKOUT_RETRY_PAYMENT_MESSAGE,
      clearAll: false,
      clearPaymentIdentity: false,
      clearClientSecret: true
    };
  }
  return {
    kind: 'unknown',
    message: null,
    clearAll: false,
    clearPaymentIdentity: false,
    clearClientSecret: false
  };
}

export function buildV2CheckoutIdentity({ checkoutId, canonicalPaymentIntentId, quoteSnapshotHash }) {
  return {
    checkoutId: typeof checkoutId === 'string' ? checkoutId.trim() : '',
    canonicalPaymentIntentId: canonicalPaymentIntentId || null,
    quoteSnapshotHash: typeof quoteSnapshotHash === 'string' ? quoteSnapshotHash.trim() : ''
  };
}

export function buildV2PaymentElementKey({ checkoutId, canonicalPaymentIntentId, quoteSnapshotHash }) {
  const id = typeof checkoutId === 'string' ? checkoutId.trim() : '';
  if (!id) {
    return null;
  }
  const pi = canonicalPaymentIntentId || '';
  const hash = typeof quoteSnapshotHash === 'string' ? quoteSnapshotHash.trim() : '';
  return `${id}:${pi}:${hash}`;
}

export function shouldReuseV2ClientSecret({
  currentIdentity,
  nextIdentity,
  idempotentReplay,
  clientSecret
}) {
  if (!clientSecret || !idempotentReplay) {
    return false;
  }
  return isSameCheckoutSessionV2Identity(currentIdentity, nextIdentity);
}

export const V2_REDIRECT_PI_MISMATCH_MESSAGE =
  'Payment session changed. Please try payment again.';

export function shouldHandleRedirectAsV2({
  checkoutSessionV2Enabled: v2Enabled = checkoutSessionV2Enabled,
  paymentIntentId,
  redirectStatus
}) {
  return Boolean(v2Enabled && paymentIntentId && redirectStatus === 'succeeded');
}

export function buildV2PendingCheckoutPayload(base, v2Fields) {
  return {
    ...base,
    flowVersion: 'v2',
    checkoutId: v2Fields.checkoutId,
    canonicalPaymentIntentId: v2Fields.canonicalPaymentIntentId || null,
    quoteSnapshotHash: v2Fields.quoteSnapshotHash || '',
    noPaymentRequired: Boolean(v2Fields.noPaymentRequired),
    voucherRedemptionId: v2Fields.voucherRedemptionId || undefined
  };
}

export function validateV2RedirectPaymentIntent({ pending, urlPaymentIntentId }) {
  if (!pending || pending.flowVersion !== 'v2') {
    return { ok: false, reason: 'not_v2_pending' };
  }
  if (pending.noPaymentRequired) {
    return { ok: false, reason: 'no_payment_required' };
  }
  const pendingCheckoutId = typeof pending.checkoutId === 'string' ? pending.checkoutId.trim() : '';
  const canonical =
    typeof pending.canonicalPaymentIntentId === 'string'
      ? pending.canonicalPaymentIntentId.trim()
      : '';
  const urlPi = typeof urlPaymentIntentId === 'string' ? urlPaymentIntentId.trim() : '';
  if (!pendingCheckoutId) {
    return { ok: false, reason: 'missing_checkout_id' };
  }
  if (!canonical) {
    return { ok: false, reason: 'missing_canonical_pi' };
  }
  if (!urlPi || urlPi !== canonical) {
    return { ok: false, reason: 'pi_mismatch' };
  }
  return {
    ok: true,
    reason: null,
    checkoutId: pendingCheckoutId,
    paymentIntentId: urlPi
  };
}

export function buildRedirectBookingPayloadFromPending(
  pending,
  paymentIntentId,
  { routeId, language, attribution, metaClientContext }
) {
  const fd = pending.formData || {};
  const bookingData = {
    checkIn: pending.checkIn,
    checkOut: pending.checkOut,
    adults: pending.adults ?? 2,
    children: pending.children ?? 0,
    paymentIntentId,
    experienceKeys: (pending.experiences || []).map((e) => e.key).filter(Boolean),
    guestInfo: {
      firstName: fd.firstName || '',
      lastName: fd.lastName || '',
      email: fd.email || '',
      phone: fd.phone || ''
    },
    specialRequests: fd.specialRequests || '',
    legalAcceptance: {
      acceptedTermsAndCancellation: !!fd.agreedToTerms,
      acceptedActivityRisk: !!fd.agreedToActivityRisk,
      termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
      activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
      checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
      checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT,
      locale: language || undefined
    },
    metaClientContext: metaClientContext || undefined,
    checkoutId: pending.checkoutId,
    voucherRedemptionId: pending.voucherRedemptionId || undefined,
    ...(pending.voucherCode ? { voucherCode: pending.voucherCode } : {}),
    ...(pending.promoCode ? { promoCode: pending.promoCode } : {}),
    ...(attribution && Object.values(attribution).some(Boolean) ? { attribution } : {})
  };
  if ((pending.bookingEntityType || 'cabin') === 'cabinType') {
    bookingData.cabinTypeId = pending.bookingEntityId || pending.cabinId;
  } else {
    bookingData.cabinId = pending.bookingEntityId || pending.cabinId || routeId;
  }
  return bookingData;
}

export function resolveV2ClientSecretAfterPaymentIntent({
  currentIdentity,
  responseData,
  checkoutId,
  existingClientSecret
}) {
  const nextIdentity = buildV2CheckoutIdentity({
    checkoutId,
    canonicalPaymentIntentId: responseData.canonicalPaymentIntentId,
    quoteSnapshotHash: responseData.quoteSnapshotHash
  });
  const reuse = shouldReuseV2ClientSecret({
    currentIdentity,
    nextIdentity,
    idempotentReplay: Boolean(responseData.idempotentReplay),
    clientSecret: existingClientSecret
  });
  if (reuse) {
    return {
      clientSecret: existingClientSecret,
      nextIdentity,
      reused: true
    };
  }
  return {
    clientSecret: responseData.clientSecret || null,
    nextIdentity,
    reused: false
  };
}

export function restoreV2SessionFieldsFromStorage(stored) {
  if (!stored) {
    return {
      checkoutId: null,
      canonicalPaymentIntentId: null,
      quoteSnapshotHash: '',
      sessionVersion: 1,
      voucherRedemptionId: null,
      stripeAmountCents: 0,
      noPaymentRequired: false
    };
  }
  return {
    checkoutId: stored.checkoutId,
    canonicalPaymentIntentId: stored.canonicalPaymentIntentId,
    quoteSnapshotHash: stored.quoteSnapshotHash || '',
    sessionVersion: stored.sessionVersion || 1,
    voucherRedemptionId: stored.voucherRedemptionId,
    stripeAmountCents: stored.stripeAmountCents || 0,
    noPaymentRequired: Boolean(stored.noPaymentRequired)
  };
}

export const V2_NO_PAYMENT_MISSING_CHECKOUT_MESSAGE =
  'Checkout session is missing. Please refresh payment and try again.';

export function shouldAllowV2NoPaymentSubmit({
  checkoutSessionV2Enabled: v2Enabled = checkoutSessionV2Enabled,
  noPaymentRequired,
  checkoutId
}) {
  if (!v2Enabled || !noPaymentRequired) {
    return { allowed: false, reason: 'not_v2_no_payment' };
  }
  const id = typeof checkoutId === 'string' ? checkoutId.trim() : '';
  if (!id) {
    return { allowed: false, reason: 'missing_checkout_id' };
  }
  return { allowed: true, reason: null, checkoutId: id };
}

export function buildCreateBookingPayload({
  bookingEntityType,
  bookingEntityId,
  checkIn,
  checkOut,
  adults,
  children,
  selectedExpKeys,
  formData,
  checkoutId,
  voucherRedemptionId,
  lockedPromoCode,
  appliedVoucherCode,
  language,
  paymentIntentId = null,
  attribution = null,
  metaClientContext = null
}) {
  const bookingData = {
    checkIn: formatDateOnlyLocal(checkIn),
    checkOut: formatDateOnlyLocal(checkOut),
    adults,
    children,
    experienceKeys: Array.from(selectedExpKeys),
    guestInfo: {
      firstName: formData.firstName.trim(),
      lastName: formData.lastName.trim(),
      email: formData.email.trim(),
      phone: formData.phone.trim()
    },
    specialRequests: formData.specialRequests.trim(),
    legalAcceptance: {
      acceptedTermsAndCancellation: !!formData.agreedToTerms,
      acceptedActivityRisk: !!formData.agreedToActivityRisk,
      termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
      activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
      checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
      checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT,
      locale: language || undefined
    },
    checkoutId,
    voucherRedemptionId: voucherRedemptionId || undefined,
    metaClientContext: metaClientContext || undefined,
    ...(attribution && Object.values(attribution).some(Boolean) ? { attribution } : {})
  };
  if (bookingEntityType === 'cabinType') {
    bookingData.cabinTypeId = bookingEntityId;
  } else {
    bookingData.cabinId = bookingEntityId;
  }
  if (paymentIntentId) {
    bookingData.paymentIntentId = paymentIntentId;
  }
  if (lockedPromoCode) {
    bookingData.promoCode = lockedPromoCode;
  }
  if (appliedVoucherCode) {
    bookingData.voucherCode = appliedVoucherCode;
  }
  return bookingData;
}

export function clearCheckoutStorageAfterSuccessfulBooking({
  checkoutSessionV2Enabled: v2Enabled = checkoutSessionV2Enabled
} = {}) {
  try {
    sessionStorage.removeItem(CONFIRM_BOOKING_SIMPLE_KEY);
    sessionStorage.removeItem('confirm-booking-pending');
    sessionStorage.removeItem(CHECKOUT_SESSION_KEY);
    if (v2Enabled) {
      clearCheckoutSessionV2Storage();
    }
  } catch {
    // ignore storage failures
  }
}

export function mapCreateBookingErrorMessage(err, fallback) {
  const code = extractCheckoutApiErrorCode(err);
  const v2Handling = getV2CheckoutInitErrorHandling(code);
  if (v2Handling.message) {
    return v2Handling.message;
  }
  if (code === 'PAYMENT_INTENT_ALREADY_USED') {
    return 'This payment has already been processed. We couldn\'t create another booking from the same payment. If you were charged, please check your booking confirmation email or contact support with your payment reference.';
  }
  if (code === 'CHECKOUT_ID_CONFLICT') {
    return 'We already received this booking attempt. Please refresh to view the latest result.';
  }
  return err?.response?.data?.message || err?.message || fallback;
}

const DEFAULT_EXPERIENCES = [
  { key: 'atv_pickup', name: 'ATV pickup', price: 70, unit: 'flat_per_stay' },
  { key: 'horse_riding', name: 'Horse riding', price: 70, unit: 'per_guest' },
  { key: 'jeep_transfer', name: 'Jeep transfer', price: 60, unit: 'flat_per_stay' }
];

function normalizeSrc(u) {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('/')) return u;
  return `/uploads/cabins/${u}`;
}

function PaymentFormInner({
  onSubmit,
  loading,
  precheckDisabled = false,
  precheckMessages = [],
  onPaymentElementReady,
  onPaymentElementLoadError,
  suppressStripeLoadingHint = false
}) {
  const { t } = useTranslation('booking');
  const stripe = useStripe();
  const elements = useElements();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    await onSubmit(stripe, elements);
  };

  const submitDisabled = !stripe || loading || precheckDisabled;
  const disabledReasons = useMemo(() => {
    const m = [...precheckMessages];
    if (!stripe && !suppressStripeLoadingHint) {
      m.push(t('confirm.payment.formNotReady'));
    }
    return m;
  }, [precheckMessages, stripe, suppressStripeLoadingHint, t]);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement
        onReady={() => onPaymentElementReady?.()}
        onLoadError={(event) => {
          onPaymentElementLoadError?.(event);
        }}
      />
      <button
        type="submit"
        disabled={submitDisabled}
        className="w-full h-12 rounded-xl bg-[#81887A] text-white font-semibold hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? t('confirm.processingPayment') : t('cta.confirmAndPay')}
      </button>
      {submitDisabled && !loading ? (
        <div className="space-y-1 text-sm text-gray-700" role="status" aria-live="polite">
          {disabledReasons.map((msg, i) => (
            <p key={i}>{msg}</p>
          ))}
        </div>
      ) : null}
    </form>
  );
}

const ConfirmBooking = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useTranslation('booking');
  const { language } = useSiteLanguage();
  const formatDate = useCallback((dateInput) => {
    if (!dateInput) return '';
    const d = dateInput instanceof Date ? dateInput : parseDateOnlyLocal(dateInput);
    if (!d || isNaN(d.getTime())) return '';
    return formatStayDayLong(d, language);
  }, [language]);

  const [cabin, setCabin] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [error, setError] = useState(null);

  // From location.state (passed from CabinDetails) or sessionStorage (on refresh)
  const passedState = location.state || {};
  const getInitialState = () => {
    if (passedState.formData?.firstName || passedState.searchCriteria?.checkIn) {
      return passedState;
    }
    try {
      const stored = sessionStorage.getItem(CONFIRM_BOOKING_SIMPLE_KEY);
      const pending = sessionStorage.getItem('confirm-booking-pending');
      const params = new URLSearchParams(window.location.search);
      if (params.get('payment_intent')) {
        if (!pending) return passedState;
        return JSON.parse(pending);
      }
      if (!stored) return passedState;
      const data = JSON.parse(stored);
      if (data.confirmPath && data.confirmPath !== window.location.pathname) return passedState;
      if (!data.confirmPath && id && data.cabinId !== id) return passedState;
      return data;
    } catch (e) {
      return passedState;
    }
  };
  const initialState = getInitialState();

  const promoSeed = (() => {
    try {
      const u = new URLSearchParams(window.location.search).get('promoCode');
      if (u?.trim()) return u.trim().toUpperCase();
    } catch {
      /* ignore */
    }
    const s = initialState.promoCode;
    if (s && String(s).trim()) return String(s).trim().toUpperCase();
    const g = readGuestPromo();
    return g?.trim().toUpperCase() || null;
  })();

  const bookingEntityType = initialState.bookingEntityType || 'cabin';
  const bookingEntityId = initialState.bookingEntityId || initialState.cabinId || id || null;
  const bookingEntitySlug = initialState.bookingEntitySlug || null;
  const confirmPath = initialState.confirmPath || window.location.pathname;

  const [formData, setFormData] = useState(() => initialState.formData || {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    specialRequests: '',
    agreedToTerms: initialState.legalAcceptance?.agreedToTerms || false,
    agreedToActivityRisk: initialState.legalAcceptance?.agreedToActivityRisk || false
  });

  const [checkIn, setCheckIn] = useState(() => {
    const s = initialState.searchCriteria?.checkIn || searchParams.get('checkIn');
    return parseDateOnlyLocal(s);
  });
  const [checkOut, setCheckOut] = useState(() => {
    const s = initialState.searchCriteria?.checkOut || searchParams.get('checkOut');
    return parseDateOnlyLocal(s);
  });
  const [adults, setAdults] = useState(() =>
    initialState.searchCriteria?.adults ?? (parseInt(searchParams.get('adults'), 10) || 2)
  );
  const [children, setChildren] = useState(() =>
    initialState.searchCriteria?.children ?? (parseInt(searchParams.get('children'), 10) || 0)
  );
  const [babies, setBabies] = useState(initialState.searchCriteria?.babies ?? 0);
  const [pets, setPets] = useState(initialState.searchCriteria?.pets ?? 0);
  const [selectedExpKeys] = useState(() => new Set(initialState.selectedExpKeys || []));
  const [experiences] = useState(() => initialState.experiences || DEFAULT_EXPERIENCES);

  const [datesModalOpen, setDatesModalOpen] = useState(false);
  const [guestsModalOpen, setGuestsModalOpen] = useState(false);
  const [priceModalOpen, setPriceModalOpen] = useState(false);
  const [clientSecret, setClientSecret] = useState(null);
  const [stripeError, setStripeError] = useState(null);
  const [stripeEnabled, setStripeEnabled] = useState(false);

  const [serverQuote, setServerQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState(null);
  const [lockedPromoCode, setLockedPromoCode] = useState(promoSeed);
  const [promoDraft, setPromoDraft] = useState(promoSeed || '');
  const [promoMessage, setPromoMessage] = useState(null);
  const [checkoutId, setCheckoutId] = useState(() => (
    checkoutSessionV2Enabled ? null : createCheckoutId()
  ));
  const [canonicalPaymentIntentId, setCanonicalPaymentIntentId] = useState(null);
  const [quoteSnapshotHash, setQuoteSnapshotHash] = useState('');
  const [sessionVersion, setSessionVersion] = useState(1);
  const [noPaymentRequired, setNoPaymentRequired] = useState(false);
  const [voucherDraft, setVoucherDraft] = useState('');
  const [appliedVoucherCode, setAppliedVoucherCode] = useState('');
  const [checkoutInitLoading, setCheckoutInitLoading] = useState(false);
  const [checkoutInitError, setCheckoutInitError] = useState(null);
  const [voucherRedemptionId, setVoucherRedemptionId] = useState(null);
  const [fullVoucherCoverage, setFullVoucherCoverage] = useState(false);
  const [voucherAppliedCents, setVoucherAppliedCents] = useState(0);
  const [stripeAmountCents, setStripeAmountCents] = useState(0);

  const {
    status: stripeLoadStatus,
    stripePromise,
    retry: retryStripeJs
  } = useStripeLoader(stripePk);

  const handleFormChange = useCallback((field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }, []);

  const maxGuests = cabin?.capacity ?? 4;
  const allowPets = cabin?.allowPets ?? false;

  const pricing = useMemo(() => {
    if (!cabin || !checkIn || !checkOut || !cabin.pricePerNight) return null;
    try {
      const totalNights = daysBetweenDateOnly(checkIn, checkOut);
      if (totalNights < 1) return null;
      const totalGuests = adults + children;
      let totalPrice = totalNights * cabin.pricePerNight;
      if ((cabin.pricingModel || 'per_night') === 'per_person') {
        totalPrice *= Math.max(totalGuests, 1);
      }
      return { totalNights, totalPrice, pricePerNight: cabin.pricePerNight };
    } catch {
      return null;
    }
  }, [cabin, checkIn, checkOut, adults, children]);

  const experienceTotal = useMemo(() => {
    const guests = adults + children;
    return experiences.reduce((sum, exp) => {
      if (!selectedExpKeys.has(exp.key)) return sum;
      const qty = exp.unit === 'per_guest' ? Math.max(guests, 1) : 1;
      return sum + (exp.price || 0) * qty;
    }, 0);
  }, [experiences, selectedExpKeys, adults, children]);
  const grandTotal = (pricing?.totalPrice ?? 0) + experienceTotal;
  const experienceKeysSorted = useMemo(
    () => Array.from(selectedExpKeys).sort(),
    [selectedExpKeys]
  );

  const displayTotal = serverQuote?.totalPrice ?? grandTotal;
  const displaySubtotal = serverQuote?.subtotalPrice;
  const displayDiscount = serverQuote?.discountAmount ?? 0;
  const previewVoucherAppliedCents = Number(serverQuote?.voucherAppliedCents || 0);
  const amountDueTodayCents = resolveAmountDueTodayCents(serverQuote, displayTotal);
  const previewFullVoucherCoverage = Boolean(serverQuote?.fullVoucherCoverage);

  const experienceExtras = useMemo(() => {
    const guests = adults + children;
    return experiences
      .filter((e) => selectedExpKeys.has(e.key))
      .map((e) => ({
        label: t(`confirm.experience.${e.key}`, { defaultValue: e.name }),
        amount: (e.unit === 'per_guest' ? Math.max(guests, 1) : 1) * (e.price || 0)
      }));
  }, [experiences, selectedExpKeys, adults, children, t]);

  const guestSummary = useMemo(() => {
    const parts = [];
    if (adults) parts.push(t('success.adultsCount', { count: adults }));
    if (children) parts.push(t('success.childrenCount', { count: children }));
    if (babies) parts.push(t('confirm.infantsCount', { count: babies }));
    if (pets) parts.push(t('petsSummary', { count: pets }));
    return parts.length ? parts.join(', ') : t('guests.addGuests');
  }, [adults, children, babies, pets, t]);

  const checkoutSessionV2BoundaryKey = useMemo(() => buildCheckoutSessionV2BoundaryKey({
    entityType: bookingEntityType,
    entityId: bookingEntityId,
    checkIn,
    checkOut
  }), [bookingEntityType, bookingEntityId, checkIn, checkOut]);

  useEffect(() => {
    if (checkoutSessionV2Enabled) {
      setClientSecret(null);
      return;
    }
    setClientSecret(null);
    setVoucherRedemptionId(null);
    setFullVoucherCoverage(false);
    setVoucherAppliedCents(0);
    setStripeAmountCents(0);
  }, [checkIn, checkOut, adults, children, experienceKeysSorted, bookingEntityId, bookingEntityType, lockedPromoCode, appliedVoucherCode]);

  useEffect(() => {
    if (!checkoutSessionV2Enabled) return;
    const stored = readCheckoutSessionV2Storage(checkoutSessionV2BoundaryKey);
    const restored = restoreV2SessionFieldsFromStorage(stored);
    setCheckoutId(restored.checkoutId);
    setCanonicalPaymentIntentId(restored.canonicalPaymentIntentId);
    setQuoteSnapshotHash(restored.quoteSnapshotHash);
    setSessionVersion(restored.sessionVersion);
    setVoucherRedemptionId(restored.voucherRedemptionId);
    setStripeAmountCents(restored.stripeAmountCents);
    setNoPaymentRequired(restored.noPaymentRequired);
    setClientSecret(null);
    if (!stored) {
      setFullVoucherCoverage(false);
      setVoucherAppliedCents(0);
    }
  }, [checkoutSessionV2BoundaryKey]);

  const checkoutAttemptKey = useMemo(() => buildCheckoutAttemptKey({
    bookingEntityType,
    bookingEntityId,
    checkIn,
    checkOut,
    adults,
    children
  }), [bookingEntityType, bookingEntityId, checkIn, checkOut, adults, children]);

  useEffect(() => {
    if (checkoutSessionV2Enabled || !checkoutAttemptKey) return;
    let nextCheckoutId = readLegacyCheckoutSession(checkoutAttemptKey);
    if (!nextCheckoutId) {
      nextCheckoutId = createCheckoutId();
      try {
        sessionStorage.setItem(CHECKOUT_SESSION_KEY, JSON.stringify({
          attemptKey: checkoutAttemptKey,
          checkoutId: nextCheckoutId
        }));
      } catch {
        // ignore storage failures
      }
    }
    if (nextCheckoutId !== checkoutId) {
      setCheckoutId(nextCheckoutId);
    }
  }, [checkoutAttemptKey, checkoutId]);

  useEffect(() => {
    if (!bookingEntityId || !checkIn || !checkOut || !cabin) return;
    let cancelled = false;
    (async () => {
      setQuoteLoading(true);
      setQuoteError(null);
      try {
        const payload = {
          checkIn: formatDateOnlyLocal(checkIn),
          checkOut: formatDateOnlyLocal(checkOut),
          adults,
          children,
          experienceKeys: experienceKeysSorted
        };
        if (bookingEntityType === 'cabinType') {
          payload.cabinTypeId = bookingEntityId;
        } else {
          payload.cabinId = bookingEntityId;
        }
        if (lockedPromoCode) {
          payload.promoCode = lockedPromoCode;
        }
        if (appliedVoucherCode) {
          payload.voucherCode = appliedVoucherCode;
        }
        const res = await bookingAPI.quote(payload);
        if (cancelled) return;
        if (res.data.success) {
          const d = res.data.data;
          setServerQuote((prev) => mergeServerQuoteUpdate(prev, d));
          if (lockedPromoCode && d.promo?.invalidReason) {
            setPromoMessage(d.promo.invalidReason);
            setLockedPromoCode(null);
            setPromoDraft('');
            writeGuestPromo('');
          } else if (lockedPromoCode && d.promo?.applied) {
            setPromoMessage(null);
          } else if (!lockedPromoCode) {
            setPromoMessage(null);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setQuoteError(e.response?.data?.message || t('confirm.couldNotLoadPrice'));
          setServerQuote(null);
        }
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    bookingEntityId,
    bookingEntityType,
    checkIn,
    checkOut,
    adults,
    children,
    experienceKeysSorted,
    lockedPromoCode,
    appliedVoucherCode,
    cabin
  ]);

  const handleApplyPromo = useCallback(() => {
    setClientSecret(null);
    const trimmed = promoDraft.trim();
    if (!trimmed) {
      setLockedPromoCode(null);
      setPromoMessage(null);
      writeGuestPromo('');
      return;
    }
    const u = trimmed.toUpperCase();
    setLockedPromoCode(u);
    setPromoMessage(null);
    writeGuestPromo(u);
  }, [promoDraft]);

  useEffect(() => {
    const loadStay = async () => {
      try {
        if (bookingEntityType === 'cabinType') {
          if (!bookingEntitySlug) {
            throw new Error('Missing cabin type slug');
          }
          const res = await cabinTypeAPI.getBySlug(bookingEntitySlug);
          if (res.data.success) {
            setCabin(res.data.data.cabinType);
            return;
          }
          throw new Error('Failed to load stay');
        }

        if (!bookingEntityId) {
          throw new Error('Missing cabin id');
        }

        const res = await cabinAPI.getById(bookingEntityId);
        if (res.data.success) {
          setCabin(res.data.data.cabin);
          return;
        }
        throw new Error('Failed to load cabin');
      } catch (err) {
        setError(err.message || t('confirm.failedToLoadStay'));
      } finally {
        setLoading(false);
      }
    };

    loadStay();
  }, [bookingEntityId, bookingEntitySlug, bookingEntityType, t]);

  useEffect(() => {
    if (!bookingEntityId || !checkIn || !checkOut) return;
    const payload = {
      checkInDateOnly: formatDateOnlyLocal(checkIn),
      checkOutDateOnly: formatDateOnlyLocal(checkOut),
      adults,
      children
    };
    if (bookingEntityType === 'cabinType') {
      payload.cabinTypeId = bookingEntityId;
    } else {
      payload.cabinId = bookingEntityId;
    }
    trackFunnelEvent('confirm_page_view', payload);
  }, [bookingEntityId, bookingEntityType, checkIn, checkOut, adults, children]);

  useEffect(() => {
    bookingAPI.getConfig()
      .then((res) => {
        if (res.data?.success && res.data?.data?.stripeEnabled === true) {
          setStripeEnabled(true);
        }
      })
      .catch(() => { /* keep stripeEnabled false */ });
  }, []);

  // Sync URL when we have dates but URL lacks them (e.g. after restore from sessionStorage)
  useEffect(() => {
    if (!checkIn || !checkOut) return;
    const current = searchParams.get('checkIn');
    const expected = formatDateOnlyLocal(checkIn);
    if (current === expected) return;
    const params = new URLSearchParams(searchParams);
    params.set('checkIn', expected);
    params.set('checkOut', formatDateOnlyLocal(checkOut));
    params.set('adults', String(adults));
    params.set('children', String(children));
    setSearchParams(params, { replace: true });
  }, [checkIn, checkOut, adults, children, searchParams]);

  const handleApplyVoucher = useCallback(() => {
    const trimmed = voucherDraft.trim().toUpperCase();
    setClientSecret(null);
    setVoucherRedemptionId(null);
    setFullVoucherCoverage(false);
    if (!trimmed) {
      setAppliedVoucherCode('');
      return;
    }
    setAppliedVoucherCode(trimmed);
  }, [voucherDraft]);

  const handleRemoveVoucher = useCallback(() => {
    setVoucherDraft('');
    setAppliedVoucherCode('');
    setClientSecret(null);
    setVoucherRedemptionId(null);
    setFullVoucherCoverage(false);
    setVoucherAppliedCents(0);
    setStripeAmountCents(0);
    setCheckoutInitError(null);
  }, []);

  const clearV2CheckoutPaymentState = useCallback(() => {
    clearCheckoutSessionV2Storage();
    setCheckoutId(null);
    setCanonicalPaymentIntentId(null);
    setQuoteSnapshotHash('');
    setSessionVersion(1);
    setVoucherRedemptionId(null);
    setFullVoucherCoverage(false);
    setNoPaymentRequired(false);
    setClientSecret(null);
    setStripeAmountCents(0);
    setVoucherAppliedCents(0);
  }, []);

  const clearV2PaymentIdentityState = useCallback(() => {
    setCanonicalPaymentIntentId(null);
    setQuoteSnapshotHash('');
    setClientSecret(null);
  }, []);

  const persistV2StoragePaymentCleared = useCallback((keepCheckoutId, extras = {}) => {
    if (!keepCheckoutId) {
      return;
    }
    writeCheckoutSessionV2Storage({
      checkoutId: keepCheckoutId,
      commercialBoundaryKey: checkoutSessionV2BoundaryKey,
      quoteSnapshotHash: '',
      sessionVersion: extras.sessionVersion ?? 1,
      canonicalPaymentIntentId: null,
      clientSecretPresent: false,
      voucherRedemptionId: extras.voucherRedemptionId ?? null,
      stripeAmountCents: extras.stripeAmountCents ?? 0,
      noPaymentRequired: Boolean(extras.noPaymentRequired)
    });
  }, [checkoutSessionV2BoundaryKey]);

  const finalizeRedirectBooking = useCallback((pending, paymentIntentIdForBooking) => {
    const fd = pending.formData || {};
    const attr = getAttributionPayload();
    const bookingData = buildRedirectBookingPayloadFromPending(pending, paymentIntentIdForBooking, {
      routeId: id,
      language,
      attribution: attr,
      metaClientContext: getMetaClientContextPayload()
    });
    setSubmitLoading(true);
    return bookingAPI.create(bookingData)
      .then((res) => {
        if (res.data.success && res.data.data?.booking?._id) {
          const bid = res.data.data.booking._id;
          const em = (fd.email || '').trim().toLowerCase();
          if (em) {
            try {
              sessionStorage.setItem(`dd_booking_guest_${bid}`, em);
            } catch (e) { /* ignore */ }
          }
          navigate(`/booking-success/${bid}`, { replace: true, state: { guestEmail: em } });
        } else {
          setError(t('confirm.bookingCompletedNoConfirmation'));
        }
      })
      .catch((err) => {
        if (err.response?.status === 409 && err.response?.data?.refundInitiated && err.response?.data?.paymentIntentId) {
          const d = err.response.data;
          const refundParams = new URLSearchParams();
          refundParams.set('payment_intent', d.paymentIntentId);
          if (d.guestEmail) refundParams.set('email', d.guestEmail);
          if (d.checkIn) refundParams.set('checkIn', d.checkIn);
          if (d.checkOut) refundParams.set('checkOut', d.checkOut);
          if (d.adults != null) refundParams.set('adults', String(d.adults));
          if (d.children != null) refundParams.set('children', String(d.children));
          navigate(`/booking-refund?${refundParams.toString()}`, { replace: true });
        } else {
          setError(mapCreateBookingErrorMessage(err, t('confirm.bookingFailed')));
        }
      })
      .finally(() => setSubmitLoading(false));
  }, [id, language, navigate, t]);

  const handleV2RedirectValidationFailure = useCallback((reason, pending) => {
    if (reason === 'not_v2_pending') {
      clearV2CheckoutPaymentState();
      setError(V2_CHECKOUT_CONFIG_MISMATCH_MESSAGE);
      return;
    }
    clearV2PaymentIdentityState();
    const keepCheckoutId =
      typeof pending?.checkoutId === 'string' ? pending.checkoutId.trim() : '';
    if (keepCheckoutId) {
      setCheckoutId(keepCheckoutId);
      persistV2StoragePaymentCleared(keepCheckoutId, {
        voucherRedemptionId: pending?.voucherRedemptionId ?? null,
        stripeAmountCents: 0,
        noPaymentRequired: false
      });
    }
    if (reason === 'no_payment_required') {
      setError(V2_CHECKOUT_RETRY_PAYMENT_MESSAGE);
      return;
    }
    setError(V2_REDIRECT_PI_MISMATCH_MESSAGE);
  }, [
    clearV2CheckoutPaymentState,
    clearV2PaymentIdentityState,
    persistV2StoragePaymentCleared
  ]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentIntentId = params.get('payment_intent');
    const redirectStatus = params.get('redirect_status');
    if (!paymentIntentId) {
      return;
    }

    const clearUrlParams = () => {
      window.history.replaceState({}, '', window.location.pathname);
    };

    if (checkoutSessionV2Enabled) {
      if (redirectStatus !== 'succeeded') {
        try {
          const stored = sessionStorage.getItem('confirm-booking-pending');
          if (stored) {
            const pending = JSON.parse(stored);
            if (pending?.flowVersion === 'v2') {
              sessionStorage.removeItem('confirm-booking-pending');
            }
          }
        } catch {
          sessionStorage.removeItem('confirm-booking-pending');
        }
        if (redirectStatus === 'failed') {
          setError(t('confirm.paymentFailed'));
        }
        clearUrlParams();
        return;
      }

      const stored = sessionStorage.getItem('confirm-booking-pending');
      if (!stored) {
        clearUrlParams();
        return;
      }

      try {
        const data = JSON.parse(stored);
        sessionStorage.removeItem('confirm-booking-pending');
        const validation = validateV2RedirectPaymentIntent({
          pending: data,
          urlPaymentIntentId: paymentIntentId
        });
        if (!validation.ok) {
          handleV2RedirectValidationFailure(validation.reason, data);
          clearUrlParams();
          return;
        }
        const pendingForBooking = {
          ...data,
          checkoutId: validation.checkoutId
        };
        finalizeRedirectBooking(pendingForBooking, validation.paymentIntentId);
      } catch {
        setError(t('confirm.couldNotCompleteBooking'));
      }
      clearUrlParams();
      return;
    }

    if (redirectStatus === 'succeeded') {
      const stored = sessionStorage.getItem('confirm-booking-pending');
      if (stored) {
        try {
          const data = JSON.parse(stored);
          sessionStorage.removeItem('confirm-booking-pending');
          const pendingForBooking = {
            ...data,
            checkoutId: data.checkoutId || checkoutId
          };
          finalizeRedirectBooking(pendingForBooking, paymentIntentId);
        } catch (e) {
          setError(t('confirm.couldNotCompleteBooking'));
        }
      }
      clearUrlParams();
    }
  }, [
    bookingEntityId,
    bookingEntityType,
    checkoutId,
    finalizeRedirectBooking,
    handleV2RedirectValidationFailure,
    id,
    navigate,
    t
  ]);

  const emitCheckoutStartedFunnel = useCallback(
    (checkoutIdValue) => {
      if (!bookingEntityId || !checkIn || !checkOut) return;
      const payload = {
        checkInDateOnly: formatDateOnlyLocal(checkIn),
        checkOutDateOnly: formatDateOnlyLocal(checkOut),
        adults,
        children
      };
      if (bookingEntityType === 'cabinType') {
        payload.cabinTypeId = bookingEntityId;
      } else {
        payload.cabinId = bookingEntityId;
      }
      const resolvedCheckoutId =
        typeof checkoutIdValue === 'string' ? checkoutIdValue.trim() : '';
      if (resolvedCheckoutId) {
        payload.checkoutId = resolvedCheckoutId;
      }
      trackFunnelEvent('checkout_started', payload);
    },
    [bookingEntityId, bookingEntityType, checkIn, checkOut, adults, children]
  );

  const initializeCheckoutPayment = useCallback(async () => {
    if (!bookingEntityId || !checkIn || !checkOut || !serverQuote) return;
    setCheckoutInitLoading(true);
    setCheckoutInitError(null);
    setStripeError(null);
    const existingClientSecret = clientSecret;
    const currentV2Identity = buildV2CheckoutIdentity({
      checkoutId,
      canonicalPaymentIntentId,
      quoteSnapshotHash
    });
    if (!checkoutSessionV2Enabled) {
      setClientSecret(null);
    }
    try {
      const payload = {
        checkIn: formatDateOnlyLocal(checkIn),
        checkOut: formatDateOnlyLocal(checkOut),
        adults,
        children,
        experienceKeys: experienceKeysSorted
      };
      if (checkoutSessionV2Enabled) {
        if (checkoutId) {
          payload.checkoutId = checkoutId;
        }
      } else {
        payload.checkoutId = checkoutId;
      }
      const attr = getAttributionPayload();
      if (attr && Object.values(attr).some(Boolean)) {
        payload.attribution = attr;
      }
      if (bookingEntityType === 'cabinType') {
        payload.cabinTypeId = bookingEntityId;
      } else {
        payload.cabinId = bookingEntityId;
      }
      if (lockedPromoCode) payload.promoCode = lockedPromoCode;
      if (appliedVoucherCode) payload.voucherCode = appliedVoucherCode;
      const guestEmail = formData.email?.trim().toLowerCase();
      if (guestEmail) payload.guestEmail = guestEmail;
      const res = await bookingAPI.createPaymentIntent(payload);
      if (!res.data?.success) {
        throw new Error(t('confirm.paymentSetupFailed'));
      }

      if (checkoutSessionV2Enabled) {
        const validation = validateV2CreatePaymentIntentResponse(res.data);
        if (!validation.ok) {
          clearV2CheckoutPaymentState();
          setCheckoutInitError(validation.error);
          return;
        }

        const noPay = Boolean(res.data.noPaymentRequired);
        const nextVoucherRedemptionId = res.data.voucherRedemptionId || res.data.redemptionId || null;
        const giftCents = Number(res.data.giftVoucherAppliedCents ?? res.data.voucherAppliedCents ?? 0);
        const reportedStripeCents = Number(res.data.stripeAmountCents);
        const nextSessionVersion = Number(res.data.sessionVersion) || 1;

        setCheckoutId(validation.checkoutId);
        setSessionVersion(nextSessionVersion);
        setVoucherRedemptionId(nextVoucherRedemptionId);
        setFullVoucherCoverage(Boolean(res.data.fullVoucherCoverage));
        setNoPaymentRequired(noPay);
        setVoucherAppliedCents(giftCents);

        let resolvedClientSecret = null;
        let nextCanonicalPaymentIntentId = res.data.canonicalPaymentIntentId || null;
        let nextQuoteSnapshotHash = String(res.data.quoteSnapshotHash || '').trim();

        if (noPay) {
          setStripeAmountCents(0);
          setClientSecret(null);
          nextCanonicalPaymentIntentId = null;
          nextQuoteSnapshotHash = '';
        } else {
          const resolved = resolveV2ClientSecretAfterPaymentIntent({
            currentIdentity: currentV2Identity,
            responseData: res.data,
            checkoutId: validation.checkoutId,
            existingClientSecret
          });
          nextCanonicalPaymentIntentId = resolved.nextIdentity.canonicalPaymentIntentId;
          nextQuoteSnapshotHash = resolved.nextIdentity.quoteSnapshotHash;
          resolvedClientSecret = resolved.clientSecret;

          if (resolvedClientSecret) {
            if (!Number.isFinite(reportedStripeCents) || reportedStripeCents < 0) {
              throw new Error(t('confirm.paymentSetupFailed'));
            }
            setStripeAmountCents(reportedStripeCents);
            setClientSecret(resolvedClientSecret);
          } else {
            setStripeAmountCents(Number.isFinite(reportedStripeCents) ? reportedStripeCents : 0);
            setClientSecret(null);
          }
        }

        setCanonicalPaymentIntentId(nextCanonicalPaymentIntentId);
        setQuoteSnapshotHash(nextQuoteSnapshotHash);

        writeCheckoutSessionV2Storage({
          ...buildV2StorageRecordFromPaymentResponse(
            {
              ...res.data,
              checkoutId: validation.checkoutId,
              canonicalPaymentIntentId: nextCanonicalPaymentIntentId,
              quoteSnapshotHash: nextQuoteSnapshotHash,
              sessionVersion: nextSessionVersion,
              voucherRedemptionId: nextVoucherRedemptionId
            },
            checkoutSessionV2BoundaryKey
          ),
          clientSecretPresent: Boolean(resolvedClientSecret) && !noPay
        });
        emitCheckoutStartedFunnel(validation.checkoutId);
        return;
      }

      setVoucherRedemptionId(res.data.redemptionId || null);
      setFullVoucherCoverage(Boolean(res.data.fullVoucherCoverage));
      setVoucherAppliedCents(Number(res.data.voucherAppliedCents || 0));
      const reportedStripeCents = Number(res.data.stripeAmountCents);
      if (res.data.clientSecret) {
        if (!Number.isFinite(reportedStripeCents) || reportedStripeCents < 0) {
          throw new Error(t('confirm.paymentSetupFailed'));
        }
        setStripeAmountCents(reportedStripeCents);
        setClientSecret(res.data.clientSecret);
      } else {
        setStripeAmountCents(Number.isFinite(reportedStripeCents) ? reportedStripeCents : 0);
        setClientSecret(null);
      }
      const legacyCheckoutId =
        typeof res.data.checkoutId === 'string' ? res.data.checkoutId.trim() : '';
      if (legacyCheckoutId) {
        setCheckoutId(legacyCheckoutId);
      }
      emitCheckoutStartedFunnel(legacyCheckoutId || checkoutId);
    } catch (err) {
      if (checkoutSessionV2Enabled) {
        const code = extractCheckoutApiErrorCode(err);
        const handling = getV2CheckoutInitErrorHandling(code);
        if (handling.clearAll) {
          clearV2CheckoutPaymentState();
        } else {
          if (handling.clearPaymentIdentity) {
            clearV2PaymentIdentityState();
            persistV2StoragePaymentCleared(checkoutId, {
              voucherRedemptionId,
              stripeAmountCents: 0,
              noPaymentRequired: false
            });
          } else if (handling.clearClientSecret) {
            setClientSecret(null);
          }
        }
        setCheckoutInitError(
          handling.message || err.response?.data?.message || t('confirm.paymentSetupFailed')
        );
      } else {
        setCheckoutInitError(err.response?.data?.message || t('confirm.paymentSetupFailed'));
      }
    } finally {
      setCheckoutInitLoading(false);
    }
  }, [
    bookingEntityId,
    checkIn,
    checkOut,
    serverQuote,
    adults,
    children,
    experienceKeysSorted,
    checkoutId,
    clientSecret,
    canonicalPaymentIntentId,
    quoteSnapshotHash,
    voucherRedemptionId,
    bookingEntityType,
    lockedPromoCode,
    appliedVoucherCode,
    formData.email,
    checkoutSessionV2BoundaryKey,
    clearV2CheckoutPaymentState,
    clearV2PaymentIdentityState,
    persistV2StoragePaymentCleared,
    emitCheckoutStartedFunnel,
    t
  ]);

  const handleDatesSave = useCallback((from, to) => {
    setCheckIn(from);
    setCheckOut(to);
    const params = new URLSearchParams(searchParams);
    params.set('checkIn', formatDateOnlyLocal(from));
    params.set('checkOut', formatDateOnlyLocal(to));
    setSearchParams(params);
  }, [searchParams, setSearchParams]);

  const handleGuestsSave = useCallback((g) => {
    setAdults(g.adults);
    setChildren(g.children);
    setBabies(g.babies);
    setPets(g.pets);
    const params = new URLSearchParams(searchParams);
    params.set('adults', String(g.adults));
    params.set('children', String(g.children));
    setSearchParams(params);
  }, [searchParams, setSearchParams]);

  const applyV2CreateBookingErrorState = useCallback((err) => {
    const code = extractCheckoutApiErrorCode(err);
    const handling = getV2CheckoutInitErrorHandling(code);
    if (handling.clearAll) {
      clearV2CheckoutPaymentState();
      return;
    }
    if (handling.clearPaymentIdentity) {
      clearV2PaymentIdentityState();
      setNoPaymentRequired(false);
      if (checkoutId) {
        persistV2StoragePaymentCleared(checkoutId, {
          voucherRedemptionId,
          stripeAmountCents: 0,
          noPaymentRequired: false
        });
      }
      return;
    }
    if (handling.clearClientSecret) {
      setClientSecret(null);
    }
  }, [
    checkoutId,
    voucherRedemptionId,
    clearV2CheckoutPaymentState,
    clearV2PaymentIdentityState,
    persistV2StoragePaymentCleared
  ]);

  const resetV2NoPaymentSubmitState = useCallback(() => {
    setNoPaymentRequired(false);
    setFullVoucherCoverage(false);
    setVoucherRedemptionId(null);
    clearV2PaymentIdentityState();
    if (checkoutId) {
      persistV2StoragePaymentCleared(checkoutId, {
        voucherRedemptionId: null,
        stripeAmountCents: 0,
        noPaymentRequired: false
      });
    } else {
      clearCheckoutSessionV2Storage();
    }
  }, [checkoutId, clearV2PaymentIdentityState, persistV2StoragePaymentCleared]);

  const createBooking = useCallback(async (paymentIntentId = null) => {
    const attr = getAttributionPayload();
    const bookingData = buildCreateBookingPayload({
      bookingEntityType,
      bookingEntityId,
      checkIn,
      checkOut,
      adults,
      children,
      selectedExpKeys,
      formData,
      checkoutId,
      voucherRedemptionId,
      lockedPromoCode,
      appliedVoucherCode,
      language,
      paymentIntentId,
      attribution: attr,
      metaClientContext: getMetaClientContextPayload()
    });
    const response = await bookingAPI.create(bookingData);
    if (response.data.success) {
      clearCheckoutStorageAfterSuccessfulBooking();
      const bookingId = response.data.data?.booking?._id;
      if (bookingId) {
        const em = formData.email.trim().toLowerCase();
        try {
          sessionStorage.setItem(`dd_booking_guest_${bookingId}`, em);
        } catch (e) { /* ignore */ }
        navigate(`/booking-success/${bookingId}`, { replace: true, state: { guestEmail: em } });
      } else {
        navigate('/');
      }
    } else {
      throw new Error(response.data.message || t('confirm.bookingFailed'));
    }
  }, [bookingEntityId, bookingEntityType, checkIn, checkOut, adults, children, formData, selectedExpKeys, experiences, navigate, lockedPromoCode, appliedVoucherCode, voucherRedemptionId, t, language, checkoutId]);

  const handleConfirmAndPay = useCallback(async () => {
    if (
      !bookingEntityId ||
      !checkIn ||
      !checkOut ||
      !pricing ||
      !serverQuote ||
      shouldBlockCardPaymentPrecheck(serverQuote, { noPaymentRequired, fullVoucherCoverage })
    ) {
      return;
    }
    if (!formData.agreedToTerms || !formData.agreedToActivityRisk) {
      setError('Please accept both required legal acknowledgments before completing your booking.');
      return;
    }
    if (checkoutSessionV2Enabled && noPaymentRequired) {
      const submitCheck = shouldAllowV2NoPaymentSubmit({ noPaymentRequired, checkoutId });
      if (!submitCheck.allowed) {
        setError(V2_NO_PAYMENT_MISSING_CHECKOUT_MESSAGE);
        resetV2NoPaymentSubmitState();
        return;
      }
    }
    setSubmitLoading(true);
    setError(null);
    try {
      if (!stripeEnabled) {
        emitCheckoutStartedFunnel(checkoutId || null);
      }
      if (appliedVoucherCode && !voucherRedemptionId) {
        throw new Error('Please continue to payment first so we can reserve your voucher.');
      }
      await createBooking(null);
    } catch (err) {
      if (checkoutSessionV2Enabled) {
        applyV2CreateBookingErrorState(err);
      }
      setError(mapCreateBookingErrorMessage(err, t('confirm.bookingFailed')));
    } finally {
      setSubmitLoading(false);
    }
  }, [
    bookingEntityId,
    checkIn,
    checkOut,
    pricing,
    serverQuote,
    createBooking,
    t,
    formData.agreedToTerms,
    formData.agreedToActivityRisk,
    appliedVoucherCode,
    voucherRedemptionId,
    noPaymentRequired,
    fullVoucherCoverage,
    checkoutId,
    stripeEnabled,
    emitCheckoutStartedFunnel,
    resetV2NoPaymentSubmitState,
    applyV2CreateBookingErrorState
  ]);

  const handleStripeSubmit = useCallback(async (stripe, elements) => {
    if (
      !bookingEntityId ||
      !checkIn ||
      !checkOut ||
      !pricing ||
      !serverQuote ||
      shouldBlockCardPaymentPrecheck(serverQuote, { noPaymentRequired, fullVoucherCoverage })
    ) {
      return;
    }
    if (!formData.agreedToTerms || !formData.agreedToActivityRisk) {
      setError('Please accept both required legal acknowledgments before completing your booking.');
      return;
    }
    if (appliedVoucherCode && !voucherRedemptionId) {
      setError('Please continue to payment first so we can reserve your voucher.');
      return;
    }
    setSubmitLoading(true);
    setError(null);
    setStripeError(null);
    try {
      const pendingBase = {
        cabinId: bookingEntityId,
        bookingEntityId,
        bookingEntityType,
        bookingEntitySlug,
        confirmPath,
        checkIn: formatDateOnlyLocal(checkIn),
        checkOut: formatDateOnlyLocal(checkOut),
        adults,
        children,
        checkoutId,
        voucherRedemptionId,
        voucherCode: appliedVoucherCode || undefined,
        promoCode: lockedPromoCode || undefined,
        formData: { ...formData },
        experiences: Array.from(selectedExpKeys).map((key) => {
          const exp = experiences.find((e) => e.key === key);
          const qty = exp?.unit === 'per_guest' ? adults + children : 1;
          return { key, quantity: qty, priceAtBooking: exp?.price || 0, currency: 'BGN' };
        })
      };
      const pendingPayload = checkoutSessionV2Enabled
        ? buildV2PendingCheckoutPayload(pendingBase, {
            checkoutId,
            canonicalPaymentIntentId,
            quoteSnapshotHash,
            noPaymentRequired,
            voucherRedemptionId
          })
        : pendingBase;
      sessionStorage.setItem('confirm-booking-pending', JSON.stringify(pendingPayload));
      const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}${confirmPath}`,
          payment_method_data: {
            billing_details: {
              name: `${formData.firstName} ${formData.lastName}`,
              email: formData.email,
              phone: formData.phone
            }
          }
        }
      });
      if (stripeError) {
        setStripeError(stripeError.message || t('confirm.paymentFailed'));
        setSubmitLoading(false);
        return;
      }
      if (paymentIntent?.status === 'succeeded') {
        try {
          await createBooking(paymentIntent.id);
        } catch (bookErr) {
          if (bookErr.response?.status === 409 && bookErr.response?.data?.refundInitiated && bookErr.response?.data?.paymentIntentId) {
            const d = bookErr.response.data;
            const params = new URLSearchParams();
            params.set('payment_intent', d.paymentIntentId);
            if (d.guestEmail) params.set('email', d.guestEmail);
            if (d.checkIn) params.set('checkIn', d.checkIn);
            if (d.checkOut) params.set('checkOut', d.checkOut);
            if (d.adults != null) params.set('adults', String(d.adults));
            if (d.children != null) params.set('children', String(d.children));
            navigate(`/booking-refund?${params.toString()}`, { replace: true });
            return;
          }
          throw bookErr;
        }
      }
    } catch (err) {
      if (err.response?.status === 409 && err.response?.data?.refundInitiated && err.response?.data?.paymentIntentId) {
        const d = err.response.data;
        const params = new URLSearchParams();
        params.set('payment_intent', d.paymentIntentId);
        if (d.guestEmail) params.set('email', d.guestEmail);
        if (d.checkIn) params.set('checkIn', d.checkIn);
        if (d.checkOut) params.set('checkOut', d.checkOut);
        if (d.adults != null) params.set('adults', String(d.adults));
        if (d.children != null) params.set('children', String(d.children));
        navigate(`/booking-refund?${params.toString()}`, { replace: true });
        return;
      }
      setError(mapCreateBookingErrorMessage(err, t('confirm.paymentFailed')));
    } finally {
      setSubmitLoading(false);
    }
  }, [
    bookingEntityId,
    bookingEntitySlug,
    bookingEntityType,
    checkIn,
    checkOut,
    pricing,
    serverQuote,
    adults,
    children,
    formData,
    selectedExpKeys,
    experiences,
    createBooking,
    confirmPath,
    lockedPromoCode,
    appliedVoucherCode,
    voucherRedemptionId,
    canonicalPaymentIntentId,
    quoteSnapshotHash,
    noPaymentRequired,
    navigate,
    t
  ]);

  const hasGuestInfo =
    !!formData.firstName?.trim() &&
    !!formData.lastName?.trim() &&
    !!formData.email?.trim() &&
    !!formData.phone?.trim();
  const hasValidGuestInfo = hasGuestInfo && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim());
  const hasLegalAcceptance = !!formData.agreedToTerms && !!formData.agreedToActivityRisk;

  const paymentPrecheckMessages = useMemo(() => {
    const msgs = [];
    if (!hasValidGuestInfo) msgs.push('Add valid guest details (name, email, phone) above.');
    if (!hasLegalAcceptance) msgs.push('Tick both legal acknowledgement checkboxes above.');
    if (quoteLoading) msgs.push('Price is still loading—please wait.');
    if (quoteError) msgs.push(`Price could not be loaded: ${quoteError}`);
    if (!serverQuote) msgs.push('No price quote is available yet.');
    if (serverQuote && shouldBlockCardPaymentPrecheck(serverQuote, { noPaymentRequired, fullVoucherCoverage })) {
      msgs.push('No card payment is required for this booking (total is below the minimum for online card payment).');
    }
    return msgs;
  }, [hasValidGuestInfo, hasLegalAcceptance, quoteLoading, quoteError, serverQuote, noPaymentRequired, fullVoucherCoverage]);

  const precheckDisabled =
    !hasValidGuestInfo ||
    !hasLegalAcceptance ||
    quoteLoading ||
    !!quoteError ||
    !serverQuote ||
    shouldBlockCardPaymentPrecheck(serverQuote, { noPaymentRequired, fullVoucherCoverage });

  const skipCardPaymentUi = fullVoucherCoverage || (checkoutSessionV2Enabled && noPaymentRequired);
  const showContinueToPayment =
    (stripeEnabled || appliedVoucherCode) && !skipCardPaymentUi && !clientSecret;
  const showPaymentElement = Boolean(clientSecret) && !skipCardPaymentUi;
  const inAppBrowser = useMemo(() => isInAppBrowser(), []);
  const showWebviewNotice =
    inAppBrowser && (showContinueToPayment || showPaymentElement) && hasValidGuestInfo && hasLegalAcceptance;

  const elementsGuardActive = showPaymentElement && stripeLoadStatus !== 'failed';
  const {
    ready: paymentElementReady,
    loadError: paymentElementLoadError,
    slowHint: stripeSlowHint,
    escalated: paymentElementEscalated,
    terminal: paymentElementTerminal,
    elementsRemountKey,
    onReady: handlePaymentElementReady,
    onLoadError: handlePaymentElementLoadErrorRaw,
    retryElements
  } = useStripeElementsGuard({ active: elementsGuardActive });

  const handlePaymentElementLoadError = useCallback(
    (event) => {
      handlePaymentElementLoadErrorRaw(event);
      trackPaymentResilienceEvent('payment_element_load_error', {
        checkoutId,
        stripeAmountCents,
        propertyKind: 'cabin'
      });
    },
    [handlePaymentElementLoadErrorRaw, checkoutId, stripeAmountCents]
  );

  useEffect(() => {
    if (!stripeSlowHint || paymentElementReady || paymentElementLoadError) return;
    trackPaymentResilienceEvent('payment_element_slow', {
      checkoutId,
      stripeAmountCents,
      propertyKind: 'cabin'
    });
  }, [stripeSlowHint, paymentElementReady, paymentElementLoadError, checkoutId, stripeAmountCents]);

  useEffect(() => {
    if (!paymentElementEscalated || paymentElementReady || paymentElementLoadError) return;
    trackPaymentResilienceEvent('payment_element_escalated', {
      checkoutId,
      stripeAmountCents,
      propertyKind: 'cabin'
    });
  }, [paymentElementEscalated, paymentElementReady, paymentElementLoadError, checkoutId, stripeAmountCents]);

  useEffect(() => {
    if (stripeLoadStatus !== 'failed') return;
    trackPaymentResilienceEvent('stripe_js_load_failed', {
      checkoutId,
      stripeAmountCents,
      propertyKind: 'cabin'
    });
  }, [stripeLoadStatus, checkoutId, stripeAmountCents]);

  const handlePaymentRecoveryRetry = useCallback(() => {
    if (stripeLoadStatus === 'failed') {
      retryStripeJs();
      return;
    }
    retryElements();
  }, [stripeLoadStatus, retryStripeJs, retryElements]);

  const v2PaymentElementKey = useMemo(() => {
    if (!checkoutSessionV2Enabled || !showPaymentElement) {
      return null;
    }
    return buildV2PaymentElementKey({
      checkoutId,
      canonicalPaymentIntentId,
      quoteSnapshotHash
    });
  }, [checkoutId, canonicalPaymentIntentId, quoteSnapshotHash, showPaymentElement]);

  const elementsReactKey = `${checkoutSessionV2Enabled && v2PaymentElementKey ? v2PaymentElementKey : 'elements'}:${elementsRemountKey}`;

  const continueToPayMessages = useMemo(() => {
    const msgs = [...paymentPrecheckMessages];
    if (!pricing) msgs.push('Stay and dates are incomplete so we cannot calculate the price yet.');
    return msgs;
  }, [paymentPrecheckMessages, pricing]);

  const continueToPayDisabled =
    checkoutInitLoading || !pricing || precheckDisabled;

  if (loading || !cabin) {
    return (
      <>
        <Seo
          title={t('confirm.seoLoadingTitle')}
          description={t('confirm.seoLoadingDescription')}
          canonicalPath={confirmPath}
          noindex
        />
        <div className="min-h-screen bg-[#F7F4EE] flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#81887A]" />
        </div>
      </>
    );
  }

  const coverImage = getListingCoverImage(cabin).url;
  const cabinName = cabin.name || t('confirm.cabinFallback');

  return (
    <>
      <Seo
        title={t('confirm.seoTitleWithCabin', { cabinName })}
        description={t('confirm.seoDescriptionWithCabin', { cabinName })}
        canonicalPath={confirmPath}
        noindex
      />
      <div className="min-h-screen bg-[#F7F4EE] pb-32 md:pb-0">
        <div className="max-w-2xl mx-auto px-4 py-6 md:py-10">
        {/* Header */}
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-gray-900">{t('cta.confirmAndPay')}</h1>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="w-10 h-10 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-200"
            aria-label={t('confirm.closeAria')}
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
            {error}
          </div>
        )}

        {/* Cabin card */}
        <div className="flex gap-4 p-4 bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
          <div className="w-24 h-24 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100">
            {coverImage && (
              <img
                src={normalizeSrc(coverImage)}
                alt={cabinName}
                className="w-full h-full object-cover"
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-gray-900 truncate">{cabinName}</p>
            {cabin.averageRating > 0 && (
              <p className="text-sm text-gray-600 flex items-center gap-1 mt-0.5">
                <span className="text-amber-500">★</span> {cabin.averageRating.toFixed(2)}
                {cabin.reviewsCount > 0 && (
                  <span> ({cabin.reviewsCount})</span>
                )}
              </p>
            )}
            {cabin.badges?.guestFavorite?.enabled && (
              <span className="inline-flex items-center gap-1 mt-1 text-xs text-gray-500">
                {t('confirm.guestFavorite')}
              </span>
            )}
          </div>
        </div>

        {/* Guest details */}
        <div className="mb-6 p-6 bg-white rounded-xl border border-gray-200 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('confirm.guestDetailsTitle')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label htmlFor="confirm-first-name" className="label-editorial">{t('confirm.firstName')}</label>
              <input
                id="confirm-first-name"
                type="text"
                value={formData.firstName}
                onChange={(e) => handleFormChange('firstName', e.target.value)}
                className="input-editorial"
                autoComplete="given-name"
                placeholder={t('confirm.firstName')}
              />
            </div>
            <div>
              <label htmlFor="confirm-last-name" className="label-editorial">{t('confirm.lastName')}</label>
              <input
                id="confirm-last-name"
                type="text"
                value={formData.lastName}
                onChange={(e) => handleFormChange('lastName', e.target.value)}
                className="input-editorial"
                autoComplete="family-name"
                placeholder={t('confirm.lastName')}
              />
            </div>
            <div>
              <label htmlFor="confirm-email" className="label-editorial">{t('confirm.email')}</label>
              <input
                id="confirm-email"
                type="email"
                value={formData.email}
                onChange={(e) => handleFormChange('email', e.target.value)}
                className="input-editorial"
                autoComplete="email"
                placeholder={t('confirm.email')}
              />
            </div>
            <div>
              <label htmlFor="confirm-phone" className="label-editorial">{t('confirm.phone')}</label>
              <input
                id="confirm-phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => handleFormChange('phone', e.target.value)}
                className="input-editorial"
                autoComplete="tel"
                placeholder={t('confirm.phonePlaceholder')}
              />
            </div>
          </div>
          <div className="mt-5">
            <label htmlFor="confirm-special-requests" className="label-editorial">{t('confirm.specialRequests')}</label>
            <textarea
              id="confirm-special-requests"
              value={formData.specialRequests}
              onChange={(e) => handleFormChange('specialRequests', e.target.value)}
              className="input-editorial min-h-[96px] resize-y"
              placeholder={t('confirm.specialRequestsPlaceholder')}
            />
          </div>
          {!hasValidGuestInfo && (
            <p className="mt-4 text-sm text-amber-700">
              {t('confirm.addGuestDetailsHint')}
            </p>
          )}
        </div>

        {/* Dates row */}
        <div className="flex items-center justify-between py-4 border-b border-gray-200">
          <div>
            <p className="text-sm text-gray-600">{t('mobile.datesLabel')}</p>
            <p className="font-medium text-gray-900">
              {checkIn && checkOut
                ? `${formatDate(checkIn)} – ${formatDate(checkOut)}`
                : t('modal.footerSelectDates')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDatesModalOpen(true)}
            className="text-sm font-medium text-gray-700 underline"
          >
            {t('actions.change')}
          </button>
        </div>

        {/* Guests row */}
        <div className="flex items-center justify-between py-4 border-b border-gray-200">
          <div>
            <p className="text-sm text-gray-600">{t('fields.guests')}</p>
            <p className="font-medium text-gray-900">{guestSummary}</p>
          </div>
          <button
            type="button"
            onClick={() => setGuestsModalOpen(true)}
            className="text-sm font-medium text-gray-700 underline"
          >
            {t('actions.change')}
          </button>
        </div>

        {/* Promo code — mobile: stacked control; md+: same row rhythm as Dates / Guests / Total (text link right) */}
        <div className="py-4 border-b border-gray-200">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 flex-1 w-full">
              <p className="text-sm text-gray-600 mb-2">{t('fields.promoCode')}</p>
              <input
                type="text"
                value={promoDraft}
                onChange={(e) => setPromoDraft(e.target.value)}
                autoComplete="off"
                placeholder={t('fields.optional')}
                className="w-full min-w-0 h-12 border-b border-black/15 bg-transparent px-0 text-[16px] outline-none focus:border-black/30 placeholder:text-black/40"
              />
            </div>
            <button
              type="button"
              onClick={handleApplyPromo}
              className="h-9 self-start shrink-0 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-800 hover:bg-gray-50 md:h-auto md:w-auto md:min-w-0 md:rounded-none md:border-0 md:bg-transparent md:p-0 md:hover:bg-transparent md:text-sm md:font-medium md:text-gray-700 md:underline"
            >
              {t('cta.apply')}
            </button>
          </div>
          {promoMessage && (
            <p className="text-sm text-amber-800 mt-3">{promoMessage}</p>
          )}
          {quoteError && (
            <p className="text-sm text-red-600 mt-3">{quoteError}</p>
          )}
        </div>

        <div className="py-4 border-b border-gray-200">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 flex-1 w-full">
              <p className="text-sm text-gray-600 mb-2">Gift voucher code</p>
              <input
                type="text"
                value={voucherDraft}
                onChange={(e) => setVoucherDraft(e.target.value)}
                autoComplete="off"
                placeholder="DD-XXXX-XXXX-XXXX"
                className="w-full min-w-0 h-12 border-b border-black/15 bg-transparent px-0 text-[16px] outline-none focus:border-black/30 placeholder:text-black/40"
              />
            </div>
            <div className="flex flex-wrap items-start gap-2 md:gap-3">
              <button
                type="button"
                onClick={handleApplyVoucher}
                className="h-9 self-start rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-800 hover:bg-gray-50 md:h-auto md:rounded-none md:border-0 md:bg-transparent md:p-0 md:hover:bg-transparent md:text-gray-700 md:underline"
              >
                Apply
              </button>
              {appliedVoucherCode ? (
                <button
                  type="button"
                  onClick={handleRemoveVoucher}
                  className="h-9 self-start rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-800 hover:bg-gray-50 md:h-auto md:rounded-none md:border-0 md:bg-transparent md:p-0 md:hover:bg-transparent md:text-gray-700 md:underline"
                >
                  Remove
                </button>
              ) : null}
            </div>
          </div>
          {appliedVoucherCode ? (
            <div className="mt-3 text-sm text-gray-700 space-y-1">
              {previewFullVoucherCoverage ? <p>This voucher can fully cover the booking.</p> : null}
              {serverQuote?.voucherMessage ? <p className="text-amber-700">{serverQuote.voucherMessage}</p> : null}
            </div>
          ) : null}
        </div>

        {/* Total row */}
        <div className="flex items-center justify-between py-4 border-b border-gray-200">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-gray-600">{t('confirm.totalPrice')}</p>
            {quoteLoading ? (
              <p className="font-medium text-gray-500 mt-0.5">{t('confirm.priceUpdating')}</p>
            ) : quoteError ? (
              <p className="font-medium text-gray-500 mt-0.5">—</p>
            ) : (
              <div className="mt-0.5 space-y-0.5">
                {displaySubtotal != null && displayDiscount > 0 && (
                  <p className="text-xs text-gray-400 line-through decoration-gray-400/80 tabular-nums">
                    {t('confirm.priceWas', { amount: Number(displaySubtotal).toLocaleString() })}
                  </p>
                )}
                {displayDiscount > 0 && (
                  <p className="text-xs text-gray-600 tabular-nums">
                    {t('confirm.promoDiscount', { amount: Number(displayDiscount).toLocaleString() })}
                  </p>
                )}
                <p className="font-medium text-gray-900 tabular-nums">
                  €{Number(displayTotal).toLocaleString()} EUR
                </p>
                {previewVoucherAppliedCents > 0 ? (
                  <>
                    <p className="text-xs text-gray-600 tabular-nums">
                      Gift voucher applied: €{(previewVoucherAppliedCents / 100).toLocaleString()}
                    </p>
                    <p className="font-semibold text-gray-900 tabular-nums">
                      Amount due today: €{(amountDueTodayCents / 100).toLocaleString()} EUR
                    </p>
                  </>
                ) : null}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setPriceModalOpen(true)}
            className="text-sm font-medium text-gray-700 underline shrink-0 ml-3"
          >
            {t('confirm.priceDetails')}
          </button>
        </div>

        {/* Cancellation */}
        <div className="py-4">
          <p className="font-medium text-gray-900">{t('confirm.freeCancellationTitle')}</p>
          {checkIn ? (
            <p className="text-sm text-gray-600 mt-0.5">
              {t('confirm.freeCancellationBody', {
                date: formatDate(new Date(checkIn.getFullYear(), checkIn.getMonth(), checkIn.getDate() - 5))
              })}
            </p>
          ) : null}
          <a href="/cancellation-policy" className="text-sm text-gray-700 underline mt-1 inline-block">
            {t('confirm.fullPolicyLink')}
          </a>
        </div>

        <div className="py-4 border-t border-gray-200 space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={!!formData.agreedToTerms}
              onChange={(e) => handleFormChange('agreedToTerms', e.target.checked)}
              className="mt-0.5 w-5 h-5 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
            />
            <span className="text-sm text-gray-800 leading-relaxed">
              I have read and accept the{' '}
              <Link to="/terms" target="_blank" rel="noopener noreferrer" className="underline">
                Terms & Conditions
              </Link>{' '}
              and{' '}
              <Link to="/cancellation-policy" target="_blank" rel="noopener noreferrer" className="underline">
                Cancellation Policy
              </Link>.
            </span>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={!!formData.agreedToActivityRisk}
              onChange={(e) => handleFormChange('agreedToActivityRisk', e.target.checked)}
              className="mt-0.5 w-5 h-5 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
            />
            <span className="text-sm text-gray-800 leading-relaxed">
              {LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT}
            </span>
          </label>
        </div>

        {/* Payment - Stripe when configured, else pay on arrival */}
        <div className="mt-6 p-6 bg-white rounded-xl border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('confirm.paymentTitle')}</h2>
          {showWebviewNotice ? (
            <PaymentRecoveryNotice variant="webview" className="mb-4" />
          ) : null}
          {showContinueToPayment ? (
            <>
              <button
                type="button"
                onClick={initializeCheckoutPayment}
                disabled={continueToPayDisabled}
                className="w-full h-12 rounded-xl bg-[#81887A] text-white font-semibold hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {checkoutInitLoading ? t('confirm.processingPayment') : 'Continue to secure payment'}
              </button>
              {continueToPayDisabled && !checkoutInitLoading ? (
                <div className="mt-3 space-y-1 text-sm text-gray-700" role="status" aria-live="polite">
                  {continueToPayMessages.map((msg, i) => (
                    <p key={i}>{msg}</p>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}

          {showPaymentElement ? (
            <>
              <p className="text-sm text-gray-600 mb-4">
                {voucherAppliedCents > 0
                  ? `Voucher applied: €${(voucherAppliedCents / 100).toLocaleString()} | Remaining card payment: €${(stripeAmountCents / 100).toLocaleString()}`
                  : `Card payment: €${(stripeAmountCents / 100).toLocaleString()}`}
              </p>
              {stripeLoadStatus === 'failed' || paymentElementTerminal ? (
                <PaymentRecoveryNotice
                  variant="terminal"
                  onRetry={handlePaymentRecoveryRetry}
                  className="mb-4"
                />
              ) : null}
              {!paymentElementTerminal && stripeLoadStatus !== 'failed' && !paymentElementReady ? (
                <div className="mb-4 space-y-2">
                  <p className="text-sm text-gray-600">{t('confirm.payment.loadingForm')}</p>
                  {stripeSlowHint ? <PaymentRecoveryNotice variant="slow" /> : null}
                </div>
              ) : null}
              {stripeLoadStatus !== 'failed' && stripePromise ? (
                <Elements
                  key={elementsReactKey}
                  stripe={stripePromise}
                  options={{ clientSecret }}
                >
                  <PaymentFormInner
                    onSubmit={handleStripeSubmit}
                    loading={submitLoading}
                    precheckDisabled={precheckDisabled}
                    precheckMessages={paymentPrecheckMessages}
                    onPaymentElementReady={handlePaymentElementReady}
                    onPaymentElementLoadError={handlePaymentElementLoadError}
                    suppressStripeLoadingHint={paymentElementTerminal}
                  />
                </Elements>
              ) : null}
              {stripeError && (
                <p className="mt-2 text-sm text-red-600">{stripeError}</p>
              )}
            </>
          ) : null}

          {skipCardPaymentUi ? (
            <>
              <p className="text-sm text-gray-600 mb-4">
                {voucherAppliedCents > 0
                  ? `Voucher applied: €${(voucherAppliedCents / 100).toLocaleString()} | Remaining card payment: €0`
                  : 'Card payment: €0'}
              </p>
              <button
                type="button"
                onClick={handleConfirmAndPay}
                disabled={
                  submitLoading ||
                  !pricing ||
                  precheckDisabled
                }
                className="w-full h-12 rounded-xl bg-[#81887A] text-white font-semibold hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitLoading ? t('confirm.submittingPayment') : 'Complete booking'}
              </button>
              {!submitLoading && (!pricing || precheckDisabled) ? (
                <div className="mt-3 space-y-1 text-sm text-gray-700" role="status" aria-live="polite">
                  {continueToPayMessages.map((msg, i) => (
                    <p key={i}>{msg}</p>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}

          {!stripeEnabled ? (
            <>
              <p className="text-sm text-gray-600 mb-4">
                {t('confirm.payOnArrivalNote')}
              </p>
              <button
                type="button"
                onClick={handleConfirmAndPay}
                disabled={
                  submitLoading ||
                  !pricing ||
                  precheckDisabled
                }
                className="w-full h-12 rounded-xl bg-[#81887A] text-white font-semibold hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitLoading
                  ? t('confirm.submittingPayment')
                  : t('confirm.confirmPayWithAmount', { amount: Number(displayTotal).toLocaleString() })}
              </button>
              {!submitLoading && (!pricing || precheckDisabled) ? (
                <div className="mt-3 space-y-1 text-sm text-gray-700" role="status" aria-live="polite">
                  {continueToPayMessages.map((msg, i) => (
                    <p key={i}>{msg}</p>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
          {checkoutInitError ? <p className="mt-2 text-sm text-red-600">{checkoutInitError}</p> : null}
        </div>
        </div>

        {/* Modals */}
        <ChangeDatesModal
          isOpen={datesModalOpen}
          onClose={() => setDatesModalOpen(false)}
          checkIn={checkIn}
          checkOut={checkOut}
          onSave={handleDatesSave}
        />
        <ChangeGuestsModal
          isOpen={guestsModalOpen}
          onClose={() => setGuestsModalOpen(false)}
          adults={adults}
          childGuestCount={children}
          babies={babies}
          pets={pets}
          maxGuests={maxGuests}
          allowPets={allowPets}
          onSave={handleGuestsSave}
        />
        <PriceDetailsModal
          isOpen={priceModalOpen}
          onClose={() => setPriceModalOpen(false)}
          nights={pricing?.totalNights}
          pricePerNight={pricing?.pricePerNight}
          totalPrice={displayTotal}
          serverSubtotal={displaySubtotal != null ? displaySubtotal : undefined}
          discountAmount={displayDiscount}
          extras={experienceExtras}
        />
      </div>
    </>
  );
}

export default ConfirmBooking;
