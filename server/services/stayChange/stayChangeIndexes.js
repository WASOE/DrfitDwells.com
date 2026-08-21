'use strict';

/**
 * StayChange R1 index helpers (fail-closed for NEW operations).
 * Cutover CLI remains the only mutator of production indexes.
 */

const StayChange = require('../../models/StayChange');
const AuditEvent = require('../../models/AuditEvent');
const { IDEMPOTENCY_UNIQUE_INDEX_SPEC } = require('../../models/StayChange');
const { AUDIT_DEDUPE_INDEX_SPEC } = require('../../models/AuditEvent');

function indexExact(indexes, spec) {
  const name = spec.options.name;
  const found = indexes.find((i) => i.name === name);
  if (!found) return { present: false, exact: false, found: null };
  const keys = found.key || found.keys || {};
  const keyExact =
    Object.keys(spec.keys).length === Object.keys(keys).length &&
    Object.keys(spec.keys).every((k) => keys[k] === spec.keys[k]);
  const uniqueExact = found.unique === true;
  const sparseOk =
    spec.options.sparse == null ? true : Boolean(found.sparse) === Boolean(spec.options.sparse);
  return {
    present: true,
    exact: keyExact && uniqueExact && sparseOk,
    found
  };
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

async function ensureR1IndexesForTests() {
  await StayChange.collection.createIndex(
    IDEMPOTENCY_UNIQUE_INDEX_SPEC.keys,
    { ...IDEMPOTENCY_UNIQUE_INDEX_SPEC.options }
  );
  await AuditEvent.collection.createIndex(
    AUDIT_DEDUPE_INDEX_SPEC.keys,
    { ...AUDIT_DEDUPE_INDEX_SPEC.options }
  );
}

module.exports = {
  indexExact,
  assertStayChangeIdempotencyIndex,
  ensureR1IndexesForTests,
  IDEMPOTENCY_UNIQUE_INDEX_SPEC,
  AUDIT_DEDUPE_INDEX_SPEC
};
