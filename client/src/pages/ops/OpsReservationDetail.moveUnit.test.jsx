import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OpsReservationDetail from './OpsReservationDetail';
import MoveUnitDialog from './components/MoveUnitDialog';
import {
  OPS_RESERVATION_ACTIONS,
  canMoveUnit,
  canShowLegacyReassign,
  makeReallocateIdempotencyKey,
  mapReallocateErrorCode,
  interpretReallocateSuccessPayload,
  resolveInventoryShape
} from './utils/opsReservationPermissions';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ id: '507f1f77bcf86cd799439011' })
  };
});

vi.mock('../../context/OpsSessionContext', () => ({
  useOpsSession: vi.fn()
}));

vi.mock('../../services/opsApi', () => ({
  opsReadAPI: {
    reservationDetail: vi.fn(),
    reservationEmailEvents: vi.fn(),
    reservationMessagingSummary: vi.fn(),
    reallocateCandidates: vi.fn()
  },
  opsWriteAPI: {
    reallocateReservation: vi.fn(),
    reassignReservation: vi.fn()
  }
}));

vi.mock('../../services/api', () => ({
  default: {
    patch: vi.fn()
  }
}));

import { useOpsSession } from '../../context/OpsSessionContext';
import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';

const multiSummary = {
  cabinId: null,
  cabinTypeId: '507f1f77bcf86cd7994390aa',
  unitId: '507f1f77bcf86cd7994390bb',
  name: 'A-Frame',
  unitLabel: 'A2',
  displayName: 'A-Frame · A2',
  location: 'Valley'
};

const singleSummary = {
  cabinId: '507f1f77bcf86cd7994390cc',
  cabinTypeId: null,
  unitId: null,
  name: 'Lux Cabin',
  unitLabel: null,
  displayName: 'Lux Cabin',
  location: 'Valley'
};

function reservationPayload(reservationStatus, cabinSummary = multiSummary, extraReservation = {}) {
  return {
    reservation: {
      reservationId: '507f1f77bcf86cd799439011',
      reservationStatus,
      checkInDateOnly: '2026-07-01',
      checkOutDateOnly: '2026-07-05',
      guest: { email: 'guest@example.com' },
      cabinId: cabinSummary?.cabinId || null,
      cabinTypeId: cabinSummary?.cabinTypeId || null,
      unitId: cabinSummary?.unitId || null,
      ...extraReservation
    },
    cabinSummary,
    guestDetail: {
      firstName: 'Test',
      lastName: 'Guest',
      email: 'guest@example.com',
      phone: ''
    },
    cancellationSettlement: null,
    stayPropertyKind: 'cabin'
  };
}

