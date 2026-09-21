import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpsSessionProvider } from '../../context/OpsSessionContext';
import { formatMoneyFromCents } from '../../utils/formatMoney';
import OpsGiftVoucherDetail from './OpsGiftVoucherDetail';
import OpsGiftVouchers from './OpsGiftVouchers';

vi.mock('../../services/opsApi', () => ({
  opsReadAPI: {
    giftVoucherDetail: vi.fn(),
    printGiftVoucherCard: vi.fn(),
    giftVouchers: vi.fn()
  },
  opsWriteAPI: {
    resendGiftVoucher: vi.fn(),
    voidGiftVoucher: vi.fn(),
    extendGiftVoucherExpiry: vi.fn(),
    adjustGiftVoucherBalance: vi.fn(),
    updateGiftVoucherRecipientEmail: vi.fn()
  }
}));

import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';

const pageSource = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'OpsGiftVoucherDetail.jsx'),
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

function voucher(overrides = {}) {
  return {
    giftVoucherId: 'gv-1',
    code: 'DD-ACTIVE-01',
    status: 'active',
    buyerName: 'Elena Petrova with a particularly long buyer name for wrap testing',
    buyerEmail: 'elena.petrova.long-email@example.com',
    recipientName: 'Maya Dimitrova',
    recipientEmail: 'maya.recipient.long@example.com',
    deliveryMode: 'postal',
    deliveryOption: 'physical_card',
    deliveryOptionLabel: 'Physical card',
    cardTemplateLabel: 'Winter lodge',
    cardOccasion: 'Christmas',
    cardLocale: 'en',
    deliveryDate: '2026-12-20T00:00:00.000Z',
    sentAt: '2026-09-01T10:15:00.000Z',
    recipientCardSent: true,
    hasCardAccessToken: true,
    physicalCardFeeCents: 900,
    stripePaymentIntentId: 'pi_long_operational_payment_reference_value',
    expiresAt: '2027-09-01T10:15:00.000Z',
    attribution: { referralCode: 'CREATOR-LONG-CODE' },
    deliveryAddress: {
      addressLine1: '12 Very Long Mountain Road',
      addressLine2: 'Cabin annex',
      city: 'Smolyan',
      postalCode: '4700',
      country: 'BG'
    },
    balanceRemainingCents: 8000,
    amountOriginalCents: 10000,
    currency: 'EUR',
    ...overrides
  };
}

function detailPayload(overrides = {}) {
  const { voucher: voucherOverrides, events, redemptions, manualReviewItems, ...rest } = overrides;
  return {
    data: {
      data: {
        voucher: voucher({ ...voucherOverrides }),
        events: events || [
          {
            giftVoucherEventId: 'evt-1',
            type: 'activated',
            note: 'Issued after payment',
            actor: 'system',
            createdAt: '2026-09-01T10:16:00.000Z',
            previousBalanceCents: 0,
            newBalanceCents: 10000,
            deltaCents: 10000
          }
        ],
        redemptions: redemptions || [
          {
            giftVoucherRedemptionId: 'red-1',
            status: 'confirmed',
            amountAppliedCents: 2000,
            bookingId: 'booking-1'
          }
        ],
        manualReviewItems: manualReviewItems || [
          {
            manualReviewItemId: 'mri-1',
            category: 'gift_voucher',
            title: 'Balance mismatch check',
            status: 'open',
            severity: 'medium'
          }
        ],
        ...rest
      }
    }
  };
}

function collectionPayload() {
  return {
    data: {
      data: {
        items: [
          {
            giftVoucherId: 'gv-1',
            code: 'DD-ACTIVE-01',
            status: 'active',
            buyerName: 'Elena Petrova',
            buyerEmail: 'elena@example.com',
            recipientName: 'Maya Dimitrova',
            recipientEmail: 'maya@example.com',
            deliveryMode: 'email',
            balanceRemainingCents: 8000,
            amountOriginalCents: 10000,
            currency: 'EUR'
          }
        ],
        pagination: { page: 1, totalPages: 1 }
      }
    }
  };
}

function renderDetail(initialPath = '/ops/gift-vouchers/gv-1') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <OpsSessionProvider session={adminSession}>
        <Routes>
          <Route path="/ops/gift-vouchers" element={<OpsGiftVouchers />} />
          <Route path="/ops/gift-vouchers/:id" element={<OpsGiftVoucherDetail />} />
        </Routes>
      </OpsSessionProvider>
    </MemoryRouter>
  );
}

