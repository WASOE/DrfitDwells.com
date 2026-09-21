#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * B8F6A — Read-only production preflight for every required B8 resource-lease
 * index on AccommodationCheckoutLease, CheckoutResourceAttempt, and
 * FacilityReservation.
 *
 * Does not create, modify, rename, rebuild, hide, or drop indexes.
 * Does not enable CHECKOUT_RESOURCE_LEASE_ENABLED or mutate documents.
 * Does not require or initialize Mongoose models (Correction 1).
 * Standalone path disables autoIndex/autoCreate then inspects native collections.
 *
 * Execution flag (exact accepted true value = "1"):
 *   CHECKOUT_RESOURCE_LEASE_PRODUCTION_INDEX_PREFLIGHT_EXECUTE
 *
 * Importing this module has no Mongo connection or query side effects.
 */
'use strict';

const PREFLIGHT_EXECUTE_FLAG =
  'CHECKOUT_RESOURCE_LEASE_PRODUCTION_INDEX_PREFLIGHT_EXECUTE';
const PREFLIGHT_ACCEPTED_TRUE = '1';

const CLASSIFICATION = Object.freeze({
  MATCH: 'MATCH',
  ABSENT: 'ABSENT',
  NAME_CONFLICT: 'NAME_CONFLICT',
  KEY_CONFLICT: 'KEY_CONFLICT',
  OPTION_CONFLICT: 'OPTION_CONFLICT',
  COLLECTION_ABSENT: 'COLLECTION_ABSENT',
  DUPLICATE_BLOCKER: 'DUPLICATE_BLOCKER',
  INSPECTION_FAILED: 'INSPECTION_FAILED',
  DISABLED: 'DISABLED'
});

const EXIT = Object.freeze({
  DISABLED_OR_MATCH: 0,
  ABSENT_ELIGIBLE: 2,
  CONFLICT_OR_FAILURE: 78
});

const COMPARE_OPTION_KEYS = Object.freeze([
  'unique',
  'sparse',
  'expireAfterSeconds',
  'partialFilterExpression',
  'collation',
  'hidden'
]);

const SAFE_ERROR_CODES = Object.freeze([
  'INDEX_LIST_FAILED',
  'INDEX_LIST_UNAVAILABLE',
  'PREFLIGHT_RESOLVE_REQUIRED',
  'PREFLIGHT_FAILED',
  'COLLECTION_ABSENT',
  'DUPLICATE_PROBE_FAILED',
  'ENUM',
  'MONGO_DOWN',
  'INDEX_PREFLIGHT_UNEXPECTED'
]);

/**
 * Complete required inventory for public resource-lease gate readiness.
 * Names match model explicit names or Mongoose default key-direction names.
 * Cleanup v2 is included so readiness reflects the full lease collection contract
 * (already MATCH in production after B8F5G; still verified here).
 */
