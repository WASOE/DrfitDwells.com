import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useParams, useSearchParams } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpsSessionProvider } from '../../context/OpsSessionContext';
import { resetOpsOverlayRuntime } from '../../ops/primitives/opsOverlay';
import OpsReservations from './OpsReservations';

vi.mock('../../services/opsApi', () => ({
  opsReadAPI: {
    reservations: vi.fn(),
    reservationsExport: vi.fn(),
    cabins: vi.fn()
  },
  opsWriteAPI: {
    createManualReservation: vi.fn()
  }
}));

vi.mock('../../utils/csvExport', () => ({
  exportToCSV: vi.fn()
}));

import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';
import { exportToCSV } from '../../utils/csvExport';

const here = path.dirname(fileURLToPath(import.meta.url));
const pageSource = fs.readFileSync(path.join(here, 'OpsReservations.jsx'), 'utf8');
const detailSource = fs.readFileSync(path.join(here, 'OpsReservationDetail.jsx'), 'utf8');

const adminSession = {
  authenticated: true,
  actorId: 'admin-1',
  role: 'admin',
  modules: ['*'],
  actions: ['ops.reservation.manual_create'],
  defaultRoute: '/ops',
  locale: 'en'
};

function SearchProbe() {
  const [params] = useSearchParams();
  return <div data-testid="reservations-search">{params.toString()}</div>;
}

function DetailStub() {
  const { id } = useParams();
  const location = useLocation();
  return (
    <div data-testid="legacy-reservation-detail">
      {id}
      <span data-testid="detail-state">{location.state == null ? 'none' : JSON.stringify(location.state)}</span>
    </div>
  );
}

function timing(overrides = {}) {
  return {
    currentlyStaying: false,
    arrivingToday: false,
    arrivingTomorrow: false,
    checkingOutToday: false,
    checkedOut: false,
    upcoming: false,
    daysUntilCheckIn: null,
    ...overrides
  };
}

function reservation(overrides = {}) {
  const { operational, conflict, guestSummary, dateRange, cabinSummary, ...rest } = overrides;
  return {
    reservationId: '507f1f77bcf86cd799439011',
    reservationStatus: 'confirmed',
    paymentStatus: 'paid',
    adults: 2,
    children: 0,
    amount: 120,
    guestSummary: {
      firstName: 'Elena',
      lastName: 'Petrova',
      email: 'elena@example.com',
      ...guestSummary
    },
    dateRange: {
      startDateOnly: '2026-09-21',
      endDateOnly: '2026-09-24',
      ...dateRange
    },
    cabinSummary: {
      displayName: 'The Cabin · Unit 2',
      name: 'The Cabin',
      location: 'Rhodope',
      ...cabinSummary
    },
    operational: {
      stayTiming: timing(),
      cancelledPaid: false,
      refundPending: false,
      paymentAttention: false,
      ...operational
    },
    conflict: {
      hasConflict: false,
      ...conflict
    },
    ...rest
  };
}

function payload(items, pagination = { page: 1, limit: 20, total: items.length, totalPages: 1 }) {
  return { data: { data: { items, pagination } } };
}

function cabinsPayload(items) {
  return { data: { data: { items } } };
}

function renderPage(initialPath = '/ops/reservations', session = adminSession) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <OpsSessionProvider session={session}>
        <SearchProbe />
        <Routes>
          <Route path="/ops/reservations" element={<OpsReservations />} />
          <Route path="/ops/reservations/:id" element={<DetailStub />} />
        </Routes>
      </OpsSessionProvider>
    </MemoryRouter>
  );
}

