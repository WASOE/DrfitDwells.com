import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { formatInTimeZone } from 'date-fns-tz';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { OpsSessionProvider } from '../../../context/OpsSessionContext';
import { OPS_CALENDAR_TZ, parseIsoDay, ymdUtc, addDaysUtc } from './opsCalendarDateUtils';
import OpsWorkWindows from './OpsWorkWindows';

vi.mock('../../../services/opsApi', () => ({
  opsReadAPI: {
    workWindows: vi.fn()
  }
}));

import { opsReadAPI } from '../../../services/opsApi';

const adminSession = {
  authenticated: true,
  actorId: 'admin-1',
  role: 'admin',
  modules: ['*'],
  actions: [],
  defaultRoute: '/ops',
  locale: 'en'
};

function sofiaTodayYmd() {
  return formatInTimeZone(new Date(), OPS_CALENDAR_TZ, 'yyyy-MM-dd');
}

function defaultToYmd(fromYmd, exclusiveDays = 60) {
  const start = parseIsoDay(fromYmd);
  if (!start) return fromYmd;
  return ymdUtc(addDaysUtc(start, exclusiveDays));
}

function resultsPayload(overrides = {}) {
  const from = sofiaTodayYmd();
  const to = defaultToYmd(from, 60);
  const dayKeys = [from, defaultToYmd(from, 1)];
  return {
    data: {
      data: {
        generatedAt: '2026-09-20T10:00:00.000Z',
        checkOutTime: '11:00',
        checkInTime: '15:00',
        timezone: 'Europe/Sofia',
        dayKeys,
        bestWindows: [
          {
            kind: 'location',
            resourceId: 'loc-valley',
            label: 'The Valley',
            startAt: `${from}T15:00:00+03:00`,
            endAt: `${to}T11:00:00+03:00`,
            durationMinutes: 60 * 24 * 3,
            continuesBeyondRange: false
          }
        ],
        resources: [
          {
            resourceId: 'loc-valley',
            kind: 'location',
            label: 'The Valley',
            spans: [
              {
                spanId: 'loc-free-1',
                state: 'free',
                startAt: `${from}T15:00:00+03:00`,
                endAt: `${dayKeys[1]}T11:00:00+03:00`,
                durationMinutes: 1200
              }
            ]
          },
          {
            resourceId: 'unit-af2',
            kind: 'unit',
            label: 'A-Frame 2',
            spans: [
              {
                spanId: 'af2-occ-1',
                state: 'occupied',
                startAt: `${from}T15:00:00+03:00`,
                endAt: `${dayKeys[1]}T11:00:00+03:00`,
                durationMinutes: 1200,
                source: { status: 'confirmed', guestLabel: 'Guest A' }
              },
              {
                spanId: 'af2-ta-1',
                state: 'turnaround',
                startAt: `${dayKeys[1]}T11:00:00+03:00`,
                endAt: `${dayKeys[1]}T15:00:00+03:00`,
                durationMinutes: 240
              }
            ]
          },
          {
            resourceId: 'unit-af3',
            kind: 'unit',
            label: 'A-Frame 3',
            spans: [
              {
                spanId: 'af3-free-1',
                state: 'free',
                startAt: `${from}T15:00:00+03:00`,
                endAt: `${dayKeys[1]}T11:00:00+03:00`,
                durationMinutes: 1200
              },
              {
                spanId: 'af3-block-1',
                state: 'blocked',
                blockSubtype: 'maintenance',
                startAt: `${dayKeys[1]}T11:00:00+03:00`,
                endAt: `${dayKeys[1]}T15:00:00+03:00`,
                durationMinutes: 240
              }
            ]
          }
        ],
        ...overrides
      }
    }
  };
}

function renderPage() {
  return render(
    <div className="ops-root" data-ops-appearance="light" data-ops-themed="true">
      <OpsSessionProvider session={adminSession}>
        <MemoryRouter initialEntries={['/ops/calendar/work-windows']}>
          <Routes>
            <Route path="/ops/calendar/work-windows" element={<OpsWorkWindows />} />
          </Routes>
        </MemoryRouter>
      </OpsSessionProvider>
    </div>
  );
}

