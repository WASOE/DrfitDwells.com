'use strict';

const {
  ACCESS_VALLEY_VARIABLE_SCHEMA,
  COPY_SOURCE_NOTE,
  ACCESS_VALLEY_EMAIL_SUBJECT,
  ACCESS_VALLEY_EMAIL_BODY
} = require('./gmaApprovedCopy');

/**
 * GMA guest check-in access email — The Valley (T-24h, email-only).
 */

const valleyAccessEmailTemplate = Object.freeze({
  key: 'access_day_before_the_valley',
  version: 1,
  channel: 'email',
  locale: 'en',
  propertyKind: 'valley',
  status: 'draft',
  whatsappTemplateName: null,
  whatsappLocale: null,
  emailSubject: ACCESS_VALLEY_EMAIL_SUBJECT,
  emailBodyMarkup: ACCESS_VALLEY_EMAIL_BODY,
  variableSchema: ACCESS_VALLEY_VARIABLE_SCHEMA,
  notes: `${COPY_SOURCE_NOTE} GMA-GUEST-ACCESS-1 day-before access email.`
});

module.exports = Object.freeze({
  valleyAccessEmailTemplate
});
