'use strict';

/**
 * Sofia calendar scheduling policy for Arrival Automation V2 (PR2).
 *
 * - Nominal: 3 calendar days before check-in at 17:00 Europe/Sofia.
 * - Late booking catch-up: ~now + 5 minutes when nominal time is past.
 * - Cutoff: check-in calendar day 12:00 Europe/Sofia — after that, no auto send.
 */

const moment = require('moment-timezone');
const { PROPERTY_TIMEZONE } = require('../../../utils/dateTime');
const { computeScheduledSofiaInstant } = require('../messageOrchestratorTime');

const CATCH_UP_DELAY_MS = 5 * 60 * 1000;
const COALESCE_WINDOW_MS = 15 * 60 * 1000;
const CUTOFF_SOFIA_HOUR = 12;
const CUTOFF_SOFIA_MINUTE = 0;
const NOMINAL_OFFSET_HOURS = -72;
const NOMINAL_SOFIA_HOUR = 17;
const NOMINAL_SOFIA_MINUTE = 0;

function computeNominalPreArrivalUtc(checkIn) {
  return computeScheduledSofiaInstant({
    anchorDate: checkIn,
    offsetHours: NOMINAL_OFFSET_HOURS,
    sofiaHour: NOMINAL_SOFIA_HOUR,
    sofiaMinute: NOMINAL_SOFIA_MINUTE
  });
}

function computeCheckInDayCutoffUtc(checkIn) {
  if (checkIn == null) return null;
  const m = moment.tz(checkIn, PROPERTY_TIMEZONE);
  if (!m.isValid()) return null;
  const cutoff = m
    .clone()
    .startOf('day')
    .hour(CUTOFF_SOFIA_HOUR)
    .minute(CUTOFF_SOFIA_MINUTE)
    .second(0)
    .millisecond(0);
  return {
    cutoffUtc: cutoff.clone().utc().toDate(),
    cutoffSofiaIso: cutoff.format()
  };
}

/**
 * Resolve when an automatic arrival email may be scheduled.
 *
 * @returns {{
 *   ok: true,
 *   mode: 'nominal'|'catch_up',
 *   scheduledForUtc: Date,
 *   scheduledForSofiaIso: string,
 *   nominalUtc: Date,
 *   cutoffUtc: Date
 * } | {
 *   ok: false,
 *   code: 'past_cutoff'|'invalid_check_in',
 *   message: string,
 *   cutoffUtc?: Date,
 *   nominalUtc?: Date
 * }}
 */
function resolveAutomaticArrivalSchedule({ checkIn, now = new Date() }) {
  const nominal = computeNominalPreArrivalUtc(checkIn);
  const cutoff = computeCheckInDayCutoffUtc(checkIn);
  if (!nominal || !cutoff) {
    return { ok: false, code: 'invalid_check_in', message: 'Booking check-in is invalid' };
  }

  const nowMs = now.getTime();
  if (nowMs >= cutoff.cutoffUtc.getTime()) {
    return {
      ok: false,
      code: 'past_cutoff',
      message: 'Automatic arrival send is past check-in day 12:00 Europe/Sofia cutoff',
      cutoffUtc: cutoff.cutoffUtc,
      nominalUtc: nominal.scheduledForUtc
    };
  }

  if (nominal.scheduledForUtc.getTime() > nowMs) {
    return {
      ok: true,
      mode: 'nominal',
      scheduledForUtc: nominal.scheduledForUtc,
      scheduledForSofiaIso: nominal.scheduledForSofiaIso,
      nominalUtc: nominal.scheduledForUtc,
      cutoffUtc: cutoff.cutoffUtc
    };
  }

  // Catch-up: now + 5 minutes, but never at/after cutoff.
  let catchUp = new Date(nowMs + CATCH_UP_DELAY_MS);
  if (catchUp.getTime() >= cutoff.cutoffUtc.getTime()) {
    // Still before cutoff now, but catch-up would cross it — schedule just
    // before cutoff (1 minute) if that remains in the future.
    const safe = new Date(cutoff.cutoffUtc.getTime() - 60 * 1000);
    if (safe.getTime() <= nowMs) {
      return {
        ok: false,
        code: 'past_cutoff',
        message: 'Automatic arrival catch-up cannot complete before cutoff',
        cutoffUtc: cutoff.cutoffUtc,
        nominalUtc: nominal.scheduledForUtc
      };
    }
    catchUp = safe;
  }

  const catchUpSofia = moment.tz(catchUp, PROPERTY_TIMEZONE).format();
  return {
    ok: true,
    mode: 'catch_up',
    scheduledForUtc: catchUp,
    scheduledForSofiaIso: catchUpSofia,
    nominalUtc: nominal.scheduledForUtc,
    cutoffUtc: cutoff.cutoffUtc
  };
}

/**
 * Apply 15-minute coalesce delay for correction sends (not for initial T-3).
 * Result is never scheduled past cutoff.
 */
function applyCorrectionCoalesce({ desiredUtc, now = new Date(), cutoffUtc }) {
  const coalesceAt = new Date(Math.max(desiredUtc.getTime(), now.getTime() + COALESCE_WINDOW_MS));
  if (cutoffUtc && coalesceAt.getTime() >= cutoffUtc.getTime()) {
    const safe = new Date(cutoffUtc.getTime() - 60 * 1000);
    if (safe.getTime() <= now.getTime()) {
      return { ok: false, code: 'past_cutoff', message: 'Correction coalesce crosses cutoff' };
    }
    return { ok: true, scheduledForUtc: safe, coalesceUntil: safe };
  }
  return { ok: true, scheduledForUtc: coalesceAt, coalesceUntil: coalesceAt };
}

module.exports = {
  CATCH_UP_DELAY_MS,
  COALESCE_WINDOW_MS,
  CUTOFF_SOFIA_HOUR,
  NOMINAL_OFFSET_HOURS,
  NOMINAL_SOFIA_HOUR,
  computeNominalPreArrivalUtc,
  computeCheckInDayCutoffUtc,
  resolveAutomaticArrivalSchedule,
  applyCorrectionCoalesce
};
