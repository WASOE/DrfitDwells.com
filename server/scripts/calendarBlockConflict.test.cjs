const test = require('node:test');
const assert = require('node:assert/strict');
const {
  collectCalendarConflictMarkers,
  calendarBlocksShareConflictTarget,
  formatCalendarUnitLabel,
  rangesOverlapExclusive
} = require('../services/ops/readModels/calendarBlockConflict');

const PARENT = 'parent-cabin-aframe';
const UNIT_2 = 'unit-aframe-2';
const UNIT_3 = 'unit-aframe-3';

function block(partial) {
  return {
    id: partial.id,
    cabinId: partial.cabinId ?? PARENT,
    unitId: partial.unitId ?? null,
    blockType: partial.blockType || 'reservation',
    startDate: partial.startDate,
    endDate: partial.endDate,
    status: partial.status || 'active'
  };
}

test('overlapping stays same cabinId different unitIds are not conflicts', () => {
  const blocks = [
    block({
      id: 'booking:sheinfeld-2',
      unitId: UNIT_2,
      startDate: '2026-09-02T00:00:00.000Z',
      endDate: '2026-09-04T00:00:00.000Z'
    }),
    block({
      id: 'booking:sheinfeld-3',
      unitId: UNIT_3,
      startDate: '2026-09-02T00:00:00.000Z',
      endDate: '2026-09-04T00:00:00.000Z'
    })
  ];
  const { hardConflicts, warnings } = collectCalendarConflictMarkers(blocks);
  assert.equal(hardConflicts.length, 0);
  assert.equal(warnings.length, 0);
  assert.equal(calendarBlocksShareConflictTarget(blocks[0], blocks[1]), false);
});

test('overlapping stays same unitId are hard conflicts', () => {
  const blocks = [
    block({
      id: 'booking:a',
      unitId: UNIT_2,
      startDate: '2026-09-05T00:00:00.000Z',
      endDate: '2026-09-08T00:00:00.000Z'
    }),
    block({
      id: 'booking:b',
      unitId: UNIT_2,
      startDate: '2026-09-07T00:00:00.000Z',
      endDate: '2026-09-10T00:00:00.000Z'
    })
  ];
  const { hardConflicts, warnings } = collectCalendarConflictMarkers(blocks);
  assert.equal(hardConflicts.length, 1);
  assert.equal(warnings.length, 0);
  assert.equal(hardConflicts[0].unitId, UNIT_2);
  assert.equal(hardConflicts[0].blockA, 'booking:a');
  assert.equal(hardConflicts[0].blockB, 'booking:b');
});

test('channel hold on unit 3 does not warn against unit 2 reservation', () => {
  const blocks = [
    block({
      id: 'block:hold-3',
      unitId: UNIT_3,
      blockType: 'external_hold',
      startDate: '2026-09-04T00:00:00.000Z',
      endDate: '2026-09-06T00:00:00.000Z'
    }),
    block({
      id: 'booking:mirchev-2',
      unitId: UNIT_2,
      startDate: '2026-09-05T00:00:00.000Z',
      endDate: '2026-09-07T00:00:00.000Z'
    })
  ];
  const { hardConflicts, warnings } = collectCalendarConflictMarkers(blocks);
  assert.equal(hardConflicts.length, 0);
  assert.equal(warnings.length, 0);
});

test('channel hold on unit 3 warns against overlapping stay on unit 3', () => {
  const blocks = [
    block({
      id: 'block:hold-3',
      unitId: UNIT_3,
      blockType: 'external_hold',
      startDate: '2026-09-04T00:00:00.000Z',
      endDate: '2026-09-06T00:00:00.000Z'
    }),
    block({
      id: 'booking:guest-3',
      unitId: UNIT_3,
      startDate: '2026-09-05T00:00:00.000Z',
      endDate: '2026-09-07T00:00:00.000Z'
    })
  ];
  const { hardConflicts, warnings } = collectCalendarConflictMarkers(blocks);
  assert.equal(hardConflicts.length, 0);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].unitId, UNIT_3);
});

test('non-pooled cabin (null unitIds) retains cabinId conflict behaviour', () => {
  const cabin = 'lux-cabin';
  const blocks = [
    block({
      id: 'booking:a',
      cabinId: cabin,
      unitId: null,
      startDate: '2026-09-03T00:00:00.000Z',
      endDate: '2026-09-07T00:00:00.000Z'
    }),
    block({
      id: 'booking:b',
      cabinId: cabin,
      unitId: null,
      startDate: '2026-09-05T00:00:00.000Z',
      endDate: '2026-09-09T00:00:00.000Z'
    })
  ];
  const { hardConflicts } = collectCalendarConflictMarkers(blocks);
  assert.equal(hardConflicts.length, 1);
});

test('checkout and same-day arrival on one unit do not overlap (exclusive end)', () => {
  const checkout = new Date('2026-09-05T00:00:00.000Z');
  const arrival = new Date('2026-09-05T00:00:00.000Z');
  assert.equal(
    rangesOverlapExclusive(
      new Date('2026-09-02T00:00:00.000Z'),
      checkout,
      arrival,
      new Date('2026-09-07T00:00:00.000Z')
    ),
    false
  );

  const blocks = [
    block({
      id: 'booking:depart',
      unitId: UNIT_2,
      startDate: '2026-09-02T00:00:00.000Z',
      endDate: '2026-09-05T00:00:00.000Z'
    }),
    block({
      id: 'booking:arrive',
      unitId: UNIT_2,
      startDate: '2026-09-05T00:00:00.000Z',
      endDate: '2026-09-07T00:00:00.000Z'
    })
  ];
  const { hardConflicts, warnings } = collectCalendarConflictMarkers(blocks);
  assert.equal(hardConflicts.length, 0);
  assert.equal(warnings.length, 0);
});

test('parent-wide block (null unitId) still conflicts with unit-scoped reservation', () => {
  const blocks = [
    block({
      id: 'block:manual-parent',
      unitId: null,
      blockType: 'manual_block',
      startDate: '2026-09-11T00:00:00.000Z',
      endDate: '2026-09-13T00:00:00.000Z'
    }),
    block({
      id: 'booking:unit-2',
      unitId: UNIT_2,
      startDate: '2026-09-11T00:00:00.000Z',
      endDate: '2026-09-14T00:00:00.000Z'
    })
  ];
  const { hardConflicts } = collectCalendarConflictMarkers(blocks);
  assert.equal(hardConflicts.length, 1);
});

test('formatCalendarUnitLabel prefers displayName then unitNumber', () => {
  assert.equal(formatCalendarUnitLabel({ displayName: 'A-Frame 3', unitNumber: '3' }), 'A-Frame 3');
  assert.equal(formatCalendarUnitLabel({ displayName: '  ', unitNumber: '2' }), 'Unit 2');
  assert.equal(formatCalendarUnitLabel({ unitNumber: 'Unit 4' }), 'Unit 4');
  assert.equal(formatCalendarUnitLabel(null), null);
});
