import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpsSessionProvider } from '../../context/OpsSessionContext';
import { OpsAppearanceProvider } from '../../ops/appearance/OpsAppearanceProvider';
import OpsConversionRecovery from './OpsConversionRecovery';

vi.mock('../../services/opsApi', () => ({
  opsReadAPI: {
    insightsFilterOptions: vi.fn(),
    conversionRecovery: vi.fn(),
    conversionRecoveryDetail: vi.fn(),
    conversionRecoveryPreview: vi.fn(),
    conversionRecoveryLinks: vi.fn()
  }
}));

import { opsReadAPI } from '../../services/opsApi';

const here = path.dirname(fileURLToPath(import.meta.url));
const pageSource = fs.readFileSync(path.join(here, 'OpsConversionRecovery.jsx'), 'utf8');
const cssSource = fs.readFileSync(path.join(here, 'OpsConversionRecovery.css'), 'utf8');

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

function recoveryRow(overrides = {}) {
  return {
    savedQuoteId: 'sq-1',
    status: 'checkout_started',
    propertyKind: 'cabin',
    entityType: 'cabin',
    entityId: '507f1f77bcf86cd799439011',
    locationKey: 'stone-house',
    checkIn: '2026-09-21',
    checkOut: '2026-09-24',
    quotedTotalCents: 45000,
    quotedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    expiresAt: '2026-09-25T00:00:00.000Z',
    quoteExpired: false,
    checkoutExpiresAt: '2026-09-22T00:00:00.000Z',
    checkoutExpired: false,
    consentSnapshot: {
      quoteDeliveryRequested: true,
      bookingReminderConsent: true,
      marketingConsent: false
    },
    effectiveContactPreference: {
      quoteDeliveryAllowed: true,
      bookingReminderAllowed: true,
      marketingAllowed: false,
      globallySuppressed: false
    },
    eligibilityReason: 'booking_reminder_consent',
    ...overrides
  };
}

function listPayload(rows = [recoveryRow()], pagination = {}) {
  return {
    data: {
      data: {
        rows,
        pagination: {
          page: 1,
          returned: rows.length,
          total: rows.length,
          totalBasis: 'matched',
          hasMore: false,
          ...pagination
        }
      }
    }
  };
}

function detailPayload(overrides = {}) {
  return {
    data: {
      data: {
        deliveryGates: {
          quote_delivery: { reason: 'missing_email' },
          booking_reminder: { reason: 'eligible' }
        },
        effectiveContactPreference: { globallySuppressed: false },
        deliveries: [
          {
            id: 'd1',
            messagePurpose: 'booking_reminder',
            templateKey: 'recovery',
            templateVersion: 'v1',
            status: 'blocked',
            blockedReason: 'delivery_disabled'
          }
        ],
        ...overrides
      }
    }
  };
}

function renderPage(initial = '/ops/conversion/recovery') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <OpsAppearanceProvider>
        <OpsSessionProvider session={adminSession}>
          <Routes>
            <Route path="/ops/conversion/recovery" element={<OpsConversionRecovery />} />
          </Routes>
        </OpsSessionProvider>
      </OpsAppearanceProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  opsReadAPI.insightsFilterOptions.mockResolvedValue({
    data: {
      data: {
        cabins: [{ id: 'c1', name: 'Stone House' }],
        cabinTypes: [{ id: 'ct1', name: 'A-frame' }]
      }
    }
  });
  opsReadAPI.conversionRecovery.mockResolvedValue(listPayload());
  opsReadAPI.conversionRecoveryDetail.mockResolvedValue(detailPayload());
  opsReadAPI.conversionRecoveryPreview.mockResolvedValue({
    data: {
      data: {
        subject: 'Complete your stay',
        text: 'Your quote is waiting.',
        eligibility: { reason: 'booking_reminder_consent' }
      }
    }
  });
  opsReadAPI.conversionRecoveryLinks.mockResolvedValue({
    data: {
      data: {
        preferenceIssued: true,
        preferenceUrl: 'https://example.com/pref',
        continuationIssued: true,
        continuationUrl: 'https://example.com/continue'
      }
    }
  });
});

afterEach(() => {
  cleanup();
});

