'use strict';

const CabinPriorityList = require('../../models/CabinPriorityList');
const {
  resolveUnsubscribeToken
} = require('./unsubscribeTokenService');

async function getUnsubscribeState(rawToken, { now = new Date() } = {}) {
  const token = await resolveUnsubscribeToken(rawToken, { now });
  if (!token.ok) return token;
  const lead = await CabinPriorityList.findOne({
    email: token.email,
    cabinId: token.cabinId
  }).select('status language').lean();
  if (!lead) return { ok: false, reason: 'invalid_token' };
  return {
    ok: true,
    language: lead.language || token.language || 'en',
    status: lead.status,
    alreadyUnsubscribed: lead.status === 'unsubscribed'
  };
}

async function confirmUnsubscribe(rawToken, { now = new Date() } = {}) {
  const token = await resolveUnsubscribeToken(rawToken, { now });
  if (!token.ok) return token;

  const lead = await CabinPriorityList.findOne({
    email: token.email,
    cabinId: token.cabinId
  });
  if (!lead) return { ok: false, reason: 'invalid_token' };

  const already = lead.status === 'unsubscribed';
  if (!already) {
    lead.status = 'unsubscribed';
    lead.unsubscribedAt = now;
    lead.consent = false;
    lead.set('guestEmail.status', 'none');
    lead.set('guestEmail.claimedAt', null);
    lead.set('guestEmail.nextAttemptAt', null);
    lead.set('guestEmail.lastError', 'unsubscribed');
    await lead.save();
  }

  return {
    ok: true,
    idempotent: already,
    language: lead.language || token.language || 'en',
    status: 'unsubscribed'
  };
}

module.exports = {
  getUnsubscribeState,
  confirmUnsubscribe
};
