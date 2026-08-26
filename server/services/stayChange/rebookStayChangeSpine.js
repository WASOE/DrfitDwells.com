'use strict';

/**
 * REBOOK StayChange spine helpers (S2).
 * Binding: docs/stay-change-implementation-plan.md §23.8–§23.16, §23.27–§23.29, §23.33
 *
 * Schema/validation/resolvers only — no mutation endpoint, no Booking/claim/Payment writes.
 */

const mongoose = require('mongoose');
const {
  commercialProductKeyFromShape,
  validateCommercialShape,
  compareCommercialProducts,
  classifyStayChangeRoute
} = require('./commercialProductIdentity');
const {
  resolveSourceContractualTotalCents,
  resolveRecognizedNetSettledCoverageCents,
  computeTransferredValueCents,
  computeContractualTargetTotalCents,
  validateMoneyEvidence,
  isNonNegInt
} = require('./rebookMoneyEvidence');

const REBOOK_KIND = 'rebook';

/** Statuses allowed on kind=rebook documents (full StayChange enum; names locked). */
const REBOOK_STATUSES = Object.freeze([
  'pending',
  'inventory_secured',
  'awaiting_payment',
  'ready_to_commit',
  'committed',
  'settling',
  'completed',
  'failed',
  'needs_reconciliation'
]);

/** After these, source/target snapshots + money evidence must not change. */
const REBOOK_EVIDENCE_LOCKED_STATUSES = Object.freeze([
  'inventory_secured',
  'awaiting_payment',
  'ready_to_commit',
  'committed',
  'settling',
  'completed'
]);

const IMMUTABLE_ALWAYS = Object.freeze(['kind', 'bookingId', 'idempotencyKey']);

function isObjectIdLike(value) {
  if (value == null) return false;
  if (value instanceof mongoose.Types.ObjectId) return true;
  return mongoose.Types.ObjectId.isValid(String(value)) && String(value).length === 24;
}

/**
 * Build immutable source evidence snapshot (no guest PII).
 */
function buildSourceSnapshot({
  booking,
  sourceContractualTotalCents,
  recognizedNetSettledCoverageCents,
  currency = 'eur'
} = {}) {
  const shape = validateCommercialShape({
    cabinId: booking?.cabinId,
    cabinTypeId: booking?.cabinTypeId,
    unitId: booking?.unitId,
    locationBookingId: booking?.locationBookingId,
    allowUnallocatedMulti: false
  });
  if (!shape.ok) {
    return { ok: false, code: shape.code, message: shape.message };
  }
  if (!isNonNegInt(sourceContractualTotalCents) || !isNonNegInt(recognizedNetSettledCoverageCents)) {
    return { ok: false, code: 'SNAPSHOT_CENTS_INVALID', message: 'Contractual/coverage cents required' };
  }
  return {
    ok: true,
    snapshot: {
      commercialProductKey: shape.commercialProductKey,
      cabinId: booking.cabinId ? String(booking.cabinId) : null,
      cabinTypeId: booking.cabinTypeId ? String(booking.cabinTypeId) : null,
      unitId: booking.unitId ? String(booking.unitId) : null,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      adults: Number.isFinite(booking.adults) ? booking.adults : null,
      children: Number.isFinite(booking.children) ? booking.children : null,
      transportMethod:
        booking.transportMethod == null || booking.transportMethod === ''
          ? null
          : String(booking.transportMethod),
      romanticSetup: Boolean(booking.romanticSetup),
      tripType:
        booking.tripType == null || booking.tripType === ''
          ? null
          : String(booking.tripType),
      currency: String(currency || 'eur').toLowerCase(),
      sourceContractualTotalCents,
      recognizedNetSettledCoverageCents,
      locationBookingId: booking.locationBookingId ? String(booking.locationBookingId) : null
    }
  };
}

/**
 * Build immutable target evidence snapshot (no guest PII).
 */
function buildTargetSnapshot({
  cabinId = null,
  cabinTypeId = null,
  unitId = null,
  checkIn,
  checkOut,
  adults = null,
  children = null,
  canonicalTargetQuoteCents,
  currency = 'eur',
  locationBookingId = null
} = {}) {
  const shape = validateCommercialShape({
    cabinId,
    cabinTypeId,
    unitId,
    locationBookingId,
    allowUnallocatedMulti: false
  });
  if (!shape.ok) {
    return { ok: false, code: shape.code, message: shape.message };
  }
  if (!isNonNegInt(canonicalTargetQuoteCents)) {
    return { ok: false, code: 'TARGET_QUOTE_INVALID', message: 'canonicalTargetQuoteCents required' };
  }
  if (checkIn == null || checkOut == null) {
    return { ok: false, code: 'TARGET_DATES_REQUIRED', message: 'target checkIn/checkOut required' };
  }
  return {
    ok: true,
    snapshot: {
      commercialProductKey: shape.commercialProductKey,
      cabinId: cabinId ? String(cabinId) : null,
      cabinTypeId: cabinTypeId ? String(cabinTypeId) : null,
      unitId: unitId ? String(unitId) : null,
      checkIn,
      checkOut,
      adults: Number.isFinite(adults) ? adults : null,
      children: Number.isFinite(children) ? children : null,
      currency: String(currency || 'eur').toLowerCase(),
      canonicalTargetQuoteCents,
      locationBookingId: locationBookingId ? String(locationBookingId) : null
    }
  };
}

