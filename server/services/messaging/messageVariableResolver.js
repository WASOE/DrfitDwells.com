'use strict';

/**
 * messageVariableResolver
 *
 * Pure function that maps a Booking + stay-target (Cabin or CabinType) into
 * the locked V1 template variable bag declared in
 * `server/data/messageTemplates/_guestVariableSchema.js`.
 *
 *   {
 *     guestFirstName, propertyName, checkInDate, checkOutDate, arrivalWindow,
 *     guideUrl, meetingPointLabel, googleMapsUrl, supportPhone,
 *     transportNote, packingReminderShort
 *   }
 *
 * Resolution rules (see docs/guest-message-automation/02_V1_SPEC.md §24):
 *
 *   - guestFirstName, propertyName, checkInDate, checkOutDate are mandatory
 *     and have NO fallback. If any is missing the resolver returns
 *     `{ ok: false, missing: [...] }`.
 *   - meetingPointLabel + googleMapsUrl + guideUrl are mandatory. Missing
 *     them blocks dispatch (cabin record is incomplete).
 *   - arrivalWindow falls back to the spec literal "as confirmed by your host".
 *   - transportNote falls back to "Standard arrival; contact us if you need
 *     transport arrangements.".
 *   - packingReminderShort falls back to "Layered clothing, sturdy shoes,
 *     rain gear.".
 *   - supportPhone resolves from `process.env.SUPPORT_PHONE`, falling back
 *     to `'+359 88 800 0000'` (placeholder; final value is OPS-owned).
 *
 * OPS templates (`ops_alert_*`) only need the first five variables; this
 * resolver always produces all eleven so the same caller works for both
 * guest and OPS channels. The OPS variable schema is a subset.
 *
 * The resolver is intentionally pure: no DB reads, no mongoose calls. The
 * caller passes already-fetched `stayTarget` (Cabin or CabinType .lean()).
 */

const { PROPERTY_TIMEZONE } = require('../../utils/dateTime');
const moment = require('moment-timezone');

const ARRIVAL_WINDOW_FALLBACK = 'as confirmed by your host';
const TRANSPORT_NOTE_FALLBACK = 'Standard arrival; contact us if you need transport arrangements.';
const PACKING_REMINDER_FALLBACK = 'Layered clothing, sturdy shoes, rain gear.';
const DEFAULT_SUPPORT_PHONE = '+359 88 800 0000';

const STRICTLY_REQUIRED = [
  'guestFirstName',
  'propertyName',
  'checkInDate',
  'checkOutDate',
  'meetingPointLabel',
  'googleMapsUrl',
  'guideUrl'
];

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

function resolveSupportPhone() {
  return trimmedOrNull(process.env.SUPPORT_PHONE) || DEFAULT_SUPPORT_PHONE;
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
  const guideUrl = trimmedOrNull(stayTarget?.arrivalGuideUrl);

  const arrivalWindow = trimmedOrNull(stayTarget?.arrivalWindowDefault) || ARRIVAL_WINDOW_FALLBACK;
  const transportNote = TRANSPORT_NOTE_FALLBACK;
  const packingReminderShort = PACKING_REMINDER_FALLBACK;
  const supportPhone = resolveSupportPhone();

  const variables = {
    guestFirstName,
    propertyName,
    checkInDate,
    checkOutDate,
    arrivalWindow,
    guideUrl,
    meetingPointLabel,
    googleMapsUrl,
    supportPhone,
    transportNote,
    packingReminderShort
  };

  const missing = STRICTLY_REQUIRED.filter((k) => variables[k] == null);
  if (missing.length > 0) {
    return { ok: false, missing, partial: variables };
  }
  return { ok: true, variables };
}

module.exports = {
  resolveVariables,
  ARRIVAL_WINDOW_FALLBACK,
  TRANSPORT_NOTE_FALLBACK,
  PACKING_REMINDER_FALLBACK,
  DEFAULT_SUPPORT_PHONE
};
