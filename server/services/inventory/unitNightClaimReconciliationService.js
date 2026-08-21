'use strict';

/**
 * I5 UnitNightClaim reconciliation / bootstrap service.
 * Binding: docs/stay-change-implementation-plan.md — I5.
 * Claims remain SHADOW / non-authoritative.
 */

const crypto = require('crypto');
const Booking = require('../../models/Booking');
const UnitNightClaim = require('../../models/UnitNightClaim');
const { AUTHORITATIVE_UNIQUE_INDEX_SPEC } = require('../../models/UnitNightClaim');
const { openManualReviewItem } = require('../ops/ingestion/manualReviewService');
const { baseBookingFilter } = require('../ops/reporting/reportingFilters');
const { FIXTURE_BOOKING_EMAIL_PATTERN } = require('../../utils/fixtureExclusion');
const {
  claimUnitNights,
  releaseUnitNights,
  deleteSameOwnerDuplicateClaims,
  nightDateFromDateOnly
} = require('./unitNightClaimService');
const {
  projectCanonicalExpectedOccupancy,
  unitNightKey,
  parseUnitNightKey,
  dateOnlyFromNightDate,
  BLOCKING_BOOKING_STATUSES
} = require('./unitNightClaimProjection');

const DRIFT_CLASS = Object.freeze({
  MISSING_CLAIM: 'MISSING_CLAIM',
  STALE_TERMINAL_CLAIM: 'STALE_TERMINAL_CLAIM',
  ORPHAN_CLAIM: 'ORPHAN_CLAIM',
  WRONG_UNIT_CLAIM: 'WRONG_UNIT_CLAIM',
  OUTSIDE_DATE_RANGE_CLAIM: 'OUTSIDE_DATE_RANGE_CLAIM',
  INVALID_ALLOCATION: 'INVALID_ALLOCATION',
  CANONICAL_UNIT_NIGHT_CONFLICT: 'CANONICAL_UNIT_NIGHT_CONFLICT',
  FOREIGN_CLAIM_CONFLICT: 'FOREIGN_CLAIM_CONFLICT',
  DUPLICATE_SAME_OWNER_CLAIM: 'DUPLICATE_SAME_OWNER_CLAIM',
  DUPLICATE_FOREIGN_OWNER_CLAIM: 'DUPLICATE_FOREIGN_OWNER_CLAIM',
  UNALLOCATED_BLOCKING_BOOKING: 'UNALLOCATED_BLOCKING_BOOKING',
  MALFORMED_BOOKING: 'MALFORMED_BOOKING',
  CLAIM_FOR_SINGLE_INVENTORY: 'CLAIM_FOR_SINGLE_INVENTORY',
  CLAIM_FOR_EXCLUDED_BOOKING: 'CLAIM_FOR_EXCLUDED_BOOKING'
});

const CANONICAL_CONFLICT_MRI_CATEGORY = 'unit_night_claim_canonical_conflict';
const MRI_SOURCE = 'unit_night_claim_reconcile';

const SAFE_CLASSES = new Set([
  DRIFT_CLASS.MISSING_CLAIM,
  DRIFT_CLASS.STALE_TERMINAL_CLAIM,
  DRIFT_CLASS.ORPHAN_CLAIM,
  DRIFT_CLASS.OUTSIDE_DATE_RANGE_CLAIM,
  DRIFT_CLASS.WRONG_UNIT_CLAIM,
  DRIFT_CLASS.DUPLICATE_SAME_OWNER_CLAIM,
  DRIFT_CLASS.CLAIM_FOR_SINGLE_INVENTORY
]);

function stableHash(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj), 'utf8').digest('hex').slice(0, 24);
}

/** Deterministic string-id sort — never rely on Map/Set/cursor insertion order. */
function sortIds(ids) {
  return [...(ids || [])].map((id) => String(id)).sort();
}

function withSortedBookingIds(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  const bookingIds = sortIds(entry.bookingIds);
  const next = { ...entry, bookingIds };
  if (Array.isArray(entry.statuses) && Array.isArray(entry.bookingIds)) {
    const statusById = new Map();
    entry.bookingIds.forEach((id, i) => {
      statusById.set(String(id), entry.statuses[i] ?? null);
    });
    next.statuses = bookingIds.map((id) => statusById.get(id) ?? null);
  }
  if (Array.isArray(entry.claimIds)) {
    next.claimIds = sortIds(entry.claimIds);
  }
  return next;
}

