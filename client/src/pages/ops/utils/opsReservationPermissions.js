const CANCELLABLE_RESERVATION_STATUSES = new Set(['pending', 'confirmed', 'in_house']);
const MOVE_ELIGIBLE_STATUSES = new Set(['pending', 'confirmed']);

export const OPS_RESERVATION_ACTIONS = {
  CANCEL: 'ops.reservation.cancel',
  REASSIGN: 'ops.reservation.reassign'
};

function sessionHasAction(session, action) {
  return (session?.actions || []).includes(action);
}

function idPresent(value) {
  return value != null && String(value).trim() !== '';
}

/**
 * Structured inventory shape for OPS reservation UI (from cabinSummary / reservation fields).
 * @returns {'single_cabin'|'allocated_cabin_type'|'unallocated_cabin_type'|'malformed'|null}
 */
export function resolveInventoryShape(cabinSummary, reservation = null) {
  const cabinId = cabinSummary?.cabinId ?? reservation?.cabinId ?? null;
  const cabinTypeId = cabinSummary?.cabinTypeId ?? reservation?.cabinTypeId ?? null;
  const unitId = cabinSummary?.unitId ?? reservation?.unitId ?? null;

  const hasCabin = idPresent(cabinId);
  const hasType = idPresent(cabinTypeId);
  const hasUnit = idPresent(unitId);

  if (hasCabin && hasType) return 'malformed';
  if (hasCabin && !hasType) return 'single_cabin';
  if (hasType && hasUnit) return 'allocated_cabin_type';
  if (hasType && !hasUnit) return 'unallocated_cabin_type';
  return null;
}

export function canCancelReservation(session, reservationStatus) {
  return (
    sessionHasAction(session, OPS_RESERVATION_ACTIONS.CANCEL) &&
    CANCELLABLE_RESERVATION_STATUSES.has(reservationStatus)
  );
}

export function canReassignReservation(session) {
  return sessionHasAction(session, OPS_RESERVATION_ACTIONS.REASSIGN);
}

/**
 * Legacy cabin Reassign (toCabinId). Single-cabin only.
 */
export function canShowLegacyReassign(session, cabinSummary, reservation = null) {
  if (!canReassignReservation(session)) return false;
  return resolveInventoryShape(cabinSummary, reservation) === 'single_cabin';
}

/**
 * R3 Move Unit — allocated multi-unit pending|confirmed + reassign permission.
 */
export function canMoveUnit(session, reservationStatus, cabinSummary, reservation = null) {
  if (!canReassignReservation(session)) return false;
  if (!MOVE_ELIGIBLE_STATUSES.has(reservationStatus)) return false;
  return resolveInventoryShape(cabinSummary, reservation) === 'allocated_cabin_type';
}

export function canResolveCancellationSettlement(session, reservationStatus, cancellationSettlement) {
  return (
    sessionHasAction(session, OPS_RESERVATION_ACTIONS.CANCEL) &&
    reservationStatus === 'cancelled' &&
    (!cancellationSettlement ||
      !cancellationSettlement.outcome ||
      cancellationSettlement.outcome === 'resolution_pending')
  );
}

export function canMarkCashRefunded(session, reservationStatus, cancellationSettlement) {
  return (
    sessionHasAction(session, OPS_RESERVATION_ACTIONS.CANCEL) &&
    reservationStatus === 'cancelled' &&
    cancellationSettlement?.outcome === 'cash_refund_pending'
  );
}

export function showCompletedNotCancellableMessage(session, reservationStatus) {
  return sessionHasAction(session, OPS_RESERVATION_ACTIONS.CANCEL) && reservationStatus === 'completed';
}

export function makeReallocateIdempotencyKey() {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `fallback_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  return `ops_realloc_${uuid}`;
}

export function mapReallocateErrorCode(detailsCode) {
  const code = detailsCode || null;
  const map = {
    HARD_CONFLICTS: 'Target unit is no longer available. Candidate list refreshed.',
    EXTERNAL_HOLD_ACK_REQUIRED:
      'This unit has an external channel hold. Acknowledge the warning before moving.',
    UNIT_NOT_FOUND_OR_INACTIVE: 'Target unit is inactive or no longer exists.',
    UNIT_CABIN_TYPE_MISMATCH: 'Target unit does not belong to this accommodation type.',
    STATUS_NOT_ELIGIBLE: 'This reservation can no longer be moved.',
    SINGLE_CABIN_NOT_REALLOCATE: 'Single-cabin reservations cannot use Move Unit.',
    CABIN_TYPE_REQUIRED: 'Move Unit requires a multi-unit reservation.',
    UNIT_ALLOCATION_REQUIRED: 'This reservation has no allocated unit to move.',
    MALFORMED_INVENTORY_IDENTITY: 'Reservation inventory identity is invalid for Move Unit.',
    COMMERCIAL_PRODUCT_INVALID: 'Move Unit requires a cabin-type commercial product.',
    SOURCE_OWNERSHIP_MISMATCH:
      'Inventory ownership needs reconciliation. Do not retry blindly — escalate if needed.',
    IDEMPOTENCY_KEY_CONFLICT:
      'This move intent conflicts with a previous operation key. Close and start a new Move.',
    CAS_FAILED: 'Reservation changed concurrently. Refresh and try again.',
    CAS_LOST_OTHER_UNIT: 'Reservation unit changed concurrently. Refresh and try again.',
    BOOKING_CAS_FAILED: 'Reservation changed concurrently. Refresh and try again.',
    BLOCK_SYNC_FAILED:
      'Unit move needs inventory reconciliation. This is not a guest billing failure.',
    SOURCE_RELEASE_FAILED:
      'Unit move needs inventory reconciliation. This is not a guest billing failure.',
    STAY_CHANGE_IDEMPOTENCY_INDEX_MISSING:
      'Move Unit cannot start: backend StayChange index configuration is not ready.'
  };
  if (map[code]) return map[code];
  return null;
}

/** Interpret R1 REALLOCATE HTTP 200 body — not every 200 is a successful move. */
export function interpretReallocateSuccessPayload(data) {
  const status = data?.status ?? null;
  if (status === 'completed') {
    return { kind: 'completed' };
  }
  if (status === 'needs_reconciliation') {
    return {
      kind: 'needs_reconciliation',
      message:
        'Unit move needs inventory reconciliation. This is not a guest billing failure.'
    };
  }
  if (status === 'failed') {
    return {
      kind: 'failed',
      message: 'Move did not complete. Refresh reservation detail before retrying.'
    };
  }
  if (data?.changed === false && (status == null || status === '')) {
    return { kind: 'noop' };
  }
  if (status === 'pending' || status === 'inventory_secured' || status === 'committed') {
    return {
      kind: 'incomplete',
      message: 'Move is still in progress or needs reconciliation. Refresh and verify the unit.'
    };
  }
  return {
    kind: 'unknown',
    message: 'Unexpected move response. Refresh reservation detail to verify state.'
  };
}
