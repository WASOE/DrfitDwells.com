'use strict';

const {
  ACCESS_CABIN_VARIABLE_SCHEMA,
  COPY_SOURCE_NOTE,
  ACCESS_CABIN_EMAIL_SUBJECT,
  ACCESS_CABIN_EMAIL_BODY
} = require('./gmaApprovedCopy');

/**
 * GMA guest check-in access email — The Cabin (T-24h, email-only).
 */

const cabinAccessEmailTemplate = Object.freeze({
  key: 'access_day_before_the_cabin',
  version: 1,
  channel: 'email',
  locale: 'en',
  propertyKind: 'cabin',
  status: 'draft',
  whatsappTemplateName: null,
  whatsappLocale: null,
  emailSubject: ACCESS_CABIN_EMAIL_SUBJECT,
  emailBodyMarkup: ACCESS_CABIN_EMAIL_BODY,
  variableSchema: ACCESS_CABIN_VARIABLE_SCHEMA,
  notes: `${COPY_SOURCE_NOTE} GMA-GUEST-ACCESS-1 day-before access email.`
});

module.exports = Object.freeze({
  cabinAccessEmailTemplate
});
