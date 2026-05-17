'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';

const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const Booking = require('../models/Booking');
const bookingRoutes = require('../routes/bookingRoutes');
const {
  buildBookingConfirmation,
  buildDisplayEntity,
  buildUnitLabel,
  derivePaymentSummary
} = require('../services/bookings/bookingConfirmationReadModel');

let mongoServer;
let app;

function buildApp() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/bookings', bookingRoutes);
  return instance;
}

function nextDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

async function createCabin(overrides = {}) {
  return Cabin.create({
    name: 'Stone House',
    description: 'Quiet cabin',
    capacity: 4,
    minGuests: 1,
    pricePerNight: 180,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'The Valley',
    meetingPoint: {
      label: 'Valley gate',
      googleMapsUrl: 'https://maps.google.com/?q=valley',
      lat: 41.9,
      lng: 23.4,
      what3words: 'drift.dwells.retreat'
    },
    packingList: ['Boots', 'Torch'],
    arrivalGuideUrl: 'https://example.com/guide.pdf',
    safetyNotes: 'No fires outside',
    emergencyContact: '+359 88 000 0000',
    arrivalWindowDefault: '14:00–18:00',
    isActive: true,
    transportOptions: [],
    ...overrides
  });
}

async function createCabinType(overrides = {}) {
  const suffix = crypto.randomBytes(4).toString('hex');
  return CabinType.create({
    name: `A-Frame ${suffix}`,
    slug: `a-frame-${suffix}`,
    description: 'Multi-unit stay',
    capacity: 2,
    minGuests: 1,
    pricePerNight: 120,
    minNights: 1,
    imageUrl: '/uploads/cabins/aframe.jpg',
    location: 'Bansko slopes',
    meetingPoint: { label: 'Parking A' },
    packingList: ['Warm layer'],
    ...overrides
  });
}

async function createUnit(cabinTypeId, overrides = {}) {
  return Unit.create({
    cabinTypeId,
    unitNumber: 'AF-01',
    displayName: 'A-Frame 1',
    ...overrides
  });
}

async function createBookingDoc(payload) {
  return Booking.create({
    checkIn: nextDate(10),
    checkOut: nextDate(12),
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Ivaylo',
      lastName: 'Guest',
      email: 'ivaylo@example.com',
      phone: '+359881111111'
    },
    status: 'confirmed',
    totalPrice: 360,
    subtotalPrice: 360,
    discountAmount: 0,
    totalValueCents: 36000,
    ...payload
  });
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  app = buildApp();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    Booking.deleteMany({}),
    Unit.deleteMany({}),
    CabinType.deleteMany({}),
    Cabin.deleteMany({})
  ]);
});

test('cabin booking DTO uses populated cabin displayEntity', async () => {
  const cabin = await createCabin();
  const booking = await createBookingDoc({
    cabinId: cabin._id,
    stripePaymentIntentId: 'pi_cabin_1',
    stripePaidAmountCents: 36000,
    paymentMethod: 'stripe'
  });
  await booking.populate('cabinId', 'name location meetingPoint packingList arrivalGuideUrl safetyNotes emergencyContact arrivalWindowDefault');

  const dto = buildBookingConfirmation(booking, { queryEmail: 'ivaylo@example.com' });
  assert.equal(dto.displayEntity.type, 'cabin');
  assert.equal(dto.displayEntity.name, 'Stone House');
  assert.equal(dto.displayEntity.location, 'The Valley');
  assert.equal(dto.displayEntity.meetingPoint.googleMapsUrl, 'https://maps.google.com/?q=valley');
  assert.equal(dto.paymentSummary.paid, true);
  assert.equal(dto.paymentSummary.copyKey, 'success.paymentPaidOnline');
});

test('cabinType-only booking DTO uses cabinType displayEntity', async () => {
  const cabinType = await createCabinType({ name: 'A-Frame Valley' });
  const booking = await createBookingDoc({
    cabinTypeId: cabinType._id,
    stripePaymentIntentId: 'pi_aframe_1',
    stripePaidAmountCents: 24000,
    paymentMethod: 'stripe'
  });
  await booking.populate('cabinTypeId', 'name location meetingPoint packingList arrivalGuideUrl safetyNotes emergencyContact arrivalWindowDefault');

  const dto = buildBookingConfirmation(booking);
  assert.equal(dto.displayEntity.type, 'cabinType');
  assert.equal(dto.displayEntity.name, 'A-Frame Valley');
  assert.equal(dto.unitLabel, null);
});

test('missing entity uses safe fallback', async () => {
  const booking = await createBookingDoc({
    cabinId: new mongoose.Types.ObjectId(),
    status: 'pending',
    paymentMethod: 'stripe'
  });
  const dto = buildBookingConfirmation(booking);
  assert.equal(dto.displayEntity.type, 'unknown');
  assert.equal(dto.displayEntity.name, 'Your stay');
  assert.equal(dto.displayEntity.location, '');
  assert.deepEqual(dto.displayEntity.packingList, []);
});

