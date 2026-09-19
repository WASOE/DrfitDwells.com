#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * RP6A — Configure the approved normal-stay standard CancellationPolicy.
 *
 * Identity: code=normal-stay-standard, version=1
 * Creates at most one CancellationPolicy document via Mongoose model semantics.
 * Never mutates indexes. Never creates, edits, or activates a RatePlan.
 *
 * Modes (NORMAL_STAY_CANCELLATION_POLICY_MODE):
 *   <missing>  → DISABLED (exit 0), no connection
 *   invalid    → INVALID_MODE (exit 78), no connection
 *   inspect    → native read-only inspection (no model load)
 *   create     → requires exact confirmation; model-based create
 *
 * Create confirmation:
 *   NORMAL_STAY_CANCELLATION_POLICY_CREATE_CONFIRM=CREATE_NORMAL_STAY_STANDARD_V1
 *
 * Importing this module has no Mongo connection or mutation side effects.
 */
'use strict';

const path = require('path');

const MODE_ENV = 'NORMAL_STAY_CANCELLATION_POLICY_MODE';
const CREATE_CONFIRM_ENV = 'NORMAL_STAY_CANCELLATION_POLICY_CREATE_CONFIRM';
const CREATE_CONFIRM_ACCEPTED = 'CREATE_NORMAL_STAY_STANDARD_V1';

const COLLECTION_NAME = 'cancellationpolicies';
const POLICY_CODE = 'normal-stay-standard';
const POLICY_VERSION = 1;

const CLASSIFICATION = Object.freeze({
  DISABLED: 'DISABLED',
  INVALID_MODE: 'INVALID_MODE',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INSPECTION_COMPLETE: 'INSPECTION_COMPLETE',
  INSPECTION_FAILED: 'INSPECTION_FAILED',
  COLLECTION_ABSENT: 'COLLECTION_ABSENT',
  ALREADY_PRESENT_MATCH: 'ALREADY_PRESENT_MATCH',
  CONFLICTING_EXISTING: 'CONFLICTING_EXISTING',
  CONCURRENT_CREATE_MATCH: 'CONCURRENT_CREATE_MATCH',
  CREATE_OUTCOME_UNCERTAIN: 'CREATE_OUTCOME_UNCERTAIN',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  CREATE_COMPLETE: 'CREATE_COMPLETE',
  CREATE_FAILED: 'CREATE_FAILED',
  VERIFY_FAILED: 'VERIFY_FAILED'
});

const EXIT = Object.freeze({
  OK: 0,
  FAILURE: 78
});

const STANDALONE_CONNECT_OPTIONS = Object.freeze({
  autoIndex: false,
  autoCreate: false
});

/** Approved nested defaults: transfers disabled; organizer flags = schema defaults (manual). */
function buildApprovedPolicyInput() {
  return {
    code: POLICY_CODE,
    internalName: 'Normal stay standard cancellation policy',
    version: POLICY_VERSION,
    status: 'active',
    policyType: 'normal_stay',
    correctionWindowHours: 0,
    correctionWindowMinDaysBeforeArrival: 0,
    refundTiers: [
      { minDaysBeforeArrival: 14, maxDaysBeforeArrival: null, refundPercent: 100 },
      { minDaysBeforeArrival: 7, maxDaysBeforeArrival: 13, refundPercent: 50 },
      { minDaysBeforeArrival: 0, maxDaysBeforeArrival: 6, refundPercent: 0 }
    ],
    noShowRefundPercent: 0,
    earlyDepartureRefundPercent: 0,
    dateTransferRules: {
      enabled: false,
      maxTransfers: 0,
      minDaysBeforeArrival: null,
      compatibleRatePlanCodes: [],
      subjectToAvailability: true,
      higherPriceDifferencePayable: true,
      replacementBecomesNonRefundable: true
    },
    nameTransferRules: {
      enabled: false,
      maxTransfers: 0,
      minDaysBeforeArrival: null,
      free: true,
      identityOnly: true
    },
    organizerCancellationRule: {
      allowFullRefundOrReplacement: true,
      requiresManualExecution: true,
      ordinaryWeatherNotAutomatic: true,
      statutoryExceptionManualReview: true
    },
    nonQualifyingCancellationReasons: [],
    travelInsuranceRecommendation: '',
    legalReviewStatus: 'approved',
    legalApprovalMetadata: {
      reviewedAt: null,
      reviewedBy: null,
      notes: null
    }
  };
}

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

