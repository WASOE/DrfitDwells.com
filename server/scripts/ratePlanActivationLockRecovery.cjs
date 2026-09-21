#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * RP5 — Controlled RatePlan seasonal activation-lock recovery.
 *
 * Manual, fail-closed recovery for the global lock document:
 *   collection: rateplanactivationlocks
 *   _id: seasonal-rateplan-activation
 *
 * No API, UI, automatic expiry indexes, automatic cleanup, lock stealing, retry
 * loop, or background process. Importing this module has no Mongo connection or
 * mutation side effects.
 *
 * Modes (RATEPLAN_ACTIVATION_LOCK_RECOVERY_MODE):
 *   <missing>  → DISABLED (exit 0), no connection
 *   invalid    → INVALID_MODE (exit 78), no connection
 *   inspect    → native read-only inspection
 *   recover    → exact conditional deleteOne after dual-read + auth gates
 *
 * Recover also requires:
 *   RATEPLAN_ACTIVATION_LOCK_RECOVERY_EXECUTE=1
 *   RATEPLAN_ACTIVATION_LOCK_RECOVERY_QUIESCENT=I_CONFIRM_NO_RATEPLAN_ACTIVATION_IS_RUNNING
 *   RATEPLAN_ACTIVATION_LOCK_EXPECTED_FINGERPRINT=<64 lowercase hex>
 *   RATEPLAN_ACTIVATION_LOCK_EXPECTED_ACQUIRED_AT=<exact ISO timestamp>
 */
'use strict';

const crypto = require('crypto');

const MODE_ENV = 'RATEPLAN_ACTIVATION_LOCK_RECOVERY_MODE';
const EXECUTE_ENV = 'RATEPLAN_ACTIVATION_LOCK_RECOVERY_EXECUTE';
const QUIESCENT_ENV = 'RATEPLAN_ACTIVATION_LOCK_RECOVERY_QUIESCENT';
const EXPECTED_FINGERPRINT_ENV = 'RATEPLAN_ACTIVATION_LOCK_EXPECTED_FINGERPRINT';
const EXPECTED_ACQUIRED_AT_ENV = 'RATEPLAN_ACTIVATION_LOCK_EXPECTED_ACQUIRED_AT';

const EXECUTE_ACCEPTED = '1';
const QUIESCENT_ACCEPTED = 'I_CONFIRM_NO_RATEPLAN_ACTIVATION_IS_RUNNING';

const ACTIVATION_LOCK_COLLECTION_NAME = 'rateplanactivationlocks';
const ACTIVATION_LOCK_ID = 'seasonal-rateplan-activation';

/** Domain-separated fingerprint prefix (never includes secrets beyond lock fields). */
const FINGERPRINT_DOMAIN = 'driftdwells:rateplan-activation-lock:v1';

const MIN_LOCK_AGE_MS = 15 * 60 * 1000;
const OBSERVATION_INTERVAL_MS = 30 * 1000;

const OWNER_TOKEN_RE = /^[0-9a-f]{64}$/;
const FINGERPRINT_RE = /^[0-9a-f]{64}$/;

const CLASSIFICATION = Object.freeze({
  DISABLED: 'DISABLED',
  INVALID_MODE: 'INVALID_MODE',
  UNAUTHORIZED: 'UNAUTHORIZED',
  NO_LOCK: 'NO_LOCK',
  LOCK_TOO_YOUNG: 'LOCK_TOO_YOUNG',
  LOCK_RECOVERY_ELIGIBLE: 'LOCK_RECOVERY_ELIGIBLE',
  LOCK_MALFORMED: 'LOCK_MALFORMED',
  INSPECTION_FAILED: 'INSPECTION_FAILED',
  LOCK_CHANGED: 'LOCK_CHANGED',
  LOCK_GONE_BEFORE_DELETE: 'LOCK_GONE_BEFORE_DELETE',
  RECOVERY_COMPLETE: 'RECOVERY_COMPLETE',
  RECOVERY_NOT_COMPLETED: 'RECOVERY_NOT_COMPLETED',
  RECOVERY_OUTCOME_UNCERTAIN: 'RECOVERY_OUTCOME_UNCERTAIN',
  PRE_DELETE_FAILED: 'PRE_DELETE_FAILED'
});

