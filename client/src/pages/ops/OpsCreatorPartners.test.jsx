import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpsSessionProvider } from '../../context/OpsSessionContext';
import { resetOpsOverlayRuntime } from '../../ops/primitives/opsOverlay';
import OpsCreatorPartners from './OpsCreatorPartners';

vi.mock('../../services/opsApi', () => ({
  opsReadAPI: {
    creatorPartners: vi.fn(),
    creatorPartnerStats: vi.fn(),
    creatorPartnerStatsById: vi.fn(),
    creatorPartnerBookings: vi.fn(),
    creatorPartnerCommission: vi.fn()
  },
  opsWriteAPI: {
    createCreatorPartner: vi.fn(),
    updateCreatorPartner: vi.fn(),
    createCreatorPartnerPortalLink: vi.fn(),
    recalculateCreatorPartnerCommission: vi.fn(),
    approveCreatorCommission: vi.fn(),
    markCreatorCommissionPaid: vi.fn(),
    voidCreatorCommission: vi.fn()
  }
}));

import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';

const pageSource = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'OpsCreatorPartners.jsx'),
  'utf8'
);
const cssSource = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'OpsCreatorPartners.css'),
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

function partner(overrides = {}) {
  return {
    _id: 'cp-1',
    name: 'Valley Creator',
    slug: 'valley-creator',
    status: 'active',
    contact: { email: 'creator@example.com', phone: '+359881234567' },
    profiles: {
      instagram: 'https://instagram.com/valley',
      tiktok: '',
      youtube: '',
      website: 'https://example.com'
    },
    referral: { code: 'valley.ref', cookieDays: 60 },
    promo: { code: 'VALLEY10' },
    commission: { rateBps: 1000, basis: 'accommodation_net', eligibleAfter: 'stay_completed' },
    contentAgreement: {
      compStayOffered: true,
      deliverables: '2 Reels',
      usageRights: '12 months',
      agreedAt: '2026-01-15T10:00:00.000Z'
    },
    notes: 'Founding partner',
    ...overrides
  };
}

function partnersPayload(rows) {
  return { data: { data: { creatorPartners: rows } } };
}

function statsPayload(rows = []) {
  return { data: { data: { creatorPartnerStats: rows } } };
}

function detailStatsPayload(stats = {}) {
  return {
    data: {
      data: {
        stats: {
          visits: 12,
          uniqueVisitors: 8,
          attributedBookings: 2,
          paidConfirmedBookings: 1,
          paidStayRevenue: 400,
          attributedBookingValue: 500,
          stayBookingRevenueCents: 40000,
          giftVoucherPurchases: 1,
          giftVoucherRevenueCents: 10000,
          stayBookingCommissionCents: 4000,
          giftVoucherCommissionCents: 1000,
          totalCommissionCents: 5000,
          commissionableRevenueEstimate: 400,
          conversionRate: 0.25,
          lastVisitAt: '2026-03-01T12:00:00.000Z',
          lastBookingAt: '2026-03-02T12:00:00.000Z',
          cancelledRefundedVoidBookings: 0,
          ...stats
        }
      }
    }
  };
}

function bookingsPayload(bookings = []) {
  return { data: { data: { bookings } } };
}

function commissionPayload(entries = []) {
  return { data: { data: { entries } } };
}

function list() {
  return document.querySelector('.ops-creator-partners-list');
}

function renderPage() {
  return render(
    <div className="ops-root" data-ops-appearance="light" data-ops-themed="true">
      <OpsSessionProvider session={adminSession}>
        <OpsCreatorPartners />
      </OpsSessionProvider>
    </div>
  );
}