test('unitLabel prefers displayName then unit number', async () => {
  const cabinType = await createCabinType();
  const unit = await createUnit(cabinType._id);
  const booking = await createBookingDoc({ cabinTypeId: cabinType._id, unitId: unit._id });
  await booking.populate('unitId', 'unitNumber displayName');
  assert.equal(buildUnitLabel(booking.toObject()), 'A-Frame 1');

  const unit2 = await createUnit(cabinType._id, { unitNumber: 'AF-02', displayName: '' });
  const booking2 = await createBookingDoc({ cabinTypeId: cabinType._id, unitId: unit2._id });
  await booking2.populate('unitId', 'unitNumber displayName');
  assert.equal(buildUnitLabel(booking2.toObject()), 'Unit AF-02');
});

test('paid card summary requires confirmed status and PI', () => {
  const summary = derivePaymentSummary({
    status: 'confirmed',
    paymentMethod: 'stripe',
    stripePaymentIntentId: 'pi_123',
    stripePaidAmountCents: 5000,
    giftVoucherAppliedCents: 0,
    totalPrice: 50
  });
  assert.equal(summary.paid, true);
  assert.equal(summary.copyKey, 'success.paymentPaidOnline');
  assert.equal(summary.cardPaidAmount, 50);
});

test('pending summary is not paid even when paymentMethod defaults to stripe', () => {
  const summary = derivePaymentSummary({
    status: 'pending',
    paymentMethod: 'stripe',
    stripePaymentIntentId: null,
    stripePaidAmountCents: 0,
    giftVoucherAppliedCents: 0,
    totalPrice: 360
  });
  assert.equal(summary.paid, false);
  assert.equal(summary.copyKey, 'success.paymentPendingOnArrival');
});

test('full voucher summary', () => {
  const summary = derivePaymentSummary({
    status: 'confirmed',
    paymentMethod: 'gift_voucher',
    stripePaymentIntentId: null,
    stripePaidAmountCents: 0,
    giftVoucherAppliedCents: 36000,
    totalPrice: 360
  });
  assert.equal(summary.paid, true);
  assert.equal(summary.method, 'gift_voucher');
  assert.equal(summary.copyKey, 'success.paymentCoveredByVoucher');
  assert.equal(summary.voucherAppliedAmount, 360);
});

test('mixed voucher+card summary', () => {
  const summary = derivePaymentSummary({
    status: 'confirmed',
    paymentMethod: 'stripe_plus_gift_voucher',
    stripePaymentIntentId: 'pi_mix',
    stripePaidAmountCents: 11000,
    giftVoucherAppliedCents: 25000,
    totalPrice: 360
  });
  assert.equal(summary.paid, true);
  assert.equal(summary.method, 'stripe_plus_gift_voucher');
  assert.equal(summary.copyKey, 'success.paymentCardAndVoucher');
  assert.equal(summary.cardPaidAmount, 110);
  assert.equal(summary.voucherAppliedAmount, 250);
});

test('paymentMethod alone does not mark paid when pending', () => {
  const summary = derivePaymentSummary({
    status: 'pending',
    paymentMethod: 'gift_voucher',
    stripePaymentIntentId: null,
    stripePaidAmountCents: 0,
    giftVoucherAppliedCents: 36000,
    totalPrice: 360
  });
  assert.equal(summary.paid, false);
});

test('GET confirmation route returns DTO', async () => {
  const cabinType = await createCabinType({ name: 'Route A-Frame' });
  const booking = await createBookingDoc({
    cabinTypeId: cabinType._id,
    stripePaymentIntentId: 'pi_route',
    stripePaidAmountCents: 10000,
    paymentMethod: 'stripe'
  });

  const res = await request(app)
    .get(`/api/bookings/${booking._id}/confirmation`)
    .query({ email: 'ivaylo@example.com' });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.confirmation.displayEntity.name, 'Route A-Frame');
  assert.equal(res.body.data.confirmation.guest.email, 'ivaylo@example.com');
});

test('GET /:id still returns raw booking for legacy consumers', async () => {
  const cabin = await createCabin();
  const booking = await createBookingDoc({ cabinId: cabin._id });

  const res = await request(app).get(`/api/bookings/${booking._id}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.data.booking);
  assert.ok(res.body.data.booking.cabinId);
});

test('route order does not treat confirmation as booking id', async () => {
  const cabin = await createCabin();
  const booking = await createBookingDoc({ cabinId: cabin._id });

  const bad = await request(app).get('/api/bookings/confirmation');
  assert.notEqual(bad.status, 200);

  const good = await request(app).get(`/api/bookings/${booking._id}/confirmation`);
  assert.equal(good.status, 200);
  assert.ok(good.body.data.confirmation.bookingId);
});

test('buildDisplayEntity prefers cabin over cabinType when both populated', () => {
  const entity = buildDisplayEntity({
    cabinId: { name: 'Cabin Win' },
    cabinTypeId: { name: 'Type Lose' }
  });
  assert.equal(entity.name, 'Cabin Win');
  assert.equal(entity.type, 'cabin');
});
