import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import OpsCleaningSettings from './OpsCleaningSettings.jsx';
import { OpsSessionProvider } from '../../../context/OpsSessionContext';

vi.mock('../../../services/cleaningApi', () => ({
  getPricingPolicy: vi.fn(),
  updatePricingPolicy: vi.fn(),
  getCleaningInventoryTags: vi.fn(),
  updateCabinCleaningTags: vi.fn(),
  updateCabinTypeCleaningTags: vi.fn()
}));

import {
  getPricingPolicy,
  updatePricingPolicy,
  getCleaningInventoryTags,
  updateCabinCleaningTags,
  updateCabinTypeCleaningTags
} from '../../../services/cleaningApi';

const cabinRules = [
  {
    ruleKey: 'transport',
    label: 'Transport',
    type: 'daily_fixed',
    enabled: true,
    amountType: 'cleaner_payout',
    amountEUR: 15,
    requiresCheckouts: true,
    selector: { cleaningTags: [] },
    tiers: []
  },
  {
    ruleKey: 'cabin_clean',
    label: 'Cabin cleaning',
    type: 'per_event_fixed',
    enabled: true,
    amountType: 'cleaner_payout',
    amountEUR: 20,
    requiresCheckouts: false,
    selector: { cleaningTags: [] },
    tiers: []
  },
  {
    ruleKey: 'disabled_legacy',
    label: 'Disabled legacy',
    type: 'per_event_fixed',
    enabled: false,
    amountType: 'cleaner_payout',
    amountEUR: 5,
    requiresCheckouts: false,
    selector: { cleaningTags: [] },
    tiers: []
  }
];

const valleyRules = [
  {
    ruleKey: 'aframe_clean',
    label: 'A-frame cleaning',
    type: 'tiered_per_event',
    enabled: true,
    amountType: 'cleaner_payout',
    amountEUR: null,
    requiresCheckouts: false,
    selector: { cleaningTags: ['a-frame'] },
    tiers: [{ amountEUR: 20 }, { amountEUR: 10 }]
  }
];

const mockPolicyResponse = {
  currency: 'EUR',
  vocabulary: ['the-cabin', 'a-frame', 'lux-cabin', 'stone-house'],
  cabin: {
    mode: 'policy',
    needsActivation: false,
    propertyKind: 'cabin',
    policyId: 'cabin-policy-id',
    version: '2026-06-checkout-payout-v1',
    isActive: true,
    rules: cabinRules,
    warnings: []
  },
  valley: {
    mode: 'needs_activation',
    needsActivation: true,
    propertyKind: 'valley',
    policyId: null,
    version: null,
    isActive: false,
    rules: valleyRules,
    warnings: []
  }
};

const mockInventoryResponse = {
  vocabulary: ['the-cabin', 'a-frame', 'lux-cabin', 'stone-house'],
  inventory: [
    {
      id: 'valley-1',
      kind: 'cabin',
      name: 'Untagged Unit With A Very Long Name That Should Wrap',
      propertyKind: 'valley',
      cleaningTags: [],
      missingPricingTag: true
    },
    {
      id: 'cabin-1',
      kind: 'cabin',
      name: 'Main Cabin',
      propertyKind: 'cabin',
      cleaningTags: ['the-cabin'],
      missingPricingTag: false
    },
    {
      id: 'type-1',
      kind: 'cabin_type',
      name: 'A-frame type',
      propertyKind: 'valley',
      cleaningTags: ['a-frame'],
      missingPricingTag: false
    }
  ],
  untaggedValley: [
    {
      id: 'valley-1',
      kind: 'cabin',
      name: 'Untagged Unit With A Very Long Name That Should Wrap',
      propertyKind: 'valley',
      cleaningTags: [],
      missingPricingTag: true
    }
  ],
  untaggedValleyCount: 1,
  untaggedCabinCount: 0
};

