import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { OpsSessionProvider } from '../../context/OpsSessionContext';
import { OpsAppearanceProvider } from '../../ops/appearance/OpsAppearanceProvider';
import OpsInsights from './OpsInsights';

vi.mock('../../services/opsApi', () => ({
  opsReadAPI: {
    insightsFilterOptions: vi.fn(),
    insightsSummary: vi.fn(),
    insightsDataQuality: vi.fn(),
    insightsReconciliation: vi.fn(),
    insightsBookings: vi.fn()
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

function summaryPayload() {
  return {
    metrics: {
      bookingCount: 12,
      grossBookedRevenueCents: 450000,
      cashCollectedCents: 220000,
      avgBookingValueCents: 37500,
      cancelledCount: 2,
      cancelledRevenueCents: 40000
    },
    channelBreakdown: {
      website: { count: 8, revenueCents: 300000 },
      staff: { count: 3, revenueCents: 120000 },
      other: { count: 1, revenueCents: 30000 }
    },
    provenance: {
      revenueBasisNote: 'Revenue attributed by check-in date.',
      paymentSnapshotNote: 'Snapshot captured at booking finalization.'
    }
  };
}

function qualityPayload() {
  return {
    issues: [{ code: 'zero_price_manual', count: 1 }],
    inventoryHealth: {
      cabinsWithPropertyKind: 4,
      cabinsMissingPropertyKind: 0,
      cabinTypesWithPropertyKind: 2,
      activeUnits: 6
    }
  };
}

function reconPayload() {
  return {
    commercial: {
      grossBookedRevenueCents: { value: 450000, source: 'bookings', basis: 'checkIn' }
    },
    paymentSnapshotAtBooking: {
      amountCents: { value: 220000, source: 'booking.payment', basis: 'snapshot' }
    },
    linkedPaymentLedger: {
      grossPaidAmountCents: { value: 210000, basis: 'linked' },
      refundedAmountCents: { value: 10000, basis: 'linked' },
      netPaidAmountCents: { value: 200000, basis: 'linked' },
      linkedPaymentCount: 9
    },
    variance: {
      snapshotVsLinkedLedgerCents: 20000,
      commercialVsLinkedNetPaidCents: 250000
    },
    siteWideUnlinkedPayments: {
      count: 1,
      amountCents: 5000,
      source: 'payments without booking'
    },
    exclusions: { locationBookingTreatment: 'Location bookings excluded from unit occupancy.' }
  };
}

function bookingsPayload() {
  return {
    rows: [
      {
        stayKind: 'cabin',
        bookingId: '507f1f77bcf86cd7994390aa',
        detailHref: '/ops/reservations/507f1f77bcf86cd7994390aa',
        status: 'confirmed',
        channel: 'website',
        checkInDateOnly: '2026-09-10',
        bookedRevenueCents: 90000,
        paymentSnapshotAtBookingCents: 45000
      },
      {
        stayKind: 'location_booking',
        bookingId: '507f1f77bcf86cd7994390bb',
        detailHref: '/ops/reservations/507f1f77bcf86cd7994390bb',
        status: 'confirmed',
        channel: 'staff',
        checkInDateOnly: '2026-09-12',
        bookedRevenueCents: 120000,
        paymentSnapshotAtBookingCents: 120000
      }
    ],
    pagination: { page: 1, total: 2, hasMore: false },
    provenance: { locationBookingLimitations: 'Valley buyouts have limited unit attribution.' }
  };
}

function renderInsights(initial = '/ops/insights') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <OpsAppearanceProvider>
        <OpsSessionProvider session={adminSession}>
          <Routes>
            <Route path="/ops/insights" element={<OpsInsights />} />
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
  opsReadAPI.insightsSummary.mockResolvedValue({ data: { data: summaryPayload() } });
  opsReadAPI.insightsDataQuality.mockResolvedValue({ data: { data: qualityPayload() } });
  opsReadAPI.insightsReconciliation.mockResolvedValue({ data: { data: reconPayload() } });
  opsReadAPI.insightsBookings.mockResolvedValue({ data: { data: bookingsPayload() } });
});

afterEach(() => {
  cleanup();
});

describe('OpsInsights migration', () => {
  it('uses OpsPage wide and OpsPageHeader outside surfaces', async () => {
    renderInsights();
    await waitFor(() => expect(screen.getByTestId('insights-metrics')).toBeInTheDocument());
    expect(screen.getByTestId('ops-page')).toHaveAttribute('data-ops-page-width', 'wide');
    expect(screen.getByRole('heading', { name: 'Revenue insights' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Historical performance' })).toHaveAttribute(
      'href',
      '/ops/insights/performance'
    );
  });

  it('reads summary/quality/reconciliation/bookings with exact default params', async () => {
    const { from, to } = currentMonth();
    renderInsights();
    await waitFor(() => expect(opsReadAPI.insightsSummary).toHaveBeenCalled());
    expect(opsReadAPI.insightsSummary).toHaveBeenCalledWith({
      propertyKind: 'cabin',
      from,
      to,
      revenueBasis: 'checkIn'
    });
    expect(opsReadAPI.insightsDataQuality).toHaveBeenCalledWith({ propertyKind: 'cabin' });
    expect(opsReadAPI.insightsReconciliation).toHaveBeenCalledWith({
      propertyKind: 'cabin',
      from,
      to,
      revenueBasis: 'checkIn'
    });
    expect(opsReadAPI.insightsBookings).toHaveBeenCalledWith({
      propertyKind: 'cabin',
      from,
      to,
      revenueBasis: 'checkIn',
      status: 'active',
      page: '1',
      limit: 50
    });
    expect(opsReadAPI.insightsFilterOptions).toHaveBeenCalledWith({ propertyKind: 'cabin' });
  });

  it('does not poll insights endpoints', async () => {
    renderInsights();
    await waitFor(() => expect(opsReadAPI.insightsSummary).toHaveBeenCalled());
    const before = opsReadAPI.insightsSummary.mock.calls.length;
    await new Promise((r) => setTimeout(r, 40));
    expect(opsReadAPI.insightsSummary.mock.calls.length).toBe(before);
  });

  it('displays every headline metric, channel rows, reconciliation, and inventory health', async () => {
    renderInsights();
    await waitFor(() => expect(screen.getByTestId('insights-metrics')).toBeInTheDocument());
    const metrics = screen.getByTestId('insights-metrics');
    expect(within(metrics).getByText('Bookings')).toBeInTheDocument();
    expect(within(metrics).getByText('12')).toBeInTheDocument();
    expect(within(metrics).getByText('Gross booked')).toBeInTheDocument();
    expect(within(metrics).getByText('Payment snapshot at booking')).toBeInTheDocument();
    expect(within(metrics).getByText('Avg booking value')).toBeInTheDocument();
    expect(within(metrics).getByText('Cancelled')).toBeInTheDocument();
    expect(within(metrics).getByText('Cancelled revenue')).toBeInTheDocument();

    const channels = screen.getByTestId('insights-channels');
    expect(within(channels).getByText('website')).toBeInTheDocument();
    expect(within(channels).getByText('staff')).toBeInTheDocument();
    expect(within(channels).getByText('other')).toBeInTheDocument();

    expect(screen.getByTestId('insights-reconciliation')).toHaveTextContent('Linked ledger net');
    expect(screen.getByRole('link', { name: 'Review payments ledger' })).toHaveAttribute(
      'href',
      '/ops/payments'
    );
    expect(screen.getByTestId('insights-inventory-health')).toHaveTextContent(
      'Cabins with propertyKind'
    );
    expect(screen.getByText('Valley buyout')).toBeInTheDocument();
    expect(screen.getByText('Data quality attention')).toBeInTheDocument();
  });

  it('updates live URL filters and refetches without submit', async () => {
    renderInsights();
    await waitFor(() => expect(opsReadAPI.insightsSummary).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'The Valley' }));
    await waitFor(() =>
      expect(opsReadAPI.insightsSummary).toHaveBeenCalledWith(
        expect.objectContaining({ propertyKind: 'valley' })
      )
    );
  });

  it('keeps filters visible and shows OpsBanner on load error without fake metrics', async () => {
    opsReadAPI.insightsSummary.mockRejectedValue({
      response: { data: { message: 'Insights unavailable' } }
    });
    opsReadAPI.insightsDataQuality.mockRejectedValue({ response: { data: { message: 'x' } } });
    opsReadAPI.insightsReconciliation.mockRejectedValue({ response: { data: { message: 'x' } } });
    renderInsights();
    await waitFor(() => expect(screen.getByText('Insights unavailable')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'The Cabin' })).toBeInTheDocument();
    expect(screen.queryByTestId('insights-metrics')).not.toBeInTheDocument();
  });

  it('shows empty bookings copy when rows are empty', async () => {
    opsReadAPI.insightsBookings.mockResolvedValue({
      data: { data: { rows: [], pagination: { page: 1, total: 0, hasMore: false } } }
    });
    renderInsights();
    await waitFor(() => expect(screen.getByText('No data for this period.')).toBeInTheDocument());
  });
});
