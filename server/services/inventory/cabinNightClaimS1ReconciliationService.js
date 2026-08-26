'use strict';

/**
 * REBOOK-S1.8 — CabinNightClaim post-cutover reconciliation.
 * Binding: docs/stay-change-implementation-plan.md — §24.27 / §24.29 / §24.45
 *
 * Default / --verify: READ-ONLY.
 * Mutation requires --repair AND --apply-safe-repairs.
 * Exact unique index required for mutation.
 * Never create/drop/sync indexes. Never steal foreign ownership.
 * Prefer conservative over-blocking to under-blocking.
 */

const Booking = require('../../models/Booking');
const { AUTHORITATIVE_UNIQUE_INDEX_SPEC } = require('../../models/CabinNightClaim');
const { expandOccupiedSofiaNightDateOnlys } = require('../ops/reporting/stayNights');
const { openManualReviewItem } = require('../ops/ingestion/manualReviewService');
const {
  runCabinNightClaimS1Preflight,
  AUTHORITATIVE_INDEX_STATES
} = require('./cabinNightClaimS1PreflightService');
const {
  claimCabinNights,
  releaseCabinNights,
  compensateCabinClaimAttempt,
  assertAuthoritativeCabinNightIndex,
  ACQUISITION_MODES,
  ERR: CLAIM_ERR
} = require('./cabinNightClaimService');
const {
  AUTHORITY_EVENTS,
  emitCabinNightClaimAuthorityEvent
} = require('./cabinNightClaimObservability');

const RECONCILE_BATCH = 'S1.8';
const MRI_CATEGORY = 'cabin_night_claim_reconciliation';
const MRI_SOURCE = 'cabin_night_claim_s1_8_reconcile';

const REPAIR_KIND = Object.freeze({
  SAFE_INSERT: 'SAFE_INSERT',
  SAFE_RELEASE: 'SAFE_RELEASE',
  SAFE_TARGET_FIRST: 'SAFE_TARGET_FIRST',
  SAFE_SAME_OWNER_DEDUPE: 'SAFE_SAME_OWNER_DEDUPE',
  MANUAL_REQUIRED: 'MANUAL_REQUIRED'
});

const MANUAL_REASONS = Object.freeze({
  ORPHAN_AMBIGUOUS: 'ORPHAN_AMBIGUOUS',
  FOREIGN_CLAIM_CONFLICT: 'FOREIGN_CLAIM_CONFLICT',
  FOREIGN_OWNER_DUPLICATE: 'FOREIGN_OWNER_DUPLICATE',
  CANONICAL_COLLISION: 'CANONICAL_COLLISION',
  MALFORMED_BOOKING: 'MALFORMED_BOOKING',
  MALFORMED_CLAIM: 'MALFORMED_CLAIM',
  INVALID_CABIN_REFERENCE: 'INVALID_CABIN_REFERENCE',
  INVALID_DATE_RANGE: 'INVALID_DATE_RANGE',
  MULTI_INVENTORY_SHAPE: 'MULTI_INVENTORY_SHAPE',
  MALFORMED_COMMERCIAL_SHAPE: 'MALFORMED_COMMERCIAL_SHAPE',
  INDEX_MISSING: 'INDEX_MISSING',
  INDEX_WRONG: 'INDEX_WRONG',
  SCAN_INCOMPLETE: 'SCAN_INCOMPLETE',
  TOOL_FAILURE: 'TOOL_FAILURE',
  WRITER_NOT_READY: 'WRITER_NOT_READY',
  TARGET_CONFLICT: 'TARGET_CONFLICT',
  REPAIR_FAILED: 'REPAIR_FAILED'
});

function sortIds(ids) {
  return [...(ids || [])].map((id) => String(id)).sort();
}

