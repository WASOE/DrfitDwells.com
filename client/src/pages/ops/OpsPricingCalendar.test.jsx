import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../../services/api', () => ({
  ratePlanAdminAPI: { list: vi.fn() },
  pricingOverridesAPI: {
    calendar: vi.fn(),
    saveRange: vi.fn(),
    clearRange: vi.fn()
  }
}));

import { pricingOverridesAPI, ratePlanAdminAPI } from '../../services/api';
import OpsPricingCalendar from './OpsPricingCalendar';

const plan = {
  code: 'winter-cabin-stay-2026-27',
  version: 2,
  internalName: 'Winter Cabin Stay 2026/27',
  arrivalWindowStart: '2026-12-01',
  accommodations: [
    { accommodationKey: 'a-frame', entityType: 'cabin' },
    { accommodationKey: 'lux-cabin', entityType: 'cabin' },
    { accommodationKey: 'stone-house', entityType: 'cabin' }
  ]
};

function calendarResponse() {
  return {
    data: {
      ratePlan: { code: plan.code, version: plan.version },
      nights: [
        {
          date: '2026-12-01',
          accommodationKey: 'a-frame',
          entityType: 'cabin',
          basePriceCents: 7500,
          overridePriceCents: null,
          effectivePriceCents: 7500
        },
        {
          date: '2026-12-02',
          accommodationKey: 'a-frame',
          entityType: 'cabin',
          basePriceCents: 7500,
          overridePriceCents: 11000,
          effectivePriceCents: 11000
        }
      ]
    }
  };
}

function renderPage() {
  return render(<OpsPricingCalendar />);
}

describe('OpsPricingCalendar', () => {
  beforeEach(() => {
    ratePlanAdminAPI.list.mockResolvedValue({ data: { data: { ratePlans: [plan] } } });
    pricingOverridesAPI.calendar.mockResolvedValue(calendarResponse());
    pricingOverridesAPI.saveRange.mockResolvedValue({ data: { success: true } });
    pricingOverridesAPI.clearRange.mockResolvedValue({ data: { success: true } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the canonical Ops layout and an empty state before a RatePlan is selected', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Pricing Calendar' })).toBeInTheDocument();
    expect(screen.getByTestId('ops-pricing-calendar')).toHaveClass('ops-page--full');
    expect(screen.getByText('Select a RatePlan to view nightly pricing')).toBeInTheDocument();
  });

  it('loads the selected plan and renders the month grid with base and override states', async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText('RatePlan'), {
      target: { value: 'winter-cabin-stay-2026-27:2' }
    });
    expect(await screen.findByText('Winter Cabin Stay 2026/27')).toBeInTheDocument();
    expect(screen.getAllByText('A Frame').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Lux Cabin').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Stone House').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('€75')).not.toHaveLength(0);
    expect(screen.getByText('€110')).toBeInTheDocument();
    expect(screen.getByText('was €75')).toBeInTheDocument();
    expect(screen.getByTestId('pricing-calendar-grid')).toHaveClass('ops-pricing-calendar__scroll');
    expect(pricingOverridesAPI.calendar).toHaveBeenCalledWith({
      ratePlanCode: plan.code,
      ratePlanVersion: 2,
      startDate: '2026-12-01',
      endDate: '2027-01-01'
    });
  });

  it('converts the inclusive Through date to an exclusive API end and accepts euros', async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText('RatePlan'), {
      target: { value: 'winter-cabin-stay-2026-27:2' }
    });
    fireEvent.click(await screen.findByRole('button', { name: /A Frame 2026-12-01/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit nightly pricing' });
    fireEvent.change(within(dialog).getByLabelText('Through'), { target: { value: '2026-12-03' } });
    fireEvent.change(within(dialog).getByLabelText('Nightly price (€)'), { target: { value: '145.50' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save override' }));
    await waitFor(() => expect(pricingOverridesAPI.saveRange).toHaveBeenCalled());
    expect(pricingOverridesAPI.saveRange).toHaveBeenCalledWith(expect.objectContaining({
      startDate: '2026-12-01',
      endDate: '2026-12-04',
      priceCents: 14550,
      accommodations: [{ accommodationKey: 'a-frame', entityType: 'cabin' }]
    }));
  });

  it('offers a proper clear action with the inclusive range confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    fireEvent.change(await screen.findByLabelText('RatePlan'), {
      target: { value: 'winter-cabin-stay-2026-27:2' }
    });
    fireEvent.click(await screen.findByRole('button', { name: /A Frame 2026-12-01/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit nightly pricing' });
    fireEvent.change(within(dialog).getByLabelText('Through'), { target: { value: '2026-12-03' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear override' }));
    await waitFor(() => expect(pricingOverridesAPI.clearRange).toHaveBeenCalled());
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Clear nightly overrides for 3 nights across 1 accommodation?'));
    expect(pricingOverridesAPI.clearRange).toHaveBeenCalledWith(expect.objectContaining({
      startDate: '2026-12-01',
      endDate: '2026-12-04'
    }));
  });
});
