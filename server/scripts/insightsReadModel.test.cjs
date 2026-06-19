'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Cabin = require('../models/Cabin');
const Booking = require('../models/Booking');
const { getInsightsSummaryReadModel } = require('../services/ops/readModels/insightsReadModel');

let mongoServer;

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([Cabin.deleteMany({}), Booking.deleteMany({})]);
});

test('revenueBasis=checkIn filters by check-in date', async () => {
  const cabin = await Cabin.create({
    name: 'Insights Cabin',
    description: 'd',
    location: 'Bachevo',
    capacity: 2,
    pricePerNight: 100,
    minNights: 2,
    propertyKind: 'cabin',
    imageUrl: 'https://example.com/cabin.jpg'
  });

  await Booking.create({
    cabinId: cabin._id,
    checkIn: new Date('2026-07-10T00:00:00.000Z'),
    checkOut: new Date('2026-07-12T00:00:00.000Z'),
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'A', lastName: 'B', email: 'insights@test.com', phone: '+359800000001' },
    totalPrice: 200,
    totalValueCents: 20000,
    status: 'confirmed',
    provenance: { source: 'guest_portal' }
  });

  const data = await getInsightsSummaryReadModel({
    propertyKind: 'cabin',
    from: '2026-07-01',
    to: '2026-07-31',
    revenueBasis: 'checkIn'
  });

  assert.equal(data.metrics.bookingCount, 1);
  assert.equal(data.metrics.grossBookedRevenueCents, 20000);
  assert.equal(data.revenueBasis, 'checkIn');
  assert.match(data.provenance.revenueBasisNote, /check-in date/i);
});

test('revenueBasis=booked filters by createdAt', async () => {
  const cabin = await Cabin.create({
    name: 'Insights Cabin Booked',
    description: 'd',
    location: 'Bachevo',
    capacity: 2,
    pricePerNight: 100,
    minNights: 2,
    propertyKind: 'cabin',
    imageUrl: 'https://example.com/cabin.jpg'
  });

  const booking = await Booking.create({
    cabinId: cabin._id,
    checkIn: new Date('2026-08-10T00:00:00.000Z'),
    checkOut: new Date('2026-08-12T00:00:00.000Z'),
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'A', lastName: 'B', email: 'insights-booked@test.com', phone: '+359800000002' },
    totalPrice: 150,
    totalValueCents: 15000,
    status: 'confirmed',
    provenance: { source: 'guest_portal' }
  });

  booking.createdAt = new Date('2026-06-15T12:00:00.000Z');
  await booking.save();

  const checkInData = await getInsightsSummaryReadModel({
    propertyKind: 'cabin',
    from: '2026-08-01',
    to: '2026-08-31',
    revenueBasis: 'checkIn'
  });
  assert.equal(checkInData.metrics.bookingCount, 1);

  const bookedData = await getInsightsSummaryReadModel({
    propertyKind: 'cabin',
    from: '2026-06-01',
    to: '2026-06-30',
    revenueBasis: 'booked'
  });
  assert.equal(bookedData.metrics.bookingCount, 1);
});

test('cancelled bookings excluded from gross revenue', async () => {
  const cabin = await Cabin.create({
    name: 'Insights Cabin Cancel',
    description: 'd',
    location: 'Bachevo',
    capacity: 2,
    pricePerNight: 100,
    minNights: 2,
    propertyKind: 'cabin',
    imageUrl: 'https://example.com/cabin.jpg'
  });

  await Booking.create({
    cabinId: cabin._id,
    checkIn: new Date('2026-07-15T00:00:00.000Z'),
    checkOut: new Date('2026-07-17T00:00:00.000Z'),
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'A', lastName: 'B', email: 'cancel@test.com', phone: '+359800000003' },
    totalPrice: 300,
    totalValueCents: 30000,
    status: 'cancelled',
    provenance: { source: 'guest_portal' }
  });

  const data = await getInsightsSummaryReadModel({
    propertyKind: 'cabin',
    from: '2026-07-01',
    to: '2026-07-31',
    revenueBasis: 'checkIn'
  });

  assert.equal(data.metrics.bookingCount, 0);
  assert.equal(data.metrics.cancelledCount, 1);
  assert.equal(data.metrics.grossBookedRevenueCents, 0);
  assert.equal(data.metrics.cancelledRevenueCents, 30000);
});
