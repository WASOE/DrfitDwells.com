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

const mockPolicyResponse = {
  currency: 'EUR',
  cabin: {
    mode: 'legacy',
    needsActivation: true,
    propertyKind: 'cabin',
    policyId: null,
    version: null,
    isActive: false,
    rules: [
      { ruleKey: 'transport', label: 'Fuel / transport per visit', valueType: 'amount', amountEUR: 8 },
      { ruleKey: 'aframe_small', label: 'A-frame small only', valueType: 'unit', unitAmountEUR: 10 },
      { ruleKey: 'aframe_full', label: 'A-frame + 1st floor + toilets', valueType: 'unit', unitAmountEUR: 20 },
      { ruleKey: 'lux_cabin', label: 'Lux cabin / big bungalow', valueType: 'amount', amountEUR: 25 },
      { ruleKey: 'house_full', label: 'House 1st + 2nd floor + toilets', valueType: 'amount', amountEUR: 25 },
      { ruleKey: 'deep_cleaning', label: 'Deep/general cleaning', valueType: 'amount', amountEUR: 150 },
      { ruleKey: 'laundry', label: 'Laundry', valueType: 'unit', unitAmountEUR: 2 }
    ]
  },
  valley: {
    mode: 'policy',
    needsActivation: false,
    propertyKind: 'valley',
    policyId: 'valley-policy-id',
    version: '2026-06-default',
    isActive: true,
    rules: [
      { ruleKey: 'transport', label: 'Fuel / transport per visit', valueType: 'amount', amountEUR: 8 },
      { ruleKey: 'aframe_small', label: 'A-frame small only', valueType: 'unit', unitAmountEUR: 10 },
      { ruleKey: 'aframe_full', label: 'A-frame + 1st floor + toilets', valueType: 'unit', unitAmountEUR: 20 },
      { ruleKey: 'lux_cabin', label: 'Lux cabin / big bungalow', valueType: 'amount', amountEUR: 25 },
      { ruleKey: 'house_full', label: 'House 1st + 2nd floor + toilets', valueType: 'amount', amountEUR: 25 },
      { ruleKey: 'deep_cleaning', label: 'Deep/general cleaning', valueType: 'amount', amountEUR: 150 },
      { ruleKey: 'laundry', label: 'Laundry', valueType: 'unit', unitAmountEUR: 2 }
    ]
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
          isActive: true
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
  it('renders 7 rate fields for the active location', async () => {
    renderSettings({
      actions: ['ops.cleaning.settings_read', 'ops.cleaning.settings_write']
    });

    await waitFor(() => {
      expect(screen.getByTestId('rate-cabin-transport')).toBeInTheDocument();
    });

    expect(screen.getByTestId('rate-cabin-transport')).toHaveValue(8);
    expect(screen.getByTestId('rate-cabin-aframe_small')).toHaveValue(10);
    expect(screen.getByTestId('rate-cabin-aframe_full')).toHaveValue(20);
    expect(screen.getByTestId('rate-cabin-lux_cabin')).toHaveValue(25);
    expect(screen.getByTestId('rate-cabin-house_full')).toHaveValue(25);
    expect(screen.getByTestId('rate-cabin-deep_cleaning')).toHaveValue(150);
    expect(screen.getByTestId('rate-cabin-laundry')).toHaveValue(2);
  });

  it('shows legacy mode badge when no policy active', async () => {
    renderSettings({
      actions: ['ops.cleaning.settings_read', 'ops.cleaning.settings_write']
    });

    await waitFor(() => {
      expect(screen.getByText(/Legacy mode — saving these rates activates policy/i)).toBeInTheDocument();
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
    expect(screen.queryByText(/base cleaning fee/i)).not.toBeInTheDocument();
  });

  it('admin can edit and save rates', async () => {
    renderSettings({
      actions: ['ops.cleaning.settings_read', 'ops.cleaning.settings_write']
    });

    await waitFor(() => {
      expect(screen.getByTestId('rate-cabin-transport')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('rate-cabin-transport'), { target: { value: '9' } });
    fireEvent.click(screen.getByTestId('save-rates-cabin'));

    await waitFor(() => {
      expect(updatePricingPolicy).toHaveBeenCalledWith('cabin', {
        transport: 9,
        aframe_small: 10,
        aframe_full: 20,
        lux_cabin: 25,
        house_full: 25,
        deep_cleaning: 150,
        laundry: 2
      });
    });
  });

  it('operator sees read-only fields without save button', async () => {
    renderSettings({ actions: ['ops.cleaning.settings_read'] });

    await waitFor(() => {
      expect(screen.getByTestId('rate-cabin-transport')).toBeInTheDocument();
    });

    expect(screen.getByTestId('rate-cabin-transport')).toBeDisabled();
    expect(screen.queryByTestId('save-rates-cabin')).not.toBeInTheDocument();
    expect(screen.getAllByText(/Read-only. Contact an admin/i).length).toBeGreaterThan(0);
  });
});
