'use strict';

/**
 * messageOrchestratorTime
 *
 * Pure Sofia-calendar scheduling math for the guest message automation
 * orchestrator (Batch 7).
 *
 * Why this module exists.
 *
 * The Batch 5 seed encodes guest arrival timing as
 *   `triggerConfig: { offsetHours: -72, sofiaHour: 17, sofiaMinute: 0 }`
 * and the spec's intent (per ChatGPT review, locked) is **calendar-based**,
 * not wall-clock-arithmetic:
 *
 *   "3 calendar days before the check-in date, at 17:00 Europe/Sofia."
 *
 * A naive `checkInUtc - 72h` produces the wrong UTC instant whenever a DST
 * transition sits between the check-in date and the target send date. The
 * helper below avoids that bug by:
 *
 *   1. Interpreting the booking anchor (`checkIn` / `checkOut`) as a Sofia
 *      calendar date (`startOf('day')` in Europe/Sofia).
 *   2. Translating `offsetHours` to a *calendar-day* offset when it is a
 *      whole multiple of 24 (the only case V1 rules use today).
 *   3. Snapping the result to `sofiaHour:sofiaMinute` *in the Sofia zone*,
 *      so DST is resolved by moment-timezone.
 *   4. Converting that Sofia local time to a UTC `Date`.
 *
 * For non-multiple-of-24 offsets, we add the hours in Sofia local time as
 * well, then snap to the configured hour/minute. Tests cover both code
 * paths across spring-forward and fall-back transitions.
 *
 * This module is pure, has no DB, no IO, no logging, and is unit-testable
 * in isolation.
 */

const moment = require('moment-timezone');

const { PROPERTY_TIMEZONE } = require('../../utils/dateTime');

const DEFAULT_SOFIA_HOUR = 17;
const DEFAULT_SOFIA_MINUTE = 0;

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function clampInt(value, lo, hi, fallback) {
  if (!isFiniteNumber(value)) return fallback;
  const v = Math.trunc(value);
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/**
 * Compute the UTC instant for a calendar-based scheduled-send time.
 *
 * @param {object} params
 * @param {Date|string|number} params.anchorDate
 *   Check-in or check-out timestamp from the booking. Interpreted as the
 *   property-local calendar day (Europe/Sofia, startOf('day')).
 * @param {number} params.offsetHours
 *   Negative for pre-arrival rules (e.g. -72), positive for post-checkout.
 * @param {number} [params.sofiaHour=17]
 *   Sofia wall-clock hour to snap to (0..23). Defaults to 17.
 * @param {number} [params.sofiaMinute=0]
 *   Sofia wall-clock minute to snap to (0..59).
 * @returns {{ scheduledForUtc: Date, scheduledForSofiaIso: string } | null}
 *   `null` if anchorDate is invalid; otherwise a Date in UTC and a
 *   debug-friendly Sofia ISO string ("YYYY-MM-DDTHH:mm:ss±HH:mm").
 */
function computeScheduledSofiaInstant({ anchorDate, offsetHours, sofiaHour, sofiaMinute }) {
  if (anchorDate == null) return null;
  const anchor = moment.tz(anchorDate, PROPERTY_TIMEZONE);
  if (!anchor.isValid()) return null;

  const hour = clampInt(sofiaHour, 0, 23, DEFAULT_SOFIA_HOUR);
  const minute = clampInt(sofiaMinute, 0, 59, DEFAULT_SOFIA_MINUTE);
  const offset = isFiniteNumber(offsetHours) ? offsetHours : 0;

  const dayStartSofia = anchor.clone().startOf('day');

  let sofiaSend;
  if (Number.isInteger(offset) && offset % 24 === 0) {
    // Calendar-day path: shift by N days in Sofia (DST-safe) then snap to
    // hour:minute in Sofia. This is the spec intent for T-72h, T-24h, etc.
    const days = offset / 24;
    sofiaSend = dayStartSofia.clone().add(days, 'days').hour(hour).minute(minute).second(0).millisecond(0);
  } else {
    // Non-multiple-of-24 path: add hours in Sofia local time, then snap to
    // configured hour/minute on that resulting calendar day in Sofia.
    sofiaSend = dayStartSofia
      .clone()
      .add(offset, 'hours')
      .startOf('day')
      .hour(hour)
      .minute(minute)
      .second(0)
      .millisecond(0);
  }

  return {
    scheduledForUtc: sofiaSend.clone().utc().toDate(),
    scheduledForSofiaIso: sofiaSend.format()
  };
}

module.exports = {
  PROPERTY_TIMEZONE,
  DEFAULT_SOFIA_HOUR,
  DEFAULT_SOFIA_MINUTE,
  computeScheduledSofiaInstant
};
