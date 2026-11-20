'use strict';

const CabinPriorityList = require('../../models/CabinPriorityList');
const { deliverBoth } = require('./deliveryService');

const MONTHS = Object.freeze([
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_LENGTH = 500;

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

function pickString(value, max = 300) {
  if (value == null) return null;
  const next = String(value).trim();
  if (!next) return null;
  return next.slice(0, max);
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function validateCabinPriorityList(body = {}) {
  if (String(body.website || body.companyWebsite || '').trim()) {
    return { honeypot: true };
  }

  const errors = {};
  const email = normalizeEmail(body.email);
  if (!email) errors.email = 'Email is required.';
  else if (email.length > 254 || !EMAIL_RE.test(email)) errors.email = 'Enter a valid email address.';

  if (body.consent !== true && body.consent !== 'true') {
    errors.consent = 'Consent is required.';
  }

  const language = body.language === 'bg' ? 'bg' : 'en';

  const preferredMonth = pickString(body.preferredMonth, 20);
  const normalizedMonth = preferredMonth ? preferredMonth.toLowerCase() : null;
  if (normalizedMonth && normalizedMonth !== 'flexible' && !MONTHS.includes(normalizedMonth)) {
    errors.preferredMonth = 'Choose a valid month.';
  }

  let checkIn = null;
  let checkOut = null;
  if (body.checkIn || body.checkOut) {
    checkIn = parseDate(body.checkIn);
    checkOut = parseDate(body.checkOut);
    if (!checkIn || !checkOut) errors.dates = 'Choose a valid check-in and check-out date.';
    else if (checkOut <= checkIn) errors.dates = 'Check-out must be after check-in.';
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  const sourcePath = pickString(body.sourcePath || body.sourceUrl, MAX_LENGTH);
  const sourcePage = pickString(body.sourcePage, 100);
  const rawAttribution = body.attribution && typeof body.attribution === 'object'
    ? body.attribution
    : {};

  return {
    ok: true,
    value: {
      email,
      cabinId: 'the-cabin',
      preferredMonth: normalizedMonth,
      checkIn,
      checkOut,
      language,
      sourcePath,
      sourcePage,
      attribution: {
        utmSource: pickString(rawAttribution.utmSource || body.utmSource),
        utmMedium: pickString(rawAttribution.utmMedium || body.utmMedium),
        utmCampaign: pickString(rawAttribution.utmCampaign || body.utmCampaign),
        referrer: pickString(rawAttribution.referrer || body.referrer, MAX_LENGTH),
        landingPath: pickString(rawAttribution.landingPath || body.landingPath, MAX_LENGTH)
      }
    }
  };
}

function preferenceUpdate(value, now) {
  return {
    preferredMonth: value.preferredMonth,
    checkIn: value.checkIn,
    checkOut: value.checkOut,
    language: value.language,
    sourcePath: value.sourcePath,
    sourcePage: value.sourcePage,
    attribution: value.attribution,
    consent: true,
    consentAt: now
  };
}

function freshPendingLane() {
  return {
    status: 'pending',
    attempts: 0,
    claimedAt: null,
    nextAttemptAt: null,
    attemptedAt: null,
    sentAt: null,
    lastError: null
  };
}

async function createCabinPriorityList(body, { emailService = null } = {}) {
  const validated = validateCabinPriorityList(body);
  if (!validated.ok || validated.honeypot) return validated;

  const value = validated.value;
  const now = new Date();
  const existing = await CabinPriorityList.findOne({ email: value.email, cabinId: value.cabinId });

  if (existing) {
    existing.set(preferenceUpdate(value, now));

    if (existing.status === 'unsubscribed') {
      // Explicit re-opt-in: restore consent and allow exactly one new welcome email.
      existing.status = 'active';
      existing.unsubscribedAt = null;
      existing.set('guestEmail', freshPendingLane());
      existing.set('emailDelivery', freshPendingLane());
      await existing.save();
      await deliverBoth(existing._id, { emailService });
      return { ok: true, duplicate: false, rejoined: true, id: existing._id };
    }

    await existing.save();
    return { ok: true, duplicate: true, id: existing._id };
  }

  let lead;
  try {
    lead = await CabinPriorityList.create({
      ...value,
      consent: true,
      consentAt: now,
      status: 'active',
      guestEmail: freshPendingLane(),
      emailDelivery: freshPendingLane()
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const duplicate = await CabinPriorityList.findOne({ email: value.email, cabinId: value.cabinId });
    if (!duplicate) throw error;
    return { ok: true, duplicate: true, id: duplicate._id };
  }

  await deliverBoth(lead._id, { emailService });
  return { ok: true, duplicate: false, id: lead._id };
}

module.exports = {
  MONTHS,
  normalizeEmail,
  validateCabinPriorityList,
  createCabinPriorityList
};
