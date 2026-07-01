'use strict';

const {
  GUEST_TEMPLATE_VARIABLE_SCHEMA,
  COPY_SOURCE_NOTE,
  CABIN_EMAIL_SUBJECT,
  CABIN_EMAIL_BODY,
  CABIN_WHATSAPP_BODY,
  whatsappNotes
} = require('./gmaApprovedCopy');

/**
 * V1 guest arrival template — The Cabin (propertyKind: 'cabin').
 * Approved English-only email copy (WhatsApp reference body remains bilingual). Seeded as draft.
 */

const SHARED = {
  key: 'arrival_3d_the_cabin',
  version: 1,
  locale: 'en',
  propertyKind: 'cabin',
  status: 'draft',
  variableSchema: GUEST_TEMPLATE_VARIABLE_SCHEMA,
  notes: COPY_SOURCE_NOTE
};

const cabinWhatsappTemplate = Object.freeze({
  ...SHARED,
  channel: 'whatsapp',
  whatsappTemplateName: 'arrival_3d_the_cabin_v1',
  whatsappLocale: 'en',
  emailSubject: null,
  emailBodyMarkup: null,
  whatsappBodyPlaceholder: CABIN_WHATSAPP_BODY,
  notes: whatsappNotes('arrival_3d_the_cabin_v1', CABIN_WHATSAPP_BODY)
});

const cabinEmailTemplate = Object.freeze({
  ...SHARED,
  channel: 'email',
  whatsappTemplateName: null,
  whatsappLocale: null,
  emailSubject: CABIN_EMAIL_SUBJECT,
  emailBodyMarkup: CABIN_EMAIL_BODY
});

module.exports = Object.freeze({
  cabinWhatsappTemplate,
  cabinEmailTemplate
});
