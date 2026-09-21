import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpsSessionProvider } from '../../context/OpsSessionContext';
import OpsCommunicationOversight from './OpsCommunicationOversight';

vi.mock('../../services/opsApi', () => ({
  opsReadAPI: {
    communicationsOversight: vi.fn()
  }
}));

import { opsReadAPI } from '../../services/opsApi';

const pageSource = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'OpsCommunicationOversight.jsx'),
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

function delivery(overrides = {}) {
  return {
    smtpConfigured: true,
    workerEnabled: true,
    workerRunning: true,
    deliveryHealth: 'ok',
    worker: { workerId: 'worker-1' },
    ...overrides
  };
}

function eventRow(overrides = {}) {
  return {
    eventId: 'mail-1',
    type: 'Delivery',
    recipient: 'guest@example.com',
    bookingId: '507f1f77bcf86cd799439011',
    happenedAt: '2026-09-20T08:10:00.000Z',
    ...overrides
  };
}

function payload(overrides = {}) {
  return {
    data: {
      data: {
        summary: {
          failedEvents: 3,
          totalRecentEvents: 2,
          confirmationPendingDue: 1,
          confirmationFailed: 2,
          confirmationAmbiguous: 1,
          ...overrides.summary
        },
        confirmationDelivery: delivery(overrides.confirmationDelivery),
        recent: overrides.recent !== undefined ? overrides.recent : [eventRow()],
        degraded: {
          eventTrackingGapsPossible: true,
          overdueConfirmationBacklog: true,
          confirmationWorkerUnhealthy: false,
          ...overrides.degraded
        }
      }
    }
  };
}

function renderPage() {
  return render(
    <div className="ops-root" data-ops-appearance="light" data-ops-themed="true">
      <OpsSessionProvider session={adminSession}>
        <OpsCommunicationOversight />
      </OpsSessionProvider>
    </div>
  );
}

