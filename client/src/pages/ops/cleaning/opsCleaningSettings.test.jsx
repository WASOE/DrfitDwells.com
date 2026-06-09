import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
  getCleaningInventoryTags
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
  vocabulary: ['a-frame', 'lux-cabin', 'stone-house'],
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
  vocabulary: ['a-frame', 'lux-cabin', 'stone-house'],
  inventory: [
    {
      id: 'valley-1',
      kind: 'cabin',
      name: 'Untagged Unit',
      propertyKind: 'valley',
      cleaningTags: [],
      missingPricingTag: true
    }
  ],
  untaggedValley: [
    {
      id: 'valley-1',
      kind: 'cabin',
      name: 'Untagged Unit',
      propertyKind: 'valley',
      cleaningTags: [],
      missingPricingTag: true
    }
  ],
  untaggedValleyCount: 1
};

function renderSettings(session) {
  return render(
    <MemoryRouter>
      <OpsSessionProvider session={session}>
        <OpsCleaningSettings />
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
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('OpsCleaningSettings', () => {
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

    await waitFor(() => {
      expect(screen.getByTestId('untagged-valley-banner')).toBeInTheDocument();
    });
  });

  it('shows needs-activation badge when valley policy not saved', async () => {
    renderSettings({
      actions: ['ops.cleaning.settings_read', 'ops.cleaning.settings_write']
    });

    await waitFor(() => {
      expect(screen.getByText(/Not saved yet/i)).toBeInTheDocument();
    });
  });

  it('saves cabin rules via checkout-linked payload', async () => {
    renderSettings({
      actions: ['ops.cleaning.settings_read', 'ops.cleaning.settings_write']
    });

    await waitFor(() => {
      expect(screen.getByTestId('save-rules-cabin')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('save-rules-cabin'));

    await waitFor(() => {
      expect(updatePricingPolicy).toHaveBeenCalledWith(
        'cabin',
        expect.arrayContaining([
          expect.objectContaining({ type: 'daily_fixed', ruleKey: 'transport' }),
          expect.objectContaining({ type: 'per_event_fixed', ruleKey: 'cabin_clean' })
        ])
      );
    });
  });

  it('read-only users cannot save rules', async () => {
    renderSettings({ actions: ['ops.cleaning.settings_read'] });

    await waitFor(() => {
      expect(screen.queryByTestId('save-rules-cabin')).not.toBeInTheDocument();
    });

    expect(screen.getAllByText(/Read-only/i).length).toBeGreaterThan(0);
  });
});