function disableMongooseAutoIndexAndAutoCreate(mongoose) {
  if (!mongoose || typeof mongoose.set !== 'function') return;
  mongoose.set('autoIndex', false);
  mongoose.set('autoCreate', false);
}

function loadValidateAndNormalize(requireFn = require) {
  return requireFn('../services/cancellationPolicyService.js')
    .validateAndNormalizeCancellationPolicy;
}

function normalizeApprovedPolicy(validateFn = loadValidateAndNormalize()) {
  return validateFn(buildApprovedPolicyInput());
}

function canonicalPolicyValue(value) {
  return JSON.stringify(value);
}

function stripDocToComparable(doc) {
  if (!doc || typeof doc !== 'object') return null;
  const plain =
    typeof doc.toObject === 'function'
      ? doc.toObject({ depopulate: true, flattenMaps: true })
      : { ...doc };
  const {
    _id: _omitId,
    __v: _omitV,
    createdAt: _omitC,
    updatedAt: _omitU,
    id: _omitIdAlias,
    ...rest
  } = plain;
  void _omitId;
  void _omitV;
  void _omitC;
  void _omitU;
  void _omitIdAlias;
  return rest;
}

function policiesMatch(existingDoc, expectedNormalized, validateFn = loadValidateAndNormalize()) {
  const fromExisting = validateFn(stripDocToComparable(existingDoc) || {});
  if (!fromExisting.ok) return false;
  return canonicalPolicyValue(fromExisting.value) === canonicalPolicyValue(expectedNormalized);
}

function safeIndexNames(indexes) {
  if (!Array.isArray(indexes)) return [];
  return indexes
    .map((ix) => (ix && typeof ix.name === 'string' ? ix.name : null))
    .filter(Boolean)
    .sort();
}

function isDuplicateKeyError(err) {
  if (!err || typeof err !== 'object') return false;
  if (err.code === 11000 || err.code === '11000') return true;
  const msg = typeof err.message === 'string' ? err.message : '';
  return /E11000|duplicate key/i.test(msg);
}

function emitResult(result, { exit, logFn }) {
  logFn('normal_stay_cancellation_policy_result', {
    classification: result.classification,
    exitCode: result.exitCode,
    connected: !!result.connected,
    mode: result.mode || null,
    code: POLICY_CODE,
    version: POLICY_VERSION,
    collectionCount: result.collectionCount ?? null,
    identityPresent: result.identityPresent ?? null,
    contentMatch: result.contentMatch ?? null,
    created: !!result.created,
    indexNames: result.indexNames || null,
    mutationAttempted: !!result.mutationAttempted,
    noAutomaticRetry: result.noAutomaticRetry === true,
    persistedVersionKey: result.persistedVersionKey ?? null,
    hasTimestamps: result.hasTimestamps ?? null,
    ratePlanTouched: false
  });
  exit(result.exitCode);
  return result;
}

async function defaultLoadServerEnv() {
  const { loadServerEnv } = require('../config/loadServerEnv');
  loadServerEnv();
}

/**
 * Inspect path: native collection only (no CancellationPolicy model).
 */
