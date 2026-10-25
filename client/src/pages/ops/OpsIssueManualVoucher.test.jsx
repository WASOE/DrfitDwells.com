import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useState } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
function Harness() {
  const [isOpen, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open issuance</button>
      <OpsIssueManualVoucher open={isOpen} onClose={() => setOpen(false)} onIssued={onIssued} />
    </>
  );
}
function open() {
  render(<MemoryRouter><Harness /></MemoryRouter>);
  screen.getByRole('button', { name: 'Open issuance' }).focus();
  fireEvent.click(screen.getByRole('button', { name: 'Open issuance' }));
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
  expect(screen.getByText('Balance').parentElement).toHaveTextContent('260');
  expect(screen.getByText('Expires').parentElement).toHaveTextContent('2027');
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
  expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(document.querySelector('.ops-overlay__scrim'));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.click(retry);
  await screen.findByText('DD-MANUAL-TEST');
  expect(opsWriteAPI.issueManualGiftVoucher.mock.calls[1][0]).toEqual(opsWriteAPI.issueManualGiftVoucher.mock.calls[0][0]);
  expect(onIssued).toHaveBeenCalledTimes(1);
});

it('prevents double submit while issuance is pending', async () => {
  let resolve;
  opsWriteAPI.issueManualGiftVoucher.mockImplementation(() => new Promise((done) => { resolve = done; }));
  open();
  const form = document.getElementById(screen.getByRole('button', { name: 'Issue Manual Voucher' }).getAttribute('form'));
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(opsWriteAPI.issueManualGiftVoucher).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(document.querySelector('.ops-overlay__scrim'));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
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
  fireEvent.submit(document.getElementById(screen.getByRole('button', { name: 'Issue Manual Voucher' }).getAttribute('form')));
  await waitFor(() => expect(screen.getByText(/no more than two decimal places/)).toBeInTheDocument());
  expect(opsWriteAPI.issueManualGiftVoucher).not.toHaveBeenCalled();
});

it('focuses the amount, traps keyboard focus, and restores the trigger after Escape', async () => {
  open();
  const amount = screen.getByLabelText('Amount (EUR)');
  await waitFor(() => expect(amount).toHaveFocus());
  const dialog = screen.getByRole('dialog', { name: 'Issue Manual Voucher' });
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(dialog).toHaveAccessibleDescription(/No payment is taken and no email is sent automatically/);
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
  expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
  expect(screen.getByRole('button', { name: 'Issue Manual Voucher' })).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Open issuance' })).toHaveFocus());
});

it('issues another voucher with a fresh form and key without closing or reloading', async () => {
  open();
  fireEvent.change(screen.getByLabelText(/Recipient name/), { target: { value: 'Recipient' } });
  fireEvent.click(screen.getByRole('button', { name: 'Issue Manual Voucher' }));
  await screen.findByText('DD-MANUAL-TEST');
  expect(screen.getByText('DD-MANUAL-TEST').parentElement).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Issue Another Voucher' }));
  expect(screen.getByRole('dialog', { name: 'Issue Manual Voucher' })).toBeInTheDocument();
  expect(screen.getByLabelText('Amount (EUR)')).toHaveValue(260);
  expect(screen.getByLabelText('Amount (EUR)')).toHaveFocus();
  expect(screen.getByLabelText(/Recipient name/)).toHaveValue('');
  expect(screen.getByLabelText('Internal reason')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('Internal reason'), { target: { value: 'Second approval' } });
  fireEvent.click(screen.getByRole('button', { name: 'Issue Manual Voucher' }));
  await screen.findByText('DD-MANUAL-TEST');
  const [first, second] = opsWriteAPI.issueManualGiftVoucher.mock.calls.map(([request]) => request);
  expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  expect(second.reason).toBe('Second approval');
  expect(onIssued).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it.each(['14.99', '0', '-15', ''])('rejects invalid amount %s and whitespace reasons without writing', (value) => {
  open();
  fireEvent.change(screen.getByLabelText('Amount (EUR)'), { target: { value } });
  fireEvent.submit(document.querySelector('form'));
  expect(screen.getByRole('alert')).toHaveTextContent('at least 15');
  expect(opsWriteAPI.issueManualGiftVoucher).not.toHaveBeenCalled();
});

it('rejects a whitespace-only internal reason', () => {
  open();
  fireEvent.change(screen.getByLabelText('Internal reason'), { target: { value: '   ' } });
  fireEvent.submit(document.querySelector('form'));
  expect(screen.getByRole('alert')).toHaveTextContent('An internal reason is required');
  expect(opsWriteAPI.issueManualGiftVoucher).not.toHaveBeenCalled();
});

it('uses token spacing and a single-column mobile / two-column desktop form contract', () => {
  const css = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'OpsIssueManualVoucher.css'), 'utf8');
  expect(css).toContain('grid-template-columns: minmax(0, 1fr)');
  expect(css).toContain('@media (min-width: 640px)');
  expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
  expect(css).toContain('gap: var(--ops-space-12)');
});
