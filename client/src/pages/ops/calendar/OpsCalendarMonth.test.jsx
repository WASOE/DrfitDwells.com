import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { OpsSessionProvider } from '../../../context/OpsSessionContext';
import OpsCalendarMonth from './OpsCalendarMonth';
import { BLOCK_BAR, BLOCK_DOT, CONFLICT_RING } from './calendarVisualTokens';

vi.mock('../../../services/opsApi', () => ({
  opsReadAPI: {
    calendar: vi.fn(),
    cabinDetail: vi.fn()
  },
  opsWriteAPI: {
    createManualBlock: vi.fn(),
    createMaintenanceBlock: vi.fn(),
    editManualBlock: vi.fn(),
    editMaintenanceBlock: vi.fn(),
    removeManualBlock: vi.fn(),
    removeMaintenanceBlock: vi.fn(),
    removeLocationBlockGroup: vi.fn()
  }
}));

vi.mock('./opsCalendarDateUtils', async () => {
  const actual = await vi.importActual('./opsCalendarDateUtils');
  return {
    ...actual,
    sofiaNowYearMonth: () => ({ year: 2026, monthIndex: 8 })
  };
});

import { opsReadAPI, opsWriteAPI } from '../../../services/opsApi';

const CABIN_ID = '507f1f77bcf86cd799439011';

const adminSession = {
  authenticated: true,
  actorId: 'admin-1',
  role: 'admin',
  modules: ['*'],
  actions: [],
  defaultRoute: '/ops',
  locale: 'en'
};

function monthBlocks() {
  return [
    {
      id: 'res:r1',
      cabinId: CABIN_ID,
      blockType: 'reservation',
      sourceReference: 'res-abc',
      startDate: '2026-09-10T00:00:00.000Z',
      endDate: '2026-09-12T00:00:00.000Z',
      status: 'active',
      render: {
        labelShort: 'Guest A',
        unitLabel: 'A-Frame 2',
        unitId: 'unit-2',
        occupiedDayKeys: ['2026-09-10', '2026-09-11'],
        conflictToken: null
      }
    },
    {
      id: 'ext:e1',
      cabinId: CABIN_ID,
      blockType: 'external_hold',
      sourceReference: 'ical-1',
      startDate: '2026-09-14T00:00:00.000Z',
      endDate: '2026-09-16T00:00:00.000Z',
      status: 'active',
      render: {
        labelShort: 'Channel hold',
        unitLabel: 'A-Frame 3',
        unitId: 'unit-3',
        occupiedDayKeys: ['2026-09-14', '2026-09-15'],
        conflictToken: null
      }
    },
    {
      id: 'block:507f1f77bcf86cd799439099',
      cabinId: CABIN_ID,
      blockType: 'manual_block',
      startDate: '2026-09-20T00:00:00.000Z',
      endDate: '2026-09-21T00:00:00.000Z',
      status: 'active',
      render: {
        labelShort: 'Manual',
        unitLabel: 'A-Frame 2',
        occupiedDayKeys: ['2026-09-20'],
        conflictToken: 'hard'
      }
    }
  ];
}

function calendarPayload(overrides = {}) {
  return {
    data: {
      data: {
        calendarScope: { renderCabinId: CABIN_ID },
        meta: { today: '2026-09-20' },
        syncIndicators: { syncStatus: 'healthy' },
        pricingHint: { nightPrice: 120, currency: 'eur' },
        conflictMarkers: { hard: [{ id: 1 }], warnings: [] },
        blocks: monthBlocks(),
        ...overrides
      }
    }
  };
}

function cabinDetailPayload() {
  return {
    data: {
      data: {
        cabinId: CABIN_ID,
        contentMedia: { name: 'A-Frame Village' }
      }
    }
  };
}

function renderMonth(path = `/ops/calendar/${CABIN_ID}`) {
  return render(
    <div className="ops-root" data-ops-appearance="light" data-ops-themed="true">
      <OpsSessionProvider session={adminSession}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/ops/calendar/:cabinId" element={<OpsCalendarMonth />} />
            <Route path="/ops/calendar" element={<div>Calendar index</div>} />
          </Routes>
        </MemoryRouter>
      </OpsSessionProvider>
    </div>
  );
}

