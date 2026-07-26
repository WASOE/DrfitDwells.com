'use strict';

/**
 * Shared Mongo connection safety for Batch 5A reporting scripts.
 * - Requires MONGODB_URI or MONGO_URI (no silent localhost default)
 * - Prints sanitized host/database banner to stderr
 * - Gates production --apply behind --confirm-production-write
 */

function getRequiredMongoUriFromEnv(env = process.env) {
  const uri = env.MONGODB_URI || env.MONGO_URI;
  if (!uri || !String(uri).trim()) {
    const err = new Error('ERROR: MONGODB_URI or MONGO_URI is required.');
    err.code = 'MONGO_URI_REQUIRED';
    err.exitCode = 1;
    throw err;
  }
  return String(uri).trim();
}

function isProductionEnv(env = process.env) {
  return env.NODE_ENV === 'production' || env.APP_ENV === 'production';
}

/**
 * When apply=true in production, require confirmProductionWrite.
 * Dry-run never requires confirmation.
 */
function assertProductionApplyAllowed({
  apply = false,
  confirmProductionWrite = false,
  env = process.env
} = {}) {
  if (!apply) return;
  if (!isProductionEnv(env)) return;
  if (confirmProductionWrite) return;
  const err = new Error(
    'ERROR: --confirm-production-write is required with --apply when NODE_ENV or APP_ENV is production.'
  );
  err.code = 'PRODUCTION_WRITE_CONFIRM_REQUIRED';
  err.exitCode = 1;
  throw err;
}

function sanitizeMongoHost(uri) {
  try {
    const normalized = String(uri).replace(/^mongodb(\+srv)?:\/\//i, 'http://');
    const parsed = new URL(normalized);
    return parsed.hostname || 'unknown';
  } catch {
    return 'unknown';
  }
}

function extractDatabaseName(uri) {
  try {
    const normalized = String(uri).replace(/^mongodb(\+srv)?:\/\//i, 'http://');
    const parsed = new URL(normalized);
    const path = (parsed.pathname || '').replace(/^\//, '');
    return path.split('/')[0] || '';
  } catch {
    return '';
  }
}

function resolveScriptMode({ apply = false, readOnly = false } = {}) {
  if (readOnly) return 'read-only';
  return apply ? 'apply' : 'dry-run';
}

function printConnectionBanner({ mongoHost, databaseName, mode }, stream = process.stderr) {
  stream.write(
    `${JSON.stringify(
      {
        mongoHost,
        databaseName,
        mode
      },
      null,
      2
    )}\n`
  );
}

/**
 * Connect with required URI, production apply gate, and stderr banner.
 * Callers must not fall back to DEFAULT_MONGO_URI.
 */
async function connectScriptMongo(
  mongoose,
  {
    mode,
    apply = false,
    confirmProductionWrite = false,
    readOnly = false,
    env = process.env,
    bannerStream = process.stderr
  } = {}
) {
  assertProductionApplyAllowed({ apply, confirmProductionWrite, env });
  const uri = getRequiredMongoUriFromEnv(env);

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 12000 });

  const mongoHost = mongoose.connection.host || sanitizeMongoHost(uri);
  const databaseName = mongoose.connection.name || extractDatabaseName(uri) || '';
  const resolvedMode = mode || resolveScriptMode({ apply, readOnly });

  printConnectionBanner(
    {
      mongoHost,
      databaseName,
      mode: resolvedMode
    },
    bannerStream
  );

  return { uri, mongoHost, databaseName, mode: resolvedMode };
}

function exitFromScriptError(err) {
  const message = err?.message || String(err);
  console.error(message);
  process.exit(Number(err?.exitCode) || 2);
}

module.exports = {
  getRequiredMongoUriFromEnv,
  isProductionEnv,
  assertProductionApplyAllowed,
  sanitizeMongoHost,
  extractDatabaseName,
  resolveScriptMode,
  printConnectionBanner,
  connectScriptMongo,
  exitFromScriptError
};