const EXIT = Object.freeze({
  OK: 0,
  ELIGIBLE_OR_TOO_YOUNG: 2,
  FAILURE: 78
});

const WARNING_CODES = Object.freeze({
  FOREIGN_REPLACEMENT_PRESENT: 'FOREIGN_REPLACEMENT_PRESENT',
  VERIFICATION_UNREADABLE: 'VERIFICATION_UNREADABLE'
});

const STANDALONE_CONNECT_OPTIONS = Object.freeze({
  autoIndex: false,
  autoCreate: false
});

function log(event, fields = {}, level = 'info') {
  const line = JSON.stringify({
    event,
    ts: new Date().toISOString(),
    ...fields
  });
  if (level === 'error') console.error(line);
  else console.log(line);
}

function readMode(env) {
  const raw = env[MODE_ENV];
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
}

function isValidOwnerToken(token) {
  return typeof token === 'string' && OWNER_TOKEN_RE.test(token);
}

function isValidFingerprint(fp) {
  return typeof fp === 'string' && FINGERPRINT_RE.test(fp);
}

/**
 * Canonical fingerprint: SHA-256 over domain-separated lines
 * (domain, lockId, ownerToken, acquiredAt ISO).
 */
function computeLockFingerprint({ lockId, ownerToken, acquiredAtIso }) {
  const canonical = [
    FINGERPRINT_DOMAIN,
    String(lockId),
    String(ownerToken),
    String(acquiredAtIso)
  ].join('\n');
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function parseAcquiredAt(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/**
 * Validate lock document shape for recovery/inspect eligibility.
 * @returns {{ ok: true, ownerToken: string, acquiredAt: Date, acquiredAtIso: string, fingerprint: string, ageMs: number } | { ok: false, reason: string }}
 */
function validateLockDocument(doc, nowMs) {
  if (!doc || typeof doc !== 'object') {
    return { ok: false, reason: 'absent' };
  }
  if (String(doc._id) !== ACTIVATION_LOCK_ID) {
    return { ok: false, reason: 'wrong_id' };
  }
  const ownerToken = doc.ownerToken;
  if (!isValidOwnerToken(ownerToken)) {
    return { ok: false, reason: 'bad_owner_token' };
  }
  const acquiredAt = parseAcquiredAt(doc.acquiredAt);
  if (!acquiredAt) {
    return { ok: false, reason: 'bad_acquired_at' };
  }
  const acquiredAtIso = acquiredAt.toISOString();
  const ageMs = nowMs - acquiredAt.getTime();
  if (ageMs < 0) {
    return { ok: false, reason: 'future_acquired_at' };
  }
  const fingerprint = computeLockFingerprint({
    lockId: ACTIVATION_LOCK_ID,
    ownerToken,
    acquiredAtIso
  });
  return {
    ok: true,
    ownerToken,
    acquiredAt,
    acquiredAtIso,
    fingerprint,
    ageMs
  };
}

function safeInspectFields(validated, classification, recoveryEligible, exitCode, extra = {}) {
  return {
    classification,
    recoveryEligible: recoveryEligible === true,
    lockId: ACTIVATION_LOCK_ID,
    acquiredAt: validated ? validated.acquiredAtIso : null,
    ageMs: validated ? validated.ageMs : null,
    lockFingerprint: validated ? validated.fingerprint : null,
    exitCode,
    recoveryComplete: false,
    verificationComplete: false,
    replacementPresent: false,
    warnings: [],
    ...extra
  };
}

function validateRecoverAuthorization(env) {
  const execute = String(env[EXECUTE_ENV] || '').trim();
  const quiescent = String(env[QUIESCENT_ENV] || '').trim();
  const expectedFp = String(env[EXPECTED_FINGERPRINT_ENV] || '').trim();
  const expectedAcquiredAt = String(env[EXPECTED_ACQUIRED_AT_ENV] || '').trim();

  if (execute !== EXECUTE_ACCEPTED) {
    return { ok: false, reason: 'execute' };
  }
  if (quiescent !== QUIESCENT_ACCEPTED) {
    return { ok: false, reason: 'quiescent' };
  }
  if (!isValidFingerprint(expectedFp)) {
    return { ok: false, reason: 'fingerprint' };
  }
  const parsed = parseAcquiredAt(expectedAcquiredAt);
  if (!parsed || parsed.toISOString() !== expectedAcquiredAt) {
    // Require exact ISO round-trip (operator must supply canonical toISOString form).
    return { ok: false, reason: 'acquired_at' };
  }
  return {
    ok: true,
    expectedFingerprint: expectedFp,
    expectedAcquiredAtIso: expectedAcquiredAt
  };
}

function allowlistedWarnings(codes) {
  const out = [];
  for (const code of codes) {
    if (Object.prototype.hasOwnProperty.call(WARNING_CODES, code) ||
        Object.values(WARNING_CODES).includes(code)) {
      out.push({ code });
    }
  }
  return out;
}

function disableMongooseAutoIndexAndAutoCreate(mongoose) {
  if (!mongoose || typeof mongoose.set !== 'function') {
    throw Object.assign(new Error('mongoose.set unavailable'), {
      code: 'CONNECTION_FAILED'
    });
  }
  mongoose.set('autoIndex', false);
  mongoose.set('autoCreate', false);
  return { ...STANDALONE_CONNECT_OPTIONS };
}

/**
 * Core recovery runner. Clock and sleep are injectable (no real waiting in tests).
 *
 * @param {object} [runtime]
 * @param {object} [runtime.env]
 * @param {() => number} [runtime.nowMs]
 * @param {(ms: number) => Promise<void>} [runtime.sleep]
 * @param {(code: number) => void} [runtime.exit]
 * @param {Function} [runtime.log]
 * @param {Function} [runtime.loadMongoose]
 * @param {Function} [runtime.loadServerEnv]
 * @param {Function} [runtime.resolveMongoUri]
 * @param {Function} [runtime.connect]
 * @param {Function} [runtime.disconnect]
 * @param {Function} [runtime.getCollection]
 * @param {Function} [runtime.disableAutoIndexAndAutoCreate]
 */
async function runActivationLockRecovery(runtime = {}) {
  const env = runtime.env || process.env;
  const exitFn = typeof runtime.exit === 'function' ? runtime.exit : (c) => process.exit(c);
  const logFn = typeof runtime.log === 'function' ? runtime.log : log;
  const nowMsFn = typeof runtime.nowMs === 'function' ? runtime.nowMs : () => Date.now();
  const sleepFn =
    typeof runtime.sleep === 'function'
      ? runtime.sleep
      : (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const mode = readMode(env);

  if (!mode) {
    const result = safeInspectFields(null, CLASSIFICATION.DISABLED, false, EXIT.OK, {
      connected: false
    });
    logFn('rateplan_activation_lock_recovery_result', {
      classification: result.classification,
      exitCode: result.exitCode
    });
    exitFn(EXIT.OK);
    return result;
  }

  if (mode !== 'inspect' && mode !== 'recover') {
    const result = safeInspectFields(null, CLASSIFICATION.INVALID_MODE, false, EXIT.FAILURE, {
      connected: false
    });
    logFn('rateplan_activation_lock_recovery_result', {
      classification: result.classification,
      exitCode: result.exitCode
    });
    exitFn(EXIT.FAILURE);
    return result;
  }

  let auth = null;
  if (mode === 'recover') {
    auth = validateRecoverAuthorization(env);
    if (!auth.ok) {
      const result = safeInspectFields(null, CLASSIFICATION.UNAUTHORIZED, false, EXIT.FAILURE, {
        connected: false
      });
      logFn('rateplan_activation_lock_recovery_result', {
        classification: result.classification,
        exitCode: result.exitCode,
        reason: 'authorization'
      });
      exitFn(EXIT.FAILURE);
      return result;
    }
  }

  // --- Connected path (inspect or authorized recover) ---
  let disconnectCount = 0;
  async function disconnectOnce() {
    if (disconnectCount > 0) return;
    disconnectCount += 1;
    if (typeof runtime.disconnect === 'function') {
      try {
        await runtime.disconnect();
      } catch (_err) {
        /* ignore disconnect errors */
      }
    }
  }

  let collection;
  try {
    if (typeof runtime.getCollection === 'function') {
      collection = await runtime.getCollection();
    } else {
      const loadMongoose =
        runtime.loadMongoose || (() => require('mongoose'));
      const mongoose = loadMongoose();
      const loadServerEnv =
        runtime.loadServerEnv ||
        (() => require('../config/loadServerEnv').loadServerEnv);
      loadServerEnv();

      const disable =
        runtime.disableAutoIndexAndAutoCreate ||
        disableMongooseAutoIndexAndAutoCreate;
      disable(mongoose);

      const resolveMongoUri =
        runtime.resolveMongoUri ||
        (() => {
          const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
          return (
            (env.MONGODB_URI && String(env.MONGODB_URI).trim()) ||
            (env.MONGO_URI && String(env.MONGO_URI).trim()) ||
            DEFAULT_MONGO_URI
          );
        });
      const mongoUri = resolveMongoUri();

      const connect =
        runtime.connect ||
        (async () => {
          await mongoose.connect(mongoUri, { ...STANDALONE_CONNECT_OPTIONS });
        });
      await connect();

      if (!runtime.disconnect) {
        runtime.disconnect = async () => {
          await mongoose.disconnect();
        };
      }

      const db = mongoose.connection && mongoose.connection.db;
      if (!db || typeof db.collection !== 'function') {
        throw Object.assign(new Error('native db unavailable'), {
          code: 'DB_UNAVAILABLE'
        });
      }
      collection = db.collection(ACTIVATION_LOCK_COLLECTION_NAME);
    }
  } catch (_err) {
    const result = safeInspectFields(
      null,
      CLASSIFICATION.INSPECTION_FAILED,
      false,
      EXIT.FAILURE,
      { connected: false }
    );
    logFn(
      'rateplan_activation_lock_recovery_result',
      { classification: result.classification, exitCode: result.exitCode },
      'error'
    );
    await disconnectOnce();
    exitFn(EXIT.FAILURE);
    return result;
  }

  try {
    if (mode === 'inspect') {
      return await runInspect({
        collection,
        nowMsFn,
        exitFn,
        logFn,
        disconnectOnce
      });
    }
    return await runRecover({
      collection,
      auth,
      nowMsFn,
      sleepFn,
      exitFn,
      logFn,
      disconnectOnce
    });
  } catch (_err) {
    const result = safeInspectFields(
      null,
      mode === 'recover' ? CLASSIFICATION.PRE_DELETE_FAILED : CLASSIFICATION.INSPECTION_FAILED,
      false,
      EXIT.FAILURE,
      { connected: true }
    );
    logFn(
      'rateplan_activation_lock_recovery_result',
      { classification: result.classification, exitCode: result.exitCode },
      'error'
    );
    await disconnectOnce();
    exitFn(EXIT.FAILURE);
    return result;
  }
}

async function runInspect({ collection, nowMsFn, exitFn, logFn, disconnectOnce }) {
  let doc;
  try {
    doc = await collection.findOne({ _id: ACTIVATION_LOCK_ID });
  } catch (_err) {
    const result = safeInspectFields(
      null,
      CLASSIFICATION.INSPECTION_FAILED,
      false,
      EXIT.FAILURE,
      { connected: true }
    );
    logFn(
      'rateplan_activation_lock_recovery_result',
      { classification: result.classification, exitCode: result.exitCode },
      'error'
    );
    await disconnectOnce();
    exitFn(EXIT.FAILURE);
    return result;
  }

  if (!doc) {
    const result = safeInspectFields(null, CLASSIFICATION.NO_LOCK, false, EXIT.OK, {
      connected: true
    });
    logFn('rateplan_activation_lock_recovery_result', {
      classification: result.classification,
      exitCode: result.exitCode,
      recoveryEligible: false
    });
    await disconnectOnce();
    exitFn(EXIT.OK);
    return result;
  }

  const validated = validateLockDocument(doc, nowMsFn());
  if (!validated.ok) {
    const result = safeInspectFields(
      null,
      CLASSIFICATION.LOCK_MALFORMED,
      false,
      EXIT.FAILURE,
      { connected: true }
    );
    logFn('rateplan_activation_lock_recovery_result', {
      classification: result.classification,
      exitCode: result.exitCode,
      recoveryEligible: false
    });
    await disconnectOnce();
    exitFn(EXIT.FAILURE);
    return result;
  }

  if (validated.ageMs < MIN_LOCK_AGE_MS) {
    const result = safeInspectFields(
      validated,
      CLASSIFICATION.LOCK_TOO_YOUNG,
      false,
      EXIT.ELIGIBLE_OR_TOO_YOUNG,
      { connected: true }
    );
    logFn('rateplan_activation_lock_recovery_result', {
      classification: result.classification,
      exitCode: result.exitCode,
      recoveryEligible: false,
      ageMs: result.ageMs,
      lockFingerprint: result.lockFingerprint,
      acquiredAt: result.acquiredAt
    });
    await disconnectOnce();
    exitFn(EXIT.ELIGIBLE_OR_TOO_YOUNG);
    return result;
  }

  const result = safeInspectFields(
    validated,
    CLASSIFICATION.LOCK_RECOVERY_ELIGIBLE,
    true,
    EXIT.ELIGIBLE_OR_TOO_YOUNG,
    { connected: true }
  );
  logFn('rateplan_activation_lock_recovery_result', {
    classification: result.classification,
    exitCode: result.exitCode,
    recoveryEligible: true,
    ageMs: result.ageMs,
    lockFingerprint: result.lockFingerprint,
    acquiredAt: result.acquiredAt
  });
  await disconnectOnce();
  exitFn(EXIT.ELIGIBLE_OR_TOO_YOUNG);
  return result;
}

/**
 * Interpret delete + verification into the delete-outcome contract.
 * Never treats committed deletion as a retryable failure.
 */
function interpretDeleteOutcome({
  deleteAcknowledged,
  deletedCount,
  deleteThrew,
  verifyDoc,
  verifyThrew,
  expectedOwnerToken
}) {
  const warnings = [];

  const ownerGone = (doc) => {
    if (!doc) return true;
    return String(doc.ownerToken) !== String(expectedOwnerToken);
  };
  const foreignPresent = (doc) => {
    if (!doc) return false;
    return String(doc.ownerToken) !== String(expectedOwnerToken);
  };

  // Committed delete path (deletedCount === 1)
  if (!deleteThrew && deletedCount === 1) {
    if (verifyThrew) {
      return {
        classification: CLASSIFICATION.RECOVERY_COMPLETE,
        exitCode: EXIT.OK,
        recoveryComplete: true,
        verificationComplete: false,
        replacementPresent: false,
        warnings: allowlistedWarnings([WARNING_CODES.VERIFICATION_UNREADABLE]),
        noRetry: true
      };
    }
    if (!verifyDoc) {
      return {
        classification: CLASSIFICATION.RECOVERY_COMPLETE,
        exitCode: EXIT.OK,
        recoveryComplete: true,
        verificationComplete: true,
        replacementPresent: false,
        warnings: [],
        noRetry: true
      };
    }
    if (foreignPresent(verifyDoc)) {
      return {
        classification: CLASSIFICATION.RECOVERY_COMPLETE,
        exitCode: EXIT.OK,
        recoveryComplete: true,
        verificationComplete: true,
        replacementPresent: true,
        warnings: allowlistedWarnings([WARNING_CODES.FOREIGN_REPLACEMENT_PRESENT]),
        noRetry: true
      };
    }
    // Exact owner still present after deletedCount:1 — anomalous; not complete
    return {
      classification: CLASSIFICATION.RECOVERY_NOT_COMPLETED,
      exitCode: EXIT.FAILURE,
      recoveryComplete: false,
      verificationComplete: true,
      replacementPresent: false,
      warnings: [],
      noRetry: true
    };
  }

  // Delete threw or unacknowledged
  if (deleteThrew || deleteAcknowledged === false) {
    if (verifyThrew) {
      return {
        classification: CLASSIFICATION.RECOVERY_OUTCOME_UNCERTAIN,
        exitCode: EXIT.FAILURE,
        recoveryComplete: false,
        verificationComplete: false,
        replacementPresent: false,
        warnings: allowlistedWarnings([WARNING_CODES.VERIFICATION_UNREADABLE]),
        noRetry: true,
        instruction: 'DO_NOT_RETRY_AUTOMATICALLY'
      };
    }
    if (ownerGone(verifyDoc)) {
      if (foreignPresent(verifyDoc)) {
        return {
          classification: CLASSIFICATION.RECOVERY_COMPLETE,
          exitCode: EXIT.OK,
          recoveryComplete: true,
          verificationComplete: true,
          replacementPresent: true,
          warnings: allowlistedWarnings([WARNING_CODES.FOREIGN_REPLACEMENT_PRESENT]),
          noRetry: true
        };
      }
      return {
        classification: CLASSIFICATION.RECOVERY_COMPLETE,
        exitCode: EXIT.OK,
        recoveryComplete: true,
        verificationComplete: true,
        replacementPresent: false,
        warnings: [],
        noRetry: true
      };
    }
    // Exact owner remains
    return {
      classification: CLASSIFICATION.RECOVERY_NOT_COMPLETED,
      exitCode: EXIT.FAILURE,
      recoveryComplete: false,
      verificationComplete: true,
      replacementPresent: false,
      warnings: [],
      noRetry: true
    };
  }

  // deletedCount !== 1 and no throw — treat via verification
  if (verifyThrew) {
    return {
      classification: CLASSIFICATION.RECOVERY_OUTCOME_UNCERTAIN,
      exitCode: EXIT.FAILURE,
      recoveryComplete: false,
      verificationComplete: false,
      replacementPresent: false,
      warnings: allowlistedWarnings([WARNING_CODES.VERIFICATION_UNREADABLE]),
      noRetry: true,
      instruction: 'DO_NOT_RETRY_AUTOMATICALLY'
    };
  }
  if (ownerGone(verifyDoc)) {
    if (foreignPresent(verifyDoc)) {
      return {
        classification: CLASSIFICATION.RECOVERY_COMPLETE,
        exitCode: EXIT.OK,
        recoveryComplete: true,
        verificationComplete: true,
        replacementPresent: true,
        warnings: allowlistedWarnings([WARNING_CODES.FOREIGN_REPLACEMENT_PRESENT]),
        noRetry: true
      };
    }
    return {
      classification: CLASSIFICATION.RECOVERY_COMPLETE,
      exitCode: EXIT.OK,
      recoveryComplete: true,
      verificationComplete: true,
      replacementPresent: false,
      warnings: [],
      noRetry: true
    };
  }
  return {
    classification: CLASSIFICATION.RECOVERY_NOT_COMPLETED,
    exitCode: EXIT.FAILURE,
    recoveryComplete: false,
    verificationComplete: true,
    replacementPresent: false,
    warnings: [],
    noRetry: true
  };
}

async function runRecover({
  collection,
  auth,
  nowMsFn,
  sleepFn,
  exitFn,
  logFn,
  disconnectOnce
}) {
  const finish = async (partial) => {
    const result = {
      classification: partial.classification,
      recoveryEligible: false,
      lockId: ACTIVATION_LOCK_ID,
      acquiredAt: partial.acquiredAt != null ? partial.acquiredAt : null,
      ageMs: partial.ageMs != null ? partial.ageMs : null,
      lockFingerprint: partial.lockFingerprint != null ? partial.lockFingerprint : null,
      exitCode: partial.exitCode,
      recoveryComplete: partial.recoveryComplete === true,
      verificationComplete: partial.verificationComplete === true,
      replacementPresent: partial.replacementPresent === true,
      warnings: Array.isArray(partial.warnings) ? partial.warnings : [],
      connected: true,
      noRetry: partial.noRetry === true,
      instruction: partial.instruction || null
    };
    logFn('rateplan_activation_lock_recovery_result', {
      classification: result.classification,
      exitCode: result.exitCode,
      recoveryComplete: result.recoveryComplete,
      verificationComplete: result.verificationComplete,
      replacementPresent: result.replacementPresent,
      warnings: result.warnings.map((w) => w.code),
      noRetry: result.noRetry,
      instruction: result.instruction,
      ageMs: result.ageMs,
      lockFingerprint: result.lockFingerprint,
      acquiredAt: result.acquiredAt
    });
    await disconnectOnce();
    exitFn(result.exitCode);
    return result;
  };

  let firstDoc;
  try {
    firstDoc = await collection.findOne({ _id: ACTIVATION_LOCK_ID });
  } catch (_err) {
    return finish({
      classification: CLASSIFICATION.PRE_DELETE_FAILED,
      exitCode: EXIT.FAILURE,
      recoveryComplete: false,
      verificationComplete: false,
      replacementPresent: false
    });
  }

  if (!firstDoc) {
    return finish({
      classification: CLASSIFICATION.LOCK_GONE_BEFORE_DELETE,
      exitCode: EXIT.FAILURE,
      recoveryComplete: false,
      verificationComplete: true,
      replacementPresent: false,
      instruction: 'REQUIRE_FRESH_INSPECTION'
    });
  }

  const first = validateLockDocument(firstDoc, nowMsFn());
  if (!first.ok) {
    return finish({
      classification: CLASSIFICATION.LOCK_MALFORMED,
      exitCode: EXIT.FAILURE,
      recoveryComplete: false,
      verificationComplete: false,
      replacementPresent: false
    });
  }

  if (first.ageMs < MIN_LOCK_AGE_MS) {
    return finish({
      classification: CLASSIFICATION.LOCK_TOO_YOUNG,
      exitCode: EXIT.FAILURE,
      recoveryComplete: false,
      verificationComplete: false,
      replacementPresent: false,
      acquiredAt: first.acquiredAtIso,
      ageMs: first.ageMs,
      lockFingerprint: first.fingerprint
    });
  }

  if (first.acquiredAtIso !== auth.expectedAcquiredAtIso) {
    return finish({
      classification: CLASSIFICATION.UNAUTHORIZED,
      exitCode: EXIT.FAILURE,
      recoveryComplete: false,
      verificationComplete: false,
      replacementPresent: false,
      acquiredAt: first.acquiredAtIso,
      ageMs: first.ageMs,
      lockFingerprint: first.fingerprint
    });
  }

  if (first.fingerprint !== auth.expectedFingerprint) {
    return finish({
      classification: CLASSIFICATION.UNAUTHORIZED,
      exitCode: EXIT.FAILURE,
      recoveryComplete: false,
      verificationComplete: false,
      replacementPresent: false,
      acquiredAt: first.acquiredAtIso,
      ageMs: first.ageMs,
      lockFingerprint: first.fingerprint
    });
  }

  // Observation interval — injectable sleep (tests: no real wait).
  await sleepFn(OBSERVATION_INTERVAL_MS);

  let secondDoc;
  try {
    secondDoc = await collection.findOne({ _id: ACTIVATION_LOCK_ID });
  } catch (_err) {
    return finish({
      classification: CLASSIFICATION.PRE_DELETE_FAILED,
      exitCode: EXIT.FAILURE,
      recoveryComplete: false,
      verificationComplete: false,
      replacementPresent: false,
      acquiredAt: first.acquiredAtIso,
      ageMs: first.ageMs,
      lockFingerprint: first.fingerprint
    });
  }

  if (!secondDoc) {
    return finish({
      classification: CLASSIFICATION.LOCK_GONE_BEFORE_DELETE,
      exitCode: EXIT.FAILURE,
      recoveryComplete: false,
      verificationComplete: true,
      replacementPresent: false,
      acquiredAt: first.acquiredAtIso,
      ageMs: first.ageMs,
      lockFingerprint: first.fingerprint,
      instruction: 'REQUIRE_FRESH_INSPECTION'
    });
  }

  const second = validateLockDocument(secondDoc, nowMsFn());
  if (
    !second.ok ||
    second.ownerToken !== first.ownerToken ||
    second.acquiredAtIso !== first.acquiredAtIso ||
    second.fingerprint !== first.fingerprint
  ) {
    return finish({
      classification: CLASSIFICATION.LOCK_CHANGED,
      exitCode: EXIT.FAILURE,
      recoveryComplete: false,
      verificationComplete: true,
      replacementPresent: false,
      acquiredAt: first.acquiredAtIso,
      ageMs: first.ageMs,
      lockFingerprint: first.fingerprint
    });
  }

  const deleteFilter = {
    _id: ACTIVATION_LOCK_ID,
    ownerToken: first.ownerToken,
    acquiredAt: first.acquiredAt
  };

  let deleteThrew = false;
  let deleteAcknowledged = true;
  let deletedCount = 0;
  try {
    const delResult = await collection.deleteOne(deleteFilter);
    if (!delResult || delResult.acknowledged === false) {
      deleteAcknowledged = false;
    }
    deletedCount = delResult && Number(delResult.deletedCount) ? Number(delResult.deletedCount) : 0;
  } catch (_err) {
    deleteThrew = true;
  }

  let verifyDoc = null;
  let verifyThrew = false;
  try {
    verifyDoc = await collection.findOne({ _id: ACTIVATION_LOCK_ID });
  } catch (_err) {
    verifyThrew = true;
  }

  const outcome = interpretDeleteOutcome({
    deleteAcknowledged,
    deletedCount,
    deleteThrew,
    verifyDoc,
    verifyThrew,
    expectedOwnerToken: first.ownerToken
  });

  return finish({
    ...outcome,
    acquiredAt: first.acquiredAtIso,
    ageMs: first.ageMs,
    lockFingerprint: first.fingerprint
  });
}

async function runStandaloneEntrypoint(runtime = {}) {
  return runActivationLockRecovery(runtime);
}

if (require.main === module) {
  runStandaloneEntrypoint().catch((err) => {
    log(
      'rateplan_activation_lock_recovery_result',
      {
        classification: CLASSIFICATION.INSPECTION_FAILED,
        exitCode: EXIT.FAILURE,
        errorCode: 'UNEXPECTED'
      },
      'error'
    );
    // Never print err.message / stack / URI
    void err;
    process.exit(EXIT.FAILURE);
  });
}

module.exports = {
  MODE_ENV,
  EXECUTE_ENV,
  QUIESCENT_ENV,
  EXPECTED_FINGERPRINT_ENV,
  EXPECTED_ACQUIRED_AT_ENV,
  EXECUTE_ACCEPTED,
  QUIESCENT_ACCEPTED,
  ACTIVATION_LOCK_COLLECTION_NAME,
  ACTIVATION_LOCK_ID,
  FINGERPRINT_DOMAIN,
  MIN_LOCK_AGE_MS,
  OBSERVATION_INTERVAL_MS,
  CLASSIFICATION,
  EXIT,
  WARNING_CODES,
  STANDALONE_CONNECT_OPTIONS,
  computeLockFingerprint,
  validateLockDocument,
  validateRecoverAuthorization,
  isValidOwnerToken,
  interpretDeleteOutcome,
  disableMongooseAutoIndexAndAutoCreate,
  runActivationLockRecovery,
  runStandaloneEntrypoint
};
