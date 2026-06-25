import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OpsReservationDetail from './OpsReservationDetail';
import { OPS_RESERVATION_ACTIONS } from './utils/opsReservationPermissions';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ id: '507f1f77bcf86cd799439011' })
  };
});

vi.mock('../../context/OpsSessionContext', () => ({
  useOpsSession: vi.fn()
}));

vi.mock('../../services/opsApi', () => ({
  opsReadAPI: {
    reservationDetail: vi.fn(),
    reservationEmailEvents: vi.fn(),
    reservationMessagingSummary: vi.fn()
  },
  opsWriteAPI: {}
}));

vi.mock('../../services/api', () => ({
  default: {
    patch: vi.fn()
  }
}));

import { useOpsSession } from '../../context/OpsSessionContext';
import { opsReadAPI } from '../../services/opsApi';

function reservationPayload(reservationStatus) {
  return {
    reservation: {
      reservationId: '507f1f77bcf86cd799439011',
      reservationStatus,
      checkInDateOnly: '2026-07-01',
      checkOutDateOnly: '2026-07-05',
      guest: { email: 'guest@example.com' }
    },
    guestDetail: {
      firstName: 'Test',
      lastName: 'Guest',
      email: 'guest@example.com',
      phone: ''
    },
    cancellationSettlement: null,
    stayPropertyKind: 'cabin'
  };
}

describe('OpsReservationDetail reservation actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    opsReadAPI.reservationDetail.mockResolvedValue({ data: { data: reservationPayload('confirmed') } });
    opsReadAPI.reservationEmailEvents.mockResolvedValue({
      data: { data: { events: [], pagination: { page: 1, totalPages: 1 } } }
    });
    opsReadAPI.reservationMessagingSummary.mockResolvedValue({ data: { data: { jobs: [] } } });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows Cancel reservation for admin session with cancel action and confirmed booking', async () => {
    useOpsSession.mockReturnValue({
      actions: [OPS_RESERVATION_ACTIONS.CANCEL, OPS_RESERVATION_ACTIONS.REASSIGN]
    });
    render(
      <MemoryRouter>
        <OpsReservationDetail />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancel reservation' })).toBeTruthy();
    });
  });

  it('hides Cancel reservation for operator session without cancel action', async () => {
    useOpsSession.mockReturnValue({ actions: ['ops.reservation.confirm'] });
    render(
      <MemoryRouter>
        <OpsReservationDetail />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Cancel reservation' })).toBeNull();
  });

  it('hides Cancel reservation for admin session with completed booking', async () => {
    useOpsSession.mockReturnValue({ actions: [OPS_RESERVATION_ACTIONS.CANCEL] });
    opsReadAPI.reservationDetail.mockResolvedValue({ data: { data: reservationPayload('completed') } });
    render(
      <MemoryRouter>
        <OpsReservationDetail />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByText('Completed reservations cannot be cancelled from OPS.')).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Cancel reservation' })).toBeNull();
  });

  it('shows Reassign only when session includes reassign action', async () => {
    useOpsSession.mockReturnValue({ actions: [OPS_RESERVATION_ACTIONS.REASSIGN] });
    render(
      <MemoryRouter>
        <OpsReservationDetail />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Reassign' })).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Cancel reservation' })).toBeNull();
  });
});
