import { describe, expect, it, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import OpsCleaningDailyFeeCard from './OpsCleaningDailyFeeCard.jsx';

afterEach(() => {
  cleanup();
});

describe('OpsCleaningDailyFeeCard', () => {
  it('shows prominent total on day select', () => {
    render(
      <OpsCleaningDailyFeeCard
        selectedDate={new Date('2026-08-01')}
        totalAmount={65}
        checkoutCount={3}
        hasCheckouts
        formatLongDate={(d) => d.toDateString()}
        testId="daily-fee-card"
      />
    );

    expect(screen.getByTestId('daily-fee-card')).toBeInTheDocument();
    expect(screen.getByText('Total Daily Cleaning Fee')).toBeInTheDocument();
    expect(screen.getByText('€65.00')).toBeInTheDocument();
  });

  it('surfaces no-policy zones distinctly from empty day', () => {
    render(
      <OpsCleaningDailyFeeCard
        selectedDate={new Date('2026-08-01')}
        totalAmount={0}
        checkoutCount={0}
        hasCheckouts={false}
        noPolicyZones={['valley']}
        formatLongDate={(d) => d.toDateString()}
      />
    );

    expect(screen.getByText('No checkouts on this day.')).toBeInTheDocument();
    expect(screen.getByTestId('daily-fee-no-policy')).toHaveTextContent('valley: no active pricing');
  });
});
