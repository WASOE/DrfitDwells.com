const moment = require('moment-timezone');

const PROPERTY_TIMEZONE = 'Europe/Sofia';
const CHECK_IN_TIME = '15:00';
const CHECK_OUT_TIME = '11:00';

function toSofiaDayStart(input) {
  return moment.tz(input, PROPERTY_TIMEZONE).startOf('day');
}

function normalizeDateToSofiaDayStart(input) {
  return toSofiaDayStart(input).toDate();
}

function normalizeExclusiveDateRange(startInput, endInput) {
  const start = toSofiaDayStart(startInput);
  const end = toSofiaDayStart(endInput);
  if (!start.isValid() || !end.isValid()) {
    throw new Error('Invalid date range input');
  }
  if (!end.isAfter(start)) {
    throw new Error('Exclusive range requires endDate > startDate');
  }
  return {
    startDate: start.toDate(),
    endDate: end.toDate()
  };
}

function isDateInExclusiveRange(targetInput, startInput, endInput) {
  const target = toSofiaDayStart(targetInput);
  const start = toSofiaDayStart(startInput);
  const end = toSofiaDayStart(endInput);
  return (target.isSameOrAfter(start) && target.isBefore(end));
}

/**
 * Property-local civil date for a stay boundary (YYYY-MM-DD in Europe/Sofia).
 * @param {Date|string|number} dateInput
 * @returns {string}
 */
function formatSofiaDateOnly(dateInput) {
  if (dateInput == null || dateInput === '') return '';
  const m = moment.tz(dateInput, PROPERTY_TIMEZONE);
  if (!m.isValid()) return '';
  return m.format('YYYY-MM-DD');
}

/**
 * Human-readable stay date in Europe/Sofia (default en-GB style: DD/MM/YYYY).
 * @param {Date|string|number} dateInput
 * @param {string} [locale='en-GB']
 * @returns {string}
 */
function formatSofiaDisplayDate(dateInput, locale = 'en-GB') {
  if (dateInput == null || dateInput === '') return '';
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    timeZone: PROPERTY_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(d);
}

module.exports = {
  PROPERTY_TIMEZONE,
  CHECK_IN_TIME,
  CHECK_OUT_TIME,
  normalizeDateToSofiaDayStart,
  normalizeExclusiveDateRange,
  isDateInExclusiveRange,
  formatSofiaDateOnly,
  formatSofiaDisplayDate
};
