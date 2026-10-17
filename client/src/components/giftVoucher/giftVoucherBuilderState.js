import { PREVIEW_EXAMPLE, getPreviewExampleMessage } from '@shared/giftVoucher/cardCopy';
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
export const NAME_MAX_LENGTH = 120;
export const EMAIL_MAX_LENGTH = 254;
export const POSTAL_MAX_LENGTHS = Object.freeze({
  addressLine1: 200, addressLine2: 200, city: 120, postalCode: 40, country: 120
});
export const PRESET_AMOUNTS = [1500, 5000, 10000, 25000, 50000];

export function isValidEmail(value) {
  const email = String(value || '').trim();
  const separator = email.lastIndexOf('@');
  if (separator < 1 || email.length > EMAIL_MAX_LENGTH) return false;
  const local = email.slice(0, separator), domain = email.slice(separator + 1);
  const bytes = new TextEncoder();
  if (bytes.encode(local).length > 64 || bytes.encode(domain).length > 254) return false;
  const labels = domain.split('.');
  const tld = labels[labels.length - 1];
  if (labels.length < 2 || !(tld.startsWith('xn--') || /^[\p{L}]{2,}$/u.test(tld)) ||
    !labels.every((label) => label.length > 0 && label.length <= 63 &&
      /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u.test(label))) return false;
  if (local.startsWith('"') && local.endsWith('"')) {
    return /^[\p{L}\p{N}\p{P}\p{S} ]*$/u.test(local.slice(1, -1));
  }
  return local.split('.').every((part) => part.length > 0 &&
    /^[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+$/u.test(part));
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
  const input = String(state.customAmountEur).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(input)) return NaN;
  const [whole, fraction = ''] = input.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : NaN;
}

export function buildPreviewVoucher(state, effectiveAmountCents) {
  const expiresAt = new Date();
  expiresAt.setUTCMonth(expiresAt.getUTCMonth() + 12);

  const amount = Number.isFinite(effectiveAmountCents) ? effectiveAmountCents : 5000;

  return resolveCardDisplayFields(
    {
      recipientName: state.recipientName.trim() || PREVIEW_EXAMPLE.recipientName,
      buyerName: state.buyerName.trim() || PREVIEW_EXAMPLE.buyerName,
      // Example message follows the card locale so toggling cardLocale
      // switches the whole card, not just the labels.
      message: state.message.trim() || getPreviewExampleMessage(state.cardLocale),
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

  if (!Number.isSafeInteger(effectiveAmountCents) ||
    (state.deliveryOption === 'postal' && !Number.isSafeInteger(effectiveAmountCents + PHYSICAL_CARD_FEE_CENTS))) {
    return { ok: false, code: 'WHOLE_AMOUNT' };
  }
  if (effectiveAmountCents < MIN_AMOUNT_CENTS) {
    return { ok: false, code: 'AMOUNT_BELOW_MINIMUM' };
  }
  if (!state.buyerName.trim() || !state.recipientName.trim()) {
    return { ok: false, code: 'NAMES_REQUIRED' };
  }
  if (state.buyerName.trim().length > NAME_MAX_LENGTH || state.recipientName.trim().length > NAME_MAX_LENGTH) {
    return { ok: false, code: 'NAMES_TOO_LONG' };
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
    const dateIso = String(state.deliveryDate || '').trim();
    if (dateIso) {
      const parsed = new Date(`${dateIso}T00:00:00.000Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dateIso) {
        return { ok: false, code: 'INVALID_SCHEDULED_DELIVERY_DATE' };
      }
    }
    const dateResult = validateScheduledDeliveryDateIso(dateIso);
    if (!dateResult.ok) {
      return { ok: false, code: dateResult.code };
    }
  }

  if (state.deliveryOption === 'postal') {
    if (state.recipientEmail.trim() && !isValidEmail(state.recipientEmail)) {
      return { ok: false, code: 'RECIPIENT_EMAIL' };
    }
    if (
      !state.addressLine1.trim() ||
      !state.city.trim() ||
      !state.postalCode.trim() ||
      !state.country.trim()
    ) {
      return { ok: false, code: 'POSTAL_REQUIRED' };
    }
    if (Object.entries(POSTAL_MAX_LENGTHS).some(([key, max]) => state[key].length > max)) {
      return { ok: false, code: 'POSTAL_TOO_LONG' };
    }
  }

  if (!['recipient_now', 'send_to_buyer', 'postal', 'scheduled'].includes(state.deliveryOption)) {
    return { ok: false, code: 'INVALID_DELIVERY_OPTION' };
  }
  if (!CARD_TEMPLATE_IDS.includes(state.cardTemplateId) || !CARD_OCCASIONS.includes(state.cardOccasion) ||
    !['en', 'bg'].includes(state.cardLocale)) {
    return { ok: false, code: 'INVALID_CUSTOMIZATION_FIELD' };
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
    serialized.includes(PREVIEW_EXAMPLE.message.en) ||
    serialized.includes(PREVIEW_EXAMPLE.message.bg)
  );
}

export { CARD_OCCASIONS, CARD_TEMPLATE_IDS, getScheduledDeliveryDateBounds, validateScheduledDeliveryDateIso };
