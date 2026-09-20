import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpsSessionProvider } from '../../context/OpsSessionContext';
import OpsPayments from './OpsPayments';

vi.mock('../../services/opsApi', () => ({
  opsReadAPI: {
    paymentsSummary: vi.fn(),
    paymentsLedger: vi.fn(),
    payoutsList: vi.fn(),
    payoutReconciliationSummary: vi.fn(),
    payoutDetail: vi.fn()
  },
  opsWriteAPI: {}
}));

import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';

const pageSource = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'OpsPayments.jsx'),
  'utf8'
);
const pageCss = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'OpsPayments.css'),
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

function expectedAmount(amount, currency) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: String(currency).toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

function expectedWebhook(iso) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Sofia',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(new Date(iso));
}

function paymentItem(overrides = {}) {
  return {
    paymentId: 'pay-1',
    reservationId: 'res-1',
    status: 'paid',
    amount: 120,
    currency: 'eur',
    provider: 'stripe',
    providerReference: 'pi_paid_linked',
    linkageState: 'linked',
    createdAt: '2026-09-20T08:10:00.000Z',
    ...overrides
  };
}

function payoutItem(overrides = {}) {
  return {
    payoutId: 'payout-1',
    status: 'paid',
    amount: 200,
    currency: 'eur',
    provider: 'stripe',
    providerReference: 'po_paid_one',
    expectedArrivalDate: '2026-09-22T00:00:00.000Z',
    paidAt: '2026-09-21T00:00:00.000Z',
    ...overrides
  };
}

function summaryData(overrides = {}) {
  return {
    totals: {
      total: 6,
      failed: 1,
      disputed: 1,
      unlinked: 2,
      ...overrides.totals
    },
    observability: {
      webhookLastSeenAt: '2026-09-20T08:10:00.000Z',
      webhookLastEventType: 'payment_intent.succeeded',
      openReconciliationItems: 3,
      ...overrides.observability
    },
    derived: { classification: 'derived_on_read' },
    ...overrides
  };
}

function reconData(overrides = {}) {
  return {
    totals: {
      totalPayouts: 5,
      withReservationReference: 2,
      incompleteLinkage: 3,
      ...overrides.totals
    },
    manualReview: {
      openUnlinkedPayouts: 1,
      ...overrides.manualReview
    }
  };
}

function wrap(data) {
  return { data: { data } };
}

function mockSuccessfulLoad({
  summary = summaryData(),
  ledger = [paymentItem()],
  payouts = [payoutItem()],
  reconciliation = reconData()
} = {}) {
  opsReadAPI.paymentsSummary.mockResolvedValue(wrap(summary));
  opsReadAPI.paymentsLedger.mockResolvedValue(wrap({ items: ledger, pagination: { page: 1, limit: 20, total: ledger.length, totalPages: 1 } }));
  opsReadAPI.payoutsList.mockResolvedValue(wrap({ items: payouts, pagination: { page: 1, limit: 20, total: payouts.length, totalPages: 1 } }));
  opsReadAPI.payoutReconciliationSummary.mockResolvedValue(wrap(reconciliation));
}

function renderPage() {
  return render(
    <div className="ops-root" data-ops-appearance="light" data-ops-themed="true">
      <OpsSessionProvider session={adminSession}>
        <OpsPayments />
      </OpsSessionProvider>
    </div>
  );
}

function metricValue(label) {
  return screen.getByText(label).nextElementSibling;
}

