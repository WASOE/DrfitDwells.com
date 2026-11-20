'use strict';

const CabinPriorityList = require('../../models/CabinPriorityList');
const { buildCabinWelcomeEmail } = require('./welcomeEmail');
const { issueUnsubscribeToken } = require('./unsubscribeTokenService');

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000];
const SITE_ORIGIN = (process.env.PUBLIC_SITE_URL || 'https://driftdwells.com').replace(/\/$/, '');

const LANES = Object.freeze({
  guest: { field: 'guestEmail', statuses: ['pending', 'failed'] },
  admin: { field: 'emailDelivery', statuses: ['pending', 'failed'] }
});

function nextAttemptDelay(attempts) {
  const idx = Math.min(Math.max(attempts - 1, 0), BACKOFF_MS.length - 1);
  return BACKOFF_MS[idx];
}

async function claimLane({ id, lane, now = new Date() }) {
  const config = LANES[lane];
  if (!config) throw new Error('Unknown delivery lane');
  return CabinPriorityList.findOneAndUpdate(
    {
      _id: id,
      [`${config.field}.status`]: { $in: config.statuses },
      [`${config.field}.attempts`]: { $lt: MAX_ATTEMPTS },
      $or: [
        { [`${config.field}.nextAttemptAt`]: null },
        { [`${config.field}.nextAttemptAt`]: { $exists: false } },
        { [`${config.field}.nextAttemptAt`]: { $lte: now } }
      ]
    },
    {
      $set: {
        [`${config.field}.status`]: 'sending',
        [`${config.field}.claimedAt`]: now,
        [`${config.field}.attemptedAt`]: now,
        [`${config.field}.lastError`]: null
      },
      $inc: { [`${config.field}.attempts`]: 1 }
    },
    { new: true }
  );
}

async function markLaneSent(id, lane, now = new Date()) {
  const { field } = LANES[lane];
  await CabinPriorityList.updateOne(
    { _id: id, [`${field}.status`]: 'sending' },
    {
      $set: {
        [`${field}.status`]: 'sent',
        [`${field}.sentAt`]: now,
        [`${field}.claimedAt`]: null,
        [`${field}.nextAttemptAt`]: null,
        [`${field}.lastError`]: null
      }
    }
  );
}

async function markLaneFailed(id, lane, error, { now = new Date() } = {}) {
  const { field } = LANES[lane];
  const current = await CabinPriorityList.findById(id).select(`${field}.attempts`).lean();
  const attempts = Number(current?.[field]?.attempts) || 1;
  const terminal = attempts >= MAX_ATTEMPTS;
  await CabinPriorityList.updateOne(
    { _id: id, [`${field}.status`]: 'sending' },
    {
      $set: {
        [`${field}.status`]: 'failed',
        [`${field}.claimedAt`]: null,
        [`${field}.lastError`]: String(error || 'send_failed').slice(0, 500),
        [`${field}.nextAttemptAt`]: terminal ? null : new Date(now.getTime() + nextAttemptDelay(attempts)),
        [`${field}.terminal`]: terminal
      }
    }
  );
  return { terminal };
}

function isSentResult(result) {
  return Boolean(result?.success) && result.method === 'sent';
}

function sentResultError(result) {
  if (result?.method === 'logged') return 'email_transport_logged_not_sent';
  return result?.error || `Email not sent (${result?.method || 'unknown'})`;
}

function adminContent(lead) {
  const date = (d) => (d ? new Date(d).toISOString().slice(0, 10) : 'not provided');
  const lines = [
    `Email: ${lead.email}`,
    `Cabin: ${lead.cabinId}`,
    `Preferred month: ${lead.preferredMonth || 'flexible / not specified'}`,
    `Selected dates: ${lead.checkIn && lead.checkOut ? `${date(lead.checkIn)} to ${date(lead.checkOut)}` : 'not provided'}`,
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
      .map((line) => `<li>${String(line).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</li>`)
      .join('')}</ul>`
  };
}

async function deliverGuestEmail(id, { emailService, language } = {}) {
  const claimed = await claimLane({ id, lane: 'guest' });
  if (!claimed) return { skipped: true };
  const lead = claimed.toObject ? claimed.toObject() : claimed;
  if (lead.status !== 'active') {
    await CabinPriorityList.updateOne(
      { _id: id },
      { $set: { 'guestEmail.status': 'none', 'guestEmail.lastError': 'unsubscribed' } }
    );
    return { skipped: true, reason: 'unsubscribed' };
  }
  try {
    const rawToken = await issueUnsubscribeToken({
      email: lead.email,
      cabinId: lead.cabinId,
      language: lead.language
    });
    const unsubscribeUrl = `${SITE_ORIGIN}/cabin-priority/unsubscribe/${rawToken}`;
    const content = buildCabinWelcomeEmail({
      lead,
      unsubscribeUrl,
      language: language || lead.language
    });
    const service = emailService || require('../emailService');
    const result = await service.sendEmail({
      to: lead.email,
      subject: content.subject,
      html: content.html,
      text: content.text,
      trigger: 'cabin_priority_welcome',
      skipIdempotencyWindow: true,
      omitBodyFromLogs: true
    });
    if (!isSentResult(result)) throw new Error(sentResultError(result));
    await markLaneSent(id, 'guest');
    return { status: 'sent' };
  } catch (error) {
    await markLaneFailed(id, 'guest', error?.message || error);
    return { status: 'failed', error: error?.message || String(error) };
  }
}

async function deliverAdminEmail(id, { emailService } = {}) {
  const claimed = await claimLane({ id, lane: 'admin' });
  if (!claimed) return { skipped: true };
  const lead = claimed.toObject ? claimed.toObject() : claimed;
  try {
    const content = adminContent(lead);
    const service = emailService || require('../emailService');
    const result = await service.sendEmail({
      to: 'jose@driftdwells.com',
      subject: content.subject,
      text: content.text,
      html: content.html,
      trigger: 'cabin_priority_list_admin',
      skipIdempotencyWindow: true,
      omitBodyFromLogs: true
    });
    if (!isSentResult(result)) throw new Error(sentResultError(result));
    await markLaneSent(id, 'admin');
    return { status: 'sent' };
  } catch (error) {
    await markLaneFailed(id, 'admin', error?.message || error);
    return { status: 'failed', error: error?.message || String(error) };
  }
}

async function deliverBoth(id, { emailService } = {}) {
  const [guest, admin] = await Promise.all([
    deliverGuestEmail(id, { emailService }),
    deliverAdminEmail(id, { emailService })
  ]);
  return { guest, admin };
}

module.exports = {
  MAX_ATTEMPTS,
  LANES,
  nextAttemptDelay,
  claimLane,
  markLaneSent,
  markLaneFailed,
  deliverGuestEmail,
  deliverAdminEmail,
  deliverBoth,
  isSentResult,
  sentResultError
};