async function defaultConnectNative({ env, loadMongoose, loadServerEnv }) {
  await loadServerEnv(env);
  const mongoose = loadMongoose();
  disableMongooseAutoIndexAndAutoCreate(mongoose);
  const uri = env.MONGODB_URI || env.MONGO_URI;
  if (!uri || typeof uri !== 'string') {
    const err = new Error('MONGO_URI_MISSING');
    err.code = 'MONGO_URI_MISSING';
    throw err;
  }
  await mongoose.connect(uri, STANDALONE_CONNECT_OPTIONS);
  return {
    mongoose,
    db: mongoose.connection.db,
    collection: mongoose.connection.db.collection(COLLECTION_NAME)
  };
}

/**
 * Create path: disable autoIndex BEFORE requiring the model, then connect.
 */
async function defaultConnectWithModel({ env, loadMongoose, loadServerEnv, requireFn }) {
  await loadServerEnv(env);
  const mongoose = loadMongoose();
  disableMongooseAutoIndexAndAutoCreate(mongoose);
  // Require model only after autoIndex/autoCreate are disabled.
  const modelPath = path.join(__dirname, '../models/CancellationPolicy.js');
  const CancellationPolicy = requireFn(modelPath);
  const uri = env.MONGODB_URI || env.MONGO_URI;
  if (!uri || typeof uri !== 'string') {
    const err = new Error('MONGO_URI_MISSING');
    err.code = 'MONGO_URI_MISSING';
    throw err;
  }
  await mongoose.connect(uri, STANDALONE_CONNECT_OPTIONS);
  return {
    mongoose,
    db: mongoose.connection.db,
    collection: mongoose.connection.db.collection(COLLECTION_NAME),
    CancellationPolicy
  };
}

async function assertCollectionExists(db) {
  const listed = db.listCollections({ name: COLLECTION_NAME }, { nameOnly: true });
  const found =
    listed && typeof listed.toArray === 'function'
      ? await listed.toArray()
      : await listed;
  return Array.isArray(found) && found.length > 0;
}

async function inspectViaNative(collection) {
  const collectionCount = await collection.countDocuments({});
  const identity = await collection.findOne({
    code: POLICY_CODE,
    version: POLICY_VERSION
  });
  let indexes = [];
  try {
    indexes = await collection.indexes();
  } catch (_err) {
    indexes = [];
  }
  return {
    collectionCount,
    identity,
    indexNames: safeIndexNames(indexes)
  };
}

function verifyPersistedShape(doc) {
  if (!doc) return { ok: false, reason: 'missing' };
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const v = plain.__v;
  const versionOk = v === 0 || v === '0';
  const createdOk = plain.createdAt instanceof Date || !!plain.createdAt;
  const updatedOk = plain.updatedAt instanceof Date || !!plain.updatedAt;
  return {
    ok: versionOk && createdOk && updatedOk,
    persistedVersionKey: v,
    hasTimestamps: !!(createdOk && updatedOk)
  };
}

/**
 * Main entry. deps injectable for tests (no real Mongo).
 */
