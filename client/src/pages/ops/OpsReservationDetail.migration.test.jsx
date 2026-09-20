import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OpsReservationDetail from './OpsReservationDetail';
import { OpsSessionProvider } from '../../context/OpsSessionContext';
import { OPS_RESERVATION_ACTIONS } from './utils/opsReservationPermissions';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ id: '507f1f77bcf86cd799439011' })
  };
});

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

import { opsReadAPI } from '../../services/opsApi';

const session = {
  authenticated: true,
  actorId: 'admin-1',
  role: 'admin',
  modules: ['*'],
  actions: [OPS_RESERVATION_ACTIONS.CANCEL, OPS_RESERVATION_ACTIONS.REASSIGN],
  defaultRoute: '/ops',
  locale: 'en'
};

function detailPayload(overrides = {}) {
  return {
    reservation: {
      reservationId: '507f1f77bcf86cd799439011',
      reservationStatus: 'confirmed',
      paymentStatus: 'paid',
      source: 'internal',
      checkInDateOnly: '2026-07-01',
      checkOutDateOnly: '2026-07-05',
      guest: { firstName: 'Test', lastName: 'Guest', email: 'guest@example.com' },
      cabinId: '507f1f77bcf86cd7994390cc',
      ...overrides.reservation
    },
    cabinSummary: {
      cabinId: '507f1f77bcf86cd7994390cc',
      name: 'Lux Cabin',
      displayName: 'Lux Cabin',
      location: 'Valley',
      ...(overrides.cabinSummary || {})
    },
    guestDetail: {
      firstName: 'Test',
      lastName: 'Guest',
      email: 'guest@example.com',
      phone: ''
    },
    operational: {
      stayTiming: {
        currentlyStaying: true,
        arrivingToday: false,
        arrivingTomorrow: false,
        checkingOutToday: false,
        checkedOut: false,
        daysUntilCheckIn: null
      },
      ...(overrides.operational || {})
    },
    conflictContext: { hasHardConflict: false, hasWarning: false },
    cancellationSettlement: null,
    stayPropertyKind: 'cabin',
    notes: { items: [] },
    paymentTrail: [],
    payoutRelevance: { payoutCount: 0 },
    ...overrides
  };
}

function renderDetail() {
  return render(
    <MemoryRouter>
      <OpsSessionProvider session={session}>
        <OpsReservationDetail />
      </OpsSessionProvider>
    </MemoryRouter>
  );
}

describe('OpsReservationDetail migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    opsReadAPI.reservationEmailEvents.mockResolvedValue({
      data: { data: { events: [], pagination: { page: 1, totalPages: 1 } } }
    });
    opsReadAPI.reservationMessagingSummary.mockResolvedValue({ data: { data: { jobs: [] } } });
  });

  afterEach(() => {
    cleanup();
  });

  it('uses OpsPage wide with reservations back link and header', async () => {
    opsReadAPI.reservationDetail.mockResolvedValue({ data: { data: detailPayload() } });
    renderDetail();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Reservation 507f1f77bcf86cd799439011/i })).toBeTruthy();
    });
    expect(document.querySelector('.ops-page')).toHaveAttribute('data-ops-page-width', 'wide');
    expect(screen.getByRole('link', { name: 'Reservations' })).toHaveAttribute('href', '/ops/reservations');
    expect(screen.getByText('2026-07-01 - 2026-07-05')).toBeTruthy();
    expect(screen.getByText('Lux Cabin')).toBeTruthy();
    expect(screen.getByText('Test Guest')).toBeTruthy();
    expect(document.querySelector('.ops-rd-surface')).toBeTruthy();
  });

  it('keeps header and OpsLoadingState while detail read is pending', () => {
    opsReadAPI.reservationDetail.mockReturnValue(new Promise(() => {}));
    renderDetail();
    expect(screen.getByRole('heading', { name: 'Reservation' })).toBeTruthy();
    expect(screen.getByText(/Loading reservation/i)).toBeTruthy();
    expect(document.querySelector('.ops-page')).toHaveAttribute('data-ops-page-width', 'wide');
  });

  it('shows OpsBanner danger on load error with header still visible', async () => {
    opsReadAPI.reservationDetail.mockRejectedValue({
      response: { data: { message: 'Reservation detail boom' } }
    });
    renderDetail();
    await waitFor(() => {
      expect(screen.getByText('Reservation detail boom')).toBeTruthy();
    });
    expect(screen.getByRole('heading', { name: 'Reservation' })).toBeTruthy();
    expect(document.querySelector('.ops-banner--danger')).toBeTruthy();
  });

  it('renders status density cluster for lifecycle, payment, operational, and source', async () => {
    opsReadAPI.reservationDetail.mockResolvedValue({ data: { data: detailPayload() } });
    renderDetail();
    await waitFor(() => {
      expect(screen.getByTestId('ops-rd-status-cluster')).toBeTruthy();
    });
    const cluster = screen.getByTestId('ops-rd-status-cluster');
    expect(cluster.querySelector('[data-ops-status-key="reservation.confirmed"]')).toBeTruthy();
    expect(cluster.querySelector('[data-ops-status-key="payment.paid"]')).toBeTruthy();
    expect(cluster.querySelector('[data-ops-status-key="reservation.currently_staying"]')).toBeTruthy();
    expect(cluster.textContent).toMatch(/internal/i);
  });

  it('shows Confirmed + Paid + Arriving in 2 days + Airbnb together', async () => {
    opsReadAPI.reservationDetail.mockResolvedValue({
      data: {
        data: detailPayload({
          reservation: { source: 'airbnb', paymentStatus: 'paid', reservationStatus: 'confirmed' },
          operational: {
            stayTiming: {
              currentlyStaying: false,
              arrivingToday: false,
              arrivingTomorrow: false,
              checkingOutToday: false,
              checkedOut: false,
              daysUntilCheckIn: 2
            }
          }
        })
      }
    });
    renderDetail();
    await waitFor(() => {
      expect(screen.getByTestId('ops-rd-status-cluster')).toBeTruthy();
    });
    const cluster = screen.getByTestId('ops-rd-status-cluster');
    expect(cluster.querySelector('[data-ops-status-key="reservation.confirmed"]')).toBeTruthy();
    expect(cluster.querySelector('[data-ops-status-key="payment.paid"]')).toBeTruthy();
    expect(cluster.textContent).toMatch(/Arriving in 2 days/i);
    expect(cluster.textContent).toMatch(/airbnb/i);
  });
});
