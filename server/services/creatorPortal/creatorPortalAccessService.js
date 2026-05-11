const crypto = require('crypto');
const CreatorPartner = require('../../models/CreatorPartner');
const CreatorPortalAccess = require('../../models/CreatorPortalAccess');
const { issueSessionToken } = require('./creatorPortalSession');

function hashPortalToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken), 'utf8').digest('hex');
}

function getPublicAppBaseUrl() {
  const u = process.env.APP_URL || process.env.VITE_APP_URL || 'http://localhost:5173';
  return String(u).replace(/\/$/, '');
}

function getApiBaseUrl() {
  const u = process.env.CREATOR_PORTAL_API_PUBLIC_URL || process.env.PUBLIC_API_URL;
  if (u && String(u).trim()) return String(u).trim().replace(/\/$/, '');
  return getPublicAppBaseUrl();
}

function getMagicLinkTtlMs() {
  const h = Number(process.env.CREATOR_PORTAL_LINK_TTL_HOURS || 48);
  const hours = Number.isFinite(h) && h >= 1 && h <= 168 ? h : 48;
  return hours * 60 * 60 * 1000;
}

/**
 * OPS-only: create a single-use magic link row. Revokes other active links for this partner.
 * @returns {{ verifyUrl: string, expiresAt: string, creatorPartnerId: string }}
 */
async function createCreatorPortalAccessLink(creatorPartnerId, actor, { sentToEmail = null } = {}) {
  const partner = await CreatorPartner.findById(creatorPartnerId).select('_id status').lean();
  if (!partner) {
    const err = new Error('Creator partner not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (partner.status === 'draft') {
    const err = new Error('Creator portal link cannot be issued for draft partners');
    err.code = 'INVALID_STATUS';
    throw err;
  }

  await CreatorPortalAccess.updateMany(
    { creatorPartnerId: partner._id, status: 'active' },
    { $set: { status: 'revoked', revokedAt: new Date() } }
  );

  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashPortalToken(rawToken);
  const expiresAt = new Date(Date.now() + getMagicLinkTtlMs());

  await CreatorPortalAccess.create({
    creatorPartnerId: partner._id,
    tokenHash,
    status: 'active',
    expiresAt,
    createdBy: actor || null,
    sentToEmail: sentToEmail ? String(sentToEmail).trim().toLowerCase() : null
  });

  const apiBase = getApiBaseUrl();
  const verifyUrl = `${apiBase}/api/creator-portal/verify?token=${encodeURIComponent(rawToken)}`;

  return {
    verifyUrl,
    expiresAt: expiresAt.toISOString(),
    creatorPartnerId: String(partner._id)
  };
}

/**
 * Exchange magic token for session (single-use). Does not set cookies — caller sets cookie.
 * @returns {{ ok: boolean, creatorPartnerId?: string, session?: { token: string, maxAgeMs: number }, code?: string }}
 */
async function exchangeMagicTokenForSession(rawToken) {
  if (!rawToken || typeof rawToken !== 'string' || rawToken.length > 500) {
    return { ok: false, code: 'invalid' };
  }
  const tokenHash = hashPortalToken(rawToken);
  const doc = await CreatorPortalAccess.findOne({ tokenHash }).lean();
  if (!doc) return { ok: false, code: 'invalid' };
  if (doc.status === 'used') return { ok: false, code: 'used' };
  if (doc.status !== 'active') return { ok: false, code: 'invalid' };
  if (doc.revokedAt) return { ok: false, code: 'invalid' };
  if (doc.usedAt) return { ok: false, code: 'used' };
  if (new Date(doc.expiresAt).getTime() <= Date.now()) {
    await CreatorPortalAccess.updateOne(
      { _id: doc._id },
      { $set: { status: 'expired', lastUsedAt: new Date() } }
    );
    return { ok: false, code: 'expired' };
  }

  const partner = await CreatorPartner.findById(doc.creatorPartnerId).select('_id status').lean();
  if (!partner || partner.status === 'draft') {
    await CreatorPortalAccess.updateOne({ _id: doc._id }, { $set: { status: 'revoked', revokedAt: new Date() } });
    return { ok: false, code: 'invalid' };
  }

  const now = new Date();
  const used = await CreatorPortalAccess.findOneAndUpdate(
    { _id: doc._id, status: 'active', usedAt: null },
    { $set: { status: 'used', usedAt: now, lastUsedAt: now } },
    { new: true }
  ).lean();

  if (!used) return { ok: false, code: 'used' };

  try {
    const session = issueSessionToken(String(partner._id));
    return { ok: true, creatorPartnerId: String(partner._id), session };
  } catch {
    await CreatorPortalAccess.updateOne(
      { _id: used._id },
      { $set: { status: 'active', usedAt: null, lastUsedAt: null } }
    );
    return { ok: false, code: 'invalid' };
  }
}

module.exports = {
  hashPortalToken,
  createCreatorPortalAccessLink,
  exchangeMagicTokenForSession,
  getMagicLinkTtlMs
};
