import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpsSessionProvider } from '../../context/OpsSessionContext';
import { OpsAppearanceProvider } from '../../ops/appearance/OpsAppearanceProvider';
import OpsBuildEnquiries from './OpsBuildEnquiries';

vi.mock('../../services/opsApi', () => ({
  opsReadAPI: {
    buildEnquiries: vi.fn()
  }
}));

import { opsReadAPI } from '../../services/opsApi';

const here = path.dirname(fileURLToPath(import.meta.url));
const pageSource = fs.readFileSync(path.join(here, 'OpsBuildEnquiries.jsx'), 'utf8');
const cssSource = fs.readFileSync(path.join(here, 'OpsBuildEnquiries.css'), 'utf8');

const adminSession = {
  authenticated: true,
  actorId: 'admin-1',
  role: 'admin',
  modules: ['*'],
  actions: [],
  defaultRoute: '/ops',
  locale: 'en'
};

function row(overrides = {}) {
  return {
    id: 'be-1',
    projectReference: 'BD-20261026-ABCDEF123456',
    status: 'new',
    customerName: 'Ada Lovelace',
    customerEmail: 'ada@example.com',
    modelId: 'lux-cabin',
    modelLabel: 'The Lux Cabin',
    estimateDisplayLabel: '€39,200',
    estimateTotalEur: 39200,
    createdAt: '2026-10-26T10:00:00.000Z',
    emailAttention: { hasNeedsManual: false, hasFailed: false, hasPending: false },
    ...overrides
  };
}

function payload(items, pagination = { page: 1, limit: 20, total: items.length, totalPages: 1 }) {
  return { data: { data: { items, pagination } } };
}

function renderPage(initial = '/ops/build-enquiries') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <OpsAppearanceProvider>
        <OpsSessionProvider session={adminSession}>
          <Routes>
            <Route path="/ops/build-enquiries" element={<OpsBuildEnquiries />} />
          </Routes>
        </OpsSessionProvider>
      </OpsAppearanceProvider>
    </MemoryRouter>
  );
}

describe('OpsBuildEnquiries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    opsReadAPI.buildEnquiries.mockResolvedValue(payload([row()]));
  });

  afterEach(() => {
    cleanup();
  });

  it('uses OpsPage wide and Ops primitives without max-w-7xl cards', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Build enquiries' })).toBeInTheDocument();
    });
    expect(screen.getByTestId('ops-build-enquiries')).toHaveAttribute('data-ops-page-width', 'wide');
    expect(pageSource).not.toMatch(/max-w-7xl|bg-white border border-gray-200 rounded-xl/);
    expect(pageSource).toContain('OpsTable');
    expect(pageSource).toContain('OpsCollectionRow');
  });

  it('shows unfiltered empty state', async () => {
    opsReadAPI.buildEnquiries.mockResolvedValue(payload([]));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No build enquiries yet')).toBeInTheDocument();
    });
    expect(screen.getByText('No build enquiries yet').closest('[data-ops-empty-variant]')).toHaveAttribute(
      'data-ops-empty-variant',
      'empty'
    );
  });

  it('shows filtered empty state', async () => {
    opsReadAPI.buildEnquiries.mockResolvedValue(payload([]));
    renderPage('/ops/build-enquiries?status=closed&q=zzz');
    await waitFor(() => {
      expect(screen.getByText('No matching enquiries')).toBeInTheDocument();
    });
    expect(screen.getByText('No matching enquiries').closest('[data-ops-empty-variant]')).toHaveAttribute(
      'data-ops-empty-variant',
      'filtered'
    );
  });

  it('highlights needs_manual and failed email attention in list', async () => {
    opsReadAPI.buildEnquiries.mockResolvedValue(
      payload([
        row({
          id: 'be-manual',
          projectReference: 'BD-MANUAL-1',
          emailAttention: { hasNeedsManual: true, hasFailed: false, hasPending: false }
        }),
        row({
          id: 'be-failed',
          projectReference: 'BD-FAILED-1',
          emailAttention: { hasNeedsManual: false, hasFailed: true, hasPending: false }
        })
      ])
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText('Needs manual email').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Email failed').length).toBeGreaterThan(0);
  });

  it('renders mobile collection and desktop table markup with responsive CSS', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('ops-build-enquiries-mobile')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ops-build-enquiries-table')).toBeInTheDocument();
    expect(cssSource).toMatch(/\.ops-be-mobile[\s\S]*display:\s*flex/);
    expect(cssSource).toMatch(/@media \(min-width: 768px\)[\s\S]*\.ops-be-mobile[\s\S]*display:\s*none/);
    expect(cssSource).toMatch(/@media \(min-width: 768px\)[\s\S]*\.ops-be-table-wrap[\s\S]*display:\s*block/);
  });

  it('requests default pagination params', async () => {
    renderPage();
    await waitFor(() => {
      expect(opsReadAPI.buildEnquiries).toHaveBeenCalled();
    });
    expect(opsReadAPI.buildEnquiries).toHaveBeenCalledWith({ page: '1', limit: '20' });
  });
});
