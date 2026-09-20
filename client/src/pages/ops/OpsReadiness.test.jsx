import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpsSessionProvider } from '../../context/OpsSessionContext';
import { OpsAppearanceProvider } from '../../ops/appearance/OpsAppearanceProvider';
import OpsReadiness from './OpsReadiness';

vi.mock('../../services/opsApi', () => ({
  opsReadAPI: {
    readinessModules: vi.fn(),
    readinessQa: vi.fn()
  }
}));

import { opsReadAPI } from '../../services/opsApi';

const here = path.dirname(fileURLToPath(import.meta.url));
const pageSource = fs.readFileSync(path.join(here, 'OpsReadiness.jsx'), 'utf8');
const cssSource = fs.readFileSync(path.join(here, 'OpsReadiness.css'), 'utf8');

const adminSession = {
  authenticated: true,
  actorId: 'admin-1',
  role: 'admin',
  modules: ['*'],
  actions: [],
  defaultRoute: '/ops',
  locale: 'en'
};

function modulesPayload() {
  return {
    reservations: {
      readiness: {
        verdict: 'ready_for_primary_use',
        blockingErrorCount: 0,
        overlapStatus: 'ops_primary'
      },
      parity: {
        mismatchCount: 0,
        criticalMismatchCount: 0,
        nonCriticalMismatchCount: 0
      },
      evidence: { hasEvidence: true },
      blockingIssues: [],
      manualReviewLinkage: {
        relevantCategories: ['reservation_parity'],
        openManualReviewCount: 0
      },
      cutover: {
        opsPrimary: true,
        adminWriteOverlapStatus: 'cut_over',
        rollbackAvailable: true
      }
    },
    payments: {
      readiness: {
        verdict: 'conditionally_ready',
        blockingErrorCount: 1,
        overlapStatus: 'shared'
      },
      parity: {
        mismatchCount: 2,
        criticalMismatchCount: 1,
        nonCriticalMismatchCount: 1
      },
      evidence: { hasEvidence: true },
      blockingIssues: ['Stripe webhook lag on refunds'],
      cutover: {
        opsPrimary: false,
        adminWriteOverlapStatus: 'target_for_cutover',
        rollbackAvailable: false
      }
    },
    sync: {
      readiness: {
        verdict: 'not_ready',
        blockingErrorCount: 3,
        overlapStatus: 'admin_primary'
      },
      parity: {
        mismatchCount: 4,
        criticalMismatchCount: 2,
        nonCriticalMismatchCount: 2
      },
      evidence: { hasEvidence: false },
      blockingIssues: ['iCal pull failures', 'Missing channel mapping'],
      cutover: {
        opsPrimary: false,
        adminWriteOverlapStatus: 'target_for_cutover',
        rollbackAvailable: false
      }
    },
    cleaning: {
      readiness: {
        verdict: 'ready_for_restricted_cutover',
        blockingErrorCount: 0,
        overlapStatus: 'restricted'
      },
      parity: {
        mismatchCount: 1,
        criticalMismatchCount: 0,
        nonCriticalMismatchCount: 1
      },
      evidence: { hasEvidence: true },
      blockingIssues: [],
      cutover: {
        opsPrimary: false,
        adminWriteOverlapStatus: 'target_for_cutover',
        rollbackAvailable: true
      }
    }
  };
}

function qaPayload() {
  return {
    qaSmoke: {
      reservations_list: { ok: true },
      payments_ledger: { ok: false, error: 'timeout' }
    }
  };
}

function renderReadiness() {
  return render(
    <MemoryRouter initialEntries={['/ops/readiness']}>
      <OpsAppearanceProvider>
        <OpsSessionProvider session={adminSession}>
          <Routes>
            <Route path="/ops/readiness" element={<OpsReadiness />} />
          </Routes>
        </OpsSessionProvider>
      </OpsAppearanceProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  opsReadAPI.readinessModules.mockResolvedValue({ data: { data: modulesPayload() } });
  opsReadAPI.readinessQa.mockResolvedValue({ data: { data: qaPayload() } });
});

afterEach(() => {
  cleanup();
});

