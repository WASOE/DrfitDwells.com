import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpsSessionProvider } from '../../context/OpsSessionContext';
import { resetOpsOverlayRuntime } from '../../ops/primitives/opsOverlay';
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

const adminSession = {
  authenticated: true,
  actorId: 'admin-1',
  role: 'admin',
  modules: ['*'],
  actions: [],
  defaultRoute: '/ops',
  locale: 'en'
};

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

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="cabins-location">
      {location.pathname}|{location.search}|{JSON.stringify(location.state)}
    </div>
  );
}

function renderList(initialPath = '/ops/cabins') {
  return render(
    <div className="ops-root" data-ops-appearance="light" data-ops-themed="true">
      <MemoryRouter initialEntries={[initialPath]}>
        <OpsSessionProvider session={adminSession}>
          <LocationProbe />
          <Routes>
            <Route path="/ops/cabins" element={<OpsCabinsList />} />
            <Route path="/ops/cabins/:id" element={<DetailProbe />} />
          </Routes>
        </OpsSessionProvider>
      </MemoryRouter>
    </div>
  );
}

function headerCreateButton() {
  return within(document.querySelector('.ops-page-header')).getByRole('button', { name: 'Create cabin' });
}

function openCreate() {
  fireEvent.click(headerCreateButton());
  return screen.getByRole('dialog', { name: 'Create single cabin' });
}

function fillCreate(dialog, values) {
  fireEvent.change(within(dialog).getByLabelText('Name', { exact: true }), { target: { value: values.name } });
  fireEvent.change(within(dialog).getByLabelText('Description'), { target: { value: values.description } });
  fireEvent.change(within(dialog).getByLabelText('Location'), { target: { value: values.location } });
  fireEvent.change(within(dialog).getByLabelText('Capacity (guests)'), { target: { value: values.capacity } });
  fireEvent.change(within(dialog).getByLabelText('Price per night'), { target: { value: values.pricePerNight } });
  if (values.minNights != null) {
    fireEvent.change(within(dialog).getByLabelText('Minimum nights'), { target: { value: values.minNights } });
  }
  if (values.hostName != null) {
    fireEvent.change(within(dialog).getByLabelText(/Host name/), { target: { value: values.hostName } });
  }
}