function validateSnapshotShape(snapshot, role) {
  if (snapshot == null) {
    return { ok: true, optional: true };
  }
  if (typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { ok: false, code: 'SNAPSHOT_NOT_OBJECT', message: `${role}Snapshot must be an object` };
  }
  // Reject obvious guest PII keys if present
  const forbidden = ['guestInfo', 'email', 'phone', 'firstName', 'lastName', 'name'];
  for (const key of forbidden) {
    if (snapshot[key] != null) {
      return {
        ok: false,
        code: 'SNAPSHOT_PII_FORBIDDEN',
        message: `${role}Snapshot must not store guest PII field ${key}`
      };
    }
  }
  if (!snapshot.commercialProductKey || typeof snapshot.commercialProductKey !== 'string') {
    return { ok: false, code: 'SNAPSHOT_PRODUCT_KEY', message: 'commercialProductKey required' };
  }
  const shape = validateCommercialShape({
    cabinId: snapshot.cabinId,
    cabinTypeId: snapshot.cabinTypeId,
    unitId: snapshot.unitId,
    locationBookingId: snapshot.locationBookingId,
    allowUnallocatedMulti: false
  });
  if (!shape.ok) {
    return { ok: false, code: shape.code, message: shape.message };
  }
  if (shape.commercialProductKey !== snapshot.commercialProductKey) {
    return {
      ok: false,
      code: 'SNAPSHOT_PRODUCT_KEY_MISMATCH',
      message: 'commercialProductKey does not match shape fields'
    };
  }
  return { ok: true };
}

/**
 * Validate a REBOOK StayChange document shape (pure; no DB writes).
 */
function validateRebookStayChangeRepresentation(doc) {
  if (!doc || typeof doc !== 'object') {
    return { ok: false, code: 'DOC_REQUIRED', message: 'StayChange doc required' };
  }
  if (doc.kind !== REBOOK_KIND) {
    return { ok: false, code: 'KIND_NOT_REBOOK', message: 'kind must be rebook' };
  }
  if (!isObjectIdLike(doc.bookingId)) {
    return { ok: false, code: 'SOURCE_BOOKING_REQUIRED', message: 'bookingId (source) must be a valid ObjectId' };
  }
  if (doc.targetBookingId != null && !isObjectIdLike(doc.targetBookingId)) {
    return { ok: false, code: 'TARGET_BOOKING_INVALID', message: 'targetBookingId must be a valid ObjectId when set' };
  }
  if (doc.status != null && !REBOOK_STATUSES.includes(doc.status)) {
    return { ok: false, code: 'STATUS_INVALID', message: `Invalid REBOOK status: ${doc.status}` };
  }

  const srcKey = doc.sourceCommercialProductKey;
  const tgtKey = doc.targetCommercialProductKey;
  if (!srcKey || !tgtKey) {
    return { ok: false, code: 'PRODUCT_KEYS_REQUIRED', message: 'source/target commercial product keys required' };
  }
  if (srcKey === tgtKey) {
    return {
      ok: false,
      code: 'SAME_COMMERCIAL_PRODUCT',
      message: 'Same commercial product is not REBOOK'
    };
  }

  const srcShape = validateCommercialShape({
    cabinId: doc.sourceCabinId,
    cabinTypeId: doc.sourceCabinTypeId,
    unitId: doc.sourceUnitId,
    allowUnallocatedMulti: false
  });
  if (!srcShape.ok) {
    return { ok: false, code: srcShape.code, message: `source: ${srcShape.message}` };
  }
  const tgtShape = validateCommercialShape({
    cabinId: doc.targetCabinId,
    cabinTypeId: doc.targetCabinTypeId,
    unitId: doc.targetUnitId,
    allowUnallocatedMulti: false
  });
  if (!tgtShape.ok) {
    return { ok: false, code: tgtShape.code, message: `target: ${tgtShape.message}` };
  }
  if (srcShape.commercialProductKey !== srcKey || tgtShape.commercialProductKey !== tgtKey) {
    return {
      ok: false,
      code: 'PRODUCT_KEY_SHAPE_MISMATCH',
      message: 'Commercial product keys must match cabinId/cabinTypeId fields'
    };
  }

  const srcSnap = validateSnapshotShape(doc.sourceSnapshot, 'source');
  if (!srcSnap.ok) return srcSnap;
  const tgtSnap = validateSnapshotShape(doc.targetSnapshot, 'target');
  if (!tgtSnap.ok) return tgtSnap;

  const money = validateMoneyEvidence(doc.money);
  if (!money.ok) return money;

  return { ok: true };
}