function canonicalizeConflict(conflict) {
  const bookingIds = sortIds(conflict.bookingIds);
  const bookingsById = new Map(
    (conflict.bookings || []).map((b) => [String(b.id), b])
  );
  return {
    ...conflict,
    bookingIds,
    bookings: bookingIds.map((id) => {
      const b = bookingsById.get(id);
      return b
        ? { ...b, id: String(b.id) }
        : { id, status: null, checkIn: null, checkOut: null, locationBookingId: null };
    })
  };
}

function driftFingerprintLine(d) {
  const bookingIds = sortIds(d.bookingIds);
  return [d.class, d.unitId || '', d.night || '', bookingIds.join(','), d.reason || ''].join('|');
}

function emptyCounts() {
  return {
    missing: 0,
    safeStale: 0,
    orphans: 0,
    outsideRange: 0,
    wrongUnit: 0,
    sameOwnerDuplicates: 0,
    foreignOwnerDuplicates: 0,
    canonicalCollisions: 0,
    unallocatedBlocking: 0,
    malformedAllocations: 0,
    invalidAllocations: 0,
    foreignClaimConflicts: 0,
    claimsForSingleInventory: 0,
    claimsForExcludedBooking: 0,
    repairSuccesses: 0,
    repairFailures: 0,
    remainingBlockers: 0
  };
}

function isExcludedBookingDoc(booking) {
  if (!booking) return false;
  if (booking.isTest === true) return true;
  if (booking.archivedAt) return true;
  const email = booking.guestInfo?.email;
  if (email && FIXTURE_BOOKING_EMAIL_PATTERN.test(String(email))) return true;
  return false;
}

function occupiedNightSet(booking) {
  const { expandOccupiedSofiaNightDateOnlys } = require('../ops/reporting/stayNights');
  const expanded = expandOccupiedSofiaNightDateOnlys(booking.checkIn, booking.checkOut);
  if (!expanded.ok) return new Set();
  return new Set(expanded.dateOnlys);
}