describe('OpsWorkWindows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('does not call workWindows on mount', () => {
    renderPage();
    expect(opsReadAPI.workWindows).not.toHaveBeenCalled();
    expect(screen.getByText(/Nothing loads until you check/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Choose a location and date range, then check availability/i)
    ).toBeInTheDocument();
  });

  it('uses OpsPage full width and Sofia today / +60 defaults', () => {
    renderPage();
    const page = screen.getByTestId('ops-page');
    expect(page).toHaveAttribute('data-ops-page-width', 'full');
    expect(screen.getByRole('heading', { name: 'Work windows' })).toBeInTheDocument();

    const expectedFrom = sofiaTodayYmd();
    const expectedTo = defaultToYmd(expectedFrom, 60);
    expect(screen.getByLabelText('From')).toHaveValue(expectedFrom);
    expect(screen.getByLabelText('To')).toHaveValue(expectedTo);
    expect(screen.getByLabelText('Location')).toHaveValue('valley');
  });

  it('calls workWindows with exact params after Check availability', async () => {
    opsReadAPI.workWindows.mockResolvedValueOnce(resultsPayload());
    renderPage();

    const from = sofiaTodayYmd();
    const to = defaultToYmd(from, 60);
    fireEvent.click(screen.getByRole('button', { name: 'Check availability' }));

    await waitFor(() => {
      expect(opsReadAPI.workWindows).toHaveBeenCalledTimes(1);
    });
    expect(opsReadAPI.workWindows).toHaveBeenCalledWith({
      locationKey: 'valley',
      from,
      to
    });
  });

  it('validation error retains fields and does not call the API', () => {
    renderPage();
    const fromInput = screen.getByLabelText('From');
    const toInput = screen.getByLabelText('To');
    fireEvent.change(fromInput, { target: { value: '2026-10-10' } });
    fireEvent.change(toInput, { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'cabin' } });

    fireEvent.click(screen.getByRole('button', { name: 'Check availability' }));

    expect(opsReadAPI.workWindows).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('To must be after From.');
    expect(fromInput).toHaveValue('2026-10-10');
    expect(toInput).toHaveValue('2026-10-01');
    expect(screen.getByLabelText('Location')).toHaveValue('cabin');
  });

  it('request error retains fields and shows a danger banner', async () => {
    opsReadAPI.workWindows.mockRejectedValueOnce({
      response: { data: { message: 'Upstream unavailable' } }
    });
    renderPage();

    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'cabin' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check availability' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Upstream unavailable');
    });
    expect(screen.getByLabelText('Location')).toHaveValue('cabin');
    expect(screen.getByLabelText('From')).toHaveValue('2026-09-01');
    expect(screen.getByLabelText('To')).toHaveValue('2026-09-20');
  });

  it('renders free / occupied / blocked / turnaround labels and isolates unit rows', async () => {
    opsReadAPI.workWindows.mockResolvedValueOnce(resultsPayload());
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Check availability' }));

    await waitFor(() => {
      expect(screen.getByText('Timeline')).toBeInTheDocument();
    });

    expect(screen.getAllByText('Free').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Occupied')).toBeInTheDocument();
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(screen.getByText('Turnaround')).toBeInTheDocument();

    const legend = document.querySelector('.ops-ww__legend');
    expect(legend).toBeTruthy();
    expect(within(legend).getByText('Free')).toBeInTheDocument();
    expect(within(legend).getByText('Occupied')).toBeInTheDocument();
    expect(within(legend).getByText('Blocked')).toBeInTheDocument();
    expect(within(legend).getByText('Turnaround')).toBeInTheDocument();

    const af2Rows = screen.getAllByText('A-Frame 2');
    const af3Rows = screen.getAllByText('A-Frame 3');
    expect(af2Rows.length).toBeGreaterThanOrEqual(1);
    expect(af3Rows.length).toBeGreaterThanOrEqual(1);

    const af2Row = document.querySelector(
      '.ops-ww__resource-row[data-resource-label="A-Frame 2"]'
    );
    const af3Row = document.querySelector(
      '.ops-ww__resource-row[data-resource-label="A-Frame 3"]'
    );
    expect(af2Row).toBeTruthy();
    expect(af3Row).toBeTruthy();
    expect(af2Row).not.toBe(af3Row);

    expect(within(af2Row).getByTitle(/Confirmed booking/i)).toHaveAttribute(
      'data-span-state',
      'occupied'
    );
    expect(within(af2Row).getByTitle(/Turnaround/i)).toHaveAttribute(
      'data-span-state',
      'turnaround'
    );
    expect(within(af3Row).getByTitle(/Free work window/i)).toHaveAttribute(
      'data-span-state',
      'free'
    );
    expect(within(af3Row).getByTitle(/Maintenance/i)).toHaveAttribute(
      'data-span-state',
      'blocked'
    );
  });

  it('shows empty best windows copy when none exist', async () => {
    opsReadAPI.workWindows.mockResolvedValueOnce(
      resultsPayload({
        bestWindows: [],
        resources: [
          {
            resourceId: 'unit-af2',
            kind: 'unit',
            label: 'A-Frame 2',
            spans: [
              {
                spanId: 'af2-occ-only',
                state: 'occupied',
                startAt: `${sofiaTodayYmd()}T15:00:00+03:00`,
                endAt: `${defaultToYmd(sofiaTodayYmd(), 1)}T11:00:00+03:00`,
                durationMinutes: 1200,
                source: { status: 'confirmed' }
              }
            ]
          }
        ]
      })
    );
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Check availability' }));

    await waitFor(() => {
      expect(
        screen.getByText(/No multi-day free windows in this range — every day has guest occupancy or a block\./i)
      ).toBeInTheDocument();
    });
  });
});
