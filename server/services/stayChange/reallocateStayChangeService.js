'use strict';

/**
 * R1 StayChange REALLOCATE domain service.
 * Binding: docs/stay-change-implementation-plan.md §21
 *
 * Staged inventory order (no combined transferUnitNightClaims):
 * target claims → Booking CAS → reservation block sync → source release
 */

const crypto = require('crypto');
const mongoose = require('mongoose');
const StayChange = require('../../models/StayChange');
const Booking = require('../../models/Booking');
const Unit = require('../../models/Unit');
const AvailabilityBlock = require('../../models/AvailabilityBlock');
const {
  claimUnitNights,
  releaseUnitNights,
  releaseStayChangeTargetClaims,
  assertBookingOwnsNights,
  ERR: CLAIM_ERR,
  dateOnlyFromNightDate,
  expandOccupiedSofiaNightDateOnlys
} = require('../inventory/unitNightClaimService');
const { evaluateTargetConflicts } = require('../ops/domain/conflictService');
const { findParentCabinForCabinType } = require('../publicAvailabilityService');
const { createDomainError } = require('../ops/domain/errors');
const { requirePermission, ACTIONS } = require('../permissionService');
const { appendAuditEvent } = require('../auditWriter');
const { openManualReviewItem } = require('../ops/ingestion/manualReviewService');
const { formatSofiaDateOnly, normalizeDateToSofiaDayStart } = require('../../utils/dateTime');
const { assertStayChangeIdempotencyIndex } = require('./stayChangeIndexes');

const KIND = 'reallocate';
const ELIGIBLE_STATUSES = Object.freeze(['pending', 'confirmed']);
const MRI_CATEGORY = 'stay_change_reallocate_reconciliation';
const MRI_SOURCE = 'stay_change_reallocate';
const AUDIT_ACTION = 'reservation_reallocate';

/** Ordered keys for fingerprint JSON — never rely on object insertion accidents. */
const FINGERPRINT_KEYS = Object.freeze([
  'kind',
  'bookingId',
  'sourceUnitId',
  'targetUnitId',
  'checkIn',
  'checkOut',
  'commercialProductKey',
  'acceptExternalHoldWarnings',
  'reason'
]);

function commercialProductKeyFromBooking(booking) {
  if (booking.cabinTypeId) return `cabinType:${String(booking.cabinTypeId)}`;
  if (booking.cabinId) return `cabin:${String(booking.cabinId)}`;
  return null;
}

function normalizeIdempotencyKey(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim();
}

function isValidIdempotencyKey(key) {
  return typeof key === 'string' && key.length >= 8 && key.length <= 128;
}

/**
 * Canonical Sofia civil date (YYYY-MM-DD) for stay boundaries.
 * Accepts Date, ISO instant, or YYYY-MM-DD — all normalize via Europe/Sofia day-start.
 */
function canonicalStayDateOnly(input) {
  if (input == null || input === '') {
    throw createDomainError('validation', 'Stay date is required for payload fingerprint', {
      code: 'FINGERPRINT_DATE_REQUIRED'
    });
  }
  const dayStart = normalizeDateToSofiaDayStart(input);
  const dateOnly = formatSofiaDateOnly(dayStart);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
    throw createDomainError('validation', 'Stay date could not be canonicalized', {
      code: 'FINGERPRINT_DATE_INVALID'
    });
  }
  return dateOnly;
}

function normalizeReasonForFingerprint(reason) {
  if (reason == null || reason === '') return '';
  return String(reason).trim().slice(0, 500);
}

/**
 * Deterministic SHA-256 fingerprint of the accepted R1 REALLOCATE payload.
 * Dates are Sofia YYYY-MM-DD; serialization uses fixed key order.
 */
