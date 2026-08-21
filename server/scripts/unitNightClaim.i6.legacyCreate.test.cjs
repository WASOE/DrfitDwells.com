/**
 * I6 corrective pass — legacy POST /api/bookings claim-before-save contract.
 *
 * Run: cd server && node --test scripts/unitNightClaim.i6.legacyCreate.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const Booking = require('../models/Booking');
const UnitNightClaim = require('../models/UnitNightClaim');
const ManualReviewItem = require('../models/ManualReviewItem');
const PaymentResolutionIssue = require('../models/PaymentResolutionIssue');
const bookingRoutes = require('../routes/bookingRoutes');
const {
  claimUnitNights,
  ensureAuthoritativeUniqueIndexForTests,
  ERR
} = require('../services/inventory/unitNightClaimService');
const { normalizeGuestStayRange } = require('../services/publicAvailabilityService');
const {
  LEGAL_ACCEPTANCE_TERMS_VERSION,
  LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
  LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
} = require('../config/legalAcceptance');

const ROUTES_PATH = path.join(__dirname, '../routes/bookingRoutes.js');

let mongoServer;
let app;
let savedEnv;

function buildApp() {
  const instance = express();
  instance.set('trust proxy', 1);
  instance.use(express.json());
  instance.use('/api/bookings', bookingRoutes);
  return instance;
}

function nextDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function normalizeStayDates(checkIn, checkOut) {
  const n = normalizeGuestStayRange(checkIn, checkOut);
  return { checkInDate: n.startDate, checkOutDate: n.endDate };
}

function buildLegalAcceptance() {
  return {
    acceptedTermsAndCancellation: true,
    acceptedActivityRisk: true,
    termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
    activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
    checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
    checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
  };
}

function buildGuestInfo(overrides = {}) {
  return {
    firstName: 'Legacy',
    lastName: 'Guest',
    email: 'legacy-i6@example.com',
    phone: '+359811111111',
    ...overrides
  };
}

async function createCabinType(overrides = {}) {
  const suffix = crypto.randomBytes(4).toString('hex');
  return CabinType.create({
    name: `Legacy A-Frame ${suffix}`,
    slug: overrides.slug || 'a-frame',
    description: 'legacy i6 test',
    capacity: 4,
    minGuests: 1,
    minNights: 1,
    pricePerNight: 120,
    imageUrl: 'https://example.com/aframe.jpg',
    location: 'Bulgaria',
    isActive: true,
    ...overrides
  });
}

async function createUnit(cabinTypeId, overrides = {}) {
  return Unit.create({
    cabinTypeId,
    unitNumber: overrides.unitNumber || `U-${crypto.randomBytes(2).toString('hex')}`,
    displayName: overrides.displayName || 'Unit',
    isActive: true,
    ...overrides
  });
}

async function createCabin(overrides = {}) {
  const suffix = crypto.randomBytes(4).toString('hex');
  return Cabin.create({
    name: `Legacy Cabin ${suffix}`,
    slug: `legacy-cabin-${suffix}`,
    description: 'single inventory',
    capacity: 2,
    minGuests: 1,
    minNights: 1,
    pricePerNight: 100,
    imageUrl: 'https://example.com/cabin.jpg',
    location: 'Bulgaria',
    propertyKind: 'valley',
    isActive: true,
    ...overrides
  });
}

function buildCabinTypeBody({ cabinType, checkInDate, checkOutDate, overrides = {} }) {
  return {
    cabinTypeId: String(cabinType._id),
    checkIn: checkInDate.toISOString(),
    checkOut: checkOutDate.toISOString(),
    adults: 2,
    children: 0,
    guestInfo: buildGuestInfo(),
    legalAcceptance: buildLegalAcceptance(),
    ...overrides
  };
}

function buildCabinBody({ cabin, checkInDate, checkOutDate, overrides = {} }) {
  return {
    cabinId: String(cabin._id),
    checkIn: checkInDate.toISOString(),
    checkOut: checkOutDate.toISOString(),
    adults: 2,
    children: 0,
    guestInfo: buildGuestInfo({ email: 'legacy-single@example.com' }),
    legalAcceptance: buildLegalAcceptance(),
    ...overrides
  };
}

function postBooking(body, ipSuffix = 1) {
  return request(app)
    .post('/api/bookings')
    .set('X-Forwarded-For', `10.91.1.${ipSuffix}`)
    .send(body);
}

test.before(async () => {
  savedEnv = {
    NODE_ENV: process.env.NODE_ENV,
    CHECKOUT_SESSION_V2: process.env.CHECKOUT_SESSION_V2,
    MULTI_UNIT_ENABLED: process.env.MULTI_UNIT_ENABLED,
    MULTI_UNIT_TYPES: process.env.MULTI_UNIT_TYPES,
    BOOKING_CONFIRM_WITHOUT_STRIPE: process.env.BOOKING_CONFIRM_WITHOUT_STRIPE
  };
  process.env.NODE_ENV = 'test';
  process.env.CHECKOUT_SESSION_V2 = '0';
  process.env.MULTI_UNIT_ENABLED = '1';
  process.env.MULTI_UNIT_TYPES = 'a-frame';
  process.env.BOOKING_CONFIRM_WITHOUT_STRIPE = '1';

  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await ensureAuthoritativeUniqueIndexForTests();
  await Promise.all([
    Cabin.syncIndexes(),
    CabinType.syncIndexes(),
    Unit.syncIndexes(),
    Booking.syncIndexes(),
    ManualReviewItem.syncIndexes(),
    PaymentResolutionIssue.syncIndexes()
  ]);
  app = buildApp();
});

test.beforeEach(async () => {
  process.env.CHECKOUT_SESSION_V2 = '0';
  process.env.MULTI_UNIT_ENABLED = '1';
  process.env.MULTI_UNIT_TYPES = 'a-frame';
  process.env.BOOKING_CONFIRM_WITHOUT_STRIPE = '1';
  await Promise.all([
    Booking.deleteMany({}),
    UnitNightClaim.deleteMany({}),
    CabinType.deleteMany({}),
    Unit.deleteMany({}),
    Cabin.deleteMany({}),
    ManualReviewItem.deleteMany({}),
    PaymentResolutionIssue.deleteMany({})
  ]);
});

test.after(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test('I6 legacy A: allocated multi-unit create claims before save and succeeds', async () => {
  const cabinType = await createCabinType();
  const unit = await createUnit(cabinType._id, { unitNumber: 'AF-01', displayName: 'A-Frame 1' });
  const { checkInDate, checkOutDate } = normalizeStayDates(nextDate(20), nextDate(22));

  const res = await postBooking(
    buildCabinTypeBody({ cabinType, checkInDate, checkOutDate }),
    11
  );
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const bookingId = res.body.data?.booking?._id;
  assert.ok(bookingId);
  const unitId = res.body.data?.booking?.unitId?._id || res.body.data?.booking?.unitId;
  assert.equal(String(unitId), String(unit._id));

  const claims = await UnitNightClaim.find({ bookingId }).lean();
  assert.equal(claims.length, 2);
  assert.ok(claims.every((c) => String(c.unitId) === String(unit._id)));
  assert.ok(claims.every((c) => c.source === 'legacy_create'));
});

test('I6 legacy B: claim conflict leaves no allocated Booking', async () => {
  const cabinType = await createCabinType();
  const unit = await createUnit(cabinType._id, { unitNumber: 'AF-01', displayName: 'A-Frame 1' });
  const { checkInDate, checkOutDate } = normalizeStayDates(nextDate(30), nextDate(32));

  const foreignBookingId = new mongoose.Types.ObjectId();
  await claimUnitNights({
    bookingId: foreignBookingId,
    unitId: unit._id,
    checkIn: checkInDate,
    checkOut: checkOutDate,
    source: 'finalize'
  });

  const res = await postBooking(
    buildCabinTypeBody({
      cabinType,
      checkInDate,
      checkOutDate,
      overrides: { unitId: String(unit._id) }
    }),
    12
  );
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.error?.code, 'NOT_AVAILABLE');
  assert.doesNotMatch(JSON.stringify(res.body), /E11000/);
  assert.equal(await Booking.countDocuments({ cabinTypeId: cabinType._id }), 0);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: { $ne: foreignBookingId } }), 0);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: foreignBookingId }), 2);
});

test('I6 legacy C: Booking save failure compensates attempt claims', async () => {
  const cabinType = await createCabinType();
  await createUnit(cabinType._id, { unitNumber: 'AF-01', displayName: 'A-Frame 1' });
  const { checkInDate, checkOutDate } = normalizeStayDates(nextDate(40), nextDate(42));

  const originalSave = Booking.prototype.save;
  Booking.prototype.save = async function saveFail() {
    throw new Error('forced legacy booking save failure');
  };
  try {
    const res = await postBooking(
      buildCabinTypeBody({ cabinType, checkInDate, checkOutDate }),
      13
    );
    assert.ok(res.status >= 500 || res.status === 409, JSON.stringify(res.body));
    assert.equal(await Booking.countDocuments({ cabinTypeId: cabinType._id }), 0);
    assert.equal(await UnitNightClaim.countDocuments({}), 0);
  } finally {
    Booking.prototype.save = originalSave;
  }
});

test('I6 legacy D: compensation preserves pre-existing same-booking claims', async () => {
  const cabinType = await createCabinType();
  const unit = await createUnit(cabinType._id, { unitNumber: 'AF-01', displayName: 'A-Frame 1' });
  const { checkInDate, checkOutDate } = normalizeStayDates(nextDate(50), nextDate(53));

  const svc = require('../services/inventory/unitNightClaimService');
  const originalClaim = svc.claimUnitNights;
  const originalSave = Booking.prototype.save;
  let capturedBookingId = null;

  svc.claimUnitNights = async (opts) => {
    capturedBookingId = opts.bookingId;
    if ((await UnitNightClaim.countDocuments({ bookingId: opts.bookingId })) === 0) {
      await originalClaim({
        bookingId: opts.bookingId,
        unitId: unit._id,
        checkIn: checkInDate,
        checkOut: new Date(checkInDate.getTime() + 24 * 60 * 60 * 1000),
        source: 'legacy_create'
      });
      assert.equal(await UnitNightClaim.countDocuments({ bookingId: opts.bookingId }), 1);
    }
    return originalClaim(opts);
  };
  Booking.prototype.save = async function saveFail() {
    throw new Error('forced save after partial pre-owned claims');
  };

  try {
    const res = await postBooking(
      buildCabinTypeBody({
        cabinType,
        checkInDate,
        checkOutDate,
        overrides: { unitId: String(unit._id) }
      }),
      14
    );
    assert.ok(res.status >= 500 || res.status === 409, JSON.stringify(res.body));
    assert.equal(await Booking.countDocuments({}), 0);
    assert.ok(capturedBookingId);
    const remaining = await UnitNightClaim.find({ bookingId: capturedBookingId }).lean();
    assert.equal(remaining.length, 1);
    assert.equal(String(remaining[0].unitId), String(unit._id));
  } finally {
    svc.claimUnitNights = originalClaim;
    Booking.prototype.save = originalSave;
  }
});

test('I6 legacy E: E11000 is normalized on legacy claim conflict', async () => {
  const src = fs.readFileSync(ROUTES_PATH, 'utf8');
  assert.match(src, /CLAIM_ERR\.FOREIGN_OWNER/);
  assert.match(src, /NOT_AVAILABLE/);
  assert.doesNotMatch(src, /res\.status\(409\).*E11000/);

  const cabinType = await createCabinType();
  const unit = await createUnit(cabinType._id, { unitNumber: 'AF-01', displayName: 'A-Frame 1' });
  const { checkInDate, checkOutDate } = normalizeStayDates(nextDate(60), nextDate(62));
  const foreignBookingId = new mongoose.Types.ObjectId();
  await claimUnitNights({
    bookingId: foreignBookingId,
    unitId: unit._id,
    checkIn: checkInDate,
    checkOut: checkOutDate,
    source: 'finalize'
  });

  const res = await postBooking(
    buildCabinTypeBody({
      cabinType,
      checkInDate,
      checkOutDate,
      overrides: { unitId: String(unit._id) }
    }),
    15
  );
  assert.equal(res.body.error?.code, 'NOT_AVAILABLE');
  assert.equal(res.body.error?.code === ERR.FOREIGN_OWNER, false);
  assert.doesNotMatch(JSON.stringify(res.body), /E11000|duplicate key/i);
});

test('I6 legacy F: retry converges (idempotent claim ownership)', async () => {
  const cabinType = await createCabinType();
  const unit = await createUnit(cabinType._id, { unitNumber: 'AF-01', displayName: 'A-Frame 1' });
  const { checkInDate, checkOutDate } = normalizeStayDates(nextDate(70), nextDate(72));

  const first = await postBooking(
    buildCabinTypeBody({
      cabinType,
      checkInDate,
      checkOutDate,
      overrides: { unitId: String(unit._id) }
    }),
    16
  );
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const bookingId = first.body.data?.booking?._id;
  assert.ok(bookingId);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId }), 2);

  // Same-booking claim retry is idempotent (no extra rows, no conflict).
  const replay = await claimUnitNights({
    bookingId,
    unitId: unit._id,
    checkIn: checkInDate,
    checkOut: checkOutDate,
    source: 'legacy_create'
  });
  assert.equal(replay.alreadyOwnedCount, 2);
  assert.equal(replay.insertedCount, 0);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId }), 2);

  // A distinct create attempt against the same allocated nights is rejected with no second Booking.
  // Pre-claim availability may 409 before claimUnitNights; claim-owned nights also yield NOT_AVAILABLE.
  const second = await postBooking(
    buildCabinTypeBody({
      cabinType,
      checkInDate,
      checkOutDate,
      overrides: {
        unitId: String(unit._id),
        guestInfo: buildGuestInfo({ email: 'legacy-i6-other@example.com' })
      }
    }),
    17
  );
  assert.equal(second.status, 409, JSON.stringify(second.body));
  assert.equal(await Booking.countDocuments({ cabinTypeId: cabinType._id }), 1);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId }), 2);
  if (second.body.error?.code) {
    assert.equal(second.body.error.code, 'NOT_AVAILABLE');
  }
});

test('I6 legacy G: single-inventory cabinId create unchanged (no claims)', async () => {
  const cabin = await createCabin();
  const { checkInDate, checkOutDate } = normalizeStayDates(nextDate(80), nextDate(82));

  const res = await postBooking(buildCabinBody({ cabin, checkInDate, checkOutDate }), 18);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const bookingId = res.body.data?.booking?._id;
  assert.ok(bookingId);
  assert.equal(String(res.body.data?.booking?.cabinId?._id || res.body.data?.booking?.cabinId), String(cabin._id));
  assert.equal(await UnitNightClaim.countDocuments({}), 0);
});

test('I6 legacy H: paid claim conflict preserves payment evidence path (no allocated Booking)', async () => {
  const cabinType = await createCabinType();
  const unit = await createUnit(cabinType._id, { unitNumber: 'AF-01', displayName: 'A-Frame 1' });
  const { checkInDate, checkOutDate } = normalizeStayDates(nextDate(90), nextDate(92));
  const foreignBookingId = new mongoose.Types.ObjectId();
  await claimUnitNights({
    bookingId: foreignBookingId,
    unitId: unit._id,
    checkIn: checkInDate,
    checkOut: checkOutDate,
    source: 'finalize'
  });

  const paymentIntentId = `pi_legacy_conflict_${Date.now()}`;
  const checkoutId = `chk_legacy_conflict_${Date.now()}`;

  bookingRoutes.__setStripeClientForTesting({
    paymentIntents: {
      retrieve: async () => ({
        id: paymentIntentId,
        status: 'succeeded',
        amount: 24000,
        currency: 'eur',
        metadata: {
          entityType: 'cabinType',
          cabinTypeId: String(cabinType._id),
          checkIn: checkInDate.toISOString(),
          checkOut: checkOutDate.toISOString(),
          amountCents: '24000',
          subtotalCents: '24000',
          discountAmountCents: '0',
          finalTotalCents: '24000',
          voucherAppliedCents: '0',
          checkoutId,
          experienceKeys: '[]'
        }
      })
    }
  });

  try {
    const res = await postBooking(
      buildCabinTypeBody({
        cabinType,
        checkInDate,
        checkOutDate,
        overrides: {
          unitId: String(unit._id),
          checkoutId,
          paymentIntentId
        }
      }),
      19
    );
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(await Booking.countDocuments({ stripePaymentIntentId: paymentIntentId }), 0);
    assert.equal(await UnitNightClaim.countDocuments({ bookingId: { $ne: foreignBookingId } }), 0);
    // Guest needs-review OR structured NOT_AVAILABLE — never invent refund/delete of PI evidence.
    assert.ok(
      res.body.code === 'PAYMENT_RECEIVED_BOOKING_NEEDS_REVIEW' ||
        res.body.error?.code === 'NOT_AVAILABLE',
      JSON.stringify(res.body)
    );
  } finally {
    bookingRoutes.__resetStripeClientForTesting();
  }
});

test('I6 legacy I: no raw post-save authoritative gap remains in bookingRoutes', () => {
  const src = fs.readFileSync(ROUTES_PATH, 'utf8');
  assert.match(src, /unitNightClaimService\.claimUnitNights\(/);
  assert.match(src, /unitNightClaimService\.compensateClaimAttempt\(/);
  assert.match(src, /insertedNightsThisAttempt/);
  assert.match(src, /source: 'legacy_create'/);
  assert.match(src, /needsPreClaim/);
  assert.match(src, /mint Booking _id and acquire ALL UnitNightClaims before allocated Booking persistence/);

  const claimIdx = src.indexOf('unitNightClaimService.claimUnitNights(');
  const saveIdx = src.indexOf('await booking.save()');
  assert.ok(claimIdx > 0 && saveIdx > claimIdx, 'claimUnitNights must precede booking.save');

  assert.doesNotMatch(
    src,
    /Legacy POST \/api\/bookings shadow dual-write \(I2\)\. Never throws into the route/
  );
  assert.match(src, /throwOnFailure:\s*true/);
});
