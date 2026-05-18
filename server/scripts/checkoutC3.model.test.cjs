/**
 * C3-B model + commercial-stay fingerprint helper declarations.
 *
 * Run: cd server && node --test scripts/checkoutC3.model.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Booking = require('../models/Booking');
const CheckoutSession = require('../models/CheckoutSession');
const {
  normalizeGuestEmail,
  toCheckInOutDateOnly,
  buildCommercialStayFingerprintFromBooking
} = require('../services/checkout/bookingCommercialStayFingerprint');

function findIndex(schema, keyShape) {
  const keyJson = JSON.stringify(keyShape);
  return schema.indexes().find(([keys]) => JSON.stringify(keys) === keyJson);
}

function indexOptions(schema, keyShape) {
  const entry = findIndex(schema, keyShape);
  return entry ? entry[1] : null;
}

function pathExists(schema, pathName) {
  return Boolean(schema.path(pathName));
}

test('Booking has commercialStayFingerprint field', () => {
  assert.ok(pathExists(Booking.schema, 'commercialStayFingerprint'));
  const path = Booking.schema.path('commercialStayFingerprint');
  assert.equal(path.instance, 'String');
  assert.equal(path.defaultValue, null);
});

test('Booking has checkoutSessionId field', () => {
  assert.ok(pathExists(Booking.schema, 'checkoutSessionId'));
  const path = Booking.schema.path('checkoutSessionId');
  assert.equal(path.instance, 'ObjectId');
});

test('Booking has confirmationEmailSentAt field', () => {
  assert.ok(pathExists(Booking.schema, 'confirmationEmailSentAt'));
  const path = Booking.schema.path('confirmationEmailSentAt');
  assert.equal(path.instance, 'Date');
});

test('Booking commercialStayFingerprint/status index is declared and not unique', () => {
  const opts = indexOptions(Booking.schema, { commercialStayFingerprint: 1, status: 1 });
  assert.ok(opts);
  assert.notEqual(opts.unique, true);
  assert.deepEqual(opts.partialFilterExpression, {
    commercialStayFingerprint: { $exists: true, $type: 'string', $gt: '' }
  });
});

test('Booking checkoutSessionId partial index is declared', () => {
  const opts = indexOptions(Booking.schema, { checkoutSessionId: 1 });
  assert.ok(opts);
  assert.notEqual(opts.unique, true);
  assert.deepEqual(opts.partialFilterExpression, {
    checkoutSessionId: { $exists: true, $type: 'objectId' }
  });
});

test('CheckoutSession has finalizeStartedAt and finalizedAt', () => {
  assert.ok(pathExists(CheckoutSession.schema, 'finalizeStartedAt'));
  assert.ok(pathExists(CheckoutSession.schema, 'finalizedAt'));
});

test('CheckoutSession has stayFingerprint and finalizeStatus index', () => {
  assert.ok(findIndex(CheckoutSession.schema, { stayFingerprint: 1, finalizeStatus: 1 }));
});

test('CheckoutSession bookingId partial index is declared', () => {
  const opts = indexOptions(CheckoutSession.schema, { bookingId: 1 });
  assert.ok(opts);
  assert.deepEqual(opts.partialFilterExpression, {
    bookingId: { $exists: true, $type: 'objectId' }
  });
});

test('normalizeGuestEmail lowercases and trims', () => {
  assert.equal(normalizeGuestEmail('  Guest@Example.COM  '), 'guest@example.com');
  assert.equal(normalizeGuestEmail(''), '');
});

test('toCheckInOutDateOnly uses Sofia date-only format', () => {
  const iso = '2026-06-10T22:30:00.000Z';
  const dateOnly = toCheckInOutDateOnly(iso);
  assert.match(dateOnly, /^\d{4}-\d{2}-\d{2}$/);
});

test('cabinType fingerprint uses cabinTypeId not unitId', () => {
  const cabinTypeId = new mongoose.Types.ObjectId();
  const unitId = new mongoose.Types.ObjectId();
  const cabinId = new mongoose.Types.ObjectId();

  const typeFingerprint = buildCommercialStayFingerprintFromBooking({
    guestInfo: { email: 'stay@example.com' },
    cabinTypeId,
    unitId,
    checkIn: new Date('2026-06-10T12:00:00.000Z'),
    checkOut: new Date('2026-06-12T12:00:00.000Z'),
    status: 'confirmed'
  });

  const cabinFingerprint = buildCommercialStayFingerprintFromBooking({
    guestInfo: { email: 'stay@example.com' },
    cabinId,
    checkIn: new Date('2026-06-10T12:00:00.000Z'),
    checkOut: new Date('2026-06-12T12:00:00.000Z'),
    status: 'confirmed'
  });

  const wrongUnitAsCabin = buildCommercialStayFingerprintFromBooking({
    guestInfo: { email: 'stay@example.com' },
    cabinId: unitId,
    checkIn: new Date('2026-06-10T12:00:00.000Z'),
    checkOut: new Date('2026-06-12T12:00:00.000Z'),
    status: 'confirmed'
  });

  assert.ok(typeFingerprint);
  assert.ok(cabinFingerprint);
  assert.notEqual(typeFingerprint, cabinFingerprint);
  assert.notEqual(typeFingerprint, wrongUnitAsCabin);
});

test('same commercial stay produces stable fingerprint', () => {
  const cabinId = new mongoose.Types.ObjectId();
  const base = {
    guestInfo: { email: 'Ada@Example.com' },
    cabinId,
    checkIn: new Date('2026-06-10T12:00:00.000Z'),
    checkOut: new Date('2026-06-12T12:00:00.000Z'),
    status: 'pending'
  };
  const a = buildCommercialStayFingerprintFromBooking(base);
  const b = buildCommercialStayFingerprintFromBooking({
    ...base,
    checkoutId: 'chk_other',
    unitId: new mongoose.Types.ObjectId()
  });
  assert.equal(a, b);
});