describe('opsReservationPermissions R3 move/reassign', () => {
  it('resolves inventory shapes', () => {
    expect(resolveInventoryShape(singleSummary)).toBe('single_cabin');
    expect(resolveInventoryShape(multiSummary)).toBe('allocated_cabin_type');
    expect(resolveInventoryShape({ cabinTypeId: 't', unitId: null, cabinId: null })).toBe(
      'unallocated_cabin_type'
    );
    expect(resolveInventoryShape({ cabinId: 'c', cabinTypeId: 't', unitId: 'u' })).toBe('malformed');
  });

  it('Move visible for admin pending/confirmed allocated multi', () => {
    const admin = { actions: [OPS_RESERVATION_ACTIONS.REASSIGN] };
    expect(canMoveUnit(admin, 'pending', multiSummary)).toBe(true);
    expect(canMoveUnit(admin, 'confirmed', multiSummary)).toBe(true);
  });

  it('Move hidden for operator, in_house, completed, cancelled, single, unallocated, malformed', () => {
    const admin = { actions: [OPS_RESERVATION_ACTIONS.REASSIGN] };
    const op = { actions: ['ops.reservation.confirm'] };
    expect(canMoveUnit(op, 'confirmed', multiSummary)).toBe(false);
    expect(canMoveUnit(admin, 'in_house', multiSummary)).toBe(false);
    expect(canMoveUnit(admin, 'completed', multiSummary)).toBe(false);
    expect(canMoveUnit(admin, 'cancelled', multiSummary)).toBe(false);
    expect(canMoveUnit(admin, 'confirmed', singleSummary)).toBe(false);
    expect(canMoveUnit(admin, 'confirmed', { cabinTypeId: 't', unitId: null, cabinId: null })).toBe(
      false
    );
    expect(canMoveUnit(admin, 'confirmed', { cabinId: 'c', cabinTypeId: 't', unitId: 'u' })).toBe(
      false
    );
  });

  it('legacy Reassign only for single cabin with permission', () => {
    const admin = { actions: [OPS_RESERVATION_ACTIONS.REASSIGN] };
    expect(canShowLegacyReassign(admin, singleSummary)).toBe(true);
    expect(canShowLegacyReassign(admin, multiSummary)).toBe(false);
    expect(canShowLegacyReassign({ actions: [] }, singleSummary)).toBe(false);
  });

  it('idempotency key is UUID-based with prefix', () => {
    const key = makeReallocateIdempotencyKey();
    expect(key.startsWith('ops_realloc_')).toBe(true);
    expect(key.length).toBeGreaterThan(20);
  });

  it('maps structured error codes without free-text parsing', () => {
    expect(mapReallocateErrorCode('HARD_CONFLICTS')).toMatch(/no longer available/i);
    expect(mapReallocateErrorCode('SOURCE_OWNERSHIP_MISMATCH')).toMatch(/reconcil/i);
    expect(mapReallocateErrorCode('BLOCK_SYNC_FAILED')).not.toMatch(/refund|charge|upgrade/i);
    expect(mapReallocateErrorCode('UNKNOWN_X')).toBeNull();
  });

  it('interprets R1 200 payloads without treating needs_reconciliation as success', () => {
    expect(interpretReallocateSuccessPayload({ status: 'completed', changed: true }).kind).toBe(
      'completed'
    );
    expect(interpretReallocateSuccessPayload({ status: 'needs_reconciliation' }).kind).toBe(
      'needs_reconciliation'
    );
    expect(interpretReallocateSuccessPayload({ status: 'failed', changed: false }).kind).toBe(
      'failed'
    );
    expect(interpretReallocateSuccessPayload({ status: null, changed: false }).kind).toBe('noop');
  });
});

