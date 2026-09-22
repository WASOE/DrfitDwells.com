import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import OpsRatePlans from './OpsRatePlans';
import { OPS_NAV_ITEMS, getActiveOpsMobileTabId } from '../../layouts/ops/opsNavConfig';

const list = vi.fn();
const create = vi.fn();
const update = vi.fn();
const clone = vi.fn();
const activate = vi.fn();
const retire = vi.fn();

vi.mock('../../services/api', () => ({
  ratePlanAdminAPI: {
    list: (...args) => list(...args),
    create: (...args) => create(...args),
    update: (...args) => update(...args),
    clone: (...args) => clone(...args),
    activate: (...args) => activate(...args),
    retire: (...args) => retire(...args)
  }
}));

function draftPlan(overrides = {}) {
  return {
    id: '0000000000000000000000aa',
    revision: 2,
    code: 'winter-api',
    internalName: 'Winter',
    version: 1,
    status: 'draft',
    type: 'seasonal_stay',
    currency: 'EUR',
    arrivalWindowStart: '2027-12-01',
    arrivalWindowEnd: '2027-12-31',
    bookingWindowStart: null,
    bookingWindowEnd: null,
    minNights: 2,
    packageArrivalDate: null,
    packageDepartureDate: null,
    inventoryMode: 'shared',
    requiresFullPayment: true,
    cancellationPolicyCode: 'normal-stay-standard',
    cancellationPolicyVersion: 1,
    inclusions: ['Firewood'],
    accommodations: [
      {
        accommodationKey: 'lux-cabin',
        entityType: 'cabin',
        pricingMethod: 'nightly_per_unit',
        nightlyPerUnitAmount: 180
      }
    ],
    createdBy: 'ops',
    updatedBy: 'ops',
    activatedAt: null,
    activatedBy: null,
    retiredAt: null,
    retiredBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/ops/rate-plans']}>
      <Routes>
        <Route path="/ops/rate-plans" element={<OpsRatePlans />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('OpsRatePlans', () => {
  beforeEach(() => {
    list.mockReset();
    create.mockReset();
    update.mockReset();
    clone.mockReset();
    activate.mockReset();
    retire.mockReset();
    list.mockResolvedValue({ data: { success: true, data: { ratePlans: [draftPlan()] } } });
  });

  afterEach(() => {
    cleanup();
  });

  it('exposes authenticated ops route and finance nav entry', () => {
    expect(OPS_NAV_ITEMS.some((item) => item.to === '/ops/rate-plans')).toBe(true);
    expect(getActiveOpsMobileTabId('/ops/rate-plans')).toBe('finance');
  });

  it('lists plans and applies filters', async () => {
    renderPage();
    expect(await screen.findByTestId('ops-rate-plans')).toBeInTheDocument();
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(screen.getByText(/winter-api/i)).toBeInTheDocument();

    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'draft' } });
    fireEvent.change(selects[1], { target: { value: 'seasonal_stay' } });
    fireEvent.change(screen.getByPlaceholderText(/winter-2026/i), {
      target: { value: 'Winter-API' }
    });

    await waitFor(() => {
      const last = list.mock.calls[list.mock.calls.length - 1][0];
      expect(last).toMatchObject({
        status: 'draft',
        type: 'seasonal_stay',
        code: 'winter-api'
      });
    });
  });

  it('creates a seasonal draft with allowlisted payload only', async () => {
    create.mockResolvedValue({
      data: { success: true, data: { ratePlan: draftPlan({ revision: 0 }) } }
    });
    list
      .mockResolvedValueOnce({ data: { success: true, data: { ratePlans: [] } } })
      .mockResolvedValue({ data: { success: true, data: { ratePlans: [draftPlan()] } } });

    renderPage();
    await screen.findByTestId('rate-plans-empty');
    fireEvent.click(screen.getByRole('button', { name: /new seasonal draft/i }));

    const drawer = await screen.findByTestId('rate-plan-drawer');
    fireEvent.change(within(drawer).getByLabelText(/^Code$/i), {
      target: { value: 'season-create' }
    });
    fireEvent.change(within(drawer).getByLabelText(/Internal name/i), {
      target: { value: 'Season create' }
    });
    fireEvent.change(within(drawer).getByLabelText(/Arrival window start/i), {
      target: { value: '2027-12-01' }
    });
    fireEvent.change(within(drawer).getByLabelText(/Arrival window end/i), {
      target: { value: '2027-12-31' }
    });
    fireEvent.change(within(drawer).getByLabelText(/Key \(slug\)/i), {
      target: { value: 'lux-cabin' }
    });
    fireEvent.change(within(drawer).getByLabelText(/^Nightly €$/i), {
      target: { value: '150' }
    });

    fireEvent.click(within(drawer).getByRole('button', { name: /create draft/i }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const payload = create.mock.calls[0][0];
    expect(payload.code).toBe('season-create');
    expect(payload.type).toBe('seasonal_stay');
    expect(payload.createdBy).toBeUndefined();
    expect(payload.status).toBeUndefined();
    expect(payload.revision).toBeUndefined();
    expect(payload.ownerToken).toBeUndefined();
    expect(Object.keys(payload).sort()).toEqual(
      [
        'accommodations',
        'arrivalWindowEnd',
        'arrivalWindowStart',
        'bookingWindowEnd',
        'bookingWindowStart',
        'cancellationPolicyCode',
        'cancellationPolicyVersion',
        'code',
        'currency',
        'inclusions',
        'internalName',
        'inventoryMode',
        'minNights',
        'packageArrivalDate',
        'packageDepartureDate',
        'requiresFullPayment',
        'type',
        'version'
      ].sort()
    );
  });

  it('creates a fixed-package draft payload with package fields', async () => {
    create.mockResolvedValue({
      data: { success: true, data: { ratePlan: draftPlan({ type: 'fixed_package' }) } }
    });
    list.mockResolvedValue({ data: { success: true, data: { ratePlans: [] } } });
    renderPage();
    await screen.findByTestId('rate-plans-empty');
    fireEvent.click(screen.getByRole('button', { name: /new package draft/i }));
    const drawer = await screen.findByTestId('rate-plan-drawer');
    fireEvent.change(within(drawer).getByLabelText(/^Code$/i), {
      target: { value: 'pkg-create' }
    });
    fireEvent.change(within(drawer).getByLabelText(/Internal name/i), {
      target: { value: 'Package create' }
    });
    fireEvent.change(within(drawer).getByLabelText(/Package arrival/i), {
      target: { value: '2027-12-20' }
    });
    fireEvent.change(within(drawer).getByLabelText(/Package departure/i), {
      target: { value: '2027-12-24' }
    });
    fireEvent.change(within(drawer).getByLabelText(/Key \(slug\)/i), {
      target: { value: 'lux-cabin' }
    });
    fireEvent.change(within(drawer).getByLabelText(/Adult package €/i), {
      target: { value: '400' }
    });
    fireEvent.change(within(drawer).getByLabelText(/Child package €/i), {
      target: { value: '200' }
    });
    fireEvent.change(within(drawer).getByLabelText(/Infant package €/i), {
      target: { value: '0' }
    });
    fireEvent.click(within(drawer).getByRole('button', { name: /create draft/i }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0].type).toBe('fixed_package');
    expect(create.mock.calls[0][0].packageArrivalDate).toBe('2027-12-20');
    expect(create.mock.calls[0][0].arrivalWindowStart).toBeNull();
    expect(create.mock.calls[0][0].accommodations[0].infantPackageAmount).toBe(0);
  });

  it('updates a draft using the exact server revision', async () => {
    update.mockResolvedValue({
      data: { success: true, data: { ratePlan: draftPlan({ revision: 3, minNights: 4 }) } }
    });
    renderPage();
    await screen.findByText(/winter-api/i);
    fireEvent.click(screen.getByRole('button', { name: /^Edit$/i }));
    const drawer = await screen.findByTestId('rate-plan-drawer');
    fireEvent.change(within(drawer).getByLabelText(/Min nights/i), {
      target: { value: '4' }
    });
    fireEvent.click(within(drawer).getByRole('button', { name: /save draft/i }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][0]).toBe('0000000000000000000000aa');
    expect(update.mock.calls[0][1].expectedRevision).toBe(2);
    expect(update.mock.calls[0][1].minNights).toBe(4);
    expect(update.mock.calls[0][1].revision).toBeUndefined();
  });

  it('keeps active and retired plans read-only', async () => {
    list.mockResolvedValue({
      data: {
        success: true,
        data: {
          ratePlans: [
            draftPlan({ id: '1', status: 'active', code: 'active-plan' }),
            draftPlan({ id: '2', status: 'retired', code: 'retired-plan' })
          ]
        }
      }
    });
    renderPage();
    await screen.findByText(/active-plan/i);
    const viewButtons = screen.getAllByRole('button', { name: /^View$/i });
    fireEvent.click(viewButtons[0]);
    const drawer = await screen.findByTestId('rate-plan-drawer');
    expect(within(drawer).queryByRole('button', { name: /save draft/i })).toBeNull();
    expect(within(drawer).getByText(/read-only/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delete$/i })).toBeNull();
  });

  it('clones a plan', async () => {
    clone.mockResolvedValue({
      data: {
        success: true,
        data: { ratePlan: draftPlan({ id: 'clone-id', version: 2, revision: 0 }) }
      }
    });
    renderPage();
    await screen.findByText(/winter-api/i);
    fireEvent.click(screen.getByRole('button', { name: /^Clone$/i }));
    await waitFor(() => expect(clone).toHaveBeenCalledWith('0000000000000000000000aa'));
    expect(await screen.findByText(/cloned as next draft/i)).toBeInTheDocument();
  });

  it('requires confirmation before activate and sends exact revision', async () => {
    activate.mockResolvedValue({
      data: {
        success: true,
        data: {
          ratePlan: draftPlan({ status: 'active', revision: 3 }),
          activationCommitted: true,
          lockReleased: true,
          operationalWarnings: []
        }
      }
    });
    renderPage();
    await screen.findByText(/winter-api/i);
    fireEvent.click(screen.getByRole('button', { name: /^Activate$/i }));
    expect(activate).not.toHaveBeenCalled();
    const dialog = await screen.findByTestId('rate-plan-confirm');
    fireEvent.click(within(dialog).getByRole('button', { name: /^Confirm$/i }));
    await waitFor(() => expect(activate).toHaveBeenCalledTimes(1));
    expect(activate.mock.calls[0][1]).toEqual({ expectedRevision: 2 });
  });

  it('requires confirmation before retire', async () => {
    list.mockResolvedValue({
      data: {
        success: true,
        data: { ratePlans: [draftPlan({ status: 'active', code: 'live-plan' })] }
      }
    });
    retire.mockResolvedValue({
      data: { success: true, data: { ratePlan: draftPlan({ status: 'retired' }) } }
    });
    renderPage();
    await screen.findByText(/live-plan/i);
    fireEvent.click(screen.getByRole('button', { name: /^Retire$/i }));
    const dialog = await screen.findByTestId('rate-plan-confirm');
    fireEvent.click(within(dialog).getByRole('button', { name: /^Confirm$/i }));
    await waitFor(() => expect(retire).toHaveBeenCalledTimes(1));
    expect(retire.mock.calls[0][1]).toEqual({ expectedRevision: 2 });
  });

  it('shows stale revision without retry and preserves form', async () => {
    update.mockRejectedValue({
      response: { data: { code: 'STALE_REVISION', message: 'Rate plan was modified' } }
    });
    renderPage();
    await screen.findByText(/winter-api/i);
    fireEvent.click(screen.getByRole('button', { name: /^Edit$/i }));
    const drawer = await screen.findByTestId('rate-plan-drawer');
    fireEvent.change(within(drawer).getByLabelText(/Internal name/i), {
      target: { value: 'Unsaved name' }
    });
    fireEvent.click(within(drawer).getByRole('button', { name: /save draft/i }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Refresh the list/i)).toBeInTheDocument();
    expect(update).toHaveBeenCalledTimes(1);
    expect(within(drawer).getByLabelText(/Internal name/i)).toHaveValue('Unsaved name');
    expect(screen.getByTestId('rate-plan-drawer')).toBeInTheDocument();
  });

  it('surfaces overlap and busy errors distinctly with fixed client text', async () => {
    activate
      .mockRejectedValueOnce({
        response: {
          data: {
            code: 'SEASONAL_OVERLAP',
            message: 'Windows overlap ownerToken=SECRET mongodb://user:pass@host'
          }
        }
      })
      .mockRejectedValueOnce({
        response: {
          data: { code: 'ACTIVATION_BUSY', message: 'Activation busy password=hunter2' }
        }
      });

    renderPage();
    await screen.findByText(/winter-api/i);
    fireEvent.click(screen.getByRole('button', { name: /^Activate$/i }));
    fireEvent.click(within(await screen.findByTestId('rate-plan-confirm')).getByRole('button', { name: /^Confirm$/i }));
    const overlapBanner = await screen.findByTestId('rate-plans-banner');
    expect(overlapBanner.textContent).toMatch(/overlaps an active rate plan/i);
    expect(overlapBanner.textContent).not.toMatch(/ownerToken|mongodb|SECRET/i);

    fireEvent.click(screen.getByRole('button', { name: /^Activate$/i }));
    fireEvent.click(within(await screen.findByTestId('rate-plan-confirm')).getByRole('button', { name: /^Confirm$/i }));
    const busyBanner = await screen.findByTestId('rate-plans-banner');
    expect(busyBanner.textContent).toMatch(/Another activation is in progress/i);
    expect(busyBanner.textContent).not.toMatch(/password|hunter2/i);
  });

  it('treats committed activation with cleanup warning as success', async () => {
    activate.mockResolvedValue({
      data: {
        success: true,
        data: {
          ratePlan: draftPlan({ status: 'active' }),
          activationCommitted: true,
          lockReleased: false,
          operationalWarnings: [{ code: 'ACTIVATION_LOCK_RELEASE_FAILED' }]
        }
      }
    });
    renderPage();
    await screen.findByText(/winter-api/i);
    fireEvent.click(screen.getByRole('button', { name: /^Activate$/i }));
    fireEvent.click(within(await screen.findByTestId('rate-plan-confirm')).getByRole('button', { name: /^Confirm$/i }));
    const banner = await screen.findByTestId('rate-plans-banner');
    expect(banner.textContent).toMatch(/activated/i);
    expect(banner.textContent).toMatch(/do not retry/i);
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('prevents duplicate submit while busy', async () => {
    let resolveCreate;
    create.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        })
    );
    list.mockResolvedValue({ data: { success: true, data: { ratePlans: [] } } });
    renderPage();
    await screen.findByTestId('rate-plans-empty');
    fireEvent.click(screen.getByRole('button', { name: /new seasonal draft/i }));
    const drawer = await screen.findByTestId('rate-plan-drawer');
    fireEvent.change(within(drawer).getByLabelText(/^Code$/i), { target: { value: 'dup' } });
    fireEvent.change(within(drawer).getByLabelText(/Internal name/i), { target: { value: 'Dup' } });
    fireEvent.change(within(drawer).getByLabelText(/Arrival window start/i), {
      target: { value: '2027-01-01' }
    });
    fireEvent.change(within(drawer).getByLabelText(/Arrival window end/i), {
      target: { value: '2027-01-10' }
    });
    fireEvent.change(within(drawer).getByLabelText(/Key \(slug\)/i), {
      target: { value: 'lux-cabin' }
    });
    fireEvent.change(within(drawer).getByLabelText(/^Nightly €$/i), { target: { value: '100' } });
    const submit = within(drawer).getByRole('button', { name: /create draft/i });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    resolveCreate({ data: { success: true, data: { ratePlan: draftPlan() } } });
    await waitFor(() => expect(screen.queryByText(/Saving/i)).toBeNull());
  });

  it('does not offer DELETE and never calls a delete API', async () => {
    renderPage();
    await screen.findByText(/winter-api/i);
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
    expect(screen.getByTestId('ops-rate-plans').innerHTML).not.toMatch(/DELETE/i);
  });

  it('uses the canonical wide Ops page and safe banner text', async () => {
    list.mockRejectedValue({
      response: { data: { message: '<b>boom</b> stack at Object.fail ownerToken=SECRET' } }
    });
    renderPage();
    const page = await screen.findByTestId('ops-rate-plans');
    expect(page).toHaveClass('ops-page', 'ops-page--wide', 'ops-rate-plans');
    expect(page.className).not.toMatch(/max-w-7xl|px-4|bg-white|rounded-xl/);
    const banner = await screen.findByTestId('rate-plans-banner');
    expect(banner.textContent).not.toMatch(/</);
    expect(banner.textContent).not.toMatch(/Object\.fail|boom|ownerToken|SECRET/i);
    expect(banner.textContent).toMatch(/Something went wrong/i);
  });

  it('rejects blank nightly amount with zero API calls', async () => {
    list.mockResolvedValue({ data: { success: true, data: { ratePlans: [] } } });
    renderPage();
    await screen.findByTestId('rate-plans-empty');
    fireEvent.click(screen.getByRole('button', { name: /new seasonal draft/i }));
    const drawer = await screen.findByTestId('rate-plan-drawer');
    fireEvent.change(within(drawer).getByLabelText(/^Code$/i), { target: { value: 'blank-amt' } });
    fireEvent.change(within(drawer).getByLabelText(/Internal name/i), {
      target: { value: 'Blank amount' }
    });
    fireEvent.change(within(drawer).getByLabelText(/Arrival window start/i), {
      target: { value: '2027-01-01' }
    });
    fireEvent.change(within(drawer).getByLabelText(/Arrival window end/i), {
      target: { value: '2027-01-10' }
    });
    fireEvent.change(within(drawer).getByLabelText(/Key \(slug\)/i), {
      target: { value: 'lux-cabin' }
    });
    fireEvent.click(within(drawer).getByRole('button', { name: /create draft/i }));
    expect(await screen.findByText(/nightly amount is required/i)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects duplicate accommodation keys with zero API calls', async () => {
    list.mockResolvedValue({ data: { success: true, data: { ratePlans: [] } } });
    renderPage();
    await screen.findByTestId('rate-plans-empty');
    fireEvent.click(screen.getByRole('button', { name: /new seasonal draft/i }));
    const drawer = await screen.findByTestId('rate-plan-drawer');
    fireEvent.change(within(drawer).getByLabelText(/^Code$/i), { target: { value: 'dup-key' } });
    fireEvent.change(within(drawer).getByLabelText(/Internal name/i), {
      target: { value: 'Dup keys' }
    });
    fireEvent.change(within(drawer).getByLabelText(/Arrival window start/i), {
      target: { value: '2027-01-01' }
    });
    fireEvent.change(within(drawer).getByLabelText(/Arrival window end/i), {
      target: { value: '2027-01-10' }
    });
    fireEvent.change(within(drawer).getByLabelText(/Key \(slug\)/i), {
      target: { value: 'lux-cabin' }
    });
    fireEvent.change(within(drawer).getByLabelText(/^Nightly €$/i), { target: { value: '100' } });
    fireEvent.click(within(drawer).getByRole('button', { name: /add row/i }));
    const keys = within(drawer).getAllByLabelText(/Key \(slug\)/i);
    const nightlies = within(drawer).getAllByLabelText(/^Nightly €$/i);
    fireEvent.change(keys[1], { target: { value: 'Lux-Cabin' } });
    fireEvent.change(nightlies[1], { target: { value: '120' } });
    fireEvent.click(within(drawer).getByRole('button', { name: /create draft/i }));
    expect(await screen.findByText(/Duplicate accommodation "lux-cabin"/i)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });
});