function cmpKey(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function planSortKey(item) {
  return [
    item.kind || '',
    item.classification || '',
    item.bookingId || '',
    item.cabinId || item.targetCabinId || item.claimCabinId || '',
    item.night || '',
    (item.claimIds || []).join(',')
  ].join('|');
}

function sortPlanItems(items) {
  return [...(items || [])].sort((a, b) => cmpKey(planSortKey(a), planSortKey(b)));
}

/**
 * Build deterministic repair plan from a full preflight report.
 */
function buildRepairPlanFromPreflight(preflight) {
  const lists = preflight.fullDriftLists || {};
  const safeInsertClaims = [];
  const safeReleaseClaims = [];
  const safeTargetFirstRepairs = [];
  const safeSameOwnerDedupes = [];
  const manualRequired = [];

  for (const m of lists.missing || preflight.missingOwnership || []) {
    safeInsertClaims.push({
      kind: REPAIR_KIND.SAFE_INSERT,
      classification: 'missing',
      bookingId: String(m.bookingId),
      cabinId: String(m.cabinId),
      night: String(m.night),
      reason: 'expected_claim_absent'
    });
  }

  // Group nonblocking / excluded releases by bookingId (owner-scoped).
  const releaseByBooking = new Map();
  for (const row of lists.claimsForNonblockingBooking || []) {
    const bookingId = String(row.bookingId);
    if (!releaseByBooking.has(bookingId)) {
      releaseByBooking.set(bookingId, {
        kind: REPAIR_KIND.SAFE_RELEASE,
        classification: 'claimsForNonblockingBooking',
        bookingId,
        claimIds: [],
        nights: [],
        reason: 'canonical_booking_nonblocking'
      });
    }
    const entry = releaseByBooking.get(bookingId);
    for (const id of row.claimIds || []) entry.claimIds.push(String(id));
    if (row.night) entry.nights.push(String(row.night));
  }
  for (const row of lists.claimsForExcludedBooking || []) {
    const bookingId = String(row.bookingId);
    if (!releaseByBooking.has(bookingId)) {
      releaseByBooking.set(bookingId, {
        kind: REPAIR_KIND.SAFE_RELEASE,
        classification: 'claimsForExcludedBooking',
        bookingId,
        claimIds: [],
        nights: [],
        reason: 'canonical_booking_excluded'
      });
    }
    const entry = releaseByBooking.get(bookingId);
    for (const id of row.claimIds || []) entry.claimIds.push(String(id));
    if (row.night) entry.nights.push(String(row.night));
  }
  for (const entry of releaseByBooking.values()) {
    entry.claimIds = sortIds([...new Set(entry.claimIds)]);
    entry.nights = [...new Set(entry.nights)].sort();
    safeReleaseClaims.push(entry);
  }

  // Target-first: group wrongCabin + outsideRange by booking.
  const targetFirstByBooking = new Map();
  function ensureTarget(bookingId, targetCabinId) {
    if (!targetFirstByBooking.has(bookingId)) {
      targetFirstByBooking.set(bookingId, {
        kind: REPAIR_KIND.SAFE_TARGET_FIRST,
        classification: 'wrongCabin_or_outsideRange',
        bookingId,
        targetCabinId: targetCabinId || null,
        surplus: [],
        reason: 'secure_target_then_release_surplus'
      });
    }
    const entry = targetFirstByBooking.get(bookingId);
    if (targetCabinId && !entry.targetCabinId) entry.targetCabinId = targetCabinId;
    return entry;
  }
  for (const row of lists.wrongCabin || []) {
    const entry = ensureTarget(String(row.bookingId), row.bookingCabinId ? String(row.bookingCabinId) : null);
    entry.surplus.push({
      cabinId: String(row.claimCabinId),
      night: String(row.night),
      claimIds: sortIds(row.claimIds || []),
      classification: 'wrongCabin'
    });
  }
  for (const row of lists.outsideRange || []) {
    const entry = ensureTarget(String(row.bookingId), row.cabinId ? String(row.cabinId) : null);
    entry.surplus.push({
      cabinId: String(row.cabinId),
      night: String(row.night),
      claimIds: sortIds(row.claimIds || []),
      classification: 'outsideRange'
    });
  }
  for (const entry of targetFirstByBooking.values()) {
    entry.surplus.sort((a, b) => cmpKey(`${a.cabinId}|${a.night}`, `${b.cabinId}|${b.night}`));
    safeTargetFirstRepairs.push(entry);
  }

  for (const row of lists.sameOwnerDuplicates || []) {
    const claimIds = sortIds(row.claimIds || []);
    if (claimIds.length < 2) continue;
    safeSameOwnerDedupes.push({
      kind: REPAIR_KIND.SAFE_SAME_OWNER_DEDUPE,
      classification: 'sameOwnerDuplicates',
      bookingId: String(row.bookingId),
      cabinId: String(row.cabinId),
      night: String(row.night),
      keepClaimId: claimIds[0],
      deleteClaimIds: claimIds.slice(1),
      reason: 'same_owner_duplicate_rows'
    });
  }

  function pushManual(classification, reason, row) {
    manualRequired.push({
      kind: REPAIR_KIND.MANUAL_REQUIRED,
      classification,
      reason,
      bookingId: row.bookingId != null ? String(row.bookingId) : null,
      bookingIds: row.bookingIds ? sortIds(row.bookingIds) : undefined,
      cabinId: row.cabinId != null ? String(row.cabinId) : row.claimCabinId != null ? String(row.claimCabinId) : null,
      night: row.night != null ? String(row.night) : null,
      claimIds: row.claimIds ? sortIds(row.claimIds) : undefined,
      details: row.reason || row.shape || null
    });
  }

  for (const row of lists.orphan || []) {
    pushManual('orphan', MANUAL_REASONS.ORPHAN_AMBIGUOUS, row);
  }
  for (const row of lists.foreignClaimConflicts || []) {
    pushManual('foreignClaimConflicts', MANUAL_REASONS.FOREIGN_CLAIM_CONFLICT, {
      ...row,
      bookingId: row.claimBookingId || (row.expectedBookingIds && row.expectedBookingIds[0]) || null,
      bookingIds: sortIds([
        ...(row.expectedBookingIds || []),
        ...(row.claimBookingIds || []),
        row.claimBookingId
      ].filter(Boolean))
    });
  }
  for (const row of lists.foreignOwnerDuplicates || []) {
    pushManual('foreignOwnerDuplicates', MANUAL_REASONS.FOREIGN_OWNER_DUPLICATE, row);
  }
  for (const row of lists.canonicalCollisions || []) {
    pushManual('canonicalCollisions', MANUAL_REASONS.CANONICAL_COLLISION, row);
  }
  for (const row of lists.malformedBookings || []) {
    pushManual('malformedBookings', MANUAL_REASONS.MALFORMED_BOOKING, row);
  }
  for (const row of lists.malformedClaims || []) {
    pushManual('malformedClaims', MANUAL_REASONS.MALFORMED_CLAIM, row);
  }
  for (const row of lists.claimsForMalformedBooking || []) {
    pushManual('claimsForMalformedBooking', MANUAL_REASONS.MALFORMED_COMMERCIAL_SHAPE, row);
  }
  for (const row of lists.claimsForMultiInventoryBooking || []) {
    pushManual('claimsForMultiInventoryBooking', MANUAL_REASONS.MULTI_INVENTORY_SHAPE, row);
  }
  for (const row of lists.invalidCabinReferences || []) {
    pushManual('invalidCabinReferences', MANUAL_REASONS.INVALID_CABIN_REFERENCE, row);
  }
  for (const row of lists.invalidDateRanges || []) {
    pushManual('invalidDateRanges', MANUAL_REASONS.INVALID_DATE_RANGE, row);
  }

  return {
    safeInsertClaims: sortPlanItems(safeInsertClaims),
    safeReleaseClaims: sortPlanItems(safeReleaseClaims),
    safeTargetFirstRepairs: sortPlanItems(safeTargetFirstRepairs),
    safeSameOwnerDedupes: sortPlanItems(safeSameOwnerDedupes),
    manualRequired: sortPlanItems(manualRequired),
    counts: {
      safeInsertClaims: safeInsertClaims.length,
      safeReleaseClaims: safeReleaseClaims.length,
      safeTargetFirstRepairs: safeTargetFirstRepairs.length,
      safeSameOwnerDedupes: safeSameOwnerDedupes.length,
      manualRequired: manualRequired.length,
      safeTotal:
        safeInsertClaims.length +
        safeReleaseClaims.length +
        safeTargetFirstRepairs.length +
        safeSameOwnerDedupes.length
    }
  };
}

function gateMutationPrecheck(preflight) {
  if (preflight.toolFailure) {
    return { ok: false, reason: MANUAL_REASONS.TOOL_FAILURE, message: preflight.toolFailureMessage };
  }
  if (preflight.scanCompleteness !== 'full') {
    return { ok: false, reason: MANUAL_REASONS.SCAN_INCOMPLETE, message: 'scanCompleteness must be full' };
  }
  if (preflight.authoritativeIndexState !== AUTHORITATIVE_INDEX_STATES.EXACT) {
    return {
      ok: false,
      reason:
        preflight.authoritativeUniquePresent
          ? MANUAL_REASONS.INDEX_WRONG
          : MANUAL_REASONS.INDEX_MISSING,
      message: `exact unique index required (state=${preflight.authoritativeIndexState})`
    };
  }
  if (!preflight.writerReadiness?.codeReady) {
    return { ok: false, reason: MANUAL_REASONS.WRITER_NOT_READY, message: 'writer readiness codeReady=false' };
  }
  return { ok: true };
}

async function applySafeInserts(plan, opts = {}) {
  const claimFn = opts.claimCabinNightsFn || claimCabinNights;
  const log = [];
  let successes = 0;
  let failures = 0;

  // Group by bookingId+cabinId for fewer acquire calls.
  const groups = new Map();
  for (const item of plan.safeInsertClaims) {
    const key = `${item.bookingId}|${item.cabinId}`;
    if (!groups.has(key)) {
      groups.set(key, {
        bookingId: item.bookingId,
        cabinId: item.cabinId,
        nights: []
      });
    }
    groups.get(key).nights.push(item.night);
  }

  const sortedGroups = [...groups.values()].sort((a, b) =>
    cmpKey(`${a.bookingId}|${a.cabinId}`, `${b.bookingId}|${b.cabinId}`)
  );

  for (const group of sortedGroups) {
    const nights = [...new Set(group.nights)].sort();
    try {
      // eslint-disable-next-line no-await-in-loop
      await claimFn({
        bookingId: group.bookingId,
        cabinId: group.cabinId,
        nights,
        source: 'bootstrap',
        acquisitionMode: ACQUISITION_MODES.AUTHORITATIVE
      });
      successes += 1;
      log.push({
        kind: REPAIR_KIND.SAFE_INSERT,
        ok: true,
        bookingId: group.bookingId,
        cabinId: group.cabinId,
        nights
      });
    } catch (err) {
      failures += 1;
      log.push({
        kind: REPAIR_KIND.SAFE_INSERT,
        ok: false,
        bookingId: group.bookingId,
        cabinId: group.cabinId,
        nights,
        errorCode: err?.code || CLAIM_ERR.INTEGRITY,
        error: err?.message || String(err)
      });
      if (
        err?.code === CLAIM_ERR.FOREIGN_OWNER ||
        err?.code === CLAIM_ERR.STAY_CHANGE_OWNERSHIP_CONFLICT
      ) {
        emitCabinNightClaimAuthorityEvent(AUTHORITY_EVENTS.AUTHORITY_RECONCILIATION_REQUIRED, {
          bookingId: group.bookingId,
          cabinId: group.cabinId,
          writer: 's1_8_reconcile',
          errorCode: err.code,
          needsReconciliation: true,
          message: 'Safe insert refused due to foreign ownership'
        });
      }
    }
  }

  return { successes, failures, log };
}

async function applySafeReleases(plan, opts = {}) {
  const releaseFn = opts.releaseCabinNightsFn || releaseCabinNights;
  const log = [];
  let successes = 0;
  let failures = 0;

  for (const item of plan.safeReleaseClaims) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await releaseFn({ bookingId: item.bookingId });
      successes += 1;
      log.push({
        kind: REPAIR_KIND.SAFE_RELEASE,
        ok: true,
        bookingId: item.bookingId,
        classification: item.classification,
        deletedCount: result?.deletedCount || 0
      });
    } catch (err) {
      failures += 1;
      log.push({
        kind: REPAIR_KIND.SAFE_RELEASE,
        ok: false,
        bookingId: item.bookingId,
        error: err?.message || String(err)
      });
    }
  }
  return { successes, failures, log };
}

