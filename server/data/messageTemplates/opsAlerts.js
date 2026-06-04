'use strict';

const {
  COPY_SOURCE_NOTE,
  OPS_VARIABLE_SCHEMA,
  OPS_ARRIVING_8D_SUBJECT,
  OPS_ARRIVING_8D_BODY,
  OPS_CHECKIN_TOMORROW_SUBJECT,
  OPS_CHECKIN_TOMORROW_BODY,
  OPS_CHECKOUT_TODAY_SUBJECT,
  OPS_CHECKOUT_TODAY_BODY
} = require('./gmaApprovedCopy');

/**
 * V1 internal OPS alert templates (email-only, propertyKind: 'any').
 * Approved bilingual copy. All draft until human approval.
 */

const SHARED = {
  channel: 'email',
  locale: 'en',
  propertyKind: 'any',
  version: 1,
  status: 'draft',
  whatsappTemplateName: null,
  whatsappLocale: null,
  variableSchema: OPS_VARIABLE_SCHEMA,
  notes: COPY_SOURCE_NOTE
};

const opsAlertArriving8dTemplate = Object.freeze({
  ...SHARED,
  key: 'ops_alert_arriving_8d',
  emailSubject: OPS_ARRIVING_8D_SUBJECT,
  emailBodyMarkup: OPS_ARRIVING_8D_BODY
});

const opsAlertCheckInTomorrowTemplate = Object.freeze({
  ...SHARED,
  key: 'ops_alert_check_in_tomorrow',
  emailSubject: OPS_CHECKIN_TOMORROW_SUBJECT,
  emailBodyMarkup: OPS_CHECKIN_TOMORROW_BODY
});

const opsAlertCheckoutTodayTemplate = Object.freeze({
  ...SHARED,
  key: 'ops_alert_checkout_today',
  emailSubject: OPS_CHECKOUT_TODAY_SUBJECT,
  emailBodyMarkup: OPS_CHECKOUT_TODAY_BODY
});

module.exports = Object.freeze({
  OPS_VARIABLE_SCHEMA,
  opsAlertArriving8dTemplate,
  opsAlertCheckInTomorrowTemplate,
  opsAlertCheckoutTodayTemplate
});
