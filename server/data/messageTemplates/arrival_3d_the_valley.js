'use strict';

const {
  GUEST_TEMPLATE_VARIABLE_SCHEMA,
  COPY_SOURCE_NOTE,
  VALLEY_EMAIL_SUBJECT,
  VALLEY_EMAIL_BODY,
  VALLEY_WHATSAPP_BODY,
  whatsappNotes
} = require('./gmaApprovedCopy');

/**
 * V1 guest arrival template — The Valley (propertyKind: 'valley').
 * Applies to A-Frame, Lux Cabin, Stone House. Approved bilingual copy.
 */

const SHARED = {
  key: 'arrival_3d_the_valley',
  version: 1,
  locale: 'en',
  propertyKind: 'valley',
  status: 'draft',
  variableSchema: GUEST_TEMPLATE_VARIABLE_SCHEMA,
  notes: COPY_SOURCE_NOTE
};

const valleyWhatsappTemplate = Object.freeze({
  ...SHARED,
  channel: 'whatsapp',
  whatsappTemplateName: 'arrival_3d_the_valley_v1',
  whatsappLocale: 'en',
  emailSubject: null,
  emailBodyMarkup: null,
  whatsappBodyPlaceholder: VALLEY_WHATSAPP_BODY,
  notes: whatsappNotes('arrival_3d_the_valley_v1', VALLEY_WHATSAPP_BODY)
});

const valleyEmailTemplate = Object.freeze({
  ...SHARED,
  channel: 'email',
  whatsappTemplateName: null,
  whatsappLocale: null,
  emailSubject: VALLEY_EMAIL_SUBJECT,
  emailBodyMarkup: VALLEY_EMAIL_BODY
});

module.exports = Object.freeze({
  valleyWhatsappTemplate,
  valleyEmailTemplate
});
