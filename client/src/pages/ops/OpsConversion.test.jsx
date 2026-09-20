import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpsSessionProvider } from '../../context/OpsSessionContext';
import { OpsAppearanceProvider } from '../../ops/appearance/OpsAppearanceProvider';
import OpsConversion from './OpsConversion';

vi.mock('../../services/opsApi', () => ({
  opsReadAPI: {
    insightsFilterOptions: vi.fn(),
    conversionSummary: vi.fn()
  }
}));

import { opsReadAPI } from '../../services/opsApi';

const here = path.dirname(fileURLToPath(import.meta.url));
const pageSource = fs.readFileSync(path.join(here, 'OpsConversion.jsx'), 'utf8');
const cssSource = fs.readFileSync(path.join(here, 'OpsConversion.css'), 'utf8');

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
    steps: [
      {
        eventType: 'zone_view',
        label: 'Zone view',
        sessionCount: 100,
        eventCount: 120,
        orphanEventCount: 2
      },
      {
        eventType: 'quote_shown',
        label: 'Quote shown',
        sessionCount: 40,
        eventCount: 45,
        orphanEventCount: 0
      }
    ],
    dropOff: [
      {
        from: 'zone_view',
        to: 'quote_shown',
        fromSessionCount: 100,
        continuedSessionCount: 40,
        dropOffRate: 0.6
      }
    ],
    supplementary: {
      searchResults: {
        sessionCount: 200,
        eventCount: 250,
        note: 'Search is site-wide.'
      },
      quoteFailed: {
        eventCount: 5,
        orphanEventCount: 1,
        byClass: { inventory: 3, pricing: 2 }
      },
      savedQuotes: {
        savedValidQuotes: 12,
        checkoutStartedSavedQuotes: 8,
        convertedSavedQuotes: 4,
        abandonedSavedQuotes: 3,
        recoveryEligibleJourneys: 2,
        note: 'Saved quote recovery window applies.'
      }
    },
    provenance: {
      funnelModelNote: 'Session-sequential funnel.',
      propertyKindFilterNote: 'Zone filter applied.',
      entityFilterNote: 'Cabin filter optional.',
      consentNote: 'Consent gates recovery.',
      checkoutStartedNote: 'Checkout started is counted.',
      searchResultsNote: 'Search is supplementary.'
    }
  };
}

function renderConversion(initial = '/ops/conversion') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <OpsAppearanceProvider>
        <OpsSessionProvider session={adminSession}>
          <Routes>
            <Route path="/ops/conversion" element={<OpsConversion />} />
          </Routes>
        </OpsSessionProvider>
      </OpsAppearanceProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  opsReadAPI.insightsFilterOptions.mockResolvedValue({
    data: { data: { cabins: [{ id: 'c1', name: 'Stone House' }], cabinTypes: [] } }
  });
  opsReadAPI.conversionSummary.mockResolvedValue({ data: { data: summaryPayload() } });
});

afterEach(() => {
  cleanup();
});

describe('OpsConversion migration', () => {
  it('uses OpsPage wide and OpsPageHeader with quote recovery link', async () => {
    const { from, to } = currentMonth();
    renderConversion();
    await waitFor(() => expect(screen.getByTestId('conversion-funnel-steps')).toBeInTheDocument());
    expect(screen.getByTestId('ops-page')).toHaveAttribute('data-ops-page-width', 'wide');
    expect(screen.getByRole('heading', { name: 'Conversion funnel' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Quote recovery' })).toHaveAttribute(
      'href',
      `/ops/conversion/recovery?propertyKind=cabin&from=${from}&to=${to}`
    );
  });

  it('reads conversion summary and filter options with exact default params', async () => {
    const { from, to } = currentMonth();
    renderConversion();
    await waitFor(() => expect(opsReadAPI.conversionSummary).toHaveBeenCalled());
    expect(opsReadAPI.conversionSummary).toHaveBeenCalledWith({
      propertyKind: 'cabin',
      from,
      to
    });
    expect(opsReadAPI.insightsFilterOptions).toHaveBeenCalledWith({ propertyKind: 'cabin' });
  });

  it('does not poll conversion endpoints', async () => {
    renderConversion();
    await waitFor(() => expect(opsReadAPI.conversionSummary).toHaveBeenCalled());
    const before = opsReadAPI.conversionSummary.mock.calls.length;
    await new Promise((r) => setTimeout(r, 40));
    expect(opsReadAPI.conversionSummary.mock.calls.length).toBe(before);
  });

  it('preserves funnel steps, drop-off, supplementary, and provenance signals', async () => {
    renderConversion();
    await waitFor(() => expect(screen.getByTestId('conversion-funnel-steps')).toBeInTheDocument());

    const steps = screen.getByTestId('conversion-funnel-steps');
    expect(within(steps).getByText('Zone view')).toBeInTheDocument();
    expect(within(steps).getByText('100')).toBeInTheDocument();
    expect(within(steps).getByText('120')).toBeInTheDocument();
    expect(within(steps).getByText('2')).toBeInTheDocument();

    const drop = screen.getByTestId('conversion-dropoff');
    expect(within(drop).getByText('Zone View → Quote Shown')).toBeInTheDocument();

    expect(screen.getByTestId('conversion-search-results')).toHaveTextContent('Site-wide sessions: 200');
    expect(screen.getByTestId('conversion-quote-failed')).toHaveTextContent('Failed quotes: 5');
    expect(screen.getByTestId('conversion-quote-failed')).toHaveTextContent('inventory: 3');
    expect(screen.getByTestId('conversion-saved-quotes')).toHaveTextContent('Recovery-eligible: 2');
    expect(screen.getByTestId('conversion-provenance')).toHaveTextContent('Session-sequential funnel.');
  });

  it('updates live URL filters and refetches without submit', async () => {
    renderConversion();
    await waitFor(() => expect(opsReadAPI.conversionSummary).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'The Valley' }));
    await waitFor(() =>
      expect(opsReadAPI.conversionSummary).toHaveBeenCalledWith(
        expect.objectContaining({ propertyKind: 'valley' })
      )
    );
  });

  it('rejects ranges over 180 days without calling the API', async () => {
    renderConversion('/ops/conversion?from=2026-01-01&to=2026-12-31');
    await waitFor(() =>
      expect(screen.getByText('Date range cannot exceed 180 days')).toBeInTheDocument()
    );
    expect(opsReadAPI.conversionSummary).not.toHaveBeenCalled();
  });

  it('migration source avoids legacy shell patterns', () => {
    expect(pageSource).toContain("width=\"wide\"");
    expect(pageSource).toContain('OpsPageHeader');
    expect(pageSource).toContain('OpsFilterBar');
    expect(pageSource).toContain('OpsSelect');
    expect(pageSource).not.toMatch(/window\.(confirm|alert|prompt)/);
    expect(pageSource).not.toMatch(/bg-white border border-gray-200 rounded-xl/);
    expect(cssSource).toMatch(/--ops-/);
    expect(cssSource).not.toMatch(/Playfair|font-serif/);
  });
});
