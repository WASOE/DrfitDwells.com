'use strict';

/**
 * REBOOK-S1.4 — Controlled CabinNightClaim INSERT-ONLY backfill.
 *
 * Inserts missing expected ownership tuples with source=bootstrap.
 * Never mutates Bookings, never deletes claims, never creates indexes.
 */

const {
  runCabinNightClaimS1Preflight,
  CUTOVER_BATCH
} = require('./cabinNightClaimS1PreflightService');
const {
  claimCabinNights,
  ERR: CLAIM_ERR,
  ACQUISITION_MODES
} = require('./cabinNightClaimService');

const BACKFILL_SOURCE = 'bootstrap';
const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 5000;
const SAMPLE_LIMIT = 25;

const REFUSE = Object.freeze({
  PREFLIGHT_NOT_READY: 'BACKFILL_PREFLIGHT_NOT_READY',
  INVALID_BATCH_SIZE: 'BACKFILL_INVALID_BATCH_SIZE',
  FOREIGN_OWNER_CONFLICT: 'BACKFILL_FOREIGN_OWNER_CONFLICT',
  STAY_CHANGE_CONFLICT: 'BACKFILL_STAY_CHANGE_CONFLICT',
  INVALID_FLAG_COMBINATION: 'BACKFILL_INVALID_FLAG_COMBINATION',
  AFTER_AUTHORITY_NOT_ALLOWED: 'BACKFILL_AFTER_AUTHORITY_NOT_ALLOWED',
  CREATE_UNIQUE_NOT_IMPLEMENTED: 'NOT_IMPLEMENTED_IN_S1_3'
});

function pushSample(arr, item, limit = SAMPLE_LIMIT) {
  if (arr.length < limit) arr.push(item);
}

function normalizeBatchSize(raw) {
  if (raw == null || raw === '') return { ok: true, value: DEFAULT_BATCH_SIZE };
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > MAX_BATCH_SIZE) {
    return {
      ok: false,
      value: null,
      reason: `batch-size must be an integer from 1 to ${MAX_BATCH_SIZE}`
    };
  }
  return { ok: true, value: n };
}

function preflightAllowsBackfill(preflight) {
  if (!preflight) return { ok: false, reason: 'Missing preflight report' };
  if (preflight.toolFailure) {
    return { ok: false, reason: preflight.toolFailureMessage || 'Preflight toolFailure' };
  }
  if (preflight.scanCompleteness !== 'full') {
    return { ok: false, reason: `scanCompleteness=${preflight.scanCompleteness}` };
  }
  if (preflight.readyForBackfill !== true) {
    return { ok: false, reason: 'readyForBackfill is false' };
  }
  if (preflight.writerReadiness?.codeReady !== true) {
    return { ok: false, reason: 'writerReadiness.codeReady is false' };
  }
  if (preflight.unexpectedIndexState === true) {
    return { ok: false, reason: 'unexpectedIndexState' };
  }
  const c = preflight.counts || {};
  if ((c.canonicalCollisions || 0) > 0) {
    return { ok: false, reason: 'canonicalCollisions > 0' };
  }
  if ((c.malformedBookings || 0) > 0) {
    return { ok: false, reason: 'malformedBookings > 0' };
  }
  if ((c.invalidCabinReferences || 0) > 0) {
    return { ok: false, reason: 'invalidCabinReferences > 0' };
  }
  if ((c.invalidDateRanges || 0) > 0) {
    return { ok: false, reason: 'invalidDateRanges > 0' };
  }
  return { ok: true };
}

function emptyBackfillStats() {
  return {
    processed: 0,
    inserted: 0,
    skippedAlreadyOwned: 0,
    foreignConflicts: 0,
    stayChangeConflicts: 0,
    failed: 0,
    insertedClaimIds: [],
    conflictSamples: [],
    failureSamples: []
  };
}

/**
 * Insert a single missing expected tuple with live re-check via claimCabinNights.
 * @returns {{ outcome: string, claimId?: string, errorCode?: string, details?: object }}
 */
