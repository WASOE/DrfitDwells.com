#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * B8F5C — Read-only preflight for accommodationCheckoutLease_released_cleanup_v2.
 *
 * Does not create, modify, rename, rebuild, or drop indexes.
 * Does not start or enable the expiry worker or public lease gate.
 *
 * Execution flag (exact accepted true value = "1"):
 *   ACCOMMODATION_CHECKOUT_INDEX_PREFLIGHT_EXECUTE
 *
 * Importing this module has no Mongo connection or query side effects.
 */
'use strict';

const PREFLIGHT_EXECUTE_FLAG = 'ACCOMMODATION_CHECKOUT_INDEX_PREFLIGHT_EXECUTE';
const PREFLIGHT_ACCEPTED_TRUE = '1';

const REQUIRED_INDEX_NAME = 'accommodationCheckoutLease_released_cleanup_v2';
const LEGACY_V1_INDEX_NAME = 'accommodationCheckoutLease_released_cleanup_v1';
const MODEL_NAME = 'AccommodationCheckoutLease';
/** Mongoose default pluralization of AccommodationCheckoutLease. */
const EXPECTED_COLLECTION_NAME = 'accommodationcheckoutleases';

const REQUIRED_INDEX_KEY_ORDER = Object.freeze([
  ['status', 1],
  ['isLive', 1],
  ['checkoutClaimCleanupStatus', 1],
  ['checkoutClaimCleanupNextAttemptAt', 1],
  ['leaseId', 1]
]);

const REQUIRED_INDEX_KEY = Object.freeze(Object.fromEntries(REQUIRED_INDEX_KEY_ORDER));

/** Production released-cleanup page size (hold service). */
const EXPLAIN_LIMIT = 100;

const CLASSIFICATION = Object.freeze({
  MATCH: 'MATCH',
  ABSENT: 'ABSENT',
  NAME_CONFLICT: 'NAME_CONFLICT',
  KEY_CONFLICT: 'KEY_CONFLICT',
  OPTION_CONFLICT: 'OPTION_CONFLICT',
  COLLECTION_ABSENT: 'COLLECTION_ABSENT',
  INSPECTION_FAILED: 'INSPECTION_FAILED',
  DISABLED: 'DISABLED'
});

const EXIT = Object.freeze({
  DISABLED_OR_MATCH: 0,
  ABSENT_ELIGIBLE: 2,
  CONFLICT_OR_FAILURE: 78
});

/** Option keys that must not differ when present on either side. */
const COMPARE_OPTION_KEYS = Object.freeze([
  'unique',
  'sparse',
  'expireAfterSeconds',
  'partialFilterExpression',
  'collation',
  'hidden'
]);

/** Allowlisted safe codes for fatal / unexpected logging (never raw messages). */
const SAFE_ERROR_CODES = Object.freeze([
  'EXPLAIN_UNAVAILABLE',
  'EXPLAIN_FAILED',
  'EXPLAIN_MISSING_RESULT',
  'EXPLAIN_MISSING_PLANNER',
  'EXPLAIN_MISSING_WINNING_PLAN',
  'EXPLAIN_REQUIRED_INDEX_ABSENT',
  'EXPLAIN_FOREIGN_IXSCAN',
  'EXPLAIN_NO_IXSCAN',
  'EXPLAIN_MALFORMED_METRICS',
  'EXPLAIN_FIND_FAILED',
  'EXPLAIN_SORT_FAILED',
  'EXPLAIN_LIMIT_FAILED',
  'EXPLAIN_HINT_FAILED',
  'INDEX_LIST_FAILED',
  'INDEX_LIST_UNAVAILABLE',
  'PREFLIGHT_RESOLVE_REQUIRED',
  'PREFLIGHT_FAILED',
  'COLLECTION_ABSENT',
  'ENUM',
  'MONGO_DOWN',
  'INDEX_PREFLIGHT_UNEXPECTED'
]);

function safeErrorCode(err) {
  if (!err) return 'INDEX_PREFLIGHT_UNEXPECTED';
  const raw =
    err.code != null && String(err.code).trim()
      ? String(err.code).trim().slice(0, 80)
      : '';
  if (raw && SAFE_ERROR_CODES.includes(raw)) return raw;
  return 'INDEX_PREFLIGHT_UNEXPECTED';
}

function isPreflightExecuteEnabled(env = process.env) {
  return String(env[PREFLIGHT_EXECUTE_FLAG] || '').trim() === PREFLIGHT_ACCEPTED_TRUE;
}

function requiredKeyObject() {
  return { ...REQUIRED_INDEX_KEY };
}

function indexKeyMatchesRequired(indexKey) {
  if (!indexKey || typeof indexKey !== 'object') return false;
  const keys = Object.keys(indexKey);
  if (keys.length !== REQUIRED_INDEX_KEY_ORDER.length) return false;
  for (let i = 0; i < REQUIRED_INDEX_KEY_ORDER.length; i += 1) {
    const [name, direction] = REQUIRED_INDEX_KEY_ORDER[i];
    if (keys[i] !== name) return false;
    if (Number(indexKey[name]) !== direction) return false;
  }
  return true;
}

