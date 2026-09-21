/**
 * B8F5C — AccommodationCheckoutLease released-cleanup index preflight tests.
 *
 * Run: node server/scripts/accommodationCheckoutLeaseIndexPreflight.test.cjs
 *   or: cd server && node --test --test-concurrency=1 scripts/accommodationCheckoutLeaseIndexPreflight.test.cjs
 */
'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const preflight = require('./accommodationCheckoutLeaseIndexPreflight.cjs');
const {
  PREFLIGHT_EXECUTE_FLAG,
  PREFLIGHT_ACCEPTED_TRUE,
  REQUIRED_INDEX_NAME,
  LEGACY_V1_INDEX_NAME,
  EXPECTED_COLLECTION_NAME,
  REQUIRED_INDEX_KEY_ORDER,
  REQUIRED_INDEX_KEY,
  EXPLAIN_LIMIT,
  CLASSIFICATION,
  EXIT,
  isPreflightExecuteEnabled,
  indexKeyMatchesRequired,
  classifyIndexes,
  buildEligibleFilter,
  buildExplainSort,
  runIndexPreflight
} = preflight;

const ORIG_FLAG = process.env[PREFLIGHT_EXECUTE_FLAG];
const ORIG_LEASE = process.env.CHECKOUT_RESOURCE_LEASE_ENABLED;
const ORIG_EXECUTE = process.env.ACCOMMODATION_CHECKOUT_HOLD_EXPIRY_EXECUTE;

function restoreEnv() {
  if (ORIG_FLAG === undefined) delete process.env[PREFLIGHT_EXECUTE_FLAG];
  else process.env[PREFLIGHT_EXECUTE_FLAG] = ORIG_FLAG;
  if (ORIG_LEASE === undefined) delete process.env.CHECKOUT_RESOURCE_LEASE_ENABLED;
  else process.env.CHECKOUT_RESOURCE_LEASE_ENABLED = ORIG_LEASE;
  if (ORIG_EXECUTE === undefined) delete process.env.ACCOMMODATION_CHECKOUT_HOLD_EXPIRY_EXECUTE;
  else process.env.ACCOMMODATION_CHECKOUT_HOLD_EXPIRY_EXECUTE = ORIG_EXECUTE;
}

afterEach(() => {
  restoreEnv();
});

function exactV2() {
  return {
    name: REQUIRED_INDEX_NAME,
    key: Object.fromEntries(REQUIRED_INDEX_KEY_ORDER)
  };
}

function v1Index() {
  return {
    name: LEGACY_V1_INDEX_NAME,
    key: {
      status: 1,
      checkoutClaimCleanupStatus: 1,
      checkoutClaimCleanupNextAttemptAt: 1
    }
  };
}

function okExplainStats(overrides = {}) {
  return {
    usesRequiredIndex: true,
    winningIndexName: REQUIRED_INDEX_NAME,
    ixscanIndexNames: [REQUIRED_INDEX_NAME],
    winningStages: ['IXSCAN'],
    nReturned: 0,
    keysExamined: 0,
    docsExamined: 0,
    inMemorySort: false,
    executionTimeMillis: 1,
    ...overrides
  };
}

function okExplain(overrides = {}) {
  const stats = okExplainStats(overrides.stats);
  return {
    hint: REQUIRED_INDEX_NAME,
    assessment: { ok: true, reason: null, stats },
    stats,
    filterShape: { hint: REQUIRED_INDEX_NAME },
    ...overrides
  };
}

async function runWithExactIndex(explainFn) {
  let exitCode = null;
  const res = await runIndexPreflight({
    env: { [PREFLIGHT_EXECUTE_FLAG]: '1' },
    exit: (c) => {
      exitCode = c;
    },
    connect: async () => {},
    disconnect: async () => {},
    resolveCollection: async () => ({
      ok: true,
      name: EXPECTED_COLLECTION_NAME,
      collection: {}
    }),
    listIndexes: async () => [exactV2()],
    explain: explainFn
  });
  return { res, exitCode };
}

