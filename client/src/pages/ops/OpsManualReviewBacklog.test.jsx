import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpsSessionProvider } from '../../context/OpsSessionContext';
import OpsManualReviewBacklog from './OpsManualReviewBacklog';

vi.mock('../../services/opsApi', () => ({
  opsReadAPI: {
    manualReview: vi.fn()
  },
  opsWriteAPI: {
    resolveManualReviewItem: vi.fn()
  }
}));

import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';

const pageSource = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'OpsManualReviewBacklog.jsx'),
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

const BOOKING_ID = '507f1f77bcf86cd799439011';

function item(overrides = {}) {
  return {
    manualReviewItemId: 'mri-1',
    title: 'Guest message automation failed',
    category: 'comms_outbound',
    severity: 'medium',
    status: 'open',
    entityType: 'booking',
    entityId: BOOKING_ID,
    details: 'Could not send the pre-arrival message.',
    evidence: {},
    provenance: { source: 'messaging', sourceReference: 'job-44' },
    ...overrides
  };
}

function payload(items) {
  return { data: { data: { items } } };
}

function ReservationStub() {
  const { id } = useParams();
  return <div data-testid="reservation-detail">{id}</div>;
}

function renderPage() {
  return render(
    <div className="ops-root" data-ops-appearance="light" data-ops-themed="true">
      <MemoryRouter initialEntries={['/ops/manual-review']}>
        <OpsSessionProvider session={adminSession}>
          <Routes>
            <Route path="/ops/manual-review" element={<OpsManualReviewBacklog />} />
            <Route path="/ops/reservations/:id" element={<ReservationStub />} />
          </Routes>
        </OpsSessionProvider>
      </MemoryRouter>
    </div>
  );
}

function collection() {
  return document.querySelector('.ops-mr-list');
}