/**
 * Strict hidden typing: only missing property or exact boolean false is acceptable.
 * No Boolean()/Number()/truthiness coercion.
 */
function hiddenOptionConflict(indexDoc) {
  if (!indexDoc || typeof indexDoc !== 'object') return null;
  if (!Object.prototype.hasOwnProperty.call(indexDoc, 'hidden')) {
    return null;
  }
  const value = indexDoc.hidden;
  if (value === false) return null;
  if (value === true) return { option: 'hidden', actual: true };
  return { option: 'hidden', actual: 'malformed' };
}

function normalizeOptionValue(key, value) {
  if (value === undefined) return null;
  if (key === 'unique' || key === 'sparse') {
    if (value === true) return true;
    if (value === false) return false;
    // Non-boolean unique/sparse → conflict (no 0/1 coercion).
    if (value == null) return { malformed: true, rawType: typeof value };
    return { malformed: true, rawType: typeof value };
  }
  if (value == null) return null;
  return value;
}

function optionsConflict(indexDoc) {
  const conflicts = [];
  const hiddenConflict = hiddenOptionConflict(indexDoc);
  if (hiddenConflict) conflicts.push(hiddenConflict);

  for (const key of COMPARE_OPTION_KEYS) {
    if (key === 'hidden') continue;
    if (!Object.prototype.hasOwnProperty.call(indexDoc, key)) continue;
    const actual = normalizeOptionValue(key, indexDoc[key]);
    if (actual == null || actual === false) continue;
    if (actual && typeof actual === 'object' && actual.malformed === true) {
      conflicts.push({ option: key, actual: 'malformed' });
      continue;
    }
    if (key === 'partialFilterExpression' || key === 'collation') {
      conflicts.push({ option: key, actual });
      continue;
    }
    if (actual === true || typeof actual === 'number') {
      conflicts.push({ option: key, actual });
    }
  }
  return conflicts;
}

function summarizeIndex(ix) {
  if (!ix || typeof ix !== 'object') return null;
  const summary = {
    name: ix.name != null ? String(ix.name) : null,
    key: ix.key && typeof ix.key === 'object' ? { ...ix.key } : null
  };
  for (const opt of COMPARE_OPTION_KEYS) {
    if (ix[opt] !== undefined) summary[opt] = ix[opt];
  }
  return summary;
}

function buildEligibleFilter(now = new Date()) {
  const dueAt = now instanceof Date ? now : new Date(now);
  return {
    status: 'released',
    isLive: false,
    $or: [
      { checkoutClaimCleanupStatus: 'pending' },
      { checkoutClaimCleanupStatus: null },
      { checkoutClaimCleanupStatus: { $exists: false } }
    ],
    $and: [
      {
        $or: [
          { checkoutClaimCleanupNextAttemptAt: null },
          { checkoutClaimCleanupNextAttemptAt: { $exists: false } },
          { checkoutClaimCleanupNextAttemptAt: { $lte: dueAt } }
        ]
      }
    ]
  };
}

function buildExplainSort() {
  return { checkoutClaimCleanupNextAttemptAt: 1, leaseId: 1 };
}

/**
 * Classify listed indexes against the required v2 definition.
 * Never mutates. Never accepts v1 as v2 readiness.
 */
