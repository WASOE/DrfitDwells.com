'use strict';

/**
 * Canonical server/.env bootstrap for standalone Node processes.
 * Path is resolved from this module (__dirname), never process.cwd().
 *
 * Precedence:
 *   1) Existing non-empty process.env
 *   2) Test-only options.envPath
 *   3) Absolute <repo>/server/.env
 *   4) No production root-.env fallback
 *
 * dotenv is always called with override: false.
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

let _loadedOnce = false;
let _lastResult = null;

function isNonEmptyEnvValue(value) {
  if (value === undefined || value === null) return false;
  return String(value).trim().length > 0;
}

function resolveServerEnvPath(options = {}) {
  if (options.envPath != null && String(options.envPath).trim()) {
    const raw = String(options.envPath).trim();
    return path.isAbsolute(raw) ? raw : path.resolve(raw);
  }
  // server/config → server/.env
  return path.join(__dirname, '..', '.env');
}

function resolveReleaseId(env = process.env) {
  const candidates = [
    env.APP_RELEASE,
    env.RELEASE_VERSION,
    env.RELEASE_SHA,
    env.GIT_COMMIT,
    env.npm_package_version
  ];
  for (const c of candidates) {
    if (!isNonEmptyEnvValue(c)) continue;
    const s = String(c).trim();
    return s.length > 64 ? s.slice(0, 64) : s;
  }
  return null;
}

function presenceFlags(env) {
  return {
    smtpHostPresent: isNonEmptyEnvValue(env.SMTP_HOST),
    smtpUrlPresent: isNonEmptyEnvValue(env.SMTP_URL),
    mongoUriPresent:
      isNonEmptyEnvValue(env.MONGODB_URI) || isNonEmptyEnvValue(env.MONGO_URI),
    mongoUriSource: isNonEmptyEnvValue(env.MONGODB_URI)
      ? 'MONGODB_URI'
      : isNonEmptyEnvValue(env.MONGO_URI)
        ? 'MONGO_URI'
        : 'missing',
    emailDeliveryRequiredPresent: isNonEmptyEnvValue(env.EMAIL_DELIVERY_REQUIRED),
    emailFromPresent: isNonEmptyEnvValue(env.EMAIL_FROM)
  };
}

/**
 * @param {object} [options]
 * @returns {{
 *   loaded: boolean,
 *   path: string,
 *   missing: boolean,
 *   keysLoaded: number,
 *   skippedNonEmptyProcessEnv: number,
 *   nodeEnv: string|null,
 *   source: string,
 *   presence: object
 * }}
 */
function loadServerEnv(options = {}) {
  const env = options.env || process.env;
  const nodeEnv =
    options.nodeEnv !== undefined && options.nodeEnv !== null
      ? String(options.nodeEnv)
      : env.NODE_ENV != null
        ? String(env.NODE_ENV)
        : null;

  if (_loadedOnce && options.forceReload !== true) {
    return {
      ...(_lastResult || {
        loaded: false,
        path: resolveServerEnvPath(options),
        missing: true,
        keysLoaded: 0,
        skippedNonEmptyProcessEnv: 0,
        nodeEnv,
        source: 'idempotent_noop',
        presence: presenceFlags(env)
      }),
      presence: presenceFlags(env),
      nodeEnv
    };
  }

  const envPath = resolveServerEnvPath(options);
  const fileExists = fs.existsSync(envPath);

  // Production must never fall back to repository-root .env.
  // (This loader never considers root .env at all.)
  let keysLoaded = 0;
  let skippedNonEmptyProcessEnv = 0;
  let loaded = false;
  let source = 'none';

  if (fileExists) {
    const parsed = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (isNonEmptyEnvValue(env[key])) {
        skippedNonEmptyProcessEnv += 1;
        continue;
      }
      // Treat empty / whitespace process.env as absent: allow file to fill.
      // (Stock dotenv override:false would leave "" blocking the file value.)
      if (env[key] === undefined || env[key] === null || String(env[key]).trim() === '') {
        env[key] = value;
        keysLoaded += 1;
      } else {
        skippedNonEmptyProcessEnv += 1;
      }
    }
    // When applying to the real process.env, also call dotenv.config(override:false)
    // so any keys we intentionally skipped (non-empty) remain authoritative.
    if (env === process.env) {
      dotenv.config({ path: envPath, override: false });
    }
    loaded = true;
    source = options.envPath ? 'test_envPath' : 'server_dotenv';
  } else {
    source = 'missing_file';
  }

  _loadedOnce = true;
  _lastResult = {
    loaded,
    path: envPath,
    missing: !fileExists,
    keysLoaded,
    skippedNonEmptyProcessEnv,
    nodeEnv,
    source,
    presence: presenceFlags(env)
  };
  return { ..._lastResult };
}

function __resetLoadServerEnvForTesting() {
  _loadedOnce = false;
  _lastResult = null;
}

module.exports = {
  loadServerEnv,
  resolveServerEnvPath,
  resolveReleaseId,
  isNonEmptyEnvValue,
  __resetLoadServerEnvForTesting
};
