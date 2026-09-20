import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { OpsSessionProvider } from '../../../context/OpsSessionContext';
import OpsCalendarIndex from './OpsCalendarIndex';
import {
  BLOCK_BAR,
  BLOCK_DOT,
  CONFLICT_RING,
  INDEX_LEGEND_ITEMS,
  PREVIEW_DOT_CONFLICT,
  PREVIEW_DOT_WARNING
} from './calendarVisualTokens';

vi.mock('../../../services/opsApi', () => ({
  opsReadAPI: {
    calendar: vi.fn(),
    cabins: vi.fn()
  },
  opsWriteAPI: {
    removeLocationBlockGroup: vi.fn(),
    previewLocationBlock: vi.fn(),
    createLocationBlock: vi.fn()
  }
}));

import { opsReadAPI, opsWriteAPI } from '../../../services/opsApi';

const adminSession = {
  authenticated: true,
  actorId: 'admin-1',
  role: 'admin',
  modules: ['*'],
  actions: [],
  defaultRoute: '/ops',
  locale: 'en'
};

function previewPayload(overrides = {}) {
  return {
    data: {
      data: {
        request: {
          from: '2026-09-20',
          to: '2026-10-04',
          previewDays: 14
        },
        meta: { today: '2026-09-20', propertyTimezone: 'Europe/Sofia' },
        previewByCabin: [
          {
            cabinId: 'cabin-1',
            listing: { name: 'Stone House', imageUrl: null, isActive: true },
            blocks: [],
            syncIndicators: { syncStatus: 'healthy' },
            summary: { hardConflictCount: 0, warningCount: 0 },
            conflictMarkers: { hard: [], warnings: [] }
          }
        ],
        activeLocationBlockGroups: [],
        ...overrides
      }
    }
  };
}

function cabinsPayload(overrides = {}) {
  return {
    data: {
      data: {
        items: [
          {
            cabinId: 'cabin-1',
            name: 'Stone House',
            location: 'Rhodope',
            isActive: true,
            kind: 'single_cabin',
            content: { imageUrl: null },
            operational: {}
          }
        ],
        ...overrides
      }
    }
  };
}

function renderIndex() {
  return render(
    <div className="ops-root" data-ops-appearance="light" data-ops-themed="true">
      <OpsSessionProvider session={adminSession}>
        <MemoryRouter initialEntries={['/ops/calendar']}>
          <Routes>
            <Route path="/ops/calendar" element={<OpsCalendarIndex />} />
          </Routes>
        </MemoryRouter>
      </OpsSessionProvider>
    </div>
  );
}

describe('OpsCalendarIndex migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    opsReadAPI.calendar.mockResolvedValue(previewPayload());
    opsReadAPI.cabins.mockResolvedValue(cabinsPayload());
  });

  afterEach(() => {
    cleanup();
  });

  it('uses OpsPage full width and Calendar title', async () => {
    renderIndex();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Calendar' })).toBeInTheDocument();
    });
    expect(document.querySelector('.ops-page')).toHaveAttribute('data-ops-page-width', 'full');
  });

  it('loads index with exact preview + cabins params', async () => {
    renderIndex();
    await waitFor(() => {
      expect(opsReadAPI.calendar).toHaveBeenCalledWith({ indexPreview: '1', previewDays: 14 });
    });
    expect(opsReadAPI.cabins).toHaveBeenCalledWith({ page: 1, limit: 100 });
    expect(screen.getByText('Stone House')).toBeInTheDocument();
  });

  it('shows OpsBanner danger on load error', async () => {
    opsReadAPI.calendar.mockRejectedValue({ response: { data: { message: 'Index boom' } } });
    renderIndex();
    await waitFor(() => {
      expect(screen.getByText('Index boom')).toBeInTheDocument();
    });
    expect(document.querySelector('.ops-banner--danger')).toBeTruthy();
  });

  it('legend grammar keeps reservation distinct from conflict/danger', async () => {
    renderIndex();
    await waitFor(() => {
      expect(screen.getByLabelText('Calendar legend')).toBeInTheDocument();
    });
    const legend = screen.getByLabelText('Calendar legend');
    const reservation = within(legend).getByText('Reservation').closest('[data-ops-cal-legend]');
    const conflict = within(legend).getByText('Conflict').closest('[data-ops-cal-legend]');
    expect(reservation.querySelector('.ops-cal-dot--reservation')).toBeTruthy();
    expect(reservation.querySelector('.ops-cal-dot--conflict')).toBeFalsy();
    expect(conflict.querySelector('.ops-cal-dot--conflict')).toBeTruthy();
    expect(BLOCK_DOT.reservation).toContain('ops-cal-dot--reservation');
    expect(BLOCK_DOT.reservation).not.toMatch(/danger|conflict|red/i);
    expect(PREVIEW_DOT_CONFLICT).toContain('ops-cal-dot--conflict');
    expect(BLOCK_DOT.external_hold).toContain('ops-cal-dot--external');
    expect(BLOCK_DOT.external_hold).not.toBe(BLOCK_DOT.reservation);
    expect(BLOCK_DOT.manual_block).toContain('ops-cal-dot--manual');
    expect(BLOCK_DOT.maintenance).toContain('ops-cal-dot--maintenance');
    expect(BLOCK_DOT.manual_block).not.toBe(BLOCK_DOT.maintenance);
    expect(INDEX_LEGEND_ITEMS.map((i) => i.key)).toEqual([
      'reservation',
      'manual_block',
      'maintenance',
      'external_hold',
      'conflict',
      'warning'
    ]);
    expect(CONFLICT_RING.hard).toContain('ops-cal-ring--conflict');
    expect(PREVIEW_DOT_WARNING).toContain('ops-cal-dot--warning');
    expect(BLOCK_BAR.reservation).toContain('ops-cal-bar--reservation');
  });

  it('opens location block sheet and retains form on write error', async () => {
    opsWriteAPI.previewLocationBlock.mockResolvedValue({
      data: { data: { canBlock: true, targetCount: 2, locationLabel: 'The Valley', conflicts: [] } }
    });
    opsWriteAPI.createLocationBlock.mockRejectedValue({
      response: { data: { message: 'Location write boom' } }
    });
    renderIndex();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Block location' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Block location' }));
    expect(screen.getByRole('heading', { name: 'Block entire location' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check dates' }));
    await waitFor(() => {
      expect(screen.getByText('Ready to block')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Block entire location' }));
    await waitFor(() => {
      expect(screen.getByText('Location write boom')).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'Block entire location' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('2026-09-01')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2026-09-04')).toBeInTheDocument();
  });
});
