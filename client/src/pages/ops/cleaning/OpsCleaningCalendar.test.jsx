import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OpsSessionProvider } from '../../../context/OpsSessionContext';
import { OpsAppearanceProvider } from '../../../ops/appearance/OpsAppearanceProvider';
import { getOpsCleanerMessage } from '../../../ops/i18n/opsUiLanguage';
import OpsCleaningCalendar from './OpsCleaningCalendar';

vi.mock('../../../services/cleaningApi', () => ({
  getCleaningSchedule: vi.fn(),
  getCleaningPaymentSummary: vi.fn(),
  getCleaningPayoutSummary: vi.fn(),
  markCleaned: vi.fn(),
  unmarkCleaned: vi.fn(),
  markPaid: vi.fn(),
  unmarkPaid: vi.fn()
}));

import {
  getCleaningSchedule,
  getCleaningPaymentSummary,
  getCleaningPayoutSummary,
  markCleaned,
  unmarkCleaned,
  markPaid
} from '../../../services/cleaningApi';

const adminSession = {
  authenticated: true,
  actorId: 'admin-1',
  role: 'admin',
  modules: ['*'],
  actions: [
    'ops.cleaning.payment_read',
    'ops.cleaning.payment_write',
    'ops.cleaning.payout_read'
  ],
  defaultRoute: '/ops',
  locale: 'en'
};

const cleanerSessionEn = {
  authenticated: true,
  actorId: 'cleaner-1',
  role: 'cleaner',
  modules: ['cleaning'],
  actions: ['ops.cleaning.payout_read'],
  defaultRoute: '/ops/cleaning',
  locale: 'en'
};

