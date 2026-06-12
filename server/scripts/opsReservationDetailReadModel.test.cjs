/**
 * C7 — reservation detail read model stayPropertyKind for GMA preview wiring.
 *
 * Run: node --test scripts/opsReservationDetailReadModel.test.cjs (from server/)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const crypto = require('crypto');

const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Booking = require('../models/Booking');
const { getReservationDetailReadModel } = require('../services/ops/readModels/reservationDetailReadModel');

let mongoServer;

async function createCabinBooking() {
  const cabin = await Cabin.create({
    name: 'Ops detail cabin',
    description: 'd',
    location: 'Test',
    capacity: 2,
    minGuests: 1,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/cabin.jpg',
    propertyKind: 'cabin'
  });
  const checkIn = new Date();
  checkIn.setDate(checkIn.getDate() + 10);
  const checkOut = new Date(checkIn);
  checkOut.setDate(checkOut.getDate() + 2);
  const booking = await Booking.create({
    cabinId: cabin._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'T', lastName: 'G', email: 't@g.com', phone: '+359881111111' },
    status: 'confirmed',
    totalPrice: 200,
    subtotalPrice: 200,
    discountAmount: 0,
    totalValueCents: 20000,
    giftVoucherAppliedCents: 0,
    stripePaidAmountCents: 20000,
    stripePaymentIntentId: `pi_${crypto.randomBytes(8).toString('hex')}`
  });
  return booking;
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([Booking.deleteMany({}), Cabin.deleteMany({}), CabinType.deleteMany({})]);
});

test('getReservationDetailReadModel exposes stayPropertyKind for cabin booking', async () => {
  const booking = await createCabinBooking();
  const detail = await getReservationDetailReadModel(String(booking._id));
  assert.ok(detail);
  assert.equal(detail.stayPropertyKind, 'cabin');
});

test('getReservationDetailReadModel exposes stayPropertyKind for valley cabinType booking', async () => {
  const cabinType = await CabinType.create({
    name: 'The Valley',
    slug: 'the-valley-detail',
    description: 'd',
    location: 'Valley',
    capacity: 4,
    minGuests: 1,
    pricePerNight: 120,
    minNights: 1,
    imageUrl: 'https://example.com/valley.jpg',
    propertyKind: 'valley'
  });
  const checkIn = new Date();
  checkIn.setDate(checkIn.getDate() + 10);
  const checkOut = new Date(checkIn);
  checkOut.setDate(checkOut.getDate() + 2);
  const booking = await Booking.create({
    cabinTypeId: cabinType._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'V', lastName: 'G', email: 'v@g.com', phone: '+359882222222' },
    status: 'confirmed',
    totalPrice: 240,
    subtotalPrice: 240,
    discountAmount: 0,
    totalValueCents: 24000,
    giftVoucherAppliedCents: 0,
    stripePaidAmountCents: 24000,
    stripePaymentIntentId: `pi_${crypto.randomBytes(8).toString('hex')}`
  });

  const detail = await getReservationDetailReadModel(String(booking._id));
  assert.ok(detail);
  assert.equal(detail.stayPropertyKind, 'valley');
});