describe('B8F5C preflight import and flag gate', () => {
  it('1. importing the module has no side effects', () => {
    assert.equal(typeof runIndexPreflight, 'function');
    assert.equal(isPreflightExecuteEnabled({}), false);
    assert.equal(process.env[PREFLIGHT_EXECUTE_FLAG], ORIG_FLAG);
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
      const res = await runIndexPreflight({
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
      assert.equal(isPreflightExecuteEnabled(env), false);
    }
  });

  it('3. exact "1" permits read-only inspection', async () => {
    let connects = 0;
    let lists = 0;
    let exitCode = null;
    const res = await runIndexPreflight({
      env: { [PREFLIGHT_EXECUTE_FLAG]: PREFLIGHT_ACCEPTED_TRUE },
      exit: (c) => {
        exitCode = c;
      },
      connect: async () => {
        connects += 1;
      },
      disconnect: async () => {},
      resolveCollection: async () => ({
        ok: true,
        name: EXPECTED_COLLECTION_NAME,
        collection: {}
      }),
      listIndexes: async () => {
        lists += 1;
        return [exactV2()];
      },
      explain: async () => okExplain()
    });
    assert.equal(connects, 1);
    assert.equal(lists, 1);
    assert.equal(res.classification, CLASSIFICATION.MATCH);
    assert.equal(exitCode, EXIT.DISABLED_OR_MATCH);
  });
});

describe('B8F5C classification matrix', () => {
  it('4. exact matching index', () => {
    const r = classifyIndexes([exactV2()], {
      collectionName: EXPECTED_COLLECTION_NAME
    });
    assert.equal(r.classification, CLASSIFICATION.MATCH);
    assert.equal(r.ready, true);
  });

  it('5. index absent', () => {
    const r = classifyIndexes([{ name: '_id_', key: { _id: 1 } }], {
      collectionName: EXPECTED_COLLECTION_NAME
    });
    assert.equal(r.classification, CLASSIFICATION.ABSENT);
    assert.equal(r.ready, false);
  });

  it('6. exact name with wrong key', () => {
    const r = classifyIndexes([
      {
        name: REQUIRED_INDEX_NAME,
        key: { status: 1, leaseId: 1 }
      }
    ]);
    assert.equal(r.classification, CLASSIFICATION.NAME_CONFLICT);
  });

  it('7. wrong key order', () => {
    const r = classifyIndexes([
      {
        name: REQUIRED_INDEX_NAME,
        key: {
          leaseId: 1,
          status: 1,
          isLive: 1,
          checkoutClaimCleanupStatus: 1,
          checkoutClaimCleanupNextAttemptAt: 1
        }
      }
    ]);
    assert.equal(r.classification, CLASSIFICATION.NAME_CONFLICT);
    assert.equal(indexKeyMatchesRequired(r.conflictingIndex.key), false);
  });

  it('8. wrong direction', () => {
    const r = classifyIndexes([
      {
        name: REQUIRED_INDEX_NAME,
        key: {
          status: -1,
          isLive: 1,
          checkoutClaimCleanupStatus: 1,
          checkoutClaimCleanupNextAttemptAt: 1,
          leaseId: 1
        }
      }
    ]);
    assert.equal(r.classification, CLASSIFICATION.NAME_CONFLICT);
  });

  it('9. extra key', () => {
    const r = classifyIndexes([
      {
        name: REQUIRED_INDEX_NAME,
        key: { ...REQUIRED_INDEX_KEY, extra: 1 }
      }
    ]);
    assert.equal(r.classification, CLASSIFICATION.NAME_CONFLICT);
  });

  it('10. same keys under another name', () => {
    const r = classifyIndexes([
      {
        name: 'some_other_cleanup_idx',
        key: Object.fromEntries(REQUIRED_INDEX_KEY_ORDER)
      }
    ]);
    assert.equal(r.classification, CLASSIFICATION.KEY_CONFLICT);
    assert.equal(r.reason, 'exact_keys_under_another_name');
  });

  it('11. option conflict', () => {
    const r = classifyIndexes([
      {
        ...exactV2(),
        unique: true
      }
    ]);
    assert.equal(r.classification, CLASSIFICATION.OPTION_CONFLICT);
  });

  it('12. collection absent', async () => {
    let exitCode = null;
    const res = await runIndexPreflight({
      env: { [PREFLIGHT_EXECUTE_FLAG]: '1' },
      exit: (c) => {
        exitCode = c;
      },
      connect: async () => {},
      disconnect: async () => {},
      resolveCollection: async () => ({
        ok: false,
        reason: 'collection_absent',
        name: EXPECTED_COLLECTION_NAME
      })
    });
    assert.equal(res.classification, CLASSIFICATION.COLLECTION_ABSENT);
    assert.equal(exitCode, EXIT.CONFLICT_OR_FAILURE);
  });

  it('13. indexes() throws', async () => {
    let exitCode = null;
    const res = await runIndexPreflight({
      env: { [PREFLIGHT_EXECUTE_FLAG]: '1' },
      exit: (c) => {
        exitCode = c;
      },
      connect: async () => {},
      disconnect: async () => {},
      resolveCollection: async () => ({
        ok: true,
        name: EXPECTED_COLLECTION_NAME,
        collection: {}
      }),
      listIndexes: async () => {
        throw Object.assign(new Error('enum fail'), { code: 'ENUM' });
      }
    });
    assert.equal(res.classification, CLASSIFICATION.INSPECTION_FAILED);
    assert.equal(exitCode, EXIT.CONFLICT_OR_FAILURE);
  });

  it('14. unrelated indexes ignored', () => {
    const r = classifyIndexes(
      [
        { name: '_id_', key: { _id: 1 } },
        { name: 'leaseId_1', key: { leaseId: 1 }, unique: true },
        exactV2()
      ],
      { collectionName: EXPECTED_COLLECTION_NAME }
    );
    assert.equal(r.classification, CLASSIFICATION.MATCH);
    assert.ok(r.unrelatedIndexNames.includes('leaseId_1'));
  });

  it('15. v1 alone does not satisfy v2', () => {
    const r = classifyIndexes([v1Index()]);
    assert.equal(r.classification, CLASSIFICATION.ABSENT);
    assert.equal(r.ready, false);
    assert.equal(r.legacyV1Indexes.length, 1);
    assert.equal(r.legacyV1Only, true);
  });

  it('16. v1 plus exact v2 passes', () => {
    const r = classifyIndexes([v1Index(), exactV2()]);
    assert.equal(r.classification, CLASSIFICATION.MATCH);
    assert.equal(r.ready, true);
    assert.equal(r.legacyV1Indexes.length, 1);
  });
});

describe('B8F5C mutation guards, explain, exits, runbook', () => {
  it('17. no mutation method can be called / present as invocations', () => {
    const src = fs.readFileSync(
      path.join(__dirname, 'accommodationCheckoutLeaseIndexPreflight.cjs'),
      'utf8'
    );
    // Source-guard: no call expressions for prohibited APIs (comments may mention names).
    assert.doesNotMatch(src, /\.createIndex\s*\(/);
    assert.doesNotMatch(src, /\.createIndexes\s*\(/);
    assert.doesNotMatch(src, /\.dropIndex\s*\(/);
    assert.doesNotMatch(src, /\.dropIndexes\s*\(/);
    assert.doesNotMatch(src, /\.syncIndexes\s*\(/);
    assert.doesNotMatch(src, /\.ensureIndexes\s*\(/);
    assert.doesNotMatch(src, /\.collMod\s*\(/);
    assert.doesNotMatch(src, /\.renameCollection\s*\(/);
  });

  it('18. explain uses the production selector, sort, and limit', () => {
    const now = new Date('2026-09-17T12:00:00.000Z');
    const filter = buildEligibleFilter(now);
    assert.equal(filter.status, 'released');
    assert.equal(filter.isLive, false);
    assert.ok(Array.isArray(filter.$or));
    assert.ok(Array.isArray(filter.$and));
    const sort = buildExplainSort();
    assert.deepEqual(sort, {
      checkoutClaimCleanupNextAttemptAt: 1,
      leaseId: 1
    });
    assert.equal(EXPLAIN_LIMIT, 100);
  });

  it('19. output contains no URI or document values', async () => {
    const logs = [];
    const res = await runIndexPreflight({
      env: {
        [PREFLIGHT_EXECUTE_FLAG]: '1',
        MONGODB_URI: 'mongodb://user:secret@prod.example:27017/db'
      },
      exit: () => {},
      log: (event, fields) => logs.push({ event, fields }),
      connect: async () => {},
      disconnect: async () => {},
      resolveCollection: async () => ({
        ok: true,
        name: EXPECTED_COLLECTION_NAME,
        collection: {}
      }),
      listIndexes: async () => [exactV2()],
      explain: async () => okExplain()
    });
    const blob = JSON.stringify({ res, logs });
    assert.equal(res.mongoUri, '[redacted]');
    assert.equal(blob.includes('secret'), false);
    assert.equal(blob.includes('prod.example'), false);
    assert.equal(blob.includes('mongodb://'), false);
  });

  it('20. exit-code matrix', async () => {
    async function codeFor(classificationSetup) {
      let exitCode = null;
      await runIndexPreflight({
        env: { [PREFLIGHT_EXECUTE_FLAG]: '1' },
        exit: (c) => {
          exitCode = c;
        },
        connect: async () => {},
        disconnect: async () => {},
        ...classificationSetup
      });
      return exitCode;
    }

    assert.equal(
      await codeFor({
        resolveCollection: async () => ({
          ok: true,
          name: EXPECTED_COLLECTION_NAME,
          collection: {}
        }),
        listIndexes: async () => [exactV2()],
        explain: async () => okExplain()
      }),
      0
    );

    assert.equal(
      await codeFor({
        resolveCollection: async () => ({
          ok: true,
          name: EXPECTED_COLLECTION_NAME,
          collection: {}
        }),
        listIndexes: async () => []
      }),
      2
    );

    assert.equal(
      await codeFor({
        resolveCollection: async () => ({
          ok: true,
          name: EXPECTED_COLLECTION_NAME,
          collection: {}
        }),
        listIndexes: async () => [
          { name: REQUIRED_INDEX_NAME, key: { status: 1 }, unique: true }
        ]
      }),
      78
    );

    let disabledExit = null;
    await runIndexPreflight({
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

  it('21. runbook contains no command that enables worker or public gate', () => {
    const runbookPath = path.join(
      __dirname,
      '../../docs/runbooks/accommodation-checkout-lease-cleanup-index.md'
    );
    const md = fs.readFileSync(runbookPath, 'utf8');
    // No executable enablement: export/env assignment to accepted true, or pm2 start of the worker.
    assert.doesNotMatch(
      md,
      /(?:^|\n)\s*(?:export\s+)?ACCOMMODATION_CHECKOUT_HOLD_EXPIRY_EXECUTE=1\b/m
    );
    assert.doesNotMatch(
      md,
      /(?:^|\n)\s*(?:export\s+)?CHECKOUT_RESOURCE_LEASE_ENABLED=1\b/m
    );
    assert.doesNotMatch(md, /pm2\s+start[^\n]*accommodation-hold-expiry/);
    assert.match(md, /does not authorize index creation/i);
    assert.match(md, /does not authorize worker enablement/i);
  });

  it('22. runbook creation command matches the model and worker exactly', () => {
    const runbookPath = path.join(
      __dirname,
      '../../docs/runbooks/accommodation-checkout-lease-cleanup-index.md'
    );
    const md = fs.readFileSync(runbookPath, 'utf8');
    assert.match(md, /accommodationCheckoutLease_released_cleanup_v2/);
    assert.match(md, /status:\s*1/);
    assert.match(md, /isLive:\s*1/);
    assert.match(md, /checkoutClaimCleanupStatus:\s*1/);
    assert.match(md, /checkoutClaimCleanupNextAttemptAt:\s*1/);
    assert.match(md, /leaseId:\s*1/);
    assert.match(md, /accommodationcheckoutleases/);
    // Must not invent unique/sparse/TTL/partial on the creation command block.
    const createBlock = md.slice(
      md.indexOf('### 3.'),
      md.indexOf('### 4.')
    );
    assert.doesNotMatch(createBlock, /unique:\s*true/);
    assert.doesNotMatch(createBlock, /sparse:\s*true/);
    assert.doesNotMatch(createBlock, /expireAfterSeconds/);
    assert.doesNotMatch(createBlock, /partialFilterExpression/);
  });
});

describe('B8F5C Correction 1: hidden, hinted explain, redaction', () => {
  const {
    assessHintedExplain,
    runReleasedCleanupExplain,
    safeErrorCode,
    REQUIRED_INDEX_NAME: V2
  } = preflight;

  it('1. hidden: true produces OPTION_CONFLICT', () => {
    const r = classifyIndexes([{ ...exactV2(), hidden: true }]);
    assert.equal(r.classification, CLASSIFICATION.OPTION_CONFLICT);
  });

  it('2. hidden: false passes definitionally', () => {
    const r = classifyIndexes([{ ...exactV2(), hidden: false }]);
    assert.equal(r.classification, CLASSIFICATION.MATCH);
  });

  it('3. missing hidden option passes', () => {
    assert.equal(classifyIndexes([exactV2()]).classification, CLASSIFICATION.MATCH);
  });

  it('4. malformed hidden option fails closed', () => {
    assert.equal(
      classifyIndexes([{ ...exactV2(), hidden: 'yes' }]).classification,
      CLASSIFICATION.OPTION_CONFLICT
    );
    assert.equal(
      classifyIndexes([{ ...exactV2(), hidden: 2 }]).classification,
      CLASSIFICATION.OPTION_CONFLICT
    );
  });

  it('5-6. hinted explain uses exact v2 and hint is applied by exact name', async () => {
    const hints = [];
    const collection = {
      find() {
        const chain = {
          sort() {
            return chain;
          },
          limit() {
            return chain;
          },
          hint(name) {
            hints.push(name);
            return chain;
          },
          async explain() {
            return {
              queryPlanner: {
                winningPlan: {
                  stage: 'FETCH',
                  inputStage: { stage: 'IXSCAN', indexName: V2 }
                }
              },
              executionStats: {
                nReturned: 0,
                totalKeysExamined: 0,
                totalDocsExamined: 0,
                executionTimeMillis: 1,
                executionStages: {
                  stage: 'FETCH',
                  inputStage: { stage: 'IXSCAN', indexName: V2 }
                }
              }
            };
          }
        };
        return chain;
      }
    };
    const explained = await runReleasedCleanupExplain(collection, new Date());
    assert.deepEqual(hints, [V2]);
    assert.equal(explained.hint, V2);
    assert.equal(explained.assessment.ok, true);

    const { res, exitCode } = await runWithExactIndex(async () => explained);
    assert.equal(res.classification, CLASSIFICATION.MATCH);
    assert.equal(res.ready, true);
    assert.equal(exitCode, 0);
    assert.equal(res.explainUsesRequiredIndex, true);
  });

  it('7. explain uses leaseId_1 and fails', async () => {
    const { res, exitCode } = await runWithExactIndex(async () => ({
      hint: V2,
      assessment: {
        ok: false,
        reason: 'EXPLAIN_FOREIGN_IXSCAN',
        stats: okExplainStats({
          usesRequiredIndex: false,
          winningIndexName: 'leaseId_1',
          ixscanIndexNames: ['leaseId_1']
        })
      },
      stats: okExplainStats({
        usesRequiredIndex: false,
        winningIndexName: 'leaseId_1',
        ixscanIndexNames: ['leaseId_1']
      })
    }));
    assert.equal(res.classification, CLASSIFICATION.INSPECTION_FAILED);
    assert.equal(res.definitionClassification, CLASSIFICATION.MATCH);
    assert.equal(res.ready, false);
    assert.equal(exitCode, 78);
  });

  it('8. explain contains v2 plus another IXSCAN and fails', () => {
    const a = assessHintedExplain({
      queryPlanner: {
        winningPlan: {
          stage: 'FETCH',
          inputStages: [
            { stage: 'IXSCAN', indexName: V2 },
            { stage: 'IXSCAN', indexName: 'leaseId_1' }
          ]
        }
      },
      executionStats: {
        nReturned: 0,
        totalKeysExamined: 0,
        totalDocsExamined: 0,
        executionTimeMillis: 1
      }
    });
    assert.equal(a.ok, false);
    assert.equal(a.reason, 'EXPLAIN_FOREIGN_IXSCAN');
  });

  it('9. explain contains no IXSCAN and fails', () => {
    const a = assessHintedExplain({
      queryPlanner: { winningPlan: { stage: 'COLLSCAN' } },
      executionStats: {
        nReturned: 0,
        totalKeysExamined: 0,
        totalDocsExamined: 0,
        executionTimeMillis: 1
      }
    });
    assert.equal(a.ok, false);
    assert.equal(a.reason, 'EXPLAIN_NO_IXSCAN');
  });

  it('10. explain throws and fails', async () => {
    const { res, exitCode } = await runWithExactIndex(async () => {
      throw Object.assign(new Error('boom'), { code: 'EXPLAIN_FAILED' });
    });
    assert.equal(res.classification, CLASSIFICATION.INSPECTION_FAILED);
    assert.equal(res.definitionClassification, CLASSIFICATION.MATCH);
    assert.equal(res.ready, false);
    assert.equal(exitCode, 78);
  });

  it('11. find throws and fails', async () => {
    let exitCode = null;
    const res = await runIndexPreflight({
      env: { [PREFLIGHT_EXECUTE_FLAG]: '1' },
      exit: (c) => {
        exitCode = c;
      },
      connect: async () => {},
      disconnect: async () => {},
      resolveCollection: async () => ({
        ok: true,
        name: EXPECTED_COLLECTION_NAME,
        collection: {
          find() {
            throw Object.assign(new Error('find'), { code: 'EXPLAIN_FIND_FAILED' });
          }
        }
      }),
      listIndexes: async () => [exactV2()]
      // no explain injection → uses collection path
    });
    assert.equal(res.classification, CLASSIFICATION.INSPECTION_FAILED);
    assert.equal(res.ready, false);
    assert.equal(exitCode, 78);
  });

  it('12. sort, limit, or hint throws and fails', async () => {
    async function failAt(step) {
      const chain = {};
      chain.sort = () => {
        if (step === 'sort') {
          throw Object.assign(new Error('sort'), { code: 'EXPLAIN_SORT_FAILED' });
        }
        return chain;
      };
      chain.limit = () => {
        if (step === 'limit') {
          throw Object.assign(new Error('limit'), { code: 'EXPLAIN_LIMIT_FAILED' });
        }
        return chain;
      };
      chain.hint = () => {
        if (step === 'hint') {
          throw Object.assign(new Error('hint'), { code: 'EXPLAIN_HINT_FAILED' });
        }
        return chain;
      };
      chain.explain = async () => ({});
      let exitCode = null;
      const res = await runIndexPreflight({
        env: { [PREFLIGHT_EXECUTE_FLAG]: '1' },
        exit: (c) => {
          exitCode = c;
        },
        connect: async () => {},
        disconnect: async () => {},
        resolveCollection: async () => ({
          ok: true,
          name: EXPECTED_COLLECTION_NAME,
          collection: { find: () => chain }
        }),
        listIndexes: async () => [exactV2()]
      });
      assert.equal(res.classification, CLASSIFICATION.INSPECTION_FAILED, step);
      assert.equal(res.ready, false, step);
      assert.equal(exitCode, 78, step);
      assert.equal(res.definitionClassification, CLASSIFICATION.MATCH, step);
    }
    await failAt('sort');
    await failAt('limit');
    await failAt('hint');
  });

  it('13. missing query planner fails', () => {
    const a = assessHintedExplain({ executionStats: { nReturned: 0 } });
    assert.equal(a.ok, false);
    assert.equal(a.reason, 'EXPLAIN_MISSING_PLANNER');
  });

  it('14. missing winning plan fails', () => {
    const a = assessHintedExplain({ queryPlanner: {} });
    assert.equal(a.ok, false);
    assert.equal(a.reason, 'EXPLAIN_MISSING_WINNING_PLAN');
  });

  it('15. malformed metrics fail', () => {
    const a = assessHintedExplain({
      queryPlanner: {
        winningPlan: { stage: 'IXSCAN', indexName: V2 }
      },
      executionStats: {
        nReturned: Number.NaN,
        totalKeysExamined: 0,
        totalDocsExamined: 0,
        executionTimeMillis: 1
      }
    });
    assert.equal(a.ok, false);
    assert.equal(a.reason, 'EXPLAIN_MALFORMED_METRICS');
  });

  it('16. nested FETCH/SORT plan with only v2 passes', () => {
    const a = assessHintedExplain({
      queryPlanner: {
        winningPlan: {
          stage: 'SORT',
          inputStage: {
            stage: 'FETCH',
            inputStage: { stage: 'IXSCAN', indexName: V2 }
          }
        }
      },
      executionStats: {
        nReturned: 0,
        totalKeysExamined: 1,
        totalDocsExamined: 1,
        executionTimeMillis: 2
      }
    });
    assert.equal(a.ok, true);
  });

  it('17. sharded wrapper with only v2 passes', () => {
    const a = assessHintedExplain({
      queryPlanner: {
        winningPlan: {
          stage: 'SHARD_MERGE',
          shards: [
            {
              winningPlan: {
                stage: 'FETCH',
                inputStage: { stage: 'IXSCAN', indexName: V2 }
              }
            }
          ]
        }
      },
      executionStats: {
        nReturned: 0,
        totalKeysExamined: 0,
        totalDocsExamined: 0,
        executionTimeMillis: 1
      }
    });
    assert.equal(a.ok, true);
  });

  it('18-20. definition visible; never MATCH; exit 78 after explain failure', async () => {
    const { res, exitCode } = await runWithExactIndex(async () => {
      throw Object.assign(new Error('x'), { code: 'EXPLAIN_FAILED' });
    });
    assert.equal(res.definitionClassification, CLASSIFICATION.MATCH);
    assert.notEqual(res.classification, CLASSIFICATION.MATCH);
    assert.equal(res.classification, CLASSIFICATION.INSPECTION_FAILED);
    assert.equal(res.ready, false);
    assert.equal(exitCode, 78);
  });

  it('21-22. fatal error codes redact URI and arbitrary text', () => {
    const uriErr = new Error(
      'failed mongodb://user:s3cret@prod.example:27017/customerdb query={"leaseId":"L1"}'
    );
    uriErr.code = 'SomeDriverCode';
    assert.equal(safeErrorCode(uriErr), 'INDEX_PREFLIGHT_UNEXPECTED');
    assert.equal(safeErrorCode({ code: 'EXPLAIN_FAILED', message: 'x' }), 'EXPLAIN_FAILED');
    const blob = JSON.stringify({
      errorCode: safeErrorCode(uriErr),
      exitCode: 78
    });
    assert.equal(blob.includes('s3cret'), false);
    assert.equal(blob.includes('mongodb://'), false);
    assert.equal(blob.includes('prod.example'), false);
    assert.equal(blob.includes('customerdb'), false);
    assert.equal(blob.includes('leaseId'), false);
  });

  it('23. runbook contains every new stop condition', () => {
    const md = fs.readFileSync(
      path.join(__dirname, '../../docs/runbooks/accommodation-checkout-lease-cleanup-index.md'),
      'utf8'
    );
    assert.match(md, /hinted explain/i);
    assert.match(md, /Explain failure/i);
    assert.match(md, /Wrong winning index|winning index/i);
    assert.match(md, /No IXSCAN|IXSCAN/i);
    assert.match(md, /[Hh]idden/);
    assert.match(md, /[Mm]alformed explain/);
    assert.match(md, /queryPlan/);
    assert.match(md, /native JavaScript numbers|nonnegative/i);
    assert.match(md, /integer/i);
  });

  it('24. no mutation method was introduced', () => {
    const src = fs.readFileSync(
      path.join(__dirname, 'accommodationCheckoutLeaseIndexPreflight.cjs'),
      'utf8'
    );
    assert.doesNotMatch(src, /\.createIndex\s*\(/);
    assert.doesNotMatch(src, /\.dropIndex\s*\(/);
    assert.doesNotMatch(src, /\.bulkWrite\s*\(/);
    assert.doesNotMatch(src, /\.findOneAndUpdate\s*\(/);
    assert.match(src, /\.hint\s*\(/);
  });
});

describe('B8F5C Correction 2: strict hidden, queryPlan, metrics', () => {
  const {
    assessHintedExplain,
    validateExplainMetrics,
    validateAllExplainMetrics,
    isNonNegativeInteger,
    isNonNegativeFiniteNumber
  } = preflight;
  const V2 = REQUIRED_INDEX_NAME;

  function baseExec(overrides = {}) {
    return {
      nReturned: 0,
      totalKeysExamined: 0,
      totalDocsExamined: 0,
      executionTimeMillis: 0,
      ...overrides
    };
  }

  function assessPlan(winningPlan, execOverrides) {
    return assessHintedExplain({
      queryPlanner: { winningPlan },
      executionStats: baseExec(execOverrides)
    });
  }

  it('1. complete strict hidden-value matrix', () => {
    const cases = [
      ['missing', exactV2(), CLASSIFICATION.MATCH],
      ['false', { ...exactV2(), hidden: false }, CLASSIFICATION.MATCH],
      ['true', { ...exactV2(), hidden: true }, CLASSIFICATION.OPTION_CONFLICT],
      ['null', { ...exactV2(), hidden: null }, CLASSIFICATION.OPTION_CONFLICT],
      ['0', { ...exactV2(), hidden: 0 }, CLASSIFICATION.OPTION_CONFLICT],
      ['1', { ...exactV2(), hidden: 1 }, CLASSIFICATION.OPTION_CONFLICT],
      ['empty_string', { ...exactV2(), hidden: '' }, CLASSIFICATION.OPTION_CONFLICT],
      ['string', { ...exactV2(), hidden: 'false' }, CLASSIFICATION.OPTION_CONFLICT],
      ['object', { ...exactV2(), hidden: {} }, CLASSIFICATION.OPTION_CONFLICT],
      ['array', { ...exactV2(), hidden: [] }, CLASSIFICATION.OPTION_CONFLICT],
      ['function', { ...exactV2(), hidden: () => false }, CLASSIFICATION.OPTION_CONFLICT],
      ['symbol', { ...exactV2(), hidden: Symbol('x') }, CLASSIFICATION.OPTION_CONFLICT]
    ];
    for (const [label, ix, expected] of cases) {
      assert.equal(
        classifyIndexes([ix]).classification,
        expected,
        `hidden ${label}`
      );
    }
  });

  it('2. queryPlan -> IXSCAN(v2)', () => {
    const a = assessPlan({ queryPlan: { stage: 'IXSCAN', indexName: V2 } });
    assert.equal(a.ok, true);
  });

  it('3. nested queryPlan -> FETCH -> IXSCAN(v2)', () => {
    const a = assessPlan({
      queryPlan: {
        stage: 'FETCH',
        inputStage: { stage: 'IXSCAN', indexName: V2 }
      }
    });
    assert.equal(a.ok, true);
  });

  it('4. sharded queryPlan with only v2', () => {
    const a = assessPlan({
      stage: 'SHARD_MERGE',
      shards: [
        {
          winningPlan: {
            queryPlan: {
              stage: 'FETCH',
              inputStage: { stage: 'IXSCAN', indexName: V2 }
            }
          }
        },
        {
          winningPlan: {
            queryPlan: { stage: 'IXSCAN', indexName: V2 }
          }
        }
      ]
    });
    assert.equal(a.ok, true);
  });

  it('5. foreign queryPlan index', () => {
    const a = assessPlan({
      queryPlan: { stage: 'IXSCAN', indexName: 'leaseId_1' }
    });
    assert.equal(a.ok, false);
    assert.equal(a.reason, 'EXPLAIN_FOREIGN_IXSCAN');
  });

  it('6. mixed winning queryPlan branches', () => {
    const a = assessPlan({
      queryPlan: {
        stage: 'OR',
        inputStages: [
          { stage: 'IXSCAN', indexName: V2 },
          { stage: 'IXSCAN', indexName: 'leaseId_1' }
        ]
      }
    });
    assert.equal(a.ok, false);
    assert.equal(a.reason, 'EXPLAIN_FOREIGN_IXSCAN');
  });

  it('7. empty queryPlan', () => {
    const a = assessPlan({ queryPlan: {} });
    assert.equal(a.ok, false);
    assert.equal(a.reason, 'EXPLAIN_NO_IXSCAN');
  });

  it('8. slotBasedPlan text cannot substitute for queryPlan IXSCAN', () => {
    const a = assessPlan({
      queryPlan: {},
      slotBasedPlan: `IXSCAN ${V2} accommodationCheckoutLease_released_cleanup_v2`
    });
    assert.equal(a.ok, false);
    assert.equal(a.reason, 'EXPLAIN_NO_IXSCAN');
  });

  it('9. rejected foreign plan remains ignored', () => {
    const a = assessHintedExplain({
      queryPlanner: {
        winningPlan: { stage: 'IXSCAN', indexName: V2 },
        rejectedPlans: [{ stage: 'IXSCAN', indexName: 'leaseId_1' }]
      },
      executionStats: baseExec()
    });
    assert.equal(a.ok, true);
  });

  it('10. zero metrics pass', () => {
    assert.equal(validateExplainMetrics(baseExec()).ok, true);
    assert.equal(isNonNegativeInteger(0), true);
  });

  it('11. positive integer metrics pass', () => {
    assert.equal(
      validateExplainMetrics(
        baseExec({
          nReturned: 3,
          totalKeysExamined: 10,
          totalDocsExamined: 10,
          executionTimeMillis: 1.5
        })
      ).ok,
      true
    );
  });

  it('12. negative metrics fail', () => {
    assert.equal(
      assessPlan({ stage: 'IXSCAN', indexName: V2 }, { nReturned: -1 }).ok,
      false
    );
  });

  it('13. fractional count metrics fail', () => {
    assert.equal(
      assessPlan({ stage: 'IXSCAN', indexName: V2 }, { nReturned: 1.5 }).ok,
      false
    );
  });

  it('14. NaN and infinities fail', () => {
    assert.equal(
      assessPlan({ stage: 'IXSCAN', indexName: V2 }, { nReturned: Number.NaN }).ok,
      false
    );
    assert.equal(
      assessPlan(
        { stage: 'IXSCAN', indexName: V2 },
        { executionTimeMillis: Infinity }
      ).ok,
      false
    );
    assert.equal(
      assessPlan(
        { stage: 'IXSCAN', indexName: V2 },
        { executionTimeMillis: -Infinity }
      ).ok,
      false
    );
  });

  it('15. numeric strings fail', () => {
    assert.equal(isNonNegativeInteger('0'), false);
    assert.equal(
      assessPlan({ stage: 'IXSCAN', indexName: V2 }, { nReturned: '0' }).ok,
      false
    );
    assert.equal(
      assessPlan({ stage: 'IXSCAN', indexName: V2 }, { totalKeysExamined: '12' }).ok,
      false
    );
  });

  it('16. null, boolean, BigInt, object, and missing metrics fail', () => {
    assert.equal(
      assessPlan({ stage: 'IXSCAN', indexName: V2 }, { nReturned: null }).ok,
      false
    );
    assert.equal(
      assessPlan({ stage: 'IXSCAN', indexName: V2 }, { nReturned: true }).ok,
      false
    );
    assert.equal(
      assessPlan({ stage: 'IXSCAN', indexName: V2 }, { nReturned: 0n }).ok,
      false
    );
    assert.equal(
      assessPlan(
        { stage: 'IXSCAN', indexName: V2 },
        { nReturned: { valueOf: () => 0 } }
      ).ok,
      false
    );
    const missing = assessHintedExplain({
      queryPlanner: { winningPlan: { stage: 'IXSCAN', indexName: V2 } },
      executionStats: {
        totalKeysExamined: 0,
        totalDocsExamined: 0,
        executionTimeMillis: 0
      }
    });
    assert.equal(missing.ok, false);
  });

  it('17. malformed per-shard metric fails', () => {
    const a = assessHintedExplain({
      queryPlanner: {
        winningPlan: {
          stage: 'SHARD_MERGE',
          shards: [
            {
              winningPlan: { stage: 'IXSCAN', indexName: V2 }
            }
          ]
        }
      },
      executionStats: {
        ...baseExec(),
        shards: [
          {
            nReturned: 0,
            totalKeysExamined: 0,
            totalDocsExamined: 0,
            executionTimeMillis: 0
          },
          {
            nReturned: '0',
            totalKeysExamined: 0,
            totalDocsExamined: 0,
            executionTimeMillis: 0
          }
        ]
      }
    });
    assert.equal(a.ok, false);
    assert.equal(a.reason, 'EXPLAIN_MALFORMED_METRICS');
  });

  it('18. valid per-shard metrics pass', () => {
    const a = assessHintedExplain({
      queryPlanner: {
        winningPlan: {
          stage: 'SHARD_MERGE',
          shards: [
            { winningPlan: { stage: 'IXSCAN', indexName: V2 } },
            { winningPlan: { stage: 'IXSCAN', indexName: V2 } }
          ]
        }
      },
      executionStats: {
        ...baseExec({ nReturned: 2, totalKeysExamined: 2, totalDocsExamined: 2 }),
        shards: [
          baseExec({ nReturned: 1, totalKeysExamined: 1, totalDocsExamined: 1 }),
          baseExec({ nReturned: 1, totalKeysExamined: 1, totalDocsExamined: 1 })
        ]
      }
    });
    assert.equal(a.ok, true);
  });

  it('19-21. top-level INSPECTION_FAILED, ready false, exit 78', async () => {
    const { res, exitCode } = await runWithExactIndex(async () => ({
      hint: V2,
      assessment: {
        ok: false,
        reason: 'EXPLAIN_MALFORMED_METRICS',
        stats: okExplainStats({ nReturned: '0', usesRequiredIndex: true })
      },
      stats: okExplainStats({ nReturned: '0', usesRequiredIndex: true })
    }));
    assert.equal(res.classification, CLASSIFICATION.INSPECTION_FAILED);
    assert.equal(res.definitionClassification, CLASSIFICATION.MATCH);
    assert.equal(res.ready, false);
    assert.equal(exitCode, 78);
  });

  it('22. no mutation capability introduced', () => {
    const src = fs.readFileSync(
      path.join(__dirname, 'accommodationCheckoutLeaseIndexPreflight.cjs'),
      'utf8'
    );
    assert.doesNotMatch(src, /\.createIndex\s*\(/);
    assert.doesNotMatch(src, /\.dropIndexes\s*\(/);
    assert.doesNotMatch(src, /\.syncIndexes\s*\(/);
    assert.doesNotMatch(src, /Number\s*\(\s*s\.nReturned/);
    // Reject metric coercion `Number(value)` / `Number( value )` — not identifiers ending in Number.
    assert.doesNotMatch(src, /(?<![\w$])Number\s*\(\s*value\s*\)/);
  });

  it('23. runbook contains the strict rules', () => {
    const md = fs.readFileSync(
      path.join(__dirname, '../../docs/runbooks/accommodation-checkout-lease-cleanup-index.md'),
      'utf8'
    );
    assert.match(md, /exact boolean `false`|exact `false`/);
    assert.match(md, /queryPlan/);
    assert.match(md, /native JavaScript numbers/);
    assert.match(md, /integers/);
    assert.match(md, /per-shard/);
    assert.doesNotMatch(
      md,
      /(?:^|\n)\s*(?:export\s+)?ACCOMMODATION_CHECKOUT_HOLD_EXPIRY_EXECUTE=1\b/m
    );
  });
});

// Allow running without node --test wrapper via direct execute.
if (require.main === module) {
  // node --test on this file is preferred; direct require still loads suite.
}
