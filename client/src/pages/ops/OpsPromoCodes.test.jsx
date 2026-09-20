import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpsSessionProvider } from '../../context/OpsSessionContext';
import { resetOpsOverlayRuntime } from '../../ops/primitives/opsOverlay';
import OpsPromoCodes from './OpsPromoCodes';

vi.mock('../../services/opsApi', () => ({
  opsReadAPI: {
    promoCodes: vi.fn()
  },
  opsWriteAPI: {
    createPromoCode: vi.fn(),
    updatePromoCode: vi.fn()
  }
}));

import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';

const pageSource = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'OpsPromoCodes.jsx'),
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

function promo(overrides = {}) {
  return {
    _id: 'promo-1',
    code: 'SUMMER10',
    internalName: 'Summer percent',
    discountType: 'percent',
    discountValue: 10,
    isActive: true,
    validFrom: '2026-06-01T08:00:00.000Z',
    validUntil: '2026-09-01T08:00:00.000Z',
    usageLimit: 25,
    usageCount: 4,
    minSubtotal: 50,
    ...overrides
  };
}

function payload(promoCodes) {
  return { data: { data: { promoCodes } } };
}

function expectedDatetimeLocal(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

function collection() {
  return document.querySelector('.ops-promo-rows');
}

function renderPage() {
  return render(
    <div className="ops-root" data-ops-appearance="light" data-ops-themed="true">
      <OpsSessionProvider session={adminSession}>
        <OpsPromoCodes />
      </OpsSessionProvider>
    </div>
  );
}

describe('OpsPromoCodes collection migration', () => {
  beforeEach(() => {
    opsReadAPI.promoCodes.mockReset();
    opsWriteAPI.createPromoCode.mockReset();
    opsWriteAPI.updatePromoCode.mockReset();
    opsReadAPI.promoCodes.mockResolvedValue(payload([promo()]));
    opsWriteAPI.createPromoCode.mockResolvedValue({ data: { success: true } });
    opsWriteAPI.updatePromoCode.mockResolvedValue({ data: { success: true } });
  });

  afterEach(() => {
    cleanup();
    resetOpsOverlayRuntime();
  });

  it('uses OpsPage wide and OpsPageHeader without a legacy title card or max-w-7xl', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Promo codes' })).toBeInTheDocument();
    });
    expect(screen.getByTestId('ops-page')).toHaveAttribute('data-ops-page-width', 'wide');
    expect(screen.getByTestId('ops-page')).toHaveClass('ops-page--wide');
    expect(screen.queryByRole('heading', { level: 2, name: 'Promo codes' })).not.toBeInTheDocument();
    expect(pageSource).not.toMatch(/max-w-7xl|bg-white border border-gray-200 rounded-xl|#81887A/);
    expect(pageSource).toContain('Create and manage fixed/percent checkout promo codes.');
    expect(screen.getByRole('button', { name: 'Create promo code' })).toBeInTheDocument();
  });

  it('reads promoCodes with no query params', async () => {
    renderPage();
    await waitFor(() => {
      expect(opsReadAPI.promoCodes).toHaveBeenCalled();
    });
    expect(opsReadAPI.promoCodes).toHaveBeenCalledWith();
    expect(opsReadAPI.promoCodes.mock.calls[0]).toEqual([]);
  });

  it('renders existing fields, discount semantics, usage, and canonical status', async () => {
    opsReadAPI.promoCodes.mockResolvedValue(
      payload([
        promo(),
        promo({
          _id: 'promo-2',
          code: 'WINTER-FIXED-VERY-LONG-CODE',
          internalName: 'Winter fixed',
          discountType: 'fixed',
          discountValue: 25,
          isActive: false,
          usageLimit: null,
          usageCount: 0,
          minSubtotal: null
        })
      ])
    );
    renderPage();
    await waitFor(() => {
      expect(within(collection()).getByText('SUMMER10')).toBeInTheDocument();
    });
    expect(within(collection()).getByText(/Summer percent/)).toBeInTheDocument();
    expect(within(collection()).getByText(/· percent · 10%/)).toBeInTheDocument();
    expect(within(collection()).getByText(/Limit 25 · Uses 4/)).toBeInTheDocument();
    expect(within(collection()).getByText('Active')).toHaveAttribute('data-ops-status-key', 'promo.active');

    expect(within(collection()).getByText('WINTER-FIXED-VERY-LONG-CODE')).toBeInTheDocument();
    expect(within(collection()).getByText(/€25/)).toBeInTheDocument();
    expect(within(collection()).getByText(/· fixed ·/)).toBeInTheDocument();
    expect(within(collection()).getByText('Inactive')).toHaveAttribute('data-ops-status-key', 'promo.inactive');
    expect(within(collection()).getByText(/Limit — · Uses 0/)).toBeInTheDocument();

    const table = screen.getByRole('table', { hidden: true, name: 'Promo codes' });
    expect(within(table).getByRole('columnheader', { hidden: true, name: 'Code' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { hidden: true, name: 'Name' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { hidden: true, name: 'Type' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { hidden: true, name: 'Value' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { hidden: true, name: 'Active' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { hidden: true, name: 'Limit' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { hidden: true, name: 'Uses' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { hidden: true, name: /valid/i })).not.toBeInTheDocument();
  });

  it('opens create with the same defaults and submits the exact payload', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create promo code' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create promo code' }));
    const dialog = await screen.findByRole('dialog', { name: 'New promo code' });
    expect(within(dialog).getByLabelText('Code (guest-facing)')).toHaveValue('');
    expect(within(dialog).getByLabelText('Internal name')).toHaveValue('');
    expect(within(dialog).getByLabelText('Type')).toHaveValue('percent');
    expect(within(dialog).getByLabelText('Value')).toHaveValue(null);
    expect(within(dialog).getByLabelText('Active')).toBeChecked();
    expect(within(dialog).getByLabelText('Valid from')).toHaveValue('');
    expect(within(dialog).getByLabelText('Valid until')).toHaveValue('');
    expect(within(dialog).getByLabelText(/Usage limit/)).toHaveValue(null);
    expect(within(dialog).getByLabelText(/Minimum subtotal/)).toHaveValue(null);

    fireEvent.change(within(dialog).getByLabelText('Code (guest-facing)'), { target: { value: '  spring5 ' } });
    fireEvent.change(within(dialog).getByLabelText('Internal name'), { target: { value: ' Spring launch ' } });
    fireEvent.change(within(dialog).getByLabelText('Type'), { target: { value: 'fixed' } });
    fireEvent.change(within(dialog).getByLabelText('Value'), { target: { value: '15.5' } });
    fireEvent.click(within(dialog).getByLabelText('Active'));
    fireEvent.change(within(dialog).getByLabelText('Valid from'), { target: { value: '2026-12-01T10:00' } });
    fireEvent.change(within(dialog).getByLabelText(/Usage limit/), { target: { value: '3.8' } });
    fireEvent.change(within(dialog).getByLabelText(/Minimum subtotal/), { target: { value: '40' } });
    fireEvent.submit(document.getElementById('ops-promo-form'));

    await waitFor(() => {
      expect(opsWriteAPI.createPromoCode).toHaveBeenCalled();
    });
    expect(opsWriteAPI.createPromoCode).toHaveBeenCalledWith({
      code: 'spring5',
      internalName: 'Spring launch',
      discountType: 'fixed',
      discountValue: 15.5,
      isActive: false,
      validFrom: new Date('2026-12-01T10:00').toISOString(),
      validUntil: null,
      usageLimit: 3,
      minSubtotal: 40
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Promo code created.')).toBeInTheDocument();
    expect(opsReadAPI.promoCodes.mock.calls.length).toBeGreaterThan(1);
  });

  it('initializes edit with the same values, keeps code immutable, and submits the exact payload', async () => {
    const row = promo({ discountValue: 0, usageLimit: 0, minSubtotal: 0, isActive: false });
    opsReadAPI.promoCodes.mockResolvedValue(payload([row]));
    renderPage();
    await waitFor(() => {
      expect(within(collection()).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    });
    fireEvent.click(within(collection()).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit promo code' });
    expect(within(dialog).getByLabelText('Code (guest-facing)')).toHaveValue('SUMMER10');
    expect(within(dialog).getByLabelText('Code (guest-facing)')).toBeDisabled();
    expect(within(dialog).getByLabelText('Internal name')).toHaveValue('Summer percent');
    expect(within(dialog).getByLabelText('Type')).toHaveValue('percent');
    expect(within(dialog).getByLabelText('Value')).toHaveValue(0);
    expect(within(dialog).getByLabelText('Active')).not.toBeChecked();
    expect(within(dialog).getByLabelText('Valid from')).toHaveValue(expectedDatetimeLocal(row.validFrom));
    expect(within(dialog).getByLabelText('Valid until')).toHaveValue(expectedDatetimeLocal(row.validUntil));
    expect(within(dialog).getByLabelText(/Usage limit/)).toHaveValue(0);
    expect(within(dialog).getByLabelText(/Minimum subtotal/)).toHaveValue(0);

    fireEvent.change(within(dialog).getByLabelText('Internal name'), { target: { value: 'Summer relaunch' } });
    fireEvent.submit(document.getElementById('ops-promo-form'));
    await waitFor(() => {
      expect(opsWriteAPI.updatePromoCode).toHaveBeenCalledWith('promo-1', {
        code: 'SUMMER10',
        internalName: 'Summer relaunch',
        discountType: 'percent',
        discountValue: 0,
        isActive: false,
        validFrom: new Date(expectedDatetimeLocal(row.validFrom)).toISOString(),
        validUntil: new Date(expectedDatetimeLocal(row.validUntil)).toISOString(),
        usageLimit: 0,
        minSubtotal: 0
      });
    });
    expect(screen.getByText('Promo code updated.')).toBeInTheDocument();
  });

  it('keeps Enable/Disable as a patch of isActive only, without confirmation', async () => {
    renderPage();
    await waitFor(() => {
      expect(within(collection()).getByRole('button', { name: 'Disable' })).toBeInTheDocument();
    });
    fireEvent.click(within(collection()).getByRole('button', { name: 'Disable' }));
    await waitFor(() => {
      expect(opsWriteAPI.updatePromoCode).toHaveBeenCalledWith('promo-1', { isActive: false });
    });
    expect(screen.getByText('Promo code disabled.')).toBeInTheDocument();
    expect(pageSource).not.toMatch(/OpsConfirmDialog|window\.confirm/);
  });

  it('retains create input after a failed save and keeps the modal open', async () => {
    opsWriteAPI.createPromoCode.mockRejectedValue({ response: { data: { message: 'Code already exists' } } });
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create promo code' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create promo code' }));
    const dialog = await screen.findByRole('dialog', { name: 'New promo code' });
    fireEvent.change(within(dialog).getByLabelText('Code (guest-facing)'), { target: { value: 'DUPE' } });
    fireEvent.change(within(dialog).getByLabelText('Internal name'), { target: { value: 'Dup' } });
    fireEvent.change(within(dialog).getByLabelText('Value'), { target: { value: '10' } });
    fireEvent.submit(document.getElementById('ops-promo-form'));
    await waitFor(() => {
      expect(within(dialog).getByRole('alert')).toHaveTextContent('Code already exists');
    });
    expect(within(dialog).getByLabelText('Code (guest-facing)')).toHaveValue('DUPE');
    expect(screen.getByRole('dialog', { name: 'New promo code' })).toBeInTheDocument();
  });

  it('closes the modal on cancel without writing', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create promo code' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create promo code' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(opsWriteAPI.createPromoCode).not.toHaveBeenCalled();
  });

  it('keeps the header visible while loading', async () => {
    let resolveLoad;
    opsReadAPI.promoCodes.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      })
    );
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Promo codes' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading promo codes...');
    resolveLoad(payload([promo()]));
    await waitFor(() => {
      expect(within(collection()).getByText('SUMMER10')).toBeInTheDocument();
    });
  });

  it('shows a page error from the API message', async () => {
    opsReadAPI.promoCodes.mockRejectedValue({
      response: { data: { message: 'Promo list unavailable' } }
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Promo list unavailable');
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Promo codes' })).toBeInTheDocument();
  });

  it('shows an empty state with the existing create action', async () => {
    opsReadAPI.promoCodes.mockResolvedValue(payload([]));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No promo codes yet.')).toBeInTheDocument();
    });
    expect(screen.getByText('No promo codes yet.').closest('[data-ops-empty-variant]')).toHaveAttribute(
      'data-ops-empty-variant',
      'empty'
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Create promo code' })[1]);
    expect(await screen.findByRole('dialog', { name: 'New promo code' })).toBeInTheDocument();
  });

  it('does not invent filters, pagination, a detail route, or extra APIs', () => {
    expect(pageSource).not.toMatch(/OpsPagination|OpsFilterBar|giftVouchers|navigate\(|\/ops\/promo-codes\/:id/);
    expect(pageSource).toContain('opsReadAPI.promoCodes()');
    expect(pageSource).toContain('opsWriteAPI.createPromoCode(payload)');
    expect(pageSource).toContain('opsWriteAPI.updatePromoCode(editingId, payload)');
    expect(pageSource).toContain('opsWriteAPI.updatePromoCode(row._id, { isActive: !row.isActive })');
    expect(pageSource.match(/opsReadAPI\.[A-Za-z]+/g)).toEqual(['opsReadAPI.promoCodes']);
  });
});
