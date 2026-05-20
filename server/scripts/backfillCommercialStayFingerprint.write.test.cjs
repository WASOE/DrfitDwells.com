/**
 * C3 commercialStayFingerprint write backfill script.
 *
 * Run: node --test server/scripts/backfillCommercialStayFingerprint.write.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Booking = require('../models/Booking');
const { buildCommercialStayFingerprintFromBooking } = require('../services/checkout/bookingCommercialStayFingerprint');
const {
  isWriteEnabled,
  buildRefusalPayload,
  buildMissingFingerprintFilter,
  runWrite
} = require('./backfillCommercialStayFingerprint.write.cjs');

let mongoServer;
let savedWriteEnv;

function futureStayDates() {
  const checkIn = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const checkOut = new Date(Date.now() + 34 * 24 * 60 * 60 * 1000);
  return { checkIn, checkOut };
}

function buildLegalAcceptance() {
  return {
    termsVersion: '2026-04-19-v2',
    activityRiskVersion: '2026-04-19-v2',
    acceptedAt: new Date(),
    firstName: 'Backfill',
    lastName: 'Guest',
    checkbox1TextSnapshot: 'terms',
    checkbox2TextSnapshot: 'risk'
  };
}

async function createBooking(overrides = {}) {
  const { checkIn, checkOut } = futureStayDates();
  const doc = {
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    totalPrice: 360,
    subtotalPrice: 360,
    status: 'confirmed',
    guestInfo: {
      firstName: 'Backfill',
      lastName: 'Guest',
      email: 'backfill-guest@example.com',
      phone: '+359800000099'
    },
    legalAcceptance: buildLegalAcceptance(),
    ...overrides
  };
  if (!doc.cabinId && !doc.cabinTypeId) {
    doc.cabinId = new mongoose.Types.ObjectId();
  }
  return Booking.create(doc);
}

test.before(async () => {
  savedWriteEnv = process.env.BACKFILL_COMMERCIAL_STAY_FINGERPRINT_WRITE;
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await Booking.syncIndexes();
});

test.beforeEach(async () => {
  await Booking.deleteMany({});
  process.env.BACKFILL_COMMERCIAL_STAY_FINGERPRINT_WRITE = '1';
});

test.afterEach(() => {
  if (savedWriteEnv === undefined) {
    delete process.env.BACKFILL_COMMERCIAL_STAY_FINGERPRINT_WRITE;
  } else {
    process.env.BACKFILL_COMMERCIAL_STAY_FINGERPRINT_WRITE = savedWriteEnv;
  }
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test('refuses without env', () => {
  delete process.env.BACKFILL_COMMERCIAL_STAY_FINGERPRINT_WRITE;
  assert.equal(isWriteEnabled(), false);
  const payload = buildRefusalPayload();
  assert.equal(payload.refused, true);
  assert.match(payload.message, /BACKFILL_COMMERCIAL_STAY_FINGERPRINT_WRITE=1/);
});

test('updates missing fingerprint', async () => {
  const booking = await createBooking({ commercialStayFingerprint: null });
  const summary = await runWrite();

  assert.equal(summary.scanned, 1);
  assert.equal(summary.updated, 1);
  assert.equal(summary.alreadyHasFingerprint, 0);

  const reloaded = await Booking.findById(booking._id).lean();
  const expected = buildCommercialStayFingerprintFromBooking(reloaded);
  assert.ok(expected);
  assert.equal(reloaded.commercialStayFingerprint, expected);
});

test('does not overwrite existing fingerprint', async () => {
  const existing = 'fp_existing_must_stay';
  const booking = await createBooking({ commercialStayFingerprint: existing });
  const summary = await runWrite();

  assert.equal(summary.updated, 0);
  assert.equal(summary.alreadyHasFingerprint, 1);

  const reloaded = await Booking.findById(booking._id).lean();
  assert.equal(reloaded.commercialStayFingerprint, existing);
});

test('skips cancelled status', async () => {
  await createBooking({ status: 'cancelled', commercialStayFingerprint: null });
  const summary = await runWrite();

  assert.equal(summary.updated, 0);
  assert.equal(summary.skippedStatus, 1);
  assert.equal(summary.eligible, 0);
});

test('skips archived bookings', async () => {
  await createBooking({
    archivedAt: new Date(),
    commercialStayFingerprint: null
  });
  const summary = await runWrite();

  assert.equal(summary.updated, 0);
  assert.equal(summary.skippedArchived, 1);
});

test('cabinType uses cabinTypeId not unitId', async () => {
  const cabinTypeId = new mongoose.Types.ObjectId();
  const unitA = new mongoose.Types.ObjectId();
  const unitB = new mongoose.Types.ObjectId();
  const { checkIn, checkOut } = futureStayDates();
  const guestInfo = {
    firstName: 'Unit',
    lastName: 'Guest',
    email: 'unitcheck@example.com',
    phone: '+359800000088'
  };

  const bookingA = await createBooking({
    cabinId: null,
    cabinTypeId,
    unitId: unitA,
    checkIn,
    checkOut,
    guestInfo,
    commercialStayFingerprint: null
  });
  const bookingB = await createBooking({
    cabinId: null,
    cabinTypeId,
    unitId: unitB,
    checkIn,
    checkOut,
    guestInfo,
    commercialStayFingerprint: null
  });

  const summary = await runWrite();
  assert.equal(summary.updated, 2);

  const fpA = (await Booking.findById(bookingA._id).lean()).commercialStayFingerprint;
  const fpB = (await Booking.findById(bookingB._id).lean()).commercialStayFingerprint;
  assert.equal(fpA, fpB);
  assert.ok(fpA);

  const fromCabinOnly = buildCommercialStayFingerprintFromBooking({
    cabinTypeId,
    unitId: unitA,
    checkIn,
    checkOut,
    guestInfo
  });
  assert.equal(fpA, fromCabinOnly);
});

test('update filter only matches missing fingerprint', async () => {
  const bookingId = new mongoose.Types.ObjectId();
  const filter = buildMissingFingerprintFilter(bookingId);
  assert.ok(filter.$or);
});
