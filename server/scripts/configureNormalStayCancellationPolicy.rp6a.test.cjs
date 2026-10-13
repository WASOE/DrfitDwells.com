/**
 * RP6A / Correction 1 — Normal-stay CancellationPolicy configure + engine tests.
 *
 * Run: node --test server/scripts/configureNormalStayCancellationPolicy.rp6a.test.cjs
 *
 * No MongoDB, network, or production environment.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const script = require('./configureNormalStayCancellationPolicy.cjs');
const {
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
  disableMongooseAutoIndexAndAutoCreate,
  isDuplicateKeyError,
  verifyPersistedShape,
  runConfigureNormalStayCancellationPolicy
} = script;

const {
  validateAndNormalizeCancellationPolicy,
  calculateCancellationOutcome,
  buildCancellationPolicySnapshot,
  isWithinCorrectionWindow
} = require('../services/cancellationPolicyService');

const SCRIPT_PATH = path.join(__dirname, 'configureNormalStayCancellationPolicy.cjs');
const SERVICE_PATH = path.join(__dirname, '../services/cancellationPolicyService.js');
const RUNBOOK_PATH = path.join(
  __dirname,
  '../../docs/runbooks/normal-stay-cancellation-policy.md'
);

function assertNoSecrets(value) {
  const json = JSON.stringify(value);
  assert.equal(json.includes('mongodb://'), false);
  assert.equal(json.includes('mongodb+srv://'), false);
  assert.equal(/password=/i.test(json), false);
  assert.equal(json.includes('\n    at '), false);
  assert.equal(json.includes('E11000'), false);
}

function approvedSnapshot() {
  const n = normalizeApprovedPolicy();
  assert.equal(n.ok, true);
  return buildCancellationPolicySnapshot(n.value);
}

function outcomeForDays(daysBeforeArrival, eventType = 'customer_cancellation') {
  const snapshot = approvedSnapshot();
  const cancelIso = '2026-11-01T10:00:00+02:00';
  const d = new Date(Date.UTC(2026, 10, 1 + daysBeforeArrival));
  const arrivalDateOnly = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return calculateCancellationOutcome({
    policySnapshot: snapshot,
    bookingTimestamp: '2026-10-01T10:00:00+03:00',
    arrivalDate: arrivalDateOnly,
    cancellationTimestamp: cancelIso,
    cancellableAmount: 100,
    eventType
  });
}

function makeFakeModel(state) {
  function resolveDoc(filter) {
    if (typeof state.onFindOne === 'function') {
      return state.onFindOne(filter, state);
    }
    return (
      state.docs.find(
        (d) => d.code === filter.code && d.version === filter.version
      ) || null
    );
  }

  return {
    async create(payload) {
      state.createCalls = (state.createCalls || 0) + 1;
      state.lastCreatePayload = payload;
      if (typeof state.onCreate === 'function') {
        return state.onCreate(payload, state);
      }
      if (state.createThrow) {
        throw state.createThrow;
      }
      const doc = {
        ...payload,
        _id: 'fake-id-1',
        __v: 0,
        createdAt: new Date('2026-09-19T12:00:00.000Z'),
        updatedAt: new Date('2026-09-19T12:00:00.000Z'),
        toObject() {
          const { toObject: _t, ...rest } = this;
          void _t;
          return { ...rest };
        }
      };
      state.docs.push(doc);
      return doc;
    },
    findOne(filter) {
      state.findOneCalls = (state.findOneCalls || 0) + 1;
      const getDoc = async () => {
        const r = resolveDoc(filter);
        return await r;
      };
      return {
        lean() {
          return getDoc().then((d) => {
            if (!d) return null;
            return typeof d.toObject === 'function' ? d.toObject() : { ...d };
          });
        },
        then(onFulfilled, onRejected) {
          return getDoc().then(onFulfilled, onRejected);
        },
        catch(onRejected) {
          return getDoc().catch(onRejected);
        }
      };
    }
  };
}

function makeNativeCollection(state) {
  return {
    async countDocuments() {
      return state.docs.length;
    },
    async findOne(filter) {
      return (
        state.docs.find(
          (d) => d.code === filter.code && d.version === filter.version
        ) || null
      );
    },
    async indexes() {
      return (
        state.indexes || [
          { name: '_id_', key: { _id: 1 } },
          { name: 'code_1_version_1', key: { code: 1, version: 1 }, unique: true },
          { name: 'status_1_policyType_1', key: { status: 1, policyType: 1 } }
        ]
      );
    },
    async insertOne() {
      throw new Error('native insertOne forbidden in create path');
    },
    async updateOne() {
      throw new Error('updateOne forbidden');
    },
    async deleteOne() {
      throw new Error('deleteOne forbidden');
    },
    async createIndex() {
      throw new Error('createIndex forbidden');
    }
  };
}

async function runCreate(env, state, extras = {}) {
  let exitCode = null;
  const logs = [];
  const model = makeFakeModel(state);
  const collection = makeNativeCollection(state);
  const mongooseStub = {
    set() {},
    connect: async () => {},
    disconnect: async () => {},
    connection: {
      readyState: 1,
      db: {
        listCollections: async () =>
          state.collectionAbsent ? [] : [{ name: COLLECTION_NAME }],
        collection: () => collection
      }
    }
  };

  const result = await runConfigureNormalStayCancellationPolicy({
    env,
    exit: (c) => {
      exitCode = c;
    },
    log: (event, fields) => {
      logs.push({ event, fields });
    },
    loadMongoose: () => mongooseStub,
    loadServerEnv: async () => {},
    connectNative: async () => ({
      mongoose: mongooseStub,
      db: mongooseStub.connection.db,
      collection
    }),
    connectWithModel: async () => ({
      mongoose: mongooseStub,
      db: mongooseStub.connection.db,
      collection,
      CancellationPolicy: model
    }),
    disconnect: async () => {
      state.disconnectCalls = (state.disconnectCalls || 0) + 1;
    },
    validateAndNormalize: validateAndNormalizeCancellationPolicy,
    createDocument: async (CancellationPolicy, payload) =>
      CancellationPolicy.create(payload),
    ...extras.runtime
  });
  return { result, exitCode, logs, state, model };
}

async function runInspect(env, state) {
  let exitCode = null;
  let modelLoaded = false;
  const collection = makeNativeCollection(state);
  const mongooseStub = {
    set() {},
    connect: async () => {},
    disconnect: async () => {},
    connection: { readyState: 1, db: { collection: () => collection } }
  };
  const result = await runConfigureNormalStayCancellationPolicy({
    env,
    exit: (c) => {
      exitCode = c;
    },
    log: () => {},
    loadMongoose: () => mongooseStub,
    loadServerEnv: async () => {},
    connectNative: async () => ({
      mongoose: mongooseStub,
      db: mongooseStub.connection.db,
      collection
    }),
    connectWithModel: async () => {
      modelLoaded = true;
      throw new Error('inspect must not load model');
    },
    disconnect: async () => {},
    validateAndNormalize: validateAndNormalizeCancellationPolicy
  });
  return { result, exitCode, modelLoaded };
}

describe('RP6A approved policy payload', () => {
  it('normalizes to the exact approved document shape', () => {
    const n = normalizeApprovedPolicy();
    assert.equal(n.ok, true);
    assert.equal(n.value.code, POLICY_CODE);
    assert.equal(n.value.version, 2);
    assert.equal(n.value.correctionWindowHours, 0);
    assert.equal(n.value.status, 'draft');
    assert.equal(n.value.legalReviewStatus, 'pending');
    assert.equal(n.value.cashRefundAdminFeeCents, 1500);
    assert.deepEqual(n.value.bookingCreditRules, {
      enabled: true,
      minDaysBeforeArrival: 14,
      creditPercent: 100,
      requiresExplicitChoice: true,
      subjectToAvailability: true
    });
    assert.equal(n.value.noShowRefundPercent, 0);
    assert.equal(n.value.earlyDepartureRefundPercent, 0);
    assert.equal(n.value.dateTransferRules.enabled, false);
    assert.equal(n.value.nameTransferRules.enabled, false);
  });

  it('does not encode winter-specific behavior', () => {
    const raw = JSON.stringify(buildApprovedPolicyInput());
    assert.equal(/winter|christmas|snow/i.test(raw), false);
  });
});

describe('RP6A correction-window zero hours', () => {
  it('zero hours at elapsed 0ms uses refund tier (not CORRECTION_WINDOW)', () => {
    const snapshot = approvedSnapshot();
    assert.equal(
      isWithinCorrectionWindow(
        snapshot,
        '2026-10-01T10:00:00.000+03:00',
        '2026-10-01T10:00:00.000+03:00'
      ),
      false
    );
    const o = calculateCancellationOutcome({
      policySnapshot: snapshot,
      bookingTimestamp: '2026-10-01T10:00:00.000+03:00',
      arrivalDate: '2026-11-01',
      cancellationTimestamp: '2026-10-01T10:00:00.000+03:00',
      cancellableAmount: 100,
      eventType: 'customer_cancellation'
    });
    assert.equal(o.correctionWindowEligible, false);
    assert.equal(o.decisionReasonCode, 'TIER_REFUND');
    assert.equal(o.refundPercent, 100);
  });

  it('zero hours at elapsed 1ms uses tier', () => {
    const snapshot = approvedSnapshot();
    const o = calculateCancellationOutcome({
      policySnapshot: snapshot,
      bookingTimestamp: '2026-10-01T10:00:00.000+03:00',
      arrivalDate: '2026-11-01',
      cancellationTimestamp: '2026-10-01T10:00:00.001+03:00',
      cancellableAmount: 100,
      eventType: 'customer_cancellation'
    });
    assert.equal(o.correctionWindowEligible, false);
    assert.equal(o.decisionReasonCode, 'TIER_REFUND');
  });

  it('positive correction window still works at booking time', () => {
    const base = approvedSnapshot();
    const withWindow = buildCancellationPolicySnapshot({
      ...base,
      correctionWindowHours: 48,
      correctionWindowMinDaysBeforeArrival: 0
    });
    const o = calculateCancellationOutcome({
      policySnapshot: withWindow,
      bookingTimestamp: '2026-10-01T10:00:00.000+03:00',
      arrivalDate: '2026-11-01',
      cancellationTimestamp: '2026-10-01T10:00:00.000+03:00',
      cancellableAmount: 100,
      eventType: 'customer_cancellation'
    });
    assert.equal(o.correctionWindowEligible, true);
    assert.equal(o.decisionReasonCode, 'CORRECTION_WINDOW');
    assert.equal(o.refundPercent, 100);
  });

  it('positive correction window expires correctly', () => {
    const base = approvedSnapshot();
    const withWindow = buildCancellationPolicySnapshot({
      ...base,
      correctionWindowHours: 1,
      correctionWindowMinDaysBeforeArrival: 0
    });
    const o = calculateCancellationOutcome({
      policySnapshot: withWindow,
      bookingTimestamp: '2026-10-01T10:00:00.000+03:00',
      arrivalDate: '2026-11-01',
      cancellationTimestamp: '2026-10-01T11:00:00.001+03:00',
      cancellableAmount: 100,
      eventType: 'customer_cancellation'
    });
    assert.equal(o.correctionWindowEligible, false);
    assert.equal(o.decisionReasonCode, 'TIER_REFUND');
  });
});

describe('v2 policy-engine boundary truth table', () => {
  it('calculates cash and voluntary credit options at every boundary', () => {
    const day30 = outcomeForDays(30);
    assert.equal(day30.refundPercent, 100);
    assert.equal(day30.grossRefundAmount, 100);
    assert.equal(day30.cashRefundAdminFeeAmount, 15);
    assert.equal(day30.refundAmount, 85);
    assert.equal(day30.bookingCreditOption.eligible, true);
    assert.equal(day30.bookingCreditOption.creditAmount, 100);

    const day29 = outcomeForDays(29);
    assert.equal(day29.refundPercent, 50);
    assert.equal(day29.grossRefundAmount, 50);
    assert.equal(day29.cashRefundAdminFeeAmount, 15);
    assert.equal(day29.refundAmount, 35);
    assert.equal(day29.bookingCreditOption.creditAmount, 100);

    const day14 = outcomeForDays(14);
    assert.equal(day14.refundPercent, 50);
    assert.equal(day14.refundAmount, 35);
    assert.equal(day14.bookingCreditOption.eligible, true);

    const day13 = outcomeForDays(13);
    assert.equal(day13.refundPercent, 0);
    assert.equal(day13.cashRefundAdminFeeAmount, 0);
    assert.equal(day13.refundAmount, 0);
    assert.equal(day13.bookingCreditOption.eligible, false);

    const noShow = outcomeForDays(0, 'no_show');
    assert.equal(noShow.refundAmount, 0);
    assert.equal(noShow.bookingCreditOption.eligible, false);
    assert.equal(outcomeForDays(3, 'early_departure').refundAmount, 0);
  });

  it('never deducts more than the cash amount otherwise refundable', () => {
    const snapshot = approvedSnapshot();
    const result = calculateCancellationOutcome({
      policySnapshot: snapshot,
      bookingTimestamp: '2026-10-01T10:00:00+03:00',
      arrivalDate: '2026-12-15',
      cancellationTimestamp: '2026-11-01T10:00:00+02:00',
      cancellableAmount: 10,
      eventType: 'customer_cancellation'
    });
    assert.equal(result.grossRefundAmount, 10);
    assert.equal(result.cashRefundAdminFeeAmount, 10);
    assert.equal(result.refundAmount, 0);
    assert.equal(result.retainedAmount, 10);
  });

  it('does not charge the administration fee when Drift & Dwells cancels', () => {
    const result = outcomeForDays(30, 'organizer_cancellation');
    assert.equal(result.refundPercent, 100);
    assert.equal(result.cashRefundAdminFeeAmount, 0);
    assert.equal(result.refundAmount, 100);
  });
});

describe('RP6A configure script modes', () => {
  it('disabled / invalid never connect', async () => {
    let loaded = false;
    let exitCode = null;
    const disabled = await runConfigureNormalStayCancellationPolicy({
      env: {},
      exit: (c) => {
        exitCode = c;
      },
      log: () => {},
      loadMongoose: () => {
        loaded = true;
        return {};
      }
    });
    assert.equal(disabled.classification, CLASSIFICATION.DISABLED);
    assert.equal(exitCode, EXIT.OK);
    assert.equal(loaded, false);

    exitCode = null;
    const invalid = await runConfigureNormalStayCancellationPolicy({
      env: { [MODE_ENV]: 'wipe' },
      exit: (c) => {
        exitCode = c;
      },
      log: () => {},
      loadMongoose: () => {
        loaded = true;
        return {};
      }
    });
    assert.equal(invalid.classification, CLASSIFICATION.INVALID_MODE);
    assert.equal(exitCode, EXIT.FAILURE);
  });

  it('create without confirmation never connects', async () => {
    let connected = false;
    let exitCode = null;
    const result = await runConfigureNormalStayCancellationPolicy({
      env: { [MODE_ENV]: 'create' },
      exit: (c) => {
        exitCode = c;
      },
      log: () => {},
      connectWithModel: async () => {
        connected = true;
        throw new Error('should not');
      }
    });
    assert.equal(result.classification, CLASSIFICATION.UNAUTHORIZED);
    assert.equal(exitCode, EXIT.FAILURE);
    assert.equal(connected, false);
  });

  it('inspect is read-only and does not load the model', async () => {
    const { result, exitCode, modelLoaded } = await runInspect(
      { [MODE_ENV]: 'inspect' },
      { docs: [] }
    );
    assert.equal(result.classification, CLASSIFICATION.INSPECTION_COMPLETE);
    assert.equal(exitCode, EXIT.OK);
    assert.equal(result.mutationAttempted, false);
    assert.equal(modelLoaded, false);
  });

  it('refuses create when collection is absent', async () => {
    const { result, exitCode } = await runCreate(
      {
        [MODE_ENV]: 'create',
        [CREATE_CONFIRM_ENV]: CREATE_CONFIRM_ACCEPTED
      },
      { docs: [], collectionAbsent: true }
    );
    assert.equal(result.classification, CLASSIFICATION.COLLECTION_ABSENT);
    assert.equal(exitCode, EXIT.FAILURE);
    assert.equal(result.mutationAttempted, false);
  });

  it('create persists via model with __v=0 and timestamps', async () => {
    const { result, exitCode, state } = await runCreate(
      {
        [MODE_ENV]: 'create',
        [CREATE_CONFIRM_ENV]: CREATE_CONFIRM_ACCEPTED
      },
      { docs: [] }
    );
    assert.equal(result.classification, CLASSIFICATION.CREATE_COMPLETE);
    assert.equal(exitCode, EXIT.OK);
    assert.equal(state.createCalls, 1);
    assert.equal(state.docs.length, 1);
    assert.equal(state.docs[0].__v, 0);
    assert.ok(state.docs[0].createdAt);
    assert.ok(state.docs[0].updatedAt);
    assert.equal(result.persistedVersionKey, 0);
    assert.equal(result.hasTimestamps, true);
    const shape = verifyPersistedShape(state.docs[0]);
    assert.equal(shape.ok, true);
    assertNoSecrets(result);
  });

  it('matching existing does not rewrite', async () => {
    const n = normalizeApprovedPolicy().value;
    const { result, exitCode, state } = await runCreate(
      {
        [MODE_ENV]: 'create',
        [CREATE_CONFIRM_ENV]: CREATE_CONFIRM_ACCEPTED
      },
      { docs: [{ ...n, _id: 'x', __v: 0, createdAt: new Date(), updatedAt: new Date() }] }
    );
    assert.equal(result.classification, CLASSIFICATION.ALREADY_PRESENT_MATCH);
    assert.equal(exitCode, EXIT.OK);
    assert.equal(state.createCalls || 0, 0);
  });

  it('conflicting existing refuses without mutation', async () => {
    const n = normalizeApprovedPolicy().value;
    const { result, exitCode, state } = await runCreate(
      {
        [MODE_ENV]: 'create',
        [CREATE_CONFIRM_ENV]: CREATE_CONFIRM_ACCEPTED
      },
      {
        docs: [
          {
            ...n,
            noShowRefundPercent: 50,
            _id: 'x',
            __v: 0,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        ]
      }
    );
    assert.equal(result.classification, CLASSIFICATION.CONFLICTING_EXISTING);
    assert.equal(exitCode, EXIT.FAILURE);
    assert.equal(state.createCalls || 0, 0);
  });
});

describe('RP6A concurrent create handling', () => {
  it('duplicate key then matching document → CONCURRENT_CREATE_MATCH', async () => {
    const n = normalizeApprovedPolicy().value;
    const winner = {
      ...n,
      _id: 'winner',
      __v: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const state = {
      docs: [],
      onCreate: () => {
        const err = new Error('E11000 duplicate key');
        err.code = 11000;
        // peer won the race
        state.docs.push(winner);
        throw err;
      },
      duplicateRereadLean: true
    };
    const { result, exitCode, logs } = await runCreate(
      {
        [MODE_ENV]: 'create',
        [CREATE_CONFIRM_ENV]: CREATE_CONFIRM_ACCEPTED
      },
      state
    );
    assert.equal(result.classification, CLASSIFICATION.CONCURRENT_CREATE_MATCH);
    assert.equal(exitCode, EXIT.OK);
    assert.equal(state.docs.length, 1);
    assertNoSecrets({ result, logs });
  });

  it('duplicate key then conflicting document → CONFLICTING_EXISTING', async () => {
    const n = normalizeApprovedPolicy().value;
    const state = {
      docs: [],
      onCreate: () => {
        state.docs.push({
          ...n,
          earlyDepartureRefundPercent: 25,
          _id: 'bad',
          __v: 0,
          createdAt: new Date(),
          updatedAt: new Date()
        });
        const err = new Error('E11000 duplicate key');
        err.code = 11000;
        throw err;
      },
      duplicateRereadLean: true
    };
    const { result, exitCode } = await runCreate(
      {
        [MODE_ENV]: 'create',
        [CREATE_CONFIRM_ENV]: CREATE_CONFIRM_ACCEPTED
      },
      state
    );
    assert.equal(result.classification, CLASSIFICATION.CONFLICTING_EXISTING);
    assert.equal(exitCode, EXIT.FAILURE);
  });

  it('duplicate key then verification failure → CREATE_OUTCOME_UNCERTAIN no retry', async () => {
    const state = {
      docs: [],
      onCreate: () => {
        const err = new Error('E11000 duplicate key');
        err.code = 11000;
        throw err;
      },
      onFindOne: async () => {
        throw new Error('reread boom mongodb://secret');
      }
    };
    // Override findOne to throw on lean path
    const { result, exitCode, logs } = await runCreate(
      {
        [MODE_ENV]: 'create',
        [CREATE_CONFIRM_ENV]: CREATE_CONFIRM_ACCEPTED
      },
      state,
      {
        runtime: {
          createDocument: async () => {
            const err = new Error('E11000 duplicate key');
            err.code = 11000;
            throw err;
          },
          connectWithModel: async () => {
            const collection = makeNativeCollection(state);
            return {
              mongoose: { disconnect: async () => {} },
              db: {
                listCollections: async () => [{ name: COLLECTION_NAME }]
              },
              collection,
              CancellationPolicy: {
                create: async () => {
                  const err = new Error('E11000 duplicate key');
                  err.code = 11000;
                  throw err;
                },
                findOne: () => {
                  throw new Error('reread boom');
                }
              }
            };
          }
        }
      }
    );
    assert.equal(result.classification, CLASSIFICATION.CREATE_OUTCOME_UNCERTAIN);
    assert.equal(exitCode, EXIT.FAILURE);
    assert.equal(result.noAutomaticRetry, true);
    assertNoSecrets({ result, logs });
  });

  it('save succeeds but post-write verification fails → VERIFY_FAILED no retry', async () => {
    let finds = 0;
    const n = normalizeApprovedPolicy().value;
    const { result, exitCode } = await runCreate(
      {
        [MODE_ENV]: 'create',
        [CREATE_CONFIRM_ENV]: CREATE_CONFIRM_ACCEPTED
      },
      {
        docs: [],
        onCreate: (payload) => ({
          ...payload,
          _id: 'x',
          __v: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          toObject() {
            return { ...this };
          }
        }),
        onFindOne: async () => {
          finds += 1;
          // Return mismatched content on verify
          return {
            ...n,
            noShowRefundPercent: 99,
            _id: 'x',
            __v: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
            toObject() {
              return { ...this };
            }
          };
        }
      }
    );
    assert.equal(result.classification, CLASSIFICATION.VERIFY_FAILED);
    assert.equal(exitCode, EXIT.FAILURE);
    assert.equal(result.noAutomaticRetry, true);
    assert.ok(finds >= 1);
  });

  it('isDuplicateKeyError detects E11000 without leaking', () => {
    const err = new Error('E11000 duplicate key index');
    err.code = 11000;
    assert.equal(isDuplicateKeyError(err), true);
    assert.equal(isDuplicateKeyError(new Error('other')), false);
  });

  it('no automatic retry loops in script source', () => {
    const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
    assert.equal(/while\s*\(\s*true\s*\)/.test(src), false);
    assert.equal(/for\s*\(\s*;\s*;\s*\)/.test(src), false);
    assert.match(src, /noAutomaticRetry/);
  });
});

describe('RP6A safety scans', () => {
  it('create path uses model create; no native insertOne / index mutation / RatePlan', () => {
    const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
    assert.match(src, /CancellationPolicy\.create|createDocument/);
    assert.equal(/collection\.insertOne/.test(src), false);
    assert.equal(/syncIndexes|createIndexes|ensureIndexes|createCollection/.test(src), false);
    assert.equal(/activateRatePlan|rateplans/.test(src), false);
    assert.equal(/\.updateOne|\.deleteOne|\.replaceOne/.test(src), false);
  });

  it('autoIndex disabled before model require in defaultConnectWithModel', () => {
    const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
    const fnStart = src.indexOf('async function defaultConnectWithModel');
    const slice = src.slice(fnStart, fnStart + 800);
    const disableAt = slice.indexOf('disableMongooseAutoIndexAndAutoCreate');
    const requireAt = slice.indexOf('CancellationPolicy');
    assert.ok(disableAt >= 0 && requireAt > disableAt);
  });

  it('service requires hours > 0 for correction window', () => {
    const src = fs.readFileSync(SERVICE_PATH, 'utf8');
    assert.match(src, /hours <= 0/);
  });

  it('disableMongooseAutoIndexAndAutoCreate sets both false', () => {
    const calls = [];
    disableMongooseAutoIndexAndAutoCreate({
      set(k, v) {
        calls.push([k, v]);
      }
    });
    assert.deepEqual(calls, [
      ['autoIndex', false],
      ['autoCreate', false]
    ]);
    assert.deepEqual(STANDALONE_CONNECT_OPTIONS, {
      autoIndex: false,
      autoCreate: false
    });
  });
});

describe('RP6A runbook', () => {
  it('documents v2 policy, historical protection, and activation gate', () => {
    const md = fs.readFileSync(RUNBOOK_PATH, 'utf8');
    assert.match(md, /normal-stay-standard@v2/);
    assert.match(md, /€15 administration fee/);
    assert.match(md, /booking credit/i);
    assert.match(md, /100% of the original booking amount/);
    assert.match(md, /Version 1 remains immutable/i);
    assert.match(md, /status=draft/);
    assert.match(md, /legalReviewStatus=pending/);
    assert.match(md, /Bulgarian\/EU legal approval/i);
    assert.match(md, /does not modify RatePlans/i);
    assert.match(md, /explicit authorization/i);
  });
});
