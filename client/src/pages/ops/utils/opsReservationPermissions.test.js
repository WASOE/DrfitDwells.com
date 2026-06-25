import { describe, expect, it } from 'vitest';
import {
  canCancelReservation,
  canMarkCashRefunded,
  canReassignReservation,
  canResolveCancellationSettlement,
  OPS_RESERVATION_ACTIONS,
  showCompletedNotCancellableMessage
} from './opsReservationPermissions';

const adminSession = {
  authenticated: true,
  role: 'admin',
  actions: [OPS_RESERVATION_ACTIONS.CANCEL, OPS_RESERVATION_ACTIONS.REASSIGN]
};

const operatorSession = {
  authenticated: true,
  role: 'operator',
  actions: ['ops.reservation.confirm', 'ops.reservation.edit_dates']
};

describe('opsReservationPermissions', () => {
  it('shows cancel for admin session with cancel action and confirmed booking', () => {
    expect(canCancelReservation(adminSession, 'confirmed')).toBe(true);
  });

  it('hides cancel for operator session without cancel action', () => {
    expect(canCancelReservation(operatorSession, 'confirmed')).toBe(false);
  });

  it('hides cancel for admin session with completed booking', () => {
    expect(canCancelReservation(adminSession, 'completed')).toBe(false);
    expect(showCompletedNotCancellableMessage(adminSession, 'completed')).toBe(true);
  });

  it('hides cancel for cancelled booking', () => {
    expect(canCancelReservation(adminSession, 'cancelled')).toBe(false);
  });

  it('allows reassign only when session includes reassign action', () => {
    expect(canReassignReservation(adminSession)).toBe(true);
    expect(canReassignReservation(operatorSession)).toBe(false);
  });

  it('allows settlement resolve only with cancel action on cancelled booking', () => {
    expect(canResolveCancellationSettlement(adminSession, 'cancelled', { outcome: 'resolution_pending' })).toBe(
      true
    );
    expect(canResolveCancellationSettlement(operatorSession, 'cancelled', { outcome: 'resolution_pending' })).toBe(
      false
    );
    expect(canResolveCancellationSettlement(adminSession, 'confirmed', null)).toBe(false);
  });

  it('allows mark cash refunded only with cancel action and pending refund outcome', () => {
    expect(
      canMarkCashRefunded(adminSession, 'cancelled', { outcome: 'cash_refund_pending' })
    ).toBe(true);
    expect(canMarkCashRefunded(operatorSession, 'cancelled', { outcome: 'cash_refund_pending' })).toBe(
      false
    );
  });
});
