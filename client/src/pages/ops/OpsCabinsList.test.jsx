import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpsCabinsList from './OpsCabinsList';

vi.mock('../../services/opsApi', () => ({
  opsReadAPI: {
    cabins: vi.fn()
  },
  opsWriteAPI: {
    createCabin: vi.fn()
  }
}));

import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';

const here = path.dirname(fileURLToPath(import.meta.url));
const listSource = fs.readFileSync(path.join(here, 'OpsCabinsList.jsx'), 'utf8');
const appSource = fs.readFileSync(path.resolve(here, '../../App.jsx'), 'utf8');

function singleCabin(overrides = {}) {
  return {
    kind: 'single_cabin',
    cabinId: 'cabin-1',
    name: 'Stone House',
    location: 'Rhodope',
    isActive: true,
    operational: {
      capacity: 4,
      minNights: 2,
      blockedDatesCount: 3
    },
    content: {
      imageUrl: '/uploads/cabins/stone.jpg'
    },
    ...overrides
  };
}

function multiCabin(overrides = {}) {
  return {
    kind: 'multi_unit_type',
    cabinTypeId: 'type-1',
    name: 'A-Frame',
    slug: 'a-frame',
    location: 'Pamporovo',
    isActive: true,
    operational: {
      capacity: 2,
      minNights: 1,
      pricePerNight: 85,
      totalUnits: 4,
      activeUnits: 3,
      blockedUnitsCount: 2
    },
    content: {
      imageUrl: null
    },
    ...overrides
  };
}

function payload(items, pagination = {}) {
  return {
    data: {
      data: {
        items,
        pagination: {
          page: 1,
          limit: 20,
          total: items.length,
          totalPages: 1,
          ...pagination
        }
      }
    }
  };
}

function DetailProbe() {
  const { id } = useParams();
  const location = useLocation();
  return (
    <div data-testid="cabin-detail">
      {id}|{JSON.stringify(location.state)}
    </div>
  );
}

