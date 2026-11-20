'use strict';

const CabinPriorityList = require('../../models/CabinPriorityList');

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

function formatDate(date) {
  if (!date) return null;
  return new Date(date).toISOString().slice(0, 10);
}

function notificationPayload(lead) {
  const lines = [
    `Email: ${lead.email}`,
    `Cabin: ${lead.cabinId}`,
    `Preferred month: ${lead.preferredMonth || 'flexible / not specified'}`,
    `Selected dates: ${
      lead.checkIn && lead.checkOut
        ? `${formatDate(lead.checkIn)} to ${formatDate(lead.checkOut)}`
        : 'not provided'
    }`,
    `Language: ${lead.language}`,
    `Source: ${lead.sourcePage || 'unknown'} ${lead.sourcePath || ''}`.trim(),
    `UTM source: ${lead.attribution?.utmSource || '-'}`,
    `UTM medium: ${lead.attribution?.utmMedium || '-'}`,
    `UTM campaign: ${lead.attribution?.utmCampaign || '-'}`,
    `Landing path: ${lead.attribution?.landingPath || '-'}`,
    `Consent: ${lead.consent ? 'yes' : 'no'} at ${new Date(lead.consentAt).toISOString()}`
  ];
  return {
    subject: 'New Cabin priority list signup',
    text: lines.join('\n'),
    html: `<h2>New Cabin priority list signup</h2><ul>${lines
      .map((line) => `<li>${line.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</li>`)
      .join('')}</ul>`
  };
}

async function sendSignupNotification(lead, emailService) {
  const service = emailService || require('../emailService');
  const payload = notificationPayload(lead);
  try {
    const result = await service.sendEmail({
      to: 'jose@driftdwells.com',
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
      trigger: 'cabin_priority_list',
      skipIdempotencyWindow: true,
      omitBodyFromLogs: true
    });
    const sent = Boolean(result?.success) && result.method === 'sent';
    return sent
      ? { status: 'sent' }
      : { status: 'failed', error: result?.error || `Email not sent (${result?.method || 'unknown'})` };
  } catch (error) {
    return { status: 'failed', error: String(error?.message || error).slice(0, 500) };
  }
}

async function createCabinPriorityList(body, { emailService = null } = {}) {
  const validated = validateCabinPriorityList(body);
  if (!validated.ok || validated.honeypot) return validated;

  const value = validated.value;
  const now = new Date();

  let lead = await CabinPriorityList.findOne({ email: value.email, cabinId: value.cabinId });
  let created = false;

  if (lead) {
    Object.assign(lead, {
      preferredMonth: value.preferredMonth,
      checkIn: value.checkIn,
      checkOut: value.checkOut,
      language: value.language,
      sourcePath: value.sourcePath,
      sourcePage: value.sourcePage,
      attribution: value.attribution,
      consent: true,
      consentAt: lead.consentAt || now
    });
    await lead.save();
    return { ok: true, duplicate: true, id: lead._id };
  }

  try {
    lead = await CabinPriorityList.create({
      ...value,
      consent: true,
      consentAt: now
    });
    created = true;
  } catch (error) {
    if (error?.code !== 11000) throw error;
    lead = await CabinPriorityList.findOne({ email: value.email, cabinId: value.cabinId });
    if (!lead) throw error;
    return { ok: true, duplicate: true, id: lead._id };
  }

  // Save first. A notification failure must never erase the lead or fail the request.
  if (created) {
    const delivery = await sendSignupNotification(lead, emailService);
    lead.emailDelivery = {
      status: delivery.status,
      attemptedAt: new Date(),
      sentAt: delivery.status === 'sent' ? new Date() : undefined,
      lastError: delivery.error
    };
    await lead.save();
  }

  return { ok: true, duplicate: false, id: lead._id };
}

module.exports = {
  MONTHS,
  normalizeEmail,
  validateCabinPriorityList,
  createCabinPriorityList
};
