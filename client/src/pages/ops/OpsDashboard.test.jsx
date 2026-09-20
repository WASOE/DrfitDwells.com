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
  actions: [],
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

function renderPage() {
  return render(
    <div className="ops-root" data-ops-appearance="light" data-ops-themed="true">
      <MemoryRouter initialEntries={['/ops']}>
        <OpsSessionProvider session={adminSession}>
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

  it('uses OpsPage wide, Dashboard header, and no legacy title card', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    });
    expect(screen.getByTestId('ops-page')).toHaveAttribute('data-ops-page-width', 'wide');
    expect(screen.getByTestId('ops-page')).toHaveClass('ops-page--wide');
    expect(screen.queryByRole('heading', { name: 'OPS Dashboard' })).not.toBeInTheDocument();
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
    expect(headings.indexOf('Gift vouchers & cash')).toBeLessThan(headings.indexOf('Health summary'));
    expect(screen.getByText('Arriving Guest')).toBeInTheDocument();
    expect(screen.getByText('Staying Guest')).toBeInTheDocument();
    expect(screen.getByText('Leaving Guest')).toBeInTheDocument();
    expect(screen.getByText('Upcoming Guest')).toBeInTheDocument();
    expect(screen.getByText('Next 14 days: 4')).toBeInTheDocument();
    expect(document.querySelector('.ops-metric-group')).toBeTruthy();
    expect(document.querySelector('.lg\\:grid-cols-6')).toBeNull();
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
});
