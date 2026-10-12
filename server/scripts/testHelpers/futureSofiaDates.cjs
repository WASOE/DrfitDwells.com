'use strict';

const moment = require('moment-timezone');

function createFutureSofiaDates() {
  const earliest = moment.tz('Europe/Sofia').startOf('day').add(30, 'days');
  let anchor;
  // January/June keep the fixtures' 32-day window away from Sofia DST changes.
  for (let year = earliest.year(); !anchor; year += 1) {
    for (const month of [0, 5]) {
      const candidate = earliest.clone().date(1).year(year).month(month).date(10);
      if (candidate.isSameOrAfter(earliest, 'day')) {
        anchor = candidate;
        break;
      }
    }
  }
  return (offset = 0) => anchor.clone().add(offset, 'days').format('YYYY-MM-DD');
}

module.exports = { createFutureSofiaDates };
