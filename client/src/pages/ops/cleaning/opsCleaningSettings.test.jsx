import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OpsCleaningSettings from './OpsCleaningSettings.jsx';
import { OpsSessionProvider } from '../../../context/OpsSessionContext';

vi.mock('../../../services/cleaningApi', () => ({
  getPricingPolicy: vi.fn(),
  updatePricingPolicy: vi.fn()
}));

import { getPricingPolicy, updatePricingPolicy } from '../../../services/cleaningApi';

const cabinItems = [
  { ruleKey: 'transport', label: 'Fuel / transport per visit', type: 'fixed', amountEUR: 8, enabled: true },
  { ruleKey: 'lux_cabin', label: 'Lux cabin / big bungalow', type: 'fixed', amountEUR: 25, enabled: true },
  { ruleKey: 'house_full', label: 'House 1st + 2nd floor + toilets', type: 'fixed', amountEUR: 25, enabled: true },
  { ruleKey: 'deep_cleaning', label: 'Deep/general cleaning', type: 'fixed', amountEUR: 150, enabled: true },
  { ruleKey: 'laundry', label: 'Laundry', type: 'quantity', amountEUR: 2, enabled: true }
];

const valleyItems = [
  { ruleKey: 'transport', label: 'Fuel / transport per visit', type: 'fixed', amountEUR: 8, enabled: true },
  { ruleKey: 'aframe_small', label: 'A-frame small only', type: 'quantity', amountEUR: 10, enabled: true },
  { ruleKey: 'aframe_full', label: 'A-frame + 1st floor + toilets', type: 'quantity', amountEUR: 20, enabled: true },
  { ruleKey: 'deep_cleaning', label: 'Deep/general cleaning', type: 'fixed', amountEUR: 150, enabled: true },
  { ruleKey: 'laundry', label: 'Laundry', type: 'quantity', amountEUR: 2, enabled: true }
];

const mockPolicyResponse = {
  currency: 'EUR',
  cabin: {
    mode: 'legacy',
    needsActivation: true,
    propertyKind: 'cabin',
    policyId: null,
    version: null,
    isActive: false,
    items: cabinItems
  },
  valley: {
    mode: 'policy',
    needsActivation: false,
    propertyKind: 'valley',
    policyId: 'valley-policy-id',
    version: '2026-06-default',
    isActive: true,
    items: valleyItems
  }
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
  updatePricingPolicy.mockResolvedValue({
    data: {
      data: {
        ...mockPolicyResponse,
        cabin: {
          ...mockPolicyResponse.cabin,
          mode: 'policy',
          needsActivation: false,
          policyId: 'cabin-policy-id',
          version: '2026-06-default',
          isActive: true,
          items: cabinItems.map((item) =>
            item.ruleKey === 'transport' ? { ...item, amountEUR: 9 } : item
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
  it('renders independent item rows per location', async () => {
    renderSettings({
      actions: ['ops.cleaning.settings_read', 'ops.cleaning.settings_write']
    });

    await waitFor(() => {
      expect(screen.getByTestId('label-cabin-0')).toHaveValue('Fuel / transport per visit');
    });

    expect(screen.getByTestId('label-cabin-1')).toHaveValue('Lux cabin / big bungalow');
    expect(screen.getByTestId('label-valley-1')).toHaveValue('A-frame small only');
    expect(screen.getByTestId('amount-cabin-0')).toHaveValue(8);
    expect(screen.getByTestId('amount-valley-2')).toHaveValue(20);
  });

  it('shows legacy mode badge when no policy active', async () => {
    renderSettings({
      actions: ['ops.cleaning.settings_read', 'ops.cleaning.settings_write']
    });

    await waitFor(() => {
      expect(screen.getByText(/Legacy mode — saving activates policy/i)).toBeInTheDocument();
    });
  });

  it('does not show base fee UI', async () => {
    renderSettings({
      actions: ['ops.cleaning.settings_read', 'ops.cleaning.settings_write']
    });

    await waitFor(() => {
      expect(screen.getByText('Cleaning payment rates')).toBeInTheDocument();
    });

    expect(screen.queryByText(/Base fee/i)).not.toBeInTheDocument();
  });

  it('admin can add item and save only cabin items', async () => {
    renderSettings({
      actions: ['ops.cleaning.settings_read', 'ops.cleaning.settings_write']
    });

    await waitFor(() => {
      expect(screen.getByTestId('save-rates-cabin')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('amount-cabin-0'), { target: { value: '9' } });
    fireEvent.click(screen.getByTestId('add-item-cabin'));
    fireEvent.change(screen.getByTestId('label-cabin-5'), { target: { value: 'Extra task' } });
    fireEvent.click(screen.getByTestId('save-rates-cabin'));

    await waitFor(() => {
      expect(updatePricingPolicy).toHaveBeenCalledWith(
        'cabin',
        expect.arrayContaining([
          expect.objectContaining({ ruleKey: 'transport', amountEUR: 9 }),
          expect.objectContaining({ label: 'Extra task', ruleKey: '', type: 'fixed' })
        ])
      );
    });
  });

  it('operator sees read-only fields without save button', async () => {
    renderSettings({ actions: ['ops.cleaning.settings_read'] });

    await waitFor(() => {
      expect(screen.getByTestId('label-cabin-0')).toBeInTheDocument();
    });

    expect(screen.getByTestId('label-cabin-0')).toBeDisabled();
    expect(screen.queryByTestId('save-rates-cabin')).not.toBeInTheDocument();
    expect(screen.getAllByText(/Read-only. Contact an admin/i).length).toBeGreaterThan(0);
  });
});
