/**
 * Revenue + sleeps go-live fixes.
 * Run: node --test server/scripts/locationRevenueAndSleepsFix.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const Booking = require('../models/Booking');
const LocationBooking = require('../models/LocationBooking');
const { buildPublicLocationQuote } = require('../services/locationQuote/locationQuoteService');
const {
  createLocationCheckoutPaymentIntent,
  finalizeLocationCheckout
} = require('../services/locationCheckout/locationCheckoutService');
const { aggregateRevenueSummary } = require('../services/ops/reporting/revenueMetricsService');
const { resolveSleepsFromBedConfig } = require('../utils/bedSleeps');
const emailService = require('../services/emailService');

const PROPERTY_TIMEZONE = 'Europe/Sofia';

let mongoServer;
let originalSendEmail;

function sofiaDateOnly(daysFromToday) {
  return moment.tz(PROPERTY_TIMEZONE).startOf('day').add(daysFromToday, 'days').format('YYYY-MM-DD');
}

function guestInfo() {
  return {
    firstName: 'Revenue',
    lastName: 'Fix',
    email: `rev-${new mongoose.Types.ObjectId()}@example.com`,
    phone: '+359800000099'
  };
}

function quoteBody() {
  return {
    checkIn: sofiaDateOnly(10),
    checkOut: sofiaDateOnly(14),
    adults: 12,
    children: 0
  };
}

function mockStripe() {
  const store = new Map();
  return {
    paymentIntents: {
      async create({ amount, metadata }) {
        const id = `pi_fix_${new mongoose.Types.ObjectId()}`;
        const pi = {
          id,
          amount,
          currency: 'eur',
          status: 'requires_payment_method',
          client_secret: `${id}_secret`,
          metadata
        };
        store.set(id, pi);
        return pi;
      },
      async retrieve(id) {
        const pi = store.get(id);
        if (!pi) throw new Error('not found');
        return pi;
      }
    },
    markSucceeded(id) {
      const pi = store.get(id);
      if (pi) pi.status = 'succeeded';
    }
  };
}

async function seedFullValleyInventory() {
  const stone = await Cabin.create({
    name: 'Stone House',
    slug: 'stone-house',
    description: 'Stone',
    capacity: 6,
    minGuests: 1,
    pricePerNight: 25,
    buyoutPricePerNight: 180,
    pricingModel: 'per_person',
    minNights: 2,
    bedConfig: [
      { bedType: 'double', count: 2 },
      { bedType: 'single', count: 2 }
    ],
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'The Valley',
    propertyKind: 'valley',
    isActive: true,
    transportOptions: []
  });
  const lux = await Cabin.create({
    name: 'Lux Cabin',
    slug: 'lux-cabin',
    description: 'Lux',
    capacity: 2,
    minGuests: 1,
    pricePerNight: 85,
    buyoutPricePerNight: 85,
    pricingModel: 'per_night',
    minNights: 2,
    bedConfig: [{ bedType: 'double', count: 1 }],
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'The Valley',
    propertyKind: 'valley',
    isActive: true,
    transportOptions: []
  });
  const suffix = new mongoose.Types.ObjectId().toString().slice(-6);
  const cabinType = await CabinType.create({
    name: 'A-Frame',
    slug: `a-frame-${suffix}`,
    description: 'A-frame',
    capacity: 2,
    pricePerNight: 60,
    buyoutPricePerNight: 60,
    pricingModel: 'per_night',
    minNights: 2,
    bedConfig: [{ bedType: 'double', count: 1 }],
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'The Valley',
    propertyKind: 'valley',
    isActive: true,
    transportOptions: []
  });
  await Cabin.create({
    name: `A-Frame Parent ${suffix}`,
    description: 'Parent',
    capacity: 2,
    pricePerNight: 60,
    minNights: 2,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'The Valley',
    propertyKind: 'valley',
    inventoryType: 'multi',
    cabinTypeRef: cabinType._id,
    isActive: true,
    transportOptions: []
  });
  for (let i = 1; i <= 2; i += 1) {
    await Unit.create({
      cabinTypeId: cabinType._id,
      unitNumber: `AF-0${i}`,
      displayName: `A-Frame ${i}`,
      isActive: true
    });
  }
  return { stone, lux, cabinType };
}

async function finalizeValleyBuyout() {
  const stripe = mockStripe();
  const created = await createLocationCheckoutPaymentIntent(quoteBody(), { stripe });
  stripe.markSucceeded(created.paymentIntentId);
  await finalizeLocationCheckout(
    {
      checkoutSessionId: created.checkoutSessionId,
      paymentIntentId: created.paymentIntentId,
      adults: 12,
      children: 0,
      guestInfo: guestInfo()
    },
    { stripe }
  );
  return created;
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  originalSendEmail = emailService.sendEmail;
  emailService.sendEmail = async () => ({ success: true, method: 'test' });
  process.env.ADMIN_EMAIL = 'ops@test.local';
});

test.after(async () => {
  emailService.sendEmail = originalSendEmail;
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    Cabin.deleteMany({}),
    CabinType.deleteMany({}),
    Unit.deleteMany({}),
    Booking.deleteMany({}),
    LocationBooking.deleteMany({})
  ]);
});

test('sleeps: standard Valley inventory sums to 12 and matches capacity', async () => {
  await seedFullValleyInventory();
  const quote = await buildPublicLocationQuote('valley', quoteBody());

  const stone = quote.includedTargets.find((r) => r.slug === 'stone-house');
  const lux = quote.includedTargets.find((r) => r.slug === 'lux-cabin');
  const aframe = quote.includedTargets.find((r) => r.kind === 'cabin_type_units');

  assert.equal(stone.sleeps, 6);
  assert.equal(stone.capacity, 6);
  assert.equal(lux.sleeps, 2);
  assert.equal(lux.capacity, 2);
  assert.equal(aframe.sleeps, 4);
  assert.equal(aframe.capacity, 2);
  assert.equal(aframe.unitCount, 2);
  assert.equal(quote.totalSleeps, 12);

  assert.equal(resolveSleepsFromBedConfig(stone.bedConfig, stone.capacity), 6);
  assert.equal(resolveSleepsFromBedConfig([], 4), 4);

  console.log('[sleeps-fix] per-target:', quote.includedTargets.map((t) => ({
    name: t.name,
    sleeps: t.sleeps,
    capacity: t.capacity,
    unitCount: t.unitCount || 1,
    bedConfig: t.bedConfig
  })));
  console.log('[sleeps-fix] totalSleeps:', quote.totalSleeps);
});

test('revenue: whole-Valley buyout counts once at master total', async () => {
  await seedFullValleyInventory();
  await finalizeValleyBuyout();

  const from = sofiaDateOnly(9);
  const to = sofiaDateOnly(15);
  const summary = await aggregateRevenueSummary({
    propertyKind: 'valley',
    from,
    to,
    revenueBasis: 'checkIn'
  });

  const childCount = await Booking.countDocuments({ excludeFromRevenueReporting: true });
  const masterCount = await LocationBooking.countDocuments({ status: 'confirmed' });

  assert.equal(childCount, 4);
  assert.equal(masterCount, 1);
  assert.equal(summary.metrics.bookingCount, 1);
  assert.equal(summary.metrics.grossBookedRevenueCents, 154000);
  assert.equal(summary.metrics.cashCollectedCents, 154000);

  console.log('[revenue-fix] valley buyout summary sample:', JSON.stringify(summary, null, 2));
});

test('revenue: normal single-stay valley booking still counts exactly once', async () => {
  const { lux } = await seedFullValleyInventory();
  const checkIn = sofiaDateOnly(20);
  const checkOut = sofiaDateOnly(24);

  await Booking.create({
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: guestInfo(),
    totalPrice: 340,
    totalValueCents: 34000,
    stripePaidAmountCents: 34000,
    cabinId: lux._id,
    checkIn: new Date(checkIn),
    checkOut: new Date(checkOut),
    provenance: { source: 'guest_portal' }
  });

  const summary = await aggregateRevenueSummary({
    propertyKind: 'valley',
    from: checkIn,
    to: checkOut,
    revenueBasis: 'checkIn'
  });

  assert.equal(summary.metrics.bookingCount, 1);
  assert.equal(summary.metrics.grossBookedRevenueCents, 34000);

  console.log('[revenue-fix] single-stay summary sample:', JSON.stringify(summary, null, 2));
});

test('revenue: buyout children excluded even without master in range edge', async () => {
  await seedFullValleyInventory();
  await finalizeValleyBuyout();

  const childrenOnly = await aggregateRevenueSummary({
    propertyKind: 'valley',
    from: sofiaDateOnly(-30),
    to: sofiaDateOnly(-20),
    revenueBasis: 'checkIn'
  });

  assert.equal(childrenOnly.metrics.bookingCount, 0);
  assert.equal(childrenOnly.metrics.grossBookedRevenueCents, 0);
});
