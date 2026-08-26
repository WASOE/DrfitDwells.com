'use strict';

/**
 * REBOOK-S1.6 — Controlled CabinNightClaim authoritative unique-index cutover.
 *
 * Creates ONLY the exact AUTHORITATIVE_UNIQUE_INDEX_SPEC index via explicit CLI.
 * Does NOT enable authoritative writer mode (S1.7).
 * Does NOT mutate Bookings or claim rows.
 */

const { AUTHORITATIVE_UNIQUE_INDEX_SPEC } = require('../../models/CabinNightClaim');
const {
  runCabinNightClaimS1Preflight,
  CUTOVER_BATCH,
  AUTHORITATIVE_INDEX_STATES,
  classifyAuthoritativeIndexState,
  summarizeIndex
} = require('./cabinNightClaimS1PreflightService');

const REFUSE = Object.freeze({
  MODE_NOT_SHADOW: 'S1_UNIQUE_MODE_NOT_SHADOW',
  PRIOR_FINGERPRINT_REQUIRED: 'S1_UNIQUE_PRIOR_FINGERPRINT_REQUIRED',
  FINGERPRINT_MISMATCH: 'S1_UNIQUE_FINGERPRINT_MISMATCH',
  LIVE_WRITERS_NOT_VERIFIED: 'S1_UNIQUE_LIVE_WRITERS_NOT_VERIFIED',
  PREFLIGHT_NOT_READY: 'S1_UNIQUE_PREFLIGHT_NOT_READY',
  WRONG_INDEX_STATE: 'S1_UNIQUE_WRONG_INDEX_STATE',
  INDEX_BUILD_DUPLICATE: 'S1_UNIQUE_INDEX_BUILD_DUPLICATE_CONFLICT',
  INVALID_FLAG_COMBINATION: 'S1_UNIQUE_INVALID_FLAG_COMBINATION'
});

function requestedIndexSpec() {
  return {
    keys: { ...AUTHORITATIVE_UNIQUE_INDEX_SPEC.keys },
    options: { ...AUTHORITATIVE_UNIQUE_INDEX_SPEC.options },
    name: AUTHORITATIVE_UNIQUE_INDEX_SPEC.options.name,
    unique: true
  };
}

/**
 * Safe runtime mode read for cutover gates (does not throw).
 */
function readRuntimeModeSafe(env = process.env) {
  const raw = env.CABIN_NIGHT_CLAIM_MODE;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { runtimeMode: 'unset', shadowOk: false };
  }
  const value = String(raw).trim().toLowerCase();
  if (value === 'shadow') return { runtimeMode: 'shadow', shadowOk: true };
  if (value === 'off') return { runtimeMode: 'off', shadowOk: false };
  if (value === 'authoritative') return { runtimeMode: 'authoritative', shadowOk: false };
  return { runtimeMode: value, shadowOk: false, invalid: true };
}

function isDuplicateIndexBuildFailure(err) {
  if (!err) return false;
  const code = err.code;
  if (code === 11000 || code === 11001) return true;
  const msg = String(err.message || '');
  return /duplicate key|E11000|cannot create unique index/i.test(msg);
}

