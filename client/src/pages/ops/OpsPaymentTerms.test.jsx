import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import OpsPaymentTerms from './OpsPaymentTerms';

vi.mock('../../services/api', () => ({
  paymentTermAdminAPI: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    activate: vi.fn(),
    retire: vi.fn(),
    clone: vi.fn()
  }
}));

import { paymentTermAdminAPI } from '../../services/api';

const legs = [
  {
    sequence: 1,
    amountType: 'percent_bps',
    amountValue: 3000,
    dueRule: 'checkout',
    dueOffsetDays: 0,
    cancellationTreatment: 'stay_credit'
  },
  {
    sequence: 2,
    amountType: 'remainder',
    amountValue: null,
    dueRule: 'days_before_arrival',
    dueOffsetDays: 30,
    cancellationTreatment: 'standard_policy'
  }
];

function term(status, id) {
  return {
    id,
    code: 'split-30',
    internalName: `${status} term`,
    version: status === 'draft' ? 1 : 2,
    status,
    revision: 4,
    scheduleKind: 'percent_split',
    currency: 'EUR',
    allowDateTransfer: false,
    legs
  };
}

describe('OpsPaymentTerms draft leg editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    paymentTermAdminAPI.list.mockResolvedValue({
      data: { data: { paymentTerms: [term('draft', 'draft-1'), term('active', 'active-1')] } }
    });
    paymentTermAdminAPI.update.mockResolvedValue({ data: { success: true } });
  });

  afterEach(cleanup);

  it('persists a draft amount change while active terms remain read-only', async () => {
    render(<OpsPaymentTerms />);

    const draftSelector = await screen.findByRole('button', { name: /split-30@v1 draft/i });
    fireEvent.click(draftSelector);

    const amount = screen.getByLabelText('Leg 1 amount value');
    expect(amount).toHaveValue(3000);
    fireEvent.change(amount, { target: { value: '4000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => {
      expect(paymentTermAdminAPI.update).toHaveBeenCalledWith(
        'draft-1',
        expect.objectContaining({
          expectedRevision: 4,
          legs: expect.arrayContaining([
            expect.objectContaining({ sequence: 1, amountType: 'percent_bps', amountValue: 4000 })
          ])
        })
      );
    });

    fireEvent.click(screen.getByRole('button', { name: /split-30@v2 active/i }));
    expect(screen.queryByLabelText('Leg 1 amount value')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    expect(screen.getByText('Active/retired templates cannot be edited in place.')).toBeInTheDocument();
  });
});
