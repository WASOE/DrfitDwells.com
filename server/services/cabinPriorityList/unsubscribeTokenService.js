'use strict';

const crypto = require('crypto');
const CabinPriorityUnsubscribeToken = require('../../models/CabinPriorityUnsubscribeToken');

const TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

async function issueUnsubscribeToken({ email, cabinId = 'the-cabin', language = 'en', now = new Date() }) {
  const raw = crypto.randomBytes(32).toString('base64url');
  await CabinPriorityUnsubscribeToken.create({
    tokenHash: hashToken(raw),
    emailNormalized: String(email).trim().toLowerCase(),
    cabinId,
    language: language === 'bg' ? 'bg' : 'en',
    expiresAt: new Date(now.getTime() + TOKEN_TTL_MS)
  });
  return raw;
}

async function resolveUnsubscribeToken(raw, { now = new Date() } = {}) {
  if (!raw || String(raw).length < 20) return { ok: false, reason: 'invalid_token' };
  const doc = await CabinPriorityUnsubscribeToken.findOne({ tokenHash: hashToken(raw) }).lean();
  if (!doc) return { ok: false, reason: 'invalid_token' };
  if (doc.revokedAt) return { ok: false, reason: 'invalid_token' };
  if (doc.expiresAt <= now) return { ok: false, reason: 'expired_token' };
  return {
    ok: true,
    email: doc.emailNormalized,
    cabinId: doc.cabinId,
    language: doc.language,
    tokenId: doc._id
  };
}

async function revokeUnsubscribeToken(tokenId, { now = new Date() } = {}) {
  if (!tokenId) return;
  await CabinPriorityUnsubscribeToken.updateOne(
    { _id: tokenId, revokedAt: null },
    { $set: { revokedAt: now, lastUsedAt: now } }
  );
}

module.exports = {
  TOKEN_TTL_MS,
  hashToken,
  issueUnsubscribeToken,
  resolveUnsubscribeToken,
  revokeUnsubscribeToken
};
