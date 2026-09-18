'use strict';

/**
 * Checkout resource-attempt fence (B8F2A1).
 *
 * Same-checkout orchestration exclusivity. Inventory exclusivity remains
 * UnitNightClaim / CabinNightClaim and FacilityReservation lane uniqueness.
 */
const crypto = require('crypto');
const CheckoutResourceAttempt = require('../../models/CheckoutResourceAttempt');
const {
  AUTHORITATIVE_LIVE_INDEX_SPEC
} = require('../../models/CheckoutResourceAttempt');

const DEFAULT_RESOURCE_BUNDLE_TTL_MS = 30 * 60 * 1000;
const CHECKOUT_ID_PATTERN = /^[A-Za-z0-9:_-]{8,128}$/;

const FENCE_ERROR_CODES = Object.freeze({
  RESOURCE_BUNDLE_IN_PROGRESS: 'RESOURCE_BUNDLE_IN_PROGRESS',
  RESOURCE_BUNDLE_FENCE_LOST: 'RESOURCE_BUNDLE_FENCE_LOST',
  RESOURCE_ATTEMPT_INDEX_MISSING: 'RESOURCE_ATTEMPT_INDEX_MISSING',
  RESOURCE_ATTEMPT_INTEGRITY: 'RESOURCE_ATTEMPT_INTEGRITY',
  RESOURCE_BUNDLE_INVALID_EXPIRY: 'RESOURCE_BUNDLE_INVALID_EXPIRY',
  RESOURCE_BUNDLE_INVALID_INPUT: 'RESOURCE_BUNDLE_INVALID_INPUT',
  RESOURCE_BUNDLE_COMPENSATION_INCOMPLETE: 'RESOURCE_BUNDLE_COMPENSATION_INCOMPLETE',
  RESOURCE_BUNDLE_MARKER_CLEAR_INCOMPLETE: 'RESOURCE_BUNDLE_MARKER_CLEAR_INCOMPLETE'
});

class CheckoutResourceAttemptFenceError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'CheckoutResourceAttemptFenceError';
    this.code = code;
    this.details = details;
  }
}

function getModel(deps = {}) {
  return deps.CheckoutResourceAttempt || CheckoutResourceAttempt;
}

function getNow(deps = {}) {
  if (deps.now != null) {
    const d = deps.now instanceof Date ? deps.now : new Date(deps.now);
    if (Number.isNaN(d.getTime())) {
      throw new CheckoutResourceAttemptFenceError(
        FENCE_ERROR_CODES.RESOURCE_BUNDLE_INVALID_INPUT,
        'Injected now is invalid'
      );
    }
    return d;
  }
  return new Date();
}

