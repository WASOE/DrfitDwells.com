'use strict';

const moment = require('moment-timezone');
const { PROPERTY_TIMEZONE, formatSofiaDateOnly } = require('../../../utils/dateTime');

/**
 * Exclusive-end stay nights in Europe/Sofia civil dates.
 * Checkout date is excluded. Same-day / inverted ranges return 0 with invalid flag.
 */
function computeStayNights(checkIn, checkOut) {
  const inDate = formatSofiaDateOnly(checkIn);
  const outDate = formatSofiaDateOnly(checkOut);
  if (!inDate || !outDate) {
    return { nights: 0, invalid: true, reason: 'missing_dates', checkInDateOnly: inDate || null, checkOutDateOnly: outDate || null };
  }
  const start = moment.tz(inDate, 'YYYY-MM-DD', PROPERTY_TIMEZONE).startOf('day');
  const end = moment.tz(outDate, 'YYYY-MM-DD', PROPERTY_TIMEZONE).startOf('day');
  if (!start.isValid() || !end.isValid()) {
    return { nights: 0, invalid: true, reason: 'invalid_dates', checkInDateOnly: inDate, checkOutDateOnly: outDate };
  }
  if (!end.isAfter(start)) {
    return {
      nights: 0,
      invalid: true,
      reason: 'same_day_or_inverted',
      checkInDateOnly: inDate,
      checkOutDateOnly: outDate
    };
  }
  return {
    nights: end.diff(start, 'days'),
    invalid: false,
    reason: null,
    checkInDateOnly: inDate,
    checkOutDateOnly: outDate
  };
}

/**
 * Iterate Sofia civil nights in [fromDateOnly, toDateOnly] inclusive.
 */
function eachSofiaNightInclusive(fromDateOnly, toDateOnly, fn) {
  const cursor = moment.tz(fromDateOnly, 'YYYY-MM-DD', PROPERTY_TIMEZONE).startOf('day');
  const end = moment.tz(toDateOnly, 'YYYY-MM-DD', PROPERTY_TIMEZONE).startOf('day');
  if (!cursor.isValid() || !end.isValid() || end.isBefore(cursor)) return 0;
  let count = 0;
  while (cursor.isSameOrBefore(end)) {
    fn(cursor.format('YYYY-MM-DD'), cursor.clone());
    count += 1;
    cursor.add(1, 'day');
  }
  return count;
}

/**
 * Nights of a stay that overlap an inclusive reporting window [from, to] (Sofia date-only).
 * Stay is [checkIn, checkOut) in Sofia civil dates.
 */
function overlapStayNightsWithWindow({ checkIn, checkOut, fromDateOnly, toDateOnly }) {
  const stay = computeStayNights(checkIn, checkOut);
  if (stay.invalid || stay.nights === 0) {
    return { nights: 0, invalid: stay.invalid, reason: stay.reason, ...stay };
  }
  const winStart = moment.tz(fromDateOnly, 'YYYY-MM-DD', PROPERTY_TIMEZONE).startOf('day');
  const winEnd = moment.tz(toDateOnly, 'YYYY-MM-DD', PROPERTY_TIMEZONE).startOf('day');
  const stayStart = moment.tz(stay.checkInDateOnly, 'YYYY-MM-DD', PROPERTY_TIMEZONE).startOf('day');
  // Last occupied night is checkout - 1 day
  const stayLastNight = moment
    .tz(stay.checkOutDateOnly, 'YYYY-MM-DD', PROPERTY_TIMEZONE)
    .startOf('day')
    .subtract(1, 'day');

  const overlapStart = moment.max(stayStart, winStart);
  const overlapEnd = moment.min(stayLastNight, winEnd);
  if (overlapEnd.isBefore(overlapStart)) {
    return { nights: 0, invalid: false, reason: null, checkInDateOnly: stay.checkInDateOnly, checkOutDateOnly: stay.checkOutDateOnly };
  }
  return {
    nights: overlapEnd.diff(overlapStart, 'days') + 1,
    invalid: false,
    reason: null,
    checkInDateOnly: stay.checkInDateOnly,
    checkOutDateOnly: stay.checkOutDateOnly
  };
}

function periodKeyForDate(dateOnly, groupBy) {
  const m = moment.tz(dateOnly, 'YYYY-MM-DD', PROPERTY_TIMEZONE);
  if (groupBy === 'day') return m.format('YYYY-MM-DD');
  if (groupBy === 'week') return m.startOf('isoWeek').format('YYYY-[W]WW');
  return m.format('YYYY-MM');
}

/**
 * Occupied Sofia civil nights for stay [checkIn, checkOut) as YYYY-MM-DD strings.
 * Checkout day is excluded. Empty when stay invalid / zero nights.
 */
function expandOccupiedSofiaNightDateOnlys(checkIn, checkOut) {
  const stay = computeStayNights(checkIn, checkOut);
  if (stay.invalid || stay.nights === 0) {
    return {
      ok: false,
      nights: [],
      dateOnlys: [],
      invalid: stay.invalid,
      reason: stay.reason || 'zero_nights',
      checkInDateOnly: stay.checkInDateOnly,
      checkOutDateOnly: stay.checkOutDateOnly
    };
  }
  const lastNightDateOnly = moment
    .tz(stay.checkOutDateOnly, 'YYYY-MM-DD', PROPERTY_TIMEZONE)
    .startOf('day')
    .subtract(1, 'day')
    .format('YYYY-MM-DD');
  const dateOnlys = [];
  eachSofiaNightInclusive(stay.checkInDateOnly, lastNightDateOnly, (dateOnly) => {
    dateOnlys.push(dateOnly);
  });
  return {
    ok: true,
    nights: dateOnlys.length,
    dateOnlys,
    invalid: false,
    reason: null,
    checkInDateOnly: stay.checkInDateOnly,
    checkOutDateOnly: stay.checkOutDateOnly
  };
}

module.exports = {
  computeStayNights,
  eachSofiaNightInclusive,
  overlapStayNightsWithWindow,
  expandOccupiedSofiaNightDateOnlys,
  periodKeyForDate,
  PROPERTY_TIMEZONE
};
