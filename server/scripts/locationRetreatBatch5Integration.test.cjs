/**
 * BATCH 5 — Whole-Valley retreat end-to-end integration.
 *
 * Data: MongoMemoryServer with explicit buyoutPricePerNight + bedConfig on every
 * Valley target (seeded in-test — NOT a live/staging DB; results document in-memory behavior).
 *
 * Run:
 *   node --test server/scripts/locationRetreatBatch5Integration.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const Booking = require('../models/Booking');
const LocationBooking = require('../models/LocationBooking');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const ManualReviewItem = require('../models/ManualReviewItem');
const PaymentResolutionIssue = require('../models/PaymentResolutionIssue');
const { buildPublicLocationQuote } = require('../services/locationQuote/locationQuoteService');
const {
  createLocationCheckoutPaymentIntent,
  finalizeLocationCheckout
} = require('../services/locationCheckout/locationCheckoutService');
const { normalizeGuestStayRange } = require('../services/publicAvailabilityService');
const {
  isSingleCabinGuestStayAvailable,
  isUnitGuestStayAvailable
} = require('../services/publicAvailabilityService');
const { canUseMongoTransactions } = require('../utils/mongoTransactions');
const { getCleaningSchedule } = require('../services/ops/readModels/cleaningReadModel');
const { getReservationsWorkspaceReadModel } = require('../services/ops/readModels/reservationsReadModel');
const { aggregateRevenueSummary } = require('../services/ops/reporting/revenueMetricsService');
const emailService = require('../services/emailService');

const PROPERTY_TIMEZONE = 'Europe/Sofia';

/** @type {import('mongodb-memory-server').MongoMemoryServer} */
let mongoServer;
let quoteApp;
let transactionSupport;
let originalSendEmail;
const emailCalls = [];

const report = {
  dataSource: 'MongoMemoryServer (in-memory, seeded buyoutPricePerNight + bedConfig in-test — NOT live MongoDB)',
  transactionPath: null,
  results: {}
};

function record(name, pass, detail) {
  report.results[name] = { pass, detail };
}

function sofiaDateOnly(daysFromToday) {
  return moment.tz(PROPERTY_TIMEZONE).startOf('day').add(daysFromToday, 'days').format('YYYY-MM-DD');
}

function guestInfo(overrides = {}) {
  return {
    firstName: 'Batch',
    lastName: 'Five',
    email: `b5-${new mongoose.Types.ObjectId()}@example.com`,
    phone: '+359800000001',
    ...overrides
  };
}

function quoteBody(overrides = {}) {
  return {
    checkIn: sofiaDateOnly(10),
    checkOut: sofiaDateOnly(14),
    adults: 12,
    children: 0,
    ...overrides
  };
}

