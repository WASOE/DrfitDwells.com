const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isAirbnbStaySummary,
  isExternalHoldEligibleForCleaning
} = require('../services/ops/cleaning/airbnbStayClassifier');
const {
  buildTaskId,
  sortCleaningCheckouts,
  propertyTurnKey
} = require('../services/ops/readModels/cleaningReadModel');

test('A: Reserved / guest SUMMARY counts as stay', () => {
  assert.equal(isAirbnbStaySummary('Reserved'), true);
  assert.equal(isAirbnbStaySummary('Reservation'), true);
  assert.equal(isAirbnbStaySummary('Maria'), true);
  assert.equal(isAirbnbStaySummary('Booked'), true);
});

test('F/G: host blocks and maintenance SUMMARY excluded', () => {
  assert.equal(isAirbnbStaySummary(''), false);
  assert.equal(isAirbnbStaySummary('Airbnb (Not available)'), false);
  assert.equal(isAirbnbStaySummary('Not available'), false);
  assert.equal(isAirbnbStaySummary('Blocked'), false);
  assert.equal(isAirbnbStaySummary('Owner block'), false);
  assert.equal(isAirbnbStaySummary('Maintenance'), false);
  assert.equal(isAirbnbStaySummary('Closed'), false);
});

test('eligibility: only active airbnb_ical external_hold stays', () => {
  assert.equal(
    isExternalHoldEligibleForCleaning({
      blockType: 'external_hold',
      source: 'airbnb_ical',
      status: 'active',
      metadata: { summary: 'Reserved' }
    }),
    true
  );
  assert.equal(
    isExternalHoldEligibleForCleaning({
      blockType: 'external_hold',
      source: 'airbnb_ical',
      status: 'active',
      metadata: { summary: 'Airbnb (Not available)' }
    }),
    false
  );
  assert.equal(
    isExternalHoldEligibleForCleaning({
      blockType: 'manual_block',
      source: 'internal',
      status: 'active',
      metadata: { summary: 'Reserved' }
    }),
    false
  );
  assert.equal(
    isExternalHoldEligibleForCleaning({
      blockType: 'maintenance',
      source: 'internal',
      status: 'active',
      metadata: { summary: 'Maintenance' }
    }),
    false
  );
  assert.equal(
    isExternalHoldEligibleForCleaning({
      blockType: 'external_hold',
      source: 'airbnb_ical',
      status: 'tombstoned',
      metadata: { summary: 'Reserved' }
    }),
    false
  );
});

test('H: cancelled/tombstoned reservation hold is not eligible', () => {
  assert.equal(
    isExternalHoldEligibleForCleaning({
      blockType: 'external_hold',
      source: 'airbnb_ical',
      status: 'tombstoned',
      metadata: { summary: 'Reserved' }
    }),
    false
  );
});

test('task identity is source-neutral (no fake booking ids)', () => {
  assert.equal(buildTaskId('booking', '507f1f77bcf86cd799439011'), '507f1f77bcf86cd799439011');
  assert.equal(buildTaskId('external_hold', '507f1f77bcf86cd799439011'), 'ext:507f1f77bcf86cd799439011');
});

test('propertyTurnKey isolates units for same-day matching', () => {
  assert.equal(propertyTurnKey({ unitId: { _id: 'u2' } }), 'unit:u2');
  assert.equal(propertyTurnKey({ unitId: { _id: 'u3' } }), 'unit:u3');
  assert.notEqual(
    propertyTurnKey({ unitId: { _id: 'u2' } }),
    propertyTurnKey({ unitId: { _id: 'u3' } })
  );
});

test('sort: same-day pending → other pending → cleaned unpaid → cleaned paid', () => {
  const sorted = sortCleaningCheckouts([
    {
      cabinName: 'Z',
      status: 'cleaned',
      paymentStatus: 'paid',
      sameDayTurn: false,
      nextArrivalAt: null
    },
    {
      cabinName: 'A',
      status: 'cleaned',
      paymentStatus: 'unpaid',
      sameDayTurn: false,
      nextArrivalAt: null
    },
    {
      cabinName: 'B',
      status: 'pending',
      paymentStatus: 'unpaid',
      sameDayTurn: false,
      nextArrivalAt: '2026-09-21T15:00:00.000Z'
    },
    {
      cabinName: 'C',
      status: 'pending',
      paymentStatus: 'unpaid',
      sameDayTurn: true,
      nextArrivalAt: '2026-09-21T14:00:00.000Z'
    },
    {
      cabinName: 'D',
      status: 'pending',
      paymentStatus: 'paid',
      sameDayTurn: true,
      nextArrivalAt: '2026-09-21T13:00:00.000Z'
    }
  ]);
  assert.deepEqual(
    sorted.map((e) => e.cabinName),
    ['D', 'C', 'B', 'A', 'Z']
  );
});

test('I/J/K: cleaned and paid are independent ranks', () => {
  const sorted = sortCleaningCheckouts([
    { cabinName: 'needs-paid', status: 'pending', paymentStatus: 'paid', sameDayTurn: false },
    { cabinName: 'cleaned-unpaid', status: 'cleaned', paymentStatus: 'unpaid', sameDayTurn: false },
    { cabinName: 'cleaned-paid', status: 'cleaned', paymentStatus: 'paid', sameDayTurn: false }
  ]);
  assert.deepEqual(
    sorted.map((e) => e.cabinName),
    ['needs-paid', 'cleaned-unpaid', 'cleaned-paid']
  );
});