async function applySameOwnerDedupes(plan, opts = {}) {
  const compensateFn = opts.compensateCabinClaimAttemptFn || compensateCabinClaimAttempt;
  const log = [];
  let successes = 0;
  let failures = 0;

  for (const item of plan.safeSameOwnerDedupes) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await compensateFn({
        insertedClaimIdsThisAttempt: item.deleteClaimIds
      });
      successes += 1;
      log.push({
        kind: REPAIR_KIND.SAFE_SAME_OWNER_DEDUPE,
        ok: true,
        bookingId: item.bookingId,
        cabinId: item.cabinId,
        night: item.night,
        keepClaimId: item.keepClaimId,
        deletedCount: result?.deletedCount || 0
      });
    } catch (err) {
      failures += 1;
      log.push({
        kind: REPAIR_KIND.SAFE_SAME_OWNER_DEDUPE,
        ok: false,
        bookingId: item.bookingId,
        error: err?.message || String(err)
      });
    }
  }
  return { successes, failures, log };
}

async function applyTargetFirstRepairs(plan, opts = {}) {
  const claimFn = opts.claimCabinNightsFn || claimCabinNights;
  const releaseFn = opts.releaseCabinNightsFn || releaseCabinNights;
  const BookingModel = opts.BookingModel || Booking;
  const log = [];
  let successes = 0;
  let failures = 0;
  let sourceReleaseFailures = 0;

  for (const item of plan.safeTargetFirstRepairs) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const booking = await BookingModel.findById(item.bookingId)
        .select('_id cabinId checkIn checkOut status')
        .lean();
      if (!booking || !booking.cabinId) {
        failures += 1;
        log.push({
          kind: REPAIR_KIND.SAFE_TARGET_FIRST,
          ok: false,
          bookingId: item.bookingId,
          errorCode: MANUAL_REASONS.MALFORMED_BOOKING,
          error: 'Booking missing or lacks cabinId for target-first repair'
        });
        continue;
      }

      const targetCabinId = String(booking.cabinId);
      const expanded = expandOccupiedSofiaNightDateOnlys(booking.checkIn, booking.checkOut);
      if (!expanded.ok) {
        failures += 1;
        log.push({
          kind: REPAIR_KIND.SAFE_TARGET_FIRST,
          ok: false,
          bookingId: item.bookingId,
          errorCode: MANUAL_REASONS.INVALID_DATE_RANGE,
          error: expanded.reason || 'invalid_range'
        });
        continue;
      }

      // 1) Secure canonical target first.
      // eslint-disable-next-line no-await-in-loop
      await claimFn({
        bookingId: item.bookingId,
        cabinId: targetCabinId,
        nights: expanded.dateOnlys,
        source: 'bootstrap',
        acquisitionMode: ACQUISITION_MODES.AUTHORITATIVE
      });

      // 2) Release surplus same-owner claims LAST (wrong cabin / outside range).
      let surplusDeleted = 0;
      for (const surplus of item.surplus) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const released = await releaseFn({
            bookingId: item.bookingId,
            cabinId: surplus.cabinId,
            nights: [surplus.night]
          });
          surplusDeleted += released?.deletedCount || 0;
        } catch (releaseErr) {
          sourceReleaseFailures += 1;
          emitCabinNightClaimAuthorityEvent(AUTHORITY_EVENTS.AUTHORITY_RECONCILIATION_REQUIRED, {
            bookingId: item.bookingId,
            cabinId: surplus.cabinId,
            writer: 's1_8_reconcile',
            errorCode: MANUAL_REASONS.REPAIR_FAILED,
            needsReconciliation: true,
            message: 'Target secured but surplus release failed; conservative extra claim retained'
          });
          log.push({
            kind: REPAIR_KIND.SAFE_TARGET_FIRST,
            ok: false,
            partial: true,
            bookingId: item.bookingId,
            targetCabinId,
            surplusCabinId: surplus.cabinId,
            surplusNight: surplus.night,
            error: releaseErr?.message || String(releaseErr),
            note: 'target_held_source_retained'
          });
        }
      }

      successes += 1;
      log.push({
        kind: REPAIR_KIND.SAFE_TARGET_FIRST,
        ok: true,
        bookingId: item.bookingId,
        targetCabinId,
        targetNights: expanded.dateOnlys,
        surplusDeleted
      });
    } catch (err) {
      failures += 1;
      log.push({
        kind: REPAIR_KIND.SAFE_TARGET_FIRST,
        ok: false,
        bookingId: item.bookingId,
        errorCode: err?.code || MANUAL_REASONS.TARGET_CONFLICT,
        error: err?.message || String(err),
        note: 'source_claims_retained'
      });
    }
  }

  return { successes, failures, sourceReleaseFailures, log };
}

