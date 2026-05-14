'use strict';

/**
 * V1 internal OPS alert templates (email-only, propertyKind: 'any').
 *
 * Three templates, all `status: 'draft'` per Batch 5:
 *   - ops_alert_arriving_8d      (T-192h before check-in, Sofia 09:00)
 *   - ops_alert_check_in_tomorrow (T-24h before check-in,  Sofia 09:00)
 *   - ops_alert_checkout_today    (checkout day,           Sofia 08:00)
 *
 * Recipient address is NOT stored on the template or rule; the dispatcher
 * resolves it from `EMAIL_TO_INTERNAL` env at send time (Batch 8/12).
 *
 * Spec references:
 *   - 02_V1_SPEC.md §11 (template fields)
 *   - 02_V1_SPEC.md §23.B (ops alert rule definitions)
 *   - 02_V1_SPEC.md §27 (ops notification format)
 */

const NOTES = [
  'Batch 5 seed: placeholder OPS alert copy.',
  'Final wording is OPEN; status stays "draft" until human approval.'
].join(' ');

const OPS_VARIABLE_SCHEMA = Object.freeze({
  type: 'object',
  required: ['guestFirstName', 'propertyName', 'checkInDate', 'checkOutDate', 'arrivalWindow'],
  properties: {
    guestFirstName: { type: 'string' },
    propertyName: { type: 'string' },
    checkInDate: { type: 'string' },
    checkOutDate: { type: 'string' },
    arrivalWindow: { type: 'string' }
  },
  additionalProperties: false
});

function buildOpsEmailBody(headline) {
  return [
    `<p>${headline}</p>`,
    '<p><strong>Guest:</strong> {{guestFirstName}}</p>',
    '<p><strong>Property:</strong> {{propertyName}}</p>',
    '<p><strong>Check-in:</strong> {{checkInDate}}</p>',
    '<p><strong>Check-out:</strong> {{checkOutDate}}</p>',
    '<p><strong>Arrival window:</strong> {{arrivalWindow}}</p>'
  ].join('\n');
}

const SHARED = {
  channel: 'email',
  locale: 'en',
  propertyKind: 'any',
  version: 1,
  status: 'draft',
  whatsappTemplateName: null,
  whatsappLocale: null,
  variableSchema: OPS_VARIABLE_SCHEMA,
  notes: NOTES
};

const opsAlertArriving8dTemplate = Object.freeze({
  ...SHARED,
  key: 'ops_alert_arriving_8d',
  emailSubject: '[Drift & Dwells OPS] Arriving in 8 days: {{propertyName}} — {{guestFirstName}}',
  emailBodyMarkup: buildOpsEmailBody('Guest arrives in 8 days.')
});

const opsAlertCheckInTomorrowTemplate = Object.freeze({
  ...SHARED,
  key: 'ops_alert_check_in_tomorrow',
  emailSubject: '[Drift & Dwells OPS] Tomorrow check-in: {{propertyName}} — {{guestFirstName}}',
  emailBodyMarkup: buildOpsEmailBody('Guest checks in tomorrow.')
});

const opsAlertCheckoutTodayTemplate = Object.freeze({
  ...SHARED,
  key: 'ops_alert_checkout_today',
  emailSubject: '[Drift & Dwells OPS] Checkout today: {{propertyName}} — {{guestFirstName}}',
  emailBodyMarkup: buildOpsEmailBody('Guest checks out today.')
});

module.exports = Object.freeze({
  OPS_VARIABLE_SCHEMA,
  opsAlertArriving8dTemplate,
  opsAlertCheckInTomorrowTemplate,
  opsAlertCheckoutTodayTemplate
});