describe('OpsCommunicationOversight dashboard migration', () => {
  beforeEach(() => {
    opsReadAPI.communicationsOversight.mockReset();
    opsReadAPI.communicationsOversight.mockResolvedValue(payload());
  });

  afterEach(() => {
    cleanup();
  });

  it('uses OpsPage wide and OpsPageHeader without a legacy title card or max-w-7xl', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Communications' })).toBeInTheDocument();
    });
    expect(screen.getByTestId('ops-page')).toHaveAttribute('data-ops-page-width', 'wide');
    expect(screen.getByTestId('ops-page')).toHaveClass('ops-page--wide');
    expect(screen.queryByRole('heading', { level: 2, name: 'Communication oversight' })).not.toBeInTheDocument();
    expect(pageSource).not.toMatch(/max-w-7xl|bg-white border border-gray-200 rounded-xl|#81887A|text-amber|uppercase tracking-wide/);
    expect(pageSource).toContain('Email delivery evidence (read-only).');
    expect(pageSource).toContain('opsReadAPI.communicationsOversight()');
  });

  it('reads communicationsOversight with no params and no polling', async () => {
    renderPage();
    await waitFor(() => {
      expect(opsReadAPI.communicationsOversight).toHaveBeenCalled();
    });
    expect(opsReadAPI.communicationsOversight).toHaveBeenCalledWith();
    expect(opsReadAPI.communicationsOversight.mock.calls[0]).toEqual([]);
    expect(pageSource).not.toMatch(/setInterval|setTimeout|addEventListener\(['"]visibilitychange/);
  });

  it('renders existing metrics, worker labels, health text, and events', async () => {
    opsReadAPI.communicationsOversight.mockResolvedValue(
      payload({
        recent: [
          eventRow(),
          eventRow({
            eventId: 'mail-2',
            type: 'Bounce',
            recipient: 'very.long.guest.address+alias@example-domain-that-must-wrap.test',
            bookingId: '507f1f77bcf86cd799439012',
            happenedAt: '2026-08-01T07:00:00.000Z'
          })
        ]
      })
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Failed events').nextElementSibling).toHaveTextContent('3');
    });
    expect(screen.getByText('Total recent').nextElementSibling).toHaveTextContent('2');
    expect(screen.getByText('Gaps possible').nextElementSibling).toHaveTextContent('Yes');
    expect(screen.getByText('SMTP configured').nextElementSibling).toHaveTextContent('Yes');
    expect(screen.getByText('Worker').nextElementSibling).toHaveTextContent('Running');
    expect(screen.getByText('Overdue pending').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Failed / ambiguous').nextElementSibling).toHaveTextContent('3');
    expect(screen.getByText('Health: ok · workerId worker-1')).toBeInTheDocument();
    expect(screen.getByText('Degraded: email tracking gaps may exist.')).toBeInTheDocument();
    expect(
      screen.getByText('Unhealthy: overdue booking confirmation states are waiting for the confirmation worker.')
    ).toBeInTheDocument();
    expect(screen.getByText('Delivery')).toBeInTheDocument();
    expect(screen.getByText(/to: guest@example.com/)).toBeInTheDocument();
    expect(screen.getByText('2026-09-20')).toBeInTheDocument();
    expect(screen.getByText('2026-08-01')).toBeInTheDocument();
  });

  it('keeps zero metrics as zero and worker fallback labels', async () => {
    opsReadAPI.communicationsOversight.mockResolvedValue(
      payload({
        summary: {
          failedEvents: 0,
          totalRecentEvents: 0,
          confirmationPendingDue: 0,
          confirmationFailed: 0,
          confirmationAmbiguous: 0
        },
        confirmationDelivery: delivery({
          smtpConfigured: false,
          workerEnabled: true,
          workerRunning: false,
          deliveryHealth: 'worker_enabled_but_not_running',
          worker: {}
        }),
        recent: [],
        degraded: {
          eventTrackingGapsPossible: false,
          overdueConfirmationBacklog: false
        }
      })
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Failed events').nextElementSibling).toHaveTextContent('0');
    });
    expect(screen.getByText('Total recent').nextElementSibling).toHaveTextContent('0');
    expect(screen.getByText('Gaps possible').nextElementSibling).toHaveTextContent('No');
    expect(screen.getByText('SMTP configured').nextElementSibling).toHaveTextContent('No');
    expect(screen.getByText('Worker').nextElementSibling).toHaveTextContent('Enabled (not running)');
    expect(screen.getByText('Overdue pending').nextElementSibling).toHaveTextContent('0');
    expect(screen.getByText('Failed / ambiguous').nextElementSibling).toHaveTextContent('0');
    expect(screen.getByText('Health: worker_enabled_but_not_running')).toBeInTheDocument();
    expect(screen.queryByText('Degraded: email tracking gaps may exist.')).not.toBeInTheDocument();
    expect(screen.getByText('No recent events.')).toBeInTheDocument();
  });

  it('shows Disabled when the confirmation worker is not enabled', async () => {
    opsReadAPI.communicationsOversight.mockResolvedValue(
      payload({
        confirmationDelivery: delivery({
          workerEnabled: false,
          workerRunning: false,
          deliveryHealth: 'worker_disabled'
        }),
        degraded: { eventTrackingGapsPossible: true, overdueConfirmationBacklog: false }
      })
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Worker').nextElementSibling).toHaveTextContent('Disabled');
    });
  });

  it('shows loading inside the page while the header stays visible', async () => {
    let resolveLoad;
    opsReadAPI.communicationsOversight.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        })
    );
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Communications' })).toBeInTheDocument();
    expect(screen.getByText('Loading communication oversight')).toBeInTheDocument();
    resolveLoad(payload());
    await waitFor(() => {
      expect(screen.getByText('Failed events')).toBeInTheDocument();
    });
  });

  it('shows the existing error in a banner and does not invent retry chrome', async () => {
    opsReadAPI.communicationsOversight.mockRejectedValue({
      response: { data: { message: 'Communications service unavailable' } }
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Communications service unavailable')).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Communications' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it('shows the existing missing-data copy', async () => {
    opsReadAPI.communicationsOversight.mockResolvedValue({ data: {} });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No communication data.')).toBeInTheDocument();
    });
  });
});
