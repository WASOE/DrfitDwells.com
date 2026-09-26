import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpsSessionProvider } from '../../context/OpsSessionContext';
import { formatMoneyFromCents } from '../../utils/formatMoney';
import OpsDashboard from './OpsDashboard';

vi.mock('../../services/opsApi', () => ({
  opsReadAPI: {
    dashboard: vi.fn(),
    reservations: vi.fn(),
    paymentsSummary: vi.fn(),
    paymentsLedger: vi.fn(),
    manualReview: vi.fn(),
    sync: vi.fn(),
    communicationsOversight: vi.fn(),
    cabins: vi.fn()
  },
  opsWriteAPI: {
    resolveManualReviewItem: vi.fn()
  }
}));

import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';

const pageSource = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'OpsDashboard.jsx'),
  'utf8'
);
const pageCss = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'OpsDashboard.css'),
  'utf8'
);

const adminSession = {
  authenticated: true,
  actorId: 'admin-1',
  role: 'admin',
  modules: ['*'],
  actions: ['ops.reservation.manual_create'],
  defaultRoute: '/ops',
  locale: 'en'
};

function reservationRow(overrides = {}) {
  return {
    reservationId: 'res-1',
    href: '/ops/reservations/res-1',
    guestName: 'Elena Petrova',
    accommodationDisplayName: 'Stone House',
    datesLabel: '2026-09-20 - 2026-09-23',
    guestsLabel: '2A',
    reservationStatus: 'confirmed',
    paymentStatus: 'paid',
    checkInDateOnly: '2026-09-20',
    checkOutDateOnly: '2026-09-23',
    ...overrides
  };
}

function holdRow(overrides = {}) {
  return {
    kind: 'external_hold',
    channel: 'airbnb',
    reservationId: 'hold-1',
    guestName: 'Airbnb hold',
    accommodationDisplayName: 'Valley Cabin',
    datesLabel: '2026-09-21 - 2026-09-24',
    checkInDateOnly: '2026-09-21',
    checkOutDateOnly: '2026-09-24',
    statusLabel: 'Starts in 5 days',
    ...overrides
  };
}

function alertItem(overrides = {}) {
  return {
    id: 'alert-1',
    type: 'payment_failed',
    severity: 'critical',
    title: 'Payment failed',
    detail: 'Elena Petrova · Stone House · 2026-09-20 - 2026-09-23 has failed payment status.',
    href: '/ops/reservations/res-pay',
    ...overrides
  };
}

function quietPulse() {
  return {
    bookingsMTD: 0,
    grossBookedMTD: 0,
    bookingValueMTD: 0,
    activePaidCount: 0,
    activeUnpaidCount: 0,
    cancellationsMTD: 0,
    refundsMTD: 0,
    giftVouchers: {
      salesMTDCents: 0,
      cashCollectedMTDCents: 0,
      physicalCardFeesMTDCents: 0,
      liabilityOutstandingCents: 0,
      redemptionsMTDCents: 0
    },
    cashCollected: {
      totalCashCollectedMTDCents: 0
    }
  };
}

function dashboard(overrides = {}) {
  const {
    today,
    upcoming,
    pulse,
    health,
    ...rest
  } = overrides;
  return {
    alerts: [],
    today: {
      arriving: { total: 0, rows: [] },
      staying: { total: 0, rows: [] },
      leaving: { total: 0, rows: [] },
      ...today
    },
    upcoming: {
      horizonDays: 14,
      next14DaysArrivalCount: 0,
      nextArrivals: [],
      ...upcoming
    },
    pulse: {
      ...quietPulse(),
      ...pulse,
      giftVouchers: {
        ...quietPulse().giftVouchers,
        ...(pulse?.giftVouchers || {})
      },
      cashCollected: {
        ...quietPulse().cashCollected,
        ...(pulse?.cashCollected || {})
      }
    },
    health: {
      status: health?.status || 'healthy',
      sync: { lastOutcome: 'success', href: '/ops/sync', ...(health?.sync || {}) },
      email: { recentFailuresCount: 0, href: '/ops/communications', ...(health?.email || {}) },
      payments: {
        webhookLastSeenAt: '2026-09-20T08:00:00.000Z',
        href: '/ops/payments',
        ...(health?.payments || {})
      },
      manualReview: { openCount: 0, href: '/ops/manual-review', ...(health?.manualReview || {}) }
    },
    ...rest
  };
}

function payload(dashboardBody, extras = {}) {
  return {
    data: {
      data: {
        dashboard: dashboardBody,
        freshness: extras.freshness || { isStale: false, degraded: false },
        sections: extras.sections,
        ...extras
      }
    }
  };
}

function ReservationStub() {
  const { id } = useParams();
  return <div data-testid="reservation-detail">{id}</div>;
}

function renderPage(session = adminSession, { openSections = ['Critical alerts', 'Stay/business pulse'] } = {}) {
  const rendered = render(
    <div className="ops-root" data-ops-appearance="light" data-ops-themed="true">
      <MemoryRouter initialEntries={['/ops']}>
        <OpsSessionProvider session={session}>
          <Routes>
            <Route path="/ops" element={<OpsDashboard />} />
            <Route path="/ops/reservations/:id" element={<ReservationStub />} />
            <Route path="/ops/reservations" element={<div data-testid="reservations-page" />} />
            <Route path="/ops/calendar" element={<div data-testid="calendar-page" />} />
            <Route path="/ops/payments" element={<div data-testid="payments-page" />} />
            <Route path="/ops/sync" element={<div data-testid="sync-page" />} />
            <Route path="/ops/communications" element={<div data-testid="comms-page" />} />
            <Route path="/ops/manual-review" element={<div data-testid="manual-review-page" />} />
          </Routes>
        </OpsSessionProvider>
      </MemoryRouter>
    </div>
  );
  if (openSections.length > 0) {
    void waitFor(() => {
      openSections.forEach((title) => {
        const header = screen.getByRole('button', { name: title });
        if (header.getAttribute('aria-expanded') === 'false') fireEvent.click(header);
      });
    });
  }
  return rendered;
}