function inventoryCleanForUnique(preflight) {
  if (!preflight) return { ok: false, reason: 'Missing preflight' };
  if (preflight.toolFailure) {
    return { ok: false, reason: preflight.toolFailureMessage || 'toolFailure' };
  }
  if (preflight.scanCompleteness !== 'full') {
    return { ok: false, reason: `scanCompleteness=${preflight.scanCompleteness}` };
  }
  if (preflight.writerReadiness?.codeReady !== true) {
    return { ok: false, reason: 'writerReadiness.codeReady is false' };
  }
  if (preflight.readyForStableVerification !== true) {
    return { ok: false, reason: 'readyForStableVerification is false' };
  }
  if (preflight.unexpectedIndexState === true) {
    return { ok: false, reason: 'unexpectedIndexState' };
  }
  const c = preflight.counts || {};
  const zeros = [
    ['missing', c.missing],
    ['stale', c.stale],
    ['orphan', c.orphan],
    ['wrongCabin', c.wrongCabin],
    ['outsideRange', c.outsideRange],
    ['sameOwnerDuplicates', c.sameOwnerDuplicates],
    ['foreignOwnerDuplicates', c.foreignOwnerDuplicates],
    ['canonicalCollisions', c.canonicalCollisions],
    ['foreignClaimConflicts', c.foreignClaimConflicts],
    ['claimsForNonblockingBooking', c.claimsForNonblockingBooking],
    ['claimsForMultiInventoryBooking', c.claimsForMultiInventoryBooking],
    ['claimsForExcludedBooking', c.claimsForExcludedBooking],
    ['claimsForMalformedBooking', c.claimsForMalformedBooking],
    ['malformedBookings', c.malformedBookings],
    ['malformedClaims', c.malformedClaims],
    ['invalidCabinReferences', c.invalidCabinReferences],
    ['invalidDateRanges', c.invalidDateRanges]
  ];
  for (const [name, val] of zeros) {
    if ((val || 0) !== 0) return { ok: false, reason: `${name}=${val}` };
  }
  if ((c.expected || 0) !== (c.actual || 0)) {
    return { ok: false, reason: `expected(${c.expected})!==actual(${c.actual})` };
  }
  return { ok: true };
}

function baseResult(partial) {
  return {
    mode: 'create-unique-index',
    cutoverBatch: CUTOVER_BATCH,
    requestedIndexSpec: requestedIndexSpec(),
    codeWriterReadiness: null,
    liveWriterProcessAcknowledged: false,
    liveWriterProcessInspectedByCli: false,
    priorFingerprint: null,
    preCreateFingerprint: null,
    postCreateFingerprint: null,
    postCreateFingerprintChanged: null,
    preflightClean: false,
    stableFingerprintMatched: false,
    indexStateBefore: null,
    indexStateAfter: null,
    created: false,
    alreadyPresent: false,
    createdIndexName: null,
    authoritativeUniquePresent: false,
    authoritativeUniqueExact: false,
    postVerificationPerformed: false,
    postVerificationClean: false,
    needsReview: false,
    refused: false,
    refuseCode: null,
    refuseReason: null,
    toolFailure: false,
    toolFailureMessage: null,
    runtimeMode: null,
    counts: null,
    ...partial
  };
}

async function readIndexes(CabinNightClaimModel) {
  try {
    return (await CabinNightClaimModel.collection.indexes()) || [];
  } catch (err) {
    if (err?.codeName === 'NamespaceNotFound' || /ns does not exist/i.test(err?.message || '')) {
      return [];
    }
    throw err;
  }
}

/**
 * Controlled unique-index cutover.
 *
 * @param {object} opts
 * @param {string} [opts.priorFingerprint]
 * @param {boolean} [opts.liveWritersVerified]
 * @param {function} [opts.createIndexFn] test inject
 * @param {function} [opts.runPreflight] test inject
 */
