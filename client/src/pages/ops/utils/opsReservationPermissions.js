const CANCELLABLE_RESERVATION_STATUSES = new Set(['pending', 'confirmed', 'in_house']);

export const OPS_RESERVATION_ACTIONS = {
  CANCEL: 'ops.reservation.cancel',
  REASSIGN: 'ops.reservation.reassign'
};

function sessionHasAction(session, action) {
  return (session?.actions || []).includes(action);
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
