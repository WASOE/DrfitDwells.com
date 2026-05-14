'use strict';

const { GUEST_TEMPLATE_VARIABLE_SCHEMA } = require('./_guestVariableSchema');

/**
 * V1 guest arrival template — The Valley (propertyKind: 'valley').
 *
 * Placeholder copy. Seeded as `status: 'draft'` per Batch 5 decisions
 * (D-3 final copy is OPEN). Editing this file does NOT propagate to
 * already-inserted DB rows; the seed is insert-only.
 *
 * Spec references mirror `arrival_3d_the_cabin.js`. Channel-strategy and
 * Sofia hour stay identical to Cabin (T-72h, Sofia 17:00) per Batch 0 D-5.
 */

const NOTES = [
  'Batch 5 seed: placeholder copy.',
  'Final wording is OPEN (spec §4 D-3); status stays "draft" until human approval.'
].join(' ');

const SHARED = {
  key: 'arrival_3d_the_valley',
  version: 1,
  locale: 'en',
  propertyKind: 'valley',
  status: 'draft',
  variableSchema: GUEST_TEMPLATE_VARIABLE_SCHEMA,
  notes: NOTES
};

const WHATSAPP_BODY_PLACEHOLDER = [
  'Hi {{guestFirstName}} — your stay at {{propertyName}} starts {{checkInDate}}.',
  'Arrival window: {{arrivalWindow}}.',
  'Meeting point: {{meetingPointLabel}} ({{googleMapsUrl}}).',
  'Full arrival guide: {{guideUrl}}.',
  'Transport note: {{transportNote}}.',
  'Packing reminder: {{packingReminderShort}}.',
  'Questions? Reply here or call {{supportPhone}}.'
].join('\n\n');

const EMAIL_BODY_PLACEHOLDER = [
  '<p>Hi {{guestFirstName}},</p>',
  '<p>Your stay at <strong>{{propertyName}}</strong> begins on <strong>{{checkInDate}}</strong> and runs until <strong>{{checkOutDate}}</strong>.</p>',
  '<p><strong>Arrival window:</strong> {{arrivalWindow}}.</p>',
  '<p><strong>Meeting point:</strong> {{meetingPointLabel}} — <a href="{{googleMapsUrl}}">open in Google Maps</a>.</p>',
  '<p><strong>Full arrival guide:</strong> <a href="{{guideUrl}}">{{guideUrl}}</a>.</p>',
  '<p>{{transportNote}}</p>',
  '<p><strong>Packing reminder:</strong> {{packingReminderShort}}</p>',
  '<p>If you need anything, reply to this email or message us at {{supportPhone}}.</p>'
].join('\n');

const valleyWhatsappTemplate = Object.freeze({
  ...SHARED,
  channel: 'whatsapp',
  whatsappTemplateName: 'arrival_3d_the_valley_v1',
  whatsappLocale: 'en',
  emailSubject: null,
  emailBodyMarkup: null,
  whatsappBodyPlaceholder: WHATSAPP_BODY_PLACEHOLDER
});

const valleyEmailTemplate = Object.freeze({
  ...SHARED,
  channel: 'email',
  whatsappTemplateName: null,
  whatsappLocale: null,
  emailSubject: 'Your arrival to {{propertyName}} — {{checkInDate}}',
  emailBodyMarkup: EMAIL_BODY_PLACEHOLDER
});

module.exports = Object.freeze({
  valleyWhatsappTemplate,
  valleyEmailTemplate
});
