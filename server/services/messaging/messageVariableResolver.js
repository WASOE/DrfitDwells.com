'use strict';

/**
 * messageVariableResolver
 *
 * Maps Booking + stay-target into audience-specific template variable bags.
 * Guest-facing output uses the locked V1 guest keys (8 variables).
 * Cleaner output (C5) uses CLEANER_VARIABLE_SCHEMA — no guest PII.
 */

const Booking = require('../../models/Booking');
const { PROPERTY_TIMEZONE, CHECK_OUT_TIME } = require('../../utils/dateTime');
const { resolveGuideUrl } = require('../../utils/arrivalGuideUrl');
const { CLEANER_VARIABLE_SCHEMA } = require('../../data/messageTemplates/gmaApprovedCopy');
const { isGuestAccessRuleKey } = require('../../data/stayAccessCredentials');
const { resolveStayAccessCredentials } = require('./stayAccessCredentialResolver');
const moment = require('moment-timezone');

const ARRIVAL_WINDOW_FALLBACK = 'as confirmed by your host';

const GUEST_STRICTLY_REQUIRED = [
  'guestFirstName',
  'propertyName',
  'checkInDate',
  'checkOutDate',
  'meetingPointLabel',
  'googleMapsUrl',
  'guideUrl'
];

const CLEANER_STRICTLY_REQUIRED = CLEANER_VARIABLE_SCHEMA.required.slice();

/** Keys that must never appear on the cleaner bag (C0.7). */
const CLEANER_FORBIDDEN_GUEST_PII_KEYS = Object.freeze([
  'guestFirstName',
  'guestLastName',
  'guestEmail',
  'guestPhone',
  'guestInfo'
]);

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

function emptyStringOrValue(value) {
  const t = trimmedOrNull(value);
  return t == null ? '' : t;
}

function resolveGuestUnitLabel(booking) {
  const unit = booking?.unitId;
  if (!unit || typeof unit !== 'object') return null;
  const displayName = trimmedOrNull(unit.displayName);
  if (displayName) return displayName;
  const unitNumber = trimmedOrNull(unit.unitNumber);
  if (!unitNumber) return null;
  if (/^unit\b/i.test(unitNumber)) return unitNumber;
  return `Unit ${unitNumber}`;
}

/**
 * Next same-property check-in on the checkout calendar day (turnaround), if any.
 */
async function resolveNextTurnaroundCheckInDate(booking) {
  if (!booking?.checkOut) return null;
  const dayStart = moment.tz(booking.checkOut, PROPERTY_TIMEZONE).startOf('day');
  const dayEnd = dayStart.clone().add(1, 'day');

  const filter = {
    _id: { $ne: booking._id },
    isTest: { $ne: true },
    status: { $in: ['confirmed', 'in_house'] },
    checkIn: { $gte: dayStart.toDate(), $lt: dayEnd.toDate() }
  };

  if (booking.unitId) {
    filter.unitId = booking.unitId._id || booking.unitId;
  } else if (booking.cabinId) {
    filter.cabinId = booking.cabinId._id || booking.cabinId;
  } else if (booking.cabinTypeId) {
    filter.cabinTypeId = booking.cabinTypeId._id || booking.cabinTypeId;
  } else {
    return null;
  }

  const next = await Booking.findOne(filter).sort({ checkIn: 1 }).select('checkIn').lean();
  return next?.checkIn ? formatSofiaDate(next.checkIn) : null;
}

function resolveGuestVariables({ booking, stayTarget } = {}) {
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

  const missing = GUEST_STRICTLY_REQUIRED.filter((k) => variables[k] == null);
  if (missing.length > 0) {
    return { ok: false, missing, partial: variables };
  }
  return { ok: true, variables };
}

async function resolveCleanerVariables({ booking, stayTarget } = {}) {
  if (!booking || typeof booking !== 'object') {
    return { ok: false, missing: ['booking'] };
  }

  const propertyName = trimmedOrNull(stayTarget?.name);
  const checkOutDate = formatSofiaDate(booking?.checkOut);
  const meetingPointLabel = trimmedOrNull(stayTarget?.meetingPoint?.label);
  const googleMapsUrl = trimmedOrNull(stayTarget?.meetingPoint?.googleMapsUrl);
  const rawGuideUrl = trimmedOrNull(stayTarget?.arrivalGuideUrl);
  const guideUrl = rawGuideUrl ? resolveGuideUrl(rawGuideUrl, defaultAppUrl()) : '';

  const unitFromBooking = resolveGuestUnitLabel(booking);
  const unitLabel = unitFromBooking || emptyStringOrValue(stayTarget?.name);
  const nextCheckInDate = await resolveNextTurnaroundCheckInDate(booking);

  const variables = {
    propertyName,
    unitLabel,
    checkOutDate,
    checkInDate: nextCheckInDate || '',
    checkoutTime: CHECK_OUT_TIME,
    cleaningNotes: emptyStringOrValue(booking?.cleaningNotes),
    meetingPointLabel,
    googleMapsUrl,
    meetingPointWhat3words: emptyStringOrValue(stayTarget?.meetingPoint?.what3words),
    guideUrl,
    accessNote: emptyStringOrValue(stayTarget?.arrivalWindowDefault)
  };

  for (const forbidden of CLEANER_FORBIDDEN_GUEST_PII_KEYS) {
    if (Object.prototype.hasOwnProperty.call(variables, forbidden)) {
      return { ok: false, missing: [`forbidden_key:${forbidden}`] };
    }
  }

  const missing = CLEANER_STRICTLY_REQUIRED.filter((k) => variables[k] == null || variables[k] === '');
  if (missing.length > 0) {
    return { ok: false, missing, partial: variables };
  }
  return { ok: true, variables, audience: 'cleaner' };
}

async function resolveGuestAccessVariables({ booking, stayTarget, propertyKind } = {}) {
  const base = resolveGuestVariables({ booking, stayTarget });
  if (!base.ok) {
    return base;
  }

  const access = await resolveStayAccessCredentials({ booking, stayTarget, propertyKind });
  if (!access.ok) {
    return {
      ok: false,
      missing: access.missing,
      partial: { ...base.partial, ...base.variables },
      blockReason: access.blockReason,
      resolutionSource: access.resolutionSource
    };
  }

  const variables = {
    ...base.variables,
    ...access.credentials
  };

  if (access.credentials.unitLabel) {
    variables.propertyName = access.credentials.unitLabel;
  }

  return {
    ok: true,
    variables,
    resolutionSource: access.resolutionSource
  };
}

async function resolveVariables({ booking, stayTarget, audience, ruleKey, propertyKind } = {}) {
  if (audience === 'cleaner') {
    return resolveCleanerVariables({ booking, stayTarget });
  }
  if (isGuestAccessRuleKey(ruleKey)) {
    return resolveGuestAccessVariables({ booking, stayTarget, propertyKind });
  }
  return resolveGuestVariables({ booking, stayTarget });
}

module.exports = {
  resolveVariables,
  resolveGuestVariables,
  resolveGuestAccessVariables,
  resolveCleanerVariables,
  CLEANER_FORBIDDEN_GUEST_PII_KEYS,
  ARRIVAL_WINDOW_FALLBACK
};