describe('OpsConversionRecovery migration', () => {
  it('uses OpsPage wide, OpsPageHeader, and back link without legacy chrome', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('recovery-table')).toBeInTheDocument());
    expect(screen.getByTestId('ops-page')).toHaveAttribute('data-ops-page-width', 'wide');
    expect(screen.getByRole('heading', { level: 1, name: 'Quote recovery foundation' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to conversion funnel' })).toHaveAttribute(
      'href',
      '/ops/conversion'
    );
    expect(pageSource).not.toMatch(/max-w-7xl|bg-white border border-gray-200 rounded-xl|Playfair|#81887A/);
    expect(cssSource).not.toMatch(/#[0-9a-fA-F]{3,8}|Playfair|font-serif/);
    expect(cssSource).toMatch(/--ops-/);
  });

  it('reads filter options and recovery list with exact default params', async () => {
    const { from, to } = currentMonth();
    renderPage();
    await waitFor(() => expect(opsReadAPI.conversionRecovery).toHaveBeenCalled());
    expect(opsReadAPI.insightsFilterOptions).toHaveBeenCalledWith({ propertyKind: 'cabin' });
    expect(opsReadAPI.conversionRecovery).toHaveBeenCalledWith({
      propertyKind: 'cabin',
      from,
      to,
      page: '1',
      limit: 50
    });
  });

  it('keeps header and filters mounted during first load', async () => {
    let resolveLoad;
    opsReadAPI.conversionRecovery.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      })
    );
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Quote recovery foundation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'The Cabin' })).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(screen.getByTestId('recovery-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('recovery-table')).not.toBeInTheDocument();
    resolveLoad(listPayload());
    await waitFor(() => expect(screen.getByTestId('recovery-table')).toBeInTheDocument());
  });

  it('shows danger banner on error without fake table rows', async () => {
    opsReadAPI.conversionRecovery.mockRejectedValue({
      response: { data: { message: 'Recovery unavailable' } }
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Recovery unavailable')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'The Cabin' })).toBeInTheDocument();
    expect(screen.getByLabelText('From')).toBeInTheDocument();
    expect(screen.queryByTestId('recovery-table')).not.toBeInTheDocument();
    expect(screen.queryByText('checkout started')).not.toBeInTheDocument();
  });

  it('renders recovery row fields and empty copy', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('recovery-table')).toBeInTheDocument());
    const table = screen.getByTestId('recovery-table');
    expect(within(table).getByText('checkout started')).toBeInTheDocument();
    expect(within(table).getByText('Cabin')).toBeInTheDocument();
    expect(within(table).getByText('stone-house')).toBeInTheDocument();
    expect(within(table).getByText(/2026-09-21 → 2026-09-24/)).toBeInTheDocument();
    expect(within(table).getByText('Booking reminder consent')).toBeInTheDocument();
    expect(within(table).queryByText('booking_reminder_consent')).not.toBeInTheDocument();
    expect(within(table).getAllByText(/Q:Yes · R:Yes · M:No/).length).toBe(2);

    opsReadAPI.conversionRecovery.mockResolvedValue(listPayload([]));
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'quoted' } });
    await waitFor(() =>
      expect(screen.getByText('No saved quotes for these filters.')).toBeInTheDocument()
    );
  });

  it('updates live filters and pagination params', async () => {
    opsReadAPI.conversionRecovery.mockResolvedValue(
      listPayload([recoveryRow()], { page: 1, hasMore: true, returned: 1, total: 2 })
    );
    renderPage();
    await waitFor(() => expect(opsReadAPI.conversionRecovery).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'The Valley' }));
    await waitFor(() =>
      expect(opsReadAPI.conversionRecovery).toHaveBeenCalledWith(
        expect.objectContaining({ propertyKind: 'valley', page: '1', limit: 50 })
      )
    );

    fireEvent.change(screen.getByLabelText('Eligibility (derived)'), {
      target: { value: 'missing_email' }
    });
    await waitFor(() =>
      expect(opsReadAPI.conversionRecovery).toHaveBeenCalledWith(
        expect.objectContaining({ eligibility: 'missing_email' })
      )
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(opsReadAPI.conversionRecovery).toHaveBeenCalledWith(
        expect.objectContaining({ page: '2' })
      )
    );
  });

  it('opens detail, previews message, and generates links with exact helpers', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('recovery-table')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(screen.getByTestId('recovery-detail')).toBeInTheDocument());
    expect(opsReadAPI.conversionRecoveryDetail).toHaveBeenCalledWith('sq-1');
    const detail = screen.getByTestId('recovery-detail');
    expect(within(detail).getByText(/Send gate quote_delivery: missing_email/)).toBeInTheDocument();
    expect(within(detail).getByText(/Send gate booking_reminder: eligible/)).toBeInTheDocument();
    expect(within(detail).getByText(/booking_reminder · recovery@v1 · blocked · delivery_disabled/)).toBeInTheDocument();

    fireEvent.change(within(detail).getByLabelText('Message purpose'), {
      target: { value: 'quote_delivery' }
    });
    fireEvent.click(within(detail).getByRole('button', { name: 'Message preview' }));
    await waitFor(() =>
      expect(opsReadAPI.conversionRecoveryPreview).toHaveBeenCalledWith('sq-1', {
        messagePurpose: 'quote_delivery',
        templateVersion: 'v1'
      })
    );
    expect(within(detail).getByText('Subject: Complete your stay')).toBeInTheDocument();
    expect(within(detail).getByText('Your quote is waiting.')).toBeInTheDocument();
    expect(within(detail).getByText('Eligibility: Booking reminder consent')).toBeInTheDocument();
    expect(within(detail).queryByText(/Eligibility: booking_reminder_consent/)).not.toBeInTheDocument();

    fireEvent.click(
      within(detail).getByRole('button', { name: 'Generate preference / continuation links' })
    );
    await waitFor(() => expect(opsReadAPI.conversionRecoveryLinks).toHaveBeenCalledWith('sq-1'));
    expect(within(detail).getByText('Preference link issued: Yes')).toBeInTheDocument();
    expect(within(detail).getByText('https://example.com/pref')).toBeInTheDocument();
    expect(within(detail).getByText('Continuation link issued: Yes')).toBeInTheDocument();
    expect(within(detail).getByText('https://example.com/continue')).toBeInTheDocument();
  });

  it('shows warning banners and preserves delivery-disabled copy', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('recovery-table')).toBeInTheDocument());
    expect(
      screen.getByText(/Recovery delivery is disabled\. Previews do not send messages\. Automated sending is not enabled/)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(screen.getByTestId('recovery-detail')).toBeInTheDocument());
    expect(
      within(screen.getByTestId('recovery-detail')).getByText(
        'Recovery delivery is disabled. Previews do not send messages.'
      )
    ).toBeInTheDocument();
  });

  it('humanizes eligibility reason display without changing API/filter values', async () => {
    expect(recoveryRow().eligibilityReason).toBe('booking_reminder_consent');
    renderPage();
    await waitFor(() => expect(screen.getByTestId('recovery-table')).toBeInTheDocument());
    expect(screen.getByText('Booking reminder consent')).toBeInTheDocument();
    expect(screen.queryByText('booking_reminder_consent')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Eligibility (derived)'), {
      target: { value: 'booking_reminder_consent' }
    });
    await waitFor(() =>
      expect(opsReadAPI.conversionRecovery).toHaveBeenCalledWith(
        expect.objectContaining({ eligibility: 'booking_reminder_consent' })
      )
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(screen.getByTestId('recovery-detail')).toBeInTheDocument());
    fireEvent.click(
      within(screen.getByTestId('recovery-detail')).getByRole('button', { name: 'Message preview' })
    );
    await waitFor(() => expect(opsReadAPI.conversionRecoveryPreview).toHaveBeenCalled());
    expect(opsReadAPI.conversionRecoveryPreview).toHaveBeenCalledWith('sq-1', {
      messagePurpose: 'booking_reminder',
      templateVersion: 'v1'
    });
    expect(screen.getByText('Eligibility: Booking reminder consent')).toBeInTheDocument();
    expect(pageSource).toContain('humanizeEligibilityReason');
    expect(pageSource).toMatch(/params\.eligibility = filters\.eligibility/);
  });
});