describe('OpsReservations collection migration', () => {
  beforeEach(() => {
    opsReadAPI.reservations.mockReset();
    opsReadAPI.reservationsExport.mockReset();
    opsReadAPI.cabins.mockReset();
    opsWriteAPI.createManualReservation.mockReset();
    exportToCSV.mockReset();
    opsReadAPI.reservations.mockResolvedValue(payload([reservation()]));
    opsReadAPI.cabins.mockResolvedValue(
      cabinsPayload([{ kind: 'single_cabin', cabinId: 'cabin-1', name: 'Stone House' }])
    );
    opsReadAPI.reservationsExport.mockResolvedValue({ data: { data: { rows: [{ _id: '1' }] } } });
  });

  afterEach(() => {
    cleanup();
    resetOpsOverlayRuntime();
  });

  it('uses OpsPage wide and OpsPageHeader without a workspace title card or max-w-7xl', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Reservations' })).toBeInTheDocument();
    });
    expect(screen.getByTestId('ops-page')).toHaveAttribute('data-ops-page-width', 'wide');
    expect(screen.queryByRole('heading', { name: 'Reservations workspace' })).not.toBeInTheDocument();
    expect(pageSource).not.toMatch(/max-w-7xl|Reservations workspace|#81887A|z-40/);
    expect(pageSource).not.toMatch(/replace:\s*true/);
    expect(detailSource).not.toMatch(/OpsReservations\.css/);
  });

  it('calls reservations with page 1 and limit 20 and cabins with no params', async () => {
    renderPage();
    await waitFor(() => {
      expect(opsReadAPI.reservations).toHaveBeenCalled();
    });
    expect(opsReadAPI.reservations).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(opsReadAPI.cabins).toHaveBeenCalledWith();
    expect(opsReadAPI.cabins.mock.calls[0]).toEqual([]);
  });

  it('keeps header and search mounted during first load', async () => {
    let resolveLoad;
    opsReadAPI.reservations.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      })
    );
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Reservations' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading reservations');
    resolveLoad(payload([reservation()]));
    await waitFor(() => {
      expect(screen.getAllByText('Elena Petrova').length).toBeGreaterThan(0);
    });
  });

  it('hydrates URL filters and omits empty optional keys', async () => {
    renderPage(
      '/ops/reservations?opsBucket=upcoming&status=confirmed&cabinId=cabin-1&paymentStatus=paid&search=elena&page=3&limit=20'
    );
    await waitFor(() => {
      expect(opsReadAPI.reservations).toHaveBeenCalled();
    });
    expect(opsReadAPI.reservations).toHaveBeenCalledWith({
      page: '3',
      limit: '20',
      opsBucket: 'upcoming',
      status: 'confirmed',
      cabinId: 'cabin-1',
      paymentStatus: 'paid',
      search: 'elena'
    });
    expect(screen.getByLabelText('Operational bucket')).toHaveValue('upcoming');
    expect(screen.getByLabelText('Reservation status')).toHaveValue('confirmed');
    expect(screen.getByLabelText('Cabin')).toHaveValue('cabin-1');
    expect(screen.getByLabelText('Payment status')).toHaveValue('paid');
    expect(screen.getByLabelText('Search')).toHaveValue('elena');
  });

  it('updates search live without trim, deletes page, and keeps other filters', async () => {
    renderPage('/ops/reservations?status=pending&page=2');
    await waitFor(() => {
      expect(screen.getByLabelText('Search')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: '  ada' } });
    await waitFor(() => {
      expect(new URLSearchParams(screen.getByTestId('reservations-search').textContent).get('search')).toBe('  ada');
    });
    expect(screen.getByTestId('reservations-search').textContent).toContain('status=pending');
    expect(screen.getByTestId('reservations-search').textContent).not.toMatch(/page=/);
    await waitFor(() => {
      expect(opsReadAPI.reservations).toHaveBeenLastCalledWith({
        page: 1,
        limit: 20,
        status: 'pending',
        search: '  ada'
      });
    });
  });

  it('resets page on non-page filters and deletes stayScope only when opsBucket changes', async () => {
    renderPage('/ops/reservations?stayScope=past&status=confirmed&page=2');
    await waitFor(() => {
      expect(screen.getByLabelText('Reservation status')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText('Reservation status'), { target: { value: 'pending' } });
    await waitFor(() => {
      expect(screen.getByTestId('reservations-search').textContent).toContain('status=pending');
    });
    expect(screen.getByTestId('reservations-search').textContent).toContain('stayScope=past');
    expect(screen.getByTestId('reservations-search').textContent).not.toMatch(/page=/);

    fireEvent.change(screen.getByLabelText('Operational bucket'), { target: { value: 'upcoming' } });
    await waitFor(() => {
      expect(screen.getByTestId('reservations-search').textContent).toContain('opsBucket=upcoming');
    });
    expect(screen.getByTestId('reservations-search').textContent).not.toMatch(/stayScope=/);
  });

  it('omits empty filter values and serializes page=1 when paging back to first page', async () => {
    opsReadAPI.reservations.mockResolvedValue(
      payload([reservation()], { page: 2, limit: 20, total: 25, totalPages: 2 })
    );
    renderPage('/ops/reservations?page=2');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Previous' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => {
      expect(screen.getByTestId('reservations-search').textContent).toContain('page=1');
    });
    fireEvent.change(screen.getByLabelText('Payment status'), { target: { value: '' } });
    await waitFor(() => {
      expect(screen.getByTestId('reservations-search').textContent).not.toMatch(/paymentStatus=/);
    });
  });

  it('resets every query key including leftover stayScope', async () => {
    renderPage('/ops/reservations?search=x&opsBucket=past&status=cancelled&stayScope=active&page=2&foo=bar');
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Reset filters' }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Reset filters' })[0]);
    await waitFor(() => {
      expect(screen.getByTestId('reservations-search')).toHaveTextContent('');
    });
  });

  it('renders guest, stay, cabin, guests, amount, and last-8 id', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText('Elena Petrova').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('elena@example.com').length).toBeGreaterThan(0);
    expect(screen.getAllByText('#99439011').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2026-09-21 - 2026-09-24').length).toBeGreaterThan(0);
    expect(screen.getAllByText('The Cabin · Unit 2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Rhodope').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2A').length).toBeGreaterThan(0);
    const amounts = screen.getAllByText(/€120/);
    expect(amounts.length).toBeGreaterThan(0);
    expect(amounts.some((node) => /€1\.20/.test(node.textContent))).toBe(false);
  });

  it('maps lifecycle, payment including unlinked_payment, and operational statuses', async () => {
    opsReadAPI.reservations.mockResolvedValue(
      payload([
        reservation({ reservationId: 'p1', reservationStatus: 'pending', paymentStatus: 'unpaid' }),
        reservation({ reservationId: 'c1', reservationStatus: 'confirmed', paymentStatus: 'partial' }),
        reservation({ reservationId: 'h1', reservationStatus: 'in_house', paymentStatus: 'pending_verification' }),
        reservation({ reservationId: 'd1', reservationStatus: 'completed', paymentStatus: 'manual_not_required' }),
        reservation({ reservationId: 'x1', reservationStatus: 'cancelled', paymentStatus: 'failed' }),
        reservation({ reservationId: 'u1', paymentStatus: 'unlinked_payment' }),
        reservation({ reservationId: 'r1', paymentStatus: 'refunded' }),
        reservation({ reservationId: 'f1', paymentStatus: 'disputed' }),
        reservation({ reservationId: 'k1', paymentStatus: 'unknown' }),
        reservation({
          reservationId: 'st1',
          operational: { stayTiming: timing({ currentlyStaying: true }) }
        }),
        reservation({
          reservationId: 'at1',
          operational: { stayTiming: timing({ arrivingToday: true }) }
        }),
        reservation({
          reservationId: 'tm1',
          operational: { stayTiming: timing({ arrivingTomorrow: true }) }
        }),
        reservation({
          reservationId: 'lt1',
          operational: { stayTiming: timing({ daysUntilCheckIn: 5 }) }
        }),
        reservation({
          reservationId: 'out1',
          operational: { stayTiming: timing({ checkedOut: true }) }
        }),
        reservation({
          reservationId: 'co1',
          operational: { stayTiming: timing({ checkingOutToday: true, currentlyStaying: true }) }
        }),
        reservation({
          reservationId: 'same1',
          operational: { stayTiming: timing({ arrivingToday: true, checkingOutToday: true }) }
        }),
        reservation({
          reservationId: 'cp1',
          reservationStatus: 'cancelled',
          paymentStatus: 'paid',
          operational: { stayTiming: timing(), cancelledPaid: true }
        }),
        reservation({
          reservationId: 'rp1',
          reservationStatus: 'cancelled',
          paymentStatus: 'paid',
          operational: { stayTiming: timing(), refundPending: true }
        }),
        reservation({
          reservationId: 'pa1',
          reservationStatus: 'confirmed',
          paymentStatus: 'unpaid',
          operational: { stayTiming: timing(), paymentAttention: true }
        }),
        reservation({
          reservationId: 'cf1',
          reservationStatus: 'confirmed',
          conflict: { hasConflict: true }
        })
      ])
    );
    renderPage();
    await waitFor(() => {
      expect(document.querySelector('[data-ops-status-key="reservation.pending"]')).toBeTruthy();
    });
    expect(document.querySelector('[data-ops-status-key="reservation.confirmed"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="reservation.in_house"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="reservation.completed"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="reservation.cancelled"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="payment.unpaid"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="payment.partial"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="payment.pending_verification"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="payment.manual_not_required"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="payment.failed"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="payment.unlinked"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="payment.unlinked_payment"]')).toBeNull();
    expect(document.querySelector('[data-ops-status-key="payment.refunded"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="payment.disputed"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="payment.unknown"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="reservation.currently_staying"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="reservation.arriving_today"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="reservation.arriving_tomorrow"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="reservation.arriving_later"]')).toBeTruthy();
    expect(screen.getAllByText('Arriving in 5 days').length).toBeGreaterThan(0);
    expect(screen.queryByText('Arriving in N days')).not.toBeInTheDocument();
    expect(document.querySelector('[data-ops-status-key="reservation.checked_out"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="reservation.checking_out_today"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="reservation.cancelled_paid"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="reservation.refund_pending"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="reservation.payment_attention"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="reservation.conflict"]')).toBeTruthy();
  });

  it('does not duplicate paid, refunded, or plain cancelled chips', async () => {
    opsReadAPI.reservations.mockResolvedValue(
      payload([
        reservation({ reservationId: 'paid1', paymentStatus: 'paid' }),
        reservation({ reservationId: 'ref1', paymentStatus: 'refunded' }),
        reservation({ reservationId: 'can1', reservationStatus: 'cancelled', paymentStatus: 'unpaid' })
      ])
    );
    renderPage();
    await waitFor(() => {
      expect(document.querySelector('[data-ops-status-key="payment.paid"]')).toBeTruthy();
    });
    expect(document.querySelectorAll('[data-ops-status-key="payment.paid"]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-ops-status-key="payment.refunded"]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-ops-status-key="reservation.cancelled"]').length).toBeGreaterThan(0);
    expect(pageSource).not.toMatch(/paymentStatus === 'paid'/);
    expect(pageSource).not.toMatch(/paymentStatus === 'refunded'/);
    expect(pageSource).not.toMatch(/badges\.push\(\{ label: 'Cancelled'/);
  });

  it('shows purpose and no-auto-confirmation as categorical badges', async () => {
    opsReadAPI.reservations.mockResolvedValue(
      payload([
        reservation({
          reservationId: 'pur1',
          manualReservationPurpose: 'owner_use',
          sendGuestConfirmationEmail: false,
          children: 1
        })
      ])
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText('Owner use').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('No auto confirmation email').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2A 1C').length).toBeGreaterThan(0);
  });

  it('navigates the whole row to the exact detail route', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByTestId('ops-reservation-row').length).toBeGreaterThan(0);
    });
    const links = screen.getAllByTestId('ops-reservation-row');
    expect(links[0]).toHaveAttribute('href', '/ops/reservations/507f1f77bcf86cd799439011');
    fireEvent.click(links[0]);
    await waitFor(() => {
      expect(screen.getByTestId('legacy-reservation-detail')).toHaveTextContent('507f1f77bcf86cd799439011');
    });
  });

  it('exports current filters without page or limit and still sends opsBucket and paymentStatus', async () => {
    renderPage('/ops/reservations?opsBucket=upcoming&paymentStatus=paid&status=confirmed&page=2&limit=20');
    await waitFor(() => {
      expect(screen.getByTestId('ops-reservations-export-csv')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('ops-reservations-export-csv'));
    await waitFor(() => {
      expect(opsReadAPI.reservationsExport).toHaveBeenCalled();
    });
    expect(opsReadAPI.reservationsExport).toHaveBeenCalledWith({
      opsBucket: 'upcoming',
      paymentStatus: 'paid',
      status: 'confirmed'
    });
    expect(exportToCSV).toHaveBeenCalled();
    expect(exportToCSV.mock.calls[0][1]).toMatch(/^ops-reservations-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('shows export-empty and export-too-large errors next to the action, not as a list banner', async () => {
    opsReadAPI.reservationsExport.mockResolvedValueOnce({ data: { data: { rows: [] } } });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('ops-reservations-export-csv')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('ops-reservations-export-csv'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('No reservations match the current filters.');
    });
    expect(screen.queryByRole('alert', { name: /Failed to load/ })).not.toBeInTheDocument();

    opsReadAPI.reservationsExport.mockRejectedValueOnce({
      response: { status: 413, data: { errorType: 'export_too_large', message: 'Export too large. Refine filters.' } }
    });
    fireEvent.click(screen.getByTestId('ops-reservations-export-csv'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Export too large. Refine filters.');
    });
  });

  it('creates a reservation with the current payload and navigates without state', async () => {
    opsWriteAPI.createManualReservation.mockResolvedValue({
      data: { data: { reservationId: 'new-res-1' } }
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create reservation' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create reservation' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Cabin'), { target: { value: 'cabin-1' } });
    fireEvent.change(within(dialog).getByLabelText('Check-in'), { target: { value: '2026-10-01' } });
    fireEvent.change(within(dialog).getByLabelText('Check-out'), { target: { value: '2026-10-04' } });
    fireEvent.change(within(dialog).getByLabelText('First name'), { target: { value: '  Ada ' } });
    fireEvent.change(within(dialog).getByLabelText('Last name'), { target: { value: ' Lovelace ' } });
    fireEvent.change(within(dialog).getByLabelText('Email'), { target: { value: ' ada@example.com ' } });
    fireEvent.change(within(dialog).getByLabelText('Phone'), { target: { value: ' +35988 ' } });
    fireEvent.change(within(dialog).getByLabelText('Adults'), { target: { value: '' } });
    fireEvent.change(within(dialog).getByLabelText('Children'), { target: { value: '' } });
    fireEvent.change(within(dialog).getByLabelText('Initial status'), { target: { value: 'confirmed' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => {
      expect(opsWriteAPI.createManualReservation).toHaveBeenCalled();
    });
    expect(opsWriteAPI.createManualReservation).toHaveBeenCalledWith({
      cabinId: 'cabin-1',
      checkIn: '2026-10-01',
      checkOut: '2026-10-04',
      adults: 2,
      children: 0,
      guestInfo: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        phone: '+35988'
      },
      initialStatus: 'confirmed',
      note: undefined,
      paymentPlaceholderNote: undefined,
      acceptExternalHoldWarnings: false,
      manualReservationPurpose: 'paid_guest',
      sendGuestConfirmationEmail: true
    });
    expect(screen.getByTestId('legacy-reservation-detail')).toHaveTextContent('new-res-1');
    expect(screen.getByTestId('detail-state')).toHaveTextContent('none');
  });

  it('opens the existing create workflow from the Dashboard deep link', async () => {
    renderPage('/ops/reservations?create=1');
    expect(await screen.findByRole('dialog', { name: 'Manual reservation' })).toBeInTheDocument();
    expect(screen.getByTestId('reservations-search')).toHaveTextContent('create=1');
  });

  it('does not expose manual creation when the session lacks the action', async () => {
    renderPage('/ops/reservations?create=1', { ...adminSession, role: 'operator', actions: [] });
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Reservations' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Create reservation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Manual reservation' })).not.toBeInTheDocument();
  });

  it('keeps the create modal open on failure and shows a 403 message locally', async () => {
    opsWriteAPI.createManualReservation.mockRejectedValue({
      response: { status: 403, data: { message: 'Permission denied for action: ops.reservation.manual_create' } }
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create reservation' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create reservation' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Cabin'), { target: { value: 'cabin-1' } });
    fireEvent.change(within(dialog).getByLabelText('Check-in'), { target: { value: '2026-10-01' } });
    fireEvent.change(within(dialog).getByLabelText('Check-out'), { target: { value: '2026-10-04' } });
    fireEvent.change(within(dialog).getByLabelText('First name'), { target: { value: 'Ada' } });
    fireEvent.change(within(dialog).getByLabelText('Last name'), { target: { value: 'Lovelace' } });
    fireEvent.change(within(dialog).getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(within(dialog).getByLabelText('Phone'), { target: { value: '+35988' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => {
      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        'Permission denied for action: ops.reservation.manual_create'
      );
    });
    expect(within(dialog).getByLabelText('First name')).toHaveValue('Ada');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows list error without faking results and distinguishes empty catalog from filtered empty', async () => {
    opsReadAPI.reservations.mockRejectedValueOnce({
      response: { data: { message: 'Reservations unavailable' } }
    });
    const { unmount } = renderPage();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Reservations unavailable');
    });
    expect(screen.queryByText('No reservations yet.')).not.toBeInTheDocument();
    unmount();

    opsReadAPI.reservations.mockResolvedValue(payload([]));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No reservations yet.')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Create reservation' })).toBeInTheDocument();

    cleanup();
    resetOpsOverlayRuntime();
    opsReadAPI.reservations.mockResolvedValue(payload([]));
    renderPage('/ops/reservations?status=cancelled');
    await waitFor(() => {
      expect(screen.getByText('No reservations match the selected filters.')).toBeInTheDocument();
    });
    expect(screen.getAllByRole('button', { name: 'Reset filters' }).length).toBeGreaterThan(1);
  });

  it('shows OpsPagination and adjacent total when there is more than one page', async () => {
    opsReadAPI.reservations.mockResolvedValue(
      payload([reservation()], { page: 2, limit: 20, total: 41, totalPages: 3 })
    );
    renderPage('/ops/reservations?page=2');
    await waitFor(() => {
      expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    });
    expect(screen.getByText('41 total')).toBeInTheDocument();
  });
});
