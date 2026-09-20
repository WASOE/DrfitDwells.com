const crypto = require('crypto');
const mongoose = require('mongoose');
const { createToken } = require('../../middleware/adminAuth');
const { verifyOpsUserCredentials } = require('./opsUserService');
const { normalizeModulesForRole, getDefaultRoute } = require('./opsModuleRegistry');
const { listAllowedActions } = require('../permissionService');
const authDefaults = require('../../config/defaults');
const OpsUser = require('../../models/OpsUser');

function normalizeSessionLocale(locale) {
  if (locale === 'en' || locale === 'bg') {
    return locale;
  }
  return null;
}

async function loadOpsUserLocale(userId) {
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    return null;
  }
  try {
    const doc = await OpsUser.findById(userId).select('locale').lean();
    return normalizeSessionLocale(doc?.locale);
  } catch {
    return null;
  }
}

function buildTokenPayloadForOpsUser(user) {
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = 24 * 60 * 60;
  return {
    sub: user.id,
    role: user.role,
    modules: user.modules,
    src: 'ops_user',
    tv: String(process.env.ADMIN_TOKEN_VERSION || '1'),
    tvUser: user.tokenVersion,
    iat: now,
    exp: now + ttlSeconds,
    jti: crypto.randomBytes(16).toString('hex')
  };
}

function buildTokenPayloadForLegacy(role, subject) {
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = 24 * 60 * 60;
  return {
    sub: subject,
    role,
    modules: normalizeModulesForRole(role),
    src: 'legacy_env',
    tv: String(process.env.ADMIN_TOKEN_VERSION || '1'),
    iat: now,
    exp: now + ttlSeconds,
    jti: crypto.randomBytes(16).toString('hex')
  };
}

async function tryOpsUserLogin(username, password) {
  return verifyOpsUserCredentials(username, password);
}

function issueTokenResponse(res, payload) {
  const jwtSecret = process.env.ADMIN_JWT_SECRET || authDefaults.adminJwtSecret;
  const token = createToken(payload, jwtSecret);
  return res.json({
    success: true,
    token,
    role: payload.role,
    modules: payload.modules,
    expiresIn: payload.exp - payload.iat
  });
}

function buildSessionData(user) {
  const role = user.role;
  const modules = user.modules || normalizeModulesForRole(role);
  return {
    authenticated: true,
    actorId: user.id,
    role,
    modules,
    actions: listAllowedActions({ role, modules }),
    defaultRoute: getDefaultRoute(role),
    locale: normalizeSessionLocale(user.locale)
  };
}

async function buildSessionDataForRequest(authUser, options = {}) {
  const loadLocale = options.loadLocale || loadOpsUserLocale;
  const locale =
    authUser?.src === 'ops_user' ? await loadLocale(authUser.id) : normalizeSessionLocale(authUser?.locale);
  return buildSessionData({ ...authUser, locale });
}

module.exports = {
  buildTokenPayloadForOpsUser,
  buildTokenPayloadForLegacy,
  tryOpsUserLogin,
  issueTokenResponse,
  buildSessionData,
  buildSessionDataForRequest,
  loadOpsUserLocale,
  normalizeSessionLocale
};