async function loadBookingsByIds(ids, BookingModel = Booking) {
  const unique = [...new Set(ids.map(String).filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await BookingModel.find({ _id: { $in: unique } })
    .select(
      '_id status checkIn checkOut unitId cabinTypeId cabinId isTest archivedAt guestInfo.email locationBookingId'
    )
    .lean();
  return new Map(rows.map((b) => [String(b._id), b]));
}

async function precheckUniqueIndexDuplicates(UnitNightClaimModel = UnitNightClaim) {
  const rows = await UnitNightClaimModel.aggregate([
    {
      $group: {
        _id: { unitId: '$unitId', night: '$night' },
        n: { $sum: 1 },
        bookingIds: { $addToSet: '$bookingId' },
        claimIds: { $addToSet: '$_id' }
      }
    },
    { $match: { n: { $gt: 1 } } }
  ]);
  return rows.map((r) => ({
    unitId: r._id.unitId ? String(r._id.unitId) : null,
    night: dateOnlyFromNightDate(r._id.night),
    n: r.n,
    bookingIds: sortIds(r.bookingIds),
    claimIds: sortIds(r.claimIds)
  })).sort((a, b) => {
    const ka = `${a.unitId || ''}|${a.night || ''}`;
    const kb = `${b.unitId || ''}|${b.night || ''}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

/**
 * Full classify pass (read-only).
 */
async function classifyReconciliation(opts = {}) {
  const passId = opts.passId || `i5-${Date.now()}`;
  const detectedAt = new Date().toISOString();
  const BookingModel = opts.BookingModel || Booking;
  const UnitNightClaimModel = opts.UnitNightClaimModel || UnitNightClaim;
  const batchSize = Math.max(1, Number(opts.batchSize) || 200);

  const projection = await projectCanonicalExpectedOccupancy({
    BookingModel,
    UnitModel: opts.UnitModel,
    batchSize,
    limit: opts.limit,
    bookingId: opts.bookingId
  });

  const denyWriteKeys = new Set(projection.denyWriteKeys);
  const expectedOwnerByKey = projection.expectedOwnerByKey;
  const drift = [];
  const counts = emptyCounts();

  counts.canonicalCollisions = projection.conflicts.length;
  for (const c of projection.conflicts) {
    const canon = canonicalizeConflict(c);
    drift.push({
      class: DRIFT_CLASS.CANONICAL_UNIT_NIGHT_CONFLICT,
      unitId: canon.unitId,
      unitLabel: canon.unitLabel,
      night: canon.night,
      bookingIds: canon.bookingIds,
      statuses: canon.bookings.map((b) => b.status),
      reason: 'multiple_canonical_blocking_owners'
    });
  }

  for (const inv of projection.invalidAllocations) {
    const cls =
      inv.type === 'malformed_range' || inv.type === 'cabinId_and_cabinTypeId'
        ? DRIFT_CLASS.MALFORMED_BOOKING
        : DRIFT_CLASS.INVALID_ALLOCATION;
    if (cls === DRIFT_CLASS.MALFORMED_BOOKING) counts.malformedAllocations += 1;
    else counts.invalidAllocations += 1;
    drift.push({
      class: cls,
      bookingIds: [inv.bookingId],
      unitId: inv.unitId,
      unitLabel: inv.unitLabel || null,
      night: null,
      statuses: [inv.status],
      reason: inv.type
    });
  }

  for (const u of projection.unallocatedBlocking) {
    counts.unallocatedBlocking += 1;
    drift.push({
      class: DRIFT_CLASS.UNALLOCATED_BLOCKING_BOOKING,
      bookingIds: [u.bookingId],
      unitId: null,
      night: null,
      statuses: [u.status],
      reason: 'cabinType_without_unitId'
    });
  }

  /** @type {Map<string, object[]>} */
  const claimsByKey = new Map();
  const claimFilter = opts.bookingId ? { bookingId: opts.bookingId } : {};
  const claimCursor = UnitNightClaimModel.find(claimFilter)
    .select('_id unitId night bookingId source createdAt')
    .lean()
    .cursor({ batchSize });

  const claimBookingIds = new Set();
  const claimDocs = [];
  for await (const claim of claimCursor) {
    claimDocs.push(claim);
    claimBookingIds.add(String(claim.bookingId));
  }

  const bookingsById = await loadBookingsByIds([...claimBookingIds], BookingModel);

  for (const claim of claimDocs) {
    const unitId = String(claim.unitId);
    const night = dateOnlyFromNightDate(claim.night);
    const key = unitNightKey(unitId, night);
    if (!claimsByKey.has(key)) claimsByKey.set(key, []);
    claimsByKey.get(key).push(claim);
  }

  // Duplicate classification per unit-night key
  for (const [key, rows] of claimsByKey.entries()) {
    const { unitId, night } = parseUnitNightKey(key);
    const byBooking = new Map();
    for (const r of rows) {
      const bid = String(r.bookingId);
      if (!byBooking.has(bid)) byBooking.set(bid, []);
      byBooking.get(bid).push(r);
    }
    if (byBooking.size > 1) {
      counts.foreignOwnerDuplicates += 1;
      denyWriteKeys.add(key);
      const bookingIds = sortIds([...byBooking.keys()]);
      drift.push(
        withSortedBookingIds({
          class: DRIFT_CLASS.DUPLICATE_FOREIGN_OWNER_CLAIM,
          unitId,
          night,
          bookingIds,
          statuses: bookingIds.map((id) => bookingsById.get(id)?.status || null),
          reason: 'multiple_claim_owners_same_unit_night',
          claimIds: rows.map((r) => String(r._id)),
          safe: false
        })
      );
    }
    for (const [bid, list] of byBooking.entries()) {
      if (list.length > 1) {
        counts.sameOwnerDuplicates += 1;
        drift.push(
          withSortedBookingIds({
            class: DRIFT_CLASS.DUPLICATE_SAME_OWNER_CLAIM,
            unitId,
            night,
            bookingIds: [bid],
            statuses: [bookingsById.get(bid)?.status || null],
            reason: 'duplicate_same_owner_rows',
            claimIds: list.map((r) => String(r._id)),
            safe: true
          })
        );
      }
    }
  }

  // Per-claim ownership drift
  for (const claim of claimDocs) {
    const bookingId = String(claim.bookingId);
    const unitId = String(claim.unitId);
    const night = dateOnlyFromNightDate(claim.night);
    const key = unitNightKey(unitId, night);
    const booking = bookingsById.get(bookingId);

    if (!booking) {
      counts.orphans += 1;
      drift.push({
        class: DRIFT_CLASS.ORPHAN_CLAIM,
        unitId,
        night,
        bookingIds: [bookingId],
        statuses: [],
        reason: 'booking_absent',
        claimIds: [String(claim._id)],
        safe: true
      });
      continue;
    }

    if (isExcludedBookingDoc(booking)) {
      counts.claimsForExcludedBooking += 1;
      drift.push({
        class: DRIFT_CLASS.CLAIM_FOR_EXCLUDED_BOOKING,
        unitId,
        night,
        bookingIds: [bookingId],
        statuses: [booking.status],
        reason: booking.archivedAt
          ? 'archived_booking'
          : booking.isTest
            ? 'test_booking'
            : 'fixture_email',
        claimIds: [String(claim._id)],
        safe: false
      });
      continue;
    }

    if (booking.status === 'completed' || booking.status === 'cancelled') {
      counts.safeStale += 1;
      drift.push({
        class: DRIFT_CLASS.STALE_TERMINAL_CLAIM,
        unitId,
        night,
        bookingIds: [bookingId],
        statuses: [booking.status],
        reason: 'terminal_owns_zero_claims',
        claimIds: [String(claim._id)],
        safe: true
      });
      continue;
    }

    const isSingle =
      Boolean(booking.cabinId) && !booking.cabinTypeId && !booking.unitId;
    const isMultiAllocated = Boolean(booking.cabinTypeId && booking.unitId);
    if (!isMultiAllocated) {
      counts.claimsForSingleInventory += 1;
      drift.push({
        class: DRIFT_CLASS.CLAIM_FOR_SINGLE_INVENTORY,
        unitId,
        night,
        bookingIds: [bookingId],
        statuses: [booking.status],
        reason: 'booking_not_multi_allocated',
        claimIds: [String(claim._id)],
        safe: true
      });
      continue;
    }

    if (String(booking.unitId) !== unitId) {
      counts.wrongUnit += 1;
      drift.push({
        class: DRIFT_CLASS.WRONG_UNIT_CLAIM,
        unitId,
        night,
        bookingIds: [bookingId],
        statuses: [booking.status],
        reason: 'claim_unit_ne_booking_unit',
        claimIds: [String(claim._id)],
        safe: true
      });
      continue;
    }

    const nights = occupiedNightSet(booking);
    if (!nights.has(night)) {
      counts.outsideRange += 1;
      drift.push({
        class: DRIFT_CLASS.OUTSIDE_DATE_RANGE_CLAIM,
        unitId,
        night,
        bookingIds: [bookingId],
        statuses: [booking.status],
        reason: 'night_outside_canonical_range',
        claimIds: [String(claim._id)],
        safe: true
      });
    }
  }

  // Missing expected + foreign claim conflicts
  for (const [key, owner] of expectedOwnerByKey.entries()) {
    const { unitId, night } = parseUnitNightKey(key);
    const rows = claimsByKey.get(key) || [];
    const ownerIds = [...new Set(rows.map((r) => String(r.bookingId)))];

    if (rows.length === 0) {
      if (denyWriteKeys.has(key)) continue;
      counts.missing += 1;
      drift.push({
        class: DRIFT_CLASS.MISSING_CLAIM,
        unitId,
        unitLabel: owner.unitLabel || null,
        night,
        bookingIds: [owner.bookingId],
        statuses: [owner.status],
        reason: 'expected_claim_absent',
        safe: true
      });
      continue;
    }

    if (!ownerIds.includes(owner.bookingId) || ownerIds.some((id) => id !== owner.bookingId)) {
      if (ownerIds.length === 1 && ownerIds[0] !== owner.bookingId) {
        counts.foreignClaimConflicts += 1;
        denyWriteKeys.add(key);
        drift.push(
          withSortedBookingIds({
            class: DRIFT_CLASS.FOREIGN_CLAIM_CONFLICT,
            unitId,
            unitLabel: owner.unitLabel || null,
            night,
            bookingIds: [owner.bookingId, ownerIds[0]],
            statuses: [owner.status, bookingsById.get(ownerIds[0])?.status || null],
            reason: 'expected_owner_blocked_by_foreign_claim',
            claimIds: rows.map((r) => String(r._id)),
            safe: false
          })
        );
      }
    }
  }

  const uniqueIndexDuplicates = await precheckUniqueIndexDuplicates(UnitNightClaimModel);
  const actualUnitNightClaimRows = claimDocs.length;

  const remainingBlockers = countRemainingBlockers(counts, uniqueIndexDuplicates.length);
  counts.remainingBlockers = remainingBlockers;

  // Canonicalize drift/report multi-owner fields (classification unchanged).
  for (let i = 0; i < drift.length; i += 1) {
    drift[i] = withSortedBookingIds(drift[i]);
  }
  const canonicalConflicts = projection.conflicts
    .map(canonicalizeConflict)
    .sort((a, b) => {
      const ka = `${a.unitId || ''}|${a.night || ''}`;
      const kb = `${b.unitId || ''}|${b.night || ''}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });

  const inventoryFingerprintPayload = {
    scanCompleteness: projection.scanCompleteness,
    expectedUnitNightClaims: projection.summary.expectedClaims,
    actualUnitNightClaimRows,
    counts: {
      missing: counts.missing,
      safeStale: counts.safeStale,
      orphans: counts.orphans,
      outsideRange: counts.outsideRange,
      wrongUnit: counts.wrongUnit,
      sameOwnerDuplicates: counts.sameOwnerDuplicates,
      foreignOwnerDuplicates: counts.foreignOwnerDuplicates,
      canonicalCollisions: counts.canonicalCollisions,
      unallocatedBlocking: counts.unallocatedBlocking,
      malformedAllocations: counts.malformedAllocations,
      invalidAllocations: counts.invalidAllocations,
      foreignClaimConflicts: counts.foreignClaimConflicts,
      claimsForSingleInventory: counts.claimsForSingleInventory,
      claimsForExcludedBooking: counts.claimsForExcludedBooking,
      remainingBlockers
    },
    denyWriteSize: denyWriteKeys.size,
    uniqueIndexDuplicateKeys: uniqueIndexDuplicates.length,
    conflictKeys: canonicalConflicts.map((c) => `${c.unitId}|${c.night}`).sort(),
    driftClasses: drift.map(driftFingerprintLine).sort()
  };

  const fingerprint = stableHash(inventoryFingerprintPayload);
  const readyCandidate =
    projection.scanCompleteness === 'full' &&
    remainingBlockers === 0 &&
    counts.repairFailures === 0;

  const report = {
    mode: 'classify',
    passId,
    detectedAt,
    scanCompleteness: projection.scanCompleteness,
    readyForI6: false,
    readyForI6Provisional: false,
    fingerprint,
    summary: {
      blockingBookingsScanned: projection.summary.blockingBookingsScanned,
      validAllocatedMultiUnitBookings: projection.summary.validAllocatedMultiUnitBookings,
      expectedUnitNightClaims: projection.summary.expectedClaims,
      actualUnitNightClaimRows,
      ...counts,
      uniqueIndexDuplicateKeys: uniqueIndexDuplicates.length
    },
    drift,
    conflicts: canonicalConflicts,
    uniqueIndexPrecheck: uniqueIndexDuplicates,
    denyWriteKeys: [...denyWriteKeys].sort(),
    expectedOwnerByKeySize: expectedOwnerByKey.size
  };

  if (readyCandidate) {
    report.readyForI6Provisional = true;
  }

  return {
    report,
    projection,
    denyWriteKeys,
    expectedOwnerByKey,
    claimsByKey,
    bookingsById,
    drift,
    counts,
    readyCandidate
  };
}

function countRemainingBlockers(counts, uniqueDupKeys) {
  return (
    counts.missing +
    counts.safeStale +
    counts.orphans +
    counts.outsideRange +
    counts.wrongUnit +
    counts.sameOwnerDuplicates +
    counts.foreignOwnerDuplicates +
    counts.canonicalCollisions +
    counts.malformedAllocations +
    counts.invalidAllocations +
    counts.foreignClaimConflicts +
    counts.claimsForSingleInventory +
    counts.claimsForExcludedBooking +
    counts.repairFailures +
    uniqueDupKeys
  );
  // unallocatedBlocking intentionally excluded from unique-index / READY blockers
}

async function openCanonicalConflictMris(conflicts, { openManualReviewItemFn = openManualReviewItem } = {}) {
  const ids = [];
  for (const c of conflicts) {
    const sortedIds = [...c.bookingIds].map(String).sort();
    const sourceReference = `${c.unitId}|${c.night}|${sortedIds.join(',')}`;
    try {
      // eslint-disable-next-line no-await-in-loop
      const mri = await openManualReviewItemFn({
        category: CANONICAL_CONFLICT_MRI_CATEGORY,
        severity: 'critical',
        entityType: 'Booking',
        entityId: sortedIds[0] || null,
        title: 'UnitNightClaim canonical unit-night conflict',
        details: 'Multiple blocking Bookings occupy the same unit-night; human decision required',
        provenance: {
          source: MRI_SOURCE,
          sourceReference
        },
        evidence: {
          unitId: c.unitId,
          unitLabel: c.unitLabel || null,
          night: c.night,
          bookingIds: sortedIds,
          statuses: (c.bookings || []).map((b) => b.status),
          operation: 'reconcile_canonical_conflict'
        }
      });
      if (mri?._id) ids.push(String(mri._id));
    } catch {
      /* nonfatal */
    }
  }
  return ids;
}

async function applySafeRepairs(classified, opts = {}) {
  const denyWriteKeys = classified.denyWriteKeys;
  const drift = classified.drift;
  const repairLog = [];
  let repairSuccesses = 0;
  let repairFailures = 0;

  const claimUnitNightsFn = opts.claimUnitNightsFn || claimUnitNights;
  const releaseUnitNightsFn = opts.releaseUnitNightsFn || releaseUnitNights;
  const deleteSameOwnerDuplicateClaimsFn =
    opts.deleteSameOwnerDuplicateClaimsFn || deleteSameOwnerDuplicateClaims;

  // 1) Same-owner dedupe
  for (const d of drift) {
    if (d.class !== DRIFT_CLASS.DUPLICATE_SAME_OWNER_CLAIM) continue;
    const key = unitNightKey(d.unitId, d.night);
    if (denyWriteKeys.has(key)) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await deleteSameOwnerDuplicateClaimsFn({
        unitId: d.unitId,
        night: d.night,
        bookingId: d.bookingIds[0]
      });
      repairSuccesses += 1;
      repairLog.push({ class: d.class, ok: true, deletedCount: r.deletedCount, key });
    } catch (err) {
      repairFailures += 1;
      repairLog.push({ class: d.class, ok: false, error: err.message, key });
    }
  }

  // 2) Release-oriented safe classes (group by bookingId where all-claims release works)
  const releaseBookingIds = new Set();
  for (const d of drift) {
    if (
      d.class === DRIFT_CLASS.STALE_TERMINAL_CLAIM ||
      d.class === DRIFT_CLASS.ORPHAN_CLAIM ||
      d.class === DRIFT_CLASS.CLAIM_FOR_SINGLE_INVENTORY
    ) {
      releaseBookingIds.add(d.bookingIds[0]);
    }
  }
  for (const bookingId of releaseBookingIds) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await releaseUnitNightsFn({ bookingId });
      repairSuccesses += 1;
      repairLog.push({ class: 'RELEASE_BY_BOOKING', ok: true, bookingId });
    } catch (err) {
      repairFailures += 1;
      repairLog.push({ class: 'RELEASE_BY_BOOKING', ok: false, bookingId, error: err.message });
    }
  }

  // Outside-range / wrong-unit: release scoped nights for that booking+unit
  for (const d of drift) {
    if (
      d.class !== DRIFT_CLASS.OUTSIDE_DATE_RANGE_CLAIM &&
      d.class !== DRIFT_CLASS.WRONG_UNIT_CLAIM
    ) {
      continue;
    }
    const key = unitNightKey(d.unitId, d.night);
    if (denyWriteKeys.has(key)) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await releaseUnitNightsFn({
        bookingId: d.bookingIds[0],
        unitId: d.unitId,
        nights: [d.night]
      });
      repairSuccesses += 1;
      repairLog.push({ class: d.class, ok: true, key });
    } catch (err) {
      repairFailures += 1;
      repairLog.push({ class: d.class, ok: false, key, error: err.message });
    }
  }

  // 3) Missing creates — skip deny-write
  for (const d of drift) {
    if (d.class !== DRIFT_CLASS.MISSING_CLAIM) continue;
    const key = unitNightKey(d.unitId, d.night);
    if (denyWriteKeys.has(key)) {
      repairLog.push({ class: d.class, ok: false, skipped: true, reason: 'deny_write', key });
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      await claimUnitNightsFn({
        bookingId: d.bookingIds[0],
        unitId: d.unitId,
        nights: [d.night],
        source: 'bootstrap'
      });
      repairSuccesses += 1;
      repairLog.push({ class: d.class, ok: true, key });
    } catch (err) {
      repairFailures += 1;
      repairLog.push({ class: d.class, ok: false, key, error: err.message, code: err.code });
    }
  }

  if (opts.writeConflictMri) {
    await openCanonicalConflictMris(classified.projection.conflicts, {
      openManualReviewItemFn: opts.openManualReviewItemFn || openManualReviewItem
    });
  }

  return { repairSuccesses, repairFailures, repairLog };
}

