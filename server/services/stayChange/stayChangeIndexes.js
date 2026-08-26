'use strict';

/**
 * StayChange R1 index helpers (fail-closed for NEW operations).
 * Cutover CLI remains the only mutator of production indexes.
 */

const StayChange = require('../../models/StayChange');
const AuditEvent = require('../../models/AuditEvent');
const { IDEMPOTENCY_UNIQUE_INDEX_SPEC } = require('../../models/StayChange');
const {
  AUDIT_DEDUPE_INDEX_SPEC,
  AUDIT_DEDUPE_LEGACY_SPARSE_SHAPE
} = require('../../models/AuditEvent');

function deepEqualJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function indexExact(indexes, spec) {
  const name = spec.options.name;
  const found = indexes.find((i) => i.name === name);
  if (!found) return { present: false, exact: false, found: null };
  const keys = found.key || found.keys || {};
  const keyExact =
    Object.keys(spec.keys).length === Object.keys(keys).length &&
    Object.keys(spec.keys).every((k) => keys[k] === spec.keys[k]);
  const uniqueExact = found.unique === true;

  let sparseOk = true;
  if (Object.prototype.hasOwnProperty.call(spec.options, 'sparse')) {
    sparseOk = Boolean(found.sparse) === Boolean(spec.options.sparse);
  }

  const partialExpected = spec.options.partialFilterExpression;
  let partialOk = true;
  if (partialExpected != null) {
    partialOk = deepEqualJson(found.partialFilterExpression || null, partialExpected);
  } else if (found.partialFilterExpression != null) {
    partialOk = false;
  }

  return {
    present: true,
    exact: keyExact && uniqueExact && sparseOk && partialOk,
    found
  };
}

/**
 * Classify AuditEvent dedupe index for cutover diagnostics.
 * @returns {'missing'|'desired_partial'|'legacy_sparse_unique'|'legacy_nonpartial_unique'|'unexpected'}
 */
function classifyAuditDedupeIndex(indexes) {
  const name = AUDIT_DEDUPE_INDEX_SPEC.options.name;
  const found = indexes.find((i) => i.name === name);
  if (!found) return { kind: 'missing', found: null };
  const desired = indexExact(indexes, AUDIT_DEDUPE_INDEX_SPEC);
  if (desired.exact) return { kind: 'desired_partial', found };
  const keys = found.key || {};
  const keyOk = keys.dedupeKey === 1 && Object.keys(keys).length === 1;
  if (keyOk && found.unique === true && found.sparse === true && !found.partialFilterExpression) {
    return { kind: 'legacy_sparse_unique', found };
  }
  if (keyOk && found.unique === true && !found.sparse && !found.partialFilterExpression) {
    return { kind: 'legacy_nonpartial_unique', found };
  }
  return { kind: 'unexpected', found };
}

async function assertStayChangeIdempotencyIndex() {
  const indexes = await StayChange.collection.indexes();
  const exact = indexExact(indexes, IDEMPOTENCY_UNIQUE_INDEX_SPEC);
  if (!exact.exact) {
    const err = new Error('StayChange R1 idempotency unique index is missing or inexact');
    err.code = 'STAY_CHANGE_IDEMPOTENCY_INDEX_MISSING';
    err.details = { spec: IDEMPOTENCY_UNIQUE_INDEX_SPEC, present: exact.present };
    throw err;
  }
  return { ok: true };
}

async function dropIndexIfExists(collection, name) {
  const indexes = await collection.indexes();
  if (indexes.some((i) => i.name === name)) {
    await collection.dropIndex(name);
  }
}

async function ensureR1IndexesForTests() {
  await StayChange.collection.createIndex(IDEMPOTENCY_UNIQUE_INDEX_SPEC.keys, {
    ...IDEMPOTENCY_UNIQUE_INDEX_SPEC.options
  });

  const auditIndexes = await AuditEvent.collection.indexes();
  const auditExact = indexExact(auditIndexes, AUDIT_DEDUPE_INDEX_SPEC);
  if (!auditExact.exact) {
    await dropIndexIfExists(
      AuditEvent.collection,
      AUDIT_DEDUPE_INDEX_SPEC.options.name
    );
    await AuditEvent.collection.createIndex(AUDIT_DEDUPE_INDEX_SPEC.keys, {
      ...AUDIT_DEDUPE_INDEX_SPEC.options
    });
  }
}

module.exports = {
  indexExact,
  classifyAuditDedupeIndex,
  assertStayChangeIdempotencyIndex,
  ensureR1IndexesForTests,
  dropIndexIfExists,
  IDEMPOTENCY_UNIQUE_INDEX_SPEC,
  AUDIT_DEDUPE_INDEX_SPEC,
  AUDIT_DEDUPE_LEGACY_SPARSE_SHAPE
};