function classifyIndexes(indexes, options = {}) {
  const collectionName =
    options.collectionName != null ? String(options.collectionName) : null;
  const list = Array.isArray(indexes) ? indexes.filter(Boolean) : [];

  const byName = list.find((ix) => ix && ix.name === REQUIRED_INDEX_NAME);
  const keyMatches = list.filter((ix) => ix && indexKeyMatchesRequired(ix.key));
  const v1Present = list
    .filter((ix) => ix && typeof ix.name === 'string')
    .filter(
      (ix) =>
        ix.name === LEGACY_V1_INDEX_NAME ||
        (/released_cleanup_v1/i.test(ix.name) && ix.name !== REQUIRED_INDEX_NAME)
    )
    .map(summarizeIndex);

  const unrelated = list
    .filter((ix) => {
      if (!ix || !ix.name) return false;
      if (ix.name === REQUIRED_INDEX_NAME) return false;
      if (ix.name === LEGACY_V1_INDEX_NAME) return false;
      if (/released_cleanup_v1/i.test(ix.name)) return false;
      return true;
    })
    .map((ix) => ({ name: String(ix.name) }));

  const base = {
    requiredIndexName: REQUIRED_INDEX_NAME,
    requiredKey: requiredKeyObject(),
    collectionName,
    expectedCollectionName: EXPECTED_COLLECTION_NAME,
    legacyV1Indexes: v1Present,
    unrelatedIndexNames: unrelated.map((u) => u.name),
    listedIndexNames: list.map((ix) => (ix && ix.name != null ? String(ix.name) : null))
  };

  if (byName) {
    if (!indexKeyMatchesRequired(byName.key)) {
      return {
        ...base,
        classification: CLASSIFICATION.NAME_CONFLICT,
        ready: false,
        matchedIndex: null,
        conflictingIndex: summarizeIndex(byName),
        reason: 'required_name_present_with_wrong_key'
      };
    }
    const optConflicts = optionsConflict(byName);
    if (optConflicts.length > 0) {
      return {
        ...base,
        classification: CLASSIFICATION.OPTION_CONFLICT,
        ready: false,
        matchedIndex: null,
        conflictingIndex: summarizeIndex(byName),
        optionConflicts: optConflicts,
        reason: 'required_name_present_with_option_conflict'
      };
    }
    return {
      ...base,
      classification: CLASSIFICATION.MATCH,
      ready: true,
      matchedIndex: summarizeIndex(byName),
      conflictingIndex: null,
      reason: 'exact_name_and_definition'
    };
  }

  // Name absent — same keys under another name is not readiness.
  const otherKeyMatch = keyMatches.find((ix) => ix.name !== REQUIRED_INDEX_NAME);
  if (otherKeyMatch) {
    return {
      ...base,
      classification: CLASSIFICATION.KEY_CONFLICT,
      ready: false,
      matchedIndex: null,
      conflictingIndex: summarizeIndex(otherKeyMatch),
      reason: 'exact_keys_under_another_name'
    };
  }

  return {
    ...base,
    classification: CLASSIFICATION.ABSENT,
    ready: false,
    matchedIndex: null,
    conflictingIndex: null,
    reason: 'required_index_absent',
    legacyV1Only: v1Present.length > 0 && keyMatches.length === 0
  };
}

function redactUri(uri) {
  if (uri == null || uri === '') return null;
  return '[redacted]';
}

/**
 * Recursively collect stages and IXSCAN index names from the winning plan only.
 * Explicit child fields: queryPlan, inputStage, inputStages, children, shards[*].winningPlan.
 * Does not walk rejectedPlans, allPlansExecution, slotBasedPlan, or queryPlanner.
 */
function walkPlanTree(plan, stages, indexNames, ixscanNames) {
  if (!plan || typeof plan !== 'object') return;
  if (Array.isArray(plan)) {
    for (const item of plan) walkPlanTree(item, stages, indexNames, ixscanNames);
    return;
  }
  if (plan.stage) stages.push(String(plan.stage));
  if (plan.indexName) indexNames.add(String(plan.indexName));
  if (String(plan.stage || '') === 'IXSCAN' && plan.indexName) {
    ixscanNames.add(String(plan.indexName));
  }
  if (plan.queryPlan) {
    walkPlanTree(plan.queryPlan, stages, indexNames, ixscanNames);
  }
  if (plan.inputStage) {
    walkPlanTree(plan.inputStage, stages, indexNames, ixscanNames);
  }
  if (Array.isArray(plan.inputStages)) {
    walkPlanTree(plan.inputStages, stages, indexNames, ixscanNames);
  }
  if (Array.isArray(plan.children)) {
    walkPlanTree(plan.children, stages, indexNames, ixscanNames);
  }
  if (Array.isArray(plan.shards)) {
    for (const shard of plan.shards) {
      if (!shard || typeof shard !== 'object') continue;
      if (shard.winningPlan) {
        walkPlanTree(shard.winningPlan, stages, indexNames, ixscanNames);
      }
    }
  }
}

function resolveWinningPlan(explainDoc) {
  if (!explainDoc || typeof explainDoc !== 'object') {
    return { ok: false, reason: 'EXPLAIN_MISSING_RESULT', winningPlan: null };
  }
  const planner = explainDoc.queryPlanner;
  if (!planner || typeof planner !== 'object') {
    return { ok: false, reason: 'EXPLAIN_MISSING_PLANNER', winningPlan: null };
  }
  let winningPlan = planner.winningPlan || null;
  if (!winningPlan && Array.isArray(planner.shards)) {
    winningPlan = { stage: 'SHARD_MERGE', shards: planner.shards };
  }
  if (!winningPlan) {
    return { ok: false, reason: 'EXPLAIN_MISSING_WINNING_PLAN', winningPlan: null };
  }
  return { ok: true, reason: null, winningPlan };
}

/** Native finite nonnegative number — no Number() coercion. */
function isNonNegativeFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Count metrics: native nonnegative integers only. */
function isNonNegativeInteger(value) {
  return isNonNegativeFiniteNumber(value) && Number.isInteger(value);
}

/**
 * Validate executionStats metric fields without coercion.
 * Count fields must be nonnegative integers; executionTimeMillis nonnegative finite number.
 */