describe('OpsCabinsList collection migration', () => {
  beforeEach(() => {
    opsReadAPI.cabins.mockReset();
    opsWriteAPI.createCabin.mockReset();
    opsReadAPI.cabins.mockResolvedValue(payload([singleCabin(), multiCabin()]));
    opsWriteAPI.createCabin.mockResolvedValue({ data: { data: { cabin: { _id: 'new-cabin' } } } });
  });

  afterEach(() => {
    cleanup();
    resetOpsOverlayRuntime();
  });

  it('is the App.jsx /ops/cabins lazy target and stays isolated from detail APIs', () => {
    expect(appSource).toContain("import('./pages/ops/OpsCabinsList')");
    expect(appSource).toContain("import('./pages/ops/OpsCabins')");
    expect(appSource).not.toContain('m.OpsCabinsList');
    expect(listSource).toContain('opsReadAPI.cabins({');
    expect(listSource).toContain('opsWriteAPI.createCabin(payload)');
    expect(listSource).toContain('width="wide"');
    expect(listSource).toContain('<OpsPagination');
    expect(listSource).toContain('<OpsModal');
    expect(listSource).toContain('domain="cabin" value="inactive"');
    expect(listSource).not.toMatch(/cabinDetail|archiveCabin|updateCabin|CabinMediaManager|ArchiveCabinModal|CreateCabinModal/);
    expect(listSource).not.toMatch(/max-w-7xl|mx-auto|#81887A|OpsCabinCard|OpsPropertyRow|OpsThumbnailRow/);
  });

  it('reads page 1 with limit 20 and omits search when empty', async () => {
    renderList();
    await waitFor(() => {
      expect(opsReadAPI.cabins).toHaveBeenCalledTimes(1);
    });
    expect(opsReadAPI.cabins).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(screen.getByTestId('ops-page')).toHaveAttribute('data-ops-page-width', 'wide');
    expect(screen.getByRole('heading', { level: 1, name: 'Cabins & unit types' })).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => {
      expect(opsReadAPI.cabins).toHaveBeenCalledWith({ page: 1, limit: 20, search: 'stone' });
    });
    expect(screen.getByTestId('cabins-location')).toHaveTextContent('/ops/cabins||null');
  });

  it('paginates with limit 20 and hides controls when there is only one page', async () => {
    renderList();
    await waitFor(() => {
      expect(screen.getByText('Stone House')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(screen.queryByText(/total/)).not.toBeInTheDocument();

    opsReadAPI.cabins.mockResolvedValue(payload([singleCabin()], { page: 1, total: 21, totalPages: 2 }));
    cleanup();
    resetOpsOverlayRuntime();
    renderList();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
    });
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('21 total')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(opsReadAPI.cabins).toHaveBeenLastCalledWith({ page: 2, limit: 20 });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => {
      expect(opsReadAPI.cabins).toHaveBeenLastCalledWith({ page: 1, limit: 20 });
    });
    expect(screen.getByTestId('cabins-location')).toHaveTextContent('/ops/cabins||null');
  });

  it('keeps stale rows visible while a later page load is in flight', async () => {
    opsReadAPI.cabins.mockResolvedValue(
      payload([singleCabin(), multiCabin()], { page: 1, total: 40, totalPages: 2 })
    );
    renderList();
    await waitFor(() => {
      expect(screen.getByText('Stone House')).toBeInTheDocument();
    });

    let resolveSecond;
    opsReadAPI.cabins.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve;
        })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(opsReadAPI.cabins).toHaveBeenLastCalledWith({ page: 2, limit: 20 });
    });
    expect(screen.getByText('Stone House')).toBeInTheDocument();
    expect(screen.getByText('A-Frame')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(document.querySelector('.ops-cabins-list__rows')).toHaveAttribute('aria-busy', 'true');

    resolveSecond(payload([singleCabin({ name: 'Page Two Cabin' })], { page: 2, total: 40, totalPages: 2 }));
    await waitFor(() => {
      expect(screen.getByText('Page Two Cabin')).toBeInTheDocument();
    });
  });

  it('renders representative single and multi fields, hrefs, and status semantics', async () => {
    opsReadAPI.cabins.mockResolvedValue(
      payload([
        singleCabin({ isActive: false, content: { imageUrl: null } }),
        multiCabin(),
        singleCabin({
          cabinId: 'cabin-active',
          name: 'Active Lodge',
          isActive: true,
          operational: { capacity: 3, minNights: 1, blockedDatesCount: 0 }
        })
      ])
    );
    renderList();
    await waitFor(() => {
      expect(screen.getByText('Stone House')).toBeInTheDocument();
    });

    const singleLink = screen.getByRole('link', { name: /Stone House/ });
    expect(singleLink).toHaveAttribute('href', '/ops/cabins/cabin-1');
    expect(within(singleLink).getByText('Single cabin')).toBeInTheDocument();
    expect(within(singleLink).getByText('Rhodope')).toBeInTheDocument();
    expect(within(singleLink).getByText('4 guests')).toBeInTheDocument();
    expect(within(singleLink).getByText('2 min nights')).toBeInTheDocument();
    expect(within(singleLink).getByText('3 blocked nights')).toBeInTheDocument();
    expect(within(singleLink).getByText('SH')).toBeInTheDocument();
    expect(within(singleLink).getByText('Inactive').closest('[data-ops-status-key]')).toHaveAttribute(
      'data-ops-status-key',
      'cabin.inactive'
    );
    expect(singleLink.querySelector('[data-ops-status-key="cabin.blocked"]')).toBeNull();
    expect(singleLink.querySelector('[data-ops-status-key="cabin.active"]')).toBeNull();
    expect(within(singleLink).queryByRole('button')).not.toBeInTheDocument();

    const multiLink = screen.getByRole('link', { name: /A-Frame/ });
    expect(multiLink).toHaveAttribute('href', '/ops/cabins/type-1');
    expect(within(multiLink).getByText('Multi-unit type')).toBeInTheDocument();
    expect(within(multiLink).getByText('Slug: a-frame')).toBeInTheDocument();
    expect(within(multiLink).getByText('4 units (3 active)')).toBeInTheDocument();
    expect(within(multiLink).getByText('2 blocked')).toBeInTheDocument();
    expect(within(multiLink).getByText('85 / night')).toBeInTheDocument();
    expect(within(multiLink).getByText('Blocked units').closest('[data-ops-status-key]')).toHaveAttribute(
      'data-ops-status-key',
      'cabin.blocked'
    );
    expect(multiLink.querySelector('[data-ops-status-key="cabin.active"]')).toBeNull();
    expect(within(multiLink).queryByText('3 blocked nights')).not.toBeInTheDocument();

    const activeLink = screen.getByRole('link', { name: /Active Lodge/ });
    expect(activeLink.querySelector('[data-ops-status-key="cabin.active"]')).toBeNull();
    expect(activeLink.querySelector('[data-ops-status-key="cabin.inactive"]')).toBeNull();
  });

  it('shows an image thumbnail for an active single with media', async () => {
    renderList();
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Stone House/ })).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /Stone House/ }).querySelector('img')).toHaveAttribute(
      'src',
      '/uploads/cabins/stone.jpg'
    );
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });

  it('creates a cabin with the current payload and navigates with opsFlash', async () => {
    renderList();
    await waitFor(() => {
      expect(headerCreateButton()).toBeInTheDocument();
    });
    const dialog = openCreate();
    expect(within(dialog).getByLabelText('Minimum nights')).toHaveValue(1);
    expect(document.querySelector('.ops-overlay-host')).toBeTruthy();

    fillCreate(dialog, {
      name: ' New Stay ',
      description: ' Quiet loft ',
      location: ' Smolyan ',
      capacity: '3',
      pricePerNight: '70',
      minNights: '2'
    });
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

  it('omits blank hostName and keeps values plus errors[] when create fails', async () => {
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
      expect(headerCreateButton()).toBeInTheDocument();
    });
    const dialog = openCreate();
    fillCreate(dialog, {
      name: 'Dupe',
      description: 'Desc',
      location: 'Here',
      capacity: '2',
      pricePerNight: '50',
      hostName: '   '
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create cabin' }));
    await waitFor(() => {
      expect(within(dialog).getByRole('alert')).toHaveTextContent('name: already used');
    });
    expect(opsWriteAPI.createCabin.mock.calls[0][0]).not.toHaveProperty('hostName');
    expect(within(dialog).getByLabelText('Name', { exact: true })).toHaveValue('Dupe');
    expect(screen.getByRole('dialog', { name: 'Create single cabin' })).toBeInTheDocument();
  });

  it('preserves current create validation without calling the API', async () => {
    renderList();
    await waitFor(() => {
      expect(headerCreateButton()).toBeInTheDocument();
    });
    const dialog = openCreate();
    fillCreate(dialog, {
      name: '',
      description: 'Desc',
      location: 'Here',
      capacity: '2',
      pricePerNight: '50'
    });
    fireEvent.submit(dialog.querySelector('form'));
    expect(opsWriteAPI.createCabin).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Name, description, and location are required.');

    fillCreate(dialog, {
      name: 'Stay',
      description: 'Desc',
      location: 'Here',
      capacity: '0',
      pricePerNight: '50'
    });
    fireEvent.submit(dialog.querySelector('form'));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Capacity must be a positive integer.');

    fillCreate(dialog, {
      name: 'Stay',
      description: 'Desc',
      location: 'Here',
      capacity: '2',
      pricePerNight: '0'
    });
    fireEvent.submit(dialog.querySelector('form'));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Price per night must be a positive number.');

    fillCreate(dialog, {
      name: 'Stay',
      description: 'Desc',
      location: 'Here',
      capacity: '2',
      pricePerNight: '50',
      minNights: '0'
    });
    fireEvent.submit(dialog.querySelector('form'));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Minimum nights must be a positive integer.');
    expect(opsWriteAPI.createCabin).not.toHaveBeenCalled();
  });

  it('falls back to the list when create succeeds without an id', async () => {
    opsWriteAPI.createCabin.mockResolvedValue({ data: { data: { cabin: {} } } });
    renderList();
    await waitFor(() => {
      expect(headerCreateButton()).toBeInTheDocument();
    });
    const dialog = openCreate();
    fillCreate(dialog, {
      name: 'Stay',
      description: 'Desc',
      location: 'Here',
      capacity: '2',
      pricePerNight: '50'
    });
    fireEvent.submit(dialog.querySelector('form'));
    await waitFor(() => {
      expect(opsWriteAPI.createCabin).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('cabin-detail')).not.toBeInTheDocument();
    expect(screen.getByTestId('cabins-location')).toHaveTextContent('/ops/cabins||null');
    expect(screen.getByRole('heading', { level: 1, name: 'Cabins & unit types' })).toBeInTheDocument();
  });

  it('keeps header and search visible during first load, then distinguishes empty catalog from search-empty', async () => {
    let resolveLoad;
    opsReadAPI.cabins.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      })
    );
    renderList();
    expect(screen.getByRole('heading', { level: 1, name: 'Cabins & unit types' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByText('Loading cabins')).toBeInTheDocument();
    resolveLoad(payload([singleCabin()]));
    await waitFor(() => {
      expect(screen.getByText('Stone House')).toBeInTheDocument();
    });

    cleanup();
    resetOpsOverlayRuntime();
    opsReadAPI.cabins.mockRejectedValue({ response: { data: { message: 'Cabins unavailable' } } });
    renderList();
    await waitFor(() => {
      expect(screen.getByText('Cabins unavailable')).toBeInTheDocument();
    });
    expect(screen.queryByText('No cabins yet.')).not.toBeInTheDocument();
    expect(screen.queryByText('No cabins match this search.')).not.toBeInTheDocument();

    cleanup();
    resetOpsOverlayRuntime();
    opsReadAPI.cabins.mockResolvedValue({ data: { data: null } });
    renderList();
    await waitFor(() => {
      expect(screen.getByText('No listings found.')).toBeInTheDocument();
    });

    cleanup();
    resetOpsOverlayRuntime();
    opsReadAPI.cabins.mockResolvedValue(payload([]));
    renderList();
    await waitFor(() => {
      expect(screen.getByText('No cabins yet.')).toBeInTheDocument();
    });
    expect(screen.queryByText('No cabins match this search.')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Create cabin' }).length).toBeGreaterThan(1);

    cleanup();
    resetOpsOverlayRuntime();
    opsReadAPI.cabins.mockResolvedValue(payload([]));
    renderList();
    await waitFor(() => {
      expect(headerCreateButton()).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText('Search name, location, slug…'), {
      target: { value: 'missing' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => {
      expect(opsReadAPI.cabins).toHaveBeenCalledWith({ page: 1, limit: 20, search: 'missing' });
    });
    await waitFor(() => {
      expect(screen.getByText('No cabins match this search.')).toBeInTheDocument();
    });
    expect(screen.queryByText('No cabins yet.')).not.toBeInTheDocument();
    expect(screen.queryByText(/filters/i)).not.toBeInTheDocument();
  });

  it('keeps existing rows when a later load fails', async () => {
    opsReadAPI.cabins.mockResolvedValue(
      payload([singleCabin(), multiCabin()], { page: 1, total: 40, totalPages: 2 })
    );
    renderList();
    await waitFor(() => {
      expect(screen.getByText('Stone House')).toBeInTheDocument();
    });
    opsReadAPI.cabins.mockRejectedValue({ response: { data: { message: 'Cabins unavailable' } } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(screen.getByText('Cabins unavailable')).toBeInTheDocument();
    });
    expect(screen.getByText('Stone House')).toBeInTheDocument();
    expect(screen.getByText('A-Frame')).toBeInTheDocument();
    expect(screen.queryByText('No cabins yet.')).not.toBeInTheDocument();
  });
});
