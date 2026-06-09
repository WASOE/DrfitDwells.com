import { describe, expect, it, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import OpsCleaningPayoutBreakdown from './OpsCleaningPayoutBreakdown.jsx';

afterEach(() => {
  cleanup();
});

const basePayout = {
  currency: 'EUR',
  totalAmount: 65,
  checkoutCount: 2,
  readOnly: true,
  noPolicyZones: [],
  zones: {
    cabin: { propertyKind: 'cabin', totalAmount: 35, noPolicy: false },
    valley: { propertyKind: 'valley', totalAmount: 30, noPolicy: false }
  },
  lineItems: [
    {
      label: 'Transport',
      amountEUR: 15,
      propertyKind: 'cabin',
      cabinName: 'Cabin One',
      amountType: 'cleaner_payout'
    },
    {
      label: 'Cabin cleaning',
      amountEUR: 20,
      propertyKind: 'cabin',
      cabinName: 'Cabin One',
      amountType: 'cleaner_payout'
    },
    {
      label: 'Transport',
      amountEUR: 8,
      propertyKind: 'valley',
      cabinName: 'AF-01',
      amountType: 'cleaner_payout'
    },
    {
      label: 'A-frame cleaning',
      amountEUR: 20,
      propertyKind: 'valley',
      cabinName: 'AF-01',
      amountType: 'cleaner_payout'
    },
    {
      label: 'Laundry',
      amountEUR: 2,
      propertyKind: 'valley',
      cabinName: 'AF-01',
      amountType: 'cleaner_payout'
    }
  ]
};

describe('OpsCleaningPayoutBreakdown', () => {
  it('renders global total and line items grouped by zone', () => {
    render(
      <OpsCleaningPayoutBreakdown
        selectedDate={new Date('2026-08-01')}
        payoutSummary={basePayout}
        loading={false}
        error=""
        formatLongDate={(d) => d.toDateString()}
      />
    );

    expect(screen.getByTestId('cleaner-payout-breakdown')).toBeInTheDocument();
    expect(screen.getByText('€65.00')).toBeInTheDocument();

    const cabinZone = screen.getByTestId('payout-zone-cabin');
    expect(within(cabinZone).getByText('The Cabin')).toBeInTheDocument();
    expect(within(cabinZone).getAllByText('Cabin One').length).toBeGreaterThanOrEqual(1);
    expect(within(cabinZone).getByText('€35.00')).toBeInTheDocument();

    const valleyZone = screen.getByTestId('payout-zone-valley');
    expect(within(valleyZone).getByText('The Valley')).toBeInTheDocument();
    expect(within(valleyZone).getAllByText('AF-01').length).toBe(3);
    expect(within(valleyZone).getByText('€30.00')).toBeInTheDocument();
  });

  it('surfaces noPolicyZones plainly per zone', () => {
    render(
      <OpsCleaningPayoutBreakdown
        selectedDate={new Date('2026-08-01')}
        payoutSummary={{
          ...basePayout,
          totalAmount: 35,
          noPolicyZones: ['valley'],
          zones: {
            cabin: { propertyKind: 'cabin', totalAmount: 35, noPolicy: false },
            valley: { propertyKind: 'valley', totalAmount: 0, noPolicy: true }
          },
          lineItems: basePayout.lineItems.filter((li) => li.propertyKind === 'cabin')
        }}
        loading={false}
        error=""
        formatLongDate={(d) => d.toDateString()}
      />
    );

    expect(screen.getByTestId('payout-no-policy-valley')).toHaveTextContent(
      'The Valley: no active pricing'
    );
  });

  it('has no mark-paid or input controls', () => {
    render(
      <OpsCleaningPayoutBreakdown
        selectedDate={new Date('2026-08-01')}
        payoutSummary={basePayout}
        loading={false}
        error=""
        formatLongDate={(d) => d.toDateString()}
      />
    );

    expect(screen.queryByTestId('toggle-paid')).not.toBeInTheDocument();
    expect(screen.queryByTestId('toggle-paid-desktop')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cleaning-day-inputs-form')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
