import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReassignReservationDialog from './ReassignReservationDialog';
import { opsReadAPI, opsWriteAPI } from '../../../services/opsApi';

vi.mock('../../../services/opsApi', () => ({
  opsReadAPI: { rebookCandidates: vi.fn() },
  opsWriteAPI: { rebookReservation: vi.fn(), reassignReservation: vi.fn() }
}));

const cabin = {
  id: 'target', label: 'Forest Cabin', targetCabinId: 'target',
  capacity: 4, canonicalTargetQuoteCents: 20000, differenceCents: 0
};
const preview = {
  checkInDateOnly: '2026-11-02', checkOutDateOnly: '2026-11-04',
  adults: 2, children: 0, contractualTotalCents: 20000, transferableValueCents: 20000,
  candidates: [cabin, {
    id: 'unit', label: 'A-Frame - Unit 2', targetCabinTypeId: 'type', targetUnitId: 'unit',
    capacity: 3, canonicalTargetQuoteCents: 25000, differenceCents: 5000, externalHoldWarning: true
  }]
};

async function setup() {
  const onSuccess = vi.fn();
  const onClose = vi.fn();
  render(<ReassignReservationDialog open reservationId="source" sourceLabel="Original Cabin"
    onSuccess={onSuccess} onClose={onClose} />);
  await screen.findByRole('option', { name: /Forest Cabin/ });
  return { onSuccess, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  opsReadAPI.rebookCandidates.mockResolvedValue({ data: { data: preview } });
});
afterEach(cleanup);

describe('reservation reassignment', () => {
  it('loads eligible names and dates, with a searchable keyboard-accessible dropdown', async () => {
    await setup();
    expect(opsReadAPI.rebookCandidates).toHaveBeenCalledWith('source');
    expect(screen.queryByLabelText('Target cabinId')).not.toBeInTheDocument();
    expect(screen.getByText(/2026-11-02 to 2026-11-04/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search accommodations'), { target: { value: 'a-frame' } });
    expect(screen.queryByRole('option', { name: /Forest Cabin/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /A-Frame - Unit 2/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm reassignment' })).toBeDisabled();
  });

  it('requires destination confirmation, uses only REBOOK and refreshes after completion', async () => {
    opsWriteAPI.rebookReservation.mockResolvedValue({
      data: { data: { status: 'completed', targetBookingId: 'replacement' } }
    });
    const { onSuccess, onClose } = await setup();
    fireEvent.change(screen.getByLabelText('Destination accommodation'), { target: { value: 'target' } });
    expect(screen.getByRole('button', { name: 'Confirm reassignment' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Confirm reassignment to Forest Cabin/));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reassignment' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({
      targetBookingId: 'replacement', destinationLabel: 'Forest Cabin'
    })));
    expect(onClose).toHaveBeenCalledOnce();
    expect(opsWriteAPI.reassignReservation).not.toHaveBeenCalled();
    expect(opsWriteAPI.rebookReservation).toHaveBeenCalledWith('source', {
      targetCabinId: 'target', idempotencyKey: expect.stringMatching(/^ops_rebook_/),
      waiveUpgradeCents: 0, acceptExternalHoldWarnings: false, reason: 'ops_reassign'
    });
  });

  it('requires explicit external hold and complimentary upgrade acknowledgements for a physical unit', async () => {
    await setup();
    fireEvent.change(screen.getByLabelText('Destination accommodation'), { target: { value: 'unit' } });
    fireEvent.click(screen.getByLabelText(/Confirm reassignment to A-Frame/));
    expect(screen.getByRole('button', { name: 'Confirm reassignment' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Approve a full complimentary upgrade/));
    expect(screen.getByRole('button', { name: 'Confirm reassignment' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/I acknowledge the external channel hold/));
    opsWriteAPI.rebookReservation.mockResolvedValue({ data: { data: { status: 'completed', targetBookingId: 'replacement' } } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reassignment' }));
    await waitFor(() => expect(opsWriteAPI.rebookReservation).toHaveBeenCalledWith('source',
      expect.objectContaining({ targetCabinTypeId: 'type', targetUnitId: 'unit', waiveUpgradeCents: 5000, acceptExternalHoldWarnings: true })));
  });

  it('surfaces conflicts, locks the intent and reuses the identical key on retry', async () => {
    opsWriteAPI.rebookReservation.mockRejectedValue({
      response: { data: { details: { code: 'HARD_CONFLICTS' } } }
    });
    const { onSuccess } = await setup();
    fireEvent.change(screen.getByLabelText('Destination accommodation'), { target: { value: 'target' } });
    fireEvent.click(screen.getByLabelText(/Confirm reassignment to Forest Cabin/));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reassignment' }));
    await screen.findByText(/no longer available/);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Destination accommodation')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry same reassignment' }));
    await waitFor(() => expect(opsWriteAPI.rebookReservation).toHaveBeenCalledTimes(2));
    expect(opsWriteAPI.rebookReservation.mock.calls[1]).toEqual(opsWriteAPI.rebookReservation.mock.calls[0]);
  });

  it('shows permission errors without offering a mutation', async () => {
    opsReadAPI.rebookCandidates.mockRejectedValue({ response: { status: 403 } });
    render(<ReassignReservationDialog open reservationId="source" onClose={vi.fn()} onSuccess={vi.fn()} />);
    await screen.findByText(/do not have permission/);
    expect(screen.getByRole('button', { name: 'Confirm reassignment' })).toBeDisabled();
    expect(opsWriteAPI.rebookReservation).not.toHaveBeenCalled();
  });

  it('does not report reconciliation as a completed reassignment', async () => {
    opsWriteAPI.rebookReservation.mockResolvedValue({ data: { data: { status: 'needs_reconciliation' } } });
    const { onSuccess, onClose } = await setup();
    fireEvent.change(screen.getByLabelText('Destination accommodation'), { target: { value: 'target' } });
    fireEvent.click(screen.getByLabelText(/Confirm reassignment to Forest Cabin/));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reassignment' }));
    await screen.findByText(/has not completed/);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