function buildPayloadFingerprint({
  kind,
  bookingId,
  sourceUnitId,
  targetUnitId,
  checkIn,
  checkOut,
  commercialProductKey,
  acceptExternalHoldWarnings,
  reason
}) {
  const values = {
    kind: String(kind),
    bookingId: String(bookingId),
    sourceUnitId: String(sourceUnitId),
    targetUnitId: String(targetUnitId),
    checkIn: canonicalStayDateOnly(checkIn),
    checkOut: canonicalStayDateOnly(checkOut),
    commercialProductKey: String(commercialProductKey),
    acceptExternalHoldWarnings: Boolean(acceptExternalHoldWarnings),
    reason: normalizeReasonForFingerprint(reason)
  };
  const canonical = `{${FINGERPRINT_KEYS.map((k) => `${JSON.stringify(k)}:${JSON.stringify(values[k])}`).join(',')}}`;
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function auditDedupeKeyFor(stayChangeId) {
  return `reservation_reallocate:${String(stayChangeId)}`;
}

function toResult(sc, { changed = true, warnings = [] } = {}) {
  if (!sc) {
    return {
      bookingId: null,
      stayChangeId: null,
      kind: KIND,
      status: null,
      sourceUnitId: null,
      targetUnitId: null,
      changed: false,
      warnings
    };
  }
  return {
    bookingId: String(sc.bookingId),
    stayChangeId: String(sc._id),
    kind: sc.kind,
    status: sc.status,
    sourceUnitId: String(sc.sourceUnitId),
    targetUnitId: String(sc.targetUnitId),
    changed,
    warnings
  };
}

function sameIntent(sc, fingerprint) {
  return sc.payloadFingerprint === fingerprint;
}

async function markFailed(sc, { code, message, phase }) {
  sc.status = 'failed';
  sc.failure = {
    code: code || null,
    message: message || null,
    phase: phase || null,
    at: new Date()
  };
  await sc.save();
  return sc;
}

async function markNeedsReconciliation(sc, { category, detail, phase }) {
  const sourceReference = `${String(sc._id)}:${phase || sc.status || 'reallocate'}`;
  let mriId = null;
  try {
    const mri = await openManualReviewItem({
      category: MRI_CATEGORY,
      severity: 'critical',
      entityType: 'StayChange',
      entityId: String(sc._id),
      title: 'StayChange REALLOCATE needs reconciliation',
      details: detail || category || 'Post-commit inventory cleanup incomplete',
      provenance: {
        source: MRI_SOURCE,
        sourceReference
      },
      evidence: {
        stayChangeId: String(sc._id),
        bookingId: String(sc.bookingId),
        sourceUnitId: String(sc.sourceUnitId),
        targetUnitId: String(sc.targetUnitId),
        phase: phase || null,
        failureCategory: category || null,
        status: sc.status
      }
    });
    mriId = mri?._id ? String(mri._id) : null;
  } catch {
    /* MRI best-effort */
  }
  sc.status = 'needs_reconciliation';
  sc.reconciliation = {
    category: category || null,
    detail: detail || null,
    mriId,
    at: new Date()
  };
  sc.failure = {
    code: category || 'NEEDS_RECONCILIATION',
    message: detail || null,
    phase: phase || null,
    at: new Date()
  };
  await sc.save();
  return sc;
}

async function compensateOwnTargetClaims(sc) {
  return releaseStayChangeTargetClaims({
    bookingId: sc.bookingId,
    stayChangeId: sc._id,
    unitId: sc.targetUnitId,
    checkIn: sc.checkIn,
    checkOut: sc.checkOut
  });
}

async function countOwnTargetClaims(sc) {
  const UnitNightClaim = require('../../models/UnitNightClaim');
  const expanded = expandOccupiedSofiaNightDateOnlys(sc.checkIn, sc.checkOut);
  if (!expanded.ok) return { ok: false, count: 0, expected: 0 };
  const nights = expanded.dateOnlys;
  const count = await UnitNightClaim.countDocuments({
    bookingId: sc.bookingId,
    stayChangeId: sc._id,
    unitId: sc.targetUnitId
  });
  return { ok: true, count, expected: nights.length, nights };
}

async function sourceClaimCount(sc) {
  const UnitNightClaim = require('../../models/UnitNightClaim');
  return UnitNightClaim.countDocuments({
    bookingId: sc.bookingId,
    unitId: sc.sourceUnitId
  });
}

async function targetClaimExact(sc) {
  const ownership = await assertBookingOwnsNights({
    bookingId: sc.bookingId,
    unitId: sc.targetUnitId,
    checkIn: sc.checkIn,
    checkOut: sc.checkOut,
    mode: 'exact'
  });
  return ownership;
}

/**
 * Sync reservation-owned AvailabilityBlock unit projection.
 * If no reservation blocks exist, returns ok (Booking is SoT for calendar synthesis).
 */
async function syncReservationBlockUnitProjection(bookingId, targetUnitId) {
  const filter = {
    reservationId: bookingId,
    blockType: 'reservation',
    status: 'active'
  };
  const existing = await AvailabilityBlock.find(filter).select('_id unitId').lean();
  if (existing.length === 0) {
    return { ok: true, mutated: false, reason: 'no_reservation_blocks', count: 0 };
  }
  await AvailabilityBlock.updateMany(filter, {
    $set: { unitId: targetUnitId }
  });
  const remaining = await AvailabilityBlock.countDocuments({
    ...filter,
    $or: [{ unitId: { $ne: targetUnitId } }, { unitId: null }]
  });
  if (remaining > 0) {
    return {
      ok: false,
      mutated: true,
      reason: 'unit_mismatch_after_update',
      count: existing.length,
      remaining
    };
  }
  return { ok: true, mutated: true, reason: 'updated', count: existing.length };
}

async function projectAuditOnce(sc, ctx, warnings = []) {
  if (sc.auditProjectedAt) return { ok: true, already: true };
  const dedupeKey = sc.auditDedupeKey || auditDedupeKeyFor(sc._id);
  try {
    await appendAuditEvent(
      {
        actorType: sc.actor?.actorType || 'user',
        actorId: sc.actor?.actorId || ctx.user?.id || 'admin',
        actorRole: sc.actor?.actorRole || ctx.user?.role || null,
        entityType: 'Reservation',
        entityId: String(sc.bookingId),
        action: AUDIT_ACTION,
        beforeSnapshot: { unitId: String(sc.sourceUnitId) },
        afterSnapshot: { unitId: String(sc.targetUnitId) },
        metadata: {
          stayChangeId: String(sc._id),
          warningsAccepted: Boolean(sc.externalHoldWarningsAccepted),
          warningCount: Array.isArray(warnings) ? warnings.length : 0
        },
        dedupeKey,
        reason: sc.reason || null,
        sourceContext: {
          route: ctx.route || null,
          namespace: 'ops'
        }
      },
      { req: ctx.req }
    );
  } catch (err) {
    if (err?.code === 11000 || String(err?.message || '').includes('E11000')) {
      /* durable dedupe — treat as success */
    } else {
      try {
        await openManualReviewItem({
          category: MRI_CATEGORY,
          severity: 'high',
          entityType: 'StayChange',
          entityId: String(sc._id),
          title: 'StayChange REALLOCATE audit projection failed',
          details: err?.message || 'Audit projection failed after safe inventory move',
          provenance: {
            source: MRI_SOURCE,
            sourceReference: `${String(sc._id)}:audit`
          },
          evidence: {
            stayChangeId: String(sc._id),
            bookingId: String(sc.bookingId),
            phase: 'audit'
          }
        });
      } catch {
        /* ignore */
      }
      return { ok: false, error: err };
    }
  }
  sc.auditDedupeKey = dedupeKey;
  sc.auditProjectedAt = new Date();
  await sc.save();
  return { ok: true, already: false };
}

async function verifyCompletionInvariant(sc) {
  const booking = await Booking.findById(sc.bookingId).select('unitId').lean();
  if (!booking || String(booking.unitId) !== String(sc.targetUnitId)) {
    return { ok: false, reason: 'booking_unit_mismatch' };
  }
  const targetOwn = await targetClaimExact(sc);
  if (!targetOwn.ok) return { ok: false, reason: 'target_claims_inexact', detail: targetOwn };
  const srcCount = await sourceClaimCount(sc);
  if (srcCount !== 0) return { ok: false, reason: 'source_claims_remain', count: srcCount };
  const blockSync = await syncReservationBlockUnitProjection(sc.bookingId, sc.targetUnitId);
  if (!blockSync.ok) return { ok: false, reason: 'block_not_aligned', detail: blockSync };
  return { ok: true };
}

async function advanceToCompleted(sc, ctx, warnings = []) {
  const inv = await verifyCompletionInvariant(sc);
  if (!inv.ok) {
    await markNeedsReconciliation(sc, {
      category: 'COMPLETION_INVARIANT_FAILED',
      detail: inv.reason,
      phase: 'complete'
    });
    return sc;
  }
  sc.status = 'completed';
  sc.completedAt = new Date();
  await sc.save();
  await projectAuditOnce(sc, ctx, warnings);
  return sc;
}

async function casBookingToTarget(sc) {
  const result = await Booking.updateOne(
    {
      _id: sc.bookingId,
      unitId: sc.sourceUnitId,
      cabinTypeId: sc.sourceCabinTypeId,
      status: { $in: ELIGIBLE_STATUSES }
    },
    { $set: { unitId: sc.targetUnitId } }
  );
  return {
    matched: (result.matchedCount ?? result.n) > 0,
    modified: (result.modifiedCount ?? result.nModified) > 0
  };
}

async function acquireAllTargetClaims(sc) {
  return claimUnitNights({
    bookingId: sc.bookingId,
    unitId: sc.targetUnitId,
    checkIn: sc.checkIn,
    checkOut: sc.checkOut,
    stayChangeId: sc._id,
    source: 'reallocate',
    requireExactStayChangeOwnership: true
  });
}

/**
 * Resume / converge a durable StayChange from facts.
 */
async function reconcileReallocateStayChange(stayChangeId, ctx = {}) {
  const sc = await StayChange.findById(stayChangeId);
  if (!sc) {
    throw createDomainError('validation', 'StayChange not found', { stayChangeId }, 404);
  }
  if (sc.kind !== KIND) {
    throw createDomainError('validation', 'StayChange is not a reallocate operation', {
      kind: sc.kind
    });
  }
  if (sc.status === 'completed') {
    return toResult(sc, { changed: true });
  }
  if (sc.status === 'failed') {
    return toResult(sc, { changed: false });
  }

  const booking = await Booking.findById(sc.bookingId);
  if (!booking) {
    await markNeedsReconciliation(sc, {
      category: 'BOOKING_MISSING',
      detail: 'Booking missing during reconcile',
      phase: 'reconcile'
    });
    return toResult(sc, { changed: false });
  }

  const ownTarget = await countOwnTargetClaims(sc);
  const bookingUnit = booking.unitId ? String(booking.unitId) : null;
  const sourceUnit = String(sc.sourceUnitId);
  const targetUnit = String(sc.targetUnitId);

  // Ambiguous: foreign/other StayChange ownership on target nights
  if (ownTarget.ok && ownTarget.count > 0 && ownTarget.count < ownTarget.expected) {
    // Partial own target — finish acquiring remaining nights
    try {
      await acquireAllTargetClaims(sc);
    } catch (err) {
      try {
        await compensateOwnTargetClaims(sc);
        await markFailed(sc, {
          code: err.code || 'TARGET_ACQUIRE_FAILED',
          message: err.message,
          phase: 'reconcile_partial_target'
        });
      } catch (compErr) {
        await markNeedsReconciliation(sc, {
          category: 'TARGET_COMPENSATION_FAILED',
          detail: compErr.message,
          phase: 'reconcile_partial_target'
        });
      }
      return toResult(sc, { changed: false });
    }
  }

  const ownAfter = await countOwnTargetClaims(sc);
  const bookingIsTarget = bookingUnit === targetUnit;
  const bookingIsSource = bookingUnit === sourceUnit;

  if (bookingUnit && bookingUnit !== sourceUnit && bookingUnit !== targetUnit) {
    // Another operation won a different unit
    try {
      await compensateOwnTargetClaims(sc);
      await markFailed(sc, {
        code: 'CAS_LOST_OTHER_UNIT',
        message: 'Booking moved to a different unit by another operation',
        phase: 'reconcile'
      });
    } catch (compErr) {
      await markNeedsReconciliation(sc, {
        category: 'LOSER_COMPENSATION_FAILED',
        detail: compErr.message,
        phase: 'reconcile'
      });
    }
    return toResult(sc, { changed: false });
  }

  if (!bookingIsTarget && ownAfter.ok && ownAfter.count === 0 && sc.status === 'pending') {
    // Resume forward: acquire targets then continue staged path
    try {
      await acquireAllTargetClaims(sc);
      sc.status = 'inventory_secured';
      await sc.save();
    } catch (err) {
      try {
        await compensateOwnTargetClaims(sc);
        await markFailed(sc, {
          code: err.code || 'TARGET_ACQUIRE_FAILED',
          message: err.message,
          phase: 'reconcile_pending_acquire'
        });
      } catch (compErr) {
        await markNeedsReconciliation(sc, {
          category: 'TARGET_COMPENSATION_FAILED',
          detail: compErr.message,
          phase: 'reconcile_pending_acquire'
        });
      }
      return toResult(await StayChange.findById(sc._id), { changed: false });
    }
  }

  if (!bookingIsTarget && ownAfter.ok && ownAfter.count === ownAfter.expected) {
    if (sc.status === 'pending') {
      sc.status = 'inventory_secured';
      await sc.save();
    }
    if (bookingIsSource) {
      const cas = await casBookingToTarget(sc);
      if (!cas.matched) {
        const fresh = await Booking.findById(sc.bookingId);
        if (fresh && String(fresh.unitId) === targetUnit) {
          sc.status = 'committed';
          await sc.save();
        } else {
          try {
            await compensateOwnTargetClaims(sc);
            await markFailed(sc, {
              code: 'CAS_FAILED',
              message: 'Booking CAS did not match source preconditions',
              phase: 'reconcile_cas'
            });
          } catch (compErr) {
            await markNeedsReconciliation(sc, {
              category: 'CAS_LOSER_COMPENSATION_FAILED',
              detail: compErr.message,
              phase: 'reconcile_cas'
            });
          }
          return toResult(sc, { changed: false });
        }
      } else {
        sc.status = 'committed';
        await sc.save();
      }
    }
  }

  const booking2 = await Booking.findById(sc.bookingId);
  if (booking2 && String(booking2.unitId) === targetUnit) {
    if (sc.status === 'inventory_secured' || sc.status === 'pending') {
      sc.status = 'committed';
      await sc.save();
    }

    const block = await syncReservationBlockUnitProjection(sc.bookingId, sc.targetUnitId);
    if (!block.ok) {
      await markNeedsReconciliation(sc, {
        category: 'BLOCK_SYNC_FAILED',
        detail: block.reason,
        phase: 'block_sync'
      });
      return toResult(sc, { changed: true });
    }

    try {
      await releaseUnitNights({
        bookingId: sc.bookingId,
        unitId: sc.sourceUnitId,
        checkIn: sc.checkIn,
        checkOut: sc.checkOut
      });
    } catch (relErr) {
      await markNeedsReconciliation(sc, {
        category: 'SOURCE_RELEASE_FAILED',
        detail: relErr.message,
        phase: 'source_release'
      });
      return toResult(sc, { changed: true });
    }

    await advanceToCompleted(sc, ctx);
  }

  return toResult(await StayChange.findById(sc._id), {
    changed: String((await Booking.findById(sc.bookingId))?.unitId) === targetUnit
  });
}

async function createPendingStayChange({
  booking,
  sourceUnitId,
  targetUnitId,
  cabinTypeId,
  productKey,
  fingerprint,
  idempotencyKey,
  reason,
  acceptExternalHoldWarnings,
  ctx
}) {
  const doc = {
    kind: KIND,
    bookingId: booking._id,
    sourceCommercialProductKey: productKey,
    targetCommercialProductKey: productKey,
    sourceCabinTypeId: cabinTypeId,
    targetCabinTypeId: cabinTypeId,
    sourceUnitId,
    targetUnitId,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    status: 'pending',
    idempotencyKey,
    payloadFingerprint: fingerprint,
    actor: {
      actorType: 'user',
      actorId: ctx.user?.id || 'admin',
      actorRole: ctx.user?.role || 'admin'
    },
    reason: reason || null,
    externalHoldWarningsAccepted: Boolean(acceptExternalHoldWarnings)
  };
  try {
    const sc = await StayChange.create(doc);
    sc.auditDedupeKey = auditDedupeKeyFor(sc._id);
    await sc.save();
    return sc;
  } catch (err) {
    if (err?.code === 11000) {
      const existing = await StayChange.findOne({
        kind: KIND,
        bookingId: booking._id,
        idempotencyKey
      });
      if (!existing) throw err;
      if (!sameIntent(existing, fingerprint)) {
        throw createDomainError(
          'conflict',
          'Idempotency key already used with a different REALLOCATE payload',
          {
            code: 'IDEMPOTENCY_KEY_CONFLICT',
            stayChangeId: String(existing._id)
          },
          409
        );
      }
      return existing;
    }
    throw err;
  }
}

async function runNewReallocate(sc, ctx, warnings) {
  // Target acquisition
  try {
    await acquireAllTargetClaims(sc);
  } catch (err) {
    try {
      await compensateOwnTargetClaims(sc);
      await markFailed(sc, {
        code: err.code || 'TARGET_ACQUIRE_FAILED',
        message: err.message,
        phase: 'target_acquire'
      });
    } catch (compErr) {
      await markNeedsReconciliation(sc, {
        category: 'TARGET_COMPENSATION_FAILED',
        detail: compErr.message,
        phase: 'target_acquire'
      });
    }
    if (err.code === CLAIM_ERR.FOREIGN_OWNER || err.code === CLAIM_ERR.STAY_CHANGE_OWNERSHIP_CONFLICT) {
      throw createDomainError(
        'conflict',
        err.message,
        { code: err.code === CLAIM_ERR.STAY_CHANGE_OWNERSHIP_CONFLICT ? 'STAY_CHANGE_TARGET_CONFLICT' : 'NOT_AVAILABLE', details: err.details || null },
        409
      );
    }
    throw err;
  }

  sc.status = 'inventory_secured';
  await sc.save();

  const cas = await casBookingToTarget(sc);
  if (!cas.matched) {
    const fresh = await Booking.findById(sc.bookingId);
    if (fresh && String(fresh.unitId) === String(sc.targetUnitId)) {
      // Another path already moved — treat as committed for this StayChange if same target
      sc.status = 'committed';
      await sc.save();
    } else {
      try {
        await compensateOwnTargetClaims(sc);
        await markFailed(sc, {
          code: 'CAS_FAILED',
          message: 'Booking compare-and-set did not match',
          phase: 'cas'
        });
      } catch (compErr) {
        await markNeedsReconciliation(sc, {
          category: 'CAS_LOSER_COMPENSATION_FAILED',
          detail: compErr.message,
          phase: 'cas'
        });
      }
      throw createDomainError(
        'conflict',
        'Reservation was modified concurrently; REALLOCATE did not commit',
        { code: 'BOOKING_CAS_FAILED', stayChangeId: String(sc._id) },
        409
      );
    }
  } else {
    sc.status = 'committed';
    await sc.save();
  }

  const block = await syncReservationBlockUnitProjection(sc.bookingId, sc.targetUnitId);
  if (!block.ok) {
    await markNeedsReconciliation(sc, {
      category: 'BLOCK_SYNC_FAILED',
      detail: block.reason,
      phase: 'block_sync'
    });
    throw createDomainError(
      'conflict',
      'Booking moved but reservation block projection could not be synchronized',
      { code: 'BLOCK_SYNC_FAILED', stayChangeId: String(sc._id), status: 'needs_reconciliation' },
      409
    );
  }

  try {
    await releaseUnitNights({
      bookingId: sc.bookingId,
      unitId: sc.sourceUnitId,
      checkIn: sc.checkIn,
      checkOut: sc.checkOut
    });
  } catch (relErr) {
    await markNeedsReconciliation(sc, {
      category: 'SOURCE_RELEASE_FAILED',
      detail: relErr.message,
      phase: 'source_release'
    });
    throw createDomainError(
      'conflict',
      'Booking moved but source claims could not be released',
      { code: 'SOURCE_RELEASE_FAILED', stayChangeId: String(sc._id), status: 'needs_reconciliation' },
      409
    );
  }

  await advanceToCompleted(sc, ctx, warnings);
  return toResult(await StayChange.findById(sc._id), { changed: true, warnings });
}

/**
 * OPS REALLOCATE entry point.
 */
async function reallocateReservation({
  bookingId,
  targetUnitId,
  idempotencyKey,
  reason = null,
  acceptExternalHoldWarnings = false,
  ctx = {}
} = {}) {
  requirePermission({
    role: ctx.user?.role,
    action: ACTIONS.OPS_RESERVATION_REASSIGN
  });

  const key = normalizeIdempotencyKey(idempotencyKey);
  if (!isValidIdempotencyKey(key)) {
    throw createDomainError(
      'validation',
      'idempotencyKey is required (8–128 characters)',
      { code: 'IDEMPOTENCY_KEY_REQUIRED' },
      400
    );
  }
  if (!targetUnitId) {
    throw createDomainError('validation', 'targetUnitId is required', { field: 'targetUnitId' }, 400);
  }

  // 1) Lookup existing StayChange BEFORE deriving source from Booking
  const existing = await StayChange.findOne({
    kind: KIND,
    bookingId,
    idempotencyKey: key
  });

  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw createDomainError('validation', 'Reservation not found', { bookingId }, 404);
  }

  if (existing) {
    // Replay: STORED source snapshot + incoming intent fields → fingerprint.
    // Stored payloadFingerprint is authoritative. No semantic OR fallback.
    const replayFingerprint = buildPayloadFingerprint({
      kind: KIND,
      bookingId: existing.bookingId,
      sourceUnitId: existing.sourceUnitId,
      targetUnitId,
      checkIn: existing.checkIn,
      checkOut: existing.checkOut,
      commercialProductKey: existing.sourceCommercialProductKey,
      acceptExternalHoldWarnings: Boolean(acceptExternalHoldWarnings),
      reason
    });
    if (existing.payloadFingerprint !== replayFingerprint) {
      throw createDomainError(
        'conflict',
        'Idempotency key already used with a different REALLOCATE payload',
        { code: 'IDEMPOTENCY_KEY_CONFLICT', stayChangeId: String(existing._id) },
        409
      );
    }
    if (existing.status === 'completed') {
      return toResult(existing, { changed: true });
    }
    if (existing.status === 'failed') {
      return toResult(existing, { changed: false });
    }
    return reconcileReallocateStayChange(existing._id, ctx);
  }

  // NEW operation — require durable uniqueness index
  try {
    await assertStayChangeIdempotencyIndex();
  } catch (err) {
    throw createDomainError(
      'dependency_failure',
      'REALLOCATE cannot start: StayChange idempotency index is not ready',
      { code: err.code || 'STAY_CHANGE_IDEMPOTENCY_INDEX_MISSING' },
      503
    );
  }

  // Eligibility
  if (!ELIGIBLE_STATUSES.includes(booking.status)) {
    throw createDomainError(
      'invalid_transition',
      `Cannot REALLOCATE reservation in status ${booking.status}`,
      { status: booking.status, allowedFrom: ELIGIBLE_STATUSES, code: 'STATUS_NOT_ELIGIBLE' },
      409
    );
  }
  if (booking.cabinId && !booking.cabinTypeId) {
    throw createDomainError(
      'conflict',
      'Single-cabin reservations cannot use REALLOCATE',
      { code: 'SINGLE_CABIN_NOT_REALLOCATE' },
      409
    );
  }
  if (!booking.cabinTypeId) {
    throw createDomainError(
      'conflict',
      'REALLOCATE requires cabinType inventory',
      { code: 'CABIN_TYPE_REQUIRED' },
      409
    );
  }
  if (!booking.unitId) {
    throw createDomainError(
      'conflict',
      'Unallocated multi-unit reservations cannot use REALLOCATE',
      { code: 'UNIT_ALLOCATION_REQUIRED' },
      409
    );
  }
  if (booking.cabinId && booking.cabinTypeId) {
    throw createDomainError(
      'conflict',
      'Malformed multi-inventory identity cannot use REALLOCATE',
      { code: 'MALFORMED_INVENTORY_IDENTITY' },
      409
    );
  }

  const sourceUnitId = booking.unitId;
  const cabinTypeId = booking.cabinTypeId;
  const productKey = commercialProductKeyFromBooking(booking);
  if (!productKey || !productKey.startsWith('cabinType:')) {
    throw createDomainError(
      'conflict',
      'REALLOCATE requires cabinType commercial product',
      { code: 'COMMERCIAL_PRODUCT_INVALID' },
      409
    );
  }

  // Same-unit no-op (no existing StayChange)
  if (String(sourceUnitId) === String(targetUnitId)) {
    return {
      bookingId: String(booking._id),
      stayChangeId: null,
      kind: KIND,
      status: null,
      sourceUnitId: String(sourceUnitId),
      targetUnitId: String(targetUnitId),
      changed: false,
      warnings: []
    };
  }

  const targetUnit = await Unit.findById(targetUnitId).lean();
  if (!targetUnit || !targetUnit.isActive) {
    throw createDomainError(
      'conflict',
      'Target unit is not active or does not exist',
      { code: 'UNIT_NOT_FOUND_OR_INACTIVE' },
      409
    );
  }
  if (String(targetUnit.cabinTypeId) !== String(cabinTypeId)) {
    throw createDomainError(
      'conflict',
      'Target unit does not belong to this cabin type',
      { code: 'UNIT_CABIN_TYPE_MISMATCH' },
      409
    );
  }

  const parentCabin = await findParentCabinForCabinType(cabinTypeId);
  if (!parentCabin?._id) {
    throw createDomainError(
      'validation',
      'Parent cabin not found for multi-unit REALLOCATE',
      { cabinTypeId: String(cabinTypeId) },
      409
    );
  }

  const conflicts = await evaluateTargetConflicts({
    cabinId: parentCabin._id,
    unitId: targetUnitId,
    cabinTypeId,
    startDate: booking.checkIn,
    endDate: booking.checkOut,
    treatExternalHoldAsHard: false,
    excludeReservationId: booking._id
  });
  if (conflicts.hasHardConflicts) {
    throw createDomainError(
      'conflict',
      'Target unit has hard conflicts',
      { code: 'HARD_CONFLICTS', hardConflicts: conflicts.hardConflicts },
      409
    );
  }
  if (conflicts.warnings.length > 0 && !acceptExternalHoldWarnings) {
    throw createDomainError(
      'conflict',
      'Target unit has warning conflicts (external hold acceptance required)',
      { code: 'EXTERNAL_HOLD_ACK_REQUIRED', warnings: conflicts.warnings },
      409
    );
  }

  const ownership = await assertBookingOwnsNights({
    bookingId: booking._id,
    unitId: sourceUnitId,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    mode: 'exact'
  });
  if (!ownership.ok) {
    throw createDomainError(
      'conflict',
      'Source unit-night claims are incomplete or inconsistent; reconciliation required',
      {
        code: 'SOURCE_OWNERSHIP_MISMATCH',
        missingNights: ownership.missingNights,
        unexpectedNights: ownership.unexpectedNights
      },
      409
    );
  }

  const fingerprint = buildPayloadFingerprint({
    kind: KIND,
    bookingId: booking._id,
    sourceUnitId,
    targetUnitId,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    commercialProductKey: productKey,
    acceptExternalHoldWarnings,
    reason
  });

  const sc = await createPendingStayChange({
    booking,
    sourceUnitId,
    targetUnitId,
    cabinTypeId,
    productKey,
    fingerprint,
    idempotencyKey: key,
    reason,
    acceptExternalHoldWarnings,
    ctx
  });

  // If create raced and returned an already-progressed StayChange, resume
  if (sc.status !== 'pending') {
    return reconcileReallocateStayChange(sc._id, ctx);
  }

  return runNewReallocate(sc, ctx, conflicts.warnings || []);
}

module.exports = {
  reallocateReservation,
  reconcileReallocateStayChange,
  buildPayloadFingerprint,
  canonicalStayDateOnly,
  commercialProductKeyFromBooking,
  syncReservationBlockUnitProjection,
  KIND,
  ELIGIBLE_STATUSES,
  MRI_CATEGORY,
  AUDIT_ACTION,
  FINGERPRINT_KEYS
};