/**
 * Run reconciliation.
 * @param {object} opts
 * @param {'classify'|'verify'|'apply-safe'} [opts.mode]
 */
async function runUnitNightClaimReconciliation(opts = {}) {
  const mode = opts.mode || 'classify';
  const mutating = mode === 'apply-safe';

  if (mutating && opts.limit != null) {
    const err = new Error('--apply-safe cannot be combined with --limit');
    err.code = 'I5_UNSAFE_FLAGS';
    throw err;
  }

  let classified = await classifyReconciliation(opts);
  let repairMeta = { repairSuccesses: 0, repairFailures: 0, repairLog: [] };

  if (mutating) {
    repairMeta = await applySafeRepairs(classified, {
      ...opts,
      writeConflictMri: true
    });
    classified = await classifyReconciliation({
      ...opts,
      passId: `${opts.passId || 'i5'}-post`
    });
    classified.report.summary.repairSuccesses = repairMeta.repairSuccesses;
    classified.report.summary.repairFailures = repairMeta.repairFailures;
    classified.counts.repairFailures = repairMeta.repairFailures;
    classified.counts.repairSuccesses = repairMeta.repairSuccesses;
    classified.report.summary.remainingBlockers = countRemainingBlockers(
      {
        ...classified.counts,
        repairFailures: repairMeta.repairFailures
      },
      classified.report.summary.uniqueIndexDuplicateKeys || 0
    );
    classified.readyCandidate =
      classified.report.scanCompleteness === 'full' &&
      classified.report.summary.remainingBlockers === 0 &&
      repairMeta.repairFailures === 0;
    classified.report.readyForI6Provisional = classified.readyCandidate;
  }

  // Stable verification: caller may pass priorFingerprint for second pass
  let readyForI6 = false;
  let stableVerification = {
    required: true,
    satisfied: false,
    priorFingerprint: opts.priorFingerprint || null,
    currentFingerprint: classified.report.fingerprint
  };

  if (
    opts.requireStable === true &&
    opts.priorFingerprint &&
    classified.readyCandidate &&
    opts.priorFingerprint === classified.report.fingerprint &&
    classified.report.scanCompleteness === 'full'
  ) {
    readyForI6 = true;
    stableVerification.satisfied = true;
  }

  // Single clean full pass is provisional only — never true ready without stable pair
  // unless caller explicitly sets allowProvisionalReady (tests only — default false)
  if (opts.allowProvisionalReady === true && classified.readyCandidate) {
    readyForI6 = true;
  }

  classified.report.mode = mode;
  classified.report.readyForI6 = readyForI6;
  classified.report.stableVerification = stableVerification;
  classified.report.repairLog = repairMeta.repairLog;

  let uniqueIndexPresent = false;
  try {
    const indexes = await UnitNightClaim.collection.indexes();
    const spec = AUTHORITATIVE_UNIQUE_INDEX_SPEC;
    uniqueIndexPresent = (indexes || []).some(
      (ix) =>
        ix &&
        ix.name === spec.options.name &&
        ix.unique === true &&
        ix.key &&
        Number(ix.key.unitId) === 1 &&
        Number(ix.key.night) === 1
    );
  } catch {
    uniqueIndexPresent = false;
  }
  classified.report.uniqueIndexPresent = uniqueIndexPresent;
  classified.report.claimsRemainShadow = !uniqueIndexPresent;

  return classified.report;
}

function exitCodeForReport(report) {
  if (!report) return 1;
  if (report.readyForI6 === true && report.scanCompleteness === 'full') return 0;
  return 2;
}

module.exports = {
  DRIFT_CLASS,
  SAFE_CLASSES,
  CANONICAL_CONFLICT_MRI_CATEGORY,
  MRI_SOURCE,
  classifyReconciliation,
  runUnitNightClaimReconciliation,
  applySafeRepairs,
  precheckUniqueIndexDuplicates,
  exitCodeForReport,
  countRemainingBlockers,
  stableHash,
  sortIds,
  withSortedBookingIds,
  canonicalizeConflict,
  driftFingerprintLine,
  isExcludedBookingDoc
};
