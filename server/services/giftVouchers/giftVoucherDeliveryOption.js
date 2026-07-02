const {
  CARD_OCCASIONS,
  CARD_TEMPLATE_IDS,
  CARD_LOCALES,
  DELIVERY_OPTIONS,
  SCHEDULED_DELIVERY_ENV_FLAG
} = require('./giftVoucherCustomizationConstants');

function validationError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function isGiftVoucherScheduledEnabled() {
  return String(process.env[SCHEDULED_DELIVERY_ENV_FLAG] || '').trim() === '1';
}

function deliveryModeFromOption(deliveryOption) {
  if (deliveryOption === 'postal') return 'postal';
  if (['recipient_now', 'send_to_buyer', 'scheduled'].includes(deliveryOption)) return 'email';
  const err = validationError('deliveryOption is invalid', 'INVALID_DELIVERY_OPTION');
  throw err;
}

function deliveryOptionFromLegacyMode(deliveryMode) {
  if (deliveryMode === 'postal') return 'postal';
  if (deliveryMode === 'email') return 'recipient_now';
  return null;
}

function normalizeEnumField(value, allowed, fieldName) {
  if (value == null || value === '') return null;
  const v = String(value).trim();
  if (!allowed.includes(v)) {
    throw validationError(`${fieldName} is invalid`, 'INVALID_CUSTOMIZATION_FIELD');
  }
  return v;
}

function sofiaDateIso(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Sofia',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date instanceof Date ? date : new Date(date));
}

function addCalendarDaysIso(isoDate, days) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  const ny = next.getUTCFullYear();
  const nm = String(next.getUTCMonth() + 1).padStart(2, '0');
  const nd = String(next.getUTCDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

function addCalendarMonthsIso(isoDate, months) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1 + months, d));
  const ny = next.getUTCFullYear();
  const nm = String(next.getUTCMonth() + 1).padStart(2, '0');
  const nd = String(next.getUTCDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

function validateScheduledDeliveryDate({ deliveryDate, createdAt = new Date() }) {
  if (!deliveryDate || Number.isNaN(deliveryDate.getTime())) {
    throw validationError('deliveryDate is required for scheduled delivery', 'MISSING_SCHEDULED_DELIVERY_DATE');
  }
  const selectedIso = sofiaDateIso(deliveryDate);
  const purchaseIso = sofiaDateIso(createdAt);
  const earliestIso = addCalendarDaysIso(purchaseIso, 1);
  if (selectedIso < earliestIso) {
    throw validationError('Scheduled delivery date must be tomorrow or later', 'INVALID_SCHEDULED_DELIVERY_DATE');
  }
  const latestIso = addCalendarMonthsIso(purchaseIso, 11);
  if (selectedIso > latestIso) {
    throw validationError('Scheduled delivery date must be within 11 months of purchase', 'INVALID_SCHEDULED_DELIVERY_DATE');
  }
  const projectedExpiryIso = addCalendarMonthsIso(purchaseIso, 12);
  if (selectedIso >= projectedExpiryIso) {
    throw validationError('Scheduled delivery date must be before voucher expiry', 'INVALID_SCHEDULED_DELIVERY_DATE');
  }
  return deliveryDate;
}

function resolveDeliveryOption(input = {}) {
  const explicit = input.deliveryOption != null && String(input.deliveryOption).trim() !== ''
    ? String(input.deliveryOption).trim()
    : null;

  let deliveryOption = explicit;
  if (!deliveryOption) {
    const legacyMode = input.deliveryMode != null && String(input.deliveryMode).trim() !== ''
      ? String(input.deliveryMode).trim()
      : 'email';
    if (legacyMode === 'manual') {
      throw validationError('manual delivery is not available for purchase', 'INVALID_DELIVERY_MODE');
    }
    deliveryOption = deliveryOptionFromLegacyMode(legacyMode);
    if (!deliveryOption) {
      throw validationError('deliveryMode must be email or postal', 'INVALID_DELIVERY_MODE');
    }
  }

  if (!DELIVERY_OPTIONS.includes(deliveryOption)) {
    throw validationError('deliveryOption is invalid', 'INVALID_DELIVERY_OPTION');
  }

  if (deliveryOption === 'scheduled' && !isGiftVoucherScheduledEnabled()) {
    throw validationError('Scheduled gift voucher delivery is not available yet', 'SCHEDULED_DELIVERY_NOT_ENABLED');
  }

  return deliveryOption;
}

function effectiveDeliveryOption(doc = {}) {
  if (doc.deliveryOption) return doc.deliveryOption;
  if (doc.deliveryMode === 'postal') return 'postal';
  if (doc.deliveryMode === 'manual') return null;
  return 'recipient_now';
}

function recipientEmailRequiredForOption(deliveryOption) {
  return deliveryOption === 'recipient_now' || deliveryOption === 'scheduled';
}

function normalizeCustomizationFields(input = {}) {
  return {
    cardOccasion: normalizeEnumField(input.cardOccasion, CARD_OCCASIONS, 'cardOccasion'),
    cardTemplateId: normalizeEnumField(input.cardTemplateId, CARD_TEMPLATE_IDS, 'cardTemplateId'),
    cardLocale: normalizeEnumField(input.cardLocale, CARD_LOCALES, 'cardLocale')
  };
}

module.exports = {
  isGiftVoucherScheduledEnabled,
  deliveryModeFromOption,
  deliveryOptionFromLegacyMode,
  resolveDeliveryOption,
  effectiveDeliveryOption,
  recipientEmailRequiredForOption,
  normalizeCustomizationFields,
  validateScheduledDeliveryDate,
  sofiaDateIso,
  addCalendarDaysIso,
  addCalendarMonthsIso,
  DELIVERY_OPTIONS
};
