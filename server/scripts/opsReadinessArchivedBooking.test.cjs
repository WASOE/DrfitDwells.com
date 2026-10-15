'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Booking = require('../models/Booking');
const {
  runReservationDetailParity
} = require('../services/ops/readiness/opsParityChecks');

for (const [label, booking] of [
  ['archived', { archivedAt: new Date() }],
  ['test fixture', { isTest: true }]
]) {
  test(`reservation readiness excludes ${label} without dereferencing a null read model`, async () => {
    const originalFindById = Booking.findById;
    Booking.findById = () => ({
      lean: async () => ({ _id: '507f1f77bcf86cd799439011', ...booking })
    });

    try {
      const result = await runReservationDetailParity({
        reservationId: '507f1f77bcf86cd799439011'
      });

      assert.deepEqual(result, {
        module: 'reservation_detail',
        actual: null,
        expected: null,
        mismatches: [],
        evidence: { hasEvidence: false }
      });
    } finally {
      Booking.findById = originalFindById;
    }
  });
}
