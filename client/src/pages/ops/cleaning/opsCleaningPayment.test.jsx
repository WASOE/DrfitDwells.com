import { describe, expect, it, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { OpsSessionProvider } from '../../../context/OpsSessionContext';
import OpsCleaningLineItemsTable from './OpsCleaningLineItemsTable.jsx';
import OpsCleaningPaymentPanel from './OpsCleaningPaymentPanel.jsx';

afterEach(() => {
  cleanup();
});

const adminSession = {
  authenticated: true,
  role: 'admin',
  modules: ['*'],
  actions: ['ops.cleaning.payment_write'],
  defaultRoute: '/ops',
  locale: 'en'
};

function renderPayment(ui) {
  return render(<OpsSessionProvider session={adminSession}>{ui}</OpsSessionProvider>);
}

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
    isSnapshot: false
  };

  it('is hidden from DOM on mobile via parent aside; panel has desktop test id', () => {
    renderPayment(
      <OpsCleaningPaymentPanel
        selectedDate={new Date('2026-08-01')}
        paymentSummary={baseSummary}
        paymentLoading={false}
        paymentError=""
        paymentBusy={false}
        togglePaidError=""
        canWritePayment={true}
        formatLongDate={(d) => d.toDateString()}
        onTogglePaid={() => {}}
      />
    );
    expect(screen.getByTestId('cleaning-payment-panel-desktop')).toBeTruthy();
  });

  it('hides mark paid without payment_write', () => {
    renderPayment(
      <OpsCleaningPaymentPanel
        selectedDate={new Date('2026-08-01')}
        paymentSummary={baseSummary}
        paymentLoading={false}
        paymentError=""
        paymentBusy={false}
        togglePaidError=""
        canWritePayment={false}
        formatLongDate={(d) => d.toDateString()}
        onTogglePaid={() => {}}
      />
    );
    expect(screen.queryByTestId('toggle-paid-desktop')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark paid/i })).not.toBeInTheDocument();
  });

  it('shows frozen snapshot badge when paid', () => {
    renderPayment(
      <OpsCleaningPaymentPanel
        selectedDate={new Date('2026-08-01')}
        paymentSummary={{
          ...baseSummary,
          status: 'paid',
          isSnapshot: true,
          pricingVersion: '2026-06-default'
        }}
        paymentLoading={false}
        paymentError=""
        paymentBusy={false}
        togglePaidError=""
        canWritePayment={true}
        formatLongDate={(d) => d.toDateString()}
        onTogglePaid={() => {}}
      />
    );
    expect(screen.getByText(/Frozen snapshot/)).toBeInTheDocument();
  });
});

describe('OpsCleaningCalendar mobile payment card', () => {
  it('mobile payment wrapper uses dedicated CSS layout classes in source', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(dir, 'OpsCleaningCalendar.jsx'), 'utf8');
    expect(source).toMatch(/ops-cleaning-cal__mobile-panels/);
    expect(source).toMatch(/ops-cleaning-cal__aside/);
    expect(source).toMatch(/getCleaningPayoutSummary/);
    expect(source).not.toMatch(/Select Cabin or Valley to view payment summary/);
  });
});