function renderSettings(session, { route = '/ops/settings/cleaning' } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <OpsSessionProvider session={session}>
        <Routes>
          <Route path="/ops/settings/cleaning" element={<OpsCleaningSettings />} />
          <Route path="/ops/cleaning" element={<div>Cleaning calendar route</div>} />
        </Routes>
      </OpsSessionProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  getPricingPolicy.mockResolvedValue({ data: { data: mockPolicyResponse } });
  getCleaningInventoryTags.mockResolvedValue({ data: { data: mockInventoryResponse } });
  updatePricingPolicy.mockResolvedValue({
    data: {
      data: {
        ...mockPolicyResponse,
        cabin: {
          ...mockPolicyResponse.cabin,
          rules: cabinRules.map((rule) =>
            rule.ruleKey === 'transport' ? { ...rule, amountEUR: 16 } : rule
          )
        }
      }
    }
  });
  updateCabinCleaningTags.mockResolvedValue({ data: { data: { ok: true } } });
  updateCabinTypeCleaningTags.mockResolvedValue({ data: { data: { ok: true } } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('OpsCleaningSettings', () => {
  it('loads pricing policy and inventory once with no params', async () => {
    renderSettings({
      actions: ['ops.cleaning.settings_read', 'ops.cleaning.settings_write']
    });

    await waitFor(() => {
      expect(screen.getByTestId('label-cabin-0')).toHaveValue('Transport');
    });

    expect(getPricingPolicy).toHaveBeenCalledTimes(1);
    expect(getPricingPolicy).toHaveBeenCalledWith();
    expect(getCleaningInventoryTags).toHaveBeenCalledTimes(1);
    expect(getCleaningInventoryTags).toHaveBeenCalledWith();
    expect(screen.getByText('Currency: EUR only')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open cleaning calendar/i })).toHaveAttribute(
      'href',
      '/ops/cleaning'
    );
    expect(document.querySelector('.ops-page')).toBeTruthy();
    expect(document.querySelector('.ops-page')).toHaveAttribute('data-ops-page-width', 'default');
    expect(document.querySelector('.ops-page')).toHaveClass('ops-cleaning-settings');
    expect(document.querySelector('.ops-page > .ops-page-header')).toBeTruthy();
    expect(document.querySelector('.ops-page-header__actions .ops-cleaning-settings__calendar-link')).toBeTruthy();
    expect(document.querySelector('.max-w-7xl')).toBeNull();
  });

  it('renders rate-card rule editors and inventory tagging', async () => {
    renderSettings({
      actions: ['ops.cleaning.settings_read', 'ops.cleaning.settings_write']
    });

    await waitFor(() => {
      expect(screen.getByText('Inventory cleaning tags')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByTestId('label-cabin-0')).toHaveValue('Transport');
    });

    expect(screen.getByTestId('type-valley-0')).toHaveValue('tiered_per_event');
    expect(screen.getByTestId('tier-valley-0-0')).toHaveValue(20);
    expect(screen.getByText('The Cabin payout policy')).toBeInTheDocument();
    expect(screen.getByText('The Valley payout policy')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('untagged-valley-banner')).toBeInTheDocument();
    });
    expect(screen.getByText('Missing pricing tag')).toBeInTheDocument();
  });

  it('shows needs-activation badge when valley policy not saved', async () => {
    renderSettings({
      actions: ['ops.cleaning.settings_read', 'ops.cleaning.settings_write']
    });

    await waitFor(() => {
      expect(screen.getByText(/Not saved yet/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Policy active · 2026-06-checkout-payout-v1/)).toBeInTheDocument();
  });

  it('saves cabin rules with exact PUT payload including disabled rules and trimmed labels', async () => {
    renderSettings({
      actions: ['ops.cleaning.settings_read', 'ops.cleaning.settings_write']
    });

    await waitFor(() => {
      expect(screen.getByTestId('save-rules-cabin')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('label-cabin-0'), {
      target: { value: '  Transport  ' }
    });
    fireEvent.click(screen.getByTestId('save-rules-cabin'));

    await waitFor(() => {
      expect(updatePricingPolicy).toHaveBeenCalledWith('cabin', [
        expect.objectContaining({
          ruleKey: 'transport',
          label: 'Transport',
          type: 'daily_fixed',
          enabled: true,
          amountType: 'cleaner_payout',
          amountEUR: 15,
          requiresCheckouts: true,
          selector: { cleaningTags: [] },
          tiers: []
        }),
        expect.objectContaining({
          ruleKey: 'cabin_clean',
          type: 'per_event_fixed',
          amountEUR: 20
        }),
        expect.objectContaining({
          ruleKey: 'disabled_legacy',
          enabled: false,
          amountEUR: 5
        })
      ]);
    });
    expect(updatePricingPolicy).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Rules saved.')).toBeInTheDocument();
  });

  it('saves valley rules independently without mutating cabin', async () => {
    updatePricingPolicy.mockResolvedValueOnce({
      data: {
        data: {
          ...mockPolicyResponse,
          valley: {
            ...mockPolicyResponse.valley,
            mode: 'policy',
            needsActivation: false,
            version: 'valley-v1',
            isActive: true,
            rules: valleyRules
          }
        }
      }
    });

    renderSettings({
      actions: ['ops.cleaning.settings_read', 'ops.cleaning.settings_write']
    });

    await waitFor(() => {
      expect(screen.getByTestId('save-rules-valley')).toBeInTheDocument();
    });

    const cabinLabelBefore = screen.getByTestId('label-cabin-0').value;
    fireEvent.click(screen.getByTestId('save-rules-valley'));

    await waitFor(() => {
      expect(updatePricingPolicy).toHaveBeenCalledWith(
        'valley',
        expect.arrayContaining([
          expect.objectContaining({
            ruleKey: 'aframe_clean',
            type: 'tiered_per_event',
            amountEUR: null,
            selector: { cleaningTags: ['a-frame'] },
            tiers: [{ amountEUR: 20 }, { amountEUR: 10 }]
          })
        ])
      );
    });
    expect(screen.getByTestId('label-cabin-0')).toHaveValue(cabinLabelBefore);
  });

  it('blocks enabled blank label without PUT and keeps edits', async () => {
    renderSettings({
      actions: ['ops.cleaning.settings_read', 'ops.cleaning.settings_write']
    });

    await waitFor(() => {
      expect(screen.getByTestId('label-cabin-0')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('label-cabin-0'), { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('save-rules-cabin'));

    expect(updatePricingPolicy).not.toHaveBeenCalled();
    expect(await screen.findByText(/Rule 1: label is required/i)).toBeInTheDocument();
    expect(screen.getByTestId('label-cabin-0')).toHaveValue('   ');
  });

  it('saves blank amount as 0', async () => {
    renderSettings({
      actions: ['ops.cleaning.settings_read', 'ops.cleaning.settings_write']
    });

    await waitFor(() => {
      expect(screen.getByTestId('amount-cabin-1')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('amount-cabin-1'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('save-rules-cabin'));

    await waitFor(() => {
      expect(updatePricingPolicy).toHaveBeenCalled();
    });
    const payload = updatePricingPolicy.mock.calls[0][1];
    expect(payload.find((r) => r.ruleKey === 'cabin_clean').amountEUR).toBe(0);
  });

  it('applies daily_fixed, per_event_fixed, and tiered_per_event conditionals', async () => {
    renderSettings({
      actions: ['ops.cleaning.settings_read', 'ops.cleaning.settings_write']
    });

    await waitFor(() => {
      expect(screen.getByTestId('requires-checkouts-cabin-0')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('amount-cabin-0')).toBeInTheDocument();
    expect(screen.queryByTestId('requires-checkouts-cabin-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tier-valley-0-0')).toBeInTheDocument();
    expect(screen.queryByTestId('amount-valley-0')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('type-cabin-1'), { target: { value: 'daily_fixed' } });
    expect(screen.getByTestId('requires-checkouts-cabin-1')).toBeChecked();

    fireEvent.change(screen.getByTestId('type-cabin-1'), { target: { value: 'tiered_per_event' } });
    expect(screen.queryByTestId('amount-cabin-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('tier-cabin-1-0')).toBeInTheDocument();
    expect(screen.getByTestId('tier-cabin-1-1')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('type-cabin-1'), { target: { value: 'per_event_fixed' } });
    expect(screen.queryByTestId('requires-checkouts-cabin-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('amount-cabin-1')).toBeInTheDocument();
  });

  it('blocks tiered save without tags', async () => {
    renderSettings({
      actions: ['ops.cleaning.settings_read', 'ops.cleaning.settings_write']
    });

    await waitFor(() => {
      expect(screen.getByTestId('rule-tag-valley-0-a-frame')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('rule-tag-valley-0-a-frame'));
    fireEvent.click(screen.getByTestId('save-rules-valley'));

    expect(updatePricingPolicy).not.toHaveBeenCalled();
    expect(await screen.findByText(/tiered rules need at least one tag/i)).toBeInTheDocument();
  });

  it('adds a rule locally and removes without immediate API', async () => {
    renderSettings({
      actions: ['ops.cleaning.settings_read', 'ops.cleaning.settings_write']
    });

    await waitFor(() => {
      expect(screen.getByTestId('add-rule-cabin')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('add-rule-cabin'));
    expect(screen.getByTestId('label-cabin-3')).toHaveValue('');
    expect(updatePricingPolicy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('remove-cabin-3'));
    expect(screen.queryByTestId('label-cabin-3')).not.toBeInTheDocument();
    expect(updatePricingPolicy).not.toHaveBeenCalled();
  });

  it('keeps policy edits on save failure and leaves the other policy usable', async () => {
    updatePricingPolicy.mockRejectedValueOnce({
      response: { data: { message: 'Cabin policy rejected' } }
    });

    renderSettings({
      actions: ['ops.cleaning.settings_read', 'ops.cleaning.settings_write']
    });

    await waitFor(() => {
      expect(screen.getByTestId('amount-cabin-0')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('amount-cabin-0'), { target: { value: '99' } });
    fireEvent.click(screen.getByTestId('save-rules-cabin'));

    expect(await screen.findByText('Cabin policy rejected')).toBeInTheDocument();
    expect(screen.getByTestId('amount-cabin-0')).toHaveValue(99);
    expect(screen.getByTestId('save-rules-valley')).toBeEnabled();
  });

  it('shows pricing load error without fake empty policies', async () => {
    getPricingPolicy.mockRejectedValueOnce({
      response: { data: { message: 'Pricing unavailable' } }
    });

    renderSettings({
      actions: ['ops.cleaning.settings_read', 'ops.cleaning.settings_write']
    });

    expect(await screen.findByText('Pricing unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('save-rules-cabin')).not.toBeInTheDocument();
    expect(screen.getByText('Cleaning payout settings')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Inventory cleaning tags')).toBeInTheDocument();
    });
  });

  it('read-only operator sees information without write actions', async () => {
    renderSettings({ actions: ['ops.cleaning.settings_read'] });

    await waitFor(() => {
      expect(screen.getByTestId('label-cabin-0')).toHaveValue('Transport');
    });

    expect(screen.queryByTestId('save-rules-cabin')).not.toBeInTheDocument();
    expect(screen.queryByTestId('save-rules-valley')).not.toBeInTheDocument();
    expect(screen.queryByTestId('add-rule-cabin')).not.toBeInTheDocument();
    expect(screen.getAllByText(/Read-only/i).length).toBeGreaterThan(0);
    expect(screen.getByTestId('label-cabin-0')).toBeDisabled();
    expect(screen.getByTestId('amount-cabin-0')).toBeDisabled();

    fireEvent.click(screen.getByTestId('filter-cabin'));
    await waitFor(() => {
      expect(screen.getByTestId('inventory-row-cabin-1')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('save-tags-cabin-1')).not.toBeInTheDocument();
    expect(updatePricingPolicy).not.toHaveBeenCalled();
    expect(updateCabinCleaningTags).not.toHaveBeenCalled();
  });

  it('detects dirty tags, saves cabin tags, and refetches inventory', async () => {
    renderSettings({
      actions: ['ops.cleaning.settings_read', 'ops.cleaning.settings_write']
    });

    await waitFor(() => {
      expect(screen.getByTestId('inventory-row-valley-1')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('save-tags-valley-1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('inventory-valley-1-tag-a-frame'));
    expect(screen.getByTestId('save-tags-valley-1')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('inventory-valley-1-tag-a-frame'));
    expect(screen.queryByTestId('save-tags-valley-1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('inventory-valley-1-tag-lux-cabin'));
    fireEvent.click(screen.getByTestId('save-tags-valley-1'));

    await waitFor(() => {
      expect(updateCabinCleaningTags).toHaveBeenCalledWith('valley-1', ['lux-cabin']);
    });
    expect(updateCabinTypeCleaningTags).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(getCleaningInventoryTags.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('saves cabin-type tags via the type endpoint', async () => {
    renderSettings({
      actions: ['ops.cleaning.settings_read', 'ops.cleaning.settings_write']
    });

    await waitFor(() => {
      expect(screen.getByTestId('inventory-row-type-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('inventory-type-1-tag-stone-house'));
    fireEvent.click(screen.getByTestId('save-tags-type-1'));

    await waitFor(() => {
      expect(updateCabinTypeCleaningTags).toHaveBeenCalledWith('type-1', ['a-frame', 'stone-house']);
    });
    expect(updateCabinCleaningTags).not.toHaveBeenCalled();
  });

  it('keeps tag edits on save failure', async () => {
    updateCabinCleaningTags.mockRejectedValueOnce({
      response: { data: { message: 'Tag write failed' } }
    });

    renderSettings({
      actions: ['ops.cleaning.settings_read', 'ops.cleaning.settings_write']
    });

    await waitFor(() => {
      expect(screen.getByTestId('inventory-row-valley-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('inventory-valley-1-tag-a-frame'));
    fireEvent.click(screen.getByTestId('save-tags-valley-1'));

    expect(await screen.findByText('Tag write failed')).toBeInTheDocument();
    expect(screen.getByTestId('inventory-valley-1-tag-a-frame')).toBeChecked();
    expect(screen.getByTestId('save-tags-valley-1')).toBeInTheDocument();
  });

  it('filters inventory locally without URL or write calls', async () => {
    renderSettings({
      actions: ['ops.cleaning.settings_read', 'ops.cleaning.settings_write']
    });

    await waitFor(() => {
      expect(screen.getByTestId('inventory-row-valley-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('filter-cabin'));
    expect(screen.queryByTestId('inventory-row-valley-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('inventory-row-cabin-1')).toBeInTheDocument();
    expect(updateCabinCleaningTags).not.toHaveBeenCalled();
    expect(window.location.pathname).not.toContain('filter');
  });
});
