import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OpsIssueManualVoucher from './OpsIssueManualVoucher';
import { opsWriteAPI } from '../../services/opsApi';

vi.mock('../../services/opsApi', () => ({
  opsWriteAPI: { issueManualGiftVoucher: vi.fn() }
}));

const success = {
  data: { data: {
    giftVoucherId: 'voucher-1', code: 'DD-MANUAL-TEST',
    balanceRemainingCents: 26000, currency: 'EUR', expiresAt: '2027-10-25T10:00:00.000Z'
  } }
};
const onIssued = vi.fn();
function open() {
  render(<MemoryRouter><OpsIssueManualVoucher onIssued={onIssued} /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Issue Manual Voucher' }));
  fireEvent.change(screen.getByLabelText('Internal reason'), { target: { value: 'Approved goodwill' } });
}
beforeEach(() => {
  vi.clearAllMocks();
  opsWriteAPI.issueManualGiftVoucher.mockResolvedValue(success);
});
afterEach(cleanup);

it('issues EUR260 with optional recipients and internal reason and shows code, balance, expiry and detail link', async () => {
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Issue Manual Voucher' }));
  await screen.findByText('DD-MANUAL-TEST');
  expect(opsWriteAPI.issueManualGiftVoucher).toHaveBeenCalledWith({
    amountCents: 26000, recipientName: '', recipientEmail: '', reason: 'Approved goodwill',
    idempotencyKey: expect.stringMatching(/^ops_manual_/)
  });
  expect(screen.getByText(/Balance:/)).toHaveTextContent('260');
  expect(screen.getByText(/Expires:/)).toHaveTextContent('2027');
  expect(screen.getByRole('link')).toHaveAttribute('href', '/ops/gift-vouchers/voucher-1');
  expect(onIssued).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Approved goodwill')).not.toBeInTheDocument();
});

it('reuses the exact request after an uncertain failure and prevents editing into accidental duplicate credit', async () => {
  opsWriteAPI.issueManualGiftVoucher.mockRejectedValueOnce(new Error('network failure')).mockResolvedValue(success);
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Issue Manual Voucher' }));
  const retry = await screen.findByRole('button', { name: 'Retry same issuance' });
  expect(screen.getByLabelText('Amount (EUR)')).toBeDisabled();
  fireEvent.click(retry);
  await screen.findByText('DD-MANUAL-TEST');
  expect(opsWriteAPI.issueManualGiftVoucher.mock.calls[1][0]).toEqual(opsWriteAPI.issueManualGiftVoucher.mock.calls[0][0]);
  expect(onIssued).toHaveBeenCalledTimes(1);
});

it('prevents double submit while issuance is pending', async () => {
  let resolve;
  opsWriteAPI.issueManualGiftVoucher.mockImplementation(() => new Promise((done) => { resolve = done; }));
  open();
  const form = screen.getByRole('button', { name: 'Issue Manual Voucher' }).closest('form');
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(opsWriteAPI.issueManualGiftVoucher).toHaveBeenCalledTimes(1);
  resolve(success);
  await screen.findByText('DD-MANUAL-TEST');
});

it('allows correction after a definitive validation rejection', async () => {
  opsWriteAPI.issueManualGiftVoucher.mockRejectedValueOnce({ response: { status: 400, data: { message: 'Invalid recipient' } } });
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Issue Manual Voucher' }));
  await screen.findByText('Invalid recipient');
  expect(screen.getByLabelText('Amount (EUR)')).not.toBeDisabled();
});

it('rejects sub-cent amounts before sending', async () => {
  open();
  fireEvent.change(screen.getByLabelText('Amount (EUR)'), { target: { value: '260.001' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Issue Manual Voucher' }).closest('form'));
  await waitFor(() => expect(screen.getByText(/no more than two decimal places/)).toBeInTheDocument());
  expect(opsWriteAPI.issueManualGiftVoucher).not.toHaveBeenCalled();
});
