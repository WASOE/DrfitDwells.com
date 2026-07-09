#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Smoke test for Batch 1 schema additions (no behavior wiring, no DB required).
 * Run: node server/scripts/locationBookingSchema.test.cjs
 */

const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Booking = require('../models/Booking');
const LocationBooking = require('../models/LocationBooking');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const { BED_TYPES } = require('../models/schemas/bedConfigSchema');

assert.ok(Cabin.schema.path('bedConfig'), 'Cabin.bedConfig exists');
assert.ok(CabinType.schema.path('bedConfig'), 'CabinType.bedConfig exists');
assert.ok(Booking.schema.path('locationBookingId'), 'Booking.locationBookingId exists');
assert.ok(Booking.schema.path('isMasterBooking'), 'Booking.isMasterBooking exists');
assert.ok(Booking.schema.path('suppressGuestEmail'), 'Booking.suppressGuestEmail exists');
assert.ok(Booking.schema.path('childPriceShare'), 'Booking.childPriceShare exists');
assert.ok(LocationBooking, 'LocationBooking model loads');
assert.ok(AvailabilityBlock.BLOCK_TYPES.includes('checkout_hold'), 'checkout_hold block type');
assert.ok(AvailabilityBlock.schema.path('checkoutSessionId'), 'AvailabilityBlock.checkoutSessionId exists');
assert.ok(AvailabilityBlock.schema.path('expiresAt'), 'AvailabilityBlock.expiresAt exists');

const hold = new AvailabilityBlock({
  cabinId: new mongoose.Types.ObjectId(),
  blockType: 'checkout_hold',
  startDate: new Date('2026-08-01'),
  endDate: new Date('2026-08-05'),
  checkoutSessionId: 'chk_test_schema',
  expiresAt: new Date(Date.now() + 60_000),
  source: 'location_checkout'
});
const holdErr = hold.validateSync();
assert.equal(holdErr, undefined, 'checkout_hold AvailabilityBlock validates');

const master = new LocationBooking({
  locationKey: 'valley',
  checkIn: new Date('2026-09-01'),
  checkOut: new Date('2026-09-05'),
  adults: 8,
  children: 0,
  guestInfo: {
    firstName: 'Test',
    lastName: 'Guest',
    email: 'test@example.com'
  },
  totalPrice: 1000,
  source: 'website'
});
const masterErr = master.validateSync();
assert.equal(masterErr, undefined, 'LocationBooking validates');

assert.deepEqual(
  BED_TYPES,
  ['single', 'twin', 'double', 'queen', 'king', 'sofa_bed', 'bunk']
);

console.log('locationBookingSchema.test.cjs: OK');
