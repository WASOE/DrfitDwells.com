import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

import { opsReadAPI } from '../../services/opsApi';

const here = path.dirname(fileURLToPath(import.meta.url));
const detailSource = fs.readFileSync(path.join(here, 'OpsCabins.jsx'), 'utf8');

function detailPayload(kind = 'single_cabin') {
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
        units: isMulti ? [{ unitId: 'u1', unitNumber: 1, isActive: true, blockedDatesCount: 0 }] : undefined
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

describe('OpsCabinDetail after list extraction', () => {
  beforeEach(() => {
    opsReadAPI.cabinDetail.mockReset();
    opsReadAPI.cabinDetail.mockResolvedValue(detailPayload());
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps the default export and does not re-export the list', () => {
    expect(detailSource).toContain('export default function OpsCabinDetail()');
    expect(detailSource).not.toMatch(/export function OpsCabinsList|CreateCabinModal|listHref|listRowId/);
    expect(detailSource).toContain('opsReadAPI.cabinDetail(id)');
    expect(detailSource).toContain("opsFlash !== 'cabin-created'");
  });

  it('loads /ops/cabins/:id through cabinDetail(id)', async () => {
    renderDetail('cabin-1');
    await waitFor(() => {
      expect(opsReadAPI.cabinDetail).toHaveBeenCalledWith('cabin-1');
    });
    expect(screen.getByRole('heading', { name: 'Stone House' })).toBeInTheDocument();
    expect(screen.getByText('Back to cabins')).toHaveAttribute('href', '/ops/cabins');
    expect(screen.getByText('Edit content')).toBeInTheDocument();
    expect(screen.getByText('Archive cabin')).toBeInTheDocument();
  });

  it('still consumes opsFlash from list create navigation', async () => {
    renderDetail('cabin-1', { opsFlash: 'cabin-created' });
    await waitFor(() => {
      expect(screen.getByText('Cabin created successfully.')).toBeInTheDocument();
    });
  });

  it('still loads a multi-unit type with units', async () => {
    opsReadAPI.cabinDetail.mockResolvedValue(detailPayload('multi_unit_type'));
    renderDetail('type-1');
    await waitFor(() => {
      expect(opsReadAPI.cabinDetail).toHaveBeenCalledWith('type-1');
    });
    expect(screen.getByRole('heading', { name: 'A-Frame' })).toBeInTheDocument();
    expect(screen.getByText('Multi-unit type')).toBeInTheDocument();
    expect(screen.queryByText('Archive cabin')).not.toBeInTheDocument();
  });
});
