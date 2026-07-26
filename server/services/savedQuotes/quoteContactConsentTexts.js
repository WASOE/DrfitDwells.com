'use strict';

/**
 * Versioned quote / recovery contact consent copy.
 * Keep client twin in sync: client/src/constants/quoteContactConsent.js
 */

const QUOTE_DELIVERY_CONSENT_VERSION = 'quote_delivery_v1';
const QUOTE_DELIVERY_CONSENT_TEXT =
  'Email me this quote. This only covers sending the quote I requested — not marketing or booking reminders.';

const BOOKING_REMINDER_CONSENT_VERSION = 'booking_reminder_v1';
const BOOKING_REMINDER_CONSENT_TEXT =
  'If I do not finish booking, you may email me a limited reminder about this stay. This is not marketing consent.';

const MARKETING_CONSENT_VERSION = 'marketing_email_v1';
const MARKETING_CONSENT_TEXT =
  'Send me occasional offers and news from Drift & Dwells. I can unsubscribe at any time.';

const CONSENT_TEXTS = Object.freeze({
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

module.exports = {
  QUOTE_DELIVERY_CONSENT_VERSION,
  QUOTE_DELIVERY_CONSENT_TEXT,
  BOOKING_REMINDER_CONSENT_VERSION,
  BOOKING_REMINDER_CONSENT_TEXT,
  MARKETING_CONSENT_VERSION,
  MARKETING_CONSENT_TEXT,
  CONSENT_TEXTS
};