async function runConfigureNormalStayCancellationPolicy(deps = {}) {
  const env = deps.env || process.env;
  const exit = deps.exit || process.exit.bind(process);
  const logFn = deps.log || log;
  const requireFn = deps.requireFn || require;
  const loadMongoose = deps.loadMongoose || (() => require('mongoose'));
  const loadServerEnv = deps.loadServerEnv || defaultLoadServerEnv;
  const connectNative =
    deps.connectNative ||
    ((args) => defaultConnectNative({ ...args, loadMongoose, loadServerEnv }));
  const connectWithModel =
    deps.connectWithModel ||
    ((args) =>
      defaultConnectWithModel({
        ...args,
        loadMongoose,
        loadServerEnv,
        requireFn
      }));
  const disconnect =
    deps.disconnect ||
    (async (ctx) => {
      try {
        if (ctx && ctx.mongoose && ctx.mongoose.connection) {
          await ctx.mongoose.disconnect();
          return;
        }
        const mongoose = loadMongoose();
        if (mongoose.connection && mongoose.connection.readyState) {
          await mongoose.disconnect();
        }
      } catch (_err) {
        /* ignore */
      }
    });
  const validateFn = deps.validateAndNormalize || loadValidateAndNormalize(requireFn);
  const createDocument =
    deps.createDocument ||
    (async (CancellationPolicy, payload) => CancellationPolicy.create(payload));

  const mode = readMode(env);

  if (!mode) {
    return emitResult(
      {
        classification: CLASSIFICATION.DISABLED,
        exitCode: EXIT.OK,
        connected: false,
        mode: '',
        created: false,
        mutationAttempted: false
      },
      { exit, logFn }
    );
  }

  if (mode !== 'inspect' && mode !== 'create') {
    return emitResult(
      {
        classification: CLASSIFICATION.INVALID_MODE,
        exitCode: EXIT.FAILURE,
        connected: false,
        mode,
        created: false,
        mutationAttempted: false
      },
      { exit, logFn }
    );
  }

  const normalized = validateFn(buildApprovedPolicyInput());
  if (!normalized.ok) {
    return emitResult(
      {
        classification: CLASSIFICATION.VALIDATION_FAILED,
        exitCode: EXIT.FAILURE,
        connected: false,
        mode,
        created: false,
        mutationAttempted: false
      },
      { exit, logFn }
    );
  }

  if (mode === 'create') {
    const confirm = env[CREATE_CONFIRM_ENV];
    if (confirm !== CREATE_CONFIRM_ACCEPTED) {
      return emitResult(
        {
          classification: CLASSIFICATION.UNAUTHORIZED,
          exitCode: EXIT.FAILURE,
          connected: false,
          mode,
          created: false,
          mutationAttempted: false
        },
        { exit, logFn }
      );
    }
  }

  let ctx = null;
  let connected = false;
  try {
    if (mode === 'inspect') {
      try {
        ctx = await connectNative({ env, mode });
        connected = true;
      } catch (_err) {
        return emitResult(
          {
            classification: CLASSIFICATION.INSPECTION_FAILED,
            exitCode: EXIT.FAILURE,
            connected: false,
            mode,
            created: false,
            mutationAttempted: false
          },
          { exit, logFn }
        );
      }

      let snapshot;
      try {
        snapshot = await inspectViaNative(ctx.collection);
      } catch (_err) {
        return emitResult(
          {
            classification: CLASSIFICATION.INSPECTION_FAILED,
            exitCode: EXIT.FAILURE,
            connected: true,
            mode,
            created: false,
            mutationAttempted: false
          },
          { exit, logFn }
        );
      }

      const identityPresent = !!snapshot.identity;
      const contentMatch = identityPresent
        ? policiesMatch(snapshot.identity, normalized.value, validateFn)
        : false;

      return emitResult(
        {
          classification: CLASSIFICATION.INSPECTION_COMPLETE,
          exitCode: EXIT.OK,
          connected: true,
          mode,
          collectionCount: snapshot.collectionCount,
          identityPresent,
          contentMatch: identityPresent ? contentMatch : null,
          indexNames: snapshot.indexNames,
          created: false,
          mutationAttempted: false
        },
        { exit, logFn }
      );
    }

    // ---------- create mode ----------
    try {
      ctx = await connectWithModel({ env, mode });
      connected = true;
    } catch (_err) {
      return emitResult(
        {
          classification: CLASSIFICATION.CREATE_FAILED,
          exitCode: EXIT.FAILURE,
          connected: false,
          mode,
          created: false,
          mutationAttempted: false
        },
        { exit, logFn }
      );
    }

    let collectionExists = false;
    try {
      collectionExists = await assertCollectionExists(ctx.db);
    } catch (_err) {
      return emitResult(
        {
          classification: CLASSIFICATION.CREATE_FAILED,
          exitCode: EXIT.FAILURE,
          connected: true,
          mode,
          created: false,
          mutationAttempted: false
        },
        { exit, logFn }
      );
    }

    if (!collectionExists) {
      return emitResult(
        {
          classification: CLASSIFICATION.COLLECTION_ABSENT,
          exitCode: EXIT.FAILURE,
          connected: true,
          mode,
          created: false,
          mutationAttempted: false
        },
        { exit, logFn }
      );
    }

    let snapshot;
    try {
      snapshot = await inspectViaNative(ctx.collection);
    } catch (_err) {
      return emitResult(
        {
          classification: CLASSIFICATION.CREATE_FAILED,
          exitCode: EXIT.FAILURE,
          connected: true,
          mode,
          created: false,
          mutationAttempted: false
        },
        { exit, logFn }
      );
    }

    const identityPresent = !!snapshot.identity;
    const contentMatch = identityPresent
      ? policiesMatch(snapshot.identity, normalized.value, validateFn)
      : false;

    if (identityPresent && contentMatch) {
      return emitResult(
        {
          classification: CLASSIFICATION.ALREADY_PRESENT_MATCH,
          exitCode: EXIT.OK,
          connected: true,
          mode,
          collectionCount: snapshot.collectionCount,
          identityPresent: true,
          contentMatch: true,
          indexNames: snapshot.indexNames,
          created: false,
          mutationAttempted: false
        },
        { exit, logFn }
      );
    }

    if (identityPresent && !contentMatch) {
      return emitResult(
        {
          classification: CLASSIFICATION.CONFLICTING_EXISTING,
          exitCode: EXIT.FAILURE,
          connected: true,
          mode,
          collectionCount: snapshot.collectionCount,
          identityPresent: true,
          contentMatch: false,
          indexNames: snapshot.indexNames,
          created: false,
          mutationAttempted: false
        },
        { exit, logFn }
      );
    }

    let createdDoc = null;
    try {
      createdDoc = await createDocument(ctx.CancellationPolicy, normalized.value);
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        let afterDoc = null;
        let rereadOk = true;
        try {
          const query = ctx.CancellationPolicy.findOne({
            code: POLICY_CODE,
            version: POLICY_VERSION
          });
          afterDoc =
            query && typeof query.lean === 'function'
              ? await query.lean()
              : await query;
        } catch (_err2) {
          rereadOk = false;
        }

        if (!rereadOk) {
          return emitResult(
            {
              classification: CLASSIFICATION.CREATE_OUTCOME_UNCERTAIN,
              exitCode: EXIT.FAILURE,
              connected: true,
              mode,
              collectionCount: snapshot.collectionCount,
              identityPresent: null,
              contentMatch: null,
              indexNames: snapshot.indexNames,
              created: false,
              mutationAttempted: true,
              noAutomaticRetry: true
            },
            { exit, logFn }
          );
        }

        if (afterDoc && policiesMatch(afterDoc, normalized.value, validateFn)) {
          return emitResult(
            {
              classification: CLASSIFICATION.CONCURRENT_CREATE_MATCH,
              exitCode: EXIT.OK,
              connected: true,
              mode,
              collectionCount: snapshot.collectionCount + (afterDoc ? 0 : 0),
              identityPresent: true,
              contentMatch: true,
              indexNames: snapshot.indexNames,
              created: false,
              mutationAttempted: true
            },
            { exit, logFn }
          );
        }

        if (afterDoc) {
          return emitResult(
            {
              classification: CLASSIFICATION.CONFLICTING_EXISTING,
              exitCode: EXIT.FAILURE,
              connected: true,
              mode,
              identityPresent: true,
              contentMatch: false,
              indexNames: snapshot.indexNames,
              created: false,
              mutationAttempted: true
            },
            { exit, logFn }
          );
        }

        return emitResult(
          {
            classification: CLASSIFICATION.CREATE_OUTCOME_UNCERTAIN,
            exitCode: EXIT.FAILURE,
            connected: true,
            mode,
            identityPresent: false,
            contentMatch: null,
            indexNames: snapshot.indexNames,
            created: false,
            mutationAttempted: true,
            noAutomaticRetry: true
          },
          { exit, logFn }
        );
      }

      return emitResult(
        {
          classification: CLASSIFICATION.CREATE_FAILED,
          exitCode: EXIT.FAILURE,
          connected: true,
          mode,
          collectionCount: snapshot.collectionCount,
          identityPresent: false,
          contentMatch: null,
          indexNames: snapshot.indexNames,
          created: false,
          mutationAttempted: true
        },
        { exit, logFn }
      );
    }

    let verifyDoc = null;
    try {
      verifyDoc = await ctx.CancellationPolicy.findOne({
        code: POLICY_CODE,
        version: POLICY_VERSION
      });
    } catch (_err) {
      return emitResult(
        {
          classification: CLASSIFICATION.CREATE_OUTCOME_UNCERTAIN,
          exitCode: EXIT.FAILURE,
          connected: true,
          mode,
          created: true,
          mutationAttempted: true,
          identityPresent: true,
          contentMatch: null,
          indexNames: snapshot.indexNames,
          noAutomaticRetry: true
        },
        { exit, logFn }
      );
    }

    if (!verifyDoc || !policiesMatch(verifyDoc, normalized.value, validateFn)) {
      return emitResult(
        {
          classification: CLASSIFICATION.VERIFY_FAILED,
          exitCode: EXIT.FAILURE,
          connected: true,
          mode,
          created: true,
          mutationAttempted: true,
          identityPresent: !!verifyDoc,
          contentMatch: false,
          indexNames: snapshot.indexNames,
          noAutomaticRetry: true
        },
        { exit, logFn }
      );
    }

    const shape = verifyPersistedShape(verifyDoc);
    if (!shape.ok) {
      return emitResult(
        {
          classification: CLASSIFICATION.VERIFY_FAILED,
          exitCode: EXIT.FAILURE,
          connected: true,
          mode,
          created: true,
          mutationAttempted: true,
          identityPresent: true,
          contentMatch: true,
          indexNames: snapshot.indexNames,
          persistedVersionKey: shape.persistedVersionKey,
          hasTimestamps: shape.hasTimestamps,
          noAutomaticRetry: true
        },
        { exit, logFn }
      );
    }

    let afterCount = snapshot.collectionCount + 1;
    try {
      afterCount = await ctx.collection.countDocuments({});
    } catch (_err) {
      /* keep estimate */
    }

    void createdDoc;

    return emitResult(
      {
        classification: CLASSIFICATION.CREATE_COMPLETE,
        exitCode: EXIT.OK,
        connected: true,
        mode,
        collectionCount: afterCount,
        identityPresent: true,
        contentMatch: true,
        indexNames: snapshot.indexNames,
        created: true,
        mutationAttempted: true,
        persistedVersionKey: shape.persistedVersionKey,
        hasTimestamps: true
      },
      { exit, logFn }
    );
  } finally {
    if (connected) {
      await disconnect(ctx);
    }
  }
}

function main() {
  return runConfigureNormalStayCancellationPolicy({});
}

if (require.main === module) {
  main().catch(() => {
    log(
      'normal_stay_cancellation_policy_result',
      {
        classification: CLASSIFICATION.CREATE_FAILED,
        exitCode: EXIT.FAILURE,
        connected: false,
        ratePlanTouched: false
      },
      'error'
    );
    process.exit(EXIT.FAILURE);
  });
}

module.exports = {
  MODE_ENV,
  CREATE_CONFIRM_ENV,
  CREATE_CONFIRM_ACCEPTED,
  COLLECTION_NAME,
  POLICY_CODE,
  POLICY_VERSION,
  CLASSIFICATION,
  EXIT,
  STANDALONE_CONNECT_OPTIONS,
  buildApprovedPolicyInput,
  normalizeApprovedPolicy,
  policiesMatch,
  canonicalPolicyValue,
  stripDocToComparable,
  isDuplicateKeyError,
  disableMongooseAutoIndexAndAutoCreate,
  verifyPersistedShape,
  runConfigureNormalStayCancellationPolicy,
  main
};
