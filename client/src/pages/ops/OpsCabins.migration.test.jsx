import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import OpsCabinDetail from './OpsCabins';

vi.mock('../../services/opsApi', () => ({
  opsReadAPI: {
    cabinDetail: vi.fn()
  },
  opsWriteAPI: {
    archiveCabin: vi.fn(),
    updateCabinContent: vi.fn()
  }
}));

import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';

function detailPayload(kind = 'single_cabin', overrides = {}) {
  const isMulti = kind === 'multi_unit_type';
  return {
    data: {
      data: {
        kind,
        cabinId: isMulti ? undefined : 'cabin-1',
        cabinTypeId: isMulti ? 'type-1' : undefined,
        slug: isMulti ? 'a-frame' : undefined,
        operationalSettings: {
          capacity: 2,
          minNights: 1,
          blockedDates: [],
          blockedDatesCount: 0,
          unitBlockedDatesSummary: { totalBlockedDateEntries: 0, unitsWithBlockedDates: 0 }
        },
        contentMedia: {
          name: isMulti ? 'A-Frame' : 'Stone House',
          location: 'Rhodope',
          imageUrl: null
        },
        preArrival: { packingList: [] },
        degraded: {},
        units: isMulti ? [{ unitId: 'u1', unitNumber: 1, isActive: true, blockedDatesCount: 0 }] : undefined,
        ...overrides
      }
    }
  };
}

function renderDetail(id, state) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: `/ops/cabins/${id}`, state }]}>
      <Routes>
        <Route path="/ops/cabins/:id" element={<OpsCabinDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('OpsCabinDetail migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    opsReadAPI.cabinDetail.mockResolvedValue(detailPayload());
  });

  afterEach(() => {
    cleanup();
  });

  it('uses OpsPage default with Back to cabins and ops surfaces', async () => {
    renderDetail('cabin-1');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Stone House' })).toBeInTheDocument();
    });
    expect(document.querySelector('.ops-page')).toHaveAttribute('data-ops-page-width', 'default');
    expect(screen.getByRole('link', { name: 'Back to cabins' })).toHaveAttribute('href', '/ops/cabins');
    expect(document.querySelector('.ops-cd-surface')).toBeTruthy();
    expect(screen.getByText('Single cabin')).toBeInTheDocument();
    expect(screen.getByText('Edit content')).toBeInTheDocument();
    expect(screen.getByText('Archive cabin')).toBeInTheDocument();
  });

  it('keeps header and OpsLoadingState while detail read is pending', () => {
    opsReadAPI.cabinDetail.mockReturnValue(new Promise(() => {}));
    renderDetail('cabin-1');
    expect(screen.getByRole('heading', { name: 'Cabin' })).toBeInTheDocument();
    expect(screen.getByText(/Loading cabin/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to cabins' })).toHaveAttribute('href', '/ops/cabins');
    expect(document.querySelector('.ops-page')).toHaveAttribute('data-ops-page-width', 'default');
  });

  it('shows OpsBanner danger on load error with header still visible', async () => {
    opsReadAPI.cabinDetail.mockRejectedValue({
      response: { data: { message: 'Cabin detail boom' } }
    });
    renderDetail('cabin-1');
    await waitFor(() => {
      expect(screen.getByText('Cabin detail boom')).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'Cabin' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to cabins' })).toBeInTheDocument();
    expect(document.querySelector('.ops-banner--danger')).toBeTruthy();
  });

  it('shows degraded warnings as OpsBanner warning', async () => {
    opsReadAPI.cabinDetail.mockResolvedValue(
      detailPayload('multi_unit_type', {
        degraded: { missingGeo: true, emptyInventory: true }
      })
    );
    renderDetail('type-1');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'A-Frame' })).toBeInTheDocument();
    });
    expect(screen.getByText('Degraded: missing geo coordinates.')).toBeInTheDocument();
    expect(screen.getByText('Degraded: no units linked to this cabin type.')).toBeInTheDocument();
    expect(document.querySelectorAll('.ops-banner--warning').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Multi-unit type')).toBeInTheDocument();
    expect(screen.queryByText('Archive cabin')).not.toBeInTheDocument();
  });

  it('opens archive modal and cancels without archiving', async () => {
    renderDetail('cabin-1');
    await waitFor(() => {
      expect(screen.getByText('Archive cabin')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Archive cabin' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/Confirm cabin name/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(opsWriteAPI.archiveCabin).not.toHaveBeenCalled();
  });

  it('retains content edit open with section error when write fails', async () => {
    opsWriteAPI.updateCabinContent.mockRejectedValue({
      response: { data: { message: 'Content write boom' } }
    });
    renderDetail('cabin-1');
    await waitFor(() => {
      expect(screen.getByText('Edit content')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit content' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Edit content' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));
    await waitFor(() => {
      expect(screen.getAllByText('Content write boom').length).toBeGreaterThan(0);
    });
    expect(screen.getByRole('heading', { name: 'Edit content' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Stone House')).toBeInTheDocument();
  });
});
