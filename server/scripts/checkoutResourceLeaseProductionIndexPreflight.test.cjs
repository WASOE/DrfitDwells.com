/**
 * B8F6A — Checkout resource-lease production index preflight tests.
 *
 * Run: node --test --test-concurrency=1 server/scripts/checkoutResourceLeaseProductionIndexPreflight.test.cjs
 */
'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const preflight = require('./checkoutResourceLeaseProductionIndexPreflight.cjs');
const {
  PREFLIGHT_EXECUTE_FLAG,
  PREFLIGHT_ACCEPTED_TRUE,
  REQUIRED_INDEX_SPECS,
  REQUIRED_COLLECTIONS,
  CLASSIFICATION,
  EXIT,
  isPreflightExecuteEnabled,
  indexKeyMatchesSpec,
  classifyRequiredIndex,
  classifyAllIndexes,
  optionsConflictAgainstSpec,
  aggregatePreflight,
  buildDuplicateProbePipeline,
  requiredKeyObject,
  runProductionIndexPreflight
} = preflight;

const ORIG_FLAG = process.env[PREFLIGHT_EXECUTE_FLAG];
const ORIG_LEASE = process.env.CHECKOUT_RESOURCE_LEASE_ENABLED;
const ORIG_EXECUTE = process.env.ACCOMMODATION_CHECKOUT_HOLD_EXPIRY_EXECUTE;

function restoreEnv() {
  if (ORIG_FLAG === undefined) delete process.env[PREFLIGHT_EXECUTE_FLAG];
  else process.env[PREFLIGHT_EXECUTE_FLAG] = ORIG_FLAG;
  if (ORIG_LEASE === undefined) delete process.env.CHECKOUT_RESOURCE_LEASE_ENABLED;
  else process.env.CHECKOUT_RESOURCE_LEASE_ENABLED = ORIG_LEASE;
  if (ORIG_EXECUTE === undefined) {
    delete process.env.ACCOMMODATION_CHECKOUT_HOLD_EXPIRY_EXECUTE;
  } else {
    process.env.ACCOMMODATION_CHECKOUT_HOLD_EXPIRY_EXECUTE = ORIG_EXECUTE;
  }
}

afterEach(() => {
  restoreEnv();
});

function exactIndexDoc(spec, extra = {}) {
  return {
    name: spec.name,
    key: requiredKeyObject(spec),
    ...(spec.options || {}),
    ...extra
  };
}

function allExactIndexes() {
  const byCollection = {};
  for (const spec of REQUIRED_INDEX_SPECS) {
    if (!byCollection[spec.collectionName]) {
      byCollection[spec.collectionName] = [
        { name: '_id_', key: { _id: 1 } }
      ];
    }
    byCollection[spec.collectionName].push(exactIndexDoc(spec));
  }
  return byCollection;
}

function resolveAllPresent() {
  return async (collectionName) => ({
    ok: true,
    name: collectionName,
    collection: { name: collectionName }
  });
}

function listFromMap(map) {
  return async (_collection, collectionName) => map[collectionName] || [];
}

async function runEnabled(overrides = {}) {
  let exitCode = null;
  const res = await runProductionIndexPreflight({
    env: { [PREFLIGHT_EXECUTE_FLAG]: PREFLIGHT_ACCEPTED_TRUE },
    exit: (c) => {
      exitCode = c;
    },
    connect: async () => {},
    disconnect: async () => {},
    resolveCollection: resolveAllPresent(),
    listIndexes: listFromMap(allExactIndexes()),
    countDuplicateGroups: async () => 0,
    ...overrides
  });
  return { res, exitCode };
}

describe('B8F6A import and flag gate', () => {
  it('1. importing the module has no side effects', () => {
    assert.equal(typeof runProductionIndexPreflight, 'function');
    assert.equal(isPreflightExecuteEnabled({}), false);
    assert.equal(process.env[PREFLIGHT_EXECUTE_FLAG], ORIG_FLAG);
    assert.equal(REQUIRED_INDEX_SPECS.length, 22);
    assert.equal(REQUIRED_COLLECTIONS.length, 3);
  });

  it('2. flag missing or malformed performs no connection', async () => {
    for (const env of [
      {},
      { [PREFLIGHT_EXECUTE_FLAG]: '' },
      { [PREFLIGHT_EXECUTE_FLAG]: '0' },
      { [PREFLIGHT_EXECUTE_FLAG]: 'true' },
      { [PREFLIGHT_EXECUTE_FLAG]: 'TRUE' },
      { [PREFLIGHT_EXECUTE_FLAG]: 'yes' }
    ]) {
      let connects = 0;
      let lists = 0;
      let exitCode = null;
      const res = await runProductionIndexPreflight({
        env,
        exit: (c) => {
          exitCode = c;
        },
        connect: async () => {
          connects += 1;
        },
        resolveCollection: async () => {
          throw new Error('must_not_resolve');
        },
        listIndexes: async () => {
          lists += 1;
          return [];
        }
      });
      assert.equal(res.classification, CLASSIFICATION.DISABLED);
      assert.equal(res.connected, false);
      assert.equal(connects, 0);
      assert.equal(lists, 0);
      assert.equal(exitCode, EXIT.DISABLED_OR_MATCH);
    }
  });

  it('3. exact "1" permits read-only inspection', async () => {
    let connects = 0;
    let lists = 0;
    const { res, exitCode } = await runEnabled({
      connect: async () => {
        connects += 1;
      },
      listIndexes: async (_c, name) => {
        lists += 1;
        return allExactIndexes()[name] || [];
      }
    });
    assert.equal(connects, 1);
    assert.equal(lists, 3);
    assert.equal(res.classification, CLASSIFICATION.MATCH);
    assert.equal(res.ready, true);
    assert.equal(exitCode, EXIT.DISABLED_OR_MATCH);
  });
});

