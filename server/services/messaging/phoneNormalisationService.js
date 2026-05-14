'use strict';

const { parsePhoneNumberFromString } = require('libphonenumber-js');

/**
 * Pure phone normalisation for guest messaging (no DB, no Booking mutation).
 *
 * Default country: `BG` unless overridden (Batch 0 D-8 / spec §8.4).
 * Leading `+` → parse as international (no default country passed to lib).
 *
 * See docs/guest-message-automation/02_V1_SPEC.md §8.
 */

function normaliseGuestPhoneRaw(raw, options = {}) {
  const defaultCountry = options.defaultCountry || process.env.DEFAULT_PHONE_COUNTRY || 'BG';
  const rawValueLastSeen = typeof raw === 'string' ? raw.trim() : '';

  if (!rawValueLastSeen) {
    return {
      phoneStatus: 'invalid',
      recipientValue: null,
      phoneCountry: null,
      rawValueLastSeen: ''
    };
  }

  try {
    const parsed = parsePhoneNumberFromString(
      rawValueLastSeen,
      rawValueLastSeen.startsWith('+') ? undefined : defaultCountry
    );
    if (parsed && parsed.isValid()) {
      return {
        phoneStatus: 'valid',
        recipientValue: parsed.format('E.164'),
        phoneCountry: parsed.country || null,
        rawValueLastSeen
      };
    }
  } catch {
    // fall through to invalid
  }

  return {
    phoneStatus: 'invalid',
    recipientValue: null,
    phoneCountry: null,
    rawValueLastSeen
  };
}

module.exports = {
  normaliseGuestPhoneRaw
};