const REQUIRED_INDEX_SPECS = Object.freeze([
  // --- AccommodationCheckoutLease ---
  Object.freeze({
    id: 'lease_leaseId_unique',
    modelName: 'AccommodationCheckoutLease',
    collectionName: 'accommodationcheckoutleases',
    name: 'leaseId_1',
    keyOrder: Object.freeze([Object.freeze(['leaseId', 1])]),
    options: Object.freeze({ unique: true }),
    severity: 'critical',
    duplicateGroupFields: Object.freeze(['leaseId'])
  }),
  Object.freeze({
    id: 'lease_checkoutId_generation_unique',
    modelName: 'AccommodationCheckoutLease',
    collectionName: 'accommodationcheckoutleases',
    name: 'checkoutId_1_generation_1',
    keyOrder: Object.freeze([
      Object.freeze(['checkoutId', 1]),
      Object.freeze(['generation', 1])
    ]),
    options: Object.freeze({ unique: true }),
    severity: 'critical',
    duplicateGroupFields: Object.freeze(['checkoutId', 'generation'])
  }),
  Object.freeze({
    id: 'lease_checkoutId_live_unique',
    modelName: 'AccommodationCheckoutLease',
    collectionName: 'accommodationcheckoutleases',
    name: 'accommodationCheckoutLease_checkoutId_live_unique',
    keyOrder: Object.freeze([Object.freeze(['checkoutId', 1])]),
    options: Object.freeze({
      unique: true,
      partialFilterExpression: Object.freeze({ isLive: true })
    }),
    severity: 'critical',
    duplicateGroupFields: Object.freeze(['checkoutId']),
    duplicateMatch: Object.freeze({ isLive: true })
  }),
  Object.freeze({
    id: 'lease_expiresAt',
    modelName: 'AccommodationCheckoutLease',
    collectionName: 'accommodationcheckoutleases',
    name: 'expiresAt_1',
    keyOrder: Object.freeze([Object.freeze(['expiresAt', 1])]),
    options: Object.freeze({}),
    severity: 'performance'
  }),
  Object.freeze({
    id: 'lease_conversionBookingId',
    modelName: 'AccommodationCheckoutLease',
    collectionName: 'accommodationcheckoutleases',
    name: 'conversionBookingId_1',
    keyOrder: Object.freeze([Object.freeze(['conversionBookingId', 1])]),
    options: Object.freeze({}),
    severity: 'performance'
  }),
  Object.freeze({
    id: 'lease_released_cleanup_v2',
    modelName: 'AccommodationCheckoutLease',
    collectionName: 'accommodationcheckoutleases',
    name: 'accommodationCheckoutLease_released_cleanup_v2',
    keyOrder: Object.freeze([
      Object.freeze(['status', 1]),
      Object.freeze(['isLive', 1]),
      Object.freeze(['checkoutClaimCleanupStatus', 1]),
      Object.freeze(['checkoutClaimCleanupNextAttemptAt', 1]),
      Object.freeze(['leaseId', 1])
    ]),
    options: Object.freeze({}),
    severity: 'cleanup'
  }),
  // --- CheckoutResourceAttempt ---
  Object.freeze({
    id: 'attempt_attemptId_unique',
    modelName: 'CheckoutResourceAttempt',
    collectionName: 'checkoutresourceattempts',
    name: 'attemptId_1',
    keyOrder: Object.freeze([Object.freeze(['attemptId', 1])]),
    options: Object.freeze({ unique: true }),
    severity: 'critical',
    duplicateGroupFields: Object.freeze(['attemptId'])
  }),
  Object.freeze({
    id: 'attempt_checkoutId_generation_unique',
    modelName: 'CheckoutResourceAttempt',
    collectionName: 'checkoutresourceattempts',
    name: 'checkoutId_1_generation_1',
    keyOrder: Object.freeze([
      Object.freeze(['checkoutId', 1]),
      Object.freeze(['generation', 1])
    ]),
    options: Object.freeze({ unique: true }),
    severity: 'critical',
    duplicateGroupFields: Object.freeze(['checkoutId', 'generation'])
  }),
  Object.freeze({
    id: 'attempt_checkoutId_live_unique',
    modelName: 'CheckoutResourceAttempt',
    collectionName: 'checkoutresourceattempts',
    name: 'checkoutResourceAttempt_checkoutId_live_unique',
    keyOrder: Object.freeze([Object.freeze(['checkoutId', 1])]),
    options: Object.freeze({
      unique: true,
      partialFilterExpression: Object.freeze({ isLive: true })
    }),
    severity: 'critical',
    duplicateGroupFields: Object.freeze(['checkoutId']),
    duplicateMatch: Object.freeze({ isLive: true })
  }),
  Object.freeze({
    id: 'attempt_status_bundleValidUntil',
    modelName: 'CheckoutResourceAttempt',
    collectionName: 'checkoutresourceattempts',
    name: 'status_1_bundleValidUntil_1',
    keyOrder: Object.freeze([
      Object.freeze(['status', 1]),
      Object.freeze(['bundleValidUntil', 1])
    ]),
    options: Object.freeze({}),
    severity: 'performance'
  }),
  Object.freeze({
    id: 'attempt_checkoutId_generation_desc',
    modelName: 'CheckoutResourceAttempt',
    collectionName: 'checkoutresourceattempts',
    name: 'checkoutId_1_generation_-1',
    keyOrder: Object.freeze([
      Object.freeze(['checkoutId', 1]),
      Object.freeze(['generation', -1])
    ]),
    options: Object.freeze({}),
    severity: 'performance'
  }),
  // --- FacilityReservation ---
  // Path-level index:true lookup indexes (non-unique performance).
  Object.freeze({
    id: 'facility_facilityCode',
    modelName: 'FacilityReservation',
    collectionName: 'facilityreservations',
    name: 'facilityCode_1',
    keyOrder: Object.freeze([Object.freeze(['facilityCode', 1])]),
    options: Object.freeze({}),
    severity: 'performance'
  }),
  Object.freeze({
    id: 'facility_status',
    modelName: 'FacilityReservation',
    collectionName: 'facilityreservations',
    name: 'status_1',
    keyOrder: Object.freeze([Object.freeze(['status', 1])]),
    options: Object.freeze({}),
    severity: 'performance'
  }),
  Object.freeze({
    id: 'facility_checkoutSessionId',
    modelName: 'FacilityReservation',
    collectionName: 'facilityreservations',
    name: 'checkoutSessionId_1',
    keyOrder: Object.freeze([Object.freeze(['checkoutSessionId', 1])]),
    options: Object.freeze({}),
    severity: 'performance'
  }),
  Object.freeze({
    id: 'facility_slot_lane_unique',
    modelName: 'FacilityReservation',
    collectionName: 'facilityreservations',
    name: 'facilityReservation_facility_slot_lane_unique',
    keyOrder: Object.freeze([
      Object.freeze(['facilityCode', 1]),
      Object.freeze(['slotStart', 1]),
      Object.freeze(['capacityLane', 1])
    ]),
    options: Object.freeze({ unique: true }),
    severity: 'critical',
    duplicateGroupFields: Object.freeze([
      'facilityCode',
      'slotStart',
      'capacityLane'
    ])
  }),
  Object.freeze({
    id: 'facility_code_start_end_status',
    modelName: 'FacilityReservation',
    collectionName: 'facilityreservations',
    name: 'facilityCode_1_startTime_1_endTime_1_status_1',
    keyOrder: Object.freeze([
      Object.freeze(['facilityCode', 1]),
      Object.freeze(['startTime', 1]),
      Object.freeze(['endTime', 1]),
      Object.freeze(['status', 1])
    ]),
    options: Object.freeze({}),
    severity: 'performance'
  }),
  Object.freeze({
    id: 'facility_holdExpiresAt_sparse',
    modelName: 'FacilityReservation',
    collectionName: 'facilityreservations',
    name: 'holdExpiresAt_1',
    keyOrder: Object.freeze([Object.freeze(['holdExpiresAt', 1])]),
    options: Object.freeze({ sparse: true }),
    severity: 'performance'
  }),
  Object.freeze({
    id: 'facility_checkoutSessionId_status',
    modelName: 'FacilityReservation',
    collectionName: 'facilityreservations',
    name: 'checkoutSessionId_1_status_1',
    keyOrder: Object.freeze([
      Object.freeze(['checkoutSessionId', 1]),
      Object.freeze(['status', 1])
    ]),
    options: Object.freeze({}),
    severity: 'performance'
  }),
  Object.freeze({
    id: 'facility_status_holdExpiresAt',
    modelName: 'FacilityReservation',
    collectionName: 'facilityreservations',
    name: 'status_1_holdExpiresAt_1',
    keyOrder: Object.freeze([
      Object.freeze(['status', 1]),
      Object.freeze(['holdExpiresAt', 1])
    ]),
    options: Object.freeze({}),
    severity: 'performance'
  }),
  Object.freeze({
    id: 'facility_bookingId',
    modelName: 'FacilityReservation',
    collectionName: 'facilityreservations',
    name: 'bookingId_1',
    keyOrder: Object.freeze([Object.freeze(['bookingId', 1])]),
    options: Object.freeze({}),
    severity: 'performance'
  }),
  Object.freeze({
    id: 'facility_code_slot_status',
    modelName: 'FacilityReservation',
    collectionName: 'facilityreservations',
    name: 'facilityCode_1_slotStart_1_status_1',
    keyOrder: Object.freeze([
      Object.freeze(['facilityCode', 1]),
      Object.freeze(['slotStart', 1]),
      Object.freeze(['status', 1])
    ]),
    options: Object.freeze({}),
    severity: 'performance'
  }),
  Object.freeze({
    id: 'facility_acquisitionAttemptId_sparse',
    modelName: 'FacilityReservation',
    collectionName: 'facilityreservations',
    name: 'facilityReservation_acquisitionAttemptId_sparse',
    keyOrder: Object.freeze([Object.freeze(['acquisitionAttemptId', 1])]),
    options: Object.freeze({ sparse: true }),
    severity: 'performance'
  })
]);

