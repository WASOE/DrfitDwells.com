import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpsSessionProvider } from '../../context/OpsSessionContext';
import { formatMoneyFromCents } from '../../utils/formatMoney';
import OpsGiftVouchers from './OpsGiftVouchers';

vi.mock('../../services/opsApi', () => ({
  opsReadAPI: {
    giftVouchers: vi.fn()
  }
}));

import { opsReadAPI } from '../../services/opsApi';

const pageSource = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'OpsGiftVouchers.jsx'), 'utf8');

const adminSession = {
  authenticated: true,
  actorId: 'admin-1',
  role: 'admin',
  modules: ['*'],
  actions: [],
  defaultRoute: '/ops',
  locale: 'en'
};

function SearchProbe() {
  const [params] = useSearchParams();
  return <div data-testid="gv-search">{params.toString()}</div>;
}

function DetailStub() {
  const { id } = useParams();
  return <div data-testid="legacy-voucher-detail">{id}</div>;
}

function voucher(overrides = {}) {
  return {
    giftVoucherId: 'gv-1',
    code: 'DD-1001',
    status: 'active',
    buyerName: 'Elena Petrova',
    buyerEmail: 'elena@example.com',
    recipientName: 'Maya Dimitrova',
    recipientEmail: 'maya@example.com',
    deliveryMode: 'email',
    balanceRemainingCents: 8000,
    amountOriginalCents: 10000,
    currency: 'EUR',
    ...overrides
  };
}

function payload(items, pagination = { page: 1, totalPages: 1 }) {
  return { data: { data: { items, pagination } } };
}

function renderPage(initialPath = '/ops/gift-vouchers') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <OpsSessionProvider session={adminSession}>
        <SearchProbe />
        <Routes>
          <Route path="/ops/gift-vouchers" element={<OpsGiftVouchers />} />
          <Route path="/ops/gift-vouchers/:id" element={<DetailStub />} />
        </Routes>
      </OpsSessionProvider>
    </MemoryRouter>
  );
}

