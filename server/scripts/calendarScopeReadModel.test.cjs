const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCalendarScope,
  calendarBoundaryFields
} = require('../services/ops/readModels/calendarReadModel');

test('calendarBoundaryFields exposes Sofia civil dates without discarding canonical instants', () => {
  const winter = calendarBoundaryFields('2026-11-05T22:00:00.000Z', '2026-11-07T22:00:00.000Z');
  assert.deepEqual(winter, {
    startDate: '2026-11-05T22:00:00.000Z',
    endDate: '2026-11-07T22:00:00.000Z',
    startDateOnly: '2026-11-06',
    endDateOnly: '2026-11-08'
  });

  const summer = calendarBoundaryFields('2026-07-30T21:00:00.000Z', '2026-08-01T21:00:00.000Z');
  assert.equal(summer.startDateOnly, '2026-07-31');
  assert.equal(summer.endDateOnly, '2026-08-02');
});

test('buildCalendarScope for single cabin uses same render id', () => {
  const scope = {
    scope: 'cabin',
    calendarCabinId: 'lux123',
    blockCabinId: 'lux123',
    bookingFilter: { cabinId: 'lux123' }
  };
  const result = buildCalendarScope('lux123', scope);
  assert.equal(result.requestedId, 'lux123');
  assert.equal(result.scope, 'cabin');
  assert.equal(result.renderCabinId, 'lux123');
  assert.equal(result.cabinTypeId, null);
});

test('buildCalendarScope for cabin_type uses parent render id and requested cabinTypeId', () => {
  const scope = {
    scope: 'cabin_type',
    calendarCabinId: 'parentMulti456',
    blockCabinId: 'parentMulti456',
    bookingFilter: { cabinTypeId: 'aframeType789' }
  };
  const result = buildCalendarScope('aframeType789', scope);
  assert.equal(result.requestedId, 'aframeType789');
  assert.equal(result.scope, 'cabin_type');
  assert.equal(result.renderCabinId, 'parentMulti456');
  assert.equal(result.cabinTypeId, 'aframeType789');
});

test('buildCalendarScope for all scope returns null ids', () => {
  const scope = { scope: 'all', calendarCabinId: null, blockCabinId: null, bookingFilter: {} };
  const result = buildCalendarScope(null, scope);
  assert.equal(result.requestedId, null);
  assert.equal(result.scope, 'all');
  assert.equal(result.renderCabinId, null);
  assert.equal(result.cabinTypeId, null);
});
