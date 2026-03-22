const moment = require('moment-timezone');

const PROPERTY_TIMEZONE = 'Europe/Sofia';
const PRODID = '-//Drift & Dwells//Public Calendar//EN';
const CRLF = '\r\n';

/**
 * @typedef {Object} IcsEventInput
 * @property {string} uid
 * @property {Date} dtstamp
 * @property {Date} [lastModified]
 * @property {Date} startDateInclusive
 * @property {Date} endDateExclusive
 * @property {string} [summary]
 */

function foldIcsLine(line) {
  const max = 75;
  if (Buffer.byteLength(line, 'utf8') <= max) {
    return line;
  }
  let out = '';
  let rest = line;
  while (rest.length > 0) {
    const chunkMax = out === '' ? max : max - 1;
    let take = rest.length;
    while (take > 0 && Buffer.byteLength(rest.slice(0, take), 'utf8') > chunkMax) {
      take -= 1;
    }
    if (take === 0) take = 1;
    out += (out === '' ? '' : CRLF + ' ') + rest.slice(0, take);
    rest = rest.slice(take);
  }
  return out;
}

function escapeIcsText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function formatDateOnlySofia(d) {
  return moment.tz(d, PROPERTY_TIMEZONE).format('YYYYMMDD');
}

function formatDateTimeUtc(d) {
  return moment.utc(d).utc().format('YYYYMMDDTHHmmss') + 'Z';
}

/**
 * @param {Object} opts
 * @param {string} opts.calendarName
 * @param {IcsEventInput[]} opts.events sorted by caller
 */
function buildIcsCalendar({ calendarName, events }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calendarName || 'Availability')}`
  ];

  for (const ev of events) {
    const summary = ev.summary || 'Unavailable';
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.uid}`);
    lines.push(`DTSTAMP:${formatDateTimeUtc(ev.dtstamp)}`);
    if (ev.lastModified) {
      lines.push(`LAST-MODIFIED:${formatDateTimeUtc(ev.lastModified)}`);
    }
    lines.push(`DTSTART;VALUE=DATE:${formatDateOnlySofia(ev.startDateInclusive)}`);
    lines.push(`DTEND;VALUE=DATE:${formatDateOnlySofia(ev.endDateExclusive)}`);
    lines.push(`SUMMARY:${escapeIcsText(summary)}`);
    lines.push('TRANSP:OPAQUE');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  return lines.map((l) => foldIcsLine(l)).join(CRLF) + CRLF;
}

module.exports = {
  buildIcsCalendar,
  escapeIcsText,
  formatDateOnlySofia,
  formatDateTimeUtc,
  foldIcsLine,
  PRODID,
  PROPERTY_TIMEZONE
};
