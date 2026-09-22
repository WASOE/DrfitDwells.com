/**
 * SP6 — deterministic Europe/Sofia finalization timestamps for installment invoices.
 */
'use strict';

const moment = require('moment-timezone');
const {
  COLLECTION_TIMEZONE,
  INVOICE_FINALIZE_LOCAL_HOUR,
  INVOICE_FINALIZE_LOCAL_MINUTE,
  FUTURE_CHARGE_REMINDER_DAYS_BEFORE
} = require('../config/splitPaymentCollectionConfig');
const { formatSofiaDateOnly } = require('../utils/dateTime');

function dueDateFinalizeAtSofia(dueAtDateOnly) {
  const dateOnly = String(dueAtDateOnly || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
    throw new Error(`Invalid dueAtDateOnly: ${dueAtDateOnly}`);
  }
  const m = moment.tz(
    `${dateOnly} ${String(INVOICE_FINALIZE_LOCAL_HOUR).padStart(2, '0')}:${String(
      INVOICE_FINALIZE_LOCAL_MINUTE
    ).padStart(2, '0')}:00`,
    'YYYY-MM-DD HH:mm:ss',
    COLLECTION_TIMEZONE
  );
  if (!m.isValid()) {
    throw new Error(`Unable to build finalize timestamp for ${dueAtDateOnly}`);
  }
  return m.toDate();
}

function dueDateFinalizeUnixSeconds(dueAtDateOnly) {
  return Math.floor(dueDateFinalizeAtSofia(dueAtDateOnly).getTime() / 1000);
}

function isFinalizeTimestampInPast(dueAtDateOnly, now = new Date()) {
  return dueDateFinalizeAtSofia(dueAtDateOnly).getTime() <= now.getTime();
}

function reminderEligibleDateOnly(dueAtDateOnly) {
  const dateOnly = String(dueAtDateOnly || '').trim();
  return moment
    .tz(dateOnly, 'YYYY-MM-DD', COLLECTION_TIMEZONE)
    .subtract(FUTURE_CHARGE_REMINDER_DAYS_BEFORE, 'days')
    .format('YYYY-MM-DD');
}

function sofiaTodayDateOnly(now = new Date()) {
  return formatSofiaDateOnly(now);
}

function isReminderDue({ dueAtDateOnly, now = new Date() }) {
  const today = sofiaTodayDateOnly(now);
  const windowStart = reminderEligibleDateOnly(dueAtDateOnly);
  // Reminder once when today >= (due - 5 days) and installment not yet paid, and today <= due.
  return today >= windowStart && today <= String(dueAtDateOnly);
}

module.exports = {
  dueDateFinalizeAtSofia,
  dueDateFinalizeUnixSeconds,
  isFinalizeTimestampInPast,
  reminderEligibleDateOnly,
  sofiaTodayDateOnly,
  isReminderDue
};