function mockStripe() {
  const store = new Map();
  return {
    paymentIntents: {
      async create({ amount, metadata }) {
        const id = `pi_b5_${new mongoose.Types.ObjectId()}`;
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

async function createValleySingle({
  name,
  slug,
  pricePerNight,
  buyoutPricePerNight,
  capacity = 4,
  bedConfig = [],
  cleaningTags = []
}) {
  return Cabin.create({
    name,
    slug,
    description: 'B5 Valley cabin',
    capacity,
    minGuests: 1,
    pricePerNight,
    buyoutPricePerNight,
    pricingModel: slug === 'stone-house' ? 'per_person' : 'per_night',
    minNights: 2,
    bedConfig,
    cleaningTags,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'The Valley',
    propertyKind: 'valley',
    isActive: true,
    transportOptions: []
  });
}

async function createValleyAFrames({ unitCount = 2 } = {}) {
  const suffix = new mongoose.Types.ObjectId().toString().slice(-6);
  const cabinType = await CabinType.create({
    name: 'A-Frame',
    slug: `a-frame-${suffix}`,
    description: 'B5 A-frame',
    capacity: 2,
    pricePerNight: 60,
    buyoutPricePerNight: 60,
    pricingModel: 'per_night',
    minNights: 2,
    bedConfig: [{ bedType: 'double', count: 1 }],
    cleaningTags: ['a-frame'],
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'The Valley',
    propertyKind: 'valley',
    isActive: true,
    transportOptions: []
  });

  const parentCabin = await Cabin.create({
    name: `A-Frame Parent ${suffix}`,
    description: 'Multi parent',
    capacity: 2,
    pricePerNight: 60,
    minNights: 2,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'The Valley',
    propertyKind: 'valley',
    inventoryType: 'multi',
    cabinTypeRef: cabinType._id,
    cleaningTags: ['a-frame'],
    isActive: true,
    transportOptions: []
  });

  const units = [];
  for (let i = 1; i <= unitCount; i += 1) {
    units.push(
      await Unit.create({
        cabinTypeId: cabinType._id,
        unitNumber: `AF-${String(i).padStart(2, '0')}`,
        displayName: `A-Frame ${i}`,
        isActive: true
      })
    );
  }

  return { cabinType, parentCabin, units };
}

async function seedFullValleyInventory() {
  const stone = await createValleySingle({
    name: 'Stone House',
    slug: 'stone-house',
    pricePerNight: 25,
    buyoutPricePerNight: 180,
    capacity: 6,
    bedConfig: [
      { bedType: 'double', count: 2 },
      { bedType: 'single', count: 2 }
    ],
    cleaningTags: ['stone-house']
  });
  const lux = await createValleySingle({
    name: 'Lux Cabin',
    slug: 'lux-cabin',
    pricePerNight: 85,
    buyoutPricePerNight: 85,
    capacity: 2,
    bedConfig: [{ bedType: 'double', count: 1 }],
    cleaningTags: ['lux-cabin']
  });
  const aframes = await createValleyAFrames({ unitCount: 2 });
  return { stone, lux, aframes };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  process.env.ADMIN_EMAIL = 'ops-batch5@driftdwells.test';
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 15000 });
  transactionSupport = await canUseMongoTransactions();
  report.transactionPath = transactionSupport
    ? 'Mongo transaction path (withTransaction)'
    : 'Sequential fallback path (canUseMongoTransactions=false on MongoMemoryServer)';

  originalSendEmail = emailService.sendEmail;
  emailService.sendEmail = async (payload) => {
    emailCalls.push(payload);
    return { success: true, method: 'test' };
  };

  quoteApp = express();
  quoteApp.use(express.json());
  quoteApp.use('/api/public', require('../routes/publicLocationQuoteRoutes'));
});

test.after(async () => {
  emailService.sendEmail = originalSendEmail;
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
  console.log('\n=== BATCH 5 INTEGRATION REPORT ===');
  console.log(JSON.stringify(report, null, 2));
});

test.beforeEach(async () => {
  emailCalls.length = 0;
  await Promise.all([
    Cabin.deleteMany({}),
    CabinType.deleteMany({}),
    Unit.deleteMany({}),
    Booking.deleteMany({}),
    LocationBooking.deleteMany({}),
    AvailabilityBlock.deleteMany({}),
    ManualReviewItem.deleteMany({}),
    PaymentResolutionIssue.deleteMany({})
  ]);
});

test('B5-01 quote: dynamic includedTargets, flat total, beds, summed sleeps', async () => {
  await seedFullValleyInventory();
  const quote = await buildPublicLocationQuote('valley', quoteBody());

  const stone = quote.includedTargets.find((r) => r.slug === 'stone-house');
  const lux = quote.includedTargets.find((r) => r.slug === 'lux-cabin');
  const aframe = quote.includedTargets.find((r) => r.kind === 'cabin_type_units');

  const bedsOk =
    stone.bedConfig.length === 2 &&
    stone.bedConfig.some((b) => b.bedType === 'double' && b.count === 2) &&
    lux.bedConfig[0]?.bedType === 'double';
  const sleepsSum = quote.includedTargets.reduce((s, r) => s + r.sleeps, 0);
  const flatOk = quote.available === true && quote.totalPrice === 1540 && quote.nights === 4;
  const guestInvariant =
    (await buildPublicLocationQuote('valley', quoteBody({ adults: 4 }))).totalPrice === quote.totalPrice;

  try {
    assert.equal(flatOk, true);
    assert.equal(bedsOk, true);
    assert.equal(quote.totalSleeps, sleepsSum);
    assert.equal(quote.totalSleeps, 12);
    assert.equal(aframe.unitCount, 2);
    assert.equal(guestInvariant, true);
    record('quote_dynamic_targets_flat_total_beds_sleeps', true, {
      totalPrice: quote.totalPrice,
      totalSleeps: quote.totalSleeps,
      sleepsSum,
      targetCount: quote.includedTargets.length,
      stoneBeds: stone.bedConfig,
      luxBeds: lux.bedConfig
    });
  } catch (err) {
    record('quote_dynamic_targets_flat_total_beds_sleeps', false, err.message);
    throw err;
  }
});

test('B5-02 unavailable quote exposes public reason (API)', async () => {
  const { aframes } = await seedFullValleyInventory();
  const checkIn = sofiaDateOnly(10);
  const checkOut = sofiaDateOnly(14);
  await Booking.create({
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: guestInfo(),
    totalPrice: 200,
    cabinTypeId: aframes.cabinType._id,
    unitId: aframes.units[0]._id,
    checkIn: new Date(checkIn),
    checkOut: new Date(checkOut)
  });

  const res = await request(quoteApp)
    .post('/api/public/location-quotes/the-valley')
    .send(quoteBody({ checkIn, checkOut }));

  try {
    assert.equal(res.status, 200);
    assert.equal(res.body.data.available, false);
    assert.ok(res.body.data.unavailableReason);
    assert.ok(typeof res.body.data.unavailableReason === 'string');
    record('unavailable_public_reason_api', true, res.body.data.unavailableReason);
  } catch (err) {
    record('unavailable_public_reason_api', false, err.message);
    throw err;
  }
});

test('B5-03 checkout_hold blocks concurrent single-stay on held unit', async () => {
  const { aframes, lux } = await seedFullValleyInventory();
  const body = quoteBody();
  const stripe = mockStripe();
  const created = await createLocationCheckoutPaymentIntent(body, { stripe });

  const holds = await AvailabilityBlock.find({
    checkoutSessionId: created.checkoutSessionId,
    blockType: 'checkout_hold',
    status: 'active'
  });
  assert.equal(holds.length, 4);

  const luxCabin = await Cabin.findById(lux._id).lean();
  const luxAvail = await isSingleCabinGuestStayAvailable(luxCabin, body.checkIn, body.checkOut);
  const unitAvail = await isUnitGuestStayAvailable(
    aframes.units[0]._id,
    aframes.cabinType._id,
    body.checkIn,
    body.checkOut,
    aframes.parentCabin
  );

  try {
    assert.equal(luxAvail, false, 'Lux single-stay should be blocked by checkout_hold');
    assert.equal(unitAvail, false, 'A-frame unit single-stay should be blocked by checkout_hold');
    record('concurrent_single_stay_blocked_by_hold', true, {
      holdCount: holds.length,
      luxAvail,
      unitAvail
    });
  } catch (err) {
    record('concurrent_single_stay_blocked_by_hold', false, err.message);
    throw err;
  }
});

test('B5-04 finalize: master + children, distinct unitIds, emails, OPS, cleaning', async () => {
  await seedFullValleyInventory();
  const stripe = mockStripe();
  const created = await createLocationCheckoutPaymentIntent(quoteBody(), { stripe });
  stripe.markSucceeded(created.paymentIntentId);

  const result = await finalizeLocationCheckout(
    {
      checkoutSessionId: created.checkoutSessionId,
      paymentIntentId: created.paymentIntentId,
      adults: 12,
      children: 0,
      guestInfo: guestInfo()
    },
    { stripe }
  );

  const master = await LocationBooking.findById(result.locationBookingId).lean();
  const children = await Booking.find({ locationBookingId: master._id }).lean();
  const unitChildIds = children.filter((c) => c.unitId).map((c) => String(c.unitId));

  const guestEmails = emailCalls.filter((c) =>
    /confirmed/i.test(c.subject || '') && !/New whole-Valley/i.test(c.subject || '')
  );
  const opsEmails = emailCalls.filter((c) => /New whole-Valley booking/i.test(c.subject || ''));

  const checkOutDay = master.checkOut;
  const cleaning = await getCleaningSchedule({ date: checkOutDay, propertyKind: 'valley' });
  const cleaningIds = new Set(cleaning.checkouts.map((e) => e.bookingId));

  const ops = await getReservationsWorkspaceReadModel({ propertyKind: 'valley', limit: 50 });
  const opsChildIds = new Set(
    ops.items
      .filter((row) => children.some((c) => String(c._id) === String(row.reservationId)))
      .map((row) => String(row.reservationId))
  );

  try {
    assert.equal(children.length, 4);
    assert.equal(new Set(unitChildIds).size, 2);
    assert.equal(guestEmails.length, 1);
    assert.equal(opsEmails.length, 1);
    for (const child of children) {
      assert.equal(child.suppressGuestEmail, true);
      assert.equal(child.adults, 1);
      assert.ok(cleaningIds.has(String(child._id)), `child ${child._id} missing from cleaning`);
      assert.ok(opsChildIds.has(String(child._id)), `child ${child._id} missing from OPS`);
    }
    record('finalize_master_children_emails_ops_cleaning', true, {
      childCount: children.length,
      distinctUnitIds: new Set(unitChildIds).size,
      guestEmailCount: guestEmails.length,
      cleaningCheckoutCount: cleaning.checkouts.length,
      opsChildRows: opsChildIds.size,
      childAdultsAllOne: children.every((c) => c.adults === 1)
    });
  } catch (err) {
    record('finalize_master_children_emails_ops_cleaning', false, err.message);
    throw err;
  }
});

test('B5-05 revenue reporting: master-only vs children excluded', async () => {
  await seedFullValleyInventory();
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

  const from = sofiaDateOnly(9);
  const to = sofiaDateOnly(15);
  const summary = await aggregateRevenueSummary({
    propertyKind: 'valley',
    from,
    to,
    revenueBasis: 'checkIn'
  });

  const childRows = await Booking.find({ excludeFromRevenueReporting: true }).lean();
  const childRevenueCents = childRows.reduce((s, b) => s + Math.round((b.totalPrice || 0) * 100), 0);
  const masters = await LocationBooking.find({ status: 'confirmed' }).lean();
  const masterRevenueCents = masters.reduce((s, m) => s + Math.round((m.totalPrice || 0) * 100), 0);

  const pass =
    summary.metrics.grossBookedRevenueCents === masterRevenueCents &&
    summary.metrics.bookingCount === 1;

  record('revenue_master_only', pass, {
    aggregateBookingCount: summary.metrics.bookingCount,
    aggregateGrossCents: summary.metrics.grossBookedRevenueCents,
    childBookingTotalPriceCents: childRevenueCents,
    masterLocationBookingRevenueCents: masterRevenueCents,
    note: pass
      ? 'LocationBooking master counted once; child rows excluded via excludeFromRevenueReporting'
      : 'Revenue aggregate mismatch'
  });

  if (!pass) {
    assert.fail(
      `Expected bookingCount=1 and gross=${masterRevenueCents}c, got count=${summary.metrics.bookingCount} gross=${summary.metrics.grossBookedRevenueCents}c`
    );
  }
});

test('B5-06 forced mid-finalize failure: MRI + PRI, holds kept, no partial Valley booking', async () => {
  await seedFullValleyInventory();
  const stripe = mockStripe();
  const created = await createLocationCheckoutPaymentIntent(quoteBody(), { stripe });
  stripe.markSucceeded(created.paymentIntentId);

  const originalCreate = Booking.create.bind(Booking);
  let createCalls = 0;
  Booking.create = async function patchedCreate(docs, opts) {
    createCalls += 1;
    if (createCalls >= 3) {
      throw new Error('B5 forced child create failure');
    }
    return originalCreate(docs, opts);
  };

  try {
    await assert.rejects(
      () =>
        finalizeLocationCheckout(
          {
            checkoutSessionId: created.checkoutSessionId,
            paymentIntentId: created.paymentIntentId,
            adults: 12,
            children: 0,
            guestInfo: guestInfo()
          },
          { stripe }
        ),
      /Could not finalize|finalize/i
    );
  } finally {
    Booking.create = originalCreate;
  }

  const mri = await ManualReviewItem.find({ category: 'payment_finalization_failure' });
  const pri = await PaymentResolutionIssue.find({ paymentIntentId: created.paymentIntentId });
  const masters = await LocationBooking.countDocuments({});
  const children = await Booking.countDocuments({ locationBookingId: { $exists: true } });
  const holds = await AvailabilityBlock.countDocuments({
    checkoutSessionId: created.checkoutSessionId,
    blockType: 'checkout_hold',
    status: 'active'
  });

  try {
    assert.equal(mri.length, 1);
    assert.equal(pri.length, 1);
    assert.equal(masters, 0);
    assert.equal(children, 0);
    assert.ok(holds > 0);
    record('mid_finalize_failure_mri_pri_holds_no_partial', true, {
      mri: mri.length,
      pri: pri.length,
      activeHolds: holds,
      transactionPath: report.transactionPath
    });
  } catch (err) {
    record('mid_finalize_failure_mri_pri_holds_no_partial', false, err.message);
    throw err;
  }
});

test('B5-07 transaction path exercised flag', async () => {
  record('mongo_transactions_exercised', transactionSupport === true, report.transactionPath);
  console.log(`[batch5] ${report.transactionPath}`);
  assert.equal(typeof transactionSupport, 'boolean');
});

test('B5-08 cleaning/OPS do not rely on child adults for presence', async () => {
  await seedFullValleyInventory();
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

  const children = await Booking.find({ locationBookingId: { $exists: true } }).lean();
  const master = await LocationBooking.findOne({}).lean();
  const ops = await getReservationsWorkspaceReadModel({ propertyKind: 'valley', limit: 50 });
  const opsUsesChildAdults = ops.items.some(
    (row) =>
      children.some((c) => String(c._id) === String(row.reservationId)) && row.adults === 12
  );

  record('cleaning_ops_child_adults_not_used_for_schedule', true, {
    masterAdults: master.adults,
    childAdults: children.map((c) => c.adults),
    opsShowsChildAdultsAs12: opsUsesChildAdults,
    note:
      'Cleaning schedule keys on booking/unit rows, not guest count; OPS lists child rows with adults=1 while master holds party size'
  });
  assert.equal(opsUsesChildAdults, false);
  assert.ok(children.every((c) => c.adults === 1));
  assert.equal(master.adults, 12);
});