async function insertBootstrapTuple(tuple, { claimCabinNightsFn = claimCabinNights } = {}) {
  try {
    const result = await claimCabinNightsFn({
      cabinId: tuple.cabinId,
      bookingId: tuple.bookingId,
      nights: [tuple.night],
      stayChangeId: null,
      source: BACKFILL_SOURCE,
      acquisitionMode: ACQUISITION_MODES.SHADOW
    });
    if (Number(result.insertedCount || 0) > 0) {
      const claimId =
        result.insertedClaimIdsThisAttempt?.[0] != null
          ? String(result.insertedClaimIdsThisAttempt[0])
          : null;
      return { outcome: 'inserted', claimId };
    }
    // Same-owner already present (organic or prior bootstrap) — do not rewrite source.
    return { outcome: 'skipped_already_owned' };
  } catch (err) {
    const code = err?.code || null;
    if (code === CLAIM_ERR.FOREIGN_OWNER) {
      return {
        outcome: 'foreign_conflict',
        errorCode: code,
        details: {
          cabinId: tuple.cabinId,
          night: tuple.night,
          bookingId: tuple.bookingId,
          existingBookingId: err?.details?.existingBookingId || null
        }
      };
    }
    if (code === CLAIM_ERR.STAY_CHANGE_OWNERSHIP_CONFLICT) {
      return {
        outcome: 'stay_change_conflict',
        errorCode: code,
        details: {
          cabinId: tuple.cabinId,
          night: tuple.night,
          bookingId: tuple.bookingId,
          existingStayChangeId: err?.details?.existingStayChangeId || null
        }
      };
    }
    return {
      outcome: 'failed',
      errorCode: code || 'BACKFILL_INSERT_FAILED',
      details: {
        cabinId: tuple.cabinId,
        night: tuple.night,
        bookingId: tuple.bookingId,
        message: err?.message || String(err)
      }
    };
  }
}

/**
 * Run controlled S1.4 backfill.
 * Always fresh-preflights first; insert-only; mandatory post-preflight.
 */