function validateExplainMetrics(exec, labelPrefix = '') {
  if (!exec || typeof exec !== 'object') {
    return {
      ok: false,
      reason: 'EXPLAIN_MALFORMED_METRICS',
      malformedMetric: labelPrefix ? `${labelPrefix}executionStats` : 'executionStats'
    };
  }
  const countFields = ['nReturned', 'totalKeysExamined', 'totalDocsExamined'];
  for (const field of countFields) {
    if (!Object.prototype.hasOwnProperty.call(exec, field)) {
      return {
        ok: false,
        reason: 'EXPLAIN_MALFORMED_METRICS',
        malformedMetric: `${labelPrefix}${field}`
      };
    }
    if (!isNonNegativeInteger(exec[field])) {
      return {
        ok: false,
        reason: 'EXPLAIN_MALFORMED_METRICS',
        malformedMetric: `${labelPrefix}${field}`
      };
    }
  }
  if (!Object.prototype.hasOwnProperty.call(exec, 'executionTimeMillis')) {
    return {
      ok: false,
      reason: 'EXPLAIN_MALFORMED_METRICS',
      malformedMetric: `${labelPrefix}executionTimeMillis`
    };
  }
  if (!isNonNegativeFiniteNumber(exec.executionTimeMillis)) {
    return {
      ok: false,
      reason: 'EXPLAIN_MALFORMED_METRICS',
      malformedMetric: `${labelPrefix}executionTimeMillis`
    };
  }
  return { ok: true };
}

function validateShardMetricsList(shards, label = 'shards') {
  if (shards == null) return { ok: true };
  if (!Array.isArray(shards)) {
    return {
      ok: false,
      reason: 'EXPLAIN_MALFORMED_METRICS',
      malformedMetric: label
    };
  }
  for (let i = 0; i < shards.length; i += 1) {
    const shard = shards[i];
    if (!shard || typeof shard !== 'object') {
      return {
        ok: false,
        reason: 'EXPLAIN_MALFORMED_METRICS',
        malformedMetric: `${label}[${i}]`
      };
    }
    const target =
      shard.executionStats && typeof shard.executionStats === 'object'
        ? shard.executionStats
        : shard;
    const checked = validateExplainMetrics(target, `${label}[${i}].`);
    if (!checked.ok) return checked;
  }
  return { ok: true };
}

/**
 * Validate top-level and per-shard execution metrics when present.
 * Does not fall back to zeros when shard metrics are malformed.
 */
function validateAllExplainMetrics(explainDoc) {
  const exec = explainDoc && explainDoc.executionStats;
  const top = validateExplainMetrics(exec);
  if (!top.ok) return top;

  if (Array.isArray(exec.shards)) {
    const shardCheck = validateShardMetricsList(exec.shards, 'executionStats.shards');
    if (!shardCheck.ok) return shardCheck;
  }

  const stages = exec.executionStages;
  if (stages && typeof stages === 'object' && Array.isArray(stages.shards)) {
    const stageShardCheck = validateShardMetricsList(
      stages.shards,
      'executionStats.executionStages.shards'
    );
    if (!stageShardCheck.ok) return stageShardCheck;
  }

  return { ok: true };
}

/**
 * Assess hinted explain: required index only on winning plan; strict metrics.
 */
function assessHintedExplain(explainDoc) {
  const resolved = resolveWinningPlan(explainDoc);
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason,
      stats: extractExplainStats(explainDoc)
    };
  }

  const stages = [];
  const indexNames = new Set();
  const ixscanNames = new Set();
  walkPlanTree(resolved.winningPlan, stages, indexNames, ixscanNames);

  if (ixscanNames.size === 0) {
    return {
      ok: false,
      reason: 'EXPLAIN_NO_IXSCAN',
      stats: extractExplainStats(explainDoc, stages, indexNames, ixscanNames)
    };
  }
  for (const name of ixscanNames) {
    if (name !== REQUIRED_INDEX_NAME) {
      return {
        ok: false,
        reason: 'EXPLAIN_FOREIGN_IXSCAN',
        stats: extractExplainStats(explainDoc, stages, indexNames, ixscanNames)
      };
    }
  }
  if (!ixscanNames.has(REQUIRED_INDEX_NAME)) {
    return {
      ok: false,
      reason: 'EXPLAIN_REQUIRED_INDEX_ABSENT',
      stats: extractExplainStats(explainDoc, stages, indexNames, ixscanNames)
    };
  }

  const metricsCheck = validateAllExplainMetrics(explainDoc);
  if (!metricsCheck.ok) {
    return {
      ok: false,
      reason: metricsCheck.reason,
      stats: extractExplainStats(explainDoc, stages, indexNames, ixscanNames),
      malformedMetric: metricsCheck.malformedMetric
    };
  }

  const stats = extractExplainStats(explainDoc, stages, indexNames, ixscanNames);
  stats.usesRequiredIndex = true;
  return { ok: true, reason: null, stats };
}