async function openManualRequiredMris(manualRequired, opts = {}) {
  const openFn = opts.openManualReviewItemFn || openManualReviewItem;
  const ids = [];
  // Cap MRI fan-out; report still carries full manual list.
  const capped = (manualRequired || []).slice(0, 50);
  for (const item of capped) {
    const entityId = item.bookingId || (item.bookingIds && item.bookingIds[0]) || null;
    const sourceReference = [
      item.classification,
      item.cabinId || '',
      item.night || '',
      entityId || '',
      item.reason || ''
    ].join('|');
    try {
      // eslint-disable-next-line no-await-in-loop
      const mri = await openFn({
        category: MRI_CATEGORY,
        severity: 'critical',
        entityType: 'Booking',
        entityId,
        title: 'CabinNightClaim reconciliation requires manual review',
        details: `${item.classification}: ${item.reason}`,
        provenance: {
          source: MRI_SOURCE,
          sourceReference
        },
        evidence: {
          classification: item.classification,
          reason: item.reason,
          bookingId: item.bookingId || null,
          bookingIds: item.bookingIds || null,
          cabinId: item.cabinId || null,
          night: item.night || null,
          claimIds: item.claimIds || null,
          operation: 's1_8_reconcile'
        }
      });
      if (mri?._id) ids.push(String(mri._id));
    } catch {
      /* nonfatal */
    }
  }
  return ids;
}