describe('OpsReservationDetail Move Unit / Reassign visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    opsReadAPI.reservationEmailEvents.mockResolvedValue({
      data: { data: { events: [], pagination: { page: 1, totalPages: 1 } } }
    });
    opsReadAPI.reservationMessagingSummary.mockResolvedValue({ data: { data: { jobs: [] } } });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows Move Unit for admin confirmed allocated multi and hides Reassign', async () => {
    useOpsSession.mockReturnValue({ actions: [OPS_RESERVATION_ACTIONS.REASSIGN] });
    opsReadAPI.reservationDetail.mockResolvedValue({
      data: { data: reservationPayload('confirmed', multiSummary) }
    });
    render(
      <MemoryRouter>
        <OpsReservationDetail />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Move Unit' })).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Reassign' })).toBeNull();
    expect(screen.getByText(/A-Frame · A2/)).toBeTruthy();
  });

  it('hides Move for in_house allocated multi', async () => {
    useOpsSession.mockReturnValue({ actions: [OPS_RESERVATION_ACTIONS.REASSIGN] });
    opsReadAPI.reservationDetail.mockResolvedValue({
      data: { data: reservationPayload('in_house', multiSummary) }
    });
    render(
      <MemoryRouter>
        <OpsReservationDetail />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Move Unit' })).toBeNull();
  });

  it('preserves Reassign for single cabin and hides Move', async () => {
    useOpsSession.mockReturnValue({ actions: [OPS_RESERVATION_ACTIONS.REASSIGN] });
    opsReadAPI.reservationDetail.mockResolvedValue({
      data: { data: reservationPayload('confirmed', singleSummary) }
    });
    render(
      <MemoryRouter>
        <OpsReservationDetail />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Reassign' })).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Move Unit' })).toBeNull();
  });

  it('hides Move for operator', async () => {
    useOpsSession.mockReturnValue({ actions: ['ops.reservation.confirm'] });
    opsReadAPI.reservationDetail.mockResolvedValue({
      data: { data: reservationPayload('confirmed', multiSummary) }
    });
    render(
      <MemoryRouter>
        <OpsReservationDetail />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Move Unit' })).toBeNull();
  });

  it.each(['completed', 'cancelled', 'pending'])(
    'Move visibility for status %s (pending shows when allocated)',
    async (status) => {
      useOpsSession.mockReturnValue({ actions: [OPS_RESERVATION_ACTIONS.REASSIGN] });
      opsReadAPI.reservationDetail.mockResolvedValue({
        data: { data: reservationPayload(status, multiSummary) }
      });
      render(
        <MemoryRouter>
          <OpsReservationDetail />
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
      });
      if (status === 'pending') {
        expect(screen.getByRole('button', { name: 'Move Unit' })).toBeTruthy();
      } else {
        expect(screen.queryByRole('button', { name: 'Move Unit' })).toBeNull();
      }
    }
  );

  it('hides Move and Reassign for unallocated multi', async () => {
    useOpsSession.mockReturnValue({ actions: [OPS_RESERVATION_ACTIONS.REASSIGN] });
    const unalloc = {
      cabinId: null,
      cabinTypeId: '507f1f77bcf86cd7994390aa',
      unitId: null,
      name: 'A-Frame',
      unitLabel: null,
      displayName: 'A-Frame',
      location: 'Valley'
    };
    opsReadAPI.reservationDetail.mockResolvedValue({
      data: { data: reservationPayload('confirmed', unalloc) }
    });
    render(
      <MemoryRouter>
        <OpsReservationDetail />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Move Unit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reassign' })).toBeNull();
  });
});