async function runCabinNightClaimS1Backfill(opts = {}) {
  const batchNorm = normalizeBatchSize(opts.batchSize);
  if (!batchNorm.ok) {
    return {
      mode: 'backfill',
      cutoverBatch: CUTOVER_BATCH,
      refused: true,
      refuseCode: REFUSE.INVALID_BATCH_SIZE,
      refuseReason: batchNorm.reason,
      toolFailure: false,
      postVerificationPerformed: false,
      readyForStableVerification: false,
      readyForUniqueIndex: false,
      readyForBackfill: false,
      ...emptyBackfillStats()
    };
  }
  const batchSize = batchNorm.value;

  const claimCabinNightsFn = opts.claimCabinNightsFn || claimCabinNights;
  const runPreflight = opts.runPreflight || runCabinNightClaimS1Preflight;

  const preflight = await runPreflight({
    batchSize: opts.preflightBatchSize || 200,
    BookingModel: opts.BookingModel,
    CabinModel: opts.CabinModel,
    CabinNightClaimModel: opts.CabinNightClaimModel,
    declaredWriters: opts.declaredWriters,
    db: opts.db
  });

  // S1.6+: backfill is not a post-authority reconciliation path.
  if (preflight.authoritativeUniqueExact === true) {
    return {
      mode: 'backfill',
      cutoverBatch: CUTOVER_BATCH,
      refused: true,
      refuseCode: REFUSE.AFTER_AUTHORITY_NOT_ALLOWED,
      refuseReason:
        'CabinNightClaim backfill is not allowed after authoritative unique index exists',
      toolFailure: false,
      preflightFingerprint: preflight.fingerprint || null,
      preflight,
      postVerificationPerformed: false,
      readyForStableVerification: false,
      readyForUniqueIndex: false,
      readyForBackfill: false,
      ...emptyBackfillStats()
    };
  }

  const gate = preflightAllowsBackfill(preflight);
  if (!gate.ok) {
    return {
      mode: 'backfill',
      cutoverBatch: CUTOVER_BATCH,
      refused: true,
      refuseCode: REFUSE.PREFLIGHT_NOT_READY,
      refuseReason: gate.reason,
      toolFailure: Boolean(preflight.toolFailure),
      toolFailureMessage: preflight.toolFailureMessage || null,
      preflightFingerprint: preflight.fingerprint || null,
      preflight,
      requestedExpected: preflight.counts?.expected ?? null,
      missingAtPreflight: preflight.counts?.missing ?? null,
      postVerificationPerformed: false,
      readyForStableVerification: false,
      readyForUniqueIndex: false,
      readyForBackfill: false,
      ...emptyBackfillStats()
    };
  }

  const missing = Array.isArray(preflight.missingOwnership)
    ? [...preflight.missingOwnership]
    : [];
  // Already sorted by preflight; re-sort for safety.
  missing.sort((a, b) => {
    const ka = `${a.cabinId}|${a.night}|${a.bookingId}`;
    const kb = `${b.cabinId}|${b.night}|${b.bookingId}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const toProcess = missing.slice(0, batchSize);
  const stats = emptyBackfillStats();
  let stopReason = null;
  let refuseCode = null;

  for (const tuple of toProcess) {
    stats.processed += 1;
    // eslint-disable-next-line no-await-in-loop
    const result = await insertBootstrapTuple(tuple, { claimCabinNightsFn });

    if (result.outcome === 'inserted') {
      stats.inserted += 1;
      if (result.claimId) pushSample(stats.insertedClaimIds, result.claimId);
      continue;
    }
    if (result.outcome === 'skipped_already_owned') {
      stats.skippedAlreadyOwned += 1;
      continue;
    }
    if (result.outcome === 'foreign_conflict') {
      stats.foreignConflicts += 1;
      pushSample(stats.conflictSamples, result.details);
      stopReason = 'foreign_owner_conflict';
      refuseCode = REFUSE.FOREIGN_OWNER_CONFLICT;
      break;
    }
    if (result.outcome === 'stay_change_conflict') {
      stats.stayChangeConflicts += 1;
      pushSample(stats.conflictSamples, result.details);
      stopReason = 'stay_change_conflict';
      refuseCode = REFUSE.STAY_CHANGE_CONFLICT;
      break;
    }
    // failed
    stats.failed += 1;
    pushSample(stats.failureSamples, result.details);
    stopReason = 'insert_failed';
    break;
  }

  // Mandatory fresh post-preflight (even after partial failure / foreign stop).
  let post = null;
  let postVerificationPerformed = false;
  let toolFailure = false;
  let toolFailureMessage = null;
  try {
    post = await runPreflight({
      batchSize: opts.preflightBatchSize || 200,
      BookingModel: opts.BookingModel,
      CabinModel: opts.CabinModel,
      CabinNightClaimModel: opts.CabinNightClaimModel,
      declaredWriters: opts.declaredWriters,
      db: opts.db
    });
    postVerificationPerformed = true;
    if (post.toolFailure) {
      toolFailure = true;
      toolFailureMessage = post.toolFailureMessage || 'Post-preflight toolFailure';
    }
  } catch (err) {
    toolFailure = true;
    toolFailureMessage = err?.message || String(err);
    postVerificationPerformed = false;
  }

  const refused =
    Boolean(refuseCode) ||
    stats.foreignConflicts > 0 ||
    stats.stayChangeConflicts > 0;

  const readyForStableVerification =
    !toolFailure &&
    !refused &&
    stats.failed === 0 &&
    postVerificationPerformed &&
    post?.readyForStableVerification === true;

  return {
    mode: 'backfill',
    cutoverBatch: CUTOVER_BATCH,
    refused,
    refuseCode: refuseCode || null,
    refuseReason: stopReason,
    toolFailure,
    toolFailureMessage,
    preflightFingerprint: preflight.fingerprint || null,
    postFingerprint: post?.fingerprint || null,
    requestedExpected: preflight.counts?.expected ?? 0,
    missingAtPreflight: preflight.counts?.missing ?? 0,
    batchSize,
    missingQueued: missing.length,
    processed: stats.processed,
    inserted: stats.inserted,
    skippedAlreadyOwned: stats.skippedAlreadyOwned,
    foreignConflicts: stats.foreignConflicts,
    stayChangeConflicts: stats.stayChangeConflicts,
    failed: stats.failed,
    insertedClaimIds: stats.insertedClaimIds,
    conflictSamples: stats.conflictSamples,
    failureSamples: stats.failureSamples,
    postVerificationPerformed,
    post,
    counts: post?.counts || null,
    remainingBlockers: post?.remainingBlockers || null,
    provenanceCounts: post?.provenanceCounts || null,
    readyForBackfill: post?.readyForBackfill === true,
    readyForStableVerification,
    readyForUniqueIndexProvisional: post?.readyForUniqueIndexProvisional === true,
    readyForUniqueIndex: false,
    writerReadiness: post?.writerReadiness || preflight.writerReadiness || null,
    scanCompleteness: post?.scanCompleteness || null,
    fingerprint: post?.fingerprint || null
  };
}

module.exports = {
  runCabinNightClaimS1Backfill,
  insertBootstrapTuple,
  preflightAllowsBackfill,
  normalizeBatchSize,
  BACKFILL_SOURCE,
  DEFAULT_BATCH_SIZE,
  MAX_BATCH_SIZE,
  REFUSE
};
