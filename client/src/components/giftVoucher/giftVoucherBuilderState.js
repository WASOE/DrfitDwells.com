import { PREVIEW_EXAMPLE } from '@shared/giftVoucher/cardCopy';
import {
  CARD_OCCASIONS,
  CARD_TEMPLATE_IDS,
  PLACEHOLDER_VOUCHER_CODE,
  resolveCardDisplayFields
} from '@shared/giftVoucher/cardSpec';
import {
  getScheduledDeliveryDateBounds,
  validateScheduledDeliveryDateIso
} from '@shared/giftVoucher/scheduledDeliveryRules';

export const MIN_AMOUNT_CENTS = 1500;
export const PHYSICAL_CARD_FEE_CENTS = 500;
export const MESSAGE_MAX_LENGTH = 250;
export const PRESET_AMOUNTS = [1500, 5000, 10000, 25000];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value) {
  return EMAIL_RE.test(String(value || '').trim());
}

export function createInitialBuilderState(pageLocale = 'en') {
  return {
    amountOriginalCents: 5000,
    customAmountEur: '',
    useCustomAmount: false,
    buyerName: '',
    buyerEmail: '',
    recipientName: '',
    recipientEmail: '',
    message: '',
    cardTemplateId: 'forest',
    cardOccasion: 'custom',
    cardLocale: pageLocale === 'bg' ? 'bg' : 'en',
    deliveryOption: 'recipient_now',
    deliveryDate: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    postalCode: '',
    country: '',
    termsAccepted: false
  };
}

export function computeEffectiveAmountCents(state) {
  if (!state.useCustomAmount) return state.amountOriginalCents;
  const eur = Number(state.customAmountEur);
  if (!Number.isFinite(eur)) return NaN;
  return Math.round(eur * 100);
}

export function buildPreviewVoucher(state, effectiveAmountCents) {
  const expiresAt = new Date();
  expiresAt.setUTCMonth(expiresAt.getUTCMonth() + 12);

  const amount = Number.isFinite(effectiveAmountCents) ? effectiveAmountCents : 5000;

  return resolveCardDisplayFields(
    {
      recipientName: state.recipientName.trim() || PREVIEW_EXAMPLE.recipientName,
      buyerName: state.buyerName.trim() || PREVIEW_EXAMPLE.buyerName,
      message: state.message.trim() || PREVIEW_EXAMPLE.message,
      amountOriginalCents: amount,
      currency: 'EUR',
      cardTemplateId: state.cardTemplateId,
      cardLocale: state.cardLocale,
      cardOccasion: state.cardOccasion,
      expiresAt: expiresAt.toISOString(),
      code: PLACEHOLDER_VOUCHER_CODE
    },
    {}
  );
}

export function validateBuilderState(state, { scheduledDeliveryEnabled = false } = {}) {
  const effectiveAmountCents = computeEffectiveAmountCents(state);

  if (!Number.isInteger(effectiveAmountCents)) {
    return { ok: false, code: 'WHOLE_AMOUNT' };
  }
  if (effectiveAmountCents < MIN_AMOUNT_CENTS) {
    return { ok: false, code: 'AMOUNT_BELOW_MINIMUM' };
  }
  if (!state.buyerName.trim() || !state.recipientName.trim()) {
    return { ok: false, code: 'NAMES_REQUIRED' };
  }
  if (!isValidEmail(state.buyerEmail)) {
    return { ok: false, code: 'BUYER_EMAIL' };
  }

  if (state.deliveryOption === 'recipient_now' || state.deliveryOption === 'scheduled') {
    if (!isValidEmail(state.recipientEmail)) {
      return { ok: false, code: 'RECIPIENT_EMAIL' };
    }
  }

  if (state.deliveryOption === 'scheduled') {
    if (!scheduledDeliveryEnabled) {
      return { ok: false, code: 'SCHEDULED_NOT_ENABLED' };
    }
    const dateResult = validateScheduledDeliveryDateIso(String(state.deliveryDate || '').trim());
    if (!dateResult.ok) {
      return { ok: false, code: dateResult.code };
    }
  }

  if (state.deliveryOption === 'postal') {
    if (
      !state.addressLine1.trim() ||
      !state.city.trim() ||
      !state.postalCode.trim() ||
      !state.country.trim()
    ) {
      return { ok: false, code: 'POSTAL_REQUIRED' };
    }
  }

  if (String(state.message || '').length > MESSAGE_MAX_LENGTH) {
    return { ok: false, code: 'MESSAGE_TOO_LONG' };
  }

  if (!state.termsAccepted) {
    return { ok: false, code: 'TERMS_NOT_ACCEPTED' };
  }

  return { ok: true, effectiveAmountCents };
}

export function buildSubmitPayload(state, meta = {}, config = {}) {
  const validation = validateBuilderState(state, config);
  if (!validation.ok) return null;

  const { effectiveAmountCents } = validation;
  const payload = {
    amountOriginalCents: effectiveAmountCents,
    currency: 'EUR',
    buyerName: state.buyerName.trim(),
    buyerEmail: state.buyerEmail.trim(),
    recipientName: state.recipientName.trim(),
    deliveryOption: state.deliveryOption,
    cardTemplateId: state.cardTemplateId,
    cardOccasion: state.cardOccasion,
    cardLocale: state.cardLocale,
    purchaseRequestId: meta.purchaseRequestId,
    termsAccepted: true,
    termsVersion: 'v1'
  };

  if (meta.attribution && Object.values(meta.attribution).some(Boolean)) {
    payload.attribution = meta.attribution;
  }

  if (state.deliveryOption === 'recipient_now' || state.deliveryOption === 'scheduled') {
    payload.recipientEmail = state.recipientEmail.trim();
  } else if (state.deliveryOption === 'postal' && state.recipientEmail.trim()) {
    payload.recipientEmail = state.recipientEmail.trim();
  }

  if (state.message.trim()) {
    payload.message = state.message.trim();
  }

  if (state.deliveryOption === 'scheduled' && state.deliveryDate.trim()) {
    payload.deliveryDate = state.deliveryDate.trim();
  }

  if (state.deliveryOption === 'postal') {
    payload.deliveryAddress = {
      addressLine1: state.addressLine1.trim(),
      addressLine2: state.addressLine2.trim() || null,
      city: state.city.trim(),
      postalCode: state.postalCode.trim(),
      country: state.country.trim()
    };
  }

  return payload;
}

export function payloadContainsPreviewExampleStrings(payload) {
  if (!payload) return false;
  const serialized = JSON.stringify(payload);
  return (
    serialized.includes(PREVIEW_EXAMPLE.recipientName) ||
    serialized.includes(PREVIEW_EXAMPLE.buyerName) ||
    serialized.includes(PREVIEW_EXAMPLE.message)
  );
}

export { CARD_OCCASIONS, CARD_TEMPLATE_IDS, getScheduledDeliveryDateBounds, validateScheduledDeliveryDateIso };
