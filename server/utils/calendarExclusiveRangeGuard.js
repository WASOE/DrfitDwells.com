const moment = require('moment-timezone');
const { PROPERTY_TIMEZONE } = require('./dateTime');

/** Max inclusive calendar-day span between exclusive range start and end (ops calendar queries). */
const MAX_CALENDAR_EXCLUSIVE_DAY_SPAN = 400;

/**
 * @param {Date} startDate
 * @param {Date} endDate
 * @throws {Error} code CALENDAR_RANGE_TOO_LARGE when span exceeds max
 */
function assertExclusiveCalendarRangeWithinMax(startDate, endDate) {
  const span = moment.tz(endDate, PROPERTY_TIMEZONE).diff(moment.tz(startDate, PROPERTY_TIMEZONE), 'days');
  if (span > MAX_CALENDAR_EXCLUSIVE_DAY_SPAN) {
    const err = new Error(
      `Calendar range cannot exceed ${MAX_CALENDAR_EXCLUSIVE_DAY_SPAN} days (exclusive end). Request a narrower from/to window.`
    );
    err.code = 'CALENDAR_RANGE_TOO_LARGE';
    throw err;
  }
}

module.exports = {
  MAX_CALENDAR_EXCLUSIVE_DAY_SPAN,
  assertExclusiveCalendarRangeWithinMax
};
