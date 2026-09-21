import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpsSessionProvider } from '../../context/OpsSessionContext';
import OpsSyncCenter from './OpsSyncCenter';

vi.mock('../../services/opsApi', () => ({
  opsReadAPI: {
    sync: vi.fn()
  }
}));

import { opsReadAPI } from '../../services/opsApi';

const pageSource = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'OpsSyncCenter.jsx'),
  'utf8'
);

const adminSession = {
  authenticated: true,
  actorId: 'admin-1',
  role: 'admin',
  modules: ['*'],
  actions: [],
  defaultRoute: '/ops',
  locale: 'en'
};

function healthRow(overrides = {}) {
  return {
    cabinId: 'cabin-1',
    channel: 'airbnb',
    unitId: null,
    lastSyncedAt: '2026-09-20T08:10:00.000Z',
    lastSyncOutcome: 'success',
    syncStatus: 'healthy',
    unresolvedAnomalies: 0,
    stale: false,
    ...overrides
  };
}

function eventRow(overrides = {}) {
  return {
    eventId: 'evt-1',
    cabinId: 'cabin-1',
    channel: 'airbnb',
    runAt: '2026-09-20T08:10:00.000Z',
    outcome: 'success',
    anomalyType: null,
    ...overrides
  };
}

function payload(overrides = {}) {
  return {
    data: {
      data: {
        healthByCabinChannel: [healthRow()],
        recentEvents: [eventRow()],
        aggregates: { unresolvedSyncManualReviews: 2, externalHoldCount: 1 },
        ...overrides
      }
    }
  };
}

function renderPage() {
  return render(
    <div className="ops-root" data-ops-appearance="light" data-ops-themed="true">
      <OpsSessionProvider session={adminSession}>
        <OpsSyncCenter />
      </OpsSessionProvider>
    </div>
  );
}

