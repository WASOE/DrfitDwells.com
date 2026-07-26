'use strict';

const { FIXTURE_BOOKING_EMAIL_PATTERN } = require('../../../utils/fixtureExclusion');
const { normalizeDateToSofiaDayStart } = require('../../../utils/dateTime');

function baseBookingFilter() {
  return {
    isTest: { $ne: true },
    $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }],
    'guestInfo.email': { $not: FIXTURE_BOOKING_EMAIL_PATTERN }
  };
}

function parseDateOnlyInput(value) {
  if (!value) return null;
  const raw = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return normalizeDateToSofiaDayStart(`${raw}T00:00:00.000Z`);
}

function buildInclusiveDateRange(from, to) {
  const start = parseDateOnlyInput(from);
  const end = parseDateOnlyInput(to);
  if (!start || !end || end < start) {
    return null;
  }
  const endExclusive = new Date(end.getTime());
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return { start, endExclusive, endInclusive: end };
}

function buildRevenueBasisDateFilter(revenueBasis, from, to) {
  const range = buildInclusiveDateRange(from, to);
  if (!range) return null;

  if (revenueBasis === 'booked') {
    return {
      range,
      filter: {
        createdAt: { $gte: range.start, $lt: range.endExclusive }
      }
    };
  }

  return {
    range,
    filter: {
      checkIn: { $gte: range.start, $lt: range.endExclusive }
    }
  };
}

module.exports = {
  baseBookingFilter,
  parseDateOnlyInput,
  buildInclusiveDateRange,
  buildRevenueBasisDateFilter
};
