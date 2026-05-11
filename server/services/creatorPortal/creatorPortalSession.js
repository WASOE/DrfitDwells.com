const crypto = require('crypto');

const COOKIE_NAME = 'dd_creator_portal_sess';

function getSessionSecret() {
  const s = process.env.CREATOR_PORTAL_SESSION_SECRET;
  if (s && String(s).trim()) return String(s).trim();
  if (process.env.NODE_ENV !== 'production') {
    const defaults = require('../../config/defaults');
    return `${defaults.adminJwtSecret}-creator-portal-dev`;
  }
  return null;
}

function createSignedPayload(payloadObj, secret) {
  const payloadBase64 = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payloadBase64).digest('hex');
  return `${payloadBase64}.${signature}`;
}

function verifySignedPayload(token, secret) {
  try {
    const [payloadBase64, signature] = String(token).split('.');
    if (!payloadBase64 || !signature) return null;
    const computed = crypto.createHmac('sha256', secret).update(payloadBase64).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(computed, 'hex'))) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString());
    const tv = process.env.CREATOR_PORTAL_TOKEN_VERSION || '1';
    if (String(payload.tv || '1') !== String(tv)) return null;
    if (payload.exp && Math.floor(Date.now() / 1000) > Number(payload.exp)) return null;
    if (!payload.cp || !String(payload.cp).trim()) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookieHeader(req) {
  const raw = req.headers?.cookie;
  if (!raw || typeof raw !== 'string') return {};
  const out = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = decodeURIComponent(part.slice(idx + 1).trim());
    out[k] = v;
  }
  return out;
}

function readPortalSessionCookie(req) {
  const cookies = parseCookieHeader(req);
  return cookies[COOKIE_NAME] || null;
}

function getSessionMaxAgeMs() {
  const days = Number(process.env.CREATOR_PORTAL_SESSION_DAYS || 14);
  const d = Number.isFinite(days) && days >= 1 && days <= 30 ? days : 14;
  return d * 24 * 60 * 60 * 1000;
}

function issueSessionToken(creatorPartnerId) {
  const secret = getSessionSecret();
  if (!secret) throw new Error('CREATOR_PORTAL_SESSION_SECRET is required in production');
  const maxAgeMs = getSessionMaxAgeMs();
  const exp = Math.floor(Date.now() / 1000) + Math.floor(maxAgeMs / 1000);
  return {
    token: createSignedPayload(
      { cp: String(creatorPartnerId), exp, tv: process.env.CREATOR_PORTAL_TOKEN_VERSION || '1' },
      secret
    ),
    maxAgeMs
  };
}

function verifySessionToken(token) {
  const secret = getSessionSecret();
  if (!secret) return null;
  return verifySignedPayload(token, secret);
}

function appendSetCookie(res, cookieString) {
  const prev = res.getHeader('Set-Cookie');
  if (!prev) {
    res.setHeader('Set-Cookie', cookieString);
  } else if (Array.isArray(prev)) {
    res.setHeader('Set-Cookie', [...prev, cookieString]);
  } else {
    res.setHeader('Set-Cookie', [prev, cookieString]);
  }
}

function setPortalSessionCookie(res, sessionToken, maxAgeMs) {
  const secure = process.env.NODE_ENV === 'production';
  const domain = process.env.CREATOR_PORTAL_COOKIE_DOMAIN
    ? String(process.env.CREATOR_PORTAL_COOKIE_DOMAIN).trim()
    : '';
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(sessionToken)}`,
    'Path=/',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
    'HttpOnly',
    'SameSite=Lax'
  ];
  if (secure) parts.push('Secure');
  if (domain) parts.push(`Domain=${domain}`);
  appendSetCookie(res, parts.join('; '));
}

function clearPortalSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production';
  const domain = process.env.CREATOR_PORTAL_COOKIE_DOMAIN
    ? String(process.env.CREATOR_PORTAL_COOKIE_DOMAIN).trim()
    : '';
  const parts = [`${COOKIE_NAME}=`, 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax'];
  if (secure) parts.push('Secure');
  if (domain) parts.push(`Domain=${domain}`);
  appendSetCookie(res, parts.join('; '));
}

module.exports = {
  COOKIE_NAME,
  getSessionSecret,
  readPortalSessionCookie,
  issueSessionToken,
  verifySessionToken,
  setPortalSessionCookie,
  clearPortalSessionCookie,
  getSessionMaxAgeMs
};