describe('OpsCreatorPartners migration', () => {
  beforeEach(() => {
    opsReadAPI.creatorPartners.mockReset();
    opsReadAPI.creatorPartnerStats.mockReset();
    opsReadAPI.creatorPartnerStatsById.mockReset();
    opsReadAPI.creatorPartnerBookings.mockReset();
    opsReadAPI.creatorPartnerCommission.mockReset();
    opsWriteAPI.createCreatorPartner.mockReset();
    opsWriteAPI.updateCreatorPartner.mockReset();
    opsWriteAPI.createCreatorPartnerPortalLink.mockReset();
    opsWriteAPI.recalculateCreatorPartnerCommission.mockReset();
    opsWriteAPI.approveCreatorCommission.mockReset();
    opsWriteAPI.markCreatorCommissionPaid.mockReset();
    opsWriteAPI.voidCreatorCommission.mockReset();

    opsReadAPI.creatorPartners.mockResolvedValue(partnersPayload([partner()]));
    opsReadAPI.creatorPartnerStats.mockResolvedValue(
      statsPayload([
        {
          creatorPartnerId: 'cp-1',
          stats: {
            visits: 10,
            uniqueVisitors: 7,
            attributedBookings: 2,
            paidConfirmedBookings: 1,
            paidStayRevenue: 250,
            attributedBookingValue: 300,
            giftVoucherPurchases: 1,
            giftVoucherRevenueCents: 5000,
            giftVoucherCommissionCents: 500,
            commissionableRevenueEstimate: 250,
            lastVisitAt: '2026-03-01T12:00:00.000Z'
          }
        }
      ])
    );
    opsReadAPI.creatorPartnerStatsById.mockResolvedValue(detailStatsPayload());
    opsReadAPI.creatorPartnerBookings.mockResolvedValue(bookingsPayload([]));
    opsReadAPI.creatorPartnerCommission.mockResolvedValue(commissionPayload([]));
    opsWriteAPI.createCreatorPartner.mockResolvedValue({ data: { success: true, data: {} } });
    opsWriteAPI.updateCreatorPartner.mockResolvedValue({ data: { success: true, data: {} } });
    opsWriteAPI.createCreatorPartnerPortalLink.mockResolvedValue({
      data: {
        data: {
          verifyUrl: 'https://example.test/creator-portal/verify?token=abc',
          expiresAt: '2026-03-20T12:00:00.000Z'
        }
      }
    });
  });

  afterEach(() => {
    cleanup();
    resetOpsOverlayRuntime();
  });

  it('uses OpsPage wide and OpsPageHeader without legacy title card, max-w, or brand hex', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Creator partners' })).toBeInTheDocument();
    });
    expect(screen.getByTestId('ops-page')).toHaveAttribute('data-ops-page-width', 'wide');
    expect(screen.getByTestId('ops-page')).toHaveClass('ops-page--wide');
    expect(screen.getByRole('button', { name: 'Add creator' })).toBeInTheDocument();
    expect(pageSource).not.toMatch(/max-w-7xl|bg-white border border-gray-200 rounded-xl|#81887A|Playfair|font-serif|window\.confirm/);
    expect(pageSource).toContain('OpsFilterBar');
    expect(pageSource).toContain('OpsModal');
    expect(pageSource).toContain('OpsStatus');
    expect(cssSource).toMatch(/--ops-/);
    expect(cssSource).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('loads partners and stats with the same default params', async () => {
    renderPage();
    await waitFor(() => {
      expect(opsReadAPI.creatorPartners).toHaveBeenCalled();
    });
    expect(opsReadAPI.creatorPartners).toHaveBeenCalledWith({});
    expect(opsReadAPI.creatorPartnerStats).toHaveBeenCalledWith();
  });

  it('renders partner fields, metrics, and canonical partner status', async () => {
    renderPage();
    await waitFor(() => {
      expect(within(list()).getByText('Valley Creator')).toBeInTheDocument();
    });
    expect(within(list()).getByText('Active')).toHaveAttribute('data-ops-status-key', 'partner.active');
    expect(within(list()).getByText('valley.ref')).toBeInTheDocument();
    expect(within(list()).getByText('10 / 7')).toBeInTheDocument();
    expect(within(list()).getByText('2 / 1')).toBeInTheDocument();
    expect(within(list()).getByText('Visits / unique visitors')).toBeInTheDocument();
    expect(within(list()).getByText('Gift vouchers')).toBeInTheDocument();
    expect(within(list()).getByText('Projected commission (not payable)')).toBeInTheDocument();
    expect(within(list()).getByRole('button', { name: 'Details' })).toBeInTheDocument();
    expect(within(list()).getByRole('button', { name: 'Portal link' })).toBeEnabled();
    expect(within(list()).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(within(list()).getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(within(list()).getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(within(list()).getByRole('button', { name: 'Archive' })).toBeInTheDocument();
  });

  it('applies search only on Apply search, and status filter immediately', async () => {
    renderPage();
    await waitFor(() => {
      expect(opsReadAPI.creatorPartners).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'valley' } });
    await waitFor(() => {
      expect(opsReadAPI.creatorPartners).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Apply search' }));
    await waitFor(() => {
      expect(opsReadAPI.creatorPartners).toHaveBeenCalledWith({ search: 'valley' });
    });

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'paused' } });
    await waitFor(() => {
      expect(opsReadAPI.creatorPartners).toHaveBeenCalledWith({ status: 'paused', search: 'valley' });
    });
  });

  it('opens create with the same defaults and submits the exact payload', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add creator' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add creator' }));
    const dialog = await screen.findByRole('dialog', { name: 'New creator partner' });
    expect(within(dialog).getByLabelText('Name')).toHaveValue('');
    expect(within(dialog).getByLabelText('Slug')).toHaveValue('');
    expect(within(dialog).getByLabelText('Status')).toHaveValue('draft');
    expect(within(dialog).getByLabelText('Referral code')).toHaveValue('');
    expect(within(dialog).getByLabelText('Cookie days')).toHaveValue(60);
    expect(within(dialog).getByLabelText('Commission rate (%)')).toHaveValue(10);
    expect(within(dialog).getByLabelText('Commission basis')).toHaveValue('accommodation_net');
    expect(within(dialog).getByLabelText('Eligible after')).toHaveValue('stay_completed');
    expect(within(dialog).getByLabelText('Comp stay offered')).not.toBeChecked();

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: ' New Creator ' } });
    fireEvent.change(within(dialog).getByLabelText('Slug'), { target: { value: 'New_Creator' } });
    fireEvent.change(within(dialog).getByLabelText('Referral code'), { target: { value: '@New.Ref' } });
    fireEvent.change(within(dialog).getByLabelText('Commission rate (%)'), { target: { value: '12.5' } });
    fireEvent.submit(document.getElementById('ops-creator-form'));

    await waitFor(() => {
      expect(opsWriteAPI.createCreatorPartner).toHaveBeenCalled();
    });
    expect(opsWriteAPI.createCreatorPartner).toHaveBeenCalledWith({
      name: 'New Creator',
      slug: 'new_creator',
      status: 'draft',
      contact: { email: undefined, phone: undefined },
      profiles: {
        instagram: undefined,
        tiktok: undefined,
        youtube: undefined,
        website: undefined
      },
      referral: { code: 'new.ref', cookieDays: 60 },
      commission: {
        rateBps: 1250,
        basis: 'accommodation_net',
        eligibleAfter: 'stay_completed'
      },
      contentAgreement: {
        compStayOffered: false,
        deliverables: null,
        usageRights: null,
        agreedAt: null
      },
      notes: null,
      promo: { code: '' }
    });
  });

  it('initializes edit from the row and patches status without confirmation', async () => {
    renderPage();
    await waitFor(() => {
      expect(within(list()).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    });
    fireEvent.click(within(list()).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit creator partner' });
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Valley Creator');
    expect(within(dialog).getByLabelText('Slug')).toHaveValue('valley-creator');
    expect(within(dialog).getByLabelText('Referral code')).toHaveValue('valley.ref');
    expect(within(dialog).getByLabelText('Promo code (optional)')).toHaveValue('VALLEY10');
    expect(within(dialog).getByLabelText('Commission rate (%)')).toHaveValue(10);
    expect(within(dialog).getByLabelText('Comp stay offered')).toBeChecked();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Edit creator partner' })).not.toBeInTheDocument();
    });

    fireEvent.click(within(list()).getByRole('button', { name: 'Pause' }));
    await waitFor(() => {
      expect(opsWriteAPI.updateCreatorPartner).toHaveBeenCalledWith('cp-1', { status: 'paused' });
    });
    expect(pageSource).not.toMatch(/OpsConfirmDialog|window\.confirm/);
  });

  it('opens detail tabs, loads detail APIs, and maps commission void to commission.voided', async () => {
    opsReadAPI.creatorPartnerBookings.mockResolvedValue(
      bookingsPayload([
        {
          bookingId: 'bk-1',
          guestName: 'Ada',
          guestEmail: 'ada@example.com',
          cabinLabel: 'A-Frame',
          checkIn: '2026-04-01T14:00:00.000Z',
          checkOut: '2026-04-03T11:00:00.000Z',
          status: 'confirmed',
          attributionSource: 'referral',
          referralCode: 'valley.ref',
          promoCode: 'VALLEY10',
          subtotalPrice: 200,
          discountAmount: 20,
          totalPrice: 180,
          createdAt: '2026-03-01T10:00:00.000Z'
        }
      ])
    );
    opsReadAPI.creatorPartnerCommission.mockResolvedValue(
      commissionPayload([
        {
          _id: 'ce-1',
          bookingId: 'bk-1',
          source: 'stay',
          commissionableRevenueSnapshot: 180,
          currency: 'EUR',
          rateBpsSnapshot: 1000,
          amountSnapshot: 18,
          eligibilityStatus: 'eligible',
          status: 'void',
          voidReason: 'Duplicate',
          calculatedAt: '2026-03-02T10:00:00.000Z',
          approvedAt: null,
          paidAt: null
        }
      ])
    );

    renderPage();
    await waitFor(() => {
      expect(within(list()).getByRole('button', { name: 'Details' })).toBeInTheDocument();
    });
    fireEvent.click(within(list()).getByRole('button', { name: 'Details' }));
    const dialog = await screen.findByRole('dialog', { name: /Creator performance: Valley Creator/ });

    await waitFor(() => {
      expect(opsReadAPI.creatorPartnerStatsById).toHaveBeenCalledWith('cp-1');
    });
    expect(opsReadAPI.creatorPartnerBookings).toHaveBeenCalledWith('cp-1', { limit: 100 });
    expect(opsReadAPI.creatorPartnerCommission).toHaveBeenCalledWith('cp-1', { limit: 100 });

    expect(within(dialog).getByText('Performance summary')).toBeInTheDocument();
    expect(within(dialog).getByText('Tracking details')).toBeInTheDocument();
    expect(within(dialog).getByText('Content agreement / notes')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Bookings' }));
    expect(within(dialog).getByText('bk-1')).toBeInTheDocument();
    expect(within(dialog).getByText('Ada')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Commissions' }));
    expect(within(dialog).getByRole('heading', { name: 'Commission ledger' })).toBeInTheDocument();
    expect(within(dialog).getByText('Voided')).toHaveAttribute('data-ops-status-key', 'commission.voided');
    expect(within(dialog).getByText('Eligible')).toHaveAttribute('data-ops-status-key', 'commission.eligible');
    expect(
      within(dialog).getByText('Manual workflow only. These actions do not trigger Stripe or real payouts.')
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Profile' }));
    expect(within(dialog).getByText('Creator profile')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Open profile link' })).toHaveAttribute(
      'href',
      'https://example.com'
    );
  });

  it('generates a portal link via OpsModal without inventing new APIs', async () => {
    renderPage();
    await waitFor(() => {
      expect(within(list()).getByRole('button', { name: 'Portal link' })).toBeInTheDocument();
    });
    fireEvent.click(within(list()).getByRole('button', { name: 'Portal link' }));
    const dialog = await screen.findByRole('dialog', { name: 'Creator portal link' });
    await waitFor(() => {
      expect(opsWriteAPI.createCreatorPartnerPortalLink).toHaveBeenCalledWith('cp-1', {});
    });
    expect(within(dialog).getByLabelText('Portal link')).toHaveValue(
      'https://example.test/creator-portal/verify?token=abc'
    );
    expect(pageSource).toContain('opsWriteAPI.createCreatorPartnerPortalLink(row._id, {})');
  });

  it('keeps the header visible while loading and shows API errors', async () => {
    let resolvePartners;
    opsReadAPI.creatorPartners.mockReturnValue(
      new Promise((resolve) => {
        resolvePartners = resolve;
      })
    );
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Creator partners' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    resolvePartners(partnersPayload([partner()]));
    await waitFor(() => {
      expect(within(list()).getByText('Valley Creator')).toBeInTheDocument();
    });
  });

  it('shows a page error from the API message', async () => {
    opsReadAPI.creatorPartners.mockRejectedValue({
      response: { data: { message: 'Creator partners unavailable' } }
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Creator partners unavailable');
    });
  });

  it('shows the empty filter message', async () => {
    opsReadAPI.creatorPartners.mockResolvedValue(partnersPayload([]));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No creator partners match your filters.')).toBeInTheDocument();
    });
  });

  it('does not invent confirm dialogs, pagination, or unrelated APIs', () => {
    expect(pageSource).not.toMatch(/OpsConfirmDialog|window\.confirm|OpsPagination|giftVouchers|navigate\(/);
    expect(pageSource).toContain('opsReadAPI.creatorPartners(params)');
    expect(pageSource).toContain('opsReadAPI.creatorPartnerStats()');
    expect(pageSource).toContain('opsWriteAPI.createCreatorPartner(payload)');
    expect(pageSource).toContain('opsWriteAPI.updateCreatorPartner(editingId, payload)');
    expect(pageSource).toContain('opsWriteAPI.updateCreatorPartner(row._id, { status })');
    expect(pageSource).toContain("domain=\"commission\"");
    expect(pageSource).toContain("domain=\"partner\"");
  });
});
