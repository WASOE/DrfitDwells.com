'use strict';

/**
 * Locked V1 guest-template variable schema.
 *
 * Per `docs/guest-message-automation/02_V1_SPEC.md` §24, every guest-facing
 * V1 template (WhatsApp + email, Cabin + Valley) declares exactly these
 * 11 stable variables. No extras, no AI-generated text, no marketing.
 *
 * Used by `server/data/messageTemplates/arrival_3d_the_*.js` so both
 * channels for a given property stay in lockstep.
 */
const GUEST_TEMPLATE_VARIABLE_SCHEMA = Object.freeze({
  type: 'object',
  required: [
    'guestFirstName',
    'propertyName',
    'checkInDate',
    'checkOutDate',
    'arrivalWindow',
    'guideUrl',
    'meetingPointLabel',
    'googleMapsUrl',
    'supportPhone',
    'transportNote',
    'packingReminderShort'
  ],
  properties: {
    guestFirstName: { type: 'string' },
    propertyName: { type: 'string' },
    checkInDate: { type: 'string' },
    checkOutDate: { type: 'string' },
    arrivalWindow: { type: 'string' },
    guideUrl: { type: 'string' },
    meetingPointLabel: { type: 'string' },
    googleMapsUrl: { type: 'string' },
    supportPhone: { type: 'string' },
    transportNote: { type: 'string' },
    packingReminderShort: { type: 'string' }
  },
  additionalProperties: false
});

module.exports = { GUEST_TEMPLATE_VARIABLE_SCHEMA };
