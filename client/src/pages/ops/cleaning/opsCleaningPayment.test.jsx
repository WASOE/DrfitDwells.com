import { describe, expect, it, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import OpsCleaningLineItemsTable from './OpsCleaningLineItemsTable.jsx';
import OpsCleaningPaymentPanel from './OpsCleaningPaymentPanel.jsx';

afterEach(() => {
  cleanup();
});

describe('OpsCleaningLineItemsTable', () => {
  it('renders line item amounts from API without summing in client', () => {
    render(
      <OpsCleaningLineItemsTable
        currency="EUR"
        totalAmount={264}
        lineItems={[
          { label: 'Fuel / transport', quantity: 1, unitAmountEUR: 8, amountEUR: 8 },
          { label: 'Laundry', quantity: 3, unitAmountEUR: 2, amountEUR: 6 }
        ]}
      />
    );
    expect(screen.getByText('Fuel / transport')).toBeInTheDocument();
    expect(screen.getByText('€264.00')).toBeInTheDocument();
  });
});

describe('OpsCleaningPaymentPanel', () => {
  const baseSummary = {
    currency: 'EUR',
    totalAmount: 33,
    paidAmount: 0,
    status: 'pending',
    cabinCount: 2,
    lineItems: [{ label: 'Fuel / transport', quantity: 1, unitAmountEUR: 8, amountEUR: 8 }],
    inputs: { inputs: { transport: true }, perCheckoutInputs: [] },
    editableInputFields: [
      { inputKey: 'transport', label: 'Fuel / transport', type: 'boolean', amountEUR: 8 }
    ],
    canEditInputs: true,
    isSnapshot: false
  };

  it('is hidden from DOM on mobile via parent aside; panel has desktop test id', () => {
    render(
      <OpsCleaningPaymentPanel
        selectedDate={new Date('2026-08-01')}
        paymentSummary={baseSummary}
        paymentLoading={false}
        paymentError=""
        paymentBusy={false}
        inputsSaving={false}
        inputsError=""
        togglePaidError=""
        canWritePayment={true}
        canEditDayInputs={true}
        formatLongDate={(d) => d.toDateString()}
        onTogglePaid={() => {}}
        onSaveDayInputs={() => {}}
      />
    );
    expect(screen.getByTestId('cleaning-payment-panel-desktop')).toBeTruthy();
  });

  it('hides mark paid without payment_write', () => {
    render(
      <OpsCleaningPaymentPanel
        selectedDate={new Date('2026-08-01')}
        paymentSummary={baseSummary}
        paymentLoading={false}
        paymentError=""
        paymentBusy={false}
        inputsSaving={false}
        inputsError=""
        togglePaidError=""
        canWritePayment={false}
        canEditDayInputs={true}
        formatLongDate={(d) => d.toDateString()}
        onTogglePaid={() => {}}
        onSaveDayInputs={() => {}}
      />
    );
    expect(screen.queryByTestId('toggle-paid-desktop')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark paid/i })).not.toBeInTheDocument();
  });

  it('calls onSaveDayInputs when saving tasks', () => {
    const onSaveDayInputs = vi.fn();
    render(
      <OpsCleaningPaymentPanel
        selectedDate={new Date('2026-08-01')}
        paymentSummary={baseSummary}
        paymentLoading={false}
        paymentError=""
        paymentBusy={false}
        inputsSaving={false}
        inputsError=""
        togglePaidError=""
        canWritePayment={false}
        canEditDayInputs={true}
        formatLongDate={(d) => d.toDateString()}
        onTogglePaid={() => {}}
        onSaveDayInputs={onSaveDayInputs}
      />
    );
    const panel = screen.getByTestId('cleaning-payment-panel-desktop');
    fireEvent.submit(within(panel).getByTestId('cleaning-day-inputs-form'));
    expect(onSaveDayInputs).toHaveBeenCalledWith({ transport: true });
  });

  it('shows frozen snapshot badge when paid', () => {
    render(
      <OpsCleaningPaymentPanel
        selectedDate={new Date('2026-08-01')}
        paymentSummary={{
          ...baseSummary,
          status: 'paid',
          isSnapshot: true,
          pricingVersion: '2026-06-default',
          canEditInputs: false
        }}
        paymentLoading={false}
        paymentError=""
        paymentBusy={false}
        inputsSaving={false}
        inputsError=""
        togglePaidError=""
        canWritePayment={true}
        canEditDayInputs={false}
        formatLongDate={(d) => d.toDateString()}
        onTogglePaid={() => {}}
        onSaveDayInputs={() => {}}
      />
    );
    expect(screen.getByText(/Frozen snapshot/)).toBeInTheDocument();
    expect(screen.queryByTestId('save-day-inputs')).not.toBeInTheDocument();
  });
});

describe('OpsCleaningCalendar mobile payment card', () => {
  it('mobile payment wrapper uses lg:hidden class in source', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(dir, 'OpsCleaningCalendar.jsx'), 'utf8');
    expect(source).toMatch(/lg:hidden/);
    expect(source).toMatch(/hidden lg:block lg:col-span-7/);
  });
});