describe('OpsGiftVoucherDetail migration', () => {
  beforeEach(() => {
    opsReadAPI.giftVoucherDetail.mockReset();
    opsReadAPI.printGiftVoucherCard.mockReset();
    opsReadAPI.giftVouchers.mockReset();
    opsWriteAPI.resendGiftVoucher.mockReset();
    opsWriteAPI.voidGiftVoucher.mockReset();
    opsWriteAPI.extendGiftVoucherExpiry.mockReset();
    opsWriteAPI.adjustGiftVoucherBalance.mockReset();
    opsWriteAPI.updateGiftVoucherRecipientEmail.mockReset();
    opsReadAPI.giftVoucherDetail.mockResolvedValue(detailPayload());
    opsReadAPI.giftVouchers.mockResolvedValue(collectionPayload());
    opsWriteAPI.resendGiftVoucher.mockResolvedValue({ data: { success: true } });
    opsWriteAPI.voidGiftVoucher.mockResolvedValue({ data: { success: true } });
    opsWriteAPI.extendGiftVoucherExpiry.mockResolvedValue({ data: { success: true } });
    opsWriteAPI.adjustGiftVoucherBalance.mockResolvedValue({ data: { success: true } });
    opsWriteAPI.updateGiftVoucherRecipientEmail.mockResolvedValue({ data: { success: true } });
    opsReadAPI.printGiftVoucherCard.mockResolvedValue({ data: '<html>card</html>' });
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn(() => 'blob:print-card'),
        revokeObjectURL: vi.fn()
      })
    );
    vi.stubGlobal('open', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('uses OpsPage wide width and product identity instead of a card pile', async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'DD-ACTIVE-01' })).toBeInTheDocument();
    });
    expect(screen.getByTestId('ops-page')).toHaveAttribute('data-ops-page-width', 'wide');
    expect(screen.getByTestId('ops-page')).toHaveClass('ops-page--wide');
    expect(pageSource).not.toMatch(/max-w-7xl|max-w-4xl|max-w-5xl|bg-white border border-gray-200 rounded-xl/);
    expect(pageSource).not.toMatch(/navigate\(-1\)|#81887A|window\.confirm/);
  });

  it('reads giftVoucherDetail with the route id', async () => {
    renderDetail('/ops/gift-vouchers/gv-route-9');
    await waitFor(() => {
      expect(opsReadAPI.giftVoucherDetail).toHaveBeenCalledWith('gv-route-9');
    });
  });

  it('renders displayed voucher fields, money, and canonical status', async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'DD-ACTIVE-01' })).toBeInTheDocument();
    });
    expect(screen.getByText('Active', { selector: '[data-ops-status-key]' })).toHaveAttribute(
      'data-ops-status-key',
      'voucher.active'
    );
    expect(screen.getByText('DD-ACTIVE-01', { selector: '.ops-gv-detail__fact-value' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Elena Petrova with a particularly long buyer name for wrap testing (elena.petrova.long-email@example.com)'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('Maya Dimitrova (maya.recipient.long@example.com)')).toBeInTheDocument();
    expect(screen.getByText('postal')).toBeInTheDocument();
    expect(screen.getByText('Physical card')).toBeInTheDocument();
    expect(screen.getByText('Winter lodge')).toBeInTheDocument();
    expect(screen.getByText('Christmas')).toBeInTheDocument();
    expect(screen.getByText('EN')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('Active', { selector: '.ops-gv-detail__fact-value' })).toBeInTheDocument();
    expect(screen.getByText(formatMoneyFromCents(900, 'EUR'))).toBeInTheDocument();
    expect(screen.getByText('pi_long_operational_payment_reference_value')).toBeInTheDocument();
    expect(screen.getByText('CREATOR-LONG-CODE')).toBeInTheDocument();
    expect(screen.getByText('12 Very Long Mountain Road')).toBeInTheDocument();
    expect(screen.getByText('Cabin annex')).toBeInTheDocument();
    expect(screen.getByText(/Smolyan 4700/)).toBeInTheDocument();
    expect(screen.getByText('BG')).toBeInTheDocument();
    expect(
      screen.getByText(
        `${formatMoneyFromCents(8000, 'EUR')} / ${formatMoneyFromCents(10000, 'EUR')}`
      )
    ).toBeInTheDocument();
    expect(screen.getByText('activated')).toBeInTheDocument();
    expect(screen.getByText('Issued after payment · system')).toBeInTheDocument();
    expect(screen.getByText(`confirmed · ${formatMoneyFromCents(2000, 'EUR')}`)).toBeInTheDocument();
    expect(screen.getByText('Booking: booking-1')).toBeInTheDocument();
    expect(screen.getByText('gift_voucher')).toBeInTheDocument();
    expect(screen.getByText('Balance mismatch check')).toBeInTheDocument();
    expect(screen.getByText('open · medium')).toBeInTheDocument();
  });

  it('falls back to Code pending and Pending when the voucher has no code', async () => {
    opsReadAPI.giftVoucherDetail.mockResolvedValue(
      detailPayload({ voucher: { code: null, status: 'refunded', deliveryMode: 'email', physicalCardFeeCents: 0 } })
    );
    renderDetail();
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Code pending' })).toBeInTheDocument();
    });
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Refunded')).toHaveAttribute('data-ops-status-key', 'voucher.refunded');
    expect(screen.queryByText('Physical card fee')).not.toBeInTheDocument();
  });

  it('navigates back to the collection route without using history', async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Gift vouchers' })).toHaveAttribute('href', '/ops/gift-vouchers');
    });
    fireEvent.click(screen.getByRole('link', { name: 'Gift vouchers' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Gift vouchers' })).toBeInTheDocument();
    });
  });

  it('keeps print, resend, void, extend, adjust, and update-email actions with the same payloads', async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Print card' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Print card' }));
    await waitFor(() => {
      expect(opsReadAPI.printGiftVoucherCard).toHaveBeenCalledWith('gv-1');
    });
    expect(window.open).toHaveBeenCalledWith('blob:print-card', '_blank', 'noopener,noreferrer');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Print card' })).toBeEnabled();
    });

    fireEvent.change(screen.getByLabelText('Override recipient email'), {
      target: { value: 'other@example.com' }
    });
    fireEvent.change(screen.getAllByLabelText(/^Note/)[0], { target: { value: 'please resend' } });
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
    await waitFor(() => {
      expect(opsWriteAPI.resendGiftVoucher).toHaveBeenCalled();
    });
    expect(opsWriteAPI.resendGiftVoucher.mock.calls[0][0]).toBe('gv-1');
    expect(opsWriteAPI.resendGiftVoucher.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        recipientOverride: 'other@example.com',
        note: 'please resend'
      })
    );
    expect(opsWriteAPI.resendGiftVoucher.mock.calls[0][1].idempotencyKey).toMatch(/^ops_gv_/);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Void' })).toBeEnabled();
    });

    fireEvent.change(screen.getAllByLabelText(/^Reason/)[0], { target: { value: 'guest request' } });
    fireEvent.change(screen.getAllByLabelText(/^Note/)[0], { target: { value: 'void note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Void' }));
    await waitFor(() => {
      expect(opsWriteAPI.voidGiftVoucher).toHaveBeenCalledWith(
        'gv-1',
        expect.objectContaining({ reason: 'guest request', note: 'void note' })
      );
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Extend expiry' })).toBeEnabled();
    });

    fireEvent.change(screen.getByLabelText('New expiry'), { target: { value: '2028-01-01T12:00' } });
    fireEvent.change(screen.getAllByLabelText(/^Reason/)[0], { target: { value: 'extend' } });
    fireEvent.change(screen.getAllByLabelText(/^Note/)[0], { target: { value: 'extend note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Extend expiry' }));
    await waitFor(() => {
      expect(opsWriteAPI.extendGiftVoucherExpiry).toHaveBeenCalledWith(
        'gv-1',
        expect.objectContaining({
          expiresAt: '2028-01-01T12:00',
          reason: 'extend',
          note: 'extend note'
        })
      );
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Adjust balance' })).toBeEnabled();
    });

    fireEvent.change(screen.getByLabelText('Delta cents'), { target: { value: '-500' } });
    fireEvent.change(screen.getAllByLabelText(/^Reason/)[0], { target: { value: 'adjust' } });
    fireEvent.change(screen.getAllByLabelText(/^Note/)[0], { target: { value: 'adjust note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adjust balance' }));
    await waitFor(() => {
      expect(opsWriteAPI.adjustGiftVoucherBalance).toHaveBeenCalledWith(
        'gv-1',
        expect.objectContaining({
          deltaCents: -500,
          reason: 'adjust',
          note: 'adjust note'
        })
      );
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Update recipient email' })).toBeEnabled();
    });

    fireEvent.change(screen.getByLabelText('Recipient email'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getAllByLabelText(/^Note/)[0], { target: { value: 'email note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update recipient email' }));
    await waitFor(() => {
      expect(opsWriteAPI.updateGiftVoucherRecipientEmail).toHaveBeenCalledWith(
        'gv-1',
        expect.objectContaining({
          recipientEmail: 'new@example.com',
          note: 'email note'
        })
      );
    });

    expect(opsReadAPI.giftVoucherDetail.mock.calls.length).toBeGreaterThan(1);
  });

  it('disables only the busy action and shows the existing action error', async () => {
    let resolveResend;
    opsWriteAPI.resendGiftVoucher.mockReturnValue(
      new Promise((resolve) => {
        resolveResend = resolve;
      })
    );
    renderDetail();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Resend' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
    expect(screen.getByRole('button', { name: 'Sending...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Void' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Print card' })).toBeEnabled();
    resolveResend({ data: { success: true } });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Resend' })).toBeEnabled();
    });

    opsWriteAPI.voidGiftVoucher.mockRejectedValue({ response: { data: { message: 'Cannot void voucher' } } });
    fireEvent.click(screen.getByRole('button', { name: 'Void' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Cannot void voucher');
    });
  });

  it('keeps the canonical layout while loading and preserves the load error message', async () => {
    let resolveLoad;
    opsReadAPI.giftVoucherDetail.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      })
    );
    renderDetail();
    expect(screen.getByTestId('ops-page')).toHaveAttribute('data-ops-page-width', 'wide');
    expect(screen.getByRole('link', { name: 'Gift vouchers' })).toHaveAttribute('href', '/ops/gift-vouchers');
    expect(screen.getByRole('status')).toHaveTextContent('Loading voucher detail...');
    resolveLoad(detailPayload());
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'DD-ACTIVE-01' })).toBeInTheDocument();
    });
  });

  it('shows the API error on the canonical page and a not-found empty state', async () => {
    opsReadAPI.giftVoucherDetail.mockRejectedValue({
      response: { data: { message: 'Gift voucher detail unavailable' } }
    });
    renderDetail();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Gift voucher detail unavailable');
    });
    expect(screen.getByRole('link', { name: 'Gift vouchers' })).toBeInTheDocument();

    cleanup();
    opsReadAPI.giftVoucherDetail.mockResolvedValue({ data: { data: null } });
    renderDetail();
    await waitFor(() => {
      expect(screen.getByText('Voucher not found.')).toBeInTheDocument();
    });
  });

  it('lands from the collection and returns via the canonical back control', async () => {
    renderDetail('/ops/gift-vouchers');
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /DD-ACTIVE-01/ })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('link', { name: /DD-ACTIVE-01/ }));
    await waitFor(() => {
      expect(opsReadAPI.giftVoucherDetail).toHaveBeenCalledWith('gv-1');
      expect(screen.getByRole('heading', { level: 1, name: 'DD-ACTIVE-01' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('link', { name: 'Gift vouchers' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Gift vouchers' })).toBeInTheDocument();
    });
  });

  it('does not add confirm dialogs or extra APIs', () => {
    expect(pageSource).toContain('opsReadAPI.giftVoucherDetail(id)');
    expect(pageSource).toContain('opsReadAPI.printGiftVoucherCard(voucher.giftVoucherId)');
    expect(pageSource).toContain('opsWriteAPI.resendGiftVoucher');
    expect(pageSource).toContain('opsWriteAPI.voidGiftVoucher');
    expect(pageSource).toContain('opsWriteAPI.extendGiftVoucherExpiry');
    expect(pageSource).toContain('opsWriteAPI.adjustGiftVoucherBalance');
    expect(pageSource).toContain('opsWriteAPI.updateGiftVoucherRecipientEmail');
    expect(pageSource).not.toMatch(/OpsConfirmDialog|window\.confirm|window\.prompt|window\.alert/);
    expect(pageSource.match(/opsReadAPI\.[A-Za-z]+/g)).toEqual([
      'opsReadAPI.giftVoucherDetail',
      'opsReadAPI.printGiftVoucherCard'
    ]);
  });
});