/**
 * @param {object} opts
 * @param {'verify'|'repair'} [opts.mode]
 * @param {boolean} [opts.applySafeRepairs] required with mode=repair
 * @param {boolean} [opts.openMri] open MRI for manual-required on repair runs
 */
async function runCabinNightClaimS1Reconciliation(opts = {}) {
  const mode = opts.mode === 'repair' ? 'repair' : 'verify';
  const applySafe = opts.applySafeRepairs === true;
  const mutating = mode === 'repair' && applySafe;

  if (mode === 'repair' && !applySafe) {
    const err = new Error(
      'S1.8 repair requires both --repair and --apply-safe-repairs (no accidental mutation)'
    );
    err.code = 'S1_8_REPAIR_FLAGS_REQUIRED';
    throw err;
  }

  const preflight = await runCabinNightClaimS1Preflight({
    ...opts,
    fullDriftLists: true
  });

  const plan = buildRepairPlanFromPreflight(preflight);
  const gate = gateMutationPrecheck(preflight);

  const report = {
    mode: mutating ? 'repair' : 'verify',
    cutoverBatch: RECONCILE_BATCH,
    detectedAt: new Date().toISOString(),
    scanCompleteness: preflight.scanCompleteness,
    authoritativeIndexState: preflight.authoritativeIndexState,
    authoritativeUniqueExact: preflight.authoritativeUniqueExact === true,
    writerReadiness: preflight.writerReadiness,
    fingerprint: preflight.fingerprint,
    counts: preflight.counts,
    plan,
    repair: {
      attempted: false,
      successes: 0,
      failures: 0,
      sourceReleaseFailures: 0,
      log: []
    },
    postVerify: null,
    manualRequiredRemaining: plan.manualRequired.length,
    clean: false,
    refused: false,
    refuseReason: null,
    refuseCode: null,
    mriIds: []
  };

  if (!mutating) {
    report.clean =
      preflight.readyForStableVerification === true && plan.manualRequired.length === 0;
    return report;
  }

  if (!gate.ok) {
    report.refused = true;
    report.refuseReason = gate.message;
    report.refuseCode = gate.reason;
    report.clean = false;
    return report;
  }

  // Fail-closed assert once more before mutation (read-only; no create).
  try {
    await (opts.assertAuthoritativeCabinNightIndexFn || assertAuthoritativeCabinNightIndex)();
  } catch (err) {
    report.refused = true;
    report.refuseReason = err?.message || String(err);
    report.refuseCode =
      err?.code === CLAIM_ERR.INDEX_WRONG
        ? MANUAL_REASONS.INDEX_WRONG
        : MANUAL_REASONS.INDEX_MISSING;
    return report;
  }

  report.repair.attempted = true;

  const insertResult = await applySafeInserts(plan, opts);
  const dedupeResult = await applySameOwnerDedupes(plan, opts);
  const targetResult = await applyTargetFirstRepairs(plan, opts);
  const releaseResult = await applySafeReleases(plan, opts);

  report.repair.successes =
    insertResult.successes +
    dedupeResult.successes +
    targetResult.successes +
    releaseResult.successes;
  report.repair.failures =
    insertResult.failures +
    dedupeResult.failures +
    targetResult.failures +
    releaseResult.failures;
  report.repair.sourceReleaseFailures = targetResult.sourceReleaseFailures || 0;
  report.repair.log = [
    ...insertResult.log,
    ...dedupeResult.log,
    ...targetResult.log,
    ...releaseResult.log
  ];

  if (opts.openMri !== false && plan.manualRequired.length > 0) {
    report.mriIds = await openManualRequiredMris(plan.manualRequired, opts);
  }

  const post = await runCabinNightClaimS1Preflight({
    ...opts,
    fullDriftLists: true
  });
  const postPlan = buildRepairPlanFromPreflight(post);
  report.postVerify = {
    fingerprint: post.fingerprint,
    readyForStableVerification: post.readyForStableVerification === true,
    counts: {
      expected: post.counts.expected,
      actual: post.counts.actual,
      missing: post.counts.missing,
      stale: post.counts.stale,
      orphan: post.counts.orphan,
      wrongCabin: post.counts.wrongCabin,
      outsideRange: post.counts.outsideRange,
      foreignClaimConflicts: post.counts.foreignClaimConflicts,
      canonicalCollisions: post.counts.canonicalCollisions,
      claimsForNonblockingBooking: post.counts.claimsForNonblockingBooking,
      claimsForExcludedBooking: post.counts.claimsForExcludedBooking
    },
    planCounts: postPlan.counts,
    manualRequired: postPlan.manualRequired
  };
  report.manualRequiredRemaining = postPlan.manualRequired.length;
  report.fingerprint = post.fingerprint;
  report.counts = post.counts;
  report.clean =
    post.readyForStableVerification === true &&
    postPlan.manualRequired.length === 0 &&
    report.repair.failures === 0 &&
    report.repair.sourceReleaseFailures === 0;

  return report;
}

/**
 * Exit codes (avoid S1.6 verify-exit bug):
 * 0 = clean (verify clean OR repair completed clean)
 * 2 = completed with manual blockers / refusal / remaining drift
 * 1 = tool failure
 */
function exitCodeForReport(report) {
  if (!report) return 1;
  if (report.toolFailure || report.scanCompleteness === 'failed') return 1;
  if (report.clean === true) return 0;
  return 2;
}

module.exports = {
  RECONCILE_BATCH,
  REPAIR_KIND,
  MANUAL_REASONS,
  MRI_CATEGORY,
  MRI_SOURCE,
  AUTHORITATIVE_UNIQUE_INDEX_SPEC,
  buildRepairPlanFromPreflight,
  gateMutationPrecheck,
  runCabinNightClaimS1Reconciliation,
  applySafeInserts,
  applySafeReleases,
  applyTargetFirstRepairs,
  applySameOwnerDedupes,
  openManualRequiredMris,
  exitCodeForReport,
  sortPlanItems
};
