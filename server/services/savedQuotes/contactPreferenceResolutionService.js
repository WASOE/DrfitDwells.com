'use strict';

const GuestContactPreference = require('../../models/GuestContactPreference');
const QuoteContactConsentEvent = require('../../models/QuoteContactConsentEvent');

function normalizeEmail(email) {
  if (!email) return null;
  const value = String(email).trim().toLowerCase();
  return value || null;
}

/**
 * Resolve current contact status for recovery eligibility.
 * Latest explicit withdrawal overrides earlier consent.
 * Global suppression overrides all optional sends.
 */
async function resolveGuestContactStatus(email, { now = new Date() } = {}) {
  const emailNormalized = normalizeEmail(email);
  if (!emailNormalized) {
    return {
      emailNormalized: null,
      quoteDeliveryAllowed: false,
      bookingReminderAllowed: false,
      marketingAllowed: false,
      globallySuppressed: false,
      suppressionReason: null,
      effectiveAt: now,
      source: 'missing_email'
    };
  }

  const pref = await GuestContactPreference.findOne({
    recipientType: 'email',
    recipientValue: emailNormalized
  }).lean();

  if (pref?.suppressed) {
    return {
      emailNormalized,
      quoteDeliveryAllowed: false,
      bookingReminderAllowed: false,
      marketingAllowed: false,
      globallySuppressed: true,
      suppressionReason: pref.suppressedReason || 'suppressed',
      effectiveAt: pref.suppressedAt || pref.updatedAt || now,
      source: 'guest_contact_preference'
    };
  }

  // Prefer mutable preference fields when present; fall back to latest audit events.
  let quoteDelivery = pref?.quoteDelivery || 'unknown';
  let bookingReminder = pref?.bookingReminder || 'unknown';
  let marketing = pref?.marketing || 'unknown';
  let effectiveAt = pref?.updatedAt || now;
  let source = pref ? 'guest_contact_preference' : 'consent_events';

  if (!pref || quoteDelivery === 'unknown' || bookingReminder === 'unknown' || marketing === 'unknown') {
    const events = await QuoteContactConsentEvent.find({ emailNormalized })
      .sort({ capturedAt: -1 })
      .limit(30)
      .lean();

    const latestByType = {};
    for (const event of events) {
      if (!latestByType[event.consentType]) {
        latestByType[event.consentType] = event;
      }
    }

    const fromEvent = (type, current) => {
      const event = latestByType[type];
      if (!event) return current;
      if (current !== 'unknown') return current;
      return event.granted ? 'granted' : 'denied';
    };

    quoteDelivery = fromEvent('quote_delivery', quoteDelivery);
    bookingReminder = fromEvent('booking_reminder', bookingReminder);
    marketing = fromEvent('marketing', marketing);

    const newestEvent = events[0];
    if (newestEvent?.capturedAt) {
      effectiveAt = newestEvent.capturedAt;
      if (!pref) source = 'consent_events';
    }
  }

  return {
    emailNormalized,
    quoteDeliveryAllowed: quoteDelivery === 'granted',
    bookingReminderAllowed: bookingReminder === 'granted',
    marketingAllowed: marketing === 'granted',
    globallySuppressed: false,
    suppressionReason: null,
    quoteDeliveryState: quoteDelivery,
    bookingReminderState: bookingReminder,
    marketingState: marketing,
    effectiveAt,
    source
  };
}

module.exports = {
  normalizeEmail,
  resolveGuestContactStatus
};