async function runCabinNightClaimS1UniqueIndexCutover(opts = {}) {
  const CabinNightClaimModel =
    opts.CabinNightClaimModel || require('../../models/CabinNightClaim');
  const runPreflight = opts.runPreflight || runCabinNightClaimS1Preflight;
  const createIndexFn =
    opts.createIndexFn ||
    ((keys, options) => CabinNightClaimModel.collection.createIndex(keys, options));

  const { runtimeMode, shadowOk } = readRuntimeModeSafe(opts.env || process.env);
  const liveWritersVerified = opts.liveWritersVerified === true;
  const priorFingerprint =
    opts.priorFingerprint != null && String(opts.priorFingerprint).trim()
      ? String(opts.priorFingerprint).trim()
      : null;

  // --- Index state BEFORE (may already be EXACT → idempotent path) ---
  let indexesBefore = [];
  try {
    indexesBefore = await readIndexes(CabinNightClaimModel);
  } catch (err) {
    return baseResult({
      runtimeMode,
      liveWriterProcessAcknowledged: liveWritersVerified,
      toolFailure: true,
      toolFailureMessage: err?.message || String(err)
    });
  }
  const beforeClass = classifyAuthoritativeIndexState(indexesBefore);
  const indexStateBefore = beforeClass.authoritativeIndexState;

  // Idempotent re-entry: exact already present — verify current parity, no createIndex.
  if (beforeClass.authoritativeUniqueExact) {
    let post;
    try {
      post = await runPreflight({
        BookingModel: opts.BookingModel,
        CabinModel: opts.CabinModel,
        CabinNightClaimModel,
        declaredWriters: opts.declaredWriters,
        db: opts.db
      });
    } catch (err) {
      return baseResult({
        runtimeMode,
        liveWriterProcessAcknowledged: liveWritersVerified,
        indexStateBefore,
        indexStateAfter: AUTHORITATIVE_INDEX_STATES.EXACT,
        alreadyPresent: true,
        created: false,
        authoritativeUniquePresent: true,
        authoritativeUniqueExact: true,
        toolFailure: true,
        toolFailureMessage: err?.message || String(err),
        needsReview: true
      });
    }

    const clean = inventoryCleanForUnique(post);
    const postExact = post.authoritativeUniqueExact === true;
    const postVerificationClean = clean.ok && postExact;

    return baseResult({
      runtimeMode,
      codeWriterReadiness: post.writerReadiness?.codeReady === true,
      liveWriterProcessAcknowledged: liveWritersVerified,
      priorFingerprint,
      preCreateFingerprint: post.fingerprint,
      postCreateFingerprint: post.fingerprint,
      postCreateFingerprintChanged: false,
      preflightClean: clean.ok,
      stableFingerprintMatched: null,
      indexStateBefore,
      indexStateAfter: post.authoritativeIndexState || AUTHORITATIVE_INDEX_STATES.EXACT,
      created: false,
      alreadyPresent: true,
      createdIndexName: AUTHORITATIVE_UNIQUE_INDEX_SPEC.options.name,
      authoritativeUniquePresent: post.authoritativeUniquePresent === true,
      authoritativeUniqueExact: postExact,
      postVerificationPerformed: true,
      postVerificationClean,
      needsReview: !postVerificationClean,
      refused: false,
      toolFailure: Boolean(post.toolFailure),
      toolFailureMessage: post.toolFailureMessage || null,
      counts: post.counts,
      remainingBlockers: post.remainingBlockers,
      fingerprint: post.fingerprint,
      post
    });
  }

  // Wrong / conflicting index before creation → refuse (no drop/rename).
  if (
    indexStateBefore === AUTHORITATIVE_INDEX_STATES.WRONG_NAMED_AUTHORITY ||
    indexStateBefore === AUTHORITATIVE_INDEX_STATES.EQUIVALENT_KEY_CONFLICT
  ) {
    return baseResult({
      runtimeMode,
      liveWriterProcessAcknowledged: liveWritersVerified,
      indexStateBefore,
      indexStateAfter: indexStateBefore,
      refused: true,
      refuseCode: REFUSE.WRONG_INDEX_STATE,
      refuseReason: `Cannot create unique index: indexStateBefore=${indexStateBefore}`,
      existingIndexes: indexesBefore.map(summarizeIndex)
    });
  }

  // --- Absent path: require shadow + prior fingerprint + live ack ---
  if (!shadowOk) {
    return baseResult({
      runtimeMode,
      liveWriterProcessAcknowledged: liveWritersVerified,
      indexStateBefore,
      refused: true,
      refuseCode: REFUSE.MODE_NOT_SHADOW,
      refuseReason: `CABIN_NIGHT_CLAIM_MODE must be shadow for unique-index creation (got ${runtimeMode})`
    });
  }

  if (!priorFingerprint) {
    return baseResult({
      runtimeMode,
      liveWriterProcessAcknowledged: liveWritersVerified,
      indexStateBefore,
      refused: true,
      refuseCode: REFUSE.PRIOR_FINGERPRINT_REQUIRED,
      refuseReason: '--prior-fingerprint is required when authoritative unique index is absent'
    });
  }

  if (!liveWritersVerified) {
    return baseResult({
      runtimeMode,
      liveWriterProcessAcknowledged: false,
      priorFingerprint,
      indexStateBefore,
      refused: true,
      refuseCode: REFUSE.LIVE_WRITERS_NOT_VERIFIED,
      refuseReason:
        '--live-writers-verified operator acknowledgement required (CLI does not inspect PM2)'
    });
  }

  // Fresh preflight with prior fingerprint comparison
  let preflight;
  try {
    preflight = await runPreflight({
      priorFingerprint,
      BookingModel: opts.BookingModel,
      CabinModel: opts.CabinModel,
      CabinNightClaimModel,
      declaredWriters: opts.declaredWriters,
      db: opts.db
    });
  } catch (err) {
    return baseResult({
      runtimeMode,
      liveWriterProcessAcknowledged: true,
      priorFingerprint,
      indexStateBefore,
      toolFailure: true,
      toolFailureMessage: err?.message || String(err)
    });
  }

  const preCreateFingerprint = preflight.fingerprint || null;
  const stableMatched =
    preflight.stableVerification?.satisfied === true &&
    preCreateFingerprint === priorFingerprint;

  const clean = inventoryCleanForUnique(preflight);
  if (!clean.ok) {
    return baseResult({
      runtimeMode,
      codeWriterReadiness: preflight.writerReadiness?.codeReady === true,
      liveWriterProcessAcknowledged: true,
      priorFingerprint,
      preCreateFingerprint,
      preflightClean: false,
      stableFingerprintMatched: stableMatched,
      indexStateBefore: preflight.authoritativeIndexState || indexStateBefore,
      refused: true,
      refuseCode: REFUSE.PREFLIGHT_NOT_READY,
      refuseReason: clean.reason,
      counts: preflight.counts,
      post: null,
      preflight
    });
  }

  if (!stableMatched) {
    return baseResult({
      runtimeMode,
      codeWriterReadiness: true,
      liveWriterProcessAcknowledged: true,
      priorFingerprint,
      preCreateFingerprint,
      preflightClean: true,
      stableFingerprintMatched: false,
      indexStateBefore: preflight.authoritativeIndexState || indexStateBefore,
      refused: true,
      refuseCode: REFUSE.FINGERPRINT_MISMATCH,
      refuseReason: 'Fresh preflight fingerprint does not match --prior-fingerprint',
      counts: preflight.counts,
      preflight
    });
  }

  // Re-check index state from preflight (should still be absent/safe)
  const preState = preflight.authoritativeIndexState || indexStateBefore;
  if (
    preState === AUTHORITATIVE_INDEX_STATES.WRONG_NAMED_AUTHORITY ||
    preState === AUTHORITATIVE_INDEX_STATES.EQUIVALENT_KEY_CONFLICT
  ) {
    return baseResult({
      runtimeMode,
      codeWriterReadiness: true,
      liveWriterProcessAcknowledged: true,
      priorFingerprint,
      preCreateFingerprint,
      preflightClean: true,
      stableFingerprintMatched: true,
      indexStateBefore: preState,
      refused: true,
      refuseCode: REFUSE.WRONG_INDEX_STATE,
      refuseReason: `Unsafe index state before create: ${preState}`,
      preflight
    });
  }

  // --- createIndex ---
  const spec = AUTHORITATIVE_UNIQUE_INDEX_SPEC;
  let createdIndexName = null;
  let created = false;
  try {
    createdIndexName = await createIndexFn(
      { ...spec.keys },
      { ...spec.options }
    );
    created = true;
  } catch (err) {
    // Attempt post-preflight for diagnostics
    let post = null;
    let postVerificationPerformed = false;
    try {
      post = await runPreflight({
        BookingModel: opts.BookingModel,
        CabinModel: opts.CabinModel,
        CabinNightClaimModel,
        declaredWriters: opts.declaredWriters,
        db: opts.db
      });
      postVerificationPerformed = true;
    } catch (_) {
      /* ignore */
    }

    if (isDuplicateIndexBuildFailure(err)) {
      return baseResult({
        runtimeMode,
        codeWriterReadiness: true,
        liveWriterProcessAcknowledged: true,
        priorFingerprint,
        preCreateFingerprint,
        postCreateFingerprint: post?.fingerprint || null,
        preflightClean: true,
        stableFingerprintMatched: true,
        indexStateBefore: preState,
        indexStateAfter: post?.authoritativeIndexState || preState,
        created: false,
        alreadyPresent: false,
        refused: true,
        refuseCode: REFUSE.INDEX_BUILD_DUPLICATE,
        refuseReason: err?.message || 'Unique index build failed due to duplicate keys',
        toolFailure: false,
        postVerificationPerformed,
        postVerificationClean: false,
        needsReview: true,
        counts: post?.counts || preflight.counts,
        preflight,
        post
      });
    }

    return baseResult({
      runtimeMode,
      codeWriterReadiness: true,
      liveWriterProcessAcknowledged: true,
      priorFingerprint,
      preCreateFingerprint,
      postCreateFingerprint: post?.fingerprint || null,
      preflightClean: true,
      stableFingerprintMatched: true,
      indexStateBefore: preState,
      indexStateAfter: post?.authoritativeIndexState || preState,
      created: false,
      toolFailure: true,
      toolFailureMessage: err?.message || String(err),
      postVerificationPerformed,
      postVerificationClean: false,
      needsReview: true,
      counts: post?.counts || preflight.counts,
      preflight,
      post
    });
  }

  if (createdIndexName !== spec.options.name) {
    return baseResult({
      runtimeMode,
      codeWriterReadiness: true,
      liveWriterProcessAcknowledged: true,
      priorFingerprint,
      preCreateFingerprint,
      preflightClean: true,
      stableFingerprintMatched: true,
      indexStateBefore: preState,
      created: true,
      createdIndexName,
      toolFailure: true,
      toolFailureMessage: `createIndex returned unexpected name: ${createdIndexName}`,
      needsReview: true,
      preflight
    });
  }

  // Mandatory post-create preflight
  let post;
  try {
    post = await runPreflight({
      BookingModel: opts.BookingModel,
      CabinModel: opts.CabinModel,
      CabinNightClaimModel,
      declaredWriters: opts.declaredWriters,
      db: opts.db
    });
  } catch (err) {
    return baseResult({
      runtimeMode,
      codeWriterReadiness: true,
      liveWriterProcessAcknowledged: true,
      priorFingerprint,
      preCreateFingerprint,
      preflightClean: true,
      stableFingerprintMatched: true,
      indexStateBefore: preState,
      created: true,
      createdIndexName,
      authoritativeUniquePresent: true,
      toolFailure: true,
      toolFailureMessage: err?.message || String(err),
      postVerificationPerformed: false,
      postVerificationClean: false,
      needsReview: true,
      preflight
    });
  }

  const postClean = inventoryCleanForUnique(post);
  const postExact = post.authoritativeUniqueExact === true;
  const postVerificationClean = postClean.ok && postExact;
  const postCreateFingerprint = post.fingerprint || null;
  const postCreateFingerprintChanged = postCreateFingerprint !== priorFingerprint;

  return baseResult({
    runtimeMode,
    codeWriterReadiness: post.writerReadiness?.codeReady === true,
    liveWriterProcessAcknowledged: true,
    priorFingerprint,
    preCreateFingerprint,
    postCreateFingerprint,
    postCreateFingerprintChanged,
    preflightClean: true,
    stableFingerprintMatched: true,
    indexStateBefore: preState,
    indexStateAfter: post.authoritativeIndexState || null,
    created: true,
    alreadyPresent: false,
    createdIndexName,
    authoritativeUniquePresent: post.authoritativeUniquePresent === true,
    authoritativeUniqueExact: postExact,
    postVerificationPerformed: true,
    postVerificationClean,
    needsReview: !postVerificationClean,
    refused: false,
    toolFailure: Boolean(post.toolFailure),
    toolFailureMessage: post.toolFailureMessage || null,
    counts: post.counts,
    remainingBlockers: post.remainingBlockers,
    fingerprint: postCreateFingerprint,
    preflight,
    post
  });
}

module.exports = {
  runCabinNightClaimS1UniqueIndexCutover,
  readRuntimeModeSafe,
  inventoryCleanForUnique,
  requestedIndexSpec,
  isDuplicateIndexBuildFailure,
  REFUSE,
  AUTHORITATIVE_INDEX_STATES
};
