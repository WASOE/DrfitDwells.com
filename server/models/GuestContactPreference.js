const mongoose = require('mongoose');
const {
  CONTACT_RECIPIENT_TYPES,
  CONTACT_PHONE_STATUSES,
  CONTACT_CONSENT_STATES,
  CONTACT_SUPPRESSION_REASONS
} = require('../services/messaging/messagingEnums');

/**
 * GuestContactPreference
 *
 * Per-channel, per-recipient consent + suppression + phone-normalisation
 * result. Single source of truth for "what address do we actually send to"
 * for the new system. See docs/guest-message-automation/02_V1_SPEC.md §16.
 *
 * `recipientValue` is lower-cased globally; E.164 phone numbers are
 * unaffected because their characters (digits + leading `+`) have no case.
 */
const guestContactPreferenceSchema = new mongoose.Schema(
  {
    recipientType: {
      type: String,
      enum: CONTACT_RECIPIENT_TYPES,
      required: true
    },
    recipientValue: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    rawValueLastSeen: { type: String, default: null },
    phoneStatus: {
      type: String,
      enum: CONTACT_PHONE_STATUSES,
      required: true,
      default: 'unknown'
    },
    phoneCountry: { type: String, default: null },
    transactional: {
      type: String,
      enum: CONTACT_CONSENT_STATES,
      required: true,
      default: 'unknown'
    },
    transactionalWordingVersion: { type: String, default: null },
    transactionalCapturedAt: { type: Date, default: null },
    marketing: {
      type: String,
      enum: CONTACT_CONSENT_STATES,
      required: true,
      default: 'denied'
    },
    suppressed: { type: Boolean, required: true, default: false },
    suppressedReason: {
      type: String,
      enum: CONTACT_SUPPRESSION_REASONS,
      default: null
    },
    suppressedAt: { type: Date, default: null },
    suppressedNote: { type: String, default: '' },
    linkedBookingIds: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' }
    ],
    lastEventAt: { type: Date, default: null }
  },
  { timestamps: true }
);

guestContactPreferenceSchema.index(
  { recipientType: 1, recipientValue: 1 },
  { unique: true }
);
guestContactPreferenceSchema.index({ suppressed: 1, recipientType: 1 });

module.exports = mongoose.model('GuestContactPreference', guestContactPreferenceSchema);