function extractExplainStats(explainDoc, stagesIn, indexNamesIn, ixscanNamesIn) {
  const stages = stagesIn ? [...stagesIn] : [];
  const indexNames = indexNamesIn ? new Set(indexNamesIn) : new Set();
  const ixscanNames = ixscanNamesIn ? new Set(ixscanNamesIn) : new Set();

  if ((!stagesIn || !indexNamesIn) && explainDoc && typeof explainDoc === 'object') {
    const resolved = resolveWinningPlan(explainDoc);
    if (resolved.ok) walkPlanTree(resolved.winningPlan, stages, indexNames, ixscanNames);
  }

  const exec =
    explainDoc && explainDoc.executionStats ? explainDoc.executionStats : null;
  const inMemorySort = stages.some((s) => s === 'SORT' || s === 'SORT_KEY_GENERATOR');

  return {
    winningIndexName: ixscanNames.size
      ? [...ixscanNames][0]
      : indexNames.size
        ? [...indexNames][0]
        : null,
    winningIndexNames: [...indexNames],
    ixscanIndexNames: [...ixscanNames],
    winningStages: stages,
    nReturned: exec && Object.prototype.hasOwnProperty.call(exec, 'nReturned') ? exec.nReturned : null,
    keysExamined:
      exec && Object.prototype.hasOwnProperty.call(exec, 'totalKeysExamined')
        ? exec.totalKeysExamined
        : null,
    docsExamined:
      exec && Object.prototype.hasOwnProperty.call(exec, 'totalDocsExamined')
        ? exec.totalDocsExamined
        : null,
    inMemorySort,
    executionTimeMillis:
      exec && Object.prototype.hasOwnProperty.call(exec, 'executionTimeMillis')
        ? exec.executionTimeMillis
        : null,
    usesRequiredIndex:
      ixscanNames.size > 0 &&
      [...ixscanNames].every((n) => n === REQUIRED_INDEX_NAME)
  };
}

/**
 * Run read-only explain with explicit hint by exact required index name.
 * Must not mutate documents.
 */
async function runReleasedCleanupExplain(collection, now = new Date()) {
  const filter = buildEligibleFilter(now);
  const sort = buildExplainSort();
  const hintName = REQUIRED_INDEX_NAME;

  let cursor;
  try {
    if (!collection || typeof collection.find !== 'function') {
      throw Object.assign(new Error('find unavailable'), { code: 'EXPLAIN_FIND_FAILED' });
    }
    cursor = collection.find(filter);
  } catch (err) {
    throw Object.assign(err && err.code ? err : new Error('find failed'), {
      code: err && err.code ? err.code : 'EXPLAIN_FIND_FAILED'
    });
  }

  let sorted;
  try {
    if (!cursor || typeof cursor.sort !== 'function') {
      throw Object.assign(new Error('sort unavailable'), { code: 'EXPLAIN_SORT_FAILED' });
    }
    sorted = cursor.sort(sort);
  } catch (err) {
    throw Object.assign(err && err.code ? err : new Error('sort failed'), {
      code: err && err.code ? err.code : 'EXPLAIN_SORT_FAILED'
    });
  }

  let limited;
  try {
    if (!sorted || typeof sorted.limit !== 'function') {
      throw Object.assign(new Error('limit unavailable'), { code: 'EXPLAIN_LIMIT_FAILED' });
    }
    limited = sorted.limit(EXPLAIN_LIMIT);
  } catch (err) {
    throw Object.assign(err && err.code ? err : new Error('limit failed'), {
      code: err && err.code ? err.code : 'EXPLAIN_LIMIT_FAILED'
    });
  }

  let hinted;
  try {
    if (!limited || typeof limited.hint !== 'function') {
      throw Object.assign(new Error('hint unavailable'), { code: 'EXPLAIN_HINT_FAILED' });
    }
    hinted = limited.hint(hintName);
  } catch (err) {
    throw Object.assign(err && err.code ? err : new Error('hint failed'), {
      code: err && err.code ? err.code : 'EXPLAIN_HINT_FAILED'
    });
  }

  let explainDoc;
  try {
    if (!hinted || typeof hinted.explain !== 'function') {
      throw Object.assign(new Error('explain unavailable'), {
        code: 'EXPLAIN_UNAVAILABLE'
      });
    }
    explainDoc = await hinted.explain('executionStats');
  } catch (err) {
    throw Object.assign(err && err.code ? err : new Error('explain failed'), {
      code: err && err.code ? err.code : 'EXPLAIN_FAILED'
    });
  }

  if (explainDoc == null) {
    throw Object.assign(new Error('explain missing'), {
      code: 'EXPLAIN_MISSING_RESULT'
    });
  }

  const assessment = assessHintedExplain(explainDoc);
  return {
    filterShape: {
      status: 'released',
      isLive: false,
      cleanupStatus: 'pending|null|missing',
      nextAttemptAt: 'due|null|missing',
      sort,
      limit: EXPLAIN_LIMIT,
      hint: hintName
    },
    hint: hintName,
    assessment,
    stats: assessment.stats
  };
}