describe('OpsGiftVouchers collection migration', () => {
  beforeEach(() => {
    opsReadAPI.giftVouchers.mockReset();
    opsReadAPI.giftVouchers.mockResolvedValue(payload([voucher()]));
  });

  afterEach(() => {
    cleanup();
  });

  it('uses OpsPage wide and OpsPageHeader without a legacy title card or max-w-7xl', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Gift vouchers' })).toBeInTheDocument();
    });
    expect(screen.getByTestId('ops-page')).toHaveAttribute('data-ops-page-width', 'wide');
    expect(screen.getByTestId('ops-page')).toHaveClass('ops-page--wide');
    expect(screen.queryByRole('heading', { level: 2, name: 'Gift vouchers' })).not.toBeInTheDocument();
    expect(pageSource).not.toMatch(/max-w-7xl|bg-white border border-gray-200 rounded-xl/);
    expect(pageSource).toContain('Operational vouchers shown by default');
  });

  it('calls giftVouchers with the same default params, including limit 20 and page 1', async () => {
    renderPage();
    await waitFor(() => {
      expect(opsReadAPI.giftVouchers).toHaveBeenCalled();
    });
    expect(opsReadAPI.giftVouchers).toHaveBeenCalledWith({ page: 1, limit: 20 });
  });

  it('sends initial URL filters unchanged and hydrates the controls', async () => {
    renderPage(
      '/ops/gift-vouchers?search=elena&status=expired&deliveryMode=postal&page=3&limit=20&includeSmoke=1'
    );
    await waitFor(() => {
      expect(opsReadAPI.giftVouchers).toHaveBeenCalled();
    });
    expect(opsReadAPI.giftVouchers).toHaveBeenCalledWith({
      page: '3',
      limit: '20',
      search: 'elena',
      status: 'expired',
      deliveryMode: 'postal',
      includeSmoke: '1'
    });
    expect(screen.getByLabelText('Search')).toHaveValue('elena');
    expect(screen.getByLabelText('Status')).toHaveValue('expired');
    expect(screen.getByLabelText('Delivery')).toHaveValue('postal');
  });

  it('updates search in the URL, resets page, and refetches with the same param name', async () => {
    renderPage('/ops/gift-vouchers?page=2');
    await waitFor(() => {
      expect(screen.getByLabelText('Search')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'DD-1001' } });
    await waitFor(() => {
      expect(screen.getByTestId('gv-search')).toHaveTextContent('search=DD-1001');
    });
    expect(screen.getByTestId('gv-search').textContent).not.toMatch(/page=/);
    await waitFor(() => {
      expect(opsReadAPI.giftVouchers).toHaveBeenLastCalledWith({
        page: 1,
        limit: 20,
        search: 'DD-1001'
      });
    });
  });

  it('preserves status select URL behavior, including abandoned checkout flags', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText('Status')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'pending_payment' } });
    await waitFor(() => {
      expect(screen.getByTestId('gv-search').textContent).toContain('status=pending_payment');
    });
    expect(screen.getByTestId('gv-search').textContent).toContain('includeAbandoned=1');
    expect(screen.getByTestId('gv-search').textContent).not.toMatch(/page=/);

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: '__all__' } });
    await waitFor(() => {
      expect(screen.getByTestId('gv-search').textContent).toContain('visibility=all');
    });
    expect(screen.getByTestId('gv-search').textContent).not.toMatch(/status=/);
    expect(screen.getByTestId('gv-search').textContent).not.toMatch(/includeAbandoned=/);

    fireEvent.change(screen.getByLabelText('Delivery'), { target: { value: 'manual' } });
    await waitFor(() => {
      expect(screen.getByTestId('gv-search').textContent).toContain('deliveryMode=manual');
    });
  });

  it('resets filters to an empty query string', async () => {
    renderPage('/ops/gift-vouchers?search=x&status=active&deliveryMode=email&page=2');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Reset filters' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Reset filters' })[0]);
    await waitFor(() => {
      expect(screen.getByTestId('gv-search')).toHaveTextContent('');
    });
    await waitFor(() => {
      expect(opsReadAPI.giftVouchers).toHaveBeenLastCalledWith({ page: 1, limit: 20 });
    });
  });

  it('renders voucher fields, canonical status, and navigates to the existing detail route', async () => {
    opsReadAPI.giftVouchers.mockResolvedValue(
      payload([
        voucher(),
        voucher({
          giftVoucherId: 'gv-2',
          code: null,
          status: 'expired',
          deliveryMode: 'postal',
          buyerName: null,
          buyerEmail: null,
          recipientName: null,
          recipientEmail: null
        }),
        voucher({ giftVoucherId: 'gv-3', code: 'DD-1003', status: 'refunded', deliveryMode: 'manual' })
      ])
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /DD-1001/ })).toBeInTheDocument();
    });
    const activeRow = screen.getByRole('link', { name: /DD-1001/ });
    const expiredRow = screen.getByRole('link', { name: /Code pending/ });
    const refundedRow = screen.getByRole('link', { name: /DD-1003/ });
    expect(activeRow).toHaveAttribute('href', '/ops/gift-vouchers/gv-1');
    expect(within(activeRow).getByText('Elena Petrova (elena@example.com) → Maya Dimitrova (maya@example.com)')).toBeInTheDocument();
    expect(within(expiredRow).getByText('Unknown buyer (—) → Unknown recipient (—)')).toBeInTheDocument();
    expect(
      within(activeRow).getByText(
        `Balance ${formatMoneyFromCents(8000, 'EUR')} / ${formatMoneyFromCents(10000, 'EUR')}`
      )
    ).toBeInTheDocument();
    expect(within(activeRow).getByText('Email')).toHaveClass('ops-badge');
    expect(within(activeRow).getByText('Active')).toHaveAttribute('data-ops-status-key', 'voucher.active');
    expect(within(expiredRow).getByText('Expired')).toHaveAttribute('data-ops-status-key', 'voucher.expired');
    expect(within(refundedRow).getByText('Refunded')).toHaveAttribute('data-ops-status-key', 'voucher.refunded');

    fireEvent.click(activeRow);
    expect(screen.getByTestId('legacy-voucher-detail')).toHaveTextContent('gv-1');
  });

  it('keeps pagination URL behavior and disables Previous on page 1', async () => {
    opsReadAPI.giftVouchers.mockResolvedValue(payload([voucher()], { page: 1, totalPages: 3 }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(screen.getByTestId('gv-search').textContent).toContain('page=2');
    });
  });

  it('disables Next on the last page and writes the previous page into the URL', async () => {
    opsReadAPI.giftVouchers.mockResolvedValue(payload([voucher()], { page: 3, totalPages: 3 }));
    renderPage('/ops/gift-vouchers?page=3');
    await waitFor(() => {
      expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => {
      expect(screen.getByTestId('gv-search').textContent).toContain('page=2');
    });
  });

  it('does not render pagination when there is only one page', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /DD-1001/ })).toBeInTheDocument();
    });
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
  });

  it('keeps the header visible while loading', async () => {
    let resolveLoad;
    opsReadAPI.giftVouchers.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      })
    );
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Gift vouchers' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading gift vouchers');
    resolveLoad(payload([voucher()]));
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /DD-1001/ })).toBeInTheDocument();
    });
  });

  it('shows a recoverable page error from the API message', async () => {
    opsReadAPI.giftVouchers.mockRejectedValue({
      response: { data: { message: 'Gift voucher list unavailable' } }
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Gift voucher list unavailable');
    });
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
  });

  it('distinguishes unfiltered empty from filtered empty and can reset', async () => {
    opsReadAPI.giftVouchers.mockResolvedValue(payload([]));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No gift vouchers').closest('[data-ops-empty-variant]')).toHaveAttribute(
        'data-ops-empty-variant',
        'empty'
      );
    });

    cleanup();
    opsReadAPI.giftVouchers.mockResolvedValue(payload([]));
    renderPage('/ops/gift-vouchers?search=nope');
    await waitFor(() => {
      expect(screen.getByText('No matching gift vouchers').closest('[data-ops-empty-variant]')).toHaveAttribute(
        'data-ops-empty-variant',
        'filtered'
      );
    });
    expect(screen.getByText('No gift vouchers match the current filters.')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Reset filters' })[0]);
    await waitFor(() => {
      expect(screen.getByTestId('gv-search')).toHaveTextContent('');
    });
  });

  it('does not add page-level permission checks or extra fetch APIs', () => {
    expect(pageSource).not.toMatch(/canAccessOpsFrontendPath|opsWriteAPI/);
    expect(pageSource).toContain('opsReadAPI.giftVouchers(params)');
    expect(pageSource.match(/opsReadAPI\.[A-Za-z]+/g)).toEqual(['opsReadAPI.giftVouchers']);
  });
});
