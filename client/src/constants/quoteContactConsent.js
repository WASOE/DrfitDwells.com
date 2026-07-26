/**
 * Versioned quote / recovery contact consent copy.
 * Keep server twin in sync: server/services/savedQuotes/quoteContactConsentTexts.js
 */

export const QUOTE_DELIVERY_CONSENT_VERSION = 'quote_delivery_v1';
export const QUOTE_DELIVERY_CONSENT_TEXT =
  'Email me this quote. This only covers sending the quote I requested — not marketing or booking reminders.';

export const BOOKING_REMINDER_CONSENT_VERSION = 'booking_reminder_v1';
export const BOOKING_REMINDER_CONSENT_TEXT =
  'If I do not finish booking, you may email me a limited reminder about this stay. This is not marketing consent.';

export const MARKETING_CONSENT_VERSION = 'marketing_email_v1';
export const MARKETING_CONSENT_TEXT =
  'Send me occasional offers and news from Drift & Dwells. I can unsubscribe at any time.';

export const CONSENT_TEXTS = Object.freeze({
  quote_delivery: {
    version: QUOTE_DELIVERY_CONSENT_VERSION,
    text: QUOTE_DELIVERY_CONSENT_TEXT
  },
  booking_reminder: {
    version: BOOKING_REMINDER_CONSENT_VERSION,
    text: BOOKING_REMINDER_CONSENT_TEXT
  },
  marketing: {
    version: MARKETING_CONSENT_VERSION,
    text: MARKETING_CONSENT_TEXT
  }
});
