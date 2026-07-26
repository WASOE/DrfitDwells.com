'use strict';

const GuestContactPreference = require('../../models/GuestContactPreference');
const QuoteContactConsentEvent = require('../../models/QuoteContactConsentEvent');
const SavedBookingQuote = require('../../models/SavedBookingQuote');
const { CONSENT_TEXTS } = require('./quoteContactConsentTexts');
const { normalizeEmail } = require('./contactPreferenceResolutionService');
const { evaluateRecoveryEligibility } = require('./recoveryEligibilityService');

function boolOrFalse(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

/**
 * Capture explicit quote/recovery/marketing consent. Append-only events + preference upsert.
 * Never throws to booking flow callers when wrapped in scheduleSavedQuoteTask.
 */
async function captureQuoteContactConsent({
  email,
  quoteDeliveryRequested = false,
  bookingReminderConsent = false,
  marketingConsent = false,
  sourceSurface = 'confirm_booking',
  savedQuoteId = null,
  checkoutSessionId = null,
  checkoutSessionObjectId = null,
  bookingId = null,
  locationBookingId = null,
  propertyKind = null,
  /**
   * When true, persist denied events for unchecked boxes so withdrawals are auditable
   * and override stale grants. When false, only persist granted consents.
   */
  recordDeclines = true
} = {}) {
  const emailNormalized = normalizeEmail(email);
  if (!emailNormalized) {
    return { skipped: true, reason: 'missing_email' };
  }

  const capturedAt = new Date();
  const decisions = [
    {
      consentType: 'quote_delivery',
      granted: boolOrFalse(quoteDeliveryRequested),
      meta: CONSENT_TEXTS.quote_delivery
    },
    {
      consentType: 'booking_reminder',
      granted: boolOrFalse(bookingReminderConsent),
      meta: CONSENT_TEXTS.booking_reminder
    },
    {
      consentType: 'marketing',
      granted: boolOrFalse(marketingConsent),
      meta: CONSENT_TEXTS.marketing
    }
  ];

  const events = [];
  for (const decision of decisions) {
    if (!decision.granted && !recordDeclines) continue;
    events.push({
      consentType: decision.consentType,
      granted: decision.granted,
      textVersion: decision.meta.version,
      textSnapshot: decision.meta.text,
      capturedAt,
      sourceSurface: decision.granted ? sourceSurface : sourceSurface === 'withdrawal' ? 'withdrawal' : sourceSurface,
      emailNormalized,
      savedQuoteId: savedQuoteId || null,
      checkoutSessionId: checkoutSessionId ? String(checkoutSessionId) : null,
      checkoutSessionObjectId: checkoutSessionObjectId || null,
      bookingId: bookingId || null,
      locationBookingId: locationBookingId || null,
      propertyKind: propertyKind || null
    });
  }

  if (events.length) {
    await QuoteContactConsentEvent.insertMany(events);
  }

  const setOnInsert = {
    phoneStatus: 'unknown',
    transactional: 'unknown',
    suppressed: false
  };

  await GuestContactPreference.findOneAndUpdate(
    { recipientType: 'email', recipientValue: emailNormalized },
    {
      $set: {
        rawValueLastSeen: emailNormalized,
        quoteDelivery: boolOrFalse(quoteDeliveryRequested) ? 'granted' : 'denied',
        quoteDeliveryWordingVersion: CONSENT_TEXTS.quote_delivery.version,
        quoteDeliveryCapturedAt: capturedAt,
        bookingReminder: boolOrFalse(bookingReminderConsent) ? 'granted' : 'denied',
        bookingReminderWordingVersion: CONSENT_TEXTS.booking_reminder.version,
        bookingReminderCapturedAt: capturedAt,
        marketing: boolOrFalse(marketingConsent) ? 'granted' : 'denied',
        marketingWordingVersion: CONSENT_TEXTS.marketing.version,
        marketingCapturedAt: capturedAt,
        lastEventAt: capturedAt
      },
      $setOnInsert: setOnInsert
    },
    { upsert: true, new: true }
  );

  const consentSnapshot = {
    quoteDeliveryRequested: boolOrFalse(quoteDeliveryRequested),
    bookingReminderConsent: boolOrFalse(bookingReminderConsent),
    marketingConsent: boolOrFalse(marketingConsent),
    consentCapturedAt: capturedAt,
    consentTextVersion: [
      CONSENT_TEXTS.quote_delivery.version,
      CONSENT_TEXTS.booking_reminder.version,
      CONSENT_TEXTS.marketing.version
    ].join('+'),
    quoteDeliveryTextVersion: CONSENT_TEXTS.quote_delivery.version,
    bookingReminderTextVersion: CONSENT_TEXTS.booking_reminder.version,
    marketingTextVersion: CONSENT_TEXTS.marketing.version
  };

  // Copy journey snapshot onto matching open saved quotes for this email.
  const quoteQuery = {
    emailNormalized,
    status: { $in: ['quoted', 'checkout_started'] },
    bookingId: null,
    locationBookingId: null
  };
  if (savedQuoteId) {
    quoteQuery._id = savedQuoteId;
    delete quoteQuery.emailNormalized;
  } else if (checkoutSessionId) {
    quoteQuery.checkoutId = String(checkoutSessionId);
  }

  const openQuotes = await SavedBookingQuote.find(quoteQuery).limit(20);
  for (const doc of openQuotes) {
    doc.email = emailNormalized;
    doc.emailNormalized = emailNormalized;
    doc.quoteDeliveryRequested = consentSnapshot.quoteDeliveryRequested;
    doc.bookingReminderConsent = consentSnapshot.bookingReminderConsent;
    doc.marketingConsent = consentSnapshot.marketingConsent;
    doc.transactionalContinuationEligible = consentSnapshot.bookingReminderConsent;
    doc.consentSnapshot = consentSnapshot;
    doc.recoveryEligibility = await evaluateRecoveryEligibility(doc, {
      now: capturedAt,
      contactStatus: null
    });
    await doc.save();
  }

  return {
    skipped: false,
    emailNormalized,
    consentSnapshot,
    eventCount: events.length,
    updatedQuoteCount: openQuotes.length
  };
}

module.exports = {
  captureQuoteContactConsent,
  boolOrFalse
};