function renderList(initialPath = '/ops/cabins') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/ops/cabins" element={<OpsCabinsList />} />
        <Route path="/ops/cabins/:id" element={<DetailProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('OpsCabinsList extraction', () => {
  beforeEach(() => {
    opsReadAPI.cabins.mockReset();
    opsWriteAPI.createCabin.mockReset();
    opsReadAPI.cabins.mockResolvedValue(payload([singleCabin(), multiCabin()]));
    opsWriteAPI.createCabin.mockResolvedValue({ data: { data: { cabin: { _id: 'new-cabin' } } } });
  });

  afterEach(() => {
    cleanup();
  });

  it('is the App.jsx /ops/cabins lazy target and does not import detail-only APIs', () => {
    expect(appSource).toContain("import('./pages/ops/OpsCabinsList')");
    expect(appSource).toContain("import('./pages/ops/OpsCabins')");
    expect(appSource).not.toContain('m.OpsCabinsList');
    expect(listSource).toContain('opsReadAPI.cabins({');
    expect(listSource).toContain('opsWriteAPI.createCabin(payload)');
    expect(listSource).not.toMatch(/cabinDetail|archiveCabin|updateCabin|CabinMediaManager|ArchiveCabinModal/);
    expect(listSource).not.toMatch(/OpsPage|OpsPagination|OpsModal|OpsStatus/);
  });

  it('reads page 1 with limit 20 and omits search when empty', async () => {
    renderList();
    await waitFor(() => {
      expect(opsReadAPI.cabins).toHaveBeenCalledTimes(1);
    });
    expect(opsReadAPI.cabins).toHaveBeenCalledWith({ page: 1, limit: 20 });
  });

  it('does not fetch while typing search, then submits a trimmed query and resets page', async () => {
    opsReadAPI.cabins.mockResolvedValue(
      payload([singleCabin(), multiCabin()], { page: 1, total: 40, totalPages: 2 })
    );
    renderList();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(opsReadAPI.cabins).toHaveBeenCalledWith({ page: 2, limit: 20 });
    });

    fireEvent.change(screen.getByPlaceholderText('Search name, location, slug…'), {
      target: { value: '  stone  ' }
    });
    expect(opsReadAPI.cabins).toHaveBeenCalledTimes(2);

    fireEvent.submit(screen.getByPlaceholderText('Search name, location, slug…').closest('form'));
    await waitFor(() => {
      expect(opsReadAPI.cabins).toHaveBeenCalledWith({ page: 1, limit: 20, search: 'stone' });
    });
  });

  it('paginates with limit 20 and hides controls when there is only one page', async () => {
    renderList();
    await waitFor(() => {
      expect(screen.getByText('Stone House')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();

    opsReadAPI.cabins.mockResolvedValue(
      payload([singleCabin()], { page: 1, total: 21, totalPages: 2 })
    );
    cleanup();
    renderList();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
    });
    expect(screen.getByText(/Page 1 of 2 \(21 total\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(opsReadAPI.cabins).toHaveBeenLastCalledWith({ page: 2, limit: 20 });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => {
      expect(opsReadAPI.cabins).toHaveBeenLastCalledWith({ page: 1, limit: 20 });
    });
  });

  it('renders representative single and multi fields and hrefs', async () => {
    opsReadAPI.cabins.mockResolvedValue(
      payload([
        singleCabin({ isActive: false, content: { imageUrl: null } }),
        multiCabin()
      ])
    );
    renderList();
    await waitFor(() => {
      expect(screen.getByText('Stone House')).toBeInTheDocument();
    });
    expect(screen.getByText('Single cabin')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    expect(screen.getByText('Rhodope')).toBeInTheDocument();
    expect(screen.getByText('4 guests')).toBeInTheDocument();
    expect(screen.getByText('2 min nights')).toBeInTheDocument();
    expect(screen.getByText('3 blocked nights')).toBeInTheDocument();
    expect(screen.getByText('SH')).toBeInTheDocument();

    expect(screen.getByText('A-Frame')).toBeInTheDocument();
    expect(screen.getByText('Multi-unit type')).toBeInTheDocument();
    expect(screen.getByText('Slug: a-frame')).toBeInTheDocument();
    expect(screen.getByText('4 units (3 active)')).toBeInTheDocument();
    expect(screen.getByText('2 w/ unit blocks')).toBeInTheDocument();
    expect(screen.getByText('85 / night')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: /Stone House/ })).toHaveAttribute('href', '/ops/cabins/cabin-1');
    expect(screen.getByRole('link', { name: /A-Frame/ })).toHaveAttribute('href', '/ops/cabins/type-1');
  });

  it('creates a cabin with the current payload and navigates with opsFlash', async () => {
    renderList();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create cabin' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create cabin' }));
    const dialog = screen.getByRole('dialog', { name: 'Create single cabin' });
    expect(dialog.querySelector('#ops-create-cabin-title')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' New Stay ' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: ' Quiet loft ' } });
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: ' Smolyan ' } });
    fireEvent.change(screen.getByLabelText('Capacity (guests)'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Price per night'), { target: { value: '70' } });
    fireEvent.change(screen.getByLabelText('Minimum nights'), { target: { value: '2' } });
    fireEvent.submit(dialog.querySelector('form'));

    await waitFor(() => {
      expect(opsWriteAPI.createCabin).toHaveBeenCalledWith({
        name: 'New Stay',
        description: 'Quiet loft',
        location: 'Smolyan',
        capacity: 3,
        pricePerNight: 70,
        minNights: 2
      });
    });
    expect(opsWriteAPI.createCabin.mock.calls[0][0]).not.toHaveProperty('hostName');
    expect(screen.getByTestId('cabin-detail')).toHaveTextContent('new-cabin|{"opsFlash":"cabin-created"}');
  });

  it('retains create fields and renders errors[] on failure', async () => {
    opsWriteAPI.createCabin.mockRejectedValue({
      response: {
        data: {
          message: 'Validation failed',
          errors: [{ field: 'name', message: 'already used' }]
        }
      }
    });
    renderList();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create cabin' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create cabin' }));
    const dialog = screen.getByRole('dialog', { name: 'Create single cabin' });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dupe' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Desc' } });
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Here' } });
    fireEvent.change(screen.getByLabelText('Capacity (guests)'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Price per night'), { target: { value: '50' } });
    fireEvent.submit(dialog.querySelector('form'));
    await waitFor(() => {
      expect(dialog).toHaveTextContent('name: already used');
    });
    expect(screen.getByLabelText('Name')).toHaveValue('Dupe');
    expect(screen.getByRole('dialog', { name: 'Create single cabin' })).toBeInTheDocument();
  });

  it('keeps the current loading, error, null, and empty-row copy', async () => {
    let resolveLoad;
    opsReadAPI.cabins.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      })
    );
    renderList();
    expect(screen.getByText('Loading cabins...')).toBeInTheDocument();
    resolveLoad(payload([singleCabin()]));
    await waitFor(() => {
      expect(screen.getByText('Stone House')).toBeInTheDocument();
    });

    cleanup();
    opsReadAPI.cabins.mockRejectedValue({ response: { data: { message: 'Cabins unavailable' } } });
    renderList();
    await waitFor(() => {
      expect(screen.getByText('Cabins unavailable')).toBeInTheDocument();
    });
    expect(screen.queryByText('No rows match your filters.')).not.toBeInTheDocument();

    cleanup();
    opsReadAPI.cabins.mockResolvedValue({ data: { data: null } });
    renderList();
    await waitFor(() => {
      expect(screen.getByText('No listings found.')).toBeInTheDocument();
    });

    cleanup();
    opsReadAPI.cabins.mockResolvedValue(payload([]));
    renderList();
    await waitFor(() => {
      expect(screen.getByText('No rows match your filters.')).toBeInTheDocument();
    });
  });
});
