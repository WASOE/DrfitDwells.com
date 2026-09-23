import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SplitPaymentChoiceOptions } from './ConfirmBooking';
import { SplitPaymentPreviewNote } from './CabinDetails';
import { AFrameSplitPaymentPreviewNote } from './AFrameDetails';

const offer = {
  totalCents: 60000,
  stayCreditProtectionText: 'Your reservation payment is protected as StayCredit.',
  futureChargeConsent: { displayedText: 'I authorize the future charge.' },
  installments: [
    { sequence: 1, amountCents: 24000, dueAtDateOnly: '2026-09-23' },
    { sequence: 2, amountCents: 36000, dueAtDateOnly: '2026-11-10' }
  ]
};

describe('split payment checkout UI', () => {
  it('renders authoritative full and split choices with full selected by default', () => {
    const choose = vi.fn();
    render(
      <SplitPaymentChoiceOptions
        offer={offer}
        paymentChoice="full"
        fullAmountCents={60000}
        onPaymentChoiceChange={choose}
      />
    );
    expect(screen.getByText('Pay in full')).toBeInTheDocument();
    expect(screen.getByText(/Reserve with €240\.00 today/)).toBeInTheDocument();
    expect(screen.getByText(/€360\.00 on 2026-11-10/)).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios[0]).toBeChecked();
    expect(radios[1]).not.toBeChecked();
    fireEvent.click(radios[1]);
    expect(choose).toHaveBeenCalledWith('split');
  });

  it('keeps full-payment-only UI unchanged when no offer exists', () => {
    const { container } = render(<SplitPaymentChoiceOptions offer={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('property split eligibility message', () => {
  it('shows only for an eligible server preview', () => {
    const { rerender } = render(
      <SplitPaymentPreviewNote
        preview={{ initialAmountCents: 24000, initialPercentBps: 4000, balanceDueOffsetDays: 30 }}
      />
    );
    expect(screen.getByText('Reserve with 40% today')).toBeInTheDocument();
    expect(screen.getByText('Pay the rest 30 days before arrival.')).toBeInTheDocument();

    rerender(<SplitPaymentPreviewNote preview={null} />);
    expect(screen.queryByTestId('split-payment-preview')).not.toBeInTheDocument();
  });

  it('shows the server-derived reserve banner on the A-frame selection page', () => {
    render(
      <AFrameSplitPaymentPreviewNote
        preview={{
          initialAmountCents: 24000,
          balanceAmountCents: 36000,
          balanceDueAtDateOnly: '2026-11-10'
        }}
      />
    );
    expect(screen.getByTestId('a-frame-split-payment-preview')).toHaveTextContent(
      'Reserve with €240.00 today'
    );
    expect(screen.getByText('Pay €360.00 on 2026-11-10')).toBeInTheDocument();
  });
});