describe('OpsPayments dashboard/ledger migration', () => {
  beforeEach(() => {
    opsReadAPI.paymentsSummary.mockReset();
    opsReadAPI.paymentsLedger.mockReset();
    opsReadAPI.payoutsList.mockReset();
    opsReadAPI.payoutReconciliationSummary.mockReset();
    opsReadAPI.payoutDetail.mockReset();
    mockSuccessfulLoad();
    opsReadAPI.payoutDetail.mockResolvedValue(
      wrap({
        payout: {
          payoutId: 'payout-1',
          status: 'paid',
          amount: 200,
          currency: 'eur'
        },
        reconciliation: { reservationId: 'res-1', linkageState: 'linked' },
        degraded: { linkageIncomplete: false }
      })
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('uses OpsPage default and OpsPageHeader without a local width wrapper', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Payments and payouts' })).toBeInTheDocument();
    });
    expect(screen.getByTestId('ops-page')).toHaveAttribute('data-ops-page-width', 'default');
    expect(screen.getByTestId('ops-page')).toHaveClass('ops-page--default');
    expect(pageSource).not.toMatch(/max-w-7xl|max-w-\[|mx-auto|bg-white border border-gray-200 rounded-xl|#81887A|text-red-|text-amber/);
    expect(pageSource).toContain('opsReadAPI.paymentsSummary()');
    expect(pageSource).toContain('opsReadAPI.paymentsLedger({ page: 1, limit: 20 })');
    expect(pageSource).toContain('opsReadAPI.payoutsList({ page: 1, limit: 20 })');
    expect(pageSource).toContain('opsReadAPI.payoutReconciliationSummary()');
    expect(pageSource).toContain('opsReadAPI.payoutDetail(id)');
  });

  it('reads the four mount endpoints once and does not poll, paginate, or write', async () => {
    renderPage();
    await waitFor(() => {
      expect(opsReadAPI.paymentsSummary).toHaveBeenCalledTimes(1);
    });
    expect(opsReadAPI.paymentsLedger).toHaveBeenCalledTimes(1);
    expect(opsReadAPI.payoutsList).toHaveBeenCalledTimes(1);
    expect(opsReadAPI.payoutReconciliationSummary).toHaveBeenCalledTimes(1);
    expect(opsReadAPI.payoutDetail).not.toHaveBeenCalled();
    expect(opsReadAPI.paymentsLedger).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(opsReadAPI.payoutsList).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(opsReadAPI.paymentsSummary.mock.calls[0]).toEqual([]);
    expect(pageSource).not.toMatch(/setInterval|setTimeout|addEventListener\(['"]visibilitychange/);
    expect(pageSource).not.toMatch(/OpsPagination|opsWriteAPI|formatMoneyFromCents|page:\s*2/);
    expect(pageSource).not.toMatch(/\/ops\/reservations|stripe\.com|manual-review/);
    expect(Object.keys(opsWriteAPI)).toEqual([]);
  });

  it('preserves exact metric calculations including divergent unlinked definitions', async () => {
    mockSuccessfulLoad({
      summary: summaryData({
        totals: { total: 11, failed: 4, disputed: 3, unlinked: 7 },
        observability: { webhookLastSeenAt: '2026-09-20T08:10:00.000Z', openReconciliationItems: 9 }
      }),
      reconciliation: reconData({
        totals: { totalPayouts: 8, withReservationReference: 2, incompleteLinkage: 6 },
        manualReview: { openUnlinkedPayouts: 0 }
      })
    });
    renderPage();
    await waitFor(() => {
      expect(metricValue('Total payments')).toHaveTextContent('11');
    });
    expect(metricValue('Failed/disputed')).toHaveTextContent('7');
    expect(metricValue('Unlinked payments')).toHaveTextContent('7');
    expect(metricValue('Unlinked payouts')).toHaveTextContent('0');
    expect(metricValue('Total payouts')).toHaveTextContent('8');
    expect(metricValue('With reservation reference')).toHaveTextContent('2');
    expect(metricValue('Incomplete linkage')).toHaveTextContent('6');
    expect(screen.getByText(/open reconciliation items: 9/)).toBeInTheDocument();
    expect(pageSource).toContain('(summary?.totals?.failed ?? 0) + (summary?.totals?.disputed ?? 0)');
    expect(pageSource).toContain('reconciliation?.manualReview?.openUnlinkedPayouts');
    expect(pageSource).toContain('reconciliation?.totals?.incompleteLinkage');
    expect(pageSource).toContain('summary?.totals?.unlinked');
  });

  it('keeps successful zero metrics as data and does not empty the dashboard', async () => {
    mockSuccessfulLoad({
      summary: summaryData({
        totals: { total: 0, failed: 0, disputed: 0, unlinked: 0 },
        observability: { webhookLastSeenAt: null, webhookLastEventType: null, openReconciliationItems: 0 }
      }),
      ledger: [],
      payouts: [],
      reconciliation: reconData({
        totals: { totalPayouts: 0, withReservationReference: 0, incompleteLinkage: 0 },
        manualReview: { openUnlinkedPayouts: 0 }
      })
    });
    renderPage();
    await waitFor(() => {
      expect(metricValue('Total payments')).toHaveTextContent('0');
    });
    expect(metricValue('Failed/disputed')).toHaveTextContent('0');
    expect(metricValue('Unlinked payments')).toHaveTextContent('0');
    expect(metricValue('Unlinked payouts')).toHaveTextContent('0');
    expect(metricValue('Total payouts')).toHaveTextContent('0');
    expect(metricValue('With reservation reference')).toHaveTextContent('0');
    expect(metricValue('Incomplete linkage')).toHaveTextContent('0');
    expect(screen.getByText(/Webhook last seen: unknown/)).toBeInTheDocument();
    expect(screen.getByText('No payment evidence yet.')).toBeInTheDocument();
    expect(screen.getByText('No payout evidence yet.')).toBeInTheDocument();
  });

  it('formats major-unit amounts per record currency and does not convert cents', async () => {
    mockSuccessfulLoad({
      ledger: [
        paymentItem({ paymentId: 'pay-eur', amount: 120, currency: 'eur', providerReference: 'pi_eur_120' }),
        paymentItem({
          paymentId: 'pay-usd',
          amount: 85,
          currency: 'usd',
          providerReference: 'pi_usd_85',
          status: 'paid',
          linkageState: 'linked'
        })
      ],
      payouts: [payoutItem({ amount: 120, currency: 'eur', providerReference: 'po_eur_120' })]
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('pi_eur_120')).toBeInTheDocument();
    });
    expect(screen.getAllByText(expectedAmount(120, 'eur')).length).toBeGreaterThan(0);
    expect(screen.getByText(expectedAmount(85, 'usd'))).toBeInTheDocument();
    expect(screen.queryByText(expectedAmount(1.2, 'eur'))).not.toBeInTheDocument();
    expect(screen.queryByText('€1.20')).not.toBeInTheDocument();
    expect(pageSource).not.toMatch(/\/ 100|formatMoneyFromCents/);
  });

  it('renders payment statuses through OpsStatus and keeps linkage as metadata', async () => {
    mockSuccessfulLoad({
      ledger: [
        paymentItem({ paymentId: 'p-paid', status: 'paid', linkageState: 'linked', providerReference: 'pi_paid' }),
        paymentItem({ paymentId: 'p-partial', status: 'partial', linkageState: 'linked', providerReference: 'pi_partial' }),
        paymentItem({ paymentId: 'p-unpaid', status: 'unpaid', linkageState: 'unlinked', providerReference: 'pi_unpaid' }),
        paymentItem({ paymentId: 'p-failed', status: 'failed', linkageState: 'unlinked', providerReference: 'pi_failed' }),
        paymentItem({ paymentId: 'p-disputed', status: 'disputed', linkageState: 'linked', providerReference: 'pi_disputed' }),
        paymentItem({
          paymentId: 'p-refunded',
          status: 'refunded',
          linkageState: 'linked',
          providerReference: 'pi_refunded'
        })
      ]
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('pi_paid')).toBeInTheDocument();
    });
    expect(document.querySelector('[data-ops-status-key="payment.paid"]')).toBeInTheDocument();
    expect(document.querySelector('[data-ops-status-key="payment.partial"]')).toBeInTheDocument();
    expect(document.querySelector('[data-ops-status-key="payment.unpaid"]')).toBeInTheDocument();
    expect(document.querySelector('[data-ops-status-key="payment.failed"]')).toBeInTheDocument();
    expect(document.querySelector('[data-ops-status-key="payment.disputed"]')).toBeInTheDocument();
    expect(document.querySelector('[data-ops-status-key="payment.refunded"]')).toBeInTheDocument();
    expect(document.querySelector('[data-ops-status-key="payment.unlinked"]')).not.toBeInTheDocument();
    const unpaidRow = screen.getByText('pi_unpaid').closest('.ops-payments-row');
    expect(within(unpaidRow).getByText('unlinked')).toBeInTheDocument();
    expect(within(unpaidRow).queryByText('Unlinked payment')).not.toBeInTheDocument();
  });

  it('keeps payout statuses as provider text and does not map them through payment status', async () => {
    mockSuccessfulLoad({
      payouts: [
        payoutItem({ payoutId: 'po-pending', status: 'pending', providerReference: 'po_pending' }),
        payoutItem({ payoutId: 'po-paid', status: 'paid', providerReference: 'po_paid' }),
        payoutItem({ payoutId: 'po-failed', status: 'failed', providerReference: 'po_failed' }),
        payoutItem({
          payoutId: 'po-recon',
          status: 'reconciliation_completed',
          providerReference: 'po_recon'
        })
      ]
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('po_pending')).toBeInTheDocument();
    });
    const payoutSection = screen.getByRole('heading', { name: 'Recent payouts' }).closest('section');
    expect(within(payoutSection).getByText('pending')).toBeInTheDocument();
    expect(within(payoutSection).getByText('paid')).toBeInTheDocument();
    expect(within(payoutSection).getByText('failed')).toBeInTheDocument();
    expect(within(payoutSection).getByText('reconciliation_completed')).toBeInTheDocument();
    expect(payoutSection.querySelector('[data-ops-status-key]')).toBeNull();
  });

  it('labels evidence as recent/capped and does not render pagination', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Recent payments' })).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'Recent payouts' })).toBeInTheDocument();
    expect(screen.getAllByText('Latest 20')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /pagination/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/all payments/i)).not.toBeInTheDocument();
  });

  it('formats webhook last seen in Europe/Sofia without exposing unused derived fields', async () => {
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText(
          `Webhook last seen: ${expectedWebhook('2026-09-20T08:10:00.000Z')} · open reconciliation items: 3`
        )
      ).toBeInTheDocument();
    });
    expect(screen.queryByText('derived_on_read')).not.toBeInTheDocument();
    expect(screen.queryByText('payment_intent.succeeded')).not.toBeInTheDocument();
    expect(pageSource).toContain("timeZone: PROPERTY_TIME_ZONE");
  });

  it('shows loading inside the page while the header stays visible', async () => {
    let resolveSummary;
    opsReadAPI.paymentsSummary.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSummary = resolve;
        })
    );
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Payments and payouts' })).toBeInTheDocument();
    expect(screen.getByText('Loading payments')).toBeInTheDocument();
    expect(screen.queryByText('Total payments')).not.toBeInTheDocument();
    resolveSummary(wrap(summaryData()));
    await waitFor(() => {
      expect(screen.getByText('Total payments')).toBeInTheDocument();
    });
  });

  it('does not present synthetic zero metrics when the initial load fails', async () => {
    opsReadAPI.paymentsSummary.mockRejectedValue({
      response: { data: { message: 'Payments service unavailable' } }
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Payments service unavailable')).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Payments and payouts' })).toBeInTheDocument();
    expect(screen.queryByText('Total payments')).not.toBeInTheDocument();
    expect(screen.queryByText('Failed/disputed')).not.toBeInTheDocument();
    expect(screen.queryByText('Unlinked payments')).not.toBeInTheDocument();
    expect(screen.queryByText('No payment evidence yet.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    expect(opsReadAPI.payoutDetail).not.toHaveBeenCalled();
  });

  it('loads payout detail in place, marks the row selected, and keeps the dashboard intact on detail failure', async () => {
    mockSuccessfulLoad({
      payouts: [
        payoutItem({ payoutId: 'payout-1', providerReference: 'po_one', status: 'pending' }),
        payoutItem({ payoutId: 'payout-2', providerReference: 'po_two', status: 'failed' })
      ]
    });
    opsReadAPI.payoutDetail.mockResolvedValueOnce(
      wrap({
        payout: { payoutId: 'payout-1', status: 'pending', amount: 200, currency: 'eur' },
        reconciliation: { reservationId: 'res-1', linkageState: 'linked' },
        degraded: { linkageIncomplete: false }
      })
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /po_one/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /po_one/ }));
    await waitFor(() => {
      expect(screen.getByText('Status: pending')).toBeInTheDocument();
    });
    expect(opsReadAPI.payoutDetail).toHaveBeenCalledTimes(1);
    expect(opsReadAPI.payoutDetail).toHaveBeenCalledWith('payout-1');
    expect(screen.getByRole('button', { name: /po_one/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /po_two/ })).not.toHaveAttribute('aria-current');
    expect(pageCss).toMatch(/aria-current='true'\]::before/);
    expect(pageCss).toMatch(/width: 2px/);
    expect(pageCss).toMatch(/background: var\(--ops-accent\)/);
    expect(metricValue('Total payments')).toHaveTextContent('6');

    opsReadAPI.payoutDetail.mockRejectedValueOnce({
      response: { data: { message: 'Payout not found' } }
    });
    fireEvent.click(screen.getByRole('button', { name: /po_two/ }));
    await waitFor(() => {
      expect(screen.getByText('Payout not found')).toBeInTheDocument();
    });
    expect(opsReadAPI.payoutDetail).toHaveBeenCalledTimes(2);
    expect(opsReadAPI.payoutDetail).toHaveBeenCalledWith('payout-2');
    expect(opsReadAPI.paymentsSummary).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /po_two/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /po_one/ })).not.toHaveAttribute('aria-current');
    expect(metricValue('Total payments')).toHaveTextContent('6');
    expect(screen.getByText('Status: pending')).toBeInTheDocument();
    expect(screen.queryByText('Payments service unavailable')).not.toBeInTheDocument();
    expect(screen.queryByText('Failed to load payments module')).not.toBeInTheDocument();
  });

  it('shows degraded payout linkage as a warning without using danger', async () => {
    opsReadAPI.payoutDetail.mockResolvedValue(
      wrap({
        payout: { payoutId: 'payout-1', status: 'paid', amount: 200, currency: 'eur' },
        reconciliation: { reservationId: null, linkageState: 'unknown_or_unlinked' },
        degraded: { linkageIncomplete: true }
      })
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /po_paid_one/ })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /po_paid_one/ }));
    await waitFor(() => {
      expect(screen.getByText('Linkage: unknown_or_unlinked')).toBeInTheDocument();
    });
    expect(screen.getByText('Degraded: payout is not linked to a reservation yet.')).toBeInTheDocument();
    expect(screen.queryByText('res-1')).not.toBeInTheDocument();
  });

  it('shows webhook evidence unknown when observability is missing', async () => {
    mockSuccessfulLoad({
      summary: {
        totals: { total: 1, failed: 0, disputed: 0, unlinked: 0 }
      }
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Webhook evidence: unknown')).toBeInTheDocument();
    });
  });
});