describe('OpsReadiness migration', () => {
  it('uses OpsPage wide and OpsPageHeader with dashboard/manual-review links', async () => {
    renderReadiness();
    await waitFor(() => expect(screen.getByTestId('readiness-modules')).toBeInTheDocument());
    expect(screen.getByTestId('ops-page')).toHaveAttribute('data-ops-page-width', 'wide');
    expect(screen.getByRole('heading', { name: 'Cutover readiness' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/ops');
    expect(screen.getByRole('link', { name: 'Manual review' })).toHaveAttribute(
      'href',
      '/ops/manual-review'
    );
  });

  it('loads modules and QA in parallel with no polling', async () => {
    renderReadiness();
    await waitFor(() => expect(opsReadAPI.readinessModules).toHaveBeenCalled());
    expect(opsReadAPI.readinessQa).toHaveBeenCalled();
    const before = opsReadAPI.readinessModules.mock.calls.length;
    await new Promise((r) => setTimeout(r, 40));
    expect(opsReadAPI.readinessModules.mock.calls.length).toBe(before);
  });

  it('maps all four readiness verdicts to canonical OpsStatus labels', async () => {
    renderReadiness();
    await waitFor(() => expect(screen.getByTestId('readiness-module-reservations')).toBeInTheDocument());
    expect(screen.getByText('Ready for primary use')).toBeInTheDocument();
    expect(screen.getByText('Conditionally ready')).toBeInTheDocument();
    expect(screen.getByText('Not ready')).toBeInTheDocument();
    expect(screen.getByText('Ready for restricted cutover')).toBeInTheDocument();
  });

  it('preserves module signals: overlap, parity, issues, linkage, rollback, QA', async () => {
    renderReadiness();
    await waitFor(() => expect(screen.getByTestId('readiness-modules')).toBeInTheDocument());

    const reservations = screen.getByTestId('readiness-module-reservations');
    expect(within(reservations).getByText(/Overlap status: ops_primary/)).toBeInTheDocument();
    expect(within(reservations).getByText(/opsPrimary=yes/)).toBeInTheDocument();
    expect(within(reservations).getByText(/Open manual review count \(module\): 0/)).toBeInTheDocument();
    expect(within(reservations).getByText('Available')).toBeInTheDocument();

    const payments = screen.getByTestId('readiness-module-payments');
    expect(within(payments).getByText('Stripe webhook lag on refunds')).toBeInTheDocument();
    expect(within(payments).getByText(/mismatches: 2/)).toBeInTheDocument();
    expect(within(payments).getByText('Not available')).toBeInTheDocument();

    const sync = screen.getByTestId('readiness-module-sync');
    expect(within(sync).getByText(/Evidence: insufficient/)).toBeInTheDocument();
    expect(within(sync).getByText('iCal pull failures')).toBeInTheDocument();

    const qa = screen.getByTestId('readiness-qa');
    expect(within(qa).getByText('reservations_list')).toBeInTheDocument();
    expect(within(qa).getByText('PASS')).toBeInTheDocument();
    expect(within(qa).getByText(/FAIL: timeout/)).toBeInTheDocument();
  });

  it('shows API error banner', async () => {
    opsReadAPI.readinessModules.mockRejectedValue({
      response: { data: { message: 'Readiness forbidden' } }
    });
    renderReadiness();
    await waitFor(() => expect(screen.getByText('Readiness forbidden')).toBeInTheDocument());
  });

  it('migration source avoids legacy shell patterns', () => {
    expect(pageSource).toContain("width=\"wide\"");
    expect(pageSource).toContain('OpsPageHeader');
    expect(pageSource).toContain('readiness.ready');
    expect(pageSource).toContain('readiness.restricted');
    expect(pageSource).toContain('readiness.conditional');
    expect(pageSource).toContain('readiness.not_ready');
    expect(pageSource).not.toMatch(/window\.(confirm|alert|prompt)/);
    expect(pageSource).not.toMatch(/bg-white border border-gray-200 rounded-xl/);
    expect(cssSource).toMatch(/--ops-/);
    expect(cssSource).not.toMatch(/Playfair|font-serif/);
  });
});