const REQUIRED_COLLECTIONS = Object.freeze([
  Object.freeze({
    modelName: 'AccommodationCheckoutLease',
    collectionName: 'accommodationcheckoutleases'
  }),
  Object.freeze({
    modelName: 'CheckoutResourceAttempt',
    collectionName: 'checkoutresourceattempts'
  }),
  Object.freeze({
    modelName: 'FacilityReservation',
    collectionName: 'facilityreservations'
  })
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

function requiredKeyObject(spec) {
  return Object.fromEntries(spec.keyOrder);
}

function indexKeyMatchesSpec(indexKey, spec) {
  if (!indexKey || typeof indexKey !== 'object') return false;
  const keys = Object.keys(indexKey);
  if (keys.length !== spec.keyOrder.length) return false;
  for (let i = 0; i < spec.keyOrder.length; i += 1) {
    const [name, direction] = spec.keyOrder[i];
    if (keys[i] !== name) return false;
    if (Number(indexKey[name]) !== direction) return false;
  }
  return true;
}

function stableStringify(value) {
  if (value === undefined) return '"__undefined__"';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
    .join(',')}}`;
}

function deepEqualJson(a, b) {
  return stableStringify(a) === stableStringify(b);
}

/**
 * Strict hidden typing: only missing property or exact boolean false is acceptable.
 */
function hiddenOptionConflict(indexDoc) {
  if (!indexDoc || typeof indexDoc !== 'object') return null;
  if (!Object.prototype.hasOwnProperty.call(indexDoc, 'hidden')) return null;
  const value = indexDoc.hidden;
  if (value === false) return null;
  if (value === true) return { option: 'hidden', actual: true };
  return { option: 'hidden', actual: 'malformed' };
}

function normalizeBoolOption(value) {
  if (value === true) return true;
  if (value === false) return false;
  if (value == null) return { malformed: true, rawType: typeof value };
  return { malformed: true, rawType: typeof value };
}

/**
 * Compare listed index options against the required spec.
 * Required unique/sparse/partial must match; unexpected extras conflict.
 */
function optionsConflictAgainstSpec(indexDoc, spec) {
  const conflicts = [];
  const required = (spec && spec.options) || {};
  const hiddenConflict = hiddenOptionConflict(indexDoc);
  if (hiddenConflict) conflicts.push(hiddenConflict);

  for (const key of COMPARE_OPTION_KEYS) {
    if (key === 'hidden') continue;
    const requiredHas = Object.prototype.hasOwnProperty.call(required, key);
    const actualHas = Object.prototype.hasOwnProperty.call(indexDoc, key);

    if (requiredHas) {
      const expected = required[key];
      if (!actualHas) {
        conflicts.push({ option: key, actual: 'missing', expected });
        continue;
      }
      const actual = indexDoc[key];
      if (key === 'unique' || key === 'sparse') {
        const norm = normalizeBoolOption(actual);
        if (norm && typeof norm === 'object' && norm.malformed === true) {
          conflicts.push({ option: key, actual: 'malformed' });
        } else if (norm !== expected) {
          conflicts.push({ option: key, actual: norm, expected });
        }
        continue;
      }
      if (key === 'partialFilterExpression' || key === 'collation') {
        if (!deepEqualJson(actual, expected)) {
          conflicts.push({ option: key, actual, expected });
        }
        continue;
      }
      if (actual !== expected) {
        conflicts.push({ option: key, actual, expected });
      }
      continue;
    }

    // Not required — presence of truthy / material options conflicts.
    if (!actualHas) continue;
    if (key === 'unique' || key === 'sparse') {
      const norm = normalizeBoolOption(indexDoc[key]);
      if (norm && typeof norm === 'object' && norm.malformed === true) {
        conflicts.push({ option: key, actual: 'malformed' });
      } else if (norm === true) {
        conflicts.push({ option: key, actual: true });
      }
      continue;
    }
    if (key === 'partialFilterExpression' || key === 'collation') {
      conflicts.push({ option: key, actual: indexDoc[key] });
      continue;
    }
    if (typeof indexDoc[key] === 'number' || indexDoc[key] === true) {
      conflicts.push({ option: key, actual: indexDoc[key] });
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

/**
 * Classify one required index against a listed index set.
 */
function classifyRequiredIndex(indexes, spec) {
  const list = Array.isArray(indexes) ? indexes.filter(Boolean) : [];
  const byName = list.find((ix) => ix && ix.name === spec.name);
  const keyMatches = list.filter((ix) => ix && indexKeyMatchesSpec(ix.key, spec));

  const base = {
    id: spec.id,
    requiredIndexName: spec.name,
    requiredKey: requiredKeyObject(spec),
    requiredOptions: { ...(spec.options || {}) },
    modelName: spec.modelName,
    collectionName: spec.collectionName,
    severity: spec.severity
  };

  if (byName) {
    if (!indexKeyMatchesSpec(byName.key, spec)) {
      return {
        ...base,
        classification: CLASSIFICATION.NAME_CONFLICT,
        ready: false,
        matchedIndex: null,
        conflictingIndex: summarizeIndex(byName),
        reason: 'required_name_present_with_wrong_key'
      };
    }
    const optConflicts = optionsConflictAgainstSpec(byName, spec);
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

  const otherKeyMatch = keyMatches.find((ix) => ix.name !== spec.name);
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
    reason: 'required_index_absent'
  };
}

function classifyAllIndexes(indexesByCollection) {
  return REQUIRED_INDEX_SPECS.map((spec) => {
    const entry = indexesByCollection[spec.collectionName];
    if (!entry) {
      return {
        id: spec.id,
        requiredIndexName: spec.name,
        requiredKey: requiredKeyObject(spec),
        requiredOptions: { ...(spec.options || {}) },
        modelName: spec.modelName,
        collectionName: spec.collectionName,
        severity: spec.severity,
        classification: CLASSIFICATION.INSPECTION_FAILED,
        ready: false,
        reason: 'collection_entry_missing'
      };
    }
    if (entry.absent === true) {
      return {
        id: spec.id,
        requiredIndexName: spec.name,
        requiredKey: requiredKeyObject(spec),
        requiredOptions: { ...(spec.options || {}) },
        modelName: spec.modelName,
        collectionName: spec.collectionName,
        severity: spec.severity,
        classification: CLASSIFICATION.COLLECTION_ABSENT,
        ready: false,
        matchedIndex: null,
        conflictingIndex: null,
        reason: 'collection_absent'
      };
    }
    if (entry.errorCode) {
      return {
        id: spec.id,
        requiredIndexName: spec.name,
        requiredKey: requiredKeyObject(spec),
        requiredOptions: { ...(spec.options || {}) },
        modelName: spec.modelName,
        collectionName: spec.collectionName,
        severity: spec.severity,
        classification: CLASSIFICATION.INSPECTION_FAILED,
        ready: false,
        reason: 'index_list_failed',
        errorCode: entry.errorCode
      };
    }
    return classifyRequiredIndex(entry.indexes || [], spec);
  });
}

function redactUri(uri) {
  if (uri == null || uri === '') return null;
  return '[redacted]';
}

/**
 * Build a duplicate-counting aggregation pipeline (field names only; no values logged).
 */
function buildDuplicateProbePipeline(spec) {
  const fields = spec.duplicateGroupFields;
  if (!fields || !fields.length) return null;
  const idExpr = {};
  for (const field of fields) {
    idExpr[field] = `$${field}`;
  }
  const match =
    spec.duplicateMatch && typeof spec.duplicateMatch === 'object'
      ? { ...spec.duplicateMatch }
      : null;
  const pipeline = [];
  if (match) pipeline.push({ $match: match });
  pipeline.push({ $group: { _id: idExpr, count: { $sum: 1 } } });
  pipeline.push({ $match: { count: { $gt: 1 } } });
  pipeline.push({ $count: 'duplicateGroups' });
  return pipeline;
}

/**
 * Aggregate overall exit / readiness from per-index results and duplicate probes.
 *
 * COLLECTION_ABSENT is treated as creation-eligible (exit 2) for attempt/facility
 * collections that are expected to be created by authorized createIndex later.
 * Conflict / inspection / duplicate-blocker → exit 78.
 */
function aggregatePreflight(indexResults, duplicateResults = []) {
  const results = Array.isArray(indexResults) ? indexResults : [];
  const dups = Array.isArray(duplicateResults) ? duplicateResults : [];

  const conflictClasses = new Set([
    CLASSIFICATION.NAME_CONFLICT,
    CLASSIFICATION.KEY_CONFLICT,
    CLASSIFICATION.OPTION_CONFLICT,
    CLASSIFICATION.INSPECTION_FAILED,
    CLASSIFICATION.DUPLICATE_BLOCKER
  ]);

  let hasConflict = false;
  let hasAbsent = false;
  let hasCollectionAbsent = false;
  let allMatch = results.length > 0;

  for (const r of results) {
    const c = r && r.classification;
    if (conflictClasses.has(c)) {
      hasConflict = true;
      allMatch = false;
    } else if (c === CLASSIFICATION.ABSENT) {
      hasAbsent = true;
      allMatch = false;
    } else if (c === CLASSIFICATION.COLLECTION_ABSENT) {
      hasCollectionAbsent = true;
      allMatch = false;
    } else if (c !== CLASSIFICATION.MATCH) {
      hasConflict = true;
      allMatch = false;
    }
  }

  const blockingDups = dups.filter(
    (d) => d && d.duplicateGroupCount != null && d.duplicateGroupCount > 0
  );
  if (blockingDups.length > 0) {
    hasConflict = true;
    allMatch = false;
  }

  const dupProbeFailures = dups.filter((d) => d && d.errorCode);
  if (dupProbeFailures.length > 0) {
    hasConflict = true;
    allMatch = false;
  }

  let exitCode = EXIT.CONFLICT_OR_FAILURE;
  let classification = CLASSIFICATION.INSPECTION_FAILED;
  let ready = false;

  if (hasConflict) {
    exitCode = EXIT.CONFLICT_OR_FAILURE;
    if (blockingDups.length > 0) classification = CLASSIFICATION.DUPLICATE_BLOCKER;
    else if (
      results.some((r) => r && conflictClasses.has(r.classification) &&
        r.classification !== CLASSIFICATION.INSPECTION_FAILED &&
        r.classification !== CLASSIFICATION.DUPLICATE_BLOCKER)
    ) {
      const first = results.find(
        (r) =>
          r &&
          (r.classification === CLASSIFICATION.NAME_CONFLICT ||
            r.classification === CLASSIFICATION.KEY_CONFLICT ||
            r.classification === CLASSIFICATION.OPTION_CONFLICT)
      );
      classification = first
        ? first.classification
        : CLASSIFICATION.INSPECTION_FAILED;
    } else {
      classification = CLASSIFICATION.INSPECTION_FAILED;
    }
    ready = false;
  } else if (hasAbsent || hasCollectionAbsent) {
    exitCode = EXIT.ABSENT_ELIGIBLE;
    classification = hasAbsent
      ? CLASSIFICATION.ABSENT
      : CLASSIFICATION.COLLECTION_ABSENT;
    ready = false;
  } else if (allMatch) {
    exitCode = EXIT.DISABLED_OR_MATCH;
    classification = CLASSIFICATION.MATCH;
    ready = true;
  }

  const counts = {
    match: results.filter((r) => r.classification === CLASSIFICATION.MATCH).length,
    absent: results.filter((r) => r.classification === CLASSIFICATION.ABSENT).length,
    collectionAbsent: results.filter(
      (r) => r.classification === CLASSIFICATION.COLLECTION_ABSENT
    ).length,
    nameConflict: results.filter(
      (r) => r.classification === CLASSIFICATION.NAME_CONFLICT
    ).length,
    keyConflict: results.filter(
      (r) => r.classification === CLASSIFICATION.KEY_CONFLICT
    ).length,
    optionConflict: results.filter(
      (r) => r.classification === CLASSIFICATION.OPTION_CONFLICT
    ).length,
    inspectionFailed: results.filter(
      (r) => r.classification === CLASSIFICATION.INSPECTION_FAILED
    ).length,
    criticalAbsent: results.filter(
      (r) =>
        r.severity === 'critical' &&
        (r.classification === CLASSIFICATION.ABSENT ||
          r.classification === CLASSIFICATION.COLLECTION_ABSENT)
    ).length,
    total: results.length
  };

  return {
    classification,
    ready,
    exitCode,
    counts,
    blockingDuplicateProbeCount: blockingDups.length
  };
}

/**
 * Core read-only inspection. All Mongo access is injected for tests.
 *
 * @param {object} runtime
 * @param {object} [runtime.env]
 * @param {() => Promise<void>} [runtime.connect]
 * @param {() => Promise<void>} [runtime.disconnect]
 * @param {(collectionName: string) => Promise<{ ok: boolean, name?: string, collection?: object, reason?: string }>} [runtime.resolveCollection]
 * @param {(collection: object, collectionName: string) => Promise<object[]>} [runtime.listIndexes]
 * @param {(collection: object, pipeline: object[], spec: object) => Promise<number>} [runtime.countDuplicateGroups]
 * @param {(event: string, fields?: object, level?: string) => void} [runtime.log]
 * @param {(code: number) => void} [runtime.exit]
 */
async function runProductionIndexPreflight(runtime = {}) {
  const env = runtime.env || process.env;
  const log =
    typeof runtime.log === 'function'
      ? runtime.log
      : (event, fields = {}, level = 'info') => {
          const line = JSON.stringify({
            event,
            source: 'checkout-resource-lease-production-index-preflight',
            ...fields
          });
          if (level === 'error') console.error(line);
          else console.log(line);
        };
  const exitFn =
    typeof runtime.exit === 'function' ? runtime.exit : (code) => process.exit(code);

  if (!isPreflightExecuteEnabled(env)) {
    log('checkout_resource_lease_production_index_preflight_disabled', {
      reason: 'CHECKOUT_RESOURCE_LEASE_PRODUCTION_INDEX_PREFLIGHT_EXECUTE_not_enabled',
      flag: PREFLIGHT_EXECUTE_FLAG
    });
    exitFn(EXIT.DISABLED_OR_MATCH);
    return {
      classification: CLASSIFICATION.DISABLED,
      ready: false,
      exitCode: EXIT.DISABLED_OR_MATCH,
      connected: false,
      indexResults: [],
      duplicateResults: []
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

    if (typeof runtime.resolveCollection !== 'function') {
      throw Object.assign(new Error('resolveCollection required when execute enabled'), {
        code: 'PREFLIGHT_RESOLVE_REQUIRED'
      });
    }

    const indexesByCollection = {};
    const collectionSummaries = [];

    for (const coll of REQUIRED_COLLECTIONS) {
      let info;
      try {
        info = await runtime.resolveCollection(coll.collectionName);
      } catch (err) {
        indexesByCollection[coll.collectionName] = {
          errorCode: safeErrorCode(err)
        };
        collectionSummaries.push({
          collectionName: coll.collectionName,
          modelName: coll.modelName,
          present: false,
          reason: 'resolve_failed',
          errorCode: safeErrorCode(err)
        });
        continue;
      }

      if (!info || info.ok !== true) {
        const absent = info && info.reason === 'collection_absent';
        indexesByCollection[coll.collectionName] = absent
          ? { absent: true }
          : { errorCode: 'INDEX_LIST_UNAVAILABLE' };
        collectionSummaries.push({
          collectionName: coll.collectionName,
          modelName: coll.modelName,
          present: false,
          reason: (info && info.reason) || 'collection_resolve_failed'
        });
        continue;
      }

      const collection = info.collection;
      let indexes;
      try {
        if (typeof runtime.listIndexes === 'function') {
          indexes = await runtime.listIndexes(collection, coll.collectionName);
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
        indexesByCollection[coll.collectionName] = {
          errorCode: safeErrorCode(err)
        };
        collectionSummaries.push({
          collectionName: coll.collectionName,
          modelName: coll.modelName,
          present: true,
          reason: 'index_list_failed',
          errorCode: safeErrorCode(err)
        });
        continue;
      }

      indexesByCollection[coll.collectionName] = {
        indexes: Array.isArray(indexes) ? indexes : [],
        listedIndexNames: (Array.isArray(indexes) ? indexes : [])
          .filter(Boolean)
          .map((ix) => (ix.name != null ? String(ix.name) : null))
      };
      collectionSummaries.push({
        collectionName: coll.collectionName,
        modelName: coll.modelName,
        present: true,
        listedIndexCount: (Array.isArray(indexes) ? indexes : []).length
      });
    }

    const indexResults = classifyAllIndexes(indexesByCollection);

    const duplicateResults = [];
    for (const spec of REQUIRED_INDEX_SPECS) {
      if (!spec.duplicateGroupFields || !spec.duplicateGroupFields.length) continue;
      const entry = indexesByCollection[spec.collectionName];
      if (!entry || entry.absent || entry.errorCode) {
        duplicateResults.push({
          id: spec.id,
          collectionName: spec.collectionName,
          skipped: true,
          reason: entry && entry.absent ? 'collection_absent' : 'collection_unavailable'
        });
        continue;
      }

      const collSummary = collectionSummaries.find(
        (c) => c.collectionName === spec.collectionName
      );
      if (!collSummary || !collSummary.present) {
        duplicateResults.push({
          id: spec.id,
          collectionName: spec.collectionName,
          skipped: true,
          reason: 'collection_absent'
        });
        continue;
      }

      // Resolve collection again only via injected probe helper.
      const pipeline = buildDuplicateProbePipeline(spec);
      if (!pipeline) continue;

      try {
        let duplicateGroupCount = 0;
        if (typeof runtime.countDuplicateGroups === 'function') {
          const resolved = await runtime.resolveCollection(spec.collectionName);
          duplicateGroupCount = await runtime.countDuplicateGroups(
            resolved && resolved.collection,
            pipeline,
            spec
          );
        } else {
          const resolved = await runtime.resolveCollection(spec.collectionName);
          const collection = resolved && resolved.collection;
          if (!collection || typeof collection.aggregate !== 'function') {
            throw Object.assign(new Error('aggregate unavailable'), {
              code: 'DUPLICATE_PROBE_FAILED'
            });
          }
          const rows = await collection.aggregate(pipeline).toArray();
          duplicateGroupCount =
            rows && rows[0] && typeof rows[0].duplicateGroups === 'number'
              ? rows[0].duplicateGroups
              : 0;
        }
        if (typeof duplicateGroupCount !== 'number' || !Number.isFinite(duplicateGroupCount)) {
          throw Object.assign(new Error('malformed duplicate count'), {
            code: 'DUPLICATE_PROBE_FAILED'
          });
        }
        duplicateResults.push({
          id: spec.id,
          collectionName: spec.collectionName,
          groupFields: [...spec.duplicateGroupFields],
          duplicateGroupCount,
          blocked: duplicateGroupCount > 0
        });
      } catch (err) {
        duplicateResults.push({
          id: spec.id,
          collectionName: spec.collectionName,
          groupFields: [...spec.duplicateGroupFields],
          errorCode: safeErrorCode(err),
          blocked: true
        });
      }
    }

    // Promote duplicate blockers onto matching index results for visibility.
    for (const dup of duplicateResults) {
      if (!dup || !(dup.blocked || dup.errorCode)) continue;
      const target = indexResults.find((r) => r.id === dup.id);
      if (!target) continue;
      if (target.classification === CLASSIFICATION.MATCH ||
          target.classification === CLASSIFICATION.ABSENT) {
        if (dup.errorCode) {
          target.classification = CLASSIFICATION.INSPECTION_FAILED;
          target.ready = false;
          target.reason = 'duplicate_probe_failed';
          target.errorCode = dup.errorCode;
        } else if (dup.duplicateGroupCount > 0) {
          target.classification = CLASSIFICATION.DUPLICATE_BLOCKER;
          target.ready = false;
          target.reason = 'duplicate_groups_block_unique_index';
          target.duplicateGroupCount = dup.duplicateGroupCount;
        }
      }
    }

    const aggregated = aggregatePreflight(indexResults, duplicateResults);

    const result = {
      ...aggregated,
      connected: true,
      mongoUri: redactUri(env.MONGODB_URI || env.MONGO_URI),
      collections: collectionSummaries,
      indexResults,
      duplicateResults,
      requiredSpecCount: REQUIRED_INDEX_SPECS.length
    };

    log('checkout_resource_lease_production_index_preflight_result', {
      classification: result.classification,
      exitCode: result.exitCode,
      ready: result.ready,
      requiredSpecCount: result.requiredSpecCount,
      counts: result.counts,
      blockingDuplicateProbeCount: result.blockingDuplicateProbeCount,
      collectionsPresent: collectionSummaries.filter((c) => c.present).length,
      collectionsAbsent: collectionSummaries.filter((c) => !c.present).length,
      indexSummaries: indexResults.map((r) => ({
        id: r.id,
        name: r.requiredIndexName,
        collectionName: r.collectionName,
        severity: r.severity,
        classification: r.classification
      })),
      duplicateSummaries: duplicateResults.map((d) => ({
        id: d.id,
        collectionName: d.collectionName,
        duplicateGroupCount:
          d.duplicateGroupCount != null ? d.duplicateGroupCount : null,
        blocked: !!d.blocked,
        skipped: !!d.skipped,
        errorCode: d.errorCode || null
      }))
    });

    await disconnectOnce();
    exitFn(result.exitCode);
    return result;
  } catch (err) {
    const result = {
      classification: CLASSIFICATION.INSPECTION_FAILED,
      ready: false,
      exitCode: EXIT.CONFLICT_OR_FAILURE,
      connected: true,
      reason: 'preflight_failed',
      errorCode: safeErrorCode(err),
      indexResults: [],
      duplicateResults: []
    };
    log(
      'checkout_resource_lease_production_index_preflight_result',
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

/** Exact connect options — automatic index/collection creation must stay off. */
const STANDALONE_CONNECT_OPTIONS = Object.freeze({
  autoIndex: false,
  autoCreate: false
});

/**
 * Disable Mongoose automatic index and collection creation before any connect.
 * Must run before mongoose.connect. Does not register models.
 *
 * @param {object} mongoose
 * @returns {{ autoIndex: false, autoCreate: false }}
 */
function disableMongooseAutoIndexAndAutoCreate(mongoose) {
  if (!mongoose || typeof mongoose.set !== 'function') {
    throw Object.assign(new Error('mongoose.set unavailable'), {
      code: 'PREFLIGHT_FAILED'
    });
  }
  mongoose.set('autoIndex', false);
  mongoose.set('autoCreate', false);
  return { ...STANDALONE_CONNECT_OPTIONS };
}

/**
 * Resolve a required collection via the native driver handle only.
 * Never touches Mongoose models / Model.init / ensureIndexes.
 *
 * @param {object} mongoose
 * @param {string} collectionName
 */
async function resolveNativeCollection(mongoose, collectionName) {
  const db = mongoose && mongoose.connection && mongoose.connection.db;
  if (!db || typeof db.listCollections !== 'function') {
    return { ok: false, reason: 'db_unavailable' };
  }
  const name = String(collectionName);
  const collections = await db.listCollections({ name }).toArray();
  if (!collections.length) {
    return { ok: false, reason: 'collection_absent', name };
  }
  if (typeof db.collection !== 'function') {
    return { ok: false, reason: 'db_unavailable' };
  }
  return {
    ok: true,
    name,
    collection: db.collection(name)
  };
}

/**
 * Production entrypoint wiring (still gated by execute flag).
 *
 * Correction 1 ordering (mandatory):
 *   1. disable autoIndex + autoCreate
 *   2. connect with { autoIndex: false, autoCreate: false }
 *   3. inspect native db.collection(name) only
 *   4. disconnect
 *
 * Does not require AccommodationCheckoutLease, CheckoutResourceAttempt,
 * or FacilityReservation. Specs/collection names are static in this module.
 */
async function runStandaloneEntrypoint(runtime = {}) {
  const env = runtime.env || process.env;
  if (!isPreflightExecuteEnabled(env)) {
    return runProductionIndexPreflight({ ...runtime, env });
  }

  const mongoose = runtime.mongoose || require('mongoose');
  const { DEFAULT_MONGO_URI } =
    runtime.dbDefaults || require('../config/dbDefaults');

  const mongoUri =
    (env.MONGODB_URI && String(env.MONGODB_URI).trim()) ||
    (env.MONGO_URI && String(env.MONGO_URI).trim()) ||
    DEFAULT_MONGO_URI;

  // 1. Disable automatic index/collection creation before connect.
  if (typeof runtime.disableAutoIndexAndAutoCreate === 'function') {
    runtime.disableAutoIndexAndAutoCreate(mongoose);
  } else {
    disableMongooseAutoIndexAndAutoCreate(mongoose);
  }

  return runProductionIndexPreflight({
    ...runtime,
    env,
    connect:
      runtime.connect ||
      (async () => {
        // 2. Connect with explicit autoIndex/autoCreate false.
        await mongoose.connect(mongoUri, {
          autoIndex: false,
          autoCreate: false
        });
      }),
    disconnect:
      runtime.disconnect ||
      (async () => {
        await mongoose.disconnect();
      }),
    resolveCollection:
      runtime.resolveCollection ||
      ((collectionName) => resolveNativeCollection(mongoose, collectionName))
  });
}

module.exports = {
  PREFLIGHT_EXECUTE_FLAG,
  PREFLIGHT_ACCEPTED_TRUE,
  REQUIRED_INDEX_SPECS,
  REQUIRED_COLLECTIONS,
  STANDALONE_CONNECT_OPTIONS,
  CLASSIFICATION,
  EXIT,
  SAFE_ERROR_CODES,
  COMPARE_OPTION_KEYS,
  isPreflightExecuteEnabled,
  indexKeyMatchesSpec,
  classifyRequiredIndex,
  classifyAllIndexes,
  optionsConflictAgainstSpec,
  aggregatePreflight,
  buildDuplicateProbePipeline,
  requiredKeyObject,
  summarizeIndex,
  safeErrorCode,
  hiddenOptionConflict,
  deepEqualJson,
  stableStringify,
  disableMongooseAutoIndexAndAutoCreate,
  resolveNativeCollection,
  runProductionIndexPreflight,
  runStandaloneEntrypoint
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
        event: 'checkout_resource_lease_production_index_preflight_fatal',
        source: 'checkout-resource-lease-production-index-preflight',
        errorCode: safeErrorCode(err),
        exitCode: EXIT.CONFLICT_OR_FAILURE
      })
    );
    process.exit(EXIT.CONFLICT_OR_FAILURE);
  });
}
