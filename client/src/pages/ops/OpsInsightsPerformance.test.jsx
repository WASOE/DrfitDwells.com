import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { OpsSessionProvider } from '../../context/OpsSessionContext';
import { OpsAppearanceProvider } from '../../ops/appearance/OpsAppearanceProvider';
import OpsInsightsPerformance from './OpsInsightsPerformance';

vi.mock('../../services/opsApi', () => ({
  opsReadAPI: {
    insightsFilterOptions: vi.fn(),
    insightsPerformance: vi.fn(),
    insightsHistoricalDataQuality: vi.fn()
  }
}));

import { opsReadAPI } from '../../services/opsApi';

const adminSession = {
  authenticated: true,
  actorId: 'admin-1',
  role: 'admin',
  modules: ['*'],
  actions: [],
  defaultRoute: '/ops',
  locale: 'en'
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

function currentMonth() {
  const now = new Date();
  const from = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`;
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const to = `${last.getFullYear()}-${pad2(last.getMonth() + 1)}-${pad2(last.getDate())}`;
  return { from, to };
}

function perfPayload() {
  return {
    summary: {
      grossBookedRevenueCents: 900000,
      bookingCount: 20,
      soldNights: 40,
      occupiedNights: 38,
      sellableNights: 60,
      occupancyRate: 0.633,
      adrCents: 22500,
      revenuePerSellableNightCents: 15000,
      cancelledRevenueCents: 25000
    },
    series: [
      {
        period: '2026-08',
        bookingCount: 8,
        occupiedNights: 16,
        sellableNights: 30,
        occupancyRate: 0.533,
        grossBookedRevenueCents: 360000,
        adrCents: 22500,
        dataConfidence: 'verified'
      },
      {
        period: '2026-09',
        bookingCount: 12,
        occupiedNights: 22,
        sellableNights: 30,
        occupancyRate: 0.733,
        grossBookedRevenueCents: 540000,
        adrCents: 24545,
        dataConfidence: 'usable'
      }
    ],
    entities: [
      {
        entityType: 'cabin',
        entityId: 'c1',
        displayName: 'Stone House',
        bookingCount: 10,
        occupiedNights: 20,
        sellableNights: 30,
        occupancyRate: 0.667,
        grossBookedRevenueCents: 450000,
        adrCents: 22500,
        dataConfidence: 'verified',
        issues: []
      }
    ]
  };
}

function qualityPayload() {
  return {
    earliestReliableRevenueDate: '2025-01-01',
    earliestReliableOccupancyDate: '2025-06-01',
    issues: {
      incomplete_blocks: { code: 'incomplete_blocks', count: 2, affectedMonths: ['2025-03', '2025-04'] }
    },
    confidenceByMonth: [
      { month: '2026-08', dataConfidence: 'verified' },
      { month: '2026-09', dataConfidence: 'usable' }
    ]
  };
}

function renderPerf(initial = '/ops/insights/performance') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <OpsAppearanceProvider>
        <OpsSessionProvider session={adminSession}>
          <Routes>
            <Route path="/ops/insights/performance" element={<OpsInsightsPerformance />} />
          </Routes>
        </OpsSessionProvider>
      </OpsAppearanceProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  opsReadAPI.insightsFilterOptions.mockResolvedValue({
    data: { data: { cabins: [{ id: 'c1', name: 'Stone House' }], cabinTypes: [], units: [] } }
  });
  opsReadAPI.insightsPerformance.mockResolvedValue({ data: { data: perfPayload() } });
  opsReadAPI.insightsHistoricalDataQuality.mockResolvedValue({ data: { data: qualityPayload() } });
});

afterEach(() => {
  cleanup();
});

describe('OpsInsightsPerformance migration', () => {
  it('uses OpsPage wide and preserves historical header/link', async () => {
    renderPerf();
    await waitFor(() => expect(screen.getByTestId('performance-metrics')).toBeInTheDocument());
    expect(screen.getByTestId('ops-page')).toHaveAttribute('data-ops-page-width', 'wide');
    expect(screen.getByRole('heading', { name: 'Historical performance' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to revenue insights' })).toHaveAttribute(
      'href',
      '/ops/insights'
    );
  });

  it('reads performance + historical quality with exact default params', async () => {
    const { from, to } = currentMonth();
    renderPerf();
    await waitFor(() => expect(opsReadAPI.insightsPerformance).toHaveBeenCalled());
    expect(opsReadAPI.insightsPerformance).toHaveBeenCalledWith({
      propertyKind: 'cabin',
      from,
      to,
      groupBy: 'month',
      revenueBasis: 'checkIn',
      confidence: 'all'
    });
    expect(opsReadAPI.insightsHistoricalDataQuality).toHaveBeenCalledWith({
      propertyKind: 'cabin'
    });
  });

  it('displays every summary metric, trend rows, entities, and confidence', async () => {
    renderPerf();
    await waitFor(() => expect(screen.getByTestId('performance-metrics')).toBeInTheDocument());
    const metrics = screen.getByTestId('performance-metrics');
    for (const label of [
      'Direct revenue',
      'Bookings',
      'Sold nights',
      'Occupied nights',
      'Sellable nights',
      'Occupancy',
      'ADR',
      'Direct revenue / sellable night',
      'Cancelled revenue'
    ]) {
      expect(within(metrics).getByText(label)).toBeInTheDocument();
    }
    expect(within(metrics).getByText('63.3%')).toBeInTheDocument();

    const trend = screen.getByTestId('performance-trend');
    expect(within(trend).getByText('2026-08')).toBeInTheDocument();
    expect(within(trend).getByText('2026-09')).toBeInTheDocument();
    expect(screen.getByTestId('performance-entities')).toHaveTextContent('Stone House');
    expect(screen.getByTestId('performance-confidence')).toHaveTextContent(
      'Earliest reliable revenue: 2025-01-01'
    );
  });

  it('shows occupancy unavailable banner when sellable nights are null', async () => {
    opsReadAPI.insightsPerformance.mockResolvedValue({
      data: {
        data: {
          ...perfPayload(),
          summary: { ...perfPayload().summary, sellableNights: null, occupancyRate: null }
        }
      }
    });
    renderPerf();
    await waitFor(() =>
      expect(
        screen.getByText(/Occupancy unavailable for this period because historical sellable inventory/)
      ).toBeInTheDocument()
    );
  });

  it('updates groupBy live and refetches', async () => {
    renderPerf();
    await waitFor(() => expect(opsReadAPI.insightsPerformance).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'week' } });
    await waitFor(() =>
      expect(opsReadAPI.insightsPerformance).toHaveBeenCalledWith(
        expect.objectContaining({ groupBy: 'week' })
      )
    );
  });

  it('keeps filters and shows error banner without fake metrics', async () => {
    opsReadAPI.insightsPerformance.mockRejectedValue({
      response: { data: { message: 'Performance unavailable' } }
    });
    renderPerf();
    await waitFor(() => expect(screen.getByText('Performance unavailable')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'The Cabin' })).toBeInTheDocument();
    expect(screen.queryByTestId('performance-metrics')).not.toBeInTheDocument();
  });

  it('shows empty trend copy when series is empty', async () => {
    opsReadAPI.insightsPerformance.mockResolvedValue({
      data: { data: { ...perfPayload(), series: [], entities: [] } }
    });
    renderPerf();
    await waitFor(() => expect(screen.getAllByText('No data for this period.').length).toBe(2));
  });
});