describe('B8F6A inventory and classification', () => {
  it('4. inventory covers lease, attempt, and facility critical uniques', () => {
    const ids = REQUIRED_INDEX_SPECS.map((s) => s.id);
    assert.ok(ids.includes('lease_leaseId_unique'));
    assert.ok(ids.includes('lease_checkoutId_generation_unique'));
    assert.ok(ids.includes('lease_checkoutId_live_unique'));
    assert.ok(ids.includes('lease_released_cleanup_v2'));
    assert.ok(ids.includes('attempt_attemptId_unique'));
    assert.ok(ids.includes('attempt_checkoutId_live_unique'));
    assert.ok(ids.includes('facility_slot_lane_unique'));
    assert.ok(ids.includes('facility_facilityCode'));
    assert.ok(ids.includes('facility_status'));
    assert.ok(ids.includes('facility_checkoutSessionId'));
    assert.ok(ids.includes('facility_acquisitionAttemptId_sparse'));
  });

  it('5. exact matching index', () => {
    const spec = REQUIRED_INDEX_SPECS.find((s) => s.id === 'lease_leaseId_unique');
    const r = classifyRequiredIndex([exactIndexDoc(spec)], spec);
    assert.equal(r.classification, CLASSIFICATION.MATCH);
    assert.equal(r.ready, true);
  });

  it('6. index absent', () => {
    const spec = REQUIRED_INDEX_SPECS.find((s) => s.id === 'lease_leaseId_unique');
    const r = classifyRequiredIndex([{ name: '_id_', key: { _id: 1 } }], spec);
    assert.equal(r.classification, CLASSIFICATION.ABSENT);
  });

  it('7. name with wrong key', () => {
    const spec = REQUIRED_INDEX_SPECS.find((s) => s.id === 'lease_leaseId_unique');
    const r = classifyRequiredIndex(
      [{ name: spec.name, key: { checkoutId: 1 } }],
      spec
    );
    assert.equal(r.classification, CLASSIFICATION.NAME_CONFLICT);
  });

  it('8. wrong key order is not a match', () => {
    const spec = REQUIRED_INDEX_SPECS.find(
      (s) => s.id === 'lease_checkoutId_generation_unique'
    );
    assert.equal(
      indexKeyMatchesSpec({ generation: 1, checkoutId: 1 }, spec),
      false
    );
  });

  it('9. same keys under another name is KEY_CONFLICT', () => {
    const spec = REQUIRED_INDEX_SPECS.find((s) => s.id === 'lease_leaseId_unique');
    const r = classifyRequiredIndex(
      [{ name: 'other_leaseId', key: { leaseId: 1 }, unique: true }],
      spec
    );
    assert.equal(r.classification, CLASSIFICATION.KEY_CONFLICT);
  });

  it('10. unexpected unique on non-unique index is OPTION_CONFLICT', () => {
    const spec = REQUIRED_INDEX_SPECS.find((s) => s.id === 'lease_expiresAt');
    const r = classifyRequiredIndex(
      [exactIndexDoc(spec, { unique: true })],
      spec
    );
    assert.equal(r.classification, CLASSIFICATION.OPTION_CONFLICT);
  });

  it('11. missing required unique is OPTION_CONFLICT', () => {
    const spec = REQUIRED_INDEX_SPECS.find((s) => s.id === 'lease_leaseId_unique');
    const r = classifyRequiredIndex(
      [{ name: spec.name, key: requiredKeyObject(spec) }],
      spec
    );
    assert.equal(r.classification, CLASSIFICATION.OPTION_CONFLICT);
  });

  it('12. live partial filter must match exactly', () => {
    const spec = REQUIRED_INDEX_SPECS.find(
      (s) => s.id === 'lease_checkoutId_live_unique'
    );
    const wrong = classifyRequiredIndex(
      [
        {
          name: spec.name,
          key: requiredKeyObject(spec),
          unique: true,
          partialFilterExpression: { isLive: false }
        }
      ],
      spec
    );
    assert.equal(wrong.classification, CLASSIFICATION.OPTION_CONFLICT);

    const ok = classifyRequiredIndex([exactIndexDoc(spec)], spec);
    assert.equal(ok.classification, CLASSIFICATION.MATCH);
  });

  it('13. sparse required option must be present', () => {
    const spec = REQUIRED_INDEX_SPECS.find(
      (s) => s.id === 'facility_holdExpiresAt_sparse'
    );
    const missing = classifyRequiredIndex(
      [{ name: spec.name, key: requiredKeyObject(spec) }],
      spec
    );
    assert.equal(missing.classification, CLASSIFICATION.OPTION_CONFLICT);
    const ok = classifyRequiredIndex([exactIndexDoc(spec)], spec);
    assert.equal(ok.classification, CLASSIFICATION.MATCH);
  });

  it('14. hidden:true conflicts; false/missing pass', () => {
    const spec = REQUIRED_INDEX_SPECS.find((s) => s.id === 'lease_leaseId_unique');
    assert.equal(
      classifyRequiredIndex([exactIndexDoc(spec, { hidden: true })], spec)
        .classification,
      CLASSIFICATION.OPTION_CONFLICT
    );
    assert.equal(
      classifyRequiredIndex([exactIndexDoc(spec, { hidden: false })], spec)
        .classification,
      CLASSIFICATION.MATCH
    );
    assert.equal(
      classifyRequiredIndex([exactIndexDoc(spec)], spec).classification,
      CLASSIFICATION.MATCH
    );
  });

  it('15. collection absent marks every index on that collection', () => {
    const results = classifyAllIndexes({
      accommodationcheckoutleases: { indexes: allExactIndexes().accommodationcheckoutleases },
      checkoutresourceattempts: { absent: true },
      facilityreservations: { absent: true }
    });
    const attempt = results.filter(
      (r) => r.collectionName === 'checkoutresourceattempts'
    );
    assert.ok(attempt.length >= 5);
    assert.ok(
      attempt.every((r) => r.classification === CLASSIFICATION.COLLECTION_ABSENT)
    );
  });

  it('16. aggregate: all MATCH → exit 0', () => {
    const results = REQUIRED_INDEX_SPECS.map((spec) =>
      classifyRequiredIndex([exactIndexDoc(spec)], spec)
    );
    const agg = aggregatePreflight(results, []);
    assert.equal(agg.classification, CLASSIFICATION.MATCH);
    assert.equal(agg.ready, true);
    assert.equal(agg.exitCode, 0);
  });

  it('17. aggregate: ABSENT only → exit 2', () => {
    const results = REQUIRED_INDEX_SPECS.map((spec) =>
      classifyRequiredIndex([], spec)
    );
    const agg = aggregatePreflight(results, []);
    assert.equal(agg.classification, CLASSIFICATION.ABSENT);
    assert.equal(agg.ready, false);
    assert.equal(agg.exitCode, 2);
  });

  it('18. aggregate: COLLECTION_ABSENT only → exit 2', () => {
    const results = classifyAllIndexes({
      accommodationcheckoutleases: { absent: true },
      checkoutresourceattempts: { absent: true },
      facilityreservations: { absent: true }
    });
    const agg = aggregatePreflight(results, []);
    assert.equal(agg.classification, CLASSIFICATION.COLLECTION_ABSENT);
    assert.equal(agg.exitCode, 2);
  });

  it('19. aggregate: conflict → exit 78', () => {
    const spec = REQUIRED_INDEX_SPECS.find((s) => s.id === 'lease_leaseId_unique');
    const results = REQUIRED_INDEX_SPECS.map((s) => {
      if (s.id === spec.id) {
        return classifyRequiredIndex(
          [{ name: s.name, key: { wrong: 1 } }],
          s
        );
      }
      return classifyRequiredIndex([exactIndexDoc(s)], s);
    });
    const agg = aggregatePreflight(results, []);
    assert.equal(agg.exitCode, 78);
    assert.equal(agg.ready, false);
  });
});

