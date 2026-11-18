const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Cabin = require('../models/Cabin');
const Booking = require('../models/Booking');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const { getCalendarReadModel } = require('../services/ops/readModels/calendarReadModel');
const {
  sweepExpiredCheckoutHolds
} = require('../services/locationCheckout/locationCheckoutHoldService');
const {
  runCheckoutHoldSweepOnce,
  isEnabled,
  resolveTickMs
} = require('../services/locationCheckout/checkoutHoldSweeper');
const { normalizeDateToSofiaDayStart } = require('../utils/dateTime');

let mongo;
let cabin;
let expiredHold;
let activeHold;
let paidBooking;

const day = normalizeDateToSofiaDayStart;
const FROM = '2027-01-14';
const TO = '2027-01-18';

const read = () =>
  getCalendarReadModel({ cabinId: String(cabin._id), from: FROM, to: TO });

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());

  cabin = await Cabin.create({
    name: 'Lux Cabin',
    isActive: true,
    pricePerNight: 150,
    blockedDates: [],
    description: 'Expired checkout hold regression',
    capacity: 2,
    location: 'Valley',
    imageUrl: '/uploads/test.jpg'
  });

  expiredHold = await AvailabilityBlock.create({
    cabinId: cabin._id,
    unitId: null,
    blockType: 'checkout_hold',
    startDate: day('2027-01-15'),
    endDate: day('2027-01-17'),
    status: 'active',
    source: 'location_checkout',
    sourceReference: 'expired-session',
    checkoutSessionId: 'expired-session',
    expiresAt: new Date(Date.now() - 60 * 1000)
  });

  activeHold = await AvailabilityBlock.create({
    cabinId: cabin._id,
    unitId: null,
    blockType: 'checkout_hold',
    startDate: day('2027-01-15'),
    endDate: day('2027-01-17'),
    status: 'active',
    source: 'location_checkout',
    sourceReference: 'active-session',
    checkoutSessionId: 'active-session',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000)
  });

  paidBooking = await Booking.create({
    cabinId: cabin._id,
    status: 'confirmed',
    paymentStatus: 'paid',
    checkIn: day('2027-01-15'),
    checkOut: day('2027-01-17'),
    isTest: false,
    archivedAt: null,
    totalPrice: 300,
    adults: 2,
    guestInfo: {
      firstName: 'Ada',
      lastName: 'Guest',
      email: 'ada@example.com',
      phone: '+359000000000'
    }
  });
});

test.after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test('Ops calendar hides an expired checkout hold but keeps an active hold', async () => {
  const data = await read();
  const ids = data.blocks.map((block) => String(block.id));
  assert.ok(ids.includes(`block:${activeHold._id}`), 'active checkout hold should render');
  assert.ok(!ids.includes(`block:${expiredHold._id}`), 'expired checkout hold must not render');
});

test('expired checkout hold does not hide the paid booking', async () => {
  const data = await read();
  const reservation = data.blocks.find((block) => block.blockType === 'reservation');
  assert.ok(reservation, 'paid booking must still render as a reservation');
  assert.equal(reservation.sourceReference, String(paidBooking._id));
});

test('sweep tombstones only expired checkout holds', async () => {
  const result = await sweepExpiredCheckoutHolds({ now: new Date() });
  assert.ok(result.tombstoned >= 1);

  const expiredAfter = await AvailabilityBlock.findById(expiredHold._id).lean();
  assert.equal(expiredAfter.status, 'tombstoned');
  assert.equal(expiredAfter.tombstoneReason, 'checkout_hold_expired');

  const activeAfter = await AvailabilityBlock.findById(activeHold._id).lean();
  assert.equal(activeAfter.status, 'active');
  assert.equal(activeAfter.tombstoneReason, null);

  const bookingAfter = await Booking.findById(paidBooking._id).lean();
  assert.equal(bookingAfter.status, 'confirmed');
  assert.equal(bookingAfter.totalPrice, 300);
  assert.equal(bookingAfter.guestInfo.email, 'ada@example.com');
});

test('sweep is idempotent and returns zero when nothing is expired', async () => {
  const first = await runCheckoutHoldSweepOnce();
  assert.equal(first.tombstoned, 0);
  const second = await runCheckoutHoldSweepOnce();
  assert.equal(second.tombstoned, 0);
});

test('sweeper defaults to enabled and enforces a safe minimum tick', () => {
  assert.equal(isEnabled({}), true);
  assert.equal(isEnabled({ CHECKOUT_HOLD_SWEEP_ENABLED: '0' }), false);
  assert.equal(resolveTickMs({ CHECKOUT_HOLD_SWEEP_TICK_MS: '1000' }), 60 * 1000);
  assert.equal(resolveTickMs({ CHECKOUT_HOLD_SWEEP_TICK_MS: '30000' }), 30000);
});
