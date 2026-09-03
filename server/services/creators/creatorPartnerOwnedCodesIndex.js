'use strict';

/**
 * Read-only verification that CreatorPartner.referral.ownedCodes has the required
 * unique multikey index. Never creates/drops/syncs indexes.
 */

const CreatorPartner = require('../../models/CreatorPartner');

const OWNED_CODES_INDEX_KEYS = Object.freeze({ 'referral.ownedCodes': 1 });

const ERR = Object.freeze({
  INDEX_MISSING: 'CREATOR_PARTNER_OWNED_CODES_INDEX_MISSING',
  INDEX_WRONG: 'CREATOR_PARTNER_OWNED_CODES_INDEX_WRONG',
  INDEX_LIST_FAILED: 'CREATOR_PARTNER_OWNED_CODES_INDEX_LIST_FAILED'
});

function indexKeysMatch(actual, expected) {
  if (!actual || typeof actual !== 'object' || !expected || typeof expected !== 'object') {
    return false;
  }
  const aKeys = Object.keys(actual);
  const eKeys = Object.keys(expected);
  if (aKeys.length !== eKeys.length) return false;
  for (const k of eKeys) {
    if (actual[k] !== expected[k]) return false;
  }
  return true;
}

function isIncompatibleOwnedCodesIndex(idx) {
  if (!idx || !indexKeysMatch(idx.key, OWNED_CODES_INDEX_KEYS)) return false;
  // Wrong uniqueness, or partial/sparse filters that would weaken cross-partner enforcement.
  if (idx.unique !== true) return true;
  if (idx.sparse === true) return true;
  if (idx.partialFilterExpression != null) return true;
  return false;
}

/**
 * Inspect collection indexes for the required unique ownedCodes index.
 * @param {object} [opts]
 * @param {object} [opts.collection] Mongo collection double (tests)
 * @returns {Promise<{ ok: true, index: object }>}
 */
async function assertCreatorPartnerOwnedCodesUniqueIndex({ collection = null } = {}) {
  const col = collection || CreatorPartner.collection;
  let indexes;
  try {
    indexes = await col.indexes();
  } catch (err) {
    const e = new Error(
      `Unable to list CreatorPartner indexes for ownedCodes readiness: ${err?.message || err}`
    );
    e.code = ERR.INDEX_LIST_FAILED;
    e.cause = err;
    throw e;
  }

  const matching = (indexes || []).filter((idx) => idx && indexKeysMatch(idx.key, OWNED_CODES_INDEX_KEYS));
  if (matching.length === 0) {
    const e = new Error(
      'Required CreatorPartner unique index on referral.ownedCodes is missing. ' +
        'Create it deliberately via scripts/ensureCreatorPartnerOwnedCodesIndex.cjs after a clean ownership audit; ' +
        'do not treat Mongoose autoIndex as readiness proof.'
    );
    e.code = ERR.INDEX_MISSING;
    e.details = {
      expectedKeys: { ...OWNED_CODES_INDEX_KEYS },
      expectedUnique: true,
      foundNames: (indexes || []).map((i) => i?.name).filter(Boolean)
    };
    throw e;
  }

  const uniqueExact = matching.find(
    (idx) =>
      idx.unique === true &&
      idx.sparse !== true &&
      idx.partialFilterExpression == null
  );
  if (!uniqueExact) {
    const bad = matching[0];
    const e = new Error(
      'CreatorPartner referral.ownedCodes index exists but is not the required unique (non-sparse, non-partial) definition'
    );
    e.code = ERR.INDEX_WRONG;
    e.details = {
      expectedKeys: { ...OWNED_CODES_INDEX_KEYS },
      expectedUnique: true,
      foundName: bad?.name,
      foundKeys: bad?.key,
      foundUnique: bad?.unique,
      foundSparse: bad?.sparse,
      foundPartial: bad?.partialFilterExpression || null
    };
    throw e;
  }

  const incompatible = matching.filter(isIncompatibleOwnedCodesIndex);
  if (incompatible.length > 0) {
    const e = new Error(
      'Conflicting incompatible CreatorPartner referral.ownedCodes index definition present'
    );
    e.code = ERR.INDEX_WRONG;
    e.details = {
      expectedKeys: { ...OWNED_CODES_INDEX_KEYS },
      conflicting: incompatible.map((i) => ({
        name: i.name,
        unique: i.unique,
        sparse: i.sparse,
        partialFilterExpression: i.partialFilterExpression || null
      }))
    };
    throw e;
  }

  return { ok: true, index: uniqueExact };
}

/**
 * API boot gate wrapper (verification only).
 */
async function assertCreatorPartnerOwnedCodesIndexBootReady(opts = {}) {
  const processName = opts.processName || 'unknown';
  try {
    const result = await assertCreatorPartnerOwnedCodesUniqueIndex({
      collection: opts.collection || null
    });
    return {
      required: true,
      ok: true,
      processName,
      index: result.index || null
    };
  } catch (err) {
    const bootErr = new Error(
      `CreatorPartner ownedCodes index boot failed for ${processName}: ${err?.message || err}`
    );
    bootErr.code = err?.code || ERR.INDEX_MISSING;
    bootErr.cause = err;
    bootErr.details = err?.details || null;
    throw bootErr;
  }
}

/**
 * Deliberate create of the required unique index (ops script only).
 * Refuses to create when ownership audit reports conflicts.
 * Does not run from API startup.
 */
async function ensureCreatorPartnerOwnedCodesUniqueIndex({
  collection = null,
  auditFn = null,
  createIndexFn = null
} = {}) {
  const { auditCreatorPartnerOwnedCodesConflicts } = require('./creatorPartnerOwnedCodesAudit');
  const audit = auditFn
    ? await auditFn()
    : await auditCreatorPartnerOwnedCodesConflicts();

  if (!audit.safeForUniqueIndex) {
    return {
      ok: false,
      created: false,
      reason: 'ownership_conflicts',
      audit,
      index: null
    };
  }

  const col = collection || CreatorPartner.collection;

  // If already correct, do not recreate.
  try {
    const existing = await assertCreatorPartnerOwnedCodesUniqueIndex({ collection: col });
    return {
      ok: true,
      created: false,
      alreadyPresent: true,
      audit,
      index: existing.index
    };
  } catch (err) {
    if (err?.code !== ERR.INDEX_MISSING && err?.code !== ERR.INDEX_WRONG) {
      throw err;
    }
    // INDEX_WRONG: refuse to auto-fix incompatible definitions.
    if (err?.code === ERR.INDEX_WRONG) {
      return {
        ok: false,
        created: false,
        reason: 'incompatible_existing_index',
        error: err,
        audit,
        index: null
      };
    }
  }

  const create =
    createIndexFn ||
    ((keys, options) => col.createIndex(keys, options));

  const name = await create({ ...OWNED_CODES_INDEX_KEYS }, { unique: true, name: 'referral.ownedCodes_1' });

  const verified = await assertCreatorPartnerOwnedCodesUniqueIndex({ collection: col });
  return {
    ok: true,
    created: true,
    alreadyPresent: false,
    indexName: name,
    audit,
    index: verified.index
  };
}

module.exports = {
  OWNED_CODES_INDEX_KEYS,
  ERR,
  indexKeysMatch,
  assertCreatorPartnerOwnedCodesUniqueIndex,
  assertCreatorPartnerOwnedCodesIndexBootReady,
  ensureCreatorPartnerOwnedCodesUniqueIndex
};