describe('B8F6A runtime, duplicates, mutation guards, runbook', () => {
  it('20. collection absent runtime yields exit 2 when no conflicts', async () => {
    const { res, exitCode } = await runEnabled({
      resolveCollection: async (name) => {
        if (name === 'accommodationcheckoutleases') {
          return {
            ok: true,
            name,
            collection: {}
          };
        }
        return { ok: false, reason: 'collection_absent', name };
      },
      listIndexes: async (_c, name) => {
        if (name === 'accommodationcheckoutleases') {
          return allExactIndexes().accommodationcheckoutleases;
        }
        return [];
      },
      countDuplicateGroups: async () => 0
    });
    assert.equal(exitCode, 2);
    assert.equal(res.ready, false);
    assert.ok(
      res.indexResults.some(
        (r) => r.classification === CLASSIFICATION.COLLECTION_ABSENT
      )
    );
  });

  it('21. indexes() throws → exit 78', async () => {
    const { res, exitCode } = await runEnabled({
      listIndexes: async () => {
        throw Object.assign(new Error('enum fail'), { code: 'ENUM' });
      }
    });
    assert.equal(res.classification, CLASSIFICATION.INSPECTION_FAILED);
    assert.equal(exitCode, 78);
  });

  it('22. duplicate groups block unique create', async () => {
    const { res, exitCode } = await runEnabled({
      countDuplicateGroups: async (_c, _pipeline, spec) => {
        if (spec.id === 'lease_leaseId_unique') return 2;
        return 0;
      }
    });
    assert.equal(exitCode, 78);
    assert.equal(res.ready, false);
    const blocked = res.indexResults.find((r) => r.id === 'lease_leaseId_unique');
    assert.equal(blocked.classification, CLASSIFICATION.DUPLICATE_BLOCKER);
  });

  it('23. duplicate probe pipeline uses field names only', () => {
    const spec = REQUIRED_INDEX_SPECS.find(
      (s) => s.id === 'lease_checkoutId_live_unique'
    );
    const pipeline = buildDuplicateProbePipeline(spec);
    assert.ok(Array.isArray(pipeline));
    assert.deepEqual(pipeline[0], { $match: { isLive: true } });
    assert.equal(pipeline[1].$group._id.checkoutId, '$checkoutId');
    const blob = JSON.stringify(pipeline);
    assert.equal(blob.includes('leaseId'), false);
    assert.equal(blob.includes('secret'), false);
  });

  it('24. output contains no URI or document values', async () => {
    const logs = [];
    const { res } = await runEnabled({
      env: {
        [PREFLIGHT_EXECUTE_FLAG]: '1',
        MONGODB_URI: 'mongodb://user:secret@prod.example:27017/db'
      },
      log: (event, fields) => logs.push({ event, fields })
    });
    const blob = JSON.stringify({ res, logs });
    assert.equal(res.mongoUri, '[redacted]');
    assert.equal(blob.includes('secret'), false);
    assert.equal(blob.includes('prod.example'), false);
    assert.equal(blob.includes('mongodb://'), false);
  });

  it('25. exit-code matrix', async () => {
    assert.equal((await runEnabled()).exitCode, 0);

    assert.equal(
      (
        await runEnabled({
          listIndexes: async () => [{ name: '_id_', key: { _id: 1 } }]
        })
      ).exitCode,
      2
    );

    assert.equal(
      (
        await runEnabled({
          listIndexes: async (_c, name) => {
            const list = allExactIndexes()[name] || [];
            return list.map((ix) =>
              ix.name === 'leaseId_1' ? { ...ix, key: { wrong: 1 } } : ix
            );
          }
        })
      ).exitCode,
      78
    );

    let disabledExit = null;
    await runProductionIndexPreflight({
      env: {},
      exit: (c) => {
        disabledExit = c;
      },
      connect: async () => {
        throw new Error('no');
      }
    });
    assert.equal(disabledExit, 0);
  });

  it('26. no mutation method call expressions in preflight source', () => {
    const src = fs.readFileSync(
      path.join(__dirname, 'checkoutResourceLeaseProductionIndexPreflight.cjs'),
      'utf8'
    );
    assert.doesNotMatch(src, /\.createIndex\s*\(/);
    assert.doesNotMatch(src, /\.createIndexes\s*\(/);
    assert.doesNotMatch(src, /\.dropIndex\s*\(/);
    assert.doesNotMatch(src, /\.dropIndexes\s*\(/);
    assert.doesNotMatch(src, /\.syncIndexes\s*\(/);
    assert.doesNotMatch(src, /\.ensureIndexes\s*\(/);
    assert.doesNotMatch(src, /\.collMod\s*\(/);
    assert.doesNotMatch(src, /\.renameCollection\s*\(/);
    assert.doesNotMatch(src, /\.bulkWrite\s*\(/);
    assert.doesNotMatch(src, /\.findOneAndUpdate\s*\(/);
    assert.doesNotMatch(src, /\.insertOne\s*\(/);
    assert.doesNotMatch(src, /\.deleteMany\s*\(/);
  });

  it('27. runbook contains no command that enables worker or public gate', () => {
    const runbookPath = path.join(
      __dirname,
      '../../docs/runbooks/checkout-resource-lease-production-indexes.md'
    );
    const md = fs.readFileSync(runbookPath, 'utf8');
    assert.doesNotMatch(
      md,
      /(?:^|\n)\s*(?:export\s+)?ACCOMMODATION_CHECKOUT_HOLD_EXPIRY_EXECUTE=1\b/m
    );
    assert.doesNotMatch(
      md,
      /(?:^|\n)\s*(?:export\s+)?CHECKOUT_RESOURCE_LEASE_ENABLED=1\b/m
    );
    assert.doesNotMatch(md, /pm2\s+start[^\n]*accommodation-hold-expiry/);
    assert.doesNotMatch(md, /pm2\s+restart[^\n]*driftdwells/);
    assert.match(md, /does not authorize index creation/i);
    assert.match(md, /does not authorize.*gate enablement/i);
  });

  it('28. runbook documents every required index name and creation shape', () => {
    const runbookPath = path.join(
      __dirname,
      '../../docs/runbooks/checkout-resource-lease-production-indexes.md'
    );
    const md = fs.readFileSync(runbookPath, 'utf8');
    for (const spec of REQUIRED_INDEX_SPECS) {
      assert.match(md, new RegExp(spec.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(md, /accommodationcheckoutleases/);
    assert.match(md, /checkoutresourceattempts/);
    assert.match(md, /facilityreservations/);
    assert.match(md, /partialFilterExpression/);
    assert.match(md, /isLive:\s*true/);
    assert.match(md, /facilityReservation_facility_slot_lane_unique/);
    assert.match(md, /DOCUMENTATION ONLY/);
    assert.match(md, /duplicate/i);
  });

  it('29. optionsConflictAgainstSpec rejects TTL on cleanup v2', () => {
    const spec = REQUIRED_INDEX_SPECS.find(
      (s) => s.id === 'lease_released_cleanup_v2'
    );
    const conflicts = optionsConflictAgainstSpec(
      { ...exactIndexDoc(spec), expireAfterSeconds: 1 },
      spec
    );
    assert.ok(conflicts.some((c) => c.option === 'expireAfterSeconds'));
  });

  it('30. mixed present lease + absent attempt/facility is creation-eligible', async () => {
    const { res, exitCode } = await runEnabled({
      resolveCollection: async (name) => {
        if (name === 'accommodationcheckoutleases') {
          return { ok: true, name, collection: {} };
        }
        return { ok: false, reason: 'collection_absent', name };
      },
      listIndexes: async (_c, name) => {
        if (name === 'accommodationcheckoutleases') {
          // Lease present but missing critical uniques (only cleanup v2).
          const cleanup = REQUIRED_INDEX_SPECS.find(
            (s) => s.id === 'lease_released_cleanup_v2'
          );
          return [{ name: '_id_', key: { _id: 1 } }, exactIndexDoc(cleanup)];
        }
        return [];
      }
    });
    assert.equal(exitCode, 2);
    assert.ok(res.counts.absent >= 1 || res.counts.collectionAbsent >= 1);
    assert.ok(res.counts.criticalAbsent >= 1);
  });
});

describe('B8F6A Correction 1: standalone autoIndex / model-free inspection', () => {
  const {
    runStandaloneEntrypoint,
    disableMongooseAutoIndexAndAutoCreate,
    resolveNativeCollection,
    STANDALONE_CONNECT_OPTIONS
  } = preflight;

  const MODEL_PATH_RE =
    /models\/(AccommodationCheckoutLease|CheckoutResourceAttempt|FacilityReservation)(?:\.js)?$/;

  function buildFakeMongoose(trace) {
    const settings = { autoIndex: true, autoCreate: true };
    const nativeCalls = [];
    const db = {
      listCollections({ name }) {
        return {
          async toArray() {
            return [{ name }];
          }
        };
      },
      collection(name) {
        nativeCalls.push(String(name));
        trace.nativeCollections.push(String(name));
        return {
          async indexes() {
            return allExactIndexes()[name] || [{ name: '_id_', key: { _id: 1 } }];
          },
          aggregate() {
            return {
              async toArray() {
                return [];
              }
            };
          },
          // Mutation traps — must never be invoked by standalone preflight.
          createIndex() {
            trace.autoIndexActivations.push('collection.createIndex');
            throw new Error('createIndex_must_not_run');
          },
          createIndexes() {
            trace.autoIndexActivations.push('collection.createIndexes');
            throw new Error('createIndexes_must_not_run');
          },
          ensureIndexes() {
            trace.autoIndexActivations.push('collection.ensureIndexes');
            throw new Error('ensureIndexes_must_not_run');
          },
          createCollection() {
            trace.autoIndexActivations.push('collection.createCollection');
            throw new Error('createCollection_must_not_run');
          },
          dropIndex() {
            throw new Error('dropIndex_must_not_run');
          },
          syncIndexes() {
            trace.autoIndexActivations.push('collection.syncIndexes');
            throw new Error('syncIndexes_must_not_run');
          }
        };
      }
    };

    const mongoose = {
      settings,
      connection: { db },
      set(key, value) {
        trace.sets.push({ key, value, beforeConnect: trace.connectCalls.length === 0 });
        settings[key] = value;
        return mongoose;
      },
      get(key) {
        return settings[key];
      },
      async connect(uri, options) {
        trace.connectCalls.push({
          uri: uri == null ? null : '[redacted-test-uri]',
          options: options ? { ...options } : null,
          autoIndexSetting: settings.autoIndex,
          autoCreateSetting: settings.autoCreate
        });
        if (settings.autoIndex !== false || settings.autoCreate !== false) {
          trace.autoIndexActivations.push('connect_with_auto_enabled');
        }
        // Simulate mongoose openUri model.init loop — zero models registered.
        for (const model of Object.values(trace.registeredModels)) {
          trace.autoIndexActivations.push('Model.init');
          if (typeof model.init === 'function') await model.init();
        }
        return mongoose;
      },
      async disconnect() {
        trace.disconnectCalls += 1;
      },
      model() {
        throw new Error('mongoose.model_must_not_run');
      }
    };
    return { mongoose, nativeCalls };
  }

  it('C1.1 mongoose.set autoIndex false occurs before connect', async () => {
    const trace = {
      sets: [],
      connectCalls: [],
      disconnectCalls: 0,
      nativeCollections: [],
      autoIndexActivations: [],
      registeredModels: {}
    };
    const { mongoose } = buildFakeMongoose(trace);
    let exitCode = null;
    await runStandaloneEntrypoint({
      env: { [PREFLIGHT_EXECUTE_FLAG]: '1', MONGODB_URI: 'mongodb://test-uri' },
      mongoose,
      dbDefaults: { DEFAULT_MONGO_URI: 'mongodb://default' },
      exit: (c) => {
        exitCode = c;
      },
      log: () => {}
    });
    const autoIndexSets = trace.sets.filter((s) => s.key === 'autoIndex');
    assert.ok(autoIndexSets.length >= 1);
    assert.equal(autoIndexSets[0].value, false);
    assert.equal(autoIndexSets[0].beforeConnect, true);
    assert.equal(trace.connectCalls.length, 1);
    assert.equal(exitCode, 0);
  });

  it('C1.2 mongoose.set autoCreate false occurs before connect', async () => {
    const trace = {
      sets: [],
      connectCalls: [],
      disconnectCalls: 0,
      nativeCollections: [],
      autoIndexActivations: [],
      registeredModels: {}
    };
    const { mongoose } = buildFakeMongoose(trace);
    await runStandaloneEntrypoint({
      env: { [PREFLIGHT_EXECUTE_FLAG]: '1' },
      mongoose,
      dbDefaults: { DEFAULT_MONGO_URI: 'mongodb://default' },
      exit: () => {},
      log: () => {}
    });
    const autoCreateSets = trace.sets.filter((s) => s.key === 'autoCreate');
    assert.ok(autoCreateSets.length >= 1);
    assert.equal(autoCreateSets[0].value, false);
    assert.equal(autoCreateSets[0].beforeConnect, true);
  });

  it('C1.3 connect receives both options as exact false', async () => {
    const trace = {
      sets: [],
      connectCalls: [],
      disconnectCalls: 0,
      nativeCollections: [],
      autoIndexActivations: [],
      registeredModels: {}
    };
    const { mongoose } = buildFakeMongoose(trace);
    await runStandaloneEntrypoint({
      env: { [PREFLIGHT_EXECUTE_FLAG]: '1' },
      mongoose,
      dbDefaults: { DEFAULT_MONGO_URI: 'mongodb://default' },
      exit: () => {},
      log: () => {}
    });
    assert.equal(trace.connectCalls.length, 1);
    assert.deepEqual(trace.connectCalls[0].options, {
      autoIndex: false,
      autoCreate: false
    });
    assert.deepEqual(STANDALONE_CONNECT_OPTIONS, {
      autoIndex: false,
      autoCreate: false
    });
  });

  it('C1.4 standalone execution does not load the three model modules', async () => {
    const Module = require('module');
    const origRequire = Module.prototype.require;
    const loaded = [];
    Module.prototype.require = function patchedRequire(id) {
      const resolved = String(id);
      if (MODEL_PATH_RE.test(resolved) || MODEL_PATH_RE.test(resolved.replace(/\\/g, '/'))) {
        loaded.push(resolved);
        throw new Error(`MODEL_MUST_NOT_LOAD:${resolved}`);
      }
      // Also catch bare relative model paths used by this repo.
      if (
        resolved === '../models/AccommodationCheckoutLease' ||
        resolved === '../models/CheckoutResourceAttempt' ||
        resolved === '../models/FacilityReservation' ||
        resolved.endsWith('/models/AccommodationCheckoutLease') ||
        resolved.endsWith('/models/CheckoutResourceAttempt') ||
        resolved.endsWith('/models/FacilityReservation') ||
        resolved.endsWith('/models/AccommodationCheckoutLease.js') ||
        resolved.endsWith('/models/CheckoutResourceAttempt.js') ||
        resolved.endsWith('/models/FacilityReservation.js')
      ) {
        loaded.push(resolved);
        throw new Error(`MODEL_MUST_NOT_LOAD:${resolved}`);
      }
      return origRequire.apply(this, arguments);
    };

    const trace = {
      sets: [],
      connectCalls: [],
      disconnectCalls: 0,
      nativeCollections: [],
      autoIndexActivations: [],
      registeredModels: {}
    };
    const { mongoose } = buildFakeMongoose(trace);
    try {
      let exitCode = null;
      await runStandaloneEntrypoint({
        env: { [PREFLIGHT_EXECUTE_FLAG]: '1' },
        mongoose,
        dbDefaults: { DEFAULT_MONGO_URI: 'mongodb://default' },
        exit: (c) => {
          exitCode = c;
        },
        log: () => {}
      });
      assert.equal(exitCode, 0);
      assert.deepEqual(loaded, []);
    } finally {
      Module.prototype.require = origRequire;
    }
  });

  it('C1.5 inspection uses native db.collection(name)', async () => {
    const trace = {
      sets: [],
      connectCalls: [],
      disconnectCalls: 0,
      nativeCollections: [],
      autoIndexActivations: [],
      registeredModels: {}
    };
    const { mongoose } = buildFakeMongoose(trace);
    await runStandaloneEntrypoint({
      env: { [PREFLIGHT_EXECUTE_FLAG]: '1' },
      mongoose,
      dbDefaults: { DEFAULT_MONGO_URI: 'mongodb://default' },
      exit: () => {},
      log: () => {}
    });
    for (const coll of REQUIRED_COLLECTIONS) {
      assert.ok(
        trace.nativeCollections.includes(coll.collectionName),
        `missing native collection resolve for ${coll.collectionName}`
      );
    }
    const resolved = await resolveNativeCollection(mongoose, 'facilityreservations');
    assert.equal(resolved.ok, true);
    assert.equal(resolved.name, 'facilityreservations');
    assert.equal(typeof resolved.collection.indexes, 'function');
  });

  it('C1.6 no Model.init / ensureIndexes / createIndexes / createCollection / syncIndexes', async () => {
    const src = fs.readFileSync(
      path.join(__dirname, 'checkoutResourceLeaseProductionIndexPreflight.cjs'),
      'utf8'
    );
    // Strip comments so documentation of forbidden APIs is not treated as calls.
    const executable = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    assert.doesNotMatch(executable, /\.createIndex\s*\(/);
    assert.doesNotMatch(executable, /\.createIndexes\s*\(/);
    assert.doesNotMatch(executable, /\.ensureIndexes\s*\(/);
    assert.doesNotMatch(executable, /\.syncIndexes\s*\(/);
    assert.doesNotMatch(executable, /\.createCollection\s*\(/);
    assert.doesNotMatch(executable, /\.dropIndex\s*\(/);
    assert.doesNotMatch(executable, /\.collMod\s*\(/);
    assert.doesNotMatch(executable, /\.init\s*\(/);
    assert.doesNotMatch(executable, /Model\.init/);
    assert.doesNotMatch(
      executable,
      /require\(\s*['"][^'"]*models\/(AccommodationCheckoutLease|CheckoutResourceAttempt|FacilityReservation)/
    );

    const trace = {
      sets: [],
      connectCalls: [],
      disconnectCalls: 0,
      nativeCollections: [],
      autoIndexActivations: [],
      registeredModels: {}
    };
    const { mongoose } = buildFakeMongoose(trace);
    await runStandaloneEntrypoint({
      env: { [PREFLIGHT_EXECUTE_FLAG]: '1' },
      mongoose,
      dbDefaults: { DEFAULT_MONGO_URI: 'mongodb://default' },
      exit: () => {},
      log: () => {}
    });
    assert.deepEqual(trace.autoIndexActivations, []);
  });

  it('C1.7 fake mongoose records zero automatic-index activation', async () => {
    const trace = {
      sets: [],
      connectCalls: [],
      disconnectCalls: 0,
      nativeCollections: [],
      autoIndexActivations: [],
      registeredModels: {}
    };
    const { mongoose } = buildFakeMongoose(trace);
    await runStandaloneEntrypoint({
      env: { [PREFLIGHT_EXECUTE_FLAG]: '1' },
      mongoose,
      dbDefaults: { DEFAULT_MONGO_URI: 'mongodb://default' },
      exit: () => {},
      log: () => {}
    });
    assert.deepEqual(trace.autoIndexActivations, []);
    assert.equal(mongoose.get('autoIndex'), false);
    assert.equal(mongoose.get('autoCreate'), false);
    assert.equal(trace.disconnectCalls, 1);
  });

  it('C1.8 FacilityReservation schema may keep default autoIndex; preflight still cannot trigger it', () => {
    // Model parity import is test-only, after disabling auto index/create, no production URI.
    let mongoose;
    const portalNm = '/home/wasoe/drift-dwells-booking-portal/server/node_modules';
    const prevPaths = module.paths.slice();
    try {
      module.paths.unshift(path.join(__dirname, '../node_modules'));
      module.paths.unshift(portalNm);
      mongoose = require('mongoose');
    } catch (_e) {
      module.paths.splice(0, module.paths.length, ...prevPaths);
      module.paths.unshift(portalNm);
      mongoose = require('mongoose');
    } finally {
      // keep portal path for model require below; restore after
    }
    assert.equal(typeof mongoose.set, 'function');
    mongoose.set('autoIndex', false);
    mongoose.set('autoCreate', false);

    const FacilityReservation = require('../models/FacilityReservation');
    // Schema does not set autoIndex:false — default remains eligible in general app use.
    const schemaAuto = FacilityReservation.schema.get('autoIndex');
    assert.ok(schemaAuto === undefined || schemaAuto === null || schemaAuto === true);

    // Production preflight must not require the model module (static modelName strings OK).
    const src = fs.readFileSync(
      path.join(__dirname, 'checkoutResourceLeaseProductionIndexPreflight.cjs'),
      'utf8'
    );
    assert.doesNotMatch(
      src,
      /require\(\s*['"][^'"]*FacilityReservation/
    );
    assert.doesNotMatch(
      src,
      /require\(\s*['"][^'"]*AccommodationCheckoutLease/
    );
    assert.doesNotMatch(
      src,
      /require\(\s*['"][^'"]*CheckoutResourceAttempt/
    );
    module.paths.splice(0, module.paths.length, ...prevPaths);
  });

  it('C1.9 disabled and import-only paths remain connection-free', async () => {
    let connects = 0;
    const fake = {
      set() {
        throw new Error('set_must_not_run_when_disabled');
      },
      async connect() {
        connects += 1;
        throw new Error('connect_must_not_run');
      }
    };
    let exitCode = null;
    const res = await runStandaloneEntrypoint({
      env: {},
      mongoose: fake,
      exit: (c) => {
        exitCode = c;
      },
      log: () => {}
    });
    assert.equal(res.classification, CLASSIFICATION.DISABLED);
    assert.equal(res.connected, false);
    assert.equal(connects, 0);
    assert.equal(exitCode, 0);

    // Import-only: requiring the module already happened at file top without connect.
    assert.equal(typeof disableMongooseAutoIndexAndAutoCreate, 'function');
  });

  it('C1.10 helper disableMongooseAutoIndexAndAutoCreate sets both flags', () => {
    const calls = [];
    const mongoose = {
      set(k, v) {
        calls.push([k, v]);
      }
    };
    const out = disableMongooseAutoIndexAndAutoCreate(mongoose);
    assert.deepEqual(calls, [
      ['autoIndex', false],
      ['autoCreate', false]
    ]);
    assert.deepEqual(out, { autoIndex: false, autoCreate: false });
  });
});

describe('B8F6A Correction 2: FacilityReservation path-index parity', () => {
  function stable(value) {
    if (value === undefined) return undefined;
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(stable);
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = stable(value[k]);
    return out;
  }

  function normalizeOptions(opts = {}) {
    const o = {};
    if (opts.unique === true) o.unique = true;
    if (opts.sparse === true) o.sparse = true;
    if (opts.partialFilterExpression) {
      o.partialFilterExpression = stable(opts.partialFilterExpression);
    }
    if (opts.expireAfterSeconds != null) o.expireAfterSeconds = opts.expireAfterSeconds;
    if (opts.collation) o.collation = stable(opts.collation);
    if (opts.hidden === true) o.hidden = true;
    // Ignore obsolete mongoose background:true noise from schema.indexes().
    return o;
  }

  function defaultIndexName(key) {
    return Object.entries(key)
      .map(([k, d]) => `${k}_${d}`)
      .join('_');
  }

  function loadModelsWithAutoDisabled() {
    const portalNm = '/home/wasoe/drift-dwells-booking-portal/server/node_modules';
    const prev = module.paths.slice();
    module.paths.unshift(path.join(__dirname, '../node_modules'));
    module.paths.unshift(portalNm);
    let mongoose;
    try {
      mongoose = require('mongoose');
    } finally {
      /* keep paths for model requires */
    }
    mongoose.set('autoIndex', false);
    mongoose.set('autoCreate', false);
    for (const n of [
      'AccommodationCheckoutLease',
      'CheckoutResourceAttempt',
      'FacilityReservation'
    ]) {
      try {
        delete mongoose.models[n];
        delete mongoose.modelSchemas[n];
      } catch (_e) {
        /* ignore */
      }
    }
    const Lease = require('../models/AccommodationCheckoutLease');
    const Attempt = require('../models/CheckoutResourceAttempt');
    const Facility = require('../models/FacilityReservation');
    module.paths.splice(0, module.paths.length, ...prev);
    return { mongoose, Lease, Attempt, Facility };
  }

  function collectModelIndexes(Model) {
    const coll = Model.collection.collectionName;
    return Model.schema.indexes().map(([key, options]) => {
      const name = (options && options.name) || defaultIndexName(key);
      return {
        collection: coll,
        name,
        keyOrder: Object.entries(key).map(([k, d]) => [k, Number(d)]),
        options: normalizeOptions(options || {})
      };
    });
  }

  function preflightNorm(spec) {
    return {
      collection: spec.collectionName,
      name: spec.name,
      keyOrder: spec.keyOrder.map(([k, d]) => [k, d]),
      options: normalizeOptions(spec.options || {})
    };
  }

  function sig(x) {
    return JSON.stringify({
      collection: x.collection,
      name: x.name,
      keyOrder: x.keyOrder,
      options: x.options
    });
  }

  it('C2.1 inventory contains exactly 22 specifications', () => {
    assert.equal(REQUIRED_INDEX_SPECS.length, 22);
  });

  it('C2.2 model-to-preflight mismatch count is zero', () => {
    const { Lease, Attempt, Facility } = loadModelsWithAutoDisabled();
    const modelIndexes = [
      ...collectModelIndexes(Lease),
      ...collectModelIndexes(Attempt),
      ...collectModelIndexes(Facility)
    ];
    const pf = REQUIRED_INDEX_SPECS.map(preflightNorm);
    assert.equal(modelIndexes.length, 22);
    assert.equal(pf.length, 22);
    const modelSigs = new Set(modelIndexes.map(sig));
    const pfSigs = new Set(pf.map(sig));
    const missing = modelIndexes.filter((m) => !pfSigs.has(sig(m)));
    const extra = pf.filter((p) => !modelSigs.has(sig(p)));
    assert.deepEqual(missing, []);
    assert.deepEqual(extra, []);
    assert.equal(missing.length + extra.length, 0);
  });

  it('C2.3-5 path-level single-field indexes match the model exactly', () => {
    const { Facility } = loadModelsWithAutoDisabled();
    const modelByName = new Map(
      collectModelIndexes(Facility).map((m) => [m.name, m])
    );
    for (const name of ['facilityCode_1', 'status_1', 'checkoutSessionId_1']) {
      const spec = REQUIRED_INDEX_SPECS.find((s) => s.name === name);
      assert.ok(spec, name);
      const model = modelByName.get(name);
      assert.ok(model, `model has ${name}`);
      assert.deepEqual(preflightNorm(spec), model);
      assert.equal(spec.options.unique, undefined);
      assert.equal(Object.keys(normalizeOptions(spec.options)).length, 0);
      assert.equal(spec.duplicateGroupFields, undefined);
    }
  });

  it('C2.6 each missing single-field index produces ABSENT and exit 2', async () => {
    for (const omitName of ['facilityCode_1', 'status_1', 'checkoutSessionId_1']) {
      const { exitCode, res } = await runEnabled({
        listIndexes: async (_c, collectionName) => {
          const list = allExactIndexes()[collectionName] || [];
          return list.filter((ix) => ix.name !== omitName);
        }
      });
      assert.equal(exitCode, 2, omitName);
      assert.equal(res.ready, false, omitName);
      const row = res.indexResults.find((r) => r.requiredIndexName === omitName);
      assert.equal(row.classification, CLASSIFICATION.ABSENT, omitName);
    }
  });

  it('C2.7 same-name wrong-key conflict produces exit 78', async () => {
    const { exitCode, res } = await runEnabled({
      listIndexes: async (_c, collectionName) => {
        const list = allExactIndexes()[collectionName] || [];
        return list.map((ix) =>
          ix.name === 'facilityCode_1' ? { ...ix, key: { wrong: 1 } } : ix
        );
      }
    });
    assert.equal(exitCode, 78);
    assert.equal(
      res.indexResults.find((r) => r.requiredIndexName === 'facilityCode_1')
        .classification,
      CLASSIFICATION.NAME_CONFLICT
    );
  });

  it('C2.8 correct keys under wrong names produce KEY_CONFLICT', () => {
    const spec = REQUIRED_INDEX_SPECS.find((s) => s.name === 'status_1');
    const r = classifyRequiredIndex(
      [{ name: 'status_alias', key: { status: 1 } }],
      spec
    );
    assert.equal(r.classification, CLASSIFICATION.KEY_CONFLICT);
  });

  it('C2.9 unexpected unique/sparse/partial/TTL/collation/hidden fail closed', () => {
    const spec = REQUIRED_INDEX_SPECS.find((s) => s.name === 'checkoutSessionId_1');
    for (const extra of [
      { unique: true },
      { sparse: true },
      { partialFilterExpression: { x: 1 } },
      { expireAfterSeconds: 1 },
      { collation: { locale: 'en' } },
      { hidden: true }
    ]) {
      const r = classifyRequiredIndex([exactIndexDoc(spec, extra)], spec);
      assert.equal(
        r.classification,
        CLASSIFICATION.OPTION_CONFLICT,
        JSON.stringify(extra)
      );
    }
  });

  it('C2.10 all 22 exact indexes produce ready/MATCH and exit 0', async () => {
    assert.equal(REQUIRED_INDEX_SPECS.length, 22);
    const { res, exitCode } = await runEnabled();
    assert.equal(exitCode, 0);
    assert.equal(res.ready, true);
    assert.equal(res.classification, CLASSIFICATION.MATCH);
    assert.equal(res.indexResults.length, 22);
    assert.ok(
      res.indexResults.every((r) => r.classification === CLASSIFICATION.MATCH)
    );
  });

  it('C2.11 duplicate probe count remains exactly seven', () => {
    const probed = REQUIRED_INDEX_SPECS.filter(
      (s) => Array.isArray(s.duplicateGroupFields) && s.duplicateGroupFields.length
    );
    assert.equal(probed.length, 7);
    const uniques = REQUIRED_INDEX_SPECS.filter(
      (s) => s.options && s.options.unique === true
    );
    assert.equal(uniques.length, 7);
    assert.ok(uniques.every((s) => probed.some((p) => p.id === s.id)));
    for (const name of ['facilityCode_1', 'status_1', 'checkoutSessionId_1']) {
      const spec = REQUIRED_INDEX_SPECS.find((s) => s.name === name);
      assert.equal(spec.duplicateGroupFields, undefined);
    }
  });

  it('C2.12-14 runbook inventory, document counts, and documentation-only creates', () => {
    const md = fs.readFileSync(
      path.join(
        __dirname,
        '../../docs/runbooks/checkout-resource-lease-production-indexes.md'
      ),
      'utf8'
    );
    for (const spec of REQUIRED_INDEX_SPECS) {
      assert.match(md, new RegExp(spec.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(md, /22/);
    assert.match(md, /countDocuments/);
    assert.match(md, /accommodationcheckoutleases/);
    assert.match(md, /checkoutresourceattempts/);
    assert.match(md, /facilityreservations/);
    assert.match(md, /require every count unchanged|count unchanged/i);
    assert.match(md, /Before index creation|before.*index creation/i);
    assert.match(md, /After index creation|After authorized/i);
    assert.match(md, /DOCUMENTATION ONLY/);
    assert.match(md, /does not authorize index creation/i);
    assert.match(md, /path-level lookup|non-unique/i);
    // No enablement assignments
    assert.doesNotMatch(
      md,
      /(?:^|\n)\s*(?:export\s+)?CHECKOUT_RESOURCE_LEASE_ENABLED=1\b/m
    );
  });

  it('C2.15 Correction 1 standalone mutation traps remain green', async () => {
    const {
      runStandaloneEntrypoint,
      disableMongooseAutoIndexAndAutoCreate
    } = preflight;
    const sets = [];
    const connectCalls = [];
    let disconnectCalls = 0;
    const native = [];
    const mongoose = {
      set(k, v) {
        sets.push({ k, v, beforeConnect: connectCalls.length === 0 });
      },
      async connect(_uri, options) {
        connectCalls.push(options);
      },
      async disconnect() {
        disconnectCalls += 1;
      },
      connection: {
        db: {
          listCollections({ name }) {
            return { toArray: async () => [{ name }] };
          },
          collection(name) {
            native.push(name);
            return {
              indexes: async () => allExactIndexes()[name] || [],
              aggregate: () => ({ toArray: async () => [] }),
              createIndex() {
                throw new Error('createIndex');
              },
              createIndexes() {
                throw new Error('createIndexes');
              },
              ensureIndexes() {
                throw new Error('ensureIndexes');
              },
              syncIndexes() {
                throw new Error('syncIndexes');
              },
              createCollection() {
                throw new Error('createCollection');
              }
            };
          }
        }
      }
    };
    let exitCode = null;
    await runStandaloneEntrypoint({
      env: { [PREFLIGHT_EXECUTE_FLAG]: '1' },
      mongoose,
      dbDefaults: { DEFAULT_MONGO_URI: 'mongodb://default' },
      exit: (c) => {
        exitCode = c;
      },
      log: () => {}
    });
    assert.deepEqual(
      sets.map((s) => [s.k, s.v, s.beforeConnect]),
      [
        ['autoIndex', false, true],
        ['autoCreate', false, true]
      ]
    );
    assert.deepEqual(connectCalls, [{ autoIndex: false, autoCreate: false }]);
    assert.equal(disconnectCalls, 1);
    assert.equal(exitCode, 0);
    assert.ok(native.includes('facilityreservations'));
    assert.ok(native.includes('accommodationcheckoutleases'));
    assert.ok(native.includes('checkoutresourceattempts'));
    assert.equal(typeof disableMongooseAutoIndexAndAutoCreate, 'function');
  });
});
