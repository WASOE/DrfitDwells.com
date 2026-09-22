/**
 * SP6 — centralized operational defaults for future installment collection.
 * Do not scatter these as magic numbers.
 */
'use strict';

const { PROPERTY_TIMEZONE } = require('../utils/dateTime');

/** Days before due date to send the future-charge reminder. */
const FUTURE_CHARGE_REMINDER_DAYS_BEFORE = 5;

/** Local hour (Europe/Sofia) when Stripe should finalize/charge the invoice. */
const INVOICE_FINALIZE_LOCAL_HOUR = 10;
const INVOICE_FINALIZE_LOCAL_MINUTE = 0;

/** Grace period after Stripe has no further retry scheduled (business rule). */
const RETRY_EXHAUSTED_GRACE_DAYS = 7;

/**
 * Technical delay before D&D may declare retry_exhausted after observing
 * an unpaid invoice with no next_payment_attempt.
 *
 * Justifies Automations lag: payment_failed may omit next_payment_attempt while
 * a subsequent invoice.updated (or Stripe retrieve) still surfaces a retry.
 * This is NOT a customer-facing business grace — that remains RETRY_EXHAUSTED_GRACE_DAYS.
 *
 * 5 minutes is the smallest conservative window for asynchronous Stripe state
 * convergence (webhook delivery + Automation updates) without inventing app retries.
 */
const RETRY_STATE_STABILIZATION_MS = 5 * 60 * 1000;

/** Idempotency / provisioning protocol version (bump when Stripe create contract changes). */
const INVOICE_PROVISIONING_OPERATION_VERSION = 1;

const COLLECTION_TIMEZONE = PROPERTY_TIMEZONE;

module.exports = {
  FUTURE_CHARGE_REMINDER_DAYS_BEFORE,
  INVOICE_FINALIZE_LOCAL_HOUR,
  INVOICE_FINALIZE_LOCAL_MINUTE,
  RETRY_EXHAUSTED_GRACE_DAYS,
  RETRY_STATE_STABILIZATION_MS,
  INVOICE_PROVISIONING_OPERATION_VERSION,
  COLLECTION_TIMEZONE
};
