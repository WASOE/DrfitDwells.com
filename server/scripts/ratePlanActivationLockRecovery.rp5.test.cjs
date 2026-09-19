/**
 * RP5 — RatePlan activation-lock recovery tests.
 *
 * Run: node --test server/scripts/ratePlanActivationLockRecovery.rp5.test.cjs
 *
 * No MongoDB, network, production environment, or real sleeping.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const recovery = require('./ratePlanActivationLockRecovery.cjs');
const {
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
  runActivationLockRecovery
} = recovery;

const SCRIPT_PATH = path.join(__dirname, 'ratePlanActivationLockRecovery.cjs');
const RUNBOOK_PATH = path.join(
  __dirname,
  '../../docs/runbooks/rate-plan-activation-lock-recovery.md'
);

function tokenA() {
  return 'a'.repeat(64);
}
function tokenB() {
  return 'b'.repeat(64);
}

function acquiredAtIso(ageMs, nowMs = Date.UTC(2026, 8, 19, 12, 0, 0)) {
  return new Date(nowMs - ageMs).toISOString();
}

function lockDoc({ ownerToken = tokenA(), ageMs = MIN_LOCK_AGE_MS + 60_000, nowMs } = {}) {
  const iso = acquiredAtIso(ageMs, nowMs);
  return {
    _id: ACTIVATION_LOCK_ID,
    ownerToken,
    acquiredAt: new Date(iso)
  };
}

function fingerprintFor(doc) {
  return computeLockFingerprint({
    lockId: ACTIVATION_LOCK_ID,
    ownerToken: doc.ownerToken,
    acquiredAtIso: doc.acquiredAt.toISOString()
  });
}

function recoverEnv(doc, overrides = {}) {
  const fp = fingerprintFor(doc);
  return {
    [MODE_ENV]: 'recover',
    [EXECUTE_ENV]: EXECUTE_ACCEPTED,
    [QUIESCENT_ENV]: QUIESCENT_ACCEPTED,
    [EXPECTED_FINGERPRINT_ENV]: fp,
    [EXPECTED_ACQUIRED_AT_ENV]: doc.acquiredAt.toISOString(),
    ...overrides
  };
}

function assertNoSecrets(value, forbidden = []) {
  const json = JSON.stringify(value);
  for (const f of forbidden) {
    assert.equal(json.includes(f), false, `leaked: ${f}`);
  }
  assert.equal(json.includes('ownerToken'), false);
  assert.equal(json.includes('mongodb://'), false);
  assert.equal(json.includes('mongodb+srv://'), false);
  assert.equal(/password=/i.test(json), false);
  assert.equal(json.includes('\n    at '), false);
}

function mockCollection(state) {
  return {
    async findOne(filter) {
      if (typeof state.onFindOne === 'function') {
        return state.onFindOne(filter, state);
      }
      if (state.findThrow) throw new Error('find boom mongodb://secret');
      return state.doc;
    },
    async deleteOne(filter) {
      state.lastDeleteFilter = filter;
      state.deleteCalls = (state.deleteCalls || 0) + 1;
      if (typeof state.onDeleteOne === 'function') {
        return state.onDeleteOne(filter, state);
      }
      if (state.deleteThrow) throw new Error('delete boom ownerToken=SECRET');
      if (state.deleteUnacked) return { acknowledged: false, deletedCount: 0 };
      const match =
        filter &&
        filter._id === ACTIVATION_LOCK_ID &&
        filter.ownerToken === (state.doc && state.doc.ownerToken) &&
        state.doc &&
        filter.acquiredAt instanceof Date &&
        filter.acquiredAt.getTime() === state.doc.acquiredAt.getTime();
      if (match) {
        state.doc = state.postDeleteDoc !== undefined ? state.postDeleteDoc : null;
        return { acknowledged: true, deletedCount: 1 };
      }
      return { acknowledged: true, deletedCount: 0 };
    },
    // Forbidden mutations — tests assert these are never called
    async insertOne() {
      throw new Error('insertOne forbidden');
    },
    async updateOne() {
      throw new Error('updateOne forbidden');
    },
    async createIndex() {
      throw new Error('createIndex forbidden');
    },
    async drop() {
      throw new Error('drop forbidden');
    }
  };
}

async function runWith(env, collectionState, extras = {}) {
  const nowMs = extras.nowMs || Date.UTC(2026, 8, 19, 12, 0, 0);
  let exitCode = null;
  const sleepCalls = [];
  const disconnectCalls = { n: 0 };
  const result = await runActivationLockRecovery({
    env,
    nowMs: () => (typeof extras.nowMsFn === 'function' ? extras.nowMsFn() : nowMs),
    sleep: async (ms) => {
      sleepCalls.push(ms);
    },
    exit: (c) => {
      exitCode = c;
    },
    log: () => {},
    loadMongoose: () => {
      throw new Error('mongoose should be injected via getCollection');
    },
    loadServerEnv: () => {
      throw new Error('loadServerEnv should not run when getCollection injected');
    },
    getCollection: async () => mockCollection(collectionState),
    disconnect: async () => {
      disconnectCalls.n += 1;
    },
    ...extras.runtime
  });
  return { result, exitCode, sleepCalls, disconnectCalls };
}

describe('RP5 import and modes (no mongoose)', () => {
  it('import has no side effects (constants only)', () => {
    assert.equal(ACTIVATION_LOCK_ID, 'seasonal-rateplan-activation');
    assert.equal(ACTIVATION_LOCK_COLLECTION_NAME, 'rateplanactivationlocks');
    assert.equal(MIN_LOCK_AGE_MS, 15 * 60 * 1000);
    assert.equal(OBSERVATION_INTERVAL_MS, 30 * 1000);
  });

  it('disabled mode never loads mongoose and exits 0', async () => {
    let mongooseRequired = false;
    const orig = Module.prototype.require;
    Module.prototype.require = function patched(id) {
      if (id === 'mongoose' || String(id).endsWith('/mongoose')) {
        mongooseRequired = true;
      }
      return orig.apply(this, arguments);
    };
    try {
      let exitCode = null;
      const result = await runActivationLockRecovery({
        env: {},
        exit: (c) => {
          exitCode = c;
        },
        log: () => {},
        loadMongoose: () => {
          mongooseRequired = true;
          return {};
        }
      });
      assert.equal(result.classification, CLASSIFICATION.DISABLED);
      assert.equal(exitCode, EXIT.OK);
      assert.equal(result.connected, false);
      assert.equal(mongooseRequired, false);
    } finally {
      Module.prototype.require = orig;
    }
  });

  it('invalid mode never loads mongoose and exits 78', async () => {
    let loaded = false;
    let exitCode = null;
    const result = await runActivationLockRecovery({
      env: { [MODE_ENV]: 'delete-all' },
      exit: (c) => {
        exitCode = c;
      },
      log: () => {},
      loadMongoose: () => {
        loaded = true;
        return {};
      }
    });
    assert.equal(result.classification, CLASSIFICATION.INVALID_MODE);
    assert.equal(exitCode, EXIT.FAILURE);
    assert.equal(loaded, false);
  });

  it('recover authorization failure never connects', async () => {
    let connected = false;
    let exitCode = null;
    const result = await runActivationLockRecovery({
      env: {
        [MODE_ENV]: 'recover',
        [EXECUTE_ENV]: '1'
        // missing quiescent / fingerprint / acquiredAt
      },
      exit: (c) => {
        exitCode = c;
      },
      log: () => {},
      getCollection: async () => {
        connected = true;
        return mockCollection({ doc: null });
      }
    });
    assert.equal(result.classification, CLASSIFICATION.UNAUTHORIZED);
    assert.equal(exitCode, EXIT.FAILURE);
    assert.equal(connected, false);
  });
});

describe('RP5 fingerprint and validation', () => {
  it('deterministic fingerprint over domain-separated canonical value', () => {
    const iso = '2026-01-01T00:00:00.000Z';
    const a = computeLockFingerprint({
      lockId: ACTIVATION_LOCK_ID,
      ownerToken: tokenA(),
      acquiredAtIso: iso
    });
    const b = computeLockFingerprint({
      lockId: ACTIVATION_LOCK_ID,
      ownerToken: tokenA(),
      acquiredAtIso: iso
    });
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.ok(FINGERPRINT_DOMAIN.length > 0);
    const other = computeLockFingerprint({
      lockId: ACTIVATION_LOCK_ID,
      ownerToken: tokenB(),
      acquiredAtIso: iso
    });
    assert.notEqual(a, other);
  });

  it('owner token format is 64 lowercase hex', () => {
    assert.equal(isValidOwnerToken(tokenA()), true);
    assert.equal(isValidOwnerToken('ABCDEF' + 'a'.repeat(58)), false);
    assert.equal(isValidOwnerToken('a'.repeat(63)), false);
    assert.equal(isValidOwnerToken(''), false);
  });

  it('future acquiredAt is malformed', () => {
    const nowMs = Date.UTC(2026, 8, 19, 12, 0, 0);
    const doc = {
      _id: ACTIVATION_LOCK_ID,
      ownerToken: tokenA(),
      acquiredAt: new Date(nowMs + 60_000)
    };
    const v = validateLockDocument(doc, nowMs);
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'future_acquired_at');
  });

  it('validateRecoverAuthorization requires exact ISO round-trip', () => {
    const ok = validateRecoverAuthorization({
      [EXECUTE_ENV]: '1',
      [QUIESCENT_ENV]: QUIESCENT_ACCEPTED,
      [EXPECTED_FINGERPRINT_ENV]: 'a'.repeat(64),
      [EXPECTED_ACQUIRED_AT_ENV]: '2026-01-01T00:00:00.000Z'
    });
    assert.equal(ok.ok, true);
    const bad = validateRecoverAuthorization({
      [EXECUTE_ENV]: '1',
      [QUIESCENT_ENV]: QUIESCENT_ACCEPTED,
      [EXPECTED_FINGERPRINT_ENV]: 'a'.repeat(64),
      [EXPECTED_ACQUIRED_AT_ENV]: '2026-01-01T00:00:00Z' // not exact toISOString
    });
    assert.equal(bad.ok, false);
  });
});

describe('RP5 inspect classifications', () => {
  it('NO_LOCK exit 0', async () => {
    const { result, exitCode, disconnectCalls } = await runWith(
      { [MODE_ENV]: 'inspect' },
      { doc: null }
    );
    assert.equal(result.classification, CLASSIFICATION.NO_LOCK);
    assert.equal(exitCode, EXIT.OK);
    assert.equal(result.recoveryEligible, false);
    assert.equal(disconnectCalls.n, 1);
    assertNoSecrets(result);
  });

  it('LOCK_TOO_YOUNG exit 2', async () => {
    const doc = lockDoc({ ageMs: 60_000 });
    const { result, exitCode } = await runWith({ [MODE_ENV]: 'inspect' }, { doc });
    assert.equal(result.classification, CLASSIFICATION.LOCK_TOO_YOUNG);
    assert.equal(exitCode, EXIT.ELIGIBLE_OR_TOO_YOUNG);
    assert.equal(result.recoveryEligible, false);
    assert.equal(result.lockFingerprint, fingerprintFor(doc));
    assertNoSecrets(result, [doc.ownerToken]);
  });

  it('LOCK_RECOVERY_ELIGIBLE exit 2', async () => {
    const doc = lockDoc({ ageMs: MIN_LOCK_AGE_MS + 1 });
    const { result, exitCode } = await runWith({ [MODE_ENV]: 'inspect' }, { doc });
    assert.equal(result.classification, CLASSIFICATION.LOCK_RECOVERY_ELIGIBLE);
    assert.equal(exitCode, EXIT.ELIGIBLE_OR_TOO_YOUNG);
    assert.equal(result.recoveryEligible, true);
    assert.equal(result.lockId, ACTIVATION_LOCK_ID);
    assert.equal(result.acquiredAt, doc.acquiredAt.toISOString());
    assertNoSecrets(result, [doc.ownerToken]);
  });

  it('LOCK_MALFORMED exit 78', async () => {
    const { result, exitCode } = await runWith(
      { [MODE_ENV]: 'inspect' },
      {
        doc: {
          _id: ACTIVATION_LOCK_ID,
          ownerToken: 'short',
          acquiredAt: new Date()
        }
      }
    );
    assert.equal(result.classification, CLASSIFICATION.LOCK_MALFORMED);
    assert.equal(exitCode, EXIT.FAILURE);
  });

  it('INSPECTION_FAILED exit 78', async () => {
    const { result, exitCode } = await runWith(
      { [MODE_ENV]: 'inspect' },
      { findThrow: true }
    );
    assert.equal(result.classification, CLASSIFICATION.INSPECTION_FAILED);
    assert.equal(exitCode, EXIT.FAILURE);
    assertNoSecrets(result, ['mongodb://secret']);
  });
});

describe('RP5 connection safety', () => {
  it('autoIndex/autoCreate disabled before connect; native collection only', async () => {
    const sets = [];
    let connectOpts = null;
    let disconnectN = 0;
    let modelLoaded = false;
    const mongoose = {
      set(k, v) {
        sets.push({ k, v, beforeConnect: connectOpts === null });
      },
      get(k) {
        const hit = [...sets].reverse().find((s) => s.k === k);
        return hit ? hit.v : undefined;
      },
      async connect(_uri, opts) {
        connectOpts = opts;
      },
      async disconnect() {
        disconnectN += 1;
      },
      connection: {
        db: {
          collection(name) {
            assert.equal(name, ACTIVATION_LOCK_COLLECTION_NAME);
            return mockCollection({ doc: null });
          }
        }
      }
    };

    let exitCode = null;
    await runActivationLockRecovery({
      env: { [MODE_ENV]: 'inspect' },
      exit: (c) => {
        exitCode = c;
      },
      log: () => {},
      loadMongoose: () => mongoose,
      loadServerEnv: () => ({}),
      resolveMongoUri: () => 'mongodb://example.invalid/db',
      disableAutoIndexAndAutoCreate: disableMongooseAutoIndexAndAutoCreate,
      connect: async () => {
        disableMongooseAutoIndexAndAutoCreate(mongoose);
        await mongoose.connect('mongodb://example.invalid/db', {
          ...STANDALONE_CONNECT_OPTIONS
        });
      },
      disconnect: async () => mongoose.disconnect()
    });

    // Re-run with default standalone wiring pieces
    const sets2 = [];
    let connected = false;
    const mongoose2 = {
      set(k, v) {
        sets2.push([k, v, !connected]);
      },
      async connect(_uri, opts) {
        connected = true;
        connectOpts = opts;
      },
      async disconnect() {
        disconnectN += 1;
      },
      connection: {
        db: {
          collection(name) {
            assert.equal(name, ACTIVATION_LOCK_COLLECTION_NAME);
            return mockCollection({ doc: null });
          }
        }
      }
    };
    await runActivationLockRecovery({
      env: { [MODE_ENV]: 'inspect', MONGODB_URI: 'mongodb://example.invalid/db' },
      exit: () => {},
      log: () => {},
      loadMongoose: () => mongoose2,
      loadServerEnv: () => {
        modelLoaded = modelLoaded || false;
      },
      resolveMongoUri: () => 'mongodb://example.invalid/db'
    });

    assert.deepEqual(sets2, [
      ['autoIndex', false, true],
      ['autoCreate', false, true]
    ]);
    assert.deepEqual(connectOpts, { autoIndex: false, autoCreate: false });
    assert.equal(modelLoaded, false);
    assert.equal(exitCode, EXIT.OK);
    void disconnectN;
  });

  it('disconnect exactly once on inspect and recover paths', async () => {
    const doc = lockDoc();
    const a = await runWith({ [MODE_ENV]: 'inspect' }, { doc });
    assert.equal(a.disconnectCalls.n, 1);

    const b = await runWith(recoverEnv(doc), {
      doc,
      postDeleteDoc: null
    });
    assert.equal(b.disconnectCalls.n, 1);
    assert.equal(b.sleepCalls[0], OBSERVATION_INTERVAL_MS);
  });
});

describe('RP5 recover preconditions', () => {
  it('too young does not delete', async () => {
    const doc = lockDoc({ ageMs: 1000 });
    // Auth uses fingerprint of young lock — still blocked by age check
    const state = { doc };
    const { result, exitCode } = await runWith(recoverEnv(doc), state);
    assert.equal(result.classification, CLASSIFICATION.LOCK_TOO_YOUNG);
    assert.equal(exitCode, EXIT.FAILURE);
    assert.equal(result.recoveryComplete, false);
    assert.equal(state.deleteCalls || 0, 0);
  });

  it('wrong fingerprint — no delete', async () => {
    const doc = lockDoc();
    const state = { doc };
    const { result, exitCode } = await runWith(
      recoverEnv(doc, { [EXPECTED_FINGERPRINT_ENV]: 'c'.repeat(64) }),
      state
    );
    assert.equal(result.classification, CLASSIFICATION.UNAUTHORIZED);
    assert.equal(exitCode, EXIT.FAILURE);
    assert.equal(state.deleteCalls || 0, 0);
    assertNoSecrets(result, [doc.ownerToken]);
  });

  it('wrong acquiredAt — no delete', async () => {
    const doc = lockDoc();
    const state = { doc };
    const { result, exitCode } = await runWith(
      recoverEnv(doc, {
        [EXPECTED_ACQUIRED_AT_ENV]: '2020-01-01T00:00:00.000Z'
      }),
      state
    );
    assert.equal(result.classification, CLASSIFICATION.UNAUTHORIZED);
    assert.equal(exitCode, EXIT.FAILURE);
    assert.equal(state.deleteCalls || 0, 0);
  });

  it('changed lock during observation — no delete', async () => {
    const doc = lockDoc();
    let reads = 0;
    const state = {
      onFindOne() {
        reads += 1;
        if (reads === 1) return doc;
        return {
          _id: ACTIVATION_LOCK_ID,
          ownerToken: tokenB(),
          acquiredAt: doc.acquiredAt
        };
      }
    };
    const { result, exitCode } = await runWith(recoverEnv(doc), state);
    assert.equal(result.classification, CLASSIFICATION.LOCK_CHANGED);
    assert.equal(exitCode, EXIT.FAILURE);
    assert.equal(state.deleteCalls || 0, 0);
  });

  it('lock disappears before deletion — fresh inspection required', async () => {
    const doc = lockDoc();
    let reads = 0;
    const state = {
      onFindOne() {
        reads += 1;
        if (reads === 1) return doc;
        return null;
      }
    };
    const { result, exitCode } = await runWith(recoverEnv(doc), state);
    assert.equal(result.classification, CLASSIFICATION.LOCK_GONE_BEFORE_DELETE);
    assert.equal(exitCode, EXIT.FAILURE);
    assert.equal(result.instruction, 'REQUIRE_FRESH_INSPECTION');
    assert.equal(state.deleteCalls || 0, 0);
  });
});

describe('RP5 exact conditional delete and outcomes', () => {
  it('delete filter is exact {_id, ownerToken, acquiredAt}', async () => {
    const doc = lockDoc();
    const state = { doc, postDeleteDoc: null };
    const { result, exitCode } = await runWith(recoverEnv(doc), state);
    assert.equal(result.classification, CLASSIFICATION.RECOVERY_COMPLETE);
    assert.equal(exitCode, EXIT.OK);
    assert.deepEqual(Object.keys(state.lastDeleteFilter).sort(), [
      '_id',
      'acquiredAt',
      'ownerToken'
    ]);
    assert.equal(state.lastDeleteFilter._id, ACTIVATION_LOCK_ID);
    assert.equal(state.lastDeleteFilter.ownerToken, doc.ownerToken);
    assert.equal(
      state.lastDeleteFilter.acquiredAt.getTime(),
      doc.acquiredAt.getTime()
    );
    assertNoSecrets(result, [doc.ownerToken]);
  });

  it('foreign lock never deleted (filter mismatch → not completed)', async () => {
    const doc = lockDoc();
    const state = {
      doc,
      onDeleteOne(filter) {
        // Simulate foreign owner — filter does not match stored token
        assert.equal(filter.ownerToken, doc.ownerToken);
        return { acknowledged: true, deletedCount: 0 };
      },
      onFindOne(_f, s) {
        // Still foreign/same after failed delete
        if (!s._reads) s._reads = 0;
        s._reads += 1;
        return doc;
      }
    };
    const { result, exitCode } = await runWith(recoverEnv(doc), state);
    assert.equal(result.classification, CLASSIFICATION.RECOVERY_NOT_COMPLETED);
    assert.equal(exitCode, EXIT.FAILURE);
    assert.equal(result.recoveryComplete, false);
  });

  it('deletedCount:1 lock absent → RECOVERY_COMPLETE', async () => {
    const doc = lockDoc();
    const { result, exitCode } = await runWith(recoverEnv(doc), {
      doc,
      postDeleteDoc: null
    });
    assert.equal(result.classification, CLASSIFICATION.RECOVERY_COMPLETE);
    assert.equal(exitCode, EXIT.OK);
    assert.equal(result.recoveryComplete, true);
    assert.equal(result.verificationComplete, true);
    assert.equal(result.replacementPresent, false);
    assert.equal(result.noRetry, true);
  });

  it('deletedCount:1 foreign replacement → complete with warning', async () => {
    const doc = lockDoc();
    const replacement = {
      _id: ACTIVATION_LOCK_ID,
      ownerToken: tokenB(),
      acquiredAt: new Date()
    };
    const { result, exitCode } = await runWith(recoverEnv(doc), {
      doc,
      postDeleteDoc: replacement
    });
    assert.equal(result.classification, CLASSIFICATION.RECOVERY_COMPLETE);
    assert.equal(exitCode, EXIT.OK);
    assert.equal(result.replacementPresent, true);
    assert.deepEqual(result.warnings, [
      { code: WARNING_CODES.FOREIGN_REPLACEMENT_PRESENT }
    ]);
    assert.equal(result.noRetry, true);
    assertNoSecrets(result, [tokenA(), tokenB()]);
  });

  it('deletedCount:1 verification throws → complete with verification warning', async () => {
    const doc = lockDoc();
    let phase = 0;
    const state = {
      onFindOne() {
        phase += 1;
        if (phase <= 2) return doc; // first + observation
        throw new Error('verify boom');
      },
      onDeleteOne() {
        return { acknowledged: true, deletedCount: 1 };
      }
    };
    const { result, exitCode } = await runWith(recoverEnv(doc), state);
    assert.equal(result.classification, CLASSIFICATION.RECOVERY_COMPLETE);
    assert.equal(exitCode, EXIT.OK);
    assert.equal(result.recoveryComplete, true);
    assert.equal(result.verificationComplete, false);
    assert.deepEqual(result.warnings, [
      { code: WARNING_CODES.VERIFICATION_UNREADABLE }
    ]);
  });

  it('delete throws then owner absent → complete', async () => {
    const doc = lockDoc();
    let reads = 0;
    const state = {
      onFindOne() {
        reads += 1;
        if (reads <= 2) return doc;
        return null;
      },
      deleteThrow: true
    };
    const { result, exitCode } = await runWith(recoverEnv(doc), state);
    assert.equal(result.classification, CLASSIFICATION.RECOVERY_COMPLETE);
    assert.equal(exitCode, EXIT.OK);
    assert.equal(result.recoveryComplete, true);
  });

  it('delete throws then foreign replacement → complete with warning', async () => {
    const doc = lockDoc();
    let reads = 0;
    const state = {
      onFindOne() {
        reads += 1;
        if (reads <= 2) return doc;
        return {
          _id: ACTIVATION_LOCK_ID,
          ownerToken: tokenB(),
          acquiredAt: new Date()
        };
      },
      deleteThrow: true
    };
    const { result, exitCode } = await runWith(recoverEnv(doc), state);
    assert.equal(result.classification, CLASSIFICATION.RECOVERY_COMPLETE);
    assert.equal(exitCode, EXIT.OK);
    assert.equal(result.replacementPresent, true);
  });

  it('exact owner remains → RECOVERY_NOT_COMPLETED', async () => {
    const doc = lockDoc();
    const state = {
      doc,
      onDeleteOne() {
        return { acknowledged: true, deletedCount: 0 };
      }
    };
    const { result, exitCode } = await runWith(recoverEnv(doc), state);
    assert.equal(result.classification, CLASSIFICATION.RECOVERY_NOT_COMPLETED);
    assert.equal(exitCode, EXIT.FAILURE);
    assert.equal(result.recoveryComplete, false);
  });

  it('delete and verification both unreadable → UNCERTAIN no-retry', async () => {
    const doc = lockDoc();
    let reads = 0;
    const state = {
      onFindOne() {
        reads += 1;
        if (reads <= 2) return doc;
        throw new Error('verify unreadable');
      },
      deleteThrow: true
    };
    const { result, exitCode } = await runWith(recoverEnv(doc), state);
    assert.equal(result.classification, CLASSIFICATION.RECOVERY_OUTCOME_UNCERTAIN);
    assert.equal(exitCode, EXIT.FAILURE);
    assert.equal(result.recoveryComplete, false);
    assert.equal(result.instruction, 'DO_NOT_RETRY_AUTOMATICALLY');
    assert.equal(result.noRetry, true);
  });

  it('committed deletion never becomes retryable failure (interpret table)', () => {
    const complete = interpretDeleteOutcome({
      deleteAcknowledged: true,
      deletedCount: 1,
      deleteThrew: false,
      verifyDoc: null,
      verifyThrew: false,
      expectedOwnerToken: tokenA()
    });
    assert.equal(complete.classification, CLASSIFICATION.RECOVERY_COMPLETE);
    assert.equal(complete.exitCode, EXIT.OK);
    assert.equal(complete.noRetry, true);

    const warn = interpretDeleteOutcome({
      deleteAcknowledged: true,
      deletedCount: 1,
      deleteThrew: false,
      verifyDoc: { ownerToken: tokenB() },
      verifyThrew: false,
      expectedOwnerToken: tokenA()
    });
    assert.equal(warn.classification, CLASSIFICATION.RECOVERY_COMPLETE);
    assert.equal(warn.exitCode, EXIT.OK);
  });

  it('pre-delete failure never reports recovery complete', async () => {
    const doc = lockDoc();
    const state = {
      onFindOne() {
        throw new Error('pre-delete read failed');
      }
    };
    const { result, exitCode } = await runWith(recoverEnv(doc), state);
    assert.equal(result.classification, CLASSIFICATION.PRE_DELETE_FAILED);
    assert.equal(exitCode, EXIT.FAILURE);
    assert.equal(result.recoveryComplete, false);
  });
});

describe('RP5 static scans', () => {
  it('mutation scan: only conditional deleteOne; no RatePlan models', () => {
    const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
    assert.match(src, /deleteOne\(/);
    assert.equal(/\.(insertOne|updateOne|updateMany|replaceOne|findOneAndUpdate)\(/.test(src), false);
    assert.equal(/createIndex|createIndexes|ensureIndexes|syncIndexes/.test(src), false);
    assert.equal(/\.drop\(|dropDatabase|dropCollection/.test(src), false);
    assert.equal(/startSession|withTransaction/.test(src), false);
    assert.equal(/expireAfterSeconds/.test(src), false);
    assert.equal(/require\(['\"]\.\.\/models\/RatePlan/.test(src), false);
    assert.equal(/require\(['\"]mongoose['\"]\)/.test(src.split('loadMongoose')[0]), false);
    // Lazy require only inside functions
    assert.match(src, /loadMongoose\s*\|\|\s*\(\(\)\s*=>\s*require\('mongoose'\)\)/);
  });

  it('owner token never appears in result JSON for happy recover', async () => {
    const doc = lockDoc();
    const { result } = await runWith(recoverEnv(doc), { doc, postDeleteDoc: null });
    assertNoSecrets(result, [doc.ownerToken, 'SECRET', 'hunter2']);
  });

  it('runbook has no activation-enablement command', () => {
    const md = fs.readFileSync(RUNBOOK_PATH, 'utf8');
    assert.match(md, /RATEPLAN_ACTIVATION_LOCK_RECOVERY_MODE=inspect/);
    assert.match(md, /I_CONFIRM_NO_RATEPLAN_ACTIVATION_IS_RUNNING/);
    assert.match(md, /quiescen/i);
    assert.match(md, /15\s*minutes/i);
    assert.match(md, /DO_NOT_RETRY|no automatic retry/i);
    assert.equal(/ENABLE.*=.*1|activation.*enable|pm2\s+restart/i.test(md) &&
      /RATEPLAN.*ENABLE|ENABLE_RATEPLAN|PRODUCTION_ACTIVATION.*=/.test(md), false);
    // Explicitly forbids enabling production activation
    assert.match(md, /does not authorize.*activation|no production activation enablement/i);
    assert.match(md, /separate explicit authorization/i);
  });
});