/**
 * Core read-only inspection. All Mongo access is injected for tests.
 *
 * @param {object} runtime
 * @param {object} [runtime.env]
 * @param {() => Promise<void>} [runtime.connect]
 * @param {() => Promise<void>} [runtime.disconnect]
 * @param {() => Promise<{ ok: boolean, name?: string, reason?: string }>} [runtime.resolveCollection]
 * @param {(collection: object) => Promise<object[]>} [runtime.listIndexes]
 * @param {(collection: object, now: Date) => Promise<object>} [runtime.explain]
 * @param {() => Date} [runtime.getNow]
 * @param {(event: string, fields?: object, level?: string) => void} [runtime.log]
 * @param {(code: number) => void} [runtime.exit]
 */
async function runIndexPreflight(runtime = {}) {
  const env = runtime.env || process.env;
  const log =
    typeof runtime.log === 'function'
      ? runtime.log
      : (event, fields = {}, level = 'info') => {
          const line = JSON.stringify({ event, source: 'accommodation-checkout-lease-index-preflight', ...fields });
          if (level === 'error') console.error(line);
          else console.log(line);
        };
  const exitFn =
    typeof runtime.exit === 'function' ? runtime.exit : (code) => process.exit(code);

  if (!isPreflightExecuteEnabled(env)) {
    log('accommodation_lease_index_preflight_disabled', {
      reason: 'ACCOMMODATION_CHECKOUT_INDEX_PREFLIGHT_EXECUTE_not_enabled',
      flag: PREFLIGHT_EXECUTE_FLAG
    });
    exitFn(EXIT.DISABLED_OR_MATCH);
    return {
      classification: CLASSIFICATION.DISABLED,
      ready: false,
      exitCode: EXIT.DISABLED_OR_MATCH,
      connected: false
    };
  }

  let connected = false;
  async function disconnectOnce() {
    if (!connected) return;
    connected = false;
    if (typeof runtime.disconnect === 'function') {
      try {
        await runtime.disconnect();
      } catch (_e) {
        /* ignore disconnect errors in preflight */
      }
    }
  }

  try {
    if (typeof runtime.connect === 'function') {
      await runtime.connect();
      connected = true;
    }

    let collectionInfo;
    if (typeof runtime.resolveCollection === 'function') {
      collectionInfo = await runtime.resolveCollection();
    } else {
      throw Object.assign(new Error('resolveCollection required when execute enabled'), {
        code: 'PREFLIGHT_RESOLVE_REQUIRED'
      });
    }

    if (!collectionInfo || collectionInfo.ok !== true) {
      const classification =
        collectionInfo && collectionInfo.reason === 'collection_absent'
          ? CLASSIFICATION.COLLECTION_ABSENT
          : CLASSIFICATION.INSPECTION_FAILED;
      const result = {
        classification,
        ready: false,
        exitCode: EXIT.CONFLICT_OR_FAILURE,
        connected: true,
        collectionName: collectionInfo && collectionInfo.name != null ? collectionInfo.name : null,
        reason: (collectionInfo && collectionInfo.reason) || 'collection_resolve_failed'
      };
      log('accommodation_lease_index_preflight_result', {
        classification: result.classification,
        exitCode: result.exitCode,
        reason: result.reason,
        collectionName: result.collectionName
      });
      await disconnectOnce();
      exitFn(result.exitCode);
      return result;
    }

    const collection = collectionInfo.collection;
    const collectionName = String(collectionInfo.name || EXPECTED_COLLECTION_NAME);

    let indexes;
    try {
      if (typeof runtime.listIndexes === 'function') {
        indexes = await runtime.listIndexes(collection);
      } else if (collection && typeof collection.indexes === 'function') {
        indexes = await collection.indexes();
      } else if (collection && typeof collection.listIndexes === 'function') {
        indexes = await collection.listIndexes().toArray();
      } else {
        throw Object.assign(new Error('indexes listing unavailable'), {
          code: 'INDEX_LIST_UNAVAILABLE'
        });
      }
    } catch (err) {
      const result = {
        classification: CLASSIFICATION.INSPECTION_FAILED,
        ready: false,
        exitCode: EXIT.CONFLICT_OR_FAILURE,
        connected: true,
        collectionName,
        reason: 'index_list_failed',
        errorCode: safeErrorCode(err)
      };
      log(
        'accommodation_lease_index_preflight_result',
        {
          classification: result.classification,
          exitCode: result.exitCode,
          reason: result.reason,
          errorCode: result.errorCode,
          collectionName
        },
        'error'
      );
      await disconnectOnce();
      exitFn(result.exitCode);
      return result;
    }

    const classified = classifyIndexes(indexes, { collectionName });

    let explain = null;
    let exitCode = EXIT.CONFLICT_OR_FAILURE;
    let finalClassification = classified.classification;
    let ready = false;
    let definitionClassification = classified.classification;
    let explainFailReason = null;

    if (classified.classification === CLASSIFICATION.ABSENT) {
      exitCode = EXIT.ABSENT_ELIGIBLE;
      ready = false;
    } else if (classified.classification === CLASSIFICATION.MATCH) {
      // Definition match alone is not readiness — hinted explain must prove the plan.
      try {
        const getNow =
          typeof runtime.getNow === 'function' ? runtime.getNow : () => new Date();
        if (typeof runtime.explain === 'function') {
          explain = await runtime.explain(collection, getNow());
        } else {
          explain = await runReleasedCleanupExplain(collection, getNow());
        }

        const assessment =
          explain && explain.assessment
            ? explain.assessment
            : explain && explain.stats
              ? assessHintedExplain({
                  queryPlanner: {
                    winningPlan: {
                      stage: 'IXSCAN',
                      indexName:
                        explain.stats.winningIndexName ||
                        (explain.stats.usesRequiredIndex ? REQUIRED_INDEX_NAME : null)
                    }
                  },
                  executionStats: {
                    nReturned: explain.stats.nReturned,
                    totalKeysExamined: explain.stats.keysExamined,
                    totalDocsExamined: explain.stats.docsExamined,
                    executionTimeMillis: explain.stats.executionTimeMillis
                  }
                })
              : { ok: false, reason: 'EXPLAIN_MISSING_RESULT', stats: extractExplainStats(null) };

        // Prefer explicit assessment from runReleasedCleanupExplain; for injected explain,
        // require usesRequiredIndex + finite metrics + hint name when provided.
        let explainOk = false;
        if (explain && explain.assessment) {
          explainOk = assessment.ok === true;
          if (!explainOk) explainFailReason = assessment.reason || 'EXPLAIN_FAILED';
        } else if (explain && explain.stats) {
          const s = explain.stats;
          const hintOk =
            explain.hint == null || explain.hint === REQUIRED_INDEX_NAME;
          const metricsOk =
            isNonNegativeInteger(s.nReturned) &&
            isNonNegativeInteger(s.keysExamined) &&
            isNonNegativeInteger(s.docsExamined) &&
            isNonNegativeFiniteNumber(s.executionTimeMillis);
          const planOk =
            s.usesRequiredIndex === true &&
            (!Array.isArray(s.ixscanIndexNames) ||
              (s.ixscanIndexNames.length >= 1 &&
                s.ixscanIndexNames.every((n) => n === REQUIRED_INDEX_NAME)));
          if (hintOk && metricsOk && planOk) {
            explainOk = true;
          } else if (!hintOk) {
            explainFailReason = 'EXPLAIN_HINT_FAILED';
          } else if (!planOk) {
            explainFailReason =
              Array.isArray(s.ixscanIndexNames) && s.ixscanIndexNames.length === 0
                ? 'EXPLAIN_NO_IXSCAN'
                : s.usesRequiredIndex === false
                  ? 'EXPLAIN_FOREIGN_IXSCAN'
                  : 'EXPLAIN_REQUIRED_INDEX_ABSENT';
          } else {
            explainFailReason = 'EXPLAIN_MALFORMED_METRICS';
          }
        } else {
          explainFailReason = 'EXPLAIN_MISSING_RESULT';
        }

        if (explainOk) {
          finalClassification = CLASSIFICATION.MATCH;
          ready = true;
          exitCode = EXIT.DISABLED_OR_MATCH;
        } else {
          finalClassification = CLASSIFICATION.INSPECTION_FAILED;
          ready = false;
          exitCode = EXIT.CONFLICT_OR_FAILURE;
          if (!explain) explain = {};
          explain.errorCode = explainFailReason || 'EXPLAIN_FAILED';
        }
      } catch (err) {
        finalClassification = CLASSIFICATION.INSPECTION_FAILED;
        ready = false;
        exitCode = EXIT.CONFLICT_OR_FAILURE;
        explainFailReason = safeErrorCode(err);
        explain = {
          errorCode: explainFailReason,
          stats: extractExplainStats(null)
        };
      }
    } else {
      // Conflicts / inspection paths already set classification
      ready = false;
      exitCode = EXIT.CONFLICT_OR_FAILURE;
    }

    const result = {
      ...classified,
      classification: finalClassification,
      definitionClassification,
      ready,
      exitCode,
      connected: true,
      mongoUri: redactUri(env.MONGODB_URI || env.MONGO_URI),
      explain,
      explainFailReason,
      explainUsesRequiredIndex: !!(
        explain &&
        explain.stats &&
        explain.stats.usesRequiredIndex === true &&
        ready
      )
    };

    log('accommodation_lease_index_preflight_result', {
      classification: result.classification,
      definitionClassification: result.definitionClassification,
      exitCode: result.exitCode,
      ready: result.ready,
      collectionName: result.collectionName,
      legacyV1Count: (result.legacyV1Indexes || []).length,
      unrelatedIndexCount: (result.unrelatedIndexNames || []).length,
      explainUsesRequiredIndex: result.explainUsesRequiredIndex,
      explainFailReason: result.explainFailReason,
      winningIndexName:
        explain && explain.stats ? explain.stats.winningIndexName : null,
      inMemorySort: explain && explain.stats ? explain.stats.inMemorySort : null,
      nReturned: explain && explain.stats ? explain.stats.nReturned : null,
      keysExamined: explain && explain.stats ? explain.stats.keysExamined : null,
      docsExamined: explain && explain.stats ? explain.stats.docsExamined : null,
      executionTimeMillis:
        explain && explain.stats ? explain.stats.executionTimeMillis : null
    });

    await disconnectOnce();
    exitFn(exitCode);
    return result;
  } catch (err) {
    const result = {
      classification: CLASSIFICATION.INSPECTION_FAILED,
      ready: false,
      exitCode: EXIT.CONFLICT_OR_FAILURE,
      connected: true,
      reason: 'preflight_failed',
      errorCode: safeErrorCode(err)
    };
    log(
      'accommodation_lease_index_preflight_result',
      {
        classification: result.classification,
        exitCode: result.exitCode,
        reason: result.reason,
        errorCode: result.errorCode
      },
      'error'
    );
    await disconnectOnce();
    exitFn(result.exitCode);
    return result;
  }
}