function metricValue(label, root = document) {
  const labelEl = within(root).getByText(label);
  return labelEl.parentElement.querySelector('.ops-metric__value');
}

function extraReads() {
  return [
    opsReadAPI.reservations,
    opsReadAPI.paymentsSummary,
    opsReadAPI.paymentsLedger,
    opsReadAPI.manualReview,
    opsReadAPI.sync,
    opsReadAPI.communicationsOversight,
    opsReadAPI.cabins
  ];
}

describe('OpsDashboard home migration', () => {
  beforeEach(() => {
    opsReadAPI.dashboard.mockReset();
    extraReads().forEach((fn) => fn.mockReset());
    opsWriteAPI.resolveManualReviewItem.mockReset();
    opsReadAPI.dashboard.mockResolvedValue(payload(dashboard()));
    opsWriteAPI.resolveManualReviewItem.mockResolvedValue({
      data: { success: true, data: { item: { status: 'resolved' } } }
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('uses OpsPage wide, Dashboard header, and no permanent push strip', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    });
    expect(screen.getByTestId('ops-page')).toHaveAttribute('data-ops-page-width', 'wide');
    expect(screen.getByTestId('ops-page')).toHaveClass('ops-page--wide');
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' }).closest('header')).toHaveClass(
      'ops-page-header--meta-inline'
    );
    expect(screen.queryByRole('heading', { name: 'OPS Dashboard' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('ops-push-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ops-push-panel-subscribed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ops-dashboard-push-attention')).not.toBeInTheDocument();
    expect(pageSource).not.toMatch(/max-w-7xl|bg-white border border-gray-200 rounded-xl|#81887A|font-serif|Playfair/);
    expect(pageSource).not.toMatch(/border-rose-200|bg-amber-50|lg:grid-cols-6|xl:grid-cols-3/);
    expect(pageSource).not.toContain('/ops/communications/oversight');
    expect(pageCss).not.toContain('#');
    expect(pageCss).toContain('@container ops-page');
  });

  it('reads dashboard once with no params and no sibling collection APIs', async () => {
    renderPage();
    await waitFor(() => {
      expect(opsReadAPI.dashboard).toHaveBeenCalledTimes(1);
    });
    expect(opsReadAPI.dashboard.mock.calls[0]).toEqual([]);
    extraReads().forEach((fn) => {
      expect(fn).not.toHaveBeenCalled();
    });
  });

  it('renders a representative payload in operational order', async () => {
    opsReadAPI.dashboard.mockResolvedValue(
      payload(
        dashboard({
          alerts: [alertItem()],
          today: {
            arriving: { total: 1, rows: [reservationRow({ reservationId: 'arr-1', guestName: 'Arriving Guest' })] },
            staying: {
              total: 1,
              rows: [reservationRow({ reservationId: 'stay-1', guestName: 'Staying Guest', reservationStatus: 'in_house' })]
            },
            leaving: { total: 1, rows: [reservationRow({ reservationId: 'leave-1', guestName: 'Leaving Guest' })] }
          },
          upcoming: {
            next14DaysArrivalCount: 4,
            nextArrivals: [
              reservationRow({
                reservationId: 'up-1',
                guestName: 'Upcoming Guest',
                statusLabel: 'Arrives in 5 days'
              })
            ]
          },
          pulse: {
            bookingsMTD: 7,
            grossBookedMTD: 120,
            activePaidCount: 2,
            activeUnpaidCount: 1,
            cancellationsMTD: 3,
            refundsMTD: 1,
            giftVouchers: { salesMTDCents: 12000 },
            cashCollected: { totalCashCollectedMTDCents: 45000 }
          },
          health: {
            status: 'warning',
            sync: { lastOutcome: 'warning' },
            email: { recentFailuresCount: 2 },
            manualReview: { openCount: 4 }
          }
        })
      )
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Payment failed')).toBeInTheDocument();
    });
    const headings = screen.getAllByRole('heading').map((node) => node.textContent);
    expect(headings.indexOf('Critical alerts')).toBeLessThan(headings.indexOf('Today operations'));
    expect(headings.indexOf('Today operations')).toBeLessThan(headings.indexOf('Upcoming operations'));
    expect(headings.indexOf('Upcoming operations')).toBeLessThan(headings.indexOf('Stay/business pulse'));
    expect(headings.indexOf('Stay/business pulse')).toBeLessThan(headings.indexOf('Gift vouchers & cash'));
    expect(screen.getByTestId('ops-dashboard-health')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Health summary' })).not.toBeInTheDocument();
    expect(screen.getByText('Arriving Guest')).toBeInTheDocument();
    expect(screen.getByText('Staying Guest')).toBeInTheDocument();
    expect(screen.getByText('Leaving Guest')).toBeInTheDocument();
    expect(screen.getByText('Upcoming Guest')).toBeInTheDocument();
    expect(screen.getByText('Next 14 days: 4')).toBeInTheDocument();
    expect(document.querySelector('.ops-metric-group')).toBeTruthy();
    expect(document.querySelector('.lg\\:grid-cols-6')).toBeNull();
    expect(screen.getByTestId('ops-dashboard-health-chip')).toHaveTextContent('Watch');
    expect(document.querySelector('.ops-banner--warning')).toBeNull();
  });

  it('uses the requested disclosure defaults and toggles sections independently', async () => {
    opsReadAPI.dashboard.mockResolvedValue(
      payload(
        dashboard({
          alerts: [alertItem({ title: 'Critical test alert' })],
          today: {
            arriving: { total: 1, rows: [reservationRow({ guestName: 'Today test guest' })] }
          },
          pulse: { bookingsMTD: 7 }
        })
      )
    );
    renderPage(adminSession, { openSections: [] });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Today operations' })).toBeInTheDocument();
    });

    const alertsHeader = screen.getByRole('button', { name: 'Critical alerts' });
    const todayHeader = screen.getByRole('button', { name: 'Today operations' });
    const pulseHeader = screen.getByRole('button', { name: 'Stay/business pulse' });

    expect(alertsHeader).toHaveAttribute('aria-expanded', 'false');
    expect(pulseHeader).toHaveAttribute('aria-expanded', 'false');
    expect(todayHeader).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByText('Critical test alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Bookings MTD')).not.toBeInTheDocument();
    expect(screen.getByText('Today test guest')).toBeInTheDocument();
    expect(alertsHeader.querySelector('svg')).toHaveClass('ops-dashboard-disclosure-chevron');

    fireEvent.click(alertsHeader);
    fireEvent.click(pulseHeader);
    expect(alertsHeader).toHaveAttribute('aria-expanded', 'true');
    expect(pulseHeader).toHaveAttribute('aria-expanded', 'true');
    expect(todayHeader).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Critical test alert')).toBeInTheDocument();
    expect(screen.getByText('Bookings MTD')).toBeInTheDocument();

    fireEvent.click(todayHeader);
    expect(todayHeader).toHaveAttribute('aria-expanded', 'false');
    expect(alertsHeader).toHaveAttribute('aria-expanded', 'true');
    expect(pulseHeader).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByText('Today test guest')).not.toBeInTheDocument();
  });

  it('keeps the header mounted and shows OpsLoadingState while the dashboard read is pending', () => {
    opsReadAPI.dashboard.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Loading dashboard')).toBeInTheDocument();
    expect(document.querySelector('.ops-loading')).toBeTruthy();
    expect(screen.queryByText('Loading dashboard...')).not.toBeInTheDocument();
    expect(screen.queryByText('Bookings MTD')).not.toBeInTheDocument();
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
  });

  it('shows a danger banner on read failure without fake zeros or retry', async () => {
    opsReadAPI.dashboard.mockRejectedValue({
      response: { data: { message: 'Dashboard service unavailable' } }
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Dashboard service unavailable')).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(document.querySelector('.ops-banner--danger')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Bookings MTD')).not.toBeInTheDocument();
    expect(screen.queryByText('Gross booked MTD')).not.toBeInTheDocument();
    expect(screen.queryByText('No arrivals today.')).not.toBeInTheDocument();
  });

  it('shows quiet missing copy when the payload itself is null', async () => {
    opsReadAPI.dashboard.mockResolvedValue({ data: { data: null } });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No dashboard data.')).toBeInTheDocument();
    });
    expect(document.querySelector('.ops-empty')).toBeNull();
    expect(screen.queryByText('Bookings MTD')).not.toBeInTheDocument();
  });

  it('falls back to sections.actionNeeded when dashboard.alerts is unavailable', async () => {
    opsReadAPI.dashboard.mockResolvedValue(
      payload(
        dashboard({ alerts: undefined }),
        {
          sections: {
            actionNeeded: [
              alertItem({
                id: 'legacy-1',
                title: 'Legacy unpaid alert',
                type: 'unpaid_upcoming',
                severity: 'medium'
              })
            ]
          }
        }
      )
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Legacy unpaid alert')).toBeInTheDocument();
    });
    expect(screen.getByText('Medium')).toBeInTheDocument();
  });

  it('renders alerts in payload order without client-side resorting', async () => {
    opsReadAPI.dashboard.mockResolvedValue(
      payload(
        dashboard({
          alerts: [
            alertItem({ id: 'a-low', title: 'Later low alert', severity: 'low', type: 'guest_email_failed' }),
            alertItem({ id: 'a-crit', title: 'Earlier critical alert', severity: 'critical', type: 'payment_failed' })
          ]
        })
      )
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Later low alert')).toBeInTheDocument();
    });
    const titles = [...document.querySelectorAll('.ops-dashboard-alert__title')].map((node) => node.textContent);
    expect(titles).toEqual(['Later low alert', 'Earlier critical alert']);
  });

  it('keeps Resolve on manual-review alerts and reloads dashboard after the shared note payload', async () => {
    opsReadAPI.dashboard
      .mockResolvedValueOnce(
        payload(
          dashboard({
            alerts: [
              alertItem({
                id: 'manual-review-mri-1',
                type: 'manual_review',
                severity: 'high',
                title: 'Guest message automation failed',
                detail: 'Could not send the pre-arrival message.',
                href: '/ops/manual-review',
                manualReviewItemId: 'mri-1'
              })
            ]
          })
        )
      )
      .mockResolvedValueOnce(payload(dashboard({ alerts: [] })));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Guest message automation failed')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument();
    expect(pageSource).toContain("from '../../components/ops/ManualReviewResolveAction'");

    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    fireEvent.change(screen.getByPlaceholderText('What was done to handle this?'), {
      target: { value: 'Emailed the guest and closed the thread.' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm resolve' }));

    await waitFor(() => {
      expect(opsWriteAPI.resolveManualReviewItem).toHaveBeenCalledWith('mri-1', {
        note: 'Emailed the guest and closed the thread.'
      });
    });
    await waitFor(() => {
      expect(opsReadAPI.dashboard).toHaveBeenCalledTimes(2);
    });
    expect(opsReadAPI.dashboard.mock.calls[1]).toEqual([]);
    await waitFor(() => {
      expect(screen.queryByText('Guest message automation failed')).not.toBeInTheDocument();
    });
    const alertsHeader = screen.getByRole('button', { name: 'Critical alerts' });
    if (alertsHeader.getAttribute('aria-expanded') === 'false') fireEvent.click(alertsHeader);
    expect(screen.getByText('No critical alerts.')).toBeInTheDocument();
  });

  it('keeps Resolve visible on 403 and does not turn the page into a dashboard error', async () => {
    opsReadAPI.dashboard.mockResolvedValue(
      payload(
        dashboard({
          alerts: [
            alertItem({
              id: 'manual-review-mri-403',
              type: 'manual_review',
              severity: 'critical',
              title: 'Needs operator review',
              href: '/ops/manual-review',
              manualReviewItemId: 'mri-403'
            })
          ],
          pulse: { bookingsMTD: 2 }
        })
      )
    );
    opsWriteAPI.resolveManualReviewItem.mockRejectedValue({
      response: { status: 403, data: { message: 'Forbidden' } }
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    fireEvent.change(screen.getByPlaceholderText('What was done to handle this?'), {
      target: { value: 'Tried to resolve' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm resolve' }));
    await waitFor(() => {
      expect(screen.getByText('Forbidden')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Confirm resolve' })).toBeInTheDocument();
    expect(screen.getByText('Needs operator review')).toBeInTheDocument();
    expect(screen.queryByText('Failed to load dashboard')).not.toBeInTheDocument();
    expect(metricValue('Bookings MTD')).toHaveTextContent('2');
    expect(opsReadAPI.dashboard).toHaveBeenCalledTimes(1);
  });

  it('shows today lane totals as operational counts, not OpsMetric values', async () => {
    opsReadAPI.dashboard.mockResolvedValue(
      payload(
        dashboard({
          today: {
            arriving: { total: 6, rows: [reservationRow({ reservationId: 'a1' })] },
            staying: { total: 11, rows: [reservationRow({ reservationId: 's1' })] },
            leaving: { total: 2, rows: [reservationRow({ reservationId: 'l1' })] }
          }
        })
      )
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('ops-dashboard-lane-arriving')).toBeInTheDocument();
    });
    expect(within(screen.getByTestId('ops-dashboard-lane-arriving')).getByText('6')).toBeInTheDocument();
    expect(within(screen.getByTestId('ops-dashboard-lane-staying')).getByText('11')).toBeInTheDocument();
    expect(within(screen.getByTestId('ops-dashboard-lane-leaving')).getByText('2')).toBeInTheDocument();
    expect(screen.getByTestId('ops-dashboard-lane-arriving').querySelector('.ops-metric')).toBeNull();
  });

  it('preserves lane row caps, +N more math, and upcoming top-N rows', async () => {
    const arrivingRows = Array.from({ length: 5 }, (_, index) =>
      reservationRow({ reservationId: `arr-${index}`, guestName: `Arrival ${index}` })
    );
    const upcomingRows = Array.from({ length: 5 }, (_, index) =>
      reservationRow({ reservationId: `up-${index}`, guestName: `Upcoming ${index}` })
    );
    opsReadAPI.dashboard.mockResolvedValue(
      payload(
        dashboard({
          today: {
            arriving: { total: 8, rows: arrivingRows },
            staying: { total: 0, rows: [] },
            leaving: { total: 0, rows: [] }
          },
          upcoming: { next14DaysArrivalCount: 9, nextArrivals: upcomingRows }
        })
      )
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Arrival 0')).toBeInTheDocument();
    });
    expect(screen.getByText('Arrival 4')).toBeInTheDocument();
    expect(screen.queryByText('Arrival 5')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('ops-dashboard-lane-arriving')).getByText('+3 more')).toBeInTheDocument();
    expect(screen.getByText('Upcoming 0')).toBeInTheDocument();
    expect(screen.getByText('Upcoming 4')).toBeInTheDocument();
    expect(screen.getByText('Next 14 days: 9')).toBeInTheDocument();
  });

  it('marks Airbnb holds categorically and keeps them non-clickable', async () => {
    opsReadAPI.dashboard.mockResolvedValue(
      payload(
        dashboard({
          today: {
            arriving: { total: 1, rows: [holdRow()] }
          }
        })
      )
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Airbnb hold')).toBeInTheDocument();
    });
    expect(screen.getByText('Airbnb')).toBeInTheDocument();
    expect(screen.getByText('Airbnb hold').closest('a')).toBeNull();
    expect(document.querySelector('[data-ops-dashboard-row="hold"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key^="reservation."]')).toBeNull();
  });

  it('shows In house through OpsStatus instead of the raw in_house key', async () => {
    opsReadAPI.dashboard.mockResolvedValue(
      payload(
        dashboard({
          today: {
            staying: {
              total: 1,
              rows: [reservationRow({ reservationId: 'in-1', reservationStatus: 'in_house', guestName: 'House Guest' })]
            }
          }
        })
      )
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('House Guest')).toBeInTheDocument();
    });
    expect(document.querySelector('[data-ops-status-key="reservation.in_house"]')).toBeTruthy();
    expect(screen.getByText('In house')).toBeInTheDocument();
    expect(screen.queryByText('in_house')).not.toBeInTheDocument();
  });

  it('maps payment statuses including unlinked_payment without a registry edit', async () => {
    opsReadAPI.dashboard.mockResolvedValue(
      payload(
        dashboard({
          today: {
            arriving: {
              total: 4,
              rows: [
                reservationRow({ reservationId: 'p1', paymentStatus: 'paid', guestName: 'Paid Guest' }),
                reservationRow({ reservationId: 'p2', paymentStatus: 'partial', guestName: 'Partial Guest' }),
                reservationRow({
                  reservationId: 'p3',
                  paymentStatus: 'pending_verification',
                  guestName: 'Verify Guest'
                }),
                reservationRow({
                  reservationId: 'p4',
                  paymentStatus: 'unlinked_payment',
                  guestName: 'Unlinked Guest'
                })
              ]
            }
          }
        })
      )
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Unlinked Guest')).toBeInTheDocument();
    });
    expect(document.querySelector('[data-ops-status-key="payment.paid"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="payment.partial"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="payment.pending_verification"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="payment.unlinked"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="payment.unlinked_payment"]')).toBeNull();
    expect(screen.queryByText('unlinked_payment')).not.toBeInTheDocument();
  });

  it('renders arriving-later as one phrase with the canonical status key', async () => {
    opsReadAPI.dashboard.mockResolvedValue(
      payload(
        dashboard({
          upcoming: {
            next14DaysArrivalCount: 1,
            nextArrivals: [
              reservationRow({
                reservationId: 'later-1',
                guestName: 'Later Guest',
                reservationStatus: 'confirmed',
                statusLabel: 'Arrives in 5 days'
              })
            ]
          }
        })
      )
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Later Guest')).toBeInTheDocument();
    });
    expect(document.querySelector('[data-ops-status-key="reservation.arriving_later"]')).toBeTruthy();
    expect(screen.getAllByText('Arriving in 5 days')).toHaveLength(1);
    expect(screen.queryByText('Arrives in 5 days')).not.toBeInTheDocument();
    expect(screen.queryByText(/^5 days$/)).not.toBeInTheDocument();
  });

  it('locks stay/business and voucher/cash pulse values including zeros and money units', async () => {
    opsReadAPI.dashboard.mockResolvedValue(
      payload(
        dashboard({
          pulse: {
            bookingsMTD: 4,
            grossBookedMTD: 120,
            bookingValueMTD: 999,
            activePaidCount: 2,
            activeUnpaidCount: 3,
            cancellationsMTD: 1,
            refundsMTD: 0,
            giftVouchers: {
              salesMTDCents: 12000,
              cashCollectedMTDCents: 8000,
              physicalCardFeesMTDCents: 500,
              liabilityOutstandingCents: 20000,
              redemptionsMTDCents: 1500
            },
            cashCollected: { totalCashCollectedMTDCents: 25000 }
          }
        })
      )
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Stay/business pulse')).toBeInTheDocument();
    });
    const stay = screen.getByTestId('ops-dashboard-pulse-stay');
    const cash = screen.getByTestId('ops-dashboard-pulse-cash');
    expect(metricValue('Bookings MTD', stay)).toHaveTextContent('4');
    expect(metricValue('Gross booked MTD', stay)).toHaveTextContent('€120');
    expect(metricValue('Gross booked MTD', stay)).not.toHaveTextContent('€1.20');
    expect(metricValue('Paid active stays', stay)).toHaveTextContent('2');
    expect(metricValue('Open payment active stays', stay)).toHaveTextContent('3');
    expect(metricValue('Cancellations MTD', stay)).toHaveTextContent('1');
    expect(metricValue('Refunds MTD', stay)).toHaveTextContent('0');
    expect(metricValue('Gift voucher sales MTD', cash)).toHaveTextContent(formatMoneyFromCents(12000));
    expect(metricValue('Voucher cash collected MTD', cash)).toHaveTextContent(formatMoneyFromCents(8000));
    expect(metricValue('Physical card fees MTD', cash)).toHaveTextContent(formatMoneyFromCents(500));
    expect(metricValue('Voucher liability outstanding', cash)).toHaveTextContent(formatMoneyFromCents(20000));
    expect(metricValue('Voucher redemptions MTD', cash)).toHaveTextContent(formatMoneyFromCents(1500));
    expect(metricValue('Total cash collected MTD', cash)).toHaveTextContent(formatMoneyFromCents(25000));
    expect(cash.querySelector('.ops-dashboard-cash-metrics')).toBeInTheDocument();
    expect(within(cash).getByText('Voucher liability outstanding').closest('.ops-metric')).toHaveClass(
      'ops-dashboard-cash-metric--liability'
    );
    expect(within(cash).getByText('Total cash collected MTD').closest('.ops-metric')).toHaveClass(
      'ops-dashboard-cash-metric--total'
    );
    expect(screen.getByText('Open payment active stays')).toBeInTheDocument();
    expect(screen.queryByText('Unpaid active stays')).not.toBeInTheDocument();
  });

  it('falls back to bookingValueMTD for gross booked and uses ?? 0 when a pulse field is absent', async () => {
    opsReadAPI.dashboard.mockResolvedValue({
      data: {
        data: {
          dashboard: {
            alerts: [],
            today: { arriving: { total: 0, rows: [] }, staying: { total: 0, rows: [] }, leaving: { total: 0, rows: [] } },
            upcoming: { next14DaysArrivalCount: 0, nextArrivals: [] },
            pulse: { bookingValueMTD: 120 },
            health: { status: 'healthy' }
          }
        }
      }
    });
    renderPage();
    await waitFor(() => {
      expect(metricValue('Gross booked MTD')).toHaveTextContent('€120');
    });
    expect(metricValue('Bookings MTD')).toHaveTextContent('0');
    expect(metricValue('Gift voucher sales MTD')).toHaveTextContent(formatMoneyFromCents(0));
  });

  it('maps sync outcomes to canonical status and preserves health facts', async () => {
    opsReadAPI.dashboard.mockResolvedValue(
      payload(
        dashboard({
          health: {
            status: 'degraded',
            sync: { lastOutcome: 'failed' },
            email: { recentFailuresCount: 6 },
            payments: { webhookLastSeenAt: '2026-09-20T08:11:12.345Z' },
            manualReview: { openCount: 3 }
          }
        })
      )
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Degraded')).toBeInTheDocument();
    });
    expect(document.querySelector('[data-ops-status-key="sync.failed"]')).toBeTruthy();
    expect(screen.queryByText(/^failed$/)).not.toBeInTheDocument();
    expect(screen.getByText('Email failures (14d)')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('Manual review open')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('2026-09-20T08:11:12')).toBeInTheDocument();
  });

  it('shows Unknown for a missing sync outcome and Watch for warning health', async () => {
    opsReadAPI.dashboard.mockResolvedValue(
      payload(
        dashboard({
          health: { status: 'warning', sync: { lastOutcome: null } }
        })
      )
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Watch')).toBeInTheDocument();
    });
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(document.querySelector('[data-ops-status-key="sync.healthy"]')).toBeNull();
  });

  it('maps sync success to canonical healthy presentation', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Healthy')).toBeInTheDocument();
    });
    expect(document.querySelector('[data-ops-status-key="sync.healthy"]')).toBeTruthy();
    expect(screen.queryByText(/^success$/)).not.toBeInTheDocument();
  });

  it('corrects Comms destinations and preserves other deep links', async () => {
    opsReadAPI.dashboard.mockResolvedValue(
      payload(
        dashboard({
          alerts: [alertItem({ href: '/ops/reservations/alert-res' })],
          today: {
            arriving: {
              total: 1,
              rows: [reservationRow({ reservationId: 'nav-1', href: '/ops/reservations/nav-1', guestName: 'Nav Guest' })]
            }
          }
        })
      )
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Nav Guest')).toBeInTheDocument();
    });
    const comms = screen.getAllByRole('link', { name: 'Comms' });
    expect(comms.length).toBeGreaterThan(0);
    comms.forEach((link) => {
      expect(link).toHaveAttribute('href', '/ops/communications');
      expect(link.getAttribute('href')).not.toContain('oversight');
    });
    expect(screen.getByRole('link', { name: 'Reservations' })).toHaveAttribute('href', '/ops/reservations');
    expect(screen.getByRole('link', { name: 'Calendar' })).toHaveAttribute('href', '/ops/calendar');
    expect(screen.getAllByRole('link', { name: 'Payments' })[0]).toHaveAttribute('href', '/ops/payments');
    expect(screen.getAllByRole('link', { name: 'Sync' })[0]).toHaveAttribute('href', '/ops/sync');
    expect(screen.getByRole('link', { name: 'Manual review' })).toHaveAttribute('href', '/ops/manual-review');
    expect(screen.getByText('Nav Guest').closest('a')).toHaveAttribute('href', '/ops/reservations/nav-1');
    expect(screen.getByText('Payment failed').closest('a')).toHaveAttribute('href', '/ops/reservations/alert-res');

    fireEvent.click(comms[0]);
    expect(screen.getByTestId('comms-page')).toBeInTheDocument();
  });

  it('uses quiet empty copy on a quiet day and still renders pulse zeros', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No critical alerts.')).toBeInTheDocument();
    });
    expect(screen.getByText('No arrivals today.')).toBeInTheDocument();
    expect(screen.getByText('No guests staying now.')).toBeInTheDocument();
    expect(screen.queryByText(/in-house/i)).not.toBeInTheDocument();
    expect(screen.getByText('No departures today.')).toBeInTheDocument();
    expect(screen.getByText('No upcoming arrivals.')).toBeInTheDocument();
    expect(metricValue('Bookings MTD')).toHaveTextContent('0');
    expect(document.querySelector('.ops-empty')).toBeNull();
    expect(screen.queryByText('Readiness')).not.toBeInTheDocument();
    expect(screen.queryByText('Recent reservations')).not.toBeInTheDocument();
  });

  it('maps remaining alert types to canonical statuses without exposing raw keys', async () => {
    opsReadAPI.dashboard.mockResolvedValue(
      payload(
        dashboard({
          alerts: [
            alertItem({
              id: 'unlinked',
              type: 'payment_unlinked',
              severity: 'high',
              title: 'Unlinked payment'
            }),
            alertItem({
              id: 'verify',
              type: 'payment_pending_verification',
              severity: 'high',
              title: 'Verify payment'
            }),
            alertItem({
              id: 'unpaid',
              type: 'unpaid_upcoming',
              severity: 'medium',
              title: 'Unpaid upcoming booking'
            }),
            alertItem({
              id: 'refund',
              type: 'refund_follow_up',
              severity: 'high',
              title: 'Refund follow-up'
            }),
            alertItem({
              id: 'sync',
              type: 'sync_issue',
              severity: 'medium',
              title: 'Sync needs review'
            })
          ]
        })
      )
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Verify payment')).toBeInTheDocument();
    });
    expect(document.querySelector('[data-ops-status-key="payment.unlinked"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="payment.pending_verification"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="payment.unpaid"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="reservation.refund_pending"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="sync.warning"]')).toBeTruthy();
    expect(screen.queryByText('payment_unlinked')).not.toBeInTheDocument();
    expect(screen.queryByText('sync_issue')).not.toBeInTheDocument();
    expect(screen.getAllByText('High').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Medium').length).toBeGreaterThan(0);
  });

  it('does not navigate when Resolve is used on a linked manual-review alert', async () => {
    opsReadAPI.dashboard.mockResolvedValue(
      payload(
        dashboard({
          alerts: [
            alertItem({
              id: 'manual-review-mri-nav',
              type: 'manual_review',
              severity: 'high',
              title: 'Stay on dashboard',
              href: '/ops/reservations/should-not-open',
              manualReviewItemId: 'mri-nav'
            })
          ]
        })
      )
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(screen.queryByTestId('reservation-detail')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('What was done to handle this?')).toBeInTheDocument();
  });

  it('preserves distinct reservation operational tags on a populated fixture', async () => {
    opsReadAPI.dashboard.mockResolvedValue(
      payload(
        dashboard({
          today: {
            arriving: {
              total: 2,
              rows: [
                reservationRow({
                  reservationId: 'res-abc12345',
                  guestName: 'Confirmed Paid Guest',
                  reservationStatus: 'confirmed',
                  paymentStatus: 'paid',
                  statusLabel: 'Arrives in 2 days'
                }),
                reservationRow({
                  reservationId: 'res-unlinked',
                  guestName: 'Unlinked Guest',
                  reservationStatus: 'confirmed',
                  paymentStatus: 'unlinked_payment'
                })
              ]
            },
            staying: {
              total: 1,
              rows: [
                reservationRow({
                  reservationId: 'res-staying',
                  guestName: 'In House Guest',
                  reservationStatus: 'in_house',
                  paymentStatus: 'manual_not_required',
                  statusLabel: 'Currently staying'
                })
              ]
            },
            leaving: {
              total: 1,
              rows: [holdRow({ reservationId: 'hold-airbnb', guestName: 'Airbnb hold guest' })]
            }
          }
        })
      )
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Confirmed Paid Guest')).toBeInTheDocument();
    });
    expect(document.querySelector('[data-ops-status-key="reservation.confirmed"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="payment.paid"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="reservation.arriving_later"]')).toBeTruthy();
    expect(screen.getByText('Arriving in 2 days')).toBeInTheDocument();
    expect(screen.getByText('In House Guest')).toBeInTheDocument();
    expect(document.querySelector('[data-ops-status-key="reservation.in_house"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="payment.manual_not_required"]')).toBeTruthy();
    expect(screen.getByText('Currently staying')).toBeInTheDocument();
    expect(screen.getByText('Airbnb')).toBeInTheDocument();
    expect(screen.getByText('Airbnb hold guest').closest('a')).toBeNull();
    expect(document.querySelector('[data-ops-status-key="payment.unlinked"]')).toBeTruthy();
    expect(screen.getByText('#abc12345')).toBeInTheDocument();
    expect(screen.getAllByText('Stone House').length).toBeGreaterThan(0);
  });

  it('applies distinct semantic severity treatments on alert surfaces', async () => {
    opsReadAPI.dashboard.mockResolvedValue(
      payload(
        dashboard({
          alerts: [
            alertItem({ id: 'c1', severity: 'critical', title: 'Critical payment' }),
            alertItem({ id: 'h1', severity: 'high', title: 'High review', type: 'manual_review' }),
            alertItem({ id: 'm1', severity: 'medium', title: 'Medium note', type: 'guest_email_failed' })
          ]
        })
      )
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Critical payment')).toBeInTheDocument();
    });
    const critical = document.querySelector('[data-ops-alert-severity="critical"]');
    const high = document.querySelector('[data-ops-alert-severity="high"]');
    const medium = document.querySelector('[data-ops-alert-severity="medium"]');
    expect(critical).toHaveClass('ops-dashboard-alert--critical');
    expect(high).toHaveClass('ops-dashboard-alert--high');
    expect(medium).toHaveClass('ops-dashboard-alert--medium');
    expect(critical.querySelector('.ops-dashboard-alert__icon')).toHaveAttribute('aria-hidden', 'true');
    expect(critical.className).not.toEqual(high.className);
    expect(high.className).not.toEqual(medium.className);
    expect(screen.getAllByText('Critical').length).toBeGreaterThan(0);
    expect(screen.getAllByText('High').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Medium').length).toBeGreaterThan(0);
    expect(pageCss).toContain('ops-dashboard-alert--critical');
    expect(pageCss).toContain('--ops-danger-soft');
    expect(pageCss).toContain('--ops-warning-soft');
  });

  it('keeps all 12 pulse metrics and promotes gross booked through the desktop display system', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Bookings MTD')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ops-dashboard-pulse-stay').querySelectorAll('.ops-metric')).toHaveLength(6);
    expect(screen.getByTestId('ops-dashboard-pulse-cash').querySelectorAll('.ops-metric')).toHaveLength(6);
    expect(pageCss).toContain('grid-template-areas:');
    expect(pageCss).toContain('"gross bookings paid cancelled"');
    expect(pageCss).toContain('var(--ops-font-display)');
    expect(pageCss).toContain('var(--ops-size-dashboard-lead)');
    expect(pageCss).toMatch(/@container ops-page \(min-width:\s*720px\)[\s\S]*\.ops-dashboard-metric-group[\s\S]*repeat\(3/);
  });

  it('keeps one container-scoped composition while mobile retains the base flow', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Stay/business pulse')).toBeInTheDocument();
    });
    expect(document.querySelector('.ops-dashboard-intro')).toBeInTheDocument();
    expect(document.querySelector('.ops-dashboard-main')).toBeInTheDocument();
    expect(screen.getByTestId('ops-dashboard-alerts')).toHaveClass(
      'ops-dashboard-surface--alerts',
      'ops-dashboard-surface--alerts-empty'
    );
    expect(screen.getByTestId('ops-dashboard-today')).toHaveClass('ops-dashboard-surface--today');
    expect(screen.getByTestId('ops-dashboard-upcoming')).toHaveClass('ops-dashboard-surface--upcoming');
    expect(screen.getByTestId('ops-dashboard-pulse-stay')).toHaveClass('ops-dashboard-surface--stay');
    expect(screen.getByTestId('ops-dashboard-pulse-cash')).toHaveClass('ops-dashboard-surface--cash');

    expect(pageCss).not.toContain('.ops-shell-frame--desktop');
    expect(pageCss).toMatch(
      /@container ops-page \(min-width:\s*720px\)[\s\S]*\.ops-dashboard-main[\s\S]*grid-template-areas:/
    );
  });

  it('restores strong quick-link affordance with canonical button classes', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Reservations' })).toBeInTheDocument();
    });
    const reservations = screen.getByRole('link', { name: 'Reservations' });
    expect(reservations).toHaveClass('ops-button', 'ops-button--secondary', 'ops-button--compact');
    const newBooking = screen.getByRole('link', { name: 'New booking' });
    expect(newBooking).toHaveClass('ops-button', 'ops-button--primary', 'ops-button--compact');
    expect(newBooking).toHaveAttribute('href', '/ops/reservations?create=1');
    expect(
      screen.getAllByRole('link', { name: 'Comms' }).some((link) =>
        link.classList.contains('ops-dashboard-health__link')
      )
    ).toBe(true);
  });

  it('omits New booking when the current session lacks manual-create permission', async () => {
    renderPage({ ...adminSession, role: 'operator', actions: [] });
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Reservations' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('link', { name: 'New booking' })).not.toBeInTheDocument();
  });

  it('keeps the audited information-preservation ledger at zero missing signals', async () => {
    opsReadAPI.dashboard.mockResolvedValue(
      payload(
        dashboard({
          alerts: [
            alertItem({
              id: 'ledger-alert',
              type: 'manual_review',
              severity: 'high',
              title: 'Manual decision required',
              detail: 'Review the guest request before arrival.',
              href: '/ops/manual-review',
              manualReviewItemId: 'ledger-review'
            })
          ],
          today: {
            arriving: {
              total: 1,
              rows: [
                reservationRow({
                  reservationId: 'ledger-reservation',
                  href: '/ops/reservations/ledger-reservation',
                  guestName: 'Signal Guest',
                  accommodationDisplayName: 'A-Frame 3 · Unit 2',
                  datesLabel: '2026-09-21 - 2026-09-24',
                  guestsLabel: '2A 1C',
                  reservationStatus: 'confirmed',
                  paymentStatus: 'paid',
                  statusLabel: 'Arrives in 0 days'
                })
              ]
            },
            staying: { total: 1, rows: [holdRow({ guestName: 'Airbnb signal hold' })] },
            leaving: { total: 0, rows: [] }
          },
          upcoming: {
            next14DaysArrivalCount: 1,
            nextArrivals: [
              reservationRow({
                reservationId: 'ledger-upcoming',
                guestName: 'Upcoming Signal Guest',
                statusLabel: 'Arrives in 2 days'
              })
            ]
          },
          pulse: {
            bookingsMTD: 11,
            grossBookedMTD: 2683,
            activePaidCount: 8,
            activeUnpaidCount: 2,
            cancellationsMTD: 1,
            refundsMTD: 3,
            giftVouchers: {
              salesMTDCents: 41000,
              cashCollectedMTDCents: 38000,
              physicalCardFeesMTDCents: 1200,
              liabilityOutstandingCents: 19000,
              redemptionsMTDCents: 9000
            },
            cashCollected: { totalCashCollectedMTDCents: 306300 }
          },
          health: {
            status: 'warning',
            sync: { lastOutcome: 'warning', href: '/ops/sync' },
            email: { recentFailuresCount: 2, href: '/ops/communications' },
            payments: { webhookLastSeenAt: '2026-09-21T10:11:12.000Z', href: '/ops/payments' },
            manualReview: { openCount: 4, href: '/ops/manual-review' }
          }
        })
      )
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Manual decision required')).toBeInTheDocument();
    });

    const presentText = (text) => screen.queryAllByText(text).length > 0;
    const checks = [
      ['alert detail', presentText('Review the guest request before arrival.')],
      ['alert severity', presentText('High')],
      ['manual resolve', Boolean(screen.queryByRole('button', { name: 'Resolve' }))],
      ['arriving total', presentText('Arriving today')],
      ['staying total', presentText('Staying now')],
      ['leaving total', presentText('Leaving today')],
      ['guest identity', presentText('Signal Guest')],
      ['unit identity', presentText('A-Frame 3 · Unit 2')],
      ['dates', presentText('2026-09-21 - 2026-09-24')],
      ['guest count', presentText(/2A 1C/)],
      ['Airbnb identity', presentText('Airbnb signal hold')],
      ['Airbnb channel', presentText('Airbnb')],
      ['upcoming count', presentText('Next 14 days: 1')],
      ['upcoming row', presentText('Upcoming Signal Guest')],
      ['bookings MTD', presentText('Bookings MTD')],
      ['gross booked MTD', presentText('Gross booked MTD')],
      ['paid stays', presentText('Paid active stays')],
      ['open-payment stays', presentText('Open payment active stays')],
      ['cancellations', presentText('Cancellations MTD')],
      ['refunds', presentText('Refunds MTD')],
      ['voucher sales', presentText('Gift voucher sales MTD')],
      ['voucher cash', presentText('Voucher cash collected MTD')],
      ['card fees', presentText('Physical card fees MTD')],
      ['voucher liability', presentText('Voucher liability outstanding')],
      ['voucher redemptions', presentText('Voucher redemptions MTD')],
      ['total cash', presentText('Total cash collected MTD')],
      [
        'financial distinction note',
        presentText('Gift voucher sales are prepaid credit. Gross booked stays and cash collected are shown separately.')
      ],
      ['sync health', presentText('Sync last outcome')],
      ['email health', presentText('Email failures (14d)')],
      ['manual-review health', presentText('Manual review open')],
      ['webhook health', presentText('Webhook last seen')],
      ['new-booking action', Boolean(screen.queryByRole('link', { name: 'New booking' }))]
    ];

    expect(checks.filter(([, present]) => !present).map(([signal]) => signal)).toEqual([]);
    expect(document.querySelector('[data-ops-status-key="reservation.confirmed"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="payment.paid"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="reservation.arriving_today"]')).toBeTruthy();
    expect(document.querySelector('[data-ops-status-key="reservation.arriving_later"]')).toBeTruthy();
    expect(screen.getByText('Signal Guest').closest('a')).toHaveAttribute(
      'href',
      '/ops/reservations/ledger-reservation'
    );
    expect(screen.getByText('Airbnb signal hold').closest('a')).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Sync' }).at(-1)).toHaveAttribute('href', '/ops/sync');
    expect(screen.getAllByRole('link', { name: 'Comms' }).at(-1)).toHaveAttribute(
      'href',
      '/ops/communications'
    );
    expect(screen.getAllByRole('link', { name: 'Payments' }).at(-1)).toHaveAttribute(
      'href',
      '/ops/payments'
    );
    expect(screen.getByRole('link', { name: 'Manual review' })).toHaveAttribute('href', '/ops/manual-review');
  });

  it('keeps health facts in a compact strip without a giant banner', async () => {
    opsReadAPI.dashboard.mockResolvedValue(
      payload(
        dashboard({
          health: {
            status: 'degraded',
            sync: { lastOutcome: 'failed' },
            email: { recentFailuresCount: 2 },
            manualReview: { openCount: 1 }
          }
        })
      )
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('ops-dashboard-health-chip')).toHaveTextContent('Degraded');
    });
    expect(document.querySelector('.ops-banner--warning')).toBeNull();
    expect(screen.getByTestId('ops-dashboard-health')).toBeInTheDocument();
    expect(screen.getByText('Email failures (14d)')).toBeInTheDocument();
    expect(screen.getByText('Manual review open')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Health summary' })).not.toBeInTheDocument();
  });
});