function isEvidenceLockedStatus(status) {
  return REBOOK_EVIDENCE_LOCKED_STATUSES.includes(status);
}

/**
 * Detect illegal semantic mutations on an existing REBOOK StayChange.
 * @param {object} before plain prior values
 * @param {object} after proposed values
 */
function assertRebookImmutability(before, after) {
  if (!before || before.kind !== REBOOK_KIND) {
    return { ok: true };
  }
  for (const field of IMMUTABLE_ALWAYS) {
    if (
      before[field] != null &&
      after[field] != null &&
      String(before[field]) !== String(after[field])
    ) {
      return {
        ok: false,
        code: 'IMMUTABLE_FIELD',
        message: `Cannot change ${field} on REBOOK StayChange`
      };
    }
  }
  if (isEvidenceLockedStatus(before.status)) {
    const locked = [
      'sourceSnapshot',
      'targetSnapshot',
      'sourceCommercialProductKey',
      'targetCommercialProductKey',
      'sourceCabinId',
      'targetCabinId',
      'sourceCabinTypeId',
      'targetCabinTypeId',
      'sourceUnitId',
      'targetUnitId',
      'targetBookingId'
    ];
    for (const field of locked) {
      if (before[field] == null && after[field] == null) continue;
      if (JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null)) {
        return {
          ok: false,
          code: 'EVIDENCE_LOCKED',
          message: `Cannot change ${field} after status=${before.status}`
        };
      }
    }
    if (before.money != null || after.money != null) {
      if (JSON.stringify(before.money ?? null) !== JSON.stringify(after.money ?? null)) {
        return {
          ok: false,
          code: 'EVIDENCE_LOCKED',
          message: `Cannot change money after status=${before.status}`
        };
      }
    }
  }
  return { ok: true };
}

/**
 * Replacement coverage for payment classification (transferred + incremental on replacement).
 * Pure: uses StayChange money + optional replacement incremental cents.
 */
function resolveReplacementCoverageCents({
  rebookStayChange,
  replacementIncrementalPaidCents = 0,
  replacementVoucherCents = 0
} = {}) {
  if (!rebookStayChange || rebookStayChange.kind !== REBOOK_KIND) return null;
  const transferred = rebookStayChange.money?.transferredValueCents;
  if (!isNonNegInt(transferred)) return null;
  const inc = isNonNegInt(replacementIncrementalPaidCents) ? replacementIncrementalPaidCents : 0;
  const voucher = isNonNegInt(replacementVoucherCents) ? replacementVoucherCents : 0;
  return transferred + inc + voucher;
}

function resolveContractualTargetFromStayChange(rebookStayChange) {
  const cents = rebookStayChange?.money?.contractualTargetTotalCents;
  return isNonNegInt(cents) ? cents : null;
}

/**
 * Whether a completed/active REBOOK StayChange can settle a replacement Booking classification.
 */
function isRebookTransferSettling(rebookStayChange) {
  if (!rebookStayChange || rebookStayChange.kind !== REBOOK_KIND) return false;
  const status = rebookStayChange.status;
  return (
    status === 'completed' ||
    status === 'committed' ||
    status === 'settling' ||
    status === 'ready_to_commit'
  );
}

module.exports = {
  REBOOK_KIND,
  REBOOK_STATUSES,
  REBOOK_EVIDENCE_LOCKED_STATUSES,
  buildSourceSnapshot,
  buildTargetSnapshot,
  validateSnapshotShape,
  validateRebookStayChangeRepresentation,
  assertRebookImmutability,
  isEvidenceLockedStatus,
  resolveReplacementCoverageCents,
  resolveContractualTargetFromStayChange,
  isRebookTransferSettling,
  // re-exports for single import surface
  commercialProductKeyFromShape,
  validateCommercialShape,
  compareCommercialProducts,
  classifyStayChangeRoute,
  resolveSourceContractualTotalCents,
  resolveRecognizedNetSettledCoverageCents,
  computeTransferredValueCents,
  computeContractualTargetTotalCents,
  validateMoneyEvidence
};