/**
 * Production entrypoint wiring (still gated by execute flag).
 * Lazy-requires mongoose/model only after execute is enabled.
 */
async function runStandaloneEntrypoint(runtime = {}) {
  const env = runtime.env || process.env;
  if (!isPreflightExecuteEnabled(env)) {
    return runIndexPreflight({ ...runtime, env });
  }

  const mongoose = runtime.mongoose || require('mongoose');
  const { DEFAULT_MONGO_URI } =
    runtime.dbDefaults || require('../config/dbDefaults');
  const AccommodationCheckoutLease =
    runtime.AccommodationCheckoutLease ||
    require('../models/AccommodationCheckoutLease');

  const mongoUri =
    (env.MONGODB_URI && String(env.MONGODB_URI).trim()) ||
    (env.MONGO_URI && String(env.MONGO_URI).trim()) ||
    DEFAULT_MONGO_URI;

  return runIndexPreflight({
    ...runtime,
    env,
    connect:
      runtime.connect ||
      (async () => {
        await mongoose.connect(mongoUri);
      }),
    disconnect:
      runtime.disconnect ||
      (async () => {
        await mongoose.disconnect();
      }),
    resolveCollection:
      runtime.resolveCollection ||
      (async () => {
        const db = mongoose.connection && mongoose.connection.db;
        if (!db) {
          return { ok: false, reason: 'db_unavailable' };
        }
        const name = AccommodationCheckoutLease.collection.collectionName;
        const collections = await db.listCollections({ name }).toArray();
        if (!collections.length) {
          return { ok: false, reason: 'collection_absent', name };
        }
        return {
          ok: true,
          name,
          collection: AccommodationCheckoutLease.collection
        };
      })
  });
}

