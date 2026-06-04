'use strict';

/**
 * messageVariableResolver
 *
 * Maps Booking + stay-target into the locked V1 guest template variable bag.
 * Guest-facing output uses 8 variables only (no supportPhone / transport / packing fallbacks).
 * guideUrl is resolved to an absolute public URL when possible.
 */

const { PROPERTY_TIMEZONE } = require('../../utils/dateTime');
const { resolveGuideUrl } = require('../../utils/arrivalGuideUrl');
const moment = require('moment-timezone');

const ARRIVAL_WINDOW_FALLBACK = 'as confirmed by your host';

const STRICTLY_REQUIRED = [
  'guestFirstName',
  'propertyName',
  'checkInDate',
  'checkOutDate',
  'meetingPointLabel',
  'googleMapsUrl',
  'guideUrl'
];

function defaultAppUrl() {
  return (process.env.APP_URL || 'https://driftdwells.com').replace(/\/+$/, '');
}

function formatSofiaDate(value) {
  if (value == null) return null;
  const m = moment.tz(value, PROPERTY_TIMEZONE);
  if (!m.isValid()) return null;
  return m.format('YYYY-MM-DD');
}

function trimmedOrNull(value) {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

function resolveVariables({ booking, stayTarget } = {}) {
  if (!booking || typeof booking !== 'object') {
    return { ok: false, missing: ['booking'] };
  }

  const guestFirstName = trimmedOrNull(booking?.guestInfo?.firstName);
  const propertyName = trimmedOrNull(stayTarget?.name);
  const checkInDate = formatSofiaDate(booking?.checkIn);
  const checkOutDate = formatSofiaDate(booking?.checkOut);

  const meetingPointLabel = trimmedOrNull(stayTarget?.meetingPoint?.label);
  const googleMapsUrl = trimmedOrNull(stayTarget?.meetingPoint?.googleMapsUrl);
  const rawGuideUrl = trimmedOrNull(stayTarget?.arrivalGuideUrl);
  const guideUrl = rawGuideUrl ? resolveGuideUrl(rawGuideUrl, defaultAppUrl()) : null;

  const arrivalWindow = trimmedOrNull(stayTarget?.arrivalWindowDefault) || ARRIVAL_WINDOW_FALLBACK;

  const variables = {
    guestFirstName,
    propertyName,
    checkInDate,
    checkOutDate,
    arrivalWindow,
    guideUrl,
    meetingPointLabel,
    googleMapsUrl
  };

  const missing = STRICTLY_REQUIRED.filter((k) => variables[k] == null);
  if (missing.length > 0) {
    return { ok: false, missing, partial: variables };
  }
  return { ok: true, variables };
}

module.exports = {
  resolveVariables,
  ARRIVAL_WINDOW_FALLBACK
};
