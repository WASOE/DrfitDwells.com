import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import OpsMetric, { OpsMetricGroup } from './OpsMetric';

afterEach(() => {
  cleanup();
});

describe('OpsMetric', () => {
  it('renders a label, value, and optional meta without inventing status chrome', () => {
    const { rerender } = render(<OpsMetric label="Failed events" value={4} />);
    expect(screen.getByText('Failed events')).toHaveClass('ops-metric__label');
    expect(screen.getByText('4')).toHaveClass('ops-metric__value');
    expect(screen.queryByText('Last hour')).not.toBeInTheDocument();
    rerender(<OpsMetric label="Failed events" value={4} meta="Last hour" />);
    expect(screen.getByText('Last hour')).toHaveClass('ops-metric__meta');
  });

  it('wraps sibling metrics in the compact group', () => {
    render(
      <OpsMetricGroup>
        <OpsMetric label="Stale pairs" value={1} />
        <OpsMetric label="Failed pairs" value={0} />
      </OpsMetricGroup>
    );
    expect(document.querySelector('.ops-metric-group')).toBeTruthy();
    expect(screen.getByText('Stale pairs')).toBeInTheDocument();
    expect(screen.getByText('Failed pairs')).toBeInTheDocument();
  });
});