module.exports = {
  PREFLIGHT_EXECUTE_FLAG,
  PREFLIGHT_ACCEPTED_TRUE,
  REQUIRED_INDEX_NAME,
  LEGACY_V1_INDEX_NAME,
  MODEL_NAME,
  EXPECTED_COLLECTION_NAME,
  REQUIRED_INDEX_KEY_ORDER,
  REQUIRED_INDEX_KEY,
  EXPLAIN_LIMIT,
  CLASSIFICATION,
  EXIT,
  SAFE_ERROR_CODES,
  isPreflightExecuteEnabled,
  indexKeyMatchesRequired,
  classifyIndexes,
  buildEligibleFilter,
  buildExplainSort,
  runReleasedCleanupExplain,
  extractExplainStats,
  assessHintedExplain,
  walkPlanTree,
  resolveWinningPlan,
  safeErrorCode,
  hiddenOptionConflict,
  isNonNegativeFiniteNumber,
  isNonNegativeInteger,
  validateExplainMetrics,
  validateAllExplainMetrics,
  validateShardMetricsList,
  runIndexPreflight,
  runStandaloneEntrypoint,
  summarizeIndex,
  optionsConflict,
  requiredKeyObject
};

if (require.main === module) {
  try {
    require('../config/loadServerEnv').loadServerEnv();
  } catch (_e) {
    try {
      require('dotenv').config();
    } catch (_e2) {
      /* optional */
    }
  }

  runStandaloneEntrypoint().catch((err) => {
    console.error(
      JSON.stringify({
        event: 'accommodation_lease_index_preflight_fatal',
        source: 'accommodation-checkout-lease-index-preflight',
        errorCode: safeErrorCode(err),
        exitCode: EXIT.CONFLICT_OR_FAILURE
      })
    );
    process.exit(EXIT.CONFLICT_OR_FAILURE);
  });
}
