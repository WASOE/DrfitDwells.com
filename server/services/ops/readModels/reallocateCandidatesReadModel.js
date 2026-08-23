/**
 * R3 read-only REALLOCATE candidates for OPS Move Unit.
 * Advisory only — does not reserve inventory. R1 mutation remains authoritative.
 */
'use strict';

const Booking = require('../../../models/Booking');
const Unit = require('../../../models/Unit');
const { evaluateTargetConflicts } = require('../domain/conflictService');
const { createDomainError } = require('../domain/errors');
const { findParentCabinForCabinType } = require('../../publicAvailabilityService');
const { requirePermission, ACTIONS } = require('../../permissionService');
const { formatSofiaDateOnly } = require('../../../utils/dateTime');

const ELIGIBLE_STATUSES = ['pending', 'confirmed'];

function idStr(v) {
  if (v == null) return null;
  if (typeof v === 'object' && v._id) return String(v._id);
  return String(v);
}

function safeConflictSummary(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const out = {
    kind: entry.kind || null,
    blockType: entry.blockType || null,
    startDate: entry.startDate ? formatSofiaDateOnly(entry.startDate) : null,
    endDate: entry.endDate ? formatSofiaDateOnly(entry.endDate) : null,
    reservationId: entry.reservationId ? String(entry.reservationId) : null,
    pooled: entry.pooled === true,
    parentWide: entry.parentWide === true,
    targetType: entry.targetType || null
  };
  // Explicitly omit guestLabel / PII / payment / notes / messages.
  return out;
}

function classifyCandidateState({ unit, bookingUnitId, conflicts }) {
  if (String(unit._id) === String(bookingUnitId)) return 'CURRENT';
  if (unit.isActive !== true) return 'INACTIVE';
  if (conflicts?.hasHardConflicts) return 'HARD_BLOCKED';
  if (Array.isArray(conflicts?.warnings) && conflicts.warnings.length > 0) {
    return 'EXTERNAL_HOLD_WARNING';
  }
  return 'AVAILABLE';
}

/**
 * @param {string} reservationId
 * @param {{ user?: { role?: string } }} [ctx]
 */
async function getReallocateCandidatesReadModel(reservationId, ctx = {}) {
  requirePermission({
    role: ctx.user?.role,
    action: ACTIONS.OPS_RESERVATION_REASSIGN
  });

  const booking = await Booking.findById(reservationId).lean();
  if (!booking || booking.isTest || booking.archivedAt) {
    throw createDomainError('validation', 'Reservation not found', { bookingId: reservationId }, 404);
  }

  if (!ELIGIBLE_STATUSES.includes(booking.status)) {
    throw createDomainError(
      'invalid_transition',
      `Cannot list REALLOCATE candidates for status ${booking.status}`,
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

  const cabinTypeId = booking.cabinTypeId;
  const sourceUnitId = booking.unitId;
  const parentCabin = await findParentCabinForCabinType(cabinTypeId);
  if (!parentCabin?._id) {
    throw createDomainError(
      'validation',
      'Parent cabin not found for multi-unit REALLOCATE candidates',
      { cabinTypeId: String(cabinTypeId) },
      409
    );
  }

  const units = await Unit.find({ cabinTypeId }).sort({ unitNumber: 1 }).lean();

  const candidates = [];
  for (const unit of units) {
    const unitId = String(unit._id);
    let conflicts = { hardConflicts: [], warnings: [], hasHardConflicts: false };

    // Skip conflict evaluation for inactive/current when not needed for AVAILABLE path —
    // still evaluate CURRENT and INACTIVE so UI can show reasons; CURRENT skips hard eval
    // only after classification would be CURRENT. Evaluate for non-current active units.
    const isCurrent = unitId === String(sourceUnitId);
    const isInactive = unit.isActive !== true;

    if (!isCurrent && !isInactive) {
      conflicts = await evaluateTargetConflicts({
        cabinId: parentCabin._id,
        unitId,
        cabinTypeId,
        startDate: booking.checkIn,
        endDate: booking.checkOut,
        treatExternalHoldAsHard: false,
        excludeReservationId: booking._id
      });
    }

    const state = classifyCandidateState({
      unit,
      bookingUnitId: sourceUnitId,
      conflicts
    });

    candidates.push({
      unitId,
      displayName: unit.displayName || null,
      unitNumber: unit.unitNumber != null ? String(unit.unitNumber) : null,
      isActive: unit.isActive === true,
      state,
      hardConflicts:
        state === 'HARD_BLOCKED'
          ? (conflicts.hardConflicts || []).map(safeConflictSummary).filter(Boolean)
          : [],
      warnings:
        state === 'EXTERNAL_HOLD_WARNING' || state === 'HARD_BLOCKED'
          ? (conflicts.warnings || []).map(safeConflictSummary).filter(Boolean)
          : []
    });
  }

  return {
    reservationId: String(booking._id),
    cabinTypeId: idStr(cabinTypeId),
    sourceUnitId: idStr(sourceUnitId),
    checkInDateOnly: booking.checkIn ? formatSofiaDateOnly(booking.checkIn) : null,
    checkOutDateOnly: booking.checkOut ? formatSofiaDateOnly(booking.checkOut) : null,
    candidates
  };
}

module.exports = {
  getReallocateCandidatesReadModel,
  classifyCandidateState,
  safeConflictSummary
};