function newStrongId(prefix) {
  if (typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${crypto.randomBytes(16).toString('hex')}`;
}

function assertValidCheckoutId(checkoutId) {
  if (checkoutId == null || typeof checkoutId !== 'string') {
    throw new CheckoutResourceAttemptFenceError(
      FENCE_ERROR_CODES.RESOURCE_BUNDLE_INVALID_INPUT,
      'checkoutId must be a string'
    );
  }
  const id = checkoutId.trim();
  if (!id || !CHECKOUT_ID_PATTERN.test(id)) {
    throw new CheckoutResourceAttemptFenceError(
      FENCE_ERROR_CODES.RESOURCE_BUNDLE_INVALID_INPUT,
      'checkoutId format is invalid'
    );
  }
  return id;
}

function assertValidQuoteSnapshotHash(hash) {
  if (hash == null || typeof hash !== 'string' || !hash.trim()) {
    throw new CheckoutResourceAttemptFenceError(
      FENCE_ERROR_CODES.RESOURCE_BUNDLE_INVALID_INPUT,
      'quoteSnapshotHash must be a non-empty string'
    );
  }
  return hash.trim();
}

function resolveBundleValidUntil(input, now) {
  const maxUntil = new Date(now.getTime() + DEFAULT_RESOURCE_BUNDLE_TTL_MS);
  let until;
  if (input.bundleValidUntil != null) {
    until = new Date(input.bundleValidUntil);
    if (Number.isNaN(until.getTime())) {
      throw new CheckoutResourceAttemptFenceError(
        FENCE_ERROR_CODES.RESOURCE_BUNDLE_INVALID_EXPIRY,
        'bundleValidUntil must be a valid Date'
      );
    }
  } else {
    until = maxUntil;
  }
  if (until.getTime() <= now.getTime()) {
    throw new CheckoutResourceAttemptFenceError(
      FENCE_ERROR_CODES.RESOURCE_BUNDLE_INVALID_EXPIRY,
      'bundleValidUntil must be greater than now'
    );
  }
  if (until.getTime() > maxUntil.getTime()) {
    throw new CheckoutResourceAttemptFenceError(
      FENCE_ERROR_CODES.RESOURCE_BUNDLE_INVALID_EXPIRY,
      'bundleValidUntil must not exceed now + DEFAULT_RESOURCE_BUNDLE_TTL_MS'
    );
  }
  return until;
}

function indexKeysMatch(actual, expected) {
  const aKeys = Object.keys(actual || {});
  const eKeys = Object.keys(expected || {});
  if (aKeys.length !== eKeys.length) return false;
  for (const k of eKeys) {
    if (Number(actual[k]) !== Number(expected[k])) return false;
  }
  return true;
}

function partialFilterMatches(actual, expected) {
  if (!actual || !expected) return false;
  try {
    return JSON.stringify(actual) === JSON.stringify(expected);
  } catch {
    return false;
  }
}

/**
 * Fail closed unless the exact partial unique live fence index is present.
 * Does not create or sync production indexes.
 */
async function assertCheckoutResourceAttemptAuthoritativeIndex(deps = {}) {
  const Model = getModel(deps);
  const spec = AUTHORITATIVE_LIVE_INDEX_SPEC;
  let indexes;
  try {
    indexes = await Model.collection.indexes();
  } catch (err) {
    throw new CheckoutResourceAttemptFenceError(
      FENCE_ERROR_CODES.RESOURCE_ATTEMPT_INDEX_MISSING,
      'Unable to list CheckoutResourceAttempt indexes',
      { cause: err?.message || String(err) }
    );
  }

  const match = (indexes || []).find(
    (idx) =>
      idx &&
      idx.unique === true &&
      indexKeysMatch(idx.key, spec.keys) &&
      partialFilterMatches(
        idx.partialFilterExpression,
        spec.options.partialFilterExpression
      )
  );

  if (!match) {
    throw new CheckoutResourceAttemptFenceError(
      FENCE_ERROR_CODES.RESOURCE_ATTEMPT_INDEX_MISSING,
      'Authoritative CheckoutResourceAttempt live unique index is missing or incorrect',
      {
        expectedName: spec.options.name,
        expectedKeys: { ...spec.keys },
        expectedUnique: true,
        expectedPartialFilterExpression: {
          ...spec.options.partialFilterExpression
        },
        foundNames: (indexes || []).map((i) => i.name)
      }
    );
  }
  return { ok: true, index: match };
}

function isDuplicateKeyError(err) {
  if (!err) return false;
  if (err.code === 11000 || err.code === 11001) return true;
  return /E11000|duplicate key/i.test(String(err.message || ''));
}

async function findLiveFence(checkoutId, deps = {}) {
  const Model = getModel(deps);
  return Model.findOne({ checkoutId: String(checkoutId), isLive: true }).lean();
}

async function nextGeneration(checkoutId, deps = {}) {
  const Model = getModel(deps);
  const latest = await Model.findOne({ checkoutId: String(checkoutId) })
    .sort({ generation: -1 })
    .select('generation')
    .lean();
  return latest && latest.generation != null ? Number(latest.generation) + 1 : 1;
}

async function deactivateExpiredLive(live, now, deps = {}) {
  if (!live || !live.isLive) return null;
  if (live.bundleValidUntil && new Date(live.bundleValidUntil).getTime() > now.getTime()) {
    return live;
  }
  const Model = getModel(deps);
  await Model.updateOne(
    {
      checkoutId: live.checkoutId,
      attemptId: live.attemptId,
      isLive: true,
      status: 'open',
      bundleValidUntil: { $lte: now }
    },
    {
      $set: {
        status: 'expired',
        isLive: false
      }
    }
  );
  return null;
}

/**
 * Acquire exclusive live fence for checkoutId.
 */
async function acquireCheckoutResourceAttemptFence(input = {}, deps = {}) {
  await assertCheckoutResourceAttemptAuthoritativeIndex(deps);

  const checkoutId = assertValidCheckoutId(input.checkoutId);
  const quoteSnapshotHash = assertValidQuoteSnapshotHash(input.quoteSnapshotHash);
  const now = getNow(deps);
  const bundleValidUntil = resolveBundleValidUntil(input, now);
  const Model = getModel(deps);

  let live = await findLiveFence(checkoutId, deps);
  if (live) {
    live = await deactivateExpiredLive(live, now, deps);
  }
  if (live) {
    throw new CheckoutResourceAttemptFenceError(
      FENCE_ERROR_CODES.RESOURCE_BUNDLE_IN_PROGRESS,
      'Another resource attempt already owns the live fence for this checkout',
      {
        checkoutId,
        attemptId: live.attemptId,
        generation: live.generation,
        bundleValidUntil: live.bundleValidUntil
      }
    );
  }

  const generation = await nextGeneration(checkoutId, deps);
  const attemptId = newStrongId('cra');

  try {
    const created = await Model.create({
      attemptId,
      checkoutId,
      quoteSnapshotHash,
      generation,
      status: 'open',
      isLive: true,
      startedAt: now,
      bundleValidUntil,
      releasedAt: null,
      failureCode: null
    });
    const doc = created.toObject ? created.toObject() : created;
    return {
      attemptId: doc.attemptId,
      checkoutId: doc.checkoutId,
      quoteSnapshotHash: doc.quoteSnapshotHash,
      generation: doc.generation,
      status: doc.status,
      isLive: doc.isLive,
      startedAt: doc.startedAt,
      bundleValidUntil: doc.bundleValidUntil,
      failureCode: doc.failureCode || null
    };
  } catch (err) {
    if (!isDuplicateKeyError(err)) {
      throw new CheckoutResourceAttemptFenceError(
        FENCE_ERROR_CODES.RESOURCE_ATTEMPT_INTEGRITY,
        'Unable to create resource attempt fence',
        { cause: err?.message || String(err) }
      );
    }
    const winner = await findLiveFence(checkoutId, deps);
    if (winner && new Date(winner.bundleValidUntil).getTime() > now.getTime()) {
      throw new CheckoutResourceAttemptFenceError(
        FENCE_ERROR_CODES.RESOURCE_BUNDLE_IN_PROGRESS,
        'Another resource attempt won the live fence race',
        {
          checkoutId,
          attemptId: winner.attemptId,
          generation: winner.generation
        }
      );
    }
    throw new CheckoutResourceAttemptFenceError(
      FENCE_ERROR_CODES.RESOURCE_ATTEMPT_INTEGRITY,
      'Fence create raced without a usable live winner',
      { checkoutId, cause: err?.message || String(err) }
    );
  }
}

async function assertCheckoutResourceAttemptFence(input = {}, deps = {}) {
  const checkoutId = assertValidCheckoutId(input.checkoutId);
  const attemptId =
    input.attemptId != null ? String(input.attemptId).trim() : '';
  if (!attemptId) {
    throw new CheckoutResourceAttemptFenceError(
      FENCE_ERROR_CODES.RESOURCE_BUNDLE_INVALID_INPUT,
      'attemptId is required'
    );
  }
  const now = getNow(deps);
  const Model = getModel(deps);
  const row = await Model.findOne({ checkoutId, attemptId }).lean();
  if (!row) {
    throw new CheckoutResourceAttemptFenceError(
      FENCE_ERROR_CODES.RESOURCE_BUNDLE_FENCE_LOST,
      'Resource attempt fence was not found',
      { checkoutId, attemptId }
    );
  }
  if (!row.isLive || row.status !== 'open') {
    throw new CheckoutResourceAttemptFenceError(
      FENCE_ERROR_CODES.RESOURCE_BUNDLE_FENCE_LOST,
      'Resource attempt fence is not live',
      { checkoutId, attemptId, status: row.status, isLive: row.isLive }
    );
  }
  if (!row.bundleValidUntil || new Date(row.bundleValidUntil).getTime() <= now.getTime()) {
    throw new CheckoutResourceAttemptFenceError(
      FENCE_ERROR_CODES.RESOURCE_BUNDLE_FENCE_LOST,
      'Resource attempt fence has expired',
      { checkoutId, attemptId, bundleValidUntil: row.bundleValidUntil }
    );
  }
  if (!row.quoteSnapshotHash || typeof row.quoteSnapshotHash !== 'string') {
    throw new CheckoutResourceAttemptFenceError(
      FENCE_ERROR_CODES.RESOURCE_ATTEMPT_INTEGRITY,
      'Fence quoteSnapshotHash is missing or malformed',
      { checkoutId, attemptId }
    );
  }
  if (input.quoteSnapshotHash != null) {
    const expected = String(input.quoteSnapshotHash).trim();
    if (expected && expected !== String(row.quoteSnapshotHash)) {
      throw new CheckoutResourceAttemptFenceError(
        FENCE_ERROR_CODES.RESOURCE_ATTEMPT_INTEGRITY,
        'Fence quoteSnapshotHash mismatch',
        { checkoutId, attemptId }
      );
    }
  }
  return {
    attemptId: row.attemptId,
    checkoutId: row.checkoutId,
    quoteSnapshotHash: row.quoteSnapshotHash,
    generation: row.generation,
    status: row.status,
    isLive: row.isLive,
    startedAt: row.startedAt,
    bundleValidUntil: row.bundleValidUntil,
    failureCode: row.failureCode || null
  };
}

async function releaseCheckoutResourceAttemptFence(input = {}, deps = {}) {
  const checkoutId = assertValidCheckoutId(input.checkoutId);
  const attemptId =
    input.attemptId != null ? String(input.attemptId).trim() : '';
  if (!attemptId) {
    throw new CheckoutResourceAttemptFenceError(
      FENCE_ERROR_CODES.RESOURCE_BUNDLE_INVALID_INPUT,
      'attemptId is required'
    );
  }
  const now = getNow(deps);
  const Model = getModel(deps);

  const updated = await Model.findOneAndUpdate(
    {
      checkoutId,
      attemptId,
      status: 'open',
      isLive: true
    },
    {
      $set: {
        status: 'released',
        isLive: false,
        releasedAt: now
      }
    },
    { new: true }
  );

  if (updated) {
    return {
      ok: true,
      attemptId,
      checkoutId,
      status: 'released',
      releasedAt: updated.releasedAt
    };
  }

  const existing = await Model.findOne({ checkoutId, attemptId }).lean();
  if (existing && existing.status === 'released' && !existing.isLive) {
    return {
      ok: true,
      attemptId,
      checkoutId,
      status: 'released',
      releasedAt: existing.releasedAt,
      idempotent: true
    };
  }

  throw new CheckoutResourceAttemptFenceError(
    FENCE_ERROR_CODES.RESOURCE_BUNDLE_FENCE_LOST,
    'Cannot release fence: attempt is not the live open fence',
    {
      checkoutId,
      attemptId,
      status: existing ? existing.status : null
    }
  );
}

async function failCheckoutResourceAttemptFence(input = {}, deps = {}) {
  const checkoutId = assertValidCheckoutId(input.checkoutId);
  const attemptId =
    input.attemptId != null ? String(input.attemptId).trim() : '';
  if (!attemptId) {
    throw new CheckoutResourceAttemptFenceError(
      FENCE_ERROR_CODES.RESOURCE_BUNDLE_INVALID_INPUT,
      'attemptId is required'
    );
  }
  const failureCode =
    input.failureCode != null ? String(input.failureCode).trim() : 'FAILED';
  const Model = getModel(deps);

  const updated = await Model.findOneAndUpdate(
    {
      checkoutId,
      attemptId,
      status: 'open',
      isLive: true
    },
    {
      $set: {
        status: 'failed',
        isLive: false,
        failureCode
      }
    },
    { new: true }
  );

  if (updated) {
    return {
      ok: true,
      attemptId,
      checkoutId,
      status: 'failed',
      failureCode: updated.failureCode
    };
  }

  const existing = await Model.findOne({ checkoutId, attemptId }).lean();
  if (existing && existing.status === 'failed' && !existing.isLive) {
    return {
      ok: true,
      attemptId,
      checkoutId,
      status: 'failed',
      failureCode: existing.failureCode,
      idempotent: true
    };
  }

  throw new CheckoutResourceAttemptFenceError(
    FENCE_ERROR_CODES.RESOURCE_BUNDLE_FENCE_LOST,
    'Cannot fail fence: attempt is not the live open fence',
    {
      checkoutId,
      attemptId,
      status: existing ? existing.status : null
    }
  );
}

/**
 * Keep fence open/live but record a diagnostic failureCode (incomplete compensate/clear).
 */
async function annotateCheckoutResourceAttemptFenceFailure(input = {}, deps = {}) {
  const checkoutId = assertValidCheckoutId(input.checkoutId);
  const attemptId =
    input.attemptId != null ? String(input.attemptId).trim() : '';
  const failureCode =
    input.failureCode != null ? String(input.failureCode).trim() : '';
  if (!attemptId || !failureCode) {
    throw new CheckoutResourceAttemptFenceError(
      FENCE_ERROR_CODES.RESOURCE_BUNDLE_INVALID_INPUT,
      'attemptId and failureCode are required'
    );
  }
  const Model = getModel(deps);
  const updated = await Model.findOneAndUpdate(
    {
      checkoutId,
      attemptId,
      status: 'open',
      isLive: true
    },
    { $set: { failureCode } },
    { new: true }
  );
  if (!updated) {
    throw new CheckoutResourceAttemptFenceError(
      FENCE_ERROR_CODES.RESOURCE_BUNDLE_FENCE_LOST,
      'Cannot annotate fence failure: attempt is not live open',
      { checkoutId, attemptId }
    );
  }
  return {
    ok: true,
    attemptId,
    checkoutId,
    status: 'open',
    isLive: true,
    failureCode: updated.failureCode,
    bundleValidUntil: updated.bundleValidUntil
  };
}

async function expireCheckoutResourceAttemptFences(deps = {}) {
  const Model = getModel(deps);
  const now = getNow(deps);
  const result = await Model.updateMany(
    {
      status: 'open',
      isLive: true,
      bundleValidUntil: { $lte: now }
    },
    {
      $set: {
        status: 'expired',
        isLive: false
      }
    }
  );
  return {
    ok: true,
    matchedCount: result.matchedCount ?? result.n,
    modifiedCount: result.modifiedCount ?? result.nModified
  };
}

async function ensureCheckoutResourceAttemptIndexesForTests(deps = {}) {
  const Model = getModel(deps);
  const spec = AUTHORITATIVE_LIVE_INDEX_SPEC;
  await Model.collection.createIndex({ attemptId: 1 }, { unique: true });
  await Model.collection.createIndex({ checkoutId: 1, generation: 1 }, { unique: true });
  await Model.collection.createIndex(spec.keys, { ...spec.options });
  await Model.collection.createIndex({ status: 1, bundleValidUntil: 1 });
  await Model.collection.createIndex({ checkoutId: 1, generation: -1 });
  return spec;
}

module.exports = {
  DEFAULT_RESOURCE_BUNDLE_TTL_MS,
  FENCE_ERROR_CODES,
  CheckoutResourceAttemptFenceError,
  AUTHORITATIVE_LIVE_INDEX_SPEC,
  assertCheckoutResourceAttemptAuthoritativeIndex,
  acquireCheckoutResourceAttemptFence,
  assertCheckoutResourceAttemptFence,
  releaseCheckoutResourceAttemptFence,
  failCheckoutResourceAttemptFence,
  annotateCheckoutResourceAttemptFenceFailure,
  expireCheckoutResourceAttemptFences,
  ensureCheckoutResourceAttemptIndexesForTests,
  findLiveFence
};
