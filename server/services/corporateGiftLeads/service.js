'use strict';

const crypto = require('node:crypto');
const CorporateGiftLead = require('../../models/CorporateGiftLead');
const OpsUser = require('../../models/OpsUser');
const OpsNotification = require('../../models/OpsNotification');
const { validateCorporateGiftLead } = require('./validation');

const LEASE_MS = 5 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;

async function assertUniqueIndexes() {
  const indexes = await CorporateGiftLead.collection.indexes();
  const request = indexes.find((index) => index.unique && index.key?.requestKeys === 1 && Object.keys(index.key).length === 1 && !index.partialFilterExpression);
  const nomination = indexes.find((index) => index.unique && index.key?.nominationKey === 1 &&
    Object.keys(index.key).length === 1 && Object.keys(index.partialFilterExpression || {}).length === 1 &&
    index.partialFilterExpression?.nominationKey?.$type === 'string' &&
    Object.keys(index.partialFilterExpression.nominationKey).length === 1);
  if (!request || !nomination) throw new Error('Required corporate gift lead unique indexes are missing');
}

function nominationKey(company) {
  const normalized = company.normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function requestDigest(input) {
  const { idempotencyKey, attribution, ...content } = input;
  return `${idempotencyKey}:${crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex')}`;
}

function replayResult(lead, digest) {
  if (!lead.requestDigests?.includes(digest)) return { conflict: true };
  return { ok: true, duplicate: true, id: lead._id };
}

async function attemptDelivery(id, lane, { emailService = null, force = false } = {}) {
  if (!['email', 'notification'].includes(lane)) throw new Error('Invalid delivery lane');
  const now = new Date();
  const due = force ? now : new Date(now.getTime() - RETRY_MS);
  const claim = await CorporateGiftLead.findOneAndUpdate({
    _id: id,
    $or: [
      { [`${lane}.status`]: 'pending' },
      { [`${lane}.status`]: 'failed', [`${lane}.claimedAt`]: { $lte: due } },
      { [`${lane}.status`]: 'sending', [`${lane}.claimedAt`]: { $lte: new Date(now.getTime() - LEASE_MS) } }
    ]
  }, {
    $set: { [`${lane}.status`]: 'sending', [`${lane}.claimedAt`]: now },
    $inc: { [`${lane}.attempts`]: 1 }
  }, { new: true }).lean();
  if (!claim) return { skipped: true };

  try {
    if (lane === 'email') {
      const email = emailService || require('../emailService');
      const origin = (process.env.APP_URL || 'https://driftdwells.com').replace(/\/$/, '');
      const url = `${origin}/ops/corporate-gift-leads/${claim._id}`;
      const result = await email.sendEmail({
        to: 'jose@driftdwells.com',
        subject: 'New corporate gift wishlist lead',
        text: `A new corporate gift lead is ready for review.\n${url}`,
        html: `<p>A new corporate gift lead is ready for review.</p><p><a href="${url}">Open lead in Ops</a></p>`,
        trigger: 'corporate_gift_lead', skipIdempotencyWindow: true, omitBodyFromLogs: true
      });
      if (!result?.success || result.method !== 'sent') throw new Error(result?.error || `Email not sent (${result?.method || 'unknown'})`);
    } else {
      const admins = await OpsUser.find({ role: 'admin', isActive: { $ne: false } }).select('_id').lean();
      if (!admins.length) throw new Error('No active admin recipients');
      for (const admin of admins) {
        await OpsNotification.updateOne(
          { opsUserId: admin._id, dedupeKey: `corporate_gift_lead:${claim._id}` },
          { $setOnInsert: {
            title: 'New corporate gift lead', body: 'A corporate gift lead is ready for review.',
            url: `/ops/corporate-gift-leads/${claim._id}`, source: 'corporate_gift_lead',
            pushDeliveryStatus: 'no_subscription'
          } },
          { upsert: true }
        );
      }
    }
    await CorporateGiftLead.updateOne({ _id: id, [`${lane}.status`]: 'sending', [`${lane}.claimedAt`]: now }, {
      $set: { [`${lane}.status`]: 'sent', [`${lane}.sentAt`]: new Date(), [`${lane}.lastError`]: null }
    });
    return { status: 'sent' };
  } catch (error) {
    console.error(`[corporate-gift-leads] ${lane} delivery failed`, error.message);
    await CorporateGiftLead.updateOne({ _id: id, [`${lane}.status`]: 'sending', [`${lane}.claimedAt`]: now }, {
      $set: { [`${lane}.status`]: 'failed', [`${lane}.lastError`]: String(error.message || error).slice(0, 500) }
    });
    return { status: 'failed' };
  }
}

async function createCorporateGiftLead(body, options = {}) {
  const validated = validateCorporateGiftLead(body);
  if (validated.honeypot || !validated.ok) return validated;
  await assertUniqueIndexes();
  const input = validated.value;
  const digest = requestDigest(input);
  const existing = await CorporateGiftLead.findOne({ requestKeys: input.idempotencyKey }).lean();
  if (existing) return replayResult(existing, digest);
  const key = input.type === 'nomination' ? nominationKey(input.company) : undefined;
  let created;
  try {
    created = await CorporateGiftLead.create({
      ...input, nominationKey: key, requestKeys: [input.idempotencyKey], requestDigests: [digest],
      companyWebsites: input.companyWebsite ? [input.companyWebsite] : [],
      hrContacts: input.hrContact ? [input.hrContact] : [],
      hrEmails: input.hrEmail ? [input.hrEmail] : []
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const replay = await CorporateGiftLead.findOne({ requestKeys: input.idempotencyKey }).lean();
    if (replay) return replayResult(replay, digest);
    if (!key) throw error;
    try {
      const update = { requestKeys: input.idempotencyKey, requestDigests: digest };
      if (input.companyWebsite) update.companyWebsites = input.companyWebsite;
      if (input.hrContact) update.hrContacts = input.hrContact;
      if (input.hrEmail) update.hrEmails = input.hrEmail;
      const coalesced = await CorporateGiftLead.findOneAndUpdate(
        { nominationKey: key, requestKeys: { $ne: input.idempotencyKey } }, { $addToSet: update }, { new: true }
      ).lean();
      if (!coalesced) {
        const raced = await CorporateGiftLead.findOne({ requestKeys: input.idempotencyKey }).lean();
        if (raced) return replayResult(raced, digest);
        throw error;
      }
      return { ok: true, duplicate: true, id: coalesced._id };
    } catch (updateError) {
      if (updateError.code !== 11000) throw updateError;
      const raced = await CorporateGiftLead.findOne({ requestKeys: input.idempotencyKey }).lean();
      if (!raced) throw updateError;
      return replayResult(raced, digest);
    }
  }
  for (const lane of ['email', 'notification']) {
    try {
      await attemptDelivery(created._id, lane, options);
    } catch (error) {
      console.error(`[corporate-gift-leads] ${lane} state update failed`, error.message);
    }
  }
  return { ok: true, duplicate: false, id: created._id };
}

async function retryDueDeliveries() {
  for (const lane of ['email', 'notification']) {
    const cutoff = new Date(Date.now() - RETRY_MS);
    const leads = await CorporateGiftLead.find({
      $or: [
        { [`${lane}.status`]: 'pending' },
        { [`${lane}.status`]: { $in: ['failed', 'sending'] }, [`${lane}.claimedAt`]: { $lte: cutoff } }
      ]
    }).select('_id').limit(50).lean();
    for (const lead of leads) await attemptDelivery(lead._id, lane);
  }
}

module.exports = { createCorporateGiftLead, attemptDelivery, retryDueDeliveries, nominationKey };