describe('OpsManualReviewBacklog collection migration', () => {
  beforeEach(() => {
    opsReadAPI.manualReview.mockReset();
    opsWriteAPI.resolveManualReviewItem.mockReset();
    opsReadAPI.manualReview.mockResolvedValue(payload([item()]));
    opsWriteAPI.resolveManualReviewItem.mockResolvedValue({
      data: { success: true, data: { item: item({ status: 'resolved' }) } }
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('uses OpsPage wide and OpsPageHeader without a legacy title card or max-w-7xl', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Manual review' })).toBeInTheDocument();
    });
    expect(screen.getByTestId('ops-page')).toHaveAttribute('data-ops-page-width', 'wide');
    expect(screen.getByTestId('ops-page')).toHaveClass('ops-page--wide');
    expect(screen.queryByRole('heading', { level: 2, name: 'Manual review backlog' })).not.toBeInTheDocument();
    expect(pageSource).not.toMatch(/max-w-7xl|bg-white border border-gray-200 rounded-xl|#81887A/);
    expect(pageSource).toContain('Open operational items requiring operator action.');
    expect(pageSource).not.toContain('window.confirm');
  });

  it('reads manualReview with page 1, limit 50, and status open', async () => {
    renderPage();
    await waitFor(() => {
      expect(opsReadAPI.manualReview).toHaveBeenCalled();
    });
    expect(opsReadAPI.manualReview).toHaveBeenCalledWith({ page: 1, limit: 50, status: 'open' });
    expect(opsReadAPI.manualReview.mock.calls[0]).toEqual([{ page: 1, limit: 50, status: 'open' }]);
  });

  it('renders existing fields, severity as canonical status, and metadata', async () => {
    opsReadAPI.manualReview.mockResolvedValue(
      payload([
        item(),
        item({
          manualReviewItemId: 'mri-high',
          title: 'Payment mismatch needs operator review',
          category: 'payments_unlinked',
          severity: 'high',
          entityType: 'payout',
          entityId: 'po_very_long_reference_identifier_that_must_wrap',
          details:
            'This payout could not be matched to a reservation because the descriptor is unusually long and includes extra operator notes that must wrap instead of overflowing.',
          provenance: { source: 'stripe', sourceReference: 'po_very_long_reference_identifier_that_must_wrap' }
        }),
        item({
          manualReviewItemId: 'mri-critical',
          title: 'Critical inventory conflict',
          category: 'inventory_overlap',
          severity: 'critical',
          entityType: 'unit',
          entityId: 'unit-9',
          details: 'Overlapping paid nights on the same unit.',
          provenance: { source: 'inventory' }
        })
      ])
    );
    renderPage();
    await waitFor(() => {
      expect(within(collection()).getByText('Guest message automation failed')).toBeInTheDocument();
    });

    expect(within(collection()).getByText('Open')).toHaveAttribute('data-ops-status-key', 'manual_review.open');
    expect(within(collection()).getByText(/Category: comms_outbound/)).toBeInTheDocument();
    expect(within(collection()).getByText(/Severity: medium/)).toBeInTheDocument();
    expect(within(collection()).getByText(/Target: booking/)).toBeInTheDocument();
    expect(within(collection()).getByText(BOOKING_ID)).toBeInTheDocument();
    expect(within(collection()).getByText('Could not send the pre-arrival message.')).toBeInTheDocument();
    expect(within(collection()).getByText(/Provenance: messaging/)).toBeInTheDocument();
    expect(within(collection()).getByText('(job-44)')).toBeInTheDocument();
    expect(screen.queryByText('1 item(s)')).not.toBeInTheDocument();
    expect(screen.getByText('3 item(s)')).toBeInTheDocument();

    expect(within(collection()).getByText('High')).toHaveAttribute('data-ops-status-key', 'manual_review.high');
    expect(within(collection()).queryByText(/Severity: high/)).not.toBeInTheDocument();
    expect(within(collection()).getByText('po_very_long_reference_identifier_that_must_wrap')).toBeInTheDocument();

    expect(within(collection()).getByText('Critical')).toHaveAttribute('data-ops-status-key', 'manual_review.critical');
    expect(within(collection()).queryByText(/Severity: critical/)).not.toBeInTheDocument();
    expect(within(collection()).getByText('Overlapping paid nights on the same unit.')).toBeInTheDocument();
  });

  it('keeps the comms reservation link destination and does not invent other deep links', async () => {
    opsReadAPI.manualReview.mockResolvedValue(
      payload([
        item({
          category: 'comms_outbound',
          evidence: { bookingId: BOOKING_ID }
        }),
        item({
          manualReviewItemId: 'mri-entity',
          title: 'Comms via entity id',
          category: 'comms_inbound',
          entityType: 'booking',
          entityId: '507f1f77bcf86cd799439012',
          evidence: {}
        }),
        item({
          manualReviewItemId: 'mri-payment',
          title: 'Unlinked payout',
          category: 'payments_unlinked',
          entityType: 'payout',
          entityId: 'po_1',
          evidence: { bookingId: BOOKING_ID }
        })
      ])
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: 'Open reservation (guest message automation)' })).toHaveLength(2);
    });
    const links = screen.getAllByRole('link', { name: 'Open reservation (guest message automation)' });
    expect(links[0]).toHaveAttribute('href', `/ops/reservations/${BOOKING_ID}`);
    expect(links[1]).toHaveAttribute('href', '/ops/reservations/507f1f77bcf86cd799439012');
    fireEvent.click(links[0]);
    expect(screen.getByTestId('reservation-detail')).toHaveTextContent(BOOKING_ID);
  });

  it('keeps Resolve only on open items and reloads after the same resolve payload', async () => {
    opsReadAPI.manualReview
      .mockResolvedValueOnce(
        payload([
          item(),
          item({
            manualReviewItemId: 'mri-resolved',
            title: 'Already handled',
            status: 'resolved'
          })
        ])
      )
      .mockResolvedValueOnce(payload([]));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Guest message automation failed')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument();
    expect(screen.getByText('Already handled')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Resolve' })).toHaveLength(1);

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
      expect(opsReadAPI.manualReview).toHaveBeenCalledTimes(2);
    });
    expect(opsReadAPI.manualReview.mock.calls[1][0]).toEqual({ page: 1, limit: 50, status: 'open' });
  });

  it('keeps the resolve form open and shows the existing error on a failed save', async () => {
    opsWriteAPI.resolveManualReviewItem.mockRejectedValue({
      response: { data: { message: 'Resolve blocked by hold' } }
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
      expect(screen.getByText('Resolve blocked by hold')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Confirm resolve' })).toBeInTheDocument();
    expect(opsReadAPI.manualReview).toHaveBeenCalledTimes(1);
  });

  it('shows loading inside the page while the header stays visible', async () => {
    let resolveLoad;
    opsReadAPI.manualReview.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        })
    );
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Manual review' })).toBeInTheDocument();
    expect(screen.getByText('Loading manual review backlog')).toBeInTheDocument();
    resolveLoad(payload([item()]));
    await waitFor(() => {
      expect(screen.getByText('Guest message automation failed')).toBeInTheDocument();
    });
  });

  it('shows the existing error in a banner and does not invent retry chrome', async () => {
    opsReadAPI.manualReview.mockRejectedValue({
      response: { data: { message: 'Manual review service unavailable' } }
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Manual review service unavailable')).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Manual review' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing to review right now.')).not.toBeInTheDocument();
  });

  it('shows the existing empty copy when there are no open items', async () => {
    opsReadAPI.manualReview.mockResolvedValue(payload([]));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Nothing to review right now.')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument();
  });

  it('shows the existing missing-data copy when the payload has no data object', async () => {
    opsReadAPI.manualReview.mockResolvedValue({ data: {} });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No manual review backlog data.')).toBeInTheDocument();
    });
  });
});
