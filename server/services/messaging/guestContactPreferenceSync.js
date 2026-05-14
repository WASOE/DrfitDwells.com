'use strict';

const GuestContactPreference = require('../../models/GuestContactPreference');
const { normaliseGuestPhoneRaw } = require('./phoneNormalisationService');

/** Same shape as Booking.guestInfo.email validator — keep in sync with server/models/Booking.js */
const BOOKING_EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isGuestContactPrefSyncEnabled() {
  return String(process.env.MESSAGE_GUEST_CONTACT_PREF_SYNC_ENABLED || '').trim() === '1';
}

function invalidStubRecipientValue(bookingId) {
  return `invalid:${String(bookingId)}`;
}

function isPlausibleGuestEmail(email) {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return false;
  return BOOKING_EMAIL_LIKE.test(trimmed);
}

/**
 * Upsert `GuestContactPreference` rows from a persisted `Booking` guest snapshot.
 * Never throws. Never mutates `Booking`.
 *
 * Feature flag: `MESSAGE_GUEST_CONTACT_PREF_SYNC_ENABLED=1` required; otherwise no-op.
 */
async function syncGuestContactPreferencesForBooking(booking) {
  if (!isGuestContactPrefSyncEnabled()) {
    return;
  }

  try {
    const bookingId = booking?._id;
    if (!bookingId) return;

    const guestInfo = booking.guestInfo || {};
    const rawPhone = guestInfo.phone;
    const rawEmail = guestInfo.email;

    const defaultCountry = process.env.DEFAULT_PHONE_COUNTRY || 'BG';
    const norm = normaliseGuestPhoneRaw(rawPhone, { defaultCountry });

    // Detach this booking from any prior WA preference rows (handles phone edits).
    await GuestContactPreference.updateMany(
      { recipientType: 'whatsapp_phone', linkedBookingIds: bookingId },
      { $pull: { linkedBookingIds: bookingId } }
    );

    if (norm.phoneStatus === 'valid' && norm.recipientValue) {
      await GuestContactPreference.deleteOne({
        recipientType: 'whatsapp_phone',
        recipientValue: invalidStubRecipientValue(bookingId)
      });

      await GuestContactPreference.findOneAndUpdate(
        { recipientType: 'whatsapp_phone', recipientValue: norm.recipientValue },
        {
          $set: {
            phoneStatus: 'valid',
            phoneCountry: norm.phoneCountry,
            rawValueLastSeen: norm.rawValueLastSeen,
            lastEventAt: new Date()
          },
          $setOnInsert: {
            transactional: 'unknown',
            marketing: 'denied',
            suppressed: false
          },
          $addToSet: { linkedBookingIds: bookingId }
        },
        { upsert: true, new: true }
      );
    } else {
      await GuestContactPreference.findOneAndUpdate(
        { recipientType: 'whatsapp_phone', recipientValue: invalidStubRecipientValue(bookingId) },
        {
          $set: {
            phoneStatus: 'invalid',
            phoneCountry: norm.phoneCountry,
            rawValueLastSeen: norm.rawValueLastSeen,
            lastEventAt: new Date()
          },
          $setOnInsert: {
            transactional: 'unknown',
            marketing: 'denied',
            suppressed: false
          },
          $addToSet: { linkedBookingIds: bookingId }
        },
        { upsert: true, new: true }
      );
    }

    // --- Email (optional, simple path) ---
    await GuestContactPreference.updateMany(
      { recipientType: 'email', linkedBookingIds: bookingId },
      { $pull: { linkedBookingIds: bookingId } }
    );

    if (isPlausibleGuestEmail(rawEmail)) {
      const emailValue = String(rawEmail).trim().toLowerCase();
      await GuestContactPreference.findOneAndUpdate(
        { recipientType: 'email', recipientValue: emailValue },
        {
          $set: {
            lastEventAt: new Date()
          },
          $setOnInsert: {
            transactional: 'unknown',
            marketing: 'denied',
            suppressed: false,
            rawValueLastSeen: null,
            phoneStatus: 'unknown'
          },
          $addToSet: { linkedBookingIds: bookingId }
        },
        { upsert: true, new: true }
      );
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        source: 'guestContactPreferenceSync',
        bookingId: booking?._id != null ? String(booking._id) : null,
        error: err?.message || String(err)
      })
    );
  }
}

module.exports = {
  syncGuestContactPreferencesForBooking,
  isGuestContactPrefSyncEnabled
};