describe('OpsCalendarMonth migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    opsReadAPI.calendar.mockResolvedValue(calendarPayload());
    opsReadAPI.cabinDetail.mockResolvedValue(cabinDetailPayload());
  });

  afterEach(() => {
    cleanup();
  });

  it('uses OpsPage full width with back link and cabin label', async () => {
    renderMonth();
    await waitFor(() => {
      expect(screen.getByText('A-Frame Village')).toBeInTheDocument();
    });
    expect(document.querySelector('.ops-page')).toHaveAttribute('data-ops-page-width', 'full');
    expect(screen.getByRole('link', { name: 'All properties' })).toHaveAttribute('href', '/ops/calendar');
    expect(screen.getByTestId('ops-cal-month-grid')).toBeInTheDocument();
  });

  it('loads month with exact from/to/cabinId and cabin detail', async () => {
    renderMonth();
    await waitFor(() => {
      expect(opsReadAPI.calendar).toHaveBeenCalled();
    });
    const calArgs = opsReadAPI.calendar.mock.calls[0][0];
    expect(calArgs.cabinId).toBe(CABIN_ID);
    expect(calArgs.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(calArgs.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(opsReadAPI.cabinDetail).toHaveBeenCalledWith(CABIN_ID);
  });

  it('shows OpsBanner danger on load error and still keeps shell', async () => {
    opsReadAPI.calendar.mockRejectedValue({ response: { data: { message: 'Month boom' } } });
    renderMonth();
    await waitFor(() => {
      expect(screen.getByText('Month boom')).toBeInTheDocument();
    });
    expect(document.querySelector('.ops-banner--danger')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'All properties' })).toBeInTheDocument();
    expect(screen.getByTestId('ops-cal-month-grid')).toBeInTheDocument();
  });

  it('keeps legend grammar: reservation blue class, external distinct, conflict ring', async () => {
    renderMonth();
    await waitFor(() => {
      expect(screen.getByLabelText('Month calendar block legend')).toBeInTheDocument();
    });
    expect(BLOCK_BAR.reservation).toContain('ops-cal-bar--reservation');
    expect(BLOCK_BAR.reservation).not.toMatch(/danger|conflict|red/i);
    expect(BLOCK_BAR.external_hold).toContain('ops-cal-bar--external');
    expect(BLOCK_BAR.external_hold).not.toBe(BLOCK_BAR.reservation);
    expect(BLOCK_BAR.manual_block).toContain('ops-cal-bar--manual');
    expect(BLOCK_BAR.maintenance).toContain('ops-cal-bar--maintenance');
    expect(BLOCK_DOT.external_hold).toContain('ops-cal-dot--external');
    expect(CONFLICT_RING.hard).toContain('ops-cal-ring--conflict');

    await waitFor(() => {
      expect(document.querySelector('[data-ops-cal-block="reservation"]')).toBeTruthy();
    });
    expect(document.querySelector('[data-ops-cal-block="reservation"]').className).toContain(
      'ops-cal-bar--reservation'
    );
    expect(document.querySelector('[data-ops-cal-block="external_hold"]').className).toContain(
      'ops-cal-bar--external'
    );
    expect(document.querySelector('[data-ops-cal-block="manual_block"]').className).toContain(
      'ops-cal-ring--conflict'
    );
  });

  it('places unit-aware reservation and external hold on correct unit labels only', async () => {
    renderMonth();
    await waitFor(() => {
      expect(document.querySelector('[data-ops-cal-unit="A-Frame 2"]')).toBeTruthy();
    });
    const unit2Bars = [...document.querySelectorAll('[data-ops-cal-unit="A-Frame 2"]')];
    const unit3Bars = [...document.querySelectorAll('[data-ops-cal-unit="A-Frame 3"]')];
    expect(unit2Bars.some((el) => el.getAttribute('data-ops-cal-block') === 'reservation')).toBe(true);
    expect(unit2Bars.some((el) => el.getAttribute('data-ops-cal-block') === 'external_hold')).toBe(false);
    expect(unit3Bars.some((el) => el.getAttribute('data-ops-cal-block') === 'external_hold')).toBe(true);
    expect(unit3Bars.some((el) => el.getAttribute('data-ops-cal-block') === 'reservation')).toBe(false);
  });

  it('links reservation bars to /ops/reservations/:id', async () => {
    renderMonth();
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Guest A|A-Frame 2/i })).toBeInTheDocument();
    });
    const resLink = document.querySelector('a[data-ops-cal-block="reservation"]');
    expect(resLink).toHaveAttribute('href', '/ops/reservations/res-abc');
  });

  it('navigates prev / today / next months and reloads', async () => {
    renderMonth();
    await waitFor(() => {
      expect(opsReadAPI.calendar).toHaveBeenCalledTimes(1);
    });
    const firstFrom = opsReadAPI.calendar.mock.calls[0][0].from;
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    await waitFor(() => {
      expect(opsReadAPI.calendar.mock.calls.length).toBeGreaterThan(1);
    });
    const nextFrom = opsReadAPI.calendar.mock.calls.at(-1)[0].from;
    expect(nextFrom).not.toBe(firstFrom);
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    await waitFor(() => {
      expect(opsReadAPI.calendar.mock.calls.at(-1)[0].from).toBe(firstFrom);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    await waitFor(() => {
      expect(opsReadAPI.calendar.mock.calls.at(-1)[0].from).toBe(firstFrom);
    });
  });

  it('creates manual block with exact payload', async () => {
    opsWriteAPI.createManualBlock.mockResolvedValue({ data: { data: {} } });
    renderMonth();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add manual block' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add manual block' }));
    expect(screen.getByRole('heading', { name: 'New manual block' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(opsWriteAPI.createManualBlock).toHaveBeenCalled();
    });
    expect(opsWriteAPI.createManualBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        cabinId: CABIN_ID,
        reason: 'ops_calendar',
        startDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        endDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)
      })
    );
  });

  it('creates maintenance block with exact payload', async () => {
    opsWriteAPI.createMaintenanceBlock.mockResolvedValue({ data: { data: {} } });
    renderMonth();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add maintenance' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add maintenance' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(opsWriteAPI.createMaintenanceBlock).toHaveBeenCalledWith(
        expect.objectContaining({
          cabinId: CABIN_ID,
          reason: 'ops_calendar'
        })
      );
    });
  });

  it('retains form and error when create manual write fails', async () => {
    opsWriteAPI.createManualBlock.mockRejectedValue({
      response: { data: { message: 'Manual write boom' } }
    });
    renderMonth();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add manual block' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add manual block' }));
    const dialog = screen.getByRole('dialog');
    const startInput = within(dialog).getByLabelText(/Start \(inclusive\)/i);
    fireEvent.change(startInput, { target: { value: '2026-09-22' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(screen.getByText('Manual write boom')).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'New manual block' })).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('2026-09-22')).toBeInTheDocument();
  });
});