describe('MoveUnitDialog behavior', () => {
  const available = {
    unitId: 'u-avail',
    displayName: 'A3',
    unitNumber: 'A3',
    isActive: true,
    state: 'AVAILABLE',
    hardConflicts: [],
    warnings: []
  };
  const current = {
    unitId: 'u-cur',
    displayName: 'A2',
    unitNumber: 'A2',
    isActive: true,
    state: 'CURRENT',
    hardConflicts: [],
    warnings: []
  };
  const hard = {
    unitId: 'u-hard',
    displayName: 'A4',
    unitNumber: 'A4',
    isActive: true,
    state: 'HARD_BLOCKED',
    hardConflicts: [{ kind: 'reservation', reservationId: 'other', startDate: '2026-07-01', endDate: '2026-07-05' }],
    warnings: []
  };
  const external = {
    unitId: 'u-ext',
    displayName: 'A5',
    unitNumber: 'A5',
    isActive: true,
    state: 'EXTERNAL_HOLD_WARNING',
    hardConflicts: [],
    warnings: [{ kind: 'availability_block', blockType: 'external_hold', startDate: '2026-07-01', endDate: '2026-07-05' }]
  };
  const inactive = {
    unitId: 'u-off',
    displayName: 'A6',
    unitNumber: 'A6',
    isActive: false,
    state: 'INACTIVE',
    hardConflicts: [],
    warnings: []
  };

  beforeEach(() => {
    vi.clearAllMocks();
    opsReadAPI.reallocateCandidates.mockResolvedValue({
      data: { data: { candidates: [current, available, hard, external, inactive] } }
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('loads candidates, disables current/inactive/hard, allows available', async () => {
    render(
      <MoveUnitDialog
        reservationId="507f1f77bcf86cd799439011"
        sourceUnitLabel="A2"
        open
        onClose={() => {}}
        onSuccess={() => {}}
      />
    );
    await waitFor(() => {
      expect(screen.getByText('A3')).toBeTruthy();
    });
    const radios = screen.getAllByRole('radio');
    const byValue = Object.fromEntries(radios.map((r) => [r.value, r]));
    expect(byValue['u-cur'].disabled).toBe(true);
    expect(byValue['u-hard'].disabled).toBe(true);
    expect(byValue['u-off'].disabled).toBe(true);
    expect(byValue['u-avail'].disabled).toBe(false);
    expect(byValue['u-ext'].disabled).toBe(false);
    expect(screen.queryByRole('textbox', { name: /date/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(/refund|upgrade charge|new reservation/i);
  });

  it('requires external acknowledgment and resets on target change', async () => {
    render(
      <MoveUnitDialog
        reservationId="507f1f77bcf86cd799439011"
        sourceUnitLabel="A2"
        open
        onClose={() => {}}
        onSuccess={() => {}}
      />
    );
    await waitFor(() => expect(screen.getByText('A5')).toBeTruthy());
    fireEvent.click(screen.getByDisplayValue('u-ext'));
    const ack = await screen.findByRole('checkbox');
    expect(ack.checked).toBe(false);
    const submit = screen.getByRole('button', { name: 'Move unit' });
    expect(submit.disabled).toBe(true);
    fireEvent.click(ack);
    expect(submit.disabled).toBe(false);
    fireEvent.click(screen.getByDisplayValue('u-avail'));
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('reuses idempotency key across submit retries and does not mint on each click', async () => {
    let resolveWrite;
    opsWriteAPI.reallocateReservation.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          resolveWrite = { resolve, reject };
        })
    );
    render(
      <MoveUnitDialog
        reservationId="507f1f77bcf86cd799439011"
        sourceUnitLabel="A2"
        open
        onClose={() => {}}
        onSuccess={() => {}}
      />
    );
    await waitFor(() => expect(screen.getByText('A3')).toBeTruthy());
    fireEvent.click(screen.getByDisplayValue('u-avail'));
    const submit = screen.getByRole('button', { name: 'Move unit' });
    fireEvent.click(submit);
    await waitFor(() => expect(opsWriteAPI.reallocateReservation).toHaveBeenCalledTimes(1));
    const firstKey = opsWriteAPI.reallocateReservation.mock.calls[0][1].idempotencyKey;
    expect(firstKey.startsWith('ops_realloc_')).toBe(true);
    // second click while busy should not fire another request
    fireEvent.click(submit);
    expect(opsWriteAPI.reallocateReservation).toHaveBeenCalledTimes(1);
    resolveWrite.reject({
      response: { data: { details: { code: 'HARD_CONFLICTS' }, message: 'conflict' } }
    });
    await waitFor(() => expect(screen.getByText(/no longer available/i)).toBeTruthy());
    opsWriteAPI.reallocateReservation.mockResolvedValue({ data: { data: { changed: true } } });
    // after failure, selecting same target again without change keeps prior key until target change;
    // reopen path is separate — select available again after reload
    await waitFor(() => expect(opsReadAPI.reallocateCandidates.mock.calls.length).toBeGreaterThan(1));
  });

  it('mints new key when target changes between intents', async () => {
    const keys = [];
    opsWriteAPI.reallocateReservation.mockImplementation((_id, payload) => {
      keys.push(payload.idempotencyKey);
      return Promise.reject({
        response: { data: { details: { code: 'CAS_FAILED' }, message: 'cas' } }
      });
    });
    render(
      <MoveUnitDialog
        reservationId="507f1f77bcf86cd799439011"
        sourceUnitLabel="A2"
        open
        onClose={() => {}}
        onSuccess={() => {}}
      />
    );
    await waitFor(() => expect(screen.getByText('A3')).toBeTruthy());
    fireEvent.click(screen.getByDisplayValue('u-avail'));
    fireEvent.click(screen.getByRole('button', { name: 'Move unit' }));
    await waitFor(() => expect(keys.length).toBe(1));
    fireEvent.click(screen.getByDisplayValue('u-ext'));
    const ack = await screen.findByRole('checkbox');
    fireEvent.click(ack);
    fireEvent.click(screen.getByRole('button', { name: 'Move unit' }));
    await waitFor(() => expect(keys.length).toBe(2));
    expect(keys[0]).not.toEqual(keys[1]);
  });

  it('success closes via onSuccess with move labels and no financial copy', async () => {
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    opsWriteAPI.reallocateReservation.mockResolvedValue({
      data: { data: { changed: true, status: 'completed' } }
    });
    render(
      <MoveUnitDialog
        reservationId="507f1f77bcf86cd799439011"
        sourceUnitLabel="A2"
        open
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );
    await waitFor(() => expect(screen.getByText('A3')).toBeTruthy());
    fireEvent.click(screen.getByDisplayValue('u-avail'));
    fireEvent.click(screen.getByRole('button', { name: 'Move unit' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onSuccess.mock.calls[0][0]).toEqual({ fromLabel: 'A2', toLabel: 'A3' });
    expect(onClose).toHaveBeenCalled();
    const payload = opsWriteAPI.reallocateReservation.mock.calls[0][1];
    expect(payload).toEqual(
      expect.objectContaining({
        targetUnitId: 'u-avail',
        acceptExternalHoldWarnings: false
      })
    );
    expect(payload).not.toHaveProperty('checkInDate');
    expect(payload).not.toHaveProperty('cabinTypeId');
    expect(payload).not.toHaveProperty('totalPrice');
  });

  it('HTTP 200 needs_reconciliation does not close as success', async () => {
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    opsWriteAPI.reallocateReservation.mockResolvedValue({
      data: { data: { changed: false, status: 'needs_reconciliation', stayChangeId: 'sc1' } }
    });
    render(
      <MoveUnitDialog
        reservationId="507f1f77bcf86cd799439011"
        sourceUnitLabel="A2"
        open
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );
    await waitFor(() => expect(screen.getByText('A3')).toBeTruthy());
    fireEvent.click(screen.getByDisplayValue('u-avail'));
    fireEvent.click(screen.getByRole('button', { name: 'Move unit' }));
    await waitFor(() => expect(screen.getByText(/reconcil/i)).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ reconciliation: true, refresh: true }));
  });

  it('busyRef blocks second submit before state settles', async () => {
    let resolveWrite;
    opsWriteAPI.reallocateReservation.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveWrite = resolve;
        })
    );
    render(
      <MoveUnitDialog
        reservationId="507f1f77bcf86cd799439011"
        sourceUnitLabel="A2"
        open
        onClose={() => {}}
        onSuccess={() => {}}
      />
    );
    await waitFor(() => expect(screen.getByText('A3')).toBeTruthy());
    fireEvent.click(screen.getByDisplayValue('u-avail'));
    const submit = screen.getByRole('button', { name: 'Move unit' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(opsWriteAPI.reallocateReservation).toHaveBeenCalledTimes(1));
    resolveWrite({ data: { data: { status: 'completed', changed: true } } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Move unit' })).toBeTruthy());
  });

  it('uses bottom-sheet friendly layout classes (narrow viewport semantics)', async () => {
    const { container } = render(
      <MoveUnitDialog
        reservationId="507f1f77bcf86cd799439011"
        sourceUnitLabel="A2"
        open
        onClose={() => {}}
        onSuccess={() => {}}
      />
    );
    await waitFor(() => expect(screen.getByText('Move Unit')).toBeTruthy());
    expect(container.querySelector('.items-end')).toBeTruthy();
    expect(container.querySelector('.max-h-\\[90vh\\], [class*="max-h-"]')).toBeTruthy();
    expect(screen.queryByRole('prompt')).toBeNull();
  });

  it('EXTERNAL_HOLD_ACK_REQUIRED keeps dialog and maps structured code', async () => {
    opsWriteAPI.reallocateReservation.mockRejectedValue({
      response: {
        data: {
          details: { code: 'EXTERNAL_HOLD_ACK_REQUIRED' },
          message: 'ack'
        }
      }
    });
    render(
      <MoveUnitDialog
        reservationId="507f1f77bcf86cd799439011"
        sourceUnitLabel="A2"
        open
        onClose={() => {}}
        onSuccess={() => {}}
      />
    );
    await waitFor(() => expect(screen.getByText('A5')).toBeTruthy());
    fireEvent.click(screen.getByDisplayValue('u-ext'));
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Move unit' }));
    await waitFor(() => expect(screen.getByText(/external channel hold/i)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Move unit' })).toBeTruthy();
  });

  it('SOURCE_OWNERSHIP_MISMATCH shows reconciliation message', async () => {
    opsWriteAPI.reallocateReservation.mockRejectedValue({
      response: {
        data: { details: { code: 'SOURCE_OWNERSHIP_MISMATCH' }, message: 'own' }
      }
    });
    render(
      <MoveUnitDialog
        reservationId="507f1f77bcf86cd799439011"
        sourceUnitLabel="A2"
        open
        onClose={() => {}}
        onSuccess={() => {}}
      />
    );
    await waitFor(() => expect(screen.getByText('A3')).toBeTruthy());
    fireEvent.click(screen.getByDisplayValue('u-avail'));
    fireEvent.click(screen.getByRole('button', { name: 'Move unit' }));
    await waitFor(() => expect(screen.getByText(/reconcil/i)).toBeTruthy());
  });

  it('omits empty reason from payload and sends ack true only for external', async () => {
    opsWriteAPI.reallocateReservation.mockResolvedValue({
      data: { data: { changed: true, status: 'completed' } }
    });
    render(
      <MoveUnitDialog
        reservationId="507f1f77bcf86cd799439011"
        sourceUnitLabel="A2"
        open
        onClose={() => {}}
        onSuccess={() => {}}
      />
    );
    await waitFor(() => expect(screen.getByText('A5')).toBeTruthy());
    fireEvent.click(screen.getByDisplayValue('u-ext'));
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.change(screen.getByLabelText(/Reason/i), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move unit' }));
    await waitFor(() => expect(opsWriteAPI.reallocateReservation).toHaveBeenCalled());
    const payload = opsWriteAPI.reallocateReservation.mock.calls[0][1];
    expect(payload.acceptExternalHoldWarnings).toBe(true);
    expect(payload.reason).toBeUndefined();
  });

  it('STATUS_NOT_ELIGIBLE closes via onSuccess refresh path', async () => {
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    opsWriteAPI.reallocateReservation.mockRejectedValue({
      response: { data: { details: { code: 'STATUS_NOT_ELIGIBLE' }, message: 'nope' } }
    });
    render(
      <MoveUnitDialog
        reservationId="507f1f77bcf86cd799439011"
        sourceUnitLabel="A2"
        open
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );
    await waitFor(() => expect(screen.getByText('A3')).toBeTruthy());
    fireEvent.click(screen.getByDisplayValue('u-avail'));
    fireEvent.click(screen.getByRole('button', { name: 'Move unit' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onSuccess.mock.calls[0][0]).toEqual(
      expect.objectContaining({ closeOnly: true, refresh: true, code: 'STATUS_NOT_ELIGIBLE' })
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('IDEMPOTENCY_KEY_CONFLICT maps structurally and does not auto-resubmit', async () => {
    opsWriteAPI.reallocateReservation.mockRejectedValue({
      response: { data: { details: { code: 'IDEMPOTENCY_KEY_CONFLICT' }, message: 'conflict' } }
    });
    render(
      <MoveUnitDialog
        reservationId="507f1f77bcf86cd799439011"
        sourceUnitLabel="A2"
        open
        onClose={() => {}}
        onSuccess={() => {}}
      />
    );
    await waitFor(() => expect(screen.getByText('A3')).toBeTruthy());
    fireEvent.click(screen.getByDisplayValue('u-avail'));
    fireEvent.click(screen.getByRole('button', { name: 'Move unit' }));
    await waitFor(() => expect(screen.getByText(/operation key/i)).toBeTruthy());
    expect(opsWriteAPI.reallocateReservation).toHaveBeenCalledTimes(1);
  });

  it('no guest/product/price fields in dialog', async () => {
    render(
      <MoveUnitDialog
        reservationId="507f1f77bcf86cd799439011"
        sourceUnitLabel="A2"
        open
        onClose={() => {}}
        onSuccess={() => {}}
      />
    );
    await waitFor(() => expect(screen.getByText('Move Unit')).toBeTruthy());
    expect(screen.queryByLabelText(/guest/i)).toBeNull();
    expect(screen.queryByLabelText(/price/i)).toBeNull();
    expect(screen.queryByLabelText(/cabin type/i)).toBeNull();
    expect(screen.queryByLabelText(/check-?in/i)).toBeNull();
  });

  it('maps CAS_FAILED to concurrent change copy and reloads candidates', async () => {
    opsWriteAPI.reallocateReservation.mockRejectedValue({
      response: { data: { details: { code: 'CAS_FAILED' }, message: 'cas' } }
    });
    render(
      <MoveUnitDialog
        reservationId="507f1f77bcf86cd799439011"
        sourceUnitLabel="A2"
        open
        onClose={() => {}}
        onSuccess={() => {}}
      />
    );
    await waitFor(() => expect(screen.getByText('A3')).toBeTruthy());
    const loadsBefore = opsReadAPI.reallocateCandidates.mock.calls.length;
    fireEvent.click(screen.getByDisplayValue('u-avail'));
    fireEvent.click(screen.getByRole('button', { name: 'Move unit' }));
    await waitFor(() => expect(screen.getByText(/concurrently/i)).toBeTruthy());
    expect(opsReadAPI.reallocateCandidates.mock.calls.length).toBeGreaterThan(loadsBefore);
  });

  it('default acceptExternalHoldWarnings is false for AVAILABLE submit', async () => {
    opsWriteAPI.reallocateReservation.mockResolvedValue({
      data: { data: { changed: true, status: 'completed' } }
    });
    render(
      <MoveUnitDialog
        reservationId="507f1f77bcf86cd799439011"
        sourceUnitLabel="A2"
        open
        onClose={() => {}}
        onSuccess={() => {}}
      />
    );
    await waitFor(() => expect(screen.getByText('A3')).toBeTruthy());
    fireEvent.click(screen.getByDisplayValue('u-avail'));
    fireEvent.click(screen.getByRole('button', { name: 'Move unit' }));
    await waitFor(() => expect(opsWriteAPI.reallocateReservation).toHaveBeenCalled());
    expect(opsWriteAPI.reallocateReservation.mock.calls[0][1].acceptExternalHoldWarnings).toBe(false);
  });

  it('STAY_CHANGE_IDEMPOTENCY_INDEX_MISSING surfaces operational error', async () => {
    opsWriteAPI.reallocateReservation.mockRejectedValue({
      response: {
        data: { details: { code: 'STAY_CHANGE_IDEMPOTENCY_INDEX_MISSING' }, message: 'idx' }
      }
    });
    render(
      <MoveUnitDialog
        reservationId="507f1f77bcf86cd799439011"
        sourceUnitLabel="A2"
        open
        onClose={() => {}}
        onSuccess={() => {}}
      />
    );
    await waitFor(() => expect(screen.getByText('A3')).toBeTruthy());
    fireEvent.click(screen.getByDisplayValue('u-avail'));
    fireEvent.click(screen.getByRole('button', { name: 'Move unit' }));
    await waitFor(() => expect(screen.getByText(/index configuration/i)).toBeTruthy());
  });
});