const cleanerSessionBg = {
  ...cleanerSessionEn,
  locale: 'bg'
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function emptyDay() {
  return { checkouts: [], checkins: [] };
}

function scheduleWithTasks() {
  const date = todayKey();
  return {
    checkouts: [
      {
        bookingId: 'b-pending',
        cabinName: 'A-Frame Long Cabin Name For QA',
        unitLabel: 'A-Frame 2',
        cleaningDate: date,
        checkoutTime: '11:00',
        status: 'pending',
        sameDayTurn: false,
        cleaningNotes: 'Please restock towels and leave firewood stacked by the door for guest notes.'
      },
      {
        bookingId: 'b-done',
        cabinName: 'Stone House',
        unitLabel: null,
        cleaningDate: date,
        checkoutTime: '11:00',
        status: 'cleaned',
        sameDayTurn: false,
        cleaningNotes: null
      },
      {
        bookingId: 'b-same',
        cabinName: 'A-Frame',
        unitLabel: 'A-Frame 3',
        cleaningDate: date,
        checkoutTime: '11:00',
        nextCheckInTime: '15:00',
        status: 'pending',
        sameDayTurn: true,
        cleaningNotes: null
      }
    ],
    checkins: [
      {
        bookingId: 'b-in',
        cabinName: 'Lux Cabin',
        unitLabel: null,
        checkinTime: '15:00',
        cleaningNotes: null
      }
    ]
  };
}

function renderCalendar(session = adminSession) {
  return render(
    <MemoryRouter initialEntries={['/ops/cleaning']}>
      <OpsAppearanceProvider>
        <OpsSessionProvider session={session}>
          <OpsCleaningCalendar />
        </OpsSessionProvider>
      </OpsAppearanceProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getCleaningSchedule.mockResolvedValue({ data: { data: emptyDay() } });
  getCleaningPaymentSummary.mockResolvedValue({ data: { data: null } });
  getCleaningPayoutSummary.mockResolvedValue({
    data: {
      data: {
        currency: 'EUR',
        totalAmount: 0,
        checkoutCount: 0,
        paidAmount: 0,
        noPolicyZones: [],
        zones: {},
        lineItems: []
      }
    }
  });
});

afterEach(() => {
  cleanup();
});

describe('OpsCleaningCalendar migration', () => {
  it('uses OpsPage full width and admin OpsPageHeader without cleaner chrome', async () => {
    renderCalendar(adminSession);
    await waitFor(() => expect(getCleaningSchedule).toHaveBeenCalled());
    const page = screen.getByTestId('ops-page');
    expect(page).toHaveAttribute('data-ops-page-width', 'full');
    expect(screen.getByRole('heading', { name: 'Cleaning' })).toBeInTheDocument();
    expect(screen.queryByTestId('ops-mobile-header')).not.toBeInTheDocument();
  });

  it('omits OpsPageHeader for cleaner-only session', async () => {
    renderCalendar(cleanerSessionEn);
    await waitFor(() => expect(getCleaningSchedule).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: 'Cleaning' })).not.toBeInTheDocument();
    expect(screen.getByTestId('ops-cleaning-calendar')).toBeInTheDocument();
  });

  it('reads day schedule with date + propertyKind and does not poll', async () => {
    renderCalendar(adminSession);
    await waitFor(() => expect(getCleaningSchedule.mock.calls.length).toBeGreaterThan(0));
    const dayCalls = getCleaningSchedule.mock.calls.filter(
      ([args]) => args?.date === todayKey()
    );
    expect(dayCalls.length).toBeGreaterThanOrEqual(1);
    expect(dayCalls[0][0]).toEqual({ date: todayKey(), propertyKind: null });
    const before = getCleaningSchedule.mock.calls.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(getCleaningSchedule.mock.calls.length).toBe(before);
  });

  it('loads payment summary only when zone is selected and payment_read is present', async () => {
    getCleaningSchedule.mockResolvedValue({ data: { data: scheduleWithTasks() } });
    getCleaningPaymentSummary.mockResolvedValue({
      data: {
        data: {
          currency: 'EUR',
          totalAmount: 40,
          paidAmount: 0,
          status: 'pending',
          cabinCount: 2,
          lineItems: [],
          isSnapshot: false
        }
      }
    });
    renderCalendar(adminSession);
    await waitFor(() => expect(screen.getByTestId('location-select')).toBeInTheDocument());
    expect(getCleaningPaymentSummary).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('location-select'));
    fireEvent.click(screen.getByRole('button', { name: 'The Valley' }));

    await waitFor(() =>
      expect(getCleaningPaymentSummary).toHaveBeenCalledWith({
        date: todayKey(),
        propertyKind: 'valley'
      })
    );
  });

  it('displays pending, done, same-day turn, unit labels, notes, and check-in', async () => {
    getCleaningSchedule.mockResolvedValue({ data: { data: scheduleWithTasks() } });
    renderCalendar(adminSession);
    await waitFor(() => expect(screen.getAllByTestId('checkout-card').length).toBe(3));

    const cards = screen.getAllByTestId('checkout-card');
    expect(within(cards[0]).getByText(/A-Frame Long Cabin Name For QA/)).toBeInTheDocument();
    expect(within(cards[0]).getByText(/A-Frame 2/)).toBeInTheDocument();
    expect(within(cards[0]).getByText(getOpsCleanerMessage('status.cleaning.pending', 'en'))).toBeInTheDocument();
    expect(
      within(cards[0]).getByText(/Please restock towels and leave firewood stacked/)
    ).toBeInTheDocument();

    expect(within(cards[1]).getByText(getOpsCleanerMessage('status.cleaning.done', 'en'))).toBeInTheDocument();

    const sameDay = screen.getByTestId('same-day-turn');
    expect(within(sameDay).getByText(getOpsCleanerMessage('status.cleaning.same_day_turn', 'en'))).toBeInTheDocument();
    expect(sameDay).toHaveTextContent(/next 3:00 PM/);
    expect(cards[2]).toHaveAttribute('data-same-day', 'true');
    expect(cards[2]).toHaveAttribute('data-unit-label', 'A-Frame 3');
    expect(cards[0]).toHaveAttribute('data-unit-label', 'A-Frame 2');

    expect(screen.getByTestId('checkin-card')).toHaveTextContent('Lux Cabin');
    expect(screen.getByTestId('checkin-card')).toHaveTextContent(/Check-in: 3:00 PM/);
  });

  it('keeps A-Frame 2 and A-Frame 3 as separate unit identities', async () => {
    getCleaningSchedule.mockResolvedValue({ data: { data: scheduleWithTasks() } });
    renderCalendar(adminSession);
    await waitFor(() => expect(screen.getAllByTestId('checkout-card').length).toBe(3));
    const unitLabels = screen
      .getAllByTestId('checkout-card')
      .map((el) => el.getAttribute('data-unit-label'))
      .filter(Boolean);
    expect(unitLabels).toEqual(expect.arrayContaining(['A-Frame 2', 'A-Frame 3']));
    expect(unitLabels.filter((u) => u === 'A-Frame 2')).toHaveLength(1);
    expect(unitLabels.filter((u) => u === 'A-Frame 3')).toHaveLength(1);
  });

  it('marks cleaned with exact payload and refetches', async () => {
    getCleaningSchedule.mockResolvedValue({ data: { data: scheduleWithTasks() } });
    markCleaned.mockResolvedValue({ data: { success: true } });
    renderCalendar(adminSession);
    await waitFor(() => expect(screen.getAllByTestId('mark-cleaned').length).toBeGreaterThan(0));
    const pendingBtn = screen.getAllByTestId('mark-cleaned')[0];
    fireEvent.click(pendingBtn);
    await waitFor(() =>
      expect(markCleaned).toHaveBeenCalledWith('b-pending', todayKey())
    );
    expect(unmarkCleaned).not.toHaveBeenCalled();
  });

  it('unmarks cleaned with exact payload', async () => {
    getCleaningSchedule.mockResolvedValue({ data: { data: scheduleWithTasks() } });
    unmarkCleaned.mockResolvedValue({ data: { success: true } });
    renderCalendar(adminSession);
    await waitFor(() => expect(screen.getAllByTestId('mark-cleaned').length).toBe(3));
    fireEvent.click(screen.getAllByTestId('mark-cleaned')[1]);
    await waitFor(() => expect(unmarkCleaned).toHaveBeenCalledWith('b-done', todayKey()));
  });

  it('marks paid with exact payload for selected zone', async () => {
    getCleaningSchedule.mockResolvedValue({ data: { data: scheduleWithTasks() } });
    getCleaningPaymentSummary.mockResolvedValue({
      data: {
        data: {
          currency: 'EUR',
          totalAmount: 40,
          paidAmount: 0,
          status: 'pending',
          cabinCount: 2,
          lineItems: [],
          isSnapshot: false
        }
      }
    });
    markPaid.mockResolvedValue({ data: { success: true } });
    renderCalendar(adminSession);
    fireEvent.click(screen.getByTestId('location-select'));
    fireEvent.click(screen.getByRole('button', { name: 'The Cabin' }));
    await waitFor(() => expect(screen.getByTestId('toggle-paid')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('toggle-paid'));
    await waitFor(() =>
      expect(markPaid).toHaveBeenCalledWith({ date: todayKey(), propertyKind: 'cabin' })
    );
  });

  it('shows load error via OpsBanner and keeps empty schedule without fake tasks', async () => {
    getCleaningSchedule.mockRejectedValue({
      response: { data: { message: 'Schedule unavailable' } }
    });
    renderCalendar(adminSession);
    await waitFor(() => expect(screen.getByText('Schedule unavailable')).toBeInTheDocument());
    expect(screen.queryByTestId('checkout-card')).not.toBeInTheDocument();
    expect(screen.queryByText(/No cleaning events/)).not.toBeInTheDocument();
  });

  it('retains mark-cleaned error after write failure', async () => {
    getCleaningSchedule.mockResolvedValue({ data: { data: scheduleWithTasks() } });
    markCleaned.mockRejectedValue({
      response: { data: { message: 'Clean write failed' } }
    });
    renderCalendar(adminSession);
    await waitFor(() => expect(screen.getAllByTestId('mark-cleaned').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByTestId('mark-cleaned')[0]);
    await waitFor(() => expect(screen.getByText('Clean write failed')).toBeInTheDocument());
    expect(screen.getAllByTestId('checkout-card').length).toBe(3);
  });

  it('renders empty day copy without a giant empty card', async () => {
    renderCalendar(adminSession);
    await waitFor(() => expect(screen.getByText(/No cleaning events for/)).toBeInTheDocument());
    expect(screen.queryByTestId('checkout-card')).not.toBeInTheDocument();
  });

  it('shows cleaner EN status labels from registry', async () => {
    getCleaningSchedule.mockResolvedValue({ data: { data: scheduleWithTasks() } });
    renderCalendar(cleanerSessionEn);
    await waitFor(() => expect(screen.getByTestId('same-day-turn')).toBeInTheDocument());
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Done').length).toBeGreaterThan(0);
    expect(screen.getByText('Same-day turn')).toBeInTheDocument();
  });

  it('shows cleaner BG status labels from registry', async () => {
    getCleaningSchedule.mockResolvedValue({ data: { data: scheduleWithTasks() } });
    renderCalendar(cleanerSessionBg);
    await waitFor(() => expect(screen.getByTestId('same-day-turn')).toBeInTheDocument());
    expect(screen.getAllByText('За почистване').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Почистено').length).toBeGreaterThan(0);
    expect(screen.getByText('Смяна в същия ден')).toBeInTheDocument();
  });

  it('navigates Today without changing API date helper semantics', async () => {
    renderCalendar(adminSession);
    await waitFor(() => expect(screen.getByTestId('cleaning-today')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('cleaning-today'));
    await waitFor(() =>
      expect(getCleaningSchedule).toHaveBeenCalledWith({
        date: todayKey(),
        propertyKind: null
      })
    );
  });

  it('uses CSS layout classes instead of Tailwind lg:hidden / col-span grid', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(dir, 'OpsCleaningCalendar.jsx'), 'utf8');
    expect(source).toMatch(/ops-cleaning-cal__mobile-panels/);
    expect(source).toMatch(/ops-cleaning-cal__aside/);
    expect(source).toMatch(/getCleaningPayoutSummary/);
    expect(source).not.toMatch(/Select Cabin or Valley to view payment summary/);
    expect(source).not.toMatch(/Playfair/);
    expect(source).not.toMatch(/lg:hidden/);
    expect(source).not.toMatch(/lg:col-span-7/);
  });
});