describe('OpsSyncCenter dashboard migration', () => {
  beforeEach(() => {
    opsReadAPI.sync.mockReset();
    opsReadAPI.sync.mockResolvedValue(payload());
  });

  afterEach(() => {
    cleanup();
  });

  it('uses OpsPage wide and OpsPageHeader without a legacy title card or max-w-7xl', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Sync' })).toBeInTheDocument();
    });
    expect(screen.getByTestId('ops-page')).toHaveAttribute('data-ops-page-width', 'wide');
    expect(screen.getByTestId('ops-page')).toHaveClass('ops-page--wide');
    expect(screen.queryByRole('heading', { level: 2, name: 'Sync Center' })).not.toBeInTheDocument();
    expect(pageSource).not.toMatch(/max-w-7xl|bg-white border border-gray-200 rounded-xl|#81887A|text-emerald|text-amber|text-red-/);
    expect(pageSource).toContain('External holds and sync health (real evidence).');
    expect(pageSource).toContain('opsReadAPI.sync({})');
  });

  it('reads sync with an empty params object and no polling', async () => {
    renderPage();
    await waitFor(() => {
      expect(opsReadAPI.sync).toHaveBeenCalled();
    });
    expect(opsReadAPI.sync).toHaveBeenCalledWith({});
    expect(opsReadAPI.sync.mock.calls[0]).toEqual([{}]);
    expect(pageSource).not.toMatch(/setInterval|setTimeout|addEventListener\(['"]visibilitychange/);
  });

  it('renders existing metrics, timestamps, events, and canonical sync status', async () => {
    opsReadAPI.sync.mockResolvedValue(
      payload({
        healthByCabinChannel: [
          healthRow(),
          healthRow({
            cabinId: 'cabin-stale-very-long-identifier',
            channel: 'booking.com-ical-feed-with-a-long-name',
            unitId: 'unit_very_long_reference_identifier',
            lastSyncedAt: '2026-08-01T07:00:00.000Z',
            lastSyncOutcome: 'success',
            syncStatus: 'healthy',
            unresolvedAnomalies: 3,
            stale: true
          }),
          healthRow({
            cabinId: 'cabin-failed',
            channel: 'vrbo',
            lastSyncedAt: '2026-09-19T12:00:00.000Z',
            lastSyncOutcome: 'failed',
            syncStatus: 'failed',
            unresolvedAnomalies: 1,
            stale: false
          }),
          healthRow({
            cabinId: 'cabin-warning',
            channel: 'direct',
            lastSyncedAt: '2026-09-20T07:00:00.000Z',
            lastSyncOutcome: 'warning',
            syncStatus: 'warning',
            unresolvedAnomalies: 0,
            stale: false
          })
        ],
        recentEvents: [
          eventRow(),
          eventRow({
            eventId: 'evt-old',
            cabinId: 'cabin-stale-very-long-identifier',
            channel: 'booking.com-ical-feed-with-a-long-name',
            runAt: '2026-08-01T07:00:00.000Z',
            outcome: 'warning',
            anomalyType: 'sync_duplicate_import'
          })
        ],
        aggregates: { unresolvedSyncManualReviews: 4 }
      })
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Cabin cabin-1')).toBeInTheDocument();
    });

    expect(screen.getByText('Stale pairs').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Failed pairs').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Unresolved anomalies').nextElementSibling).toHaveTextContent('4');
    expect(
      screen.getByText(
        'Open sync-related manual reviews: 4 · duplicate-import anomalies in recent events: 1'
      )
    ).toBeInTheDocument();

    expect(screen.getByText('Sync healthy')).toHaveAttribute('data-ops-status-key', 'sync.healthy');
    expect(screen.getByText('Sync stale')).toHaveAttribute('data-ops-status-key', 'sync.stale');
    expect(screen.getByText('Sync failed')).toHaveAttribute('data-ops-status-key', 'sync.failed');
    expect(screen.getByText('Sync warning')).toHaveAttribute('data-ops-status-key', 'sync.warning');
    expect(screen.getAllByText('lastSyncedAt: 2026-09-20').length).toBeGreaterThan(0);
    expect(screen.getByText('lastSyncedAt: 2026-08-01')).toBeInTheDocument();
    expect(screen.getByText('unit_very_long_reference_identifier')).toBeInTheDocument();
    expect(screen.getByText('cabin-1 · airbnb')).toBeInTheDocument();
    expect(screen.getByText('outcome: success · at 2026-09-20T08:10:00')).toBeInTheDocument();
    expect(screen.getByText('anomaly: sync_duplicate_import')).toBeInTheDocument();
  });

  it('counts stale from the existing stale flag and failed from lastSyncOutcome', async () => {
    opsReadAPI.sync.mockResolvedValue(
      payload({
        healthByCabinChannel: [
          healthRow({ stale: true, lastSyncOutcome: 'success', syncStatus: 'healthy' }),
          healthRow({ cabinId: 'c2', stale: true, lastSyncOutcome: 'failed', syncStatus: 'failed' }),
          healthRow({ cabinId: 'c3', stale: false, lastSyncOutcome: 'success', syncStatus: 'healthy' })
        ],
        recentEvents: []
      })
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Stale pairs').nextElementSibling).toHaveTextContent('2');
    });
    expect(screen.getByText('Failed pairs').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('No recent sync events.')).toBeInTheDocument();
  });

  it('shows loading inside the page while the header stays visible', async () => {
    let resolveLoad;
    opsReadAPI.sync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        })
    );
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Sync' })).toBeInTheDocument();
    expect(screen.getByText('Loading sync center')).toBeInTheDocument();
    resolveLoad(payload());
    await waitFor(() => {
      expect(screen.getByText('Cabin cabin-1')).toBeInTheDocument();
    });
  });

  it('shows the existing error in a banner and does not invent retry chrome', async () => {
    opsReadAPI.sync.mockRejectedValue({
      response: { data: { message: 'Sync service unavailable' } }
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Sync service unavailable')).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Sync' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it('shows the existing missing-data and empty-health copy', async () => {
    opsReadAPI.sync.mockResolvedValueOnce({ data: {} });
    const { unmount } = renderPage();
    await waitFor(() => {
      expect(screen.getByText('No sync data.')).toBeInTheDocument();
    });
    unmount();
    opsReadAPI.sync.mockResolvedValue(
      payload({
        healthByCabinChannel: [],
        recentEvents: []
      })
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No health rows yet.')).toBeInTheDocument();
    });
    expect(screen.getByText('No recent sync events.')).toBeInTheDocument();
    expect(screen.getByText('Stale pairs').nextElementSibling).toHaveTextContent('0');
  });
});
