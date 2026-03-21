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

module.exports = {
  PROPERTY_TIMEZONE,
  CHECK_IN_TIME,
  CHECK_OUT_TIME,
  normalizeDateToSofiaDayStart,
  normalizeExclusiveDateRange,
  isDateInExclusiveRange
};
