import { describe, expect, it } from 'vitest';
import { unitAvailability } from './useManualReservationInventory';

const unit = { _id: 'unit-1', blockedDates: [] };
const block = {
  unitId: 'unit-1', status: 'active', blockType: 'reservation',
  startDateOnly: '2027-04-01', endDateOnly: '2027-04-03'
};

describe('manual reservation physical unit availability', () => {
  it('requires a valid exclusive date range', () => {
    expect(unitAvailability(unit, [], '', '')).toBe('Select dates');
    expect(unitAvailability(unit, [], '2027-04-03', '2027-04-01')).toBe('Select dates');
  });
  it('distinguishes occupied, unavailable and available units', () => {
    expect(unitAvailability(unit, [block], '2027-04-01', '2027-04-03')).toBe('Occupied');
    expect(unitAvailability(unit, [{ ...block, blockType: 'maintenance' }], '2027-04-01', '2027-04-03')).toBe('Unavailable');
    expect(unitAvailability(unit, [{ ...block, blockType: 'external_hold' }], '2027-04-01', '2027-04-03')).toBe('Unavailable');
    expect(unitAvailability(unit, [], '2027-04-01', '2027-04-03')).toBe('Available');
  });
  it('blocks parent-wide holds, but not other units or adjacent exclusive stays', () => {
    expect(unitAvailability(unit, [{ ...block, unitId: null }], '2027-04-01', '2027-04-03')).toBe('Occupied');
    expect(unitAvailability(unit, [{ ...block, unitId: 'unit-2' }], '2027-04-01', '2027-04-03')).toBe('Available');
    expect(unitAvailability(unit, [block], '2027-04-03', '2027-04-05')).toBe('Available');
  });
  it('respects unit blocked dates in Sofia, with checkout exclusive', () => {
    const blocked = { ...unit, blockedDates: ['2027-04-01T21:00:00.000Z'] };
    expect(unitAvailability(blocked, [], '2027-04-02', '2027-04-03')).toBe('Unavailable');
    expect(unitAvailability(blocked, [], '2027-04-01', '2027-04-02')).toBe('Available');
  });
});
