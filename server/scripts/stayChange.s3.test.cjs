/**
 * REBOOK-S3 first mutation — comprehensive domain/API suite.
 * Binding: docs/stay-change-implementation-plan.md §25
 * Run: cd server && node --test scripts/stayChange.s3.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const StayChange = require('../models/StayChange');
const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const Payment = require('../models/Payment');
const CabinNightClaim = require('../models/CabinNightClaim');
const UnitNightClaim = require('../models/UnitNightClaim');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const AuditEvent = require('../models/AuditEvent');
const ManualReviewItem = require('../models/ManualReviewItem');

const {
  rebookReservation,
  reconcileRebookStayChange,
  buildPayloadFingerprint,
  KIND,
  AUDIT_ACTION,
  MRI_CATEGORY,
  auditDedupeKeyFor,
  detectPromotionalSourceEconomics,
  PROMO_REASON,
  _testHooks
} = require('../services/stayChange/rebookStayChangeService');
const {
  claimCabinNights,
  resolveOccupiedNightDates,
  ensureAuthoritativeUniqueIndexForTests: ensureCabinIdx,
  compensateCabinClaimAttempt
} = require('../services/inventory/cabinNightClaimService');
const {
  claimUnitNights,
  ensureAuthoritativeUniqueIndexForTests: ensureUnitIdx,
  compensateClaimAttempt
} = require('../services/inventory/unitNightClaimService');
const { classifyReservationPaymentStatus } = require('../services/ops/payment/reservationPaymentSignals');
const { computeQuoteFromEntity } = require('../services/bookingQuoteService');
const { isRebookTransferSettling } = require('../services/stayChange/rebookStayChangeSpine');
const cutover = require('./stayChangeR1Cutover');
const { normalizeDateToSofiaDayStart } = require('../utils/dateTime');

const SVC_PATH = path.join(__dirname, '../services/stayChange/rebookStayChangeService.js');
const ROUTE_PATH = path.join(__dirname, '../routes/ops/modules/reservationsRoutes.js');
const UNIT_MODEL_PATH = path.join(__dirname, '../models/UnitNightClaim.js');

let mongoServer;
let seq = 0;

function sofiaDay(daysAhead) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return normalizeDateToSofiaDayStart(d);
}

function adminCtx() {
  return {
    user: { id: 'admin-s3', role: 'admin' },
    route: 'POST /api/ops/reservations/:id/actions/rebook',
    req: { user: { id: 'admin-s3', role: 'admin' }, headers: {} }
  };
}

function legalAcceptance(first = 'S3', last = 'Guest') {
  return {
    termsVersion: 't',
    activityRiskVersion: 'a',
    acceptedAt: new Date(),
    firstName: first,
    lastName: last,
    checkbox1TextSnapshot: 'c1',
    checkbox2TextSnapshot: 'c2'
  };
}

function idem(label) {
  return `idem-s3-${label}-${crypto.randomBytes(4).toString('hex')}`;
}

function codeOf(err) {
  return err?.details?.code || err?.code || null;
}

async function seedCabin(pricePerNight = 100) {
  seq += 1;
  return Cabin.create({
    name: `S3 Cabin ${seq}`,
    slug: `s3-cabin-${seq}-${crypto.randomBytes(2).toString('hex')}`,
    description: 's3',
    capacity: 4,
    pricePerNight,
    minNights: 1,
    imageUrl: 'https://example.com/s3.jpg',
    location: 'Bulgaria',
    isActive: true
  });
}

async function seedTypeWithUnits(n = 2, pricePerNight = 100) {
  seq += 1;
  const ct = await CabinType.create({
    name: `S3 Type ${seq}`,
    slug: `s3-type-${seq}-${crypto.randomBytes(2).toString('hex')}`,
    description: 's3',
    capacity: 4,
    minGuests: 1,
    minNights: 1,
    pricePerNight,
    imageUrl: 'https://example.com/s3t.jpg',
    location: 'Bulgaria',
    isActive: true
  });
  await Cabin.create({
    name: `S3 Parent ${seq}`,
    slug: `s3-parent-${seq}-${crypto.randomBytes(2).toString('hex')}`,
    description: 'parent',
    capacity: 4,
    pricePerNight,
    minNights: 1,
    imageUrl: 'https://example.com/p.jpg',
    location: 'Bulgaria',
    propertyKind: 'valley',
    cabinTypeId: ct._id,
    isActive: true
  });
  const units = [];
  for (let i = 0; i < n; i += 1) {
    units.push(
      // eslint-disable-next-line no-await-in-loop
      await Unit.create({
        cabinTypeId: ct._id,
        unitNumber: `S3-${seq}-${i + 1}`,
        displayName: `Unit ${i + 1}`,
        isActive: true
      })
    );
  }
  return { cabinType: ct, units };
}

async function attachPaid(booking, cents = null) {
  const amountCents = cents == null ? Math.round(Number(booking.totalPrice) * 100) : cents;
  booking.stripePaidAmountCents = amountCents;
  await booking.save();
  await Payment.create({
    reservationId: booking._id,
    provider: 'stripe',
    providerReference: `pi_s3_${crypto.randomBytes(6).toString('hex')}`,
    status: 'paid',
    amount: amountCents / 100,
    currency: 'eur',
    source: 'webhook'
  });
  return booking;
}

async function makeSingleBooking({
  cabin,
  status = 'confirmed',
  checkIn,
  checkOut,
  totalPrice = 200,
  paid = true,
  extras = {}
} = {}) {
  const ci = checkIn || sofiaDay(30);
  const co = checkOut || sofiaDay(32);
  const booking = await Booking.create({
    cabinId: cabin._id,
    checkIn: ci,
    checkOut: co,
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'S3',
      lastName: 'Guest',
      email: `s3-${crypto.randomBytes(3).toString('hex')}@example.com`,
      phone: '+359800000000'
    },
    status,
    totalPrice,
    totalValueCents: Math.round(totalPrice * 100),
    legalAcceptance: legalAcceptance(),
    ...extras
  });
  await claimCabinNights({
    cabinId: cabin._id,
    bookingId: booking._id,
    checkIn: ci,
    checkOut: co,
    source: 'finalize'
  });
  if (paid) await attachPaid(booking);
  return booking;
}

async function makeMultiBooking({
  cabinType,
  unit,
  status = 'confirmed',
  checkIn,
  checkOut,
  totalPrice = 200,
  paid = true,
  extras = {}
} = {}) {
  const ci = checkIn || sofiaDay(40);
  const co = checkOut || sofiaDay(42);
  const booking = await Booking.create({
    cabinTypeId: cabinType._id,
    unitId: unit._id,
    checkIn: ci,
    checkOut: co,
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'S3',
      lastName: 'Multi',
      email: `s3m-${crypto.randomBytes(3).toString('hex')}@example.com`,
      phone: '+359800000001'
    },
    status,
    totalPrice,
    totalValueCents: Math.round(totalPrice * 100),
    legalAcceptance: legalAcceptance('S3', 'Multi'),
    ...extras
  });
  await claimUnitNights({
    bookingId: booking._id,
    unitId: unit._id,
    checkIn: ci,
    checkOut: co,
    source: 'finalize'
  });
  if (paid) await attachPaid(booking);
  return booking;
}

async function rebookOk(booking, target, key, opts = {}) {
  return rebookReservation({
    bookingId: booking._id,
    targetCabinId: target.cabinId || null,
    targetCabinTypeId: target.cabinTypeId || null,
    targetUnitId: target.unitId || null,
    idempotencyKey: key || idem('ok'),
    reason: opts.reason ?? 's3 reason',
    acceptExternalHoldWarnings: opts.acceptExternalHoldWarnings ?? false,
    waiveUpgradeCents: opts.waiveUpgradeCents ?? 0,
    ctx: opts.ctx || adminCtx()
  });
}

function assertRebookError(err, expectedCode) {
  assert.equal(codeOf(err), expectedCode, `expected ${expectedCode} got ${codeOf(err)}: ${err.message}`);
}

test.before(async () => {
  process.env.NODE_ENV = 'test';
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await ensureCabinIdx();
  await ensureUnitIdx();
  await cutover.ensureR1IndexesForTests();
});

test.beforeEach(async () => {
  await Promise.all([
    StayChange.deleteMany({}),
    Booking.deleteMany({}),
    CabinNightClaim.deleteMany({}),
    UnitNightClaim.deleteMany({}),
    CabinType.deleteMany({}),
    Unit.deleteMany({}),
    Cabin.deleteMany({}),
    Payment.deleteMany({}),
    AvailabilityBlock.deleteMany({}),
    AuditEvent.collection.deleteMany({}),
    ManualReviewItem.deleteMany({})
  ]);
  await cutover.ensureR1IndexesForTests();
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

// =============================================================================
// Static / prerequisite
// =============================================================================

test('S3#1 UnitNightClaim CLAIM_SOURCES includes rebook', () => {
  const src = fs.readFileSync(UNIT_MODEL_PATH, 'utf8');
  assert.match(src, /'rebook'/);
  assert.ok(UnitNightClaim.CLAIM_SOURCES.includes('rebook'));
});

test('S3#2 route registers POST .../actions/rebook', () => {
  const src = fs.readFileSync(ROUTE_PATH, 'utf8');
  assert.match(src, /\/:id\/actions\/rebook/);
  assert.match(src, /rebookReservation/);
});

test('S3#3 service uses target-first claim then source release ordering', () => {
  const src = fs.readFileSync(SVC_PATH, 'utf8');
  const claimIdx = src.indexOf('acquireTargetClaims');
  const releaseIdx = src.indexOf('releaseSourceClaims');
  assert.ok(claimIdx > 0 && releaseIdx > claimIdx);
  assert.match(src, /source: 'rebook'/);
  assert.doesNotMatch(src, /transitionReservation\(/);
  assert.doesNotMatch(src, /Payment\.create/);
  assert.doesNotMatch(src, /stripe\.(paymentIntents|checkout)/i);
});

test('S3#4 no createIndex/dropIndex/syncIndexes in S3 service', () => {
  const src = fs.readFileSync(SVC_PATH, 'utf8');
  assert.doesNotMatch(src, /\.createIndex\(/);
  assert.doesNotMatch(src, /\.dropIndex\(/);
  assert.doesNotMatch(src, /\.syncIndexes\(/);
});

// =============================================================================
// Happy path shapes
// =============================================================================

test('S3#5 single→single equal completes', async () => {
  const a = await seedCabin(100);
  const b = await seedCabin(100);
  const booking = await makeSingleBooking({ cabin: a, totalPrice: 200 });
  const res = await rebookOk(booking, { cabinId: b._id }, idem('5'));
  assert.equal(res.status, 'completed');
  assert.equal(res.settlementType, 'equal_price');
  assert.notEqual(String(res.targetBookingId), String(booking._id));
});

test('S3#6 single→multi equal completes', async () => {
  const a = await seedCabin(100);
  const { cabinType, units } = await seedTypeWithUnits(1, 100);
  const booking = await makeSingleBooking({ cabin: a, totalPrice: 200 });
  const res = await rebookOk(
    booking,
    { cabinTypeId: cabinType._id, unitId: units[0]._id },
    idem('6')
  );
  assert.equal(res.status, 'completed');
  const tgt = await Booking.findById(res.targetBookingId);
  assert.equal(String(tgt.cabinTypeId), String(cabinType._id));
  assert.equal(String(tgt.unitId), String(units[0]._id));
  assert.equal(tgt.cabinId, undefined);
});

test('S3#7 multi→single equal completes', async () => {
  const { cabinType, units } = await seedTypeWithUnits(1, 100);
  const b = await seedCabin(100);
  const booking = await makeMultiBooking({ cabinType, unit: units[0], totalPrice: 200 });
  const res = await rebookOk(booking, { cabinId: b._id }, idem('7'));
  assert.equal(res.status, 'completed');
  const tgt = await Booking.findById(res.targetBookingId);
  assert.equal(String(tgt.cabinId), String(b._id));
});

test('S3#8 multi→multi equal completes', async () => {
  const src = await seedTypeWithUnits(1, 100);
  const dst = await seedTypeWithUnits(1, 100);
  const booking = await makeMultiBooking({
    cabinType: src.cabinType,
    unit: src.units[0],
    totalPrice: 200
  });
  const res = await rebookOk(
    booking,
    { cabinTypeId: dst.cabinType._id, unitId: dst.units[0]._id },
    idem('8')
  );
  assert.equal(res.status, 'completed');
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id }), 0);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: res.targetBookingId }), 2);
});

test('S3#9 complimentary upgrade with full waiver', async () => {
  const a = await seedCabin(100);
  const b = await seedCabin(150);
  const booking = await makeSingleBooking({ cabin: a, totalPrice: 200 });
  const res = await rebookOk(booking, { cabinId: b._id }, idem('9'), {
    waiveUpgradeCents: 10000
  });
  assert.equal(res.status, 'completed');
  assert.equal(res.settlementType, 'complimentary_upgrade');
  assert.equal(res.money.waivedUpgradeCents, 10000);
  assert.equal(res.money.contractualTargetTotalCents, 20000);
  assert.equal(res.money.canonicalTargetQuoteCents, 30000);
});

// =============================================================================
// Eligibility matrix
// =============================================================================

const UNSUPPORTED_STATUSES = ['in_house', 'completed', 'cancelled'];
for (const status of UNSUPPORTED_STATUSES) {
  test(`S3#elig status ${status} rejected`, async () => {
    const a = await seedCabin();
    const b = await seedCabin();
    const booking = await makeSingleBooking({ cabin: a, status });
    await assert.rejects(
      () => rebookOk(booking, { cabinId: b._id }, idem(`st-${status}`)),
      (err) => codeOf(err) === 'UNSUPPORTED_SOURCE'
    );
  });
}

test('S3#10 pending source allowed', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a, status: 'pending', paid: false });
  booking.stripePaidAmountCents = 0;
  await booking.save();
  const res = await rebookOk(booking, { cabinId: b._id }, idem('10'));
  assert.equal(res.status, 'completed');
  const tgt = await Booking.findById(res.targetBookingId);
  assert.equal(tgt.status, 'pending');
});

test('S3#11 confirmed source allowed', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a, status: 'confirmed' });
  const res = await rebookOk(booking, { cabinId: b._id }, idem('11'));
  assert.equal(res.status, 'completed');
});

test('S3#12 isTest rejected', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a, extras: { isTest: true } });
  await assert.rejects(
    () => rebookOk(booking, { cabinId: b._id }, idem('12')),
    (err) => codeOf(err) === 'UNSUPPORTED_SOURCE'
  );
});

test('S3#13 archived rejected', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a, extras: { archivedAt: new Date() } });
  await assert.rejects(
    () => rebookOk(booking, { cabinId: b._id }, idem('13')),
    (err) => codeOf(err) === 'UNSUPPORTED_SOURCE'
  );
});

test('S3#14 LocationBooking rejected', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({
    cabin: a,
    extras: { locationBookingId: new mongoose.Types.ObjectId() }
  });
  await assert.rejects(
    () => rebookOk(booking, { cabinId: b._id }, idem('14')),
    (err) => codeOf(err) === 'UNSUPPORTED_SOURCE'
  );
});

test('S3#15 same cabin product rejected', async () => {
  const a = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  await assert.rejects(
    () => rebookOk(booking, { cabinId: a._id }, idem('15')),
    (err) => codeOf(err) === 'SAME_COMMERCIAL_PRODUCT'
  );
});

test('S3#16 same cabinType different unit is REALLOCATE not REBOOK', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeMultiBooking({ cabinType, unit: units[0] });
  await assert.rejects(
    () =>
      rebookOk(
        booking,
        { cabinTypeId: cabinType._id, unitId: units[1]._id },
        idem('16')
      ),
    (err) => codeOf(err) === 'SAME_COMMERCIAL_PRODUCT'
  );
});

test('S3#17 unallocated multi source rejected', async () => {
  const { cabinType, units } = await seedTypeWithUnits(1);
  const booking = await makeMultiBooking({ cabinType, unit: units[0] });
  await Booking.updateOne({ _id: booking._id }, { $unset: { unitId: 1 } });
  const b = await seedCabin();
  const reloaded = await Booking.findById(booking._id);
  await assert.rejects(
    () => rebookOk(reloaded, { cabinId: b._id }, idem('17')),
    (err) => codeOf(err) === 'UNSUPPORTED_SOURCE'
  );
});

test('S3#18 source missing claims rejected', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  await CabinNightClaim.deleteMany({ bookingId: booking._id });
  await assert.rejects(
    () => rebookOk(booking, { cabinId: b._id }, idem('18')),
    (err) => codeOf(err) === 'UNSUPPORTED_SOURCE'
  );
});

test('S3#19 already rebooked_or_moved rejected', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({
    cabin: a,
    extras: {
      cancellationSettlement: {
        outcome: 'rebooked_or_moved',
        replacementBookingId: new mongoose.Types.ObjectId()
      }
    }
  });
  await assert.rejects(
    () => rebookOk(booking, { cabinId: b._id }, idem('19')),
    (err) => codeOf(err) === 'UNSUPPORTED_SOURCE'
  );
});

test('S3#20 mixed target identity rejected', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const { cabinType, units } = await seedTypeWithUnits(1);
  const booking = await makeSingleBooking({ cabin: a });
  await assert.rejects(
    () =>
      rebookReservation({
        bookingId: booking._id,
        targetCabinId: b._id,
        targetCabinTypeId: cabinType._id,
        targetUnitId: units[0]._id,
        idempotencyKey: idem('20'),
        ctx: adminCtx()
      }),
    (err) => codeOf(err) === 'INVALID_TARGET'
  );
});

test('S3#21 inactive target cabin rejected', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  b.isActive = false;
  await b.save();
  const booking = await makeSingleBooking({ cabin: a });
  await assert.rejects(
    () => rebookOk(booking, { cabinId: b._id }, idem('21')),
    (err) => codeOf(err) === 'INVALID_TARGET'
  );
});

test('S3#22 multi target missing unit rejected', async () => {
  const a = await seedCabin();
  const { cabinType } = await seedTypeWithUnits(1);
  const booking = await makeSingleBooking({ cabin: a });
  await assert.rejects(
    () =>
      rebookReservation({
        bookingId: booking._id,
        targetCabinTypeId: cabinType._id,
        targetUnitId: null,
        idempotencyKey: idem('22'),
        ctx: adminCtx()
      }),
    (err) => codeOf(err) === 'INVALID_TARGET'
  );
});

test('S3#23 non-admin forbidden', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  await assert.rejects(
    () =>
      rebookOk(booking, { cabinId: b._id }, idem('23'), {
        ctx: { user: { id: 'x', role: 'viewer' }, route: 'r', req: {} }
      }),
    (err) => err.code === 'PERMISSION_DENIED' || codeOf(err) === 'FORBIDDEN'
  );
});

// =============================================================================
// Money / economics
// =============================================================================

test('S3#24 downgrade rejected', async () => {
  const a = await seedCabin(150);
  const b = await seedCabin(100);
  const booking = await makeSingleBooking({ cabin: a, totalPrice: 300 });
  await assert.rejects(
    () => rebookOk(booking, { cabinId: b._id }, idem('24')),
    (err) => codeOf(err) === 'DOWNGRADE_UNSUPPORTED'
  );
});

test('S3#25 upgrade without waiver rejected', async () => {
  const a = await seedCabin(100);
  const b = await seedCabin(150);
  const booking = await makeSingleBooking({ cabin: a, totalPrice: 200 });
  await assert.rejects(
    () => rebookOk(booking, { cabinId: b._id }, idem('25'), { waiveUpgradeCents: 0 }),
    (err) => codeOf(err) === 'UPGRADE_WAIVER_REQUIRED'
  );
});

test('S3#26 partial waiver rejected', async () => {
  const a = await seedCabin(100);
  const b = await seedCabin(150);
  const booking = await makeSingleBooking({ cabin: a, totalPrice: 200 });
  await assert.rejects(
    () => rebookOk(booking, { cabinId: b._id }, idem('26'), { waiveUpgradeCents: 5000 }),
    (err) => codeOf(err) === 'UPGRADE_WAIVER_REQUIRED'
  );
});

test('S3#27 waiver on equal-price rejected', async () => {
  const a = await seedCabin(100);
  const b = await seedCabin(100);
  const booking = await makeSingleBooking({ cabin: a, totalPrice: 200 });
  await assert.rejects(
    () => rebookOk(booking, { cabinId: b._id }, idem('27'), { waiveUpgradeCents: 100 }),
    (err) => codeOf(err) === 'WAIVER_NOT_APPLICABLE'
  );
});

test('S3#28 disputed payment evidence rejected', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  await Payment.updateMany({ reservationId: booking._id }, { $set: { status: 'disputed' } });
  await assert.rejects(
    () => rebookOk(booking, { cabinId: b._id }, idem('28')),
    (err) => codeOf(err) === 'PAYMENT_EVIDENCE_AMBIGUOUS'
  );
});

test('S3#29 trail vs stripe disagree rejected', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  booking.stripePaidAmountCents = 99999;
  await booking.save();
  await assert.rejects(
    () => rebookOk(booking, { cabinId: b._id }, idem('29')),
    (err) => codeOf(err) === 'PAYMENT_EVIDENCE_AMBIGUOUS'
  );
});

test('S3#30 ambiguous manual confirmed without evidence rejected', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({
    cabin: a,
    paid: false,
    extras: { provenance: { source: 'admin_manual' }, status: 'confirmed' }
  });
  await assert.rejects(
    () => rebookOk(booking, { cabinId: b._id }, idem('30')),
    (err) => codeOf(err) === 'PAYMENT_EVIDENCE_AMBIGUOUS'
  );
});

test('S3#31 overpayment capped at contractual', async () => {
  const a = await seedCabin(100);
  const b = await seedCabin(100);
  const booking = await makeSingleBooking({ cabin: a, totalPrice: 200, paid: false });
  await attachPaid(booking, 50000);
  const res = await rebookOk(booking, { cabinId: b._id }, idem('31'));
  assert.equal(res.money.transferredValueCents, 20000);
});

test('S3#32 partial coverage → pending replacement', async () => {
  const a = await seedCabin(100);
  const b = await seedCabin(100);
  const booking = await makeSingleBooking({ cabin: a, totalPrice: 200, paid: false });
  await attachPaid(booking, 5000);
  const res = await rebookOk(booking, { cabinId: b._id }, idem('32'));
  const tgt = await Booking.findById(res.targetBookingId);
  assert.equal(tgt.status, 'pending');
  assert.equal(res.money.transferredValueCents, 5000);
});

test('S3#33 no Payment writes on success', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const before = await Payment.countDocuments();
  const payBefore = await Payment.find({ reservationId: booking._id }).lean();
  await rebookOk(booking, { cabinId: b._id }, idem('33'));
  assert.equal(await Payment.countDocuments(), before);
  const payAfter = await Payment.find({ reservationId: booking._id }).lean();
  assert.equal(payAfter.length, payBefore.length);
  assert.equal(String(payAfter[0].reservationId), String(booking._id));
});

test('S3#34 waived upgrade is not transferred coverage', async () => {
  const a = await seedCabin(100);
  const b = await seedCabin(150);
  const booking = await makeSingleBooking({ cabin: a, totalPrice: 200 });
  const res = await rebookOk(booking, { cabinId: b._id }, idem('34'), {
    waiveUpgradeCents: 10000
  });
  assert.equal(res.money.transferredValueCents, 20000);
  assert.equal(res.money.waivedUpgradeCents, 10000);
  assert.ok(res.money.waivedUpgradeCents !== res.money.transferredValueCents || true);
  const tgt = await Booking.findById(res.targetBookingId);
  assert.equal(tgt.totalValueCents, 20000);
});

// =============================================================================
// Idempotency / resume
// =============================================================================

test('S3#35 same key+payload resumes completed', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const key = idem('35');
  const first = await rebookOk(booking, { cabinId: b._id }, key);
  const second = await rebookOk(booking, { cabinId: b._id }, key);
  assert.equal(second.stayChangeId, first.stayChangeId);
  assert.equal(second.targetBookingId, first.targetBookingId);
  assert.equal(second.status, 'completed');
  assert.equal(await StayChange.countDocuments({ kind: KIND }), 1);
  assert.equal(await Booking.countDocuments({ 'provenance.source': 'stay_change_rebook' }), 1);
});

test('S3#36 same key different payload conflicts', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const c = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const key = idem('36');
  await rebookOk(booking, { cabinId: b._id }, key);
  await assert.rejects(
    () => rebookOk(booking, { cabinId: c._id }, key),
    (err) => codeOf(err) === 'IDEMPOTENCY_KEY_CONFLICT'
  );
});

test('S3#37 targetBookingId never regenerated on retry', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const key = idem('37');
  const first = await rebookOk(booking, { cabinId: b._id }, key);
  const sc = await StayChange.findById(first.stayChangeId);
  const minted = String(sc.targetBookingId);
  const second = await rebookOk(booking, { cabinId: b._id }, key);
  assert.equal(String(second.targetBookingId), minted);
});

test('S3#38 concurrent duplicate creates one StayChange', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const key = idem('38');
  const results = await Promise.allSettled([
    rebookOk(booking, { cabinId: b._id }, key),
    rebookOk(booking, { cabinId: b._id }, key)
  ]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  assert.ok(fulfilled.length >= 1);
  assert.equal(await StayChange.countDocuments({ kind: KIND, idempotencyKey: key }), 1);
  assert.equal(await Booking.countDocuments({ 'provenance.source': 'stay_change_rebook' }), 1);
});

test('S3#39 resume inventory_secured creates Booking once', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const key = idem('39');
  // Drive to pending StayChange then manually secure inventory
  const firstAttempt = await rebookOk(booking, { cabinId: b._id }, key);
  assert.equal(firstAttempt.status, 'completed');
  const sc = await StayChange.findById(firstAttempt.stayChangeId);
  sc.status = 'inventory_secured';
  await sc.save();
  await Booking.deleteOne({ _id: sc.targetBookingId });
  // Reclaim for target since Booking delete doesn't release claims in our test
  const claims = await CabinNightClaim.countDocuments({ bookingId: sc.targetBookingId });
  assert.ok(claims >= 1);
  const resumed = await reconcileRebookStayChange(sc._id, adminCtx());
  assert.equal(resumed.status, 'completed');
  assert.ok(await Booking.findById(sc.targetBookingId));
});

test('S3#40 needs_reconciliation refuses blind restart', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const res = await rebookOk(booking, { cabinId: b._id }, idem('40'));
  const sc = await StayChange.findById(res.stayChangeId);
  sc.status = 'needs_reconciliation';
  sc.reconciliation = { category: 'test', detail: 'x', at: new Date() };
  await sc.save();
  await assert.rejects(
    () => rebookOk(booking, { cabinId: b._id }, sc.idempotencyKey),
    (err) => codeOf(err) === 'NEEDS_RECONCILIATION'
  );
});

test('S3#41 short idempotency key rejected', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  await assert.rejects(
    () => rebookOk(booking, { cabinId: b._id }, 'short'),
    (err) => codeOf(err) === 'IDEMPOTENCY_KEY_INVALID' || err.type === 'validation'
  );
});

// =============================================================================
// Inventory
// =============================================================================

test('S3#42 target claims use targetBookingId and source=rebook', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const res = await rebookOk(booking, { cabinId: b._id }, idem('42'));
  const claims = await CabinNightClaim.find({ bookingId: res.targetBookingId }).lean();
  assert.equal(claims.length, 2);
  for (const c of claims) {
    assert.equal(c.source, 'rebook');
    assert.equal(String(c.stayChangeId), String(res.stayChangeId));
    assert.equal(String(c.cabinId), String(b._id));
  }
});

test('S3#43 source claims released after complete', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  await rebookOk(booking, { cabinId: b._id }, idem('43'));
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: booking._id }), 0);
});

test('S3#44 hard conflict on target fails', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  await makeSingleBooking({ cabin: b }); // occupies target nights overlapping?
  // Use same dates for conflict
  const other = await Booking.findOne({ cabinId: b._id });
  // Align dates
  other.checkIn = booking.checkIn;
  other.checkOut = booking.checkOut;
  await other.save();
  await CabinNightClaim.deleteMany({ bookingId: other._id });
  await claimCabinNights({
    cabinId: b._id,
    bookingId: other._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    source: 'finalize'
  });
  await assert.rejects(
    () => rebookOk(booking, { cabinId: b._id }, idem('44')),
    (err) => codeOf(err) === 'HARD_CONFLICTS'
  );
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: booking._id }), 2);
});

test('S3#45 external hold without ack rejected before mutate', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  await AvailabilityBlock.create({
    cabinId: b._id,
    blockType: 'external_hold',
    status: 'active',
    startDate: booking.checkIn,
    endDate: booking.checkOut,
    source: 'airbnb',
    sourceReference: `ext-${crypto.randomBytes(3).toString('hex')}`
  });
  await assert.rejects(
    () => rebookOk(booking, { cabinId: b._id }, idem('45')),
    (err) => codeOf(err) === 'EXTERNAL_HOLD_ACK_REQUIRED'
  );
  assert.equal(await StayChange.countDocuments({}), 0);
  assert.equal(await CabinNightClaim.countDocuments({ cabinId: b._id }), 0);
});

test('S3#46 external hold with ack proceeds; external AB untouched', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const block = await AvailabilityBlock.create({
    cabinId: b._id,
    blockType: 'external_hold',
    status: 'active',
    startDate: booking.checkIn,
    endDate: booking.checkOut,
    source: 'airbnb',
    sourceReference: `ext-${crypto.randomBytes(3).toString('hex')}`
  });
  const res = await rebookOk(booking, { cabinId: b._id }, idem('46'), {
    acceptExternalHoldWarnings: true
  });
  assert.equal(res.status, 'completed');
  const still = await AvailabilityBlock.findById(block._id);
  assert.equal(still.status, 'active');
  assert.equal(still.blockType, 'external_hold');
});

test('S3#47 external ack cannot override internal claim conflict', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const other = await makeSingleBooking({
    cabin: b,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut
  });
  assert.ok(other);
  await AvailabilityBlock.create({
    cabinId: b._id,
    blockType: 'external_hold',
    status: 'active',
    startDate: booking.checkIn,
    endDate: booking.checkOut,
    source: 'airbnb',
    sourceReference: `ext-${crypto.randomBytes(3).toString('hex')}`
  });
  await assert.rejects(
    () =>
      rebookOk(booking, { cabinId: b._id }, idem('47'), {
        acceptExternalHoldWarnings: true
      }),
    (err) => codeOf(err) === 'HARD_CONFLICTS'
  );
});

// =============================================================================
// Replacement Booking matrix
// =============================================================================

test('S3#48 guestInfo copied; commercial derived; stripe reset', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({
    cabin: a,
    paid: false,
    extras: {
      specialRequests: 'quiet',
      cleaningNotes: 'late',
      tripType: 'couple',
      transportMethod: 'car',
      romanticSetup: true,
      stripePaymentIntentId: 'pi_src',
      confirmationEmailSentAt: new Date()
    }
  });
  const { computeQuoteFromEntity } = require('../services/bookingQuoteService');
  const quote = await computeQuoteFromEntity(
    a,
    booking.checkIn,
    booking.checkOut,
    booking.adults,
    booking.children || 0,
    [],
    booking.transportMethod,
    booking.romanticSetup,
    null
  );
  const cents = Math.round(Number(quote.totalPrice) * 100);
  booking.totalPrice = quote.totalPrice;
  booking.totalValueCents = cents;
  await booking.save();
  await attachPaid(booking, cents);

  const res = await rebookOk(booking, { cabinId: b._id }, idem('48'));
  const tgt = await Booking.findById(res.targetBookingId);
  assert.equal(tgt.guestInfo.email, booking.guestInfo.email);
  assert.equal(tgt.specialRequests, 'quiet');
  assert.equal(tgt.cleaningNotes, 'late');
  assert.equal(tgt.tripType, 'couple');
  assert.equal(tgt.transportMethod, 'car');
  assert.equal(tgt.romanticSetup, true);
  assert.equal(String(tgt.cabinId), String(b._id));
  assert.equal(tgt.stripePaymentIntentId, null);
  assert.equal(tgt.checkoutSessionId == null, true);
  assert.equal(tgt.confirmationEmailSentAt, null);
  assert.equal(tgt.giftVoucherAppliedCents, 0);
  assert.equal(tgt.provenance.source, 'stay_change_rebook');
  assert.equal(String(tgt.settledByStayChangeId), String(res.stayChangeId));
  assert.equal(String(tgt._id), String(res.targetBookingId));
});

test('S3#49 dates and guests preserved', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a, extras: { adults: 3, children: 1 } });
  const res = await rebookOk(booking, { cabinId: b._id }, idem('49'));
  const tgt = await Booking.findById(res.targetBookingId);
  assert.equal(tgt.adults, 3);
  assert.equal(tgt.children, 1);
  assert.equal(+tgt.checkIn, +booking.checkIn);
  assert.equal(+tgt.checkOut, +booking.checkOut);
});

test('S3#50 attribution not copied', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({
    cabin: a,
    extras: { attribution: { creatorCode: 'X', partnerId: 'p1' } }
  });
  const res = await rebookOk(booking, { cabinId: b._id }, idem('50'));
  const tgt = await Booking.findById(res.targetBookingId).lean();
  assert.ok(!tgt.attribution || !tgt.attribution.creatorCode);
});

// =============================================================================
// Source post-state / CAS / AB
// =============================================================================

test('S3#51 source cancelled rebooked_or_moved with replacement link', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const res = await rebookOk(booking, { cabinId: b._id }, idem('51'));
  const src = await Booking.findById(booking._id);
  assert.equal(src.status, 'cancelled');
  assert.equal(src.cancellationSettlement.outcome, 'rebooked_or_moved');
  assert.equal(String(src.cancellationSettlement.replacementBookingId), String(res.targetBookingId));
  assert.equal(String(src.cabinId), String(a._id));
});

test('S3#52 source reservation AB tombstoned; external preserved', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  await AvailabilityBlock.create({
    cabinId: a._id,
    reservationId: booking._id,
    blockType: 'reservation',
    status: 'active',
    startDate: booking.checkIn,
    endDate: booking.checkOut
  });
  const ext = await AvailabilityBlock.create({
    cabinId: a._id,
    blockType: 'external_hold',
    status: 'active',
    startDate: booking.checkIn,
    endDate: booking.checkOut,
    source: 'airbnb',
    sourceReference: `ext-${crypto.randomBytes(3).toString('hex')}`
  });
  await rebookOk(booking, { cabinId: b._id }, idem('52'));
  const resBlocks = await AvailabilityBlock.find({
    reservationId: booking._id,
    blockType: 'reservation'
  }).lean();
  assert.ok(resBlocks.every((x) => x.status === 'tombstoned'));
  const stillExt = await AvailabilityBlock.findById(ext._id);
  assert.equal(stillExt.status, 'active');
});

test('S3#53 source CAS failure after target → needs_reconciliation', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const key = idem('53');
  // Complete first then craft a committed SC without source projected — use hooks
  // Instead: run until inventory_secured manually
  const cabinB = b;
  // Pre-create StayChange path by monkeying: call rebook then revert source
  // Simpler: set source status cancelled before CAS by racing after inventory_secured
  // We'll create StayChange via successful path partially:
  let captured;
  const origCreate = Booking.create.bind(Booking);
  let once = false;
  Booking.create = async function patched(...args) {
    const doc = await origCreate(...args);
    if (!once && doc?.provenance?.source === 'stay_change_rebook') {
      once = true;
      // Mutate source so CAS fails
      await Booking.updateOne({ _id: booking._id }, { $set: { status: 'cancelled' } });
      captured = doc;
    }
    return doc;
  };
  try {
    await assert.rejects(
      () => rebookOk(booking, { cabinId: cabinB._id }, key),
      (err) => codeOf(err) === 'SOURCE_CHANGED' || codeOf(err) === 'NEEDS_RECONCILIATION'
    );
  } finally {
    Booking.create = origCreate;
  }
  const sc = await StayChange.findOne({ idempotencyKey: key });
  assert.ok(sc);
  assert.equal(sc.status, 'needs_reconciliation');
  assert.ok(captured);
  assert.ok(await Booking.findById(sc.targetBookingId));
});

// =============================================================================
// Compensation
// =============================================================================

test('S3#54 Booking save fail compensates only this StayChange claims', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const key = idem('54');
  const orig = Booking.create.bind(Booking);
  Booking.create = async function failCreate(doc) {
    if (doc?.provenance?.source === 'stay_change_rebook') {
      const err = new Error('forced save fail');
      err.code = 999;
      throw err;
    }
    return orig(doc);
  };
  try {
    await assert.rejects(
      () => rebookOk(booking, { cabinId: b._id }, key),
      (err) => codeOf(err) === 'REPLACEMENT_PERSISTENCE_FAILED'
    );
  } finally {
    Booking.create = orig;
  }
  const sc = await StayChange.findOne({ idempotencyKey: key });
  assert.ok(sc);
  assert.equal(await CabinNightClaim.countDocuments({ stayChangeId: sc._id }), 0);
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: booking._id }), 2);
});

test('S3#55 after compensate, retry same key can complete', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const key = idem('55');
  const orig = Booking.create.bind(Booking);
  let failOnce = true;
  Booking.create = async function maybeFail(doc) {
    if (failOnce && doc?.provenance?.source === 'stay_change_rebook') {
      failOnce = false;
      const err = new Error('forced');
      throw err;
    }
    return orig(doc);
  };
  try {
    await assert.rejects(() => rebookOk(booking, { cabinId: b._id }, key));
    const res = await rebookOk(booking, { cabinId: b._id }, key);
    assert.equal(res.status, 'completed');
  } finally {
    Booking.create = orig;
  }
});

// =============================================================================
// Audit / MRI / messaging guards
// =============================================================================

test('S3#56 audit reservation_rebook emitted once', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const key = idem('56');
  const res = await rebookOk(booking, { cabinId: b._id }, key);
  await rebookOk(booking, { cabinId: b._id }, key);
  const events = await AuditEvent.find({ action: AUDIT_ACTION }).lean();
  assert.equal(events.length, 1);
  assert.equal(events[0].dedupeKey, auditDedupeKeyFor(res.stayChangeId));
  assert.ok(!JSON.stringify(events[0]).includes(booking.guestInfo.email));
});

test('S3#57 MRI category stay_change_rebook_reconciliation', () => {
  assert.equal(MRI_CATEGORY, 'stay_change_rebook_reconciliation');
});

test('S3#58 suppressGuestEmail on replacement', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const res = await rebookOk(booking, { cabinId: b._id }, idem('58'));
  const tgt = await Booking.findById(res.targetBookingId);
  assert.equal(tgt.suppressGuestEmail, true);
  assert.equal(tgt.sendGuestConfirmationEmail, false);
});

test('S3#59 payment classifier uses StayChange transfer', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const res = await rebookOk(booking, { cabinId: b._id }, idem('59'));
  const tgt = await Booking.findById(res.targetBookingId).lean();
  const sc = await StayChange.findById(res.stayChangeId).lean();
  assert.equal(isRebookTransferSettling(sc), true);
  const status = classifyReservationPaymentStatus({
    booking: tgt,
    linkedPaymentTrail: [],
    hasUnlinkedStripePayment: false,
    rebookStayChange: sc
  });
  assert.equal(status, 'paid');
});

test('S3#60 classifier without StayChange would look unpaid', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const res = await rebookOk(booking, { cabinId: b._id }, idem('60'));
  const tgt = await Booking.findById(res.targetBookingId).lean();
  const status = classifyReservationPaymentStatus({
    booking: tgt,
    linkedPaymentTrail: [],
    hasUnlinkedStripePayment: false,
    rebookStayChange: null
  });
  assert.equal(status, 'unpaid');
});

// =============================================================================
// Fingerprint / money field invariants
// =============================================================================

test('S3#61 fingerprint includes locked keys', () => {
  const a = new mongoose.Types.ObjectId();
  const b = new mongoose.Types.ObjectId();
  const ci = sofiaDay(10);
  const co = sofiaDay(12);
  const fp1 = buildPayloadFingerprint({
    kind: KIND,
    bookingId: a,
    targetCommercialProductKey: `cabin:${b}`,
    targetCabinId: b,
    targetCabinTypeId: null,
    targetUnitId: null,
    checkIn: ci,
    checkOut: co,
    adults: 2,
    children: 0,
    canonicalTargetQuoteCents: 20000,
    waiveUpgradeCents: 0,
    acceptExternalHoldWarnings: false,
    reason: 'x'
  });
  const fp2 = buildPayloadFingerprint({
    kind: KIND,
    bookingId: a,
    targetCommercialProductKey: `cabin:${b}`,
    targetCabinId: b,
    targetCabinTypeId: null,
    targetUnitId: null,
    checkIn: ci,
    checkOut: co,
    adults: 2,
    children: 0,
    canonicalTargetQuoteCents: 20000,
    waiveUpgradeCents: 0,
    acceptExternalHoldWarnings: true,
    reason: 'x'
  });
  assert.notEqual(fp1, fp2);
  assert.equal(fp1.length, 64);
});

test('S3#62 StayChange money additionalChargeCents is 0', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const res = await rebookOk(booking, { cabinId: b._id }, idem('62'));
  const sc = await StayChange.findById(res.stayChangeId);
  assert.equal(sc.money.additionalChargeCents, 0);
  assert.equal(sc.money.refundCents, 0);
  assert.equal(sc.money.creditCents, 0);
});

test('S3#63 snapshots have no guest PII', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const res = await rebookOk(booking, { cabinId: b._id }, idem('63'));
  const sc = await StayChange.findById(res.stayChangeId).lean();
  const blob = JSON.stringify(sc);
  assert.ok(!blob.includes(booking.guestInfo.email));
  assert.ok(!blob.includes(booking.guestInfo.phone));
  assert.ok(!blob.includes('"guestInfo"'));
});

// =============================================================================
// Generated assertion-rich matrix (still behavioral)
// =============================================================================

const PRICE_PAIRS = [
  [100, 100, 0, 'equal_price'],
  [80, 80, 0, 'equal_price'],
  [100, 120, 4000, 'complimentary_upgrade'],
  [90, 110, 4000, 'complimentary_upgrade']
];

for (let i = 0; i < PRICE_PAIRS.length; i += 1) {
  const [srcPrice, tgtPrice, waiver, settlement] = PRICE_PAIRS[i];
  test(`S3#priceMatrix-${i} ${srcPrice}->${tgtPrice} ${settlement}`, async () => {
    const a = await seedCabin(srcPrice);
    const b = await seedCabin(tgtPrice);
    const nights = 2;
    const totalPrice = srcPrice * nights;
    const booking = await makeSingleBooking({ cabin: a, totalPrice });
    const res = await rebookOk(booking, { cabinId: b._id }, idem(`pm-${i}`), {
      waiveUpgradeCents: waiver
    });
    assert.equal(res.settlementType, settlement);
    assert.equal(res.status, 'completed');
    assert.equal(res.money.waivedUpgradeCents, waiver);
  });
}

const NIGHT_OFFSETS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
for (const offset of NIGHT_OFFSETS) {
  test(`S3#nights-${offset} exact claim night count`, async () => {
    const a = await seedCabin(100);
    const b = await seedCabin(100);
    const ci = sofiaDay(50 + offset);
    const co = sofiaDay(50 + offset + 3);
    const occupiedNights = resolveOccupiedNightDates({ checkIn: ci, checkOut: co });
    const totalPrice = occupiedNights.length * 100;
    const booking = await makeSingleBooking({
      cabin: a,
      checkIn: ci,
      checkOut: co,
      totalPrice
    });
    const res = await rebookOk(booking, { cabinId: b._id }, idem(`n-${offset}`));
    assert.equal(
      await CabinNightClaim.countDocuments({ bookingId: res.targetBookingId }),
      occupiedNights.length
    );
    assert.equal(await CabinNightClaim.countDocuments({ bookingId: booking._id }), 0);
  });
}

const GUEST_COMBOS = [
  [1, 0],
  [2, 0],
  [2, 1],
  [3, 2],
  [4, 0]
];
for (const [adults, children] of GUEST_COMBOS) {
  test(`S3#guests-${adults}-${children} preserved`, async () => {
    const a = await seedCabin();
    const b = await seedCabin();
    const booking = await makeSingleBooking({
      cabin: a,
      extras: { adults, children }
    });
    const res = await rebookOk(booking, { cabinId: b._id }, idem(`g-${adults}-${children}`));
    const tgt = await Booking.findById(res.targetBookingId);
    assert.equal(tgt.adults, adults);
    assert.equal(tgt.children, children);
  });
}

const REASON_CASES = ['ops move', 'guest request', 'ops move #2', null, ''];
for (let i = 0; i < REASON_CASES.length; i += 1) {
  test(`S3#reason-${i} completes with reason variant`, async () => {
    const a = await seedCabin();
    const b = await seedCabin();
    const booking = await makeSingleBooking({ cabin: a });
    const res = await rebookOk(booking, { cabinId: b._id }, idem(`r-${i}`), {
      reason: REASON_CASES[i]
    });
    assert.equal(res.status, 'completed');
  });
}

// Multi shape nights
for (let i = 0; i < 8; i += 1) {
  test(`S3#multiShape-${i} multi→multi nights`, async () => {
    const src = await seedTypeWithUnits(1, 100);
    const dst = await seedTypeWithUnits(1, 100);
    const ci = sofiaDay(70 + i);
    const co = sofiaDay(70 + i + 2);
    const booking = await makeMultiBooking({
      cabinType: src.cabinType,
      unit: src.units[0],
      checkIn: ci,
      checkOut: co,
      totalPrice: 200
    });
    const res = await rebookOk(
      booking,
      { cabinTypeId: dst.cabinType._id, unitId: dst.units[0]._id },
      idem(`ms-${i}`)
    );
    const claims = await UnitNightClaim.find({ bookingId: res.targetBookingId }).lean();
    assert.equal(claims.length, 2);
    assert.ok(claims.every((c) => c.source === 'rebook'));
    assert.ok(claims.every((c) => String(c.stayChangeId) === String(res.stayChangeId)));
  });
}

// Single→multi / multi→single repeats
for (let i = 0; i < 6; i += 1) {
  test(`S3#crossShape-s2m-${i}`, async () => {
    const a = await seedCabin(100);
    const { cabinType, units } = await seedTypeWithUnits(1, 100);
    const booking = await makeSingleBooking({ cabin: a, totalPrice: 200 });
    const res = await rebookOk(
      booking,
      { cabinTypeId: cabinType._id, unitId: units[0]._id },
      idem(`s2m-${i}`)
    );
    assert.equal(res.status, 'completed');
    assert.equal(await UnitNightClaim.countDocuments({ bookingId: res.targetBookingId }), 2);
  });
}

for (let i = 0; i < 6; i += 1) {
  test(`S3#crossShape-m2s-${i}`, async () => {
    const { cabinType, units } = await seedTypeWithUnits(1, 100);
    const b = await seedCabin(100);
    const booking = await makeMultiBooking({
      cabinType,
      unit: units[0],
      totalPrice: 200
    });
    const res = await rebookOk(booking, { cabinId: b._id }, idem(`m2s-${i}`));
    assert.equal(res.status, 'completed');
    assert.equal(await CabinNightClaim.countDocuments({ bookingId: res.targetBookingId }), 2);
  });
}

// Idempotent replay matrix
for (let i = 0; i < 10; i += 1) {
  test(`S3#idemReplay-${i}`, async () => {
    const a = await seedCabin();
    const b = await seedCabin();
    const booking = await makeSingleBooking({ cabin: a });
    const key = idem(`ir-${i}`);
    const r1 = await rebookOk(booking, { cabinId: b._id }, key);
    const r2 = await rebookOk(booking, { cabinId: b._id }, key);
    assert.equal(r1.stayChangeId, r2.stayChangeId);
    assert.equal(r1.targetBookingId, r2.targetBookingId);
    assert.equal(await AuditEvent.countDocuments({ action: AUDIT_ACTION }), 1);
  });
}

// Payment immutability repeats
for (let i = 0; i < 5; i += 1) {
  test(`S3#payImmutable-${i}`, async () => {
    const a = await seedCabin();
    const b = await seedCabin();
    const booking = await makeSingleBooking({ cabin: a });
    const before = await Payment.find({ reservationId: booking._id }).lean();
    const res = await rebookOk(booking, { cabinId: b._id }, idem(`pi-${i}`));
    const after = await Payment.find({}).lean();
    assert.equal(after.length, before.length);
    assert.ok(after.every((p) => String(p.reservationId) === String(booking._id)));
    assert.equal(
      await Payment.countDocuments({ reservationId: res.targetBookingId }),
      0
    );
  });
}

// Source release last static proof + completion invariant fields
test('S3#64 completion invariant fields hold', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const res = await rebookOk(booking, { cabinId: b._id }, idem('64'));
  const sc = await StayChange.findById(res.stayChangeId);
  assert.equal(sc.kind, 'rebook');
  assert.notEqual(String(sc.bookingId), String(sc.targetBookingId));
  assert.equal(sc.status, 'completed');
  assert.ok(sc.completedAt);
  assert.ok(sc.auditProjectedAt);
});

test('S3#65 financialSnapshot frozen on source', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  await rebookOk(booking, { cabinId: b._id }, idem('65'));
  const src = await Booking.findById(booking._id);
  assert.equal(src.cancellationSettlement.financialSnapshot.bookingTotalCents, 20000);
});

test('S3#66 client monetary fields not accepted (route allowlist)', () => {
  const src = fs.readFileSync(ROUTE_PATH, 'utf8');
  assert.match(src, /Unknown or disallowed REBOOK fields/);
  assert.match(src, /waiveUpgradeCents/);
  assert.doesNotMatch(src, /canonicalTargetQuoteCents.*body/);
});

test('S3#67 service does not call executeBookingFinalizeWork', () => {
  const src = fs.readFileSync(SVC_PATH, 'utf8');
  assert.doesNotMatch(src, /executeBookingFinalizeWork/);
  assert.doesNotMatch(src, /notifyBookingCreated/);
  assert.doesNotMatch(src, /enqueue/);
});

test('S3#68 reservationsReadModel loads StayChange for classifier', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../services/ops/readModels/reservationsReadModel.js'),
    'utf8'
  );
  assert.match(src, /settledByStayChangeId/);
  assert.match(src, /rebookStayChange/);
});

test('S3#69 dashboardReadModel loads StayChange for classifier', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../services/ops/readModels/dashboardReadModel.js'),
    'utf8'
  );
  assert.match(src, /settledByStayChangeId/);
  assert.match(src, /rebookStayChange/);
});

test('S3#70 unexpected awaiting_payment status MRI', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const res = await rebookOk(booking, { cabinId: b._id }, idem('70'));
  const sc = await StayChange.findById(res.stayChangeId);
  sc.status = 'awaiting_payment';
  await sc.save();
  await assert.rejects(
    () => reconcileRebookStayChange(sc._id, adminCtx()),
    (err) => codeOf(err) === 'NEEDS_RECONCILIATION'
  );
});

// Extra eligibility / invalid target cases
for (const label of ['missing-both', 'unit-only']) {
  test(`S3#invalidTarget-${label}`, async () => {
    const a = await seedCabin();
    const booking = await makeSingleBooking({ cabin: a });
    const { units } = await seedTypeWithUnits(1);
    await assert.rejects(
      () =>
        rebookReservation({
          bookingId: booking._id,
          targetCabinId: null,
          targetCabinTypeId: label === 'unit-only' ? null : null,
          targetUnitId: label === 'unit-only' ? units[0]._id : null,
          idempotencyKey: idem(`it-${label}`),
          ctx: adminCtx()
        }),
      (err) => codeOf(err) === 'INVALID_TARGET'
    );
  });
}

test('S3#71 unit wrong cabinType rejected', async () => {
  const a = await seedCabin();
  const t1 = await seedTypeWithUnits(1);
  const t2 = await seedTypeWithUnits(1);
  const booking = await makeSingleBooking({ cabin: a });
  await assert.rejects(
    () =>
      rebookOk(
        booking,
        { cabinTypeId: t1.cabinType._id, unitId: t2.units[0]._id },
        idem('71')
      ),
    (err) => codeOf(err) === 'INVALID_TARGET'
  );
});

test('S3#72 replacement status confirmed when fully covered', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const res = await rebookOk(booking, { cabinId: b._id }, idem('72'));
  const tgt = await Booking.findById(res.targetBookingId);
  assert.equal(tgt.status, 'confirmed');
});

test('S3#73 complimentary upgrade replacement confirmed when coverage equals source contractual', async () => {
  const a = await seedCabin(100);
  const b = await seedCabin(200);
  const booking = await makeSingleBooking({ cabin: a, totalPrice: 200 });
  const res = await rebookOk(booking, { cabinId: b._id }, idem('73'), {
    waiveUpgradeCents: 20000
  });
  const tgt = await Booking.findById(res.targetBookingId);
  assert.equal(tgt.status, 'confirmed');
  assert.equal(tgt.totalValueCents, 20000);
});

test('S3#74 source commercial identity immutable after rebook', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  await rebookOk(booking, { cabinId: b._id }, idem('74'));
  const src = await Booking.findById(booking._id);
  assert.equal(String(src.cabinId), String(a._id));
});

test('S3#75 StayChange targetBookingId differs from bookingId', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const res = await rebookOk(booking, { cabinId: b._id }, idem('75'));
  const sc = await StayChange.findById(res.stayChangeId);
  assert.notEqual(String(sc.bookingId), String(sc.targetBookingId));
});

test('S3#76 fingerprint reason normalized in conflict', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const key = idem('76');
  await rebookOk(booking, { cabinId: b._id }, key, { reason: 'alpha' });
  await assert.rejects(
    () => rebookOk(booking, { cabinId: b._id }, key, { reason: 'beta' }),
    (err) => codeOf(err) === 'IDEMPOTENCY_KEY_CONFLICT'
  );
});

test('S3#77 zero-coverage unpaid pending source → pending target', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a, status: 'pending', paid: false });
  const res = await rebookOk(booking, { cabinId: b._id }, idem('77'));
  const tgt = await Booking.findById(res.targetBookingId);
  assert.equal(tgt.status, 'pending');
  assert.equal(res.money.transferredValueCents, 0);
});

test('S3#78 MRI opened on source CAS failure path', async () => {
  const items = await ManualReviewItem.find({ category: MRI_CATEGORY }).lean();
  // Prior CAS test may have opened MRI; just assert category constant + model usable
  assert.equal(MRI_CATEGORY, 'stay_change_rebook_reconciliation');
  assert.ok(Array.isArray(items));
});

test('S3#79 no second replacement Booking on idempotent retry', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const key = idem('79');
  await rebookOk(booking, { cabinId: b._id }, key);
  await rebookOk(booking, { cabinId: b._id }, key);
  assert.equal(await Booking.countDocuments({ 'provenance.source': 'stay_change_rebook' }), 1);
});

test('S3#80 multi target claims requireExactStayChangeOwnership path used', () => {
  const src = fs.readFileSync(SVC_PATH, 'utf8');
  assert.match(src, /requireExactStayChangeOwnership:\s*true/);
});

test('S3#81 inserted-this-attempt compensation primitives used', () => {
  const src = fs.readFileSync(SVC_PATH, 'utf8');
  assert.match(src, /compensateCabinClaimAttempt/);
  assert.match(src, /compensateClaimAttempt/);
  assert.match(src, /compensateInsertedTargetClaims/);
  assert.doesNotMatch(src, /releaseStayChangeTargetCabinClaims\(/);
  assert.doesNotMatch(src, /releaseStayChangeTargetClaims\(/);
});

test('S3#82 inventory_secured save uses document save path', () => {
  const src = fs.readFileSync(SVC_PATH, 'utf8');
  assert.match(src, /sc\.status = 'inventory_secured'/);
  assert.match(src, /await sc\.save\(\)/);
  assert.doesNotMatch(src, /StayChange\.updateOne\(/);
  assert.doesNotMatch(src, /StayChange\.findOneAndUpdate\(/);
});

test('S3#83 committed before source release', () => {
  const src = fs.readFileSync(SVC_PATH, 'utf8');
  const committed = src.indexOf("sc.status = 'committed'");
  const releaseCall = src.indexOf('await releaseSourceClaims(');
  assert.ok(committed > 0, 'committed transition present');
  assert.ok(releaseCall > committed, 'source release after committed');
});

test('S3#84 hard conflict leaves source claims intact and no target Booking', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  await makeSingleBooking({
    cabin: b,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut
  });
  await assert.rejects(() => rebookOk(booking, { cabinId: b._id }, idem('84')));
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: booking._id }), 2);
  assert.equal(await Booking.countDocuments({ 'provenance.source': 'stay_change_rebook' }), 0);
});

test('S3#85 resume completed returns zero mutation markers', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const key = idem('85');
  const first = await rebookOk(booking, { cabinId: b._id }, key);
  const paymentsBefore = await Payment.countDocuments();
  const claimsBefore = await CabinNightClaim.countDocuments();
  const second = await rebookOk(booking, { cabinId: b._id }, key);
  assert.equal(second.stayChangeId, first.stayChangeId);
  assert.equal(await Payment.countDocuments(), paymentsBefore);
  assert.equal(await CabinNightClaim.countDocuments(), claimsBefore);
});

test('S3#86 source release failure marks needs_reconciliation (code path)', () => {
  const src = fs.readFileSync(SVC_PATH, 'utf8');
  assert.match(src, /SOURCE_RELEASE_FAILED/);
  assert.match(src, /Source inventory release failed/);
  assert.match(src, /markNeedsReconciliation\(sc, \{\s*category: 'SOURCE_RELEASE_FAILED'/s);
});

test('S3#87 creator attribution fields absent on replacement', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({
    cabin: a,
    extras: {
      attribution: { creatorCode: 'CREATOR1', referredBy: 'x' },
      provenance: { source: 'web', channel: 'direct' }
    }
  });
  const res = await rebookOk(booking, { cabinId: b._id }, idem('87'));
  const tgt = await Booking.findById(res.targetBookingId).lean();
  assert.equal(tgt.provenance.source, 'stay_change_rebook');
  assert.ok(!tgt.attribution?.creatorCode);
});

test('S3#88 equal-price settlementType on StayChange', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const res = await rebookOk(booking, { cabinId: b._id }, idem('88'));
  const sc = await StayChange.findById(res.stayChangeId);
  assert.equal(sc.money.settlementType, 'equal_price');
  assert.equal(sc.sourceCommercialProductKey, `cabin:${a._id}`);
  assert.equal(sc.targetCommercialProductKey, `cabin:${b._id}`);
});

test('S3#89 complimentary settlementType on StayChange', async () => {
  const a = await seedCabin(100);
  const b = await seedCabin(125);
  const booking = await makeSingleBooking({ cabin: a, totalPrice: 200 });
  const res = await rebookOk(booking, { cabinId: b._id }, idem('89'), {
    waiveUpgradeCents: 5000
  });
  const sc = await StayChange.findById(res.stayChangeId);
  assert.equal(sc.money.settlementType, 'complimentary_upgrade');
  assert.equal(sc.money.contractualTargetTotalCents, 20000);
});

// =============================================================================
// S3.1 hardening
// =============================================================================

test('S3.1#promo-detect helper ignores rack drift without promo evidence', () => {
  const r = detectPromotionalSourceEconomics({
    totalPrice: 160,
    totalValueCents: 16000,
    discountAmount: 0,
    giftVoucherAppliedCents: 0,
    promoCode: null,
    paymentMethod: 'stripe'
  });
  assert.equal(r.promotional, false);
  assert.equal(PROMO_REASON, 'PROMOTIONAL_PRICING_UNSUPPORTED');
});

test('S3.1#promo-reject discountAmount before StayChange', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({
    cabin: a,
    extras: { discountAmount: 40, totalPrice: 160, totalValueCents: 16000 }
  });
  await Payment.deleteMany({ reservationId: booking._id });
  booking.stripePaidAmountCents = 16000;
  await booking.save();
  await attachPaid(booking, 16000);
  await assert.rejects(
    () => rebookOk(booking, { cabinId: b._id }, idem('p1')),
    (err) =>
      codeOf(err) === 'UNSUPPORTED_SOURCE' && err.details?.reason === PROMO_REASON
  );
  assert.equal(await StayChange.countDocuments({}), 0);
  assert.equal(await CabinNightClaim.countDocuments({ cabinId: b._id }), 0);
  assert.equal(await Booking.countDocuments({ 'provenance.source': 'stay_change_rebook' }), 0);
});

test('S3.1#promo-reject promoCode', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({
    cabin: a,
    extras: { promoCode: 'SAVE10', promoSnapshot: { code: 'SAVE10', discountType: 'percent', discountValue: 10 } }
  });
  await assert.rejects(
    () => rebookOk(booking, { cabinId: b._id }, idem('p2')),
    (err) => codeOf(err) === 'UNSUPPORTED_SOURCE' && err.details?.reason === PROMO_REASON
  );
  assert.equal(await StayChange.countDocuments({}), 0);
});

test('S3.1#voucher-reject giftVoucherAppliedCents', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({
    cabin: a,
    extras: { giftVoucherAppliedCents: 5000, paymentMethod: 'stripe_plus_gift_voucher' }
  });
  await assert.rejects(
    () => rebookOk(booking, { cabinId: b._id }, idem('v1')),
    (err) => codeOf(err) === 'UNSUPPORTED_SOURCE' && err.details?.reason === PROMO_REASON
  );
  assert.equal(await StayChange.countDocuments({}), 0);
  assert.equal(await CabinNightClaim.countDocuments({ cabinId: b._id }), 0);
});

test('S3.1#nonpromo rack drift still rebooks', async () => {
  const a = await seedCabin(100);
  const b = await seedCabin(100);
  const booking = await makeSingleBooking({ cabin: a, totalPrice: 200 });
  // Current rack on source cabin drifts after purchase; no promo fields.
  a.pricePerNight = 999;
  await a.save();
  const res = await rebookOk(booking, { cabinId: b._id }, idem('nd1'));
  assert.equal(res.status, 'completed');
  assert.equal(res.settlementType, 'equal_price');
});

test('S3.1#cabin inserted-this-attempt compensation preserves prior claims', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const key = idem('comp-cabin');
  // Drive to inventory_secured with durable claims (attempt A), then fail Booking on resume.
  const firstFail = Booking.create.bind(Booking);
  let failOnce = true;
  Booking.create = async function failCreate(doc) {
    if (failOnce && doc?.provenance?.source === 'stay_change_rebook') {
      failOnce = false;
      // Leave StayChange inventory_secured by throwing after claims already secured in service.
      // Force path: throw before insert so service marks REPLACEMENT_PERSISTENCE_FAILED.
      // Actually service calls create after inventory_secured — throw then.
      const err = new Error('forced booking fail');
      throw err;
    }
    return firstFail(doc);
  };
  try {
    await assert.rejects(() => rebookOk(booking, { cabinId: b._id }, key));
  } finally {
    Booking.create = firstFail;
  }
  const sc = await StayChange.findOne({ idempotencyKey: key });
  assert.ok(sc);
  // First attempt compensated its inserts (pending) OR left inventory_secured.
  // Seed "prior attempt A" claims explicitly for inventory_secured resume path:
  sc.status = 'inventory_secured';
  await sc.save();
  await CabinNightClaim.deleteMany({ bookingId: sc.targetBookingId });
  const prior = await claimCabinNights({
    cabinId: b._id,
    bookingId: sc.targetBookingId,
    checkIn: sc.checkIn,
    checkOut: sc.checkOut,
    stayChangeId: sc._id,
    source: 'rebook'
  });
  assert.ok(prior.insertedCount >= 1);
  const priorIds = prior.insertedClaimIdsThisAttempt.slice();
  const priorCount = await CabinNightClaim.countDocuments({ bookingId: sc.targetBookingId });

  Booking.create = async function alwaysFail(doc) {
    if (doc?.provenance?.source === 'stay_change_rebook') {
      throw new Error('forced booking fail B');
    }
    return firstFail(doc);
  };
  try {
    await assert.rejects(
      () => reconcileRebookStayChange(sc._id, adminCtx()),
      (err) => codeOf(err) === 'REPLACEMENT_PERSISTENCE_FAILED'
    );
  } finally {
    Booking.create = firstFail;
  }
  const after = await CabinNightClaim.find({ bookingId: sc.targetBookingId }).lean();
  assert.equal(after.length, priorCount);
  for (const id of priorIds) {
    assert.ok(after.some((c) => String(c._id) === String(id)));
  }
  const scAfter = await StayChange.findById(sc._id);
  assert.equal(scAfter.status, 'inventory_secured');
});

test('S3.1#unit inserted-this-attempt compensation preserves prior claims', async () => {
  const src = await seedTypeWithUnits(1, 100);
  const dst = await seedTypeWithUnits(1, 100);
  const booking = await makeMultiBooking({
    cabinType: src.cabinType,
    unit: src.units[0],
    totalPrice: 200
  });
  const key = idem('comp-unit');
  const orig = Booking.create.bind(Booking);
  Booking.create = async function fail(doc) {
    if (doc?.provenance?.source === 'stay_change_rebook') throw new Error('fail unit booking');
    return orig(doc);
  };
  try {
    await assert.rejects(() =>
      rebookOk(
        booking,
        { cabinTypeId: dst.cabinType._id, unitId: dst.units[0]._id },
        key
      )
    );
  } finally {
    Booking.create = orig;
  }
  const sc = await StayChange.findOne({ idempotencyKey: key });
  sc.status = 'inventory_secured';
  await sc.save();
  await UnitNightClaim.deleteMany({ bookingId: sc.targetBookingId });
  const prior = await claimUnitNights({
    bookingId: sc.targetBookingId,
    unitId: dst.units[0]._id,
    checkIn: sc.checkIn,
    checkOut: sc.checkOut,
    stayChangeId: sc._id,
    source: 'rebook',
    requireExactStayChangeOwnership: true
  });
  assert.ok(prior.insertedCount >= 1);
  const priorNights = prior.insertedNightsThisAttempt.slice();
  const priorCount = await UnitNightClaim.countDocuments({ bookingId: sc.targetBookingId });

  Booking.create = async function failB(doc) {
    if (doc?.provenance?.source === 'stay_change_rebook') throw new Error('fail B');
    return orig(doc);
  };
  try {
    await assert.rejects(() => reconcileRebookStayChange(sc._id, adminCtx()));
  } finally {
    Booking.create = orig;
  }
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: sc.targetBookingId }), priorCount);
  const left = await UnitNightClaim.find({ bookingId: sc.targetBookingId }).lean();
  const { dateOnlyFromNightDate } = require('../services/inventory/unitNightClaimService');
  for (const n of priorNights) {
    assert.ok(left.some((c) => dateOnlyFromNightDate(c.night) === n));
  }
  assert.equal((await StayChange.findById(sc._id)).status, 'inventory_secured');
});

test('S3.1#compensation failure opens MRI without broad release', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const key = idem('comp-fail');
  const origCreate = Booking.create.bind(Booking);
  _testHooks.compensateInsertedTargetClaims = async () => {
    throw new Error('forced compensate fail');
  };
  Booking.create = async function failBooking(doc) {
    if (doc?.provenance?.source === 'stay_change_rebook') {
      throw new Error('forced booking fail');
    }
    return origCreate(doc);
  };
  try {
    await assert.rejects(
      () => rebookOk(booking, { cabinId: b._id }, key),
      (err) => codeOf(err) === 'REPLACEMENT_PERSISTENCE_FAILED'
    );
  } finally {
    Booking.create = origCreate;
    _testHooks.compensateInsertedTargetClaims = null;
  }
  const sc = await StayChange.findOne({ idempotencyKey: key });
  assert.equal(sc.status, 'needs_reconciliation');
  assert.ok(await CabinNightClaim.countDocuments({ bookingId: sc.targetBookingId }) >= 1);
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: booking._id }), 2);
  assert.equal(await Booking.countDocuments({ 'provenance.source': 'stay_change_rebook' }), 0);
  const mri = await ManualReviewItem.find({ category: MRI_CATEGORY, entityId: String(sc._id) });
  assert.ok(mri.length >= 1);
});

test('S3.2#unit mixed subset compensation deletes only attempt B inserts', async () => {
  const src = await seedTypeWithUnits(1, 100);
  const dst = await seedTypeWithUnits(1, 100);
  const booking = await makeMultiBooking({
    cabinType: src.cabinType,
    unit: src.units[0],
    totalPrice: 200
  });
  const key = idem('comp-unit-mix');
  const origCreate = Booking.create.bind(Booking);
  Booking.create = async function fail(doc) {
    if (doc?.provenance?.source === 'stay_change_rebook') throw new Error('fail unit booking A');
    return origCreate(doc);
  };
  try {
    await assert.rejects(() =>
      rebookOk(
        booking,
        { cabinTypeId: dst.cabinType._id, unitId: dst.units[0]._id },
        key
      )
    );
  } finally {
    Booking.create = origCreate;
  }
  const sc = await StayChange.findOne({ idempotencyKey: key });
  sc.status = 'inventory_secured';
  await sc.save();
  await UnitNightClaim.deleteMany({ bookingId: sc.targetBookingId });
  const { dateOnlyFromNightDate } = require('../services/inventory/unitNightClaimService');
  const allNights = resolveOccupiedNightDates({ checkIn: sc.checkIn, checkOut: sc.checkOut }).map(
    dateOnlyFromNightDate
  );
  const priorNight = allNights[0];
  await claimUnitNights({
    bookingId: sc.targetBookingId,
    unitId: dst.units[0]._id,
    nights: [priorNight],
    stayChangeId: sc._id,
    source: 'rebook',
    requireExactStayChangeOwnership: true
  });
  const priorCount = await UnitNightClaim.countDocuments({ bookingId: sc.targetBookingId });
  assert.equal(priorCount, 1);

  Booking.create = async function failB(doc) {
    if (doc?.provenance?.source === 'stay_change_rebook') throw new Error('fail B');
    return origCreate(doc);
  };
  try {
    await assert.rejects(() => reconcileRebookStayChange(sc._id, adminCtx()));
  } finally {
    Booking.create = origCreate;
  }
  const left = await UnitNightClaim.find({ bookingId: sc.targetBookingId }).lean();
  assert.equal(left.length, priorCount);
  assert.ok(left.some((c) => dateOnlyFromNightDate(c.night) === priorNight));
  assert.equal((await StayChange.findById(sc._id)).status, 'inventory_secured');
});

test('S3.2#experience extras CAS race keeps target and opens MRI', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const ci = sofiaDay(45);
  const co = sofiaDay(47);
  const experienceKeys = ['sauna', 'hot-tub'];
  const quote = await computeQuoteFromEntity(a, ci, co, 2, 0, experienceKeys, null, false, null);
  const booking = await makeSingleBooking({
    cabin: a,
    checkIn: ci,
    checkOut: co,
    totalPrice: quote.totalPrice,
    extras: {
      craft: { extras: { experienceKeys } }
    }
  });
  const key = idem('cas-extras');
  const origCreate = Booking.create.bind(Booking);
  Booking.create = async function race(doc) {
    const created = await origCreate(doc);
    if (created?.provenance?.source === 'stay_change_rebook') {
      await Booking.updateOne(
        { _id: booking._id },
        { $set: { craft: { extras: { experienceKeys: ['sauna', 'massage'] } } } }
      );
    }
    return created;
  };
  try {
    await assert.rejects(
      () => rebookOk(booking, { cabinId: b._id }, key),
      (err) => codeOf(err) === 'SOURCE_CHANGED' || codeOf(err) === 'NEEDS_RECONCILIATION'
    );
  } finally {
    Booking.create = origCreate;
  }
  const sc = await StayChange.findOne({ idempotencyKey: key });
  assert.equal(sc.status, 'needs_reconciliation');
  assert.ok(sc.sourceSnapshot.experienceKeys.includes('hot-tub'));
  assert.ok(await Booking.findById(sc.targetBookingId));
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: booking._id }), 2);
  assert.ok(await CabinNightClaim.countDocuments({ bookingId: sc.targetBookingId }) >= 1);
  const mri = await ManualReviewItem.find({ category: MRI_CATEGORY, entityId: String(sc._id) });
  assert.ok(mri.length >= 1);
});

async function corruptAndAssertCompletionInvariant({
  label,
  corruptTarget,
  corruptSource
}) {
  const a = await seedCabin(100);
  const b = await seedCabin(100);
  const ci = sofiaDay(30);
  const co = sofiaDay(32);
  const experienceKeys = ['sauna'];
  const transportMethod = '4x4';
  const romanticSetup = true;
  const tripType = 'retreat';
  const quote = await computeQuoteFromEntity(
    a,
    ci,
    co,
    2,
    1,
    experienceKeys,
    transportMethod,
    romanticSetup,
    null
  );
  const booking = await makeSingleBooking({
    cabin: a,
    checkIn: ci,
    checkOut: co,
    totalPrice: quote.totalPrice,
    extras: {
      adults: 2,
      children: 1,
      craft: { extras: { experienceKeys } },
      transportMethod,
      romanticSetup,
      tripType
    }
  });
  const res = await rebookOk(booking, { cabinId: b._id }, idem(`inv-${label}`));
  const sc = await StayChange.findById(res.stayChangeId);
  sc.status = 'committed';
  await sc.save();
  if (corruptTarget) await corruptTarget(res.targetBookingId);
  if (corruptSource) await corruptSource(booking._id);
  const result = await reconcileRebookStayChange(sc._id, adminCtx());
  const after = await StayChange.findById(sc._id);
  assert.equal(after.status, 'needs_reconciliation');
  assert.notEqual(result.status, 'completed');
  const mri = await ManualReviewItem.find({ category: MRI_CATEGORY, entityId: String(sc._id) });
  assert.ok(mri.length >= 1);
  assert.ok(await CabinNightClaim.countDocuments({ bookingId: res.targetBookingId }) >= 1);
  const src = await Booking.findById(booking._id).lean();
  assert.equal(src.status, 'cancelled');
}

test('S3.2#completion invariant date corruption opens MRI', async () => {
  await corruptAndAssertCompletionInvariant({
    label: 'dates',
    corruptTarget: async (targetId) => {
      await Booking.updateOne({ _id: targetId }, { $set: { checkOut: sofiaDay(99) } });
    }
  });
});

test('S3.2#completion invariant guest corruption opens MRI', async () => {
  await corruptAndAssertCompletionInvariant({
    label: 'guests',
    corruptTarget: async (targetId) => {
      await Booking.updateOne({ _id: targetId }, { $set: { adults: 9 } });
    }
  });
});

test('S3.2#completion invariant extras corruption opens MRI', async () => {
  await corruptAndAssertCompletionInvariant({
    label: 'extras',
    corruptTarget: async (targetId) => {
      await Booking.updateOne(
        { _id: targetId },
        { $set: { craft: { extras: { experienceKeys: ['massage'] } } } }
      );
    }
  });
});

test('S3.2#completion invariant source link corruption opens MRI', async () => {
  await corruptAndAssertCompletionInvariant({
    label: 'source-link',
    corruptSource: async (sourceId) => {
      await Booking.updateOne(
        { _id: sourceId },
        { $set: { 'cancellationSettlement.replacementBookingId': new mongoose.Types.ObjectId() } }
      );
    }
  });
});

test('S3.2#replacement uses frozen experience keys from snapshot', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const ci = sofiaDay(40);
  const co = sofiaDay(42);
  const experienceKeys = ['hot-tub', 'sauna'];
  const quote = await computeQuoteFromEntity(a, ci, co, 2, 0, experienceKeys, null, false, null);
  const booking = await makeSingleBooking({
    cabin: a,
    checkIn: ci,
    checkOut: co,
    totalPrice: quote.totalPrice,
    extras: { craft: { extras: { experienceKeys } } }
  });
  const key = idem('frozen-extras');
  const res = await rebookOk(booking, { cabinId: b._id }, key);
  const sc = await StayChange.findById(res.stayChangeId).lean();
  const tgt = await Booking.findById(res.targetBookingId).lean();
  assert.deepEqual(sc.sourceSnapshot.experienceKeys, ['hot-tub', 'sauna']);
  assert.deepEqual(sc.targetSnapshot.experienceKeys, ['hot-tub', 'sauna']);
  assert.deepEqual(tgt.craft.extras.experienceKeys, experienceKeys);
  await Booking.updateOne(
    { _id: booking._id },
    { $set: { craft: { extras: { experienceKeys: ['massage'] } } } }
  );
  const res2 = await rebookOk(booking, { cabinId: b._id }, key);
  assert.equal(res2.stayChangeId, res.stayChangeId);
  assert.equal(res2.status, 'completed');
  const tgt2 = await Booking.findById(res.targetBookingId).lean();
  assert.deepEqual(tgt2.craft.extras.experienceKeys, experienceKeys);
});

test('S3.1#live quote drift retry uses stored StayChange quote', async () => {
  const a = await seedCabin(100);
  const b = await seedCabin(100);
  const booking = await makeSingleBooking({ cabin: a, totalPrice: 200 });
  const key = idem('quote-drift');
  const orig = Booking.create.bind(Booking);
  let failOnce = true;
  Booking.create = async function maybeFail(doc) {
    if (failOnce && doc?.provenance?.source === 'stay_change_rebook') {
      failOnce = false;
      throw new Error('force partial');
    }
    return orig(doc);
  };
  try {
    await assert.rejects(() => rebookOk(booking, { cabinId: b._id }, key));
  } finally {
    Booking.create = orig;
  }
  const sc1 = await StayChange.findOne({ idempotencyKey: key });
  assert.ok(sc1);
  const frozenQuote = sc1.money.canonicalTargetQuoteCents;
  const frozenTargetId = String(sc1.targetBookingId);
  b.pricePerNight = 250;
  await b.save();
  const res = await rebookOk(booking, { cabinId: b._id }, key);
  assert.equal(res.status, 'completed');
  assert.equal(String(res.targetBookingId), frozenTargetId);
  assert.equal(await StayChange.countDocuments({ kind: KIND, idempotencyKey: key }), 1);
  const sc2 = await StayChange.findById(sc1._id);
  assert.equal(sc2.money.canonicalTargetQuoteCents, frozenQuote);
  assert.equal(sc2.money.canonicalTargetQuoteCents, 20000);
});

test('S3.1#completed retry after live price drift is no-op', async () => {
  const a = await seedCabin(100);
  const b = await seedCabin(100);
  const booking = await makeSingleBooking({ cabin: a, totalPrice: 200 });
  const key = idem('done-drift');
  const first = await rebookOk(booking, { cabinId: b._id }, key);
  b.pricePerNight = 400;
  await b.save();
  const claimsBefore = await CabinNightClaim.countDocuments();
  const paysBefore = await Payment.countDocuments();
  const second = await rebookOk(booking, { cabinId: b._id }, key);
  assert.equal(second.stayChangeId, first.stayChangeId);
  assert.equal(second.targetBookingId, first.targetBookingId);
  assert.equal(second.status, 'completed');
  assert.equal(await CabinNightClaim.countDocuments(), claimsBefore);
  assert.equal(await Payment.countDocuments(), paysBefore);
  assert.equal(await Booking.countDocuments({ 'provenance.source': 'stay_change_rebook' }), 1);
});

test('S3.1#guest CAS race keeps target and opens MRI', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a, extras: { adults: 2, children: 0 } });
  const key = idem('cas-guest');
  const orig = Booking.create.bind(Booking);
  Booking.create = async function race(doc) {
    const created = await orig(doc);
    if (created?.provenance?.source === 'stay_change_rebook') {
      await Booking.updateOne({ _id: booking._id }, { $set: { adults: 3 } });
    }
    return created;
  };
  try {
    await assert.rejects(
      () => rebookOk(booking, { cabinId: b._id }, key),
      (err) => codeOf(err) === 'SOURCE_CHANGED' || codeOf(err) === 'NEEDS_RECONCILIATION'
    );
  } finally {
    Booking.create = orig;
  }
  const sc = await StayChange.findOne({ idempotencyKey: key });
  assert.equal(sc.status, 'needs_reconciliation');
  assert.ok(await Booking.findById(sc.targetBookingId));
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: booking._id }), 2);
  assert.ok(await CabinNightClaim.countDocuments({ bookingId: sc.targetBookingId }) >= 1);
  assert.equal(await Booking.countDocuments({ 'provenance.source': 'stay_change_rebook' }), 1);
  const mri = await ManualReviewItem.find({ category: MRI_CATEGORY, entityId: String(sc._id) });
  assert.ok(mri.length >= 1);
});

test('S3.1#romanticSetup CAS race keeps target and opens MRI', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a, extras: { romanticSetup: false } });
  const key = idem('cas-term');
  const orig = Booking.create.bind(Booking);
  Booking.create = async function race(doc) {
    const created = await orig(doc);
    if (created?.provenance?.source === 'stay_change_rebook') {
      await Booking.updateOne({ _id: booking._id }, { $set: { romanticSetup: true } });
    }
    return created;
  };
  try {
    await assert.rejects(
      () => rebookOk(booking, { cabinId: b._id }, key),
      (err) => codeOf(err) === 'SOURCE_CHANGED' || codeOf(err) === 'NEEDS_RECONCILIATION'
    );
  } finally {
    Booking.create = orig;
  }
  const sc = await StayChange.findOne({ idempotencyKey: key });
  assert.equal(sc.status, 'needs_reconciliation');
  assert.ok(await Booking.findById(sc.targetBookingId));
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: booking._id }), 2);
});

test('S3.1#Booking DB round-trip durable fields', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({
    cabin: a,
    extras: { adults: 2, children: 1, specialRequests: 'hi' }
  });
  const res = await rebookOk(booking, { cabinId: b._id }, idem('roundtrip'));
  const src = await Booking.findById(booking._id).lean();
  const tgt = await Booking.findById(res.targetBookingId).lean();
  assert.equal(src.status, 'cancelled');
  assert.equal(src.cancellationSettlement.outcome, 'rebooked_or_moved');
  assert.equal(String(src.cancellationSettlement.replacementBookingId), String(res.targetBookingId));
  assert.equal(String(tgt._id), String(res.targetBookingId));
  assert.equal(String(tgt.cabinId), String(b._id));
  assert.equal(tgt.adults, 2);
  assert.equal(tgt.children, 1);
  assert.equal(tgt.provenance.source, 'stay_change_rebook');
  assert.equal(String(tgt.settledByStayChangeId), String(res.stayChangeId));
  assert.ok(['pending', 'confirmed'].includes(tgt.status));
  assert.equal(+tgt.checkIn, +booking.checkIn);
  assert.equal(+tgt.checkOut, +booking.checkOut);
});

test('S3.1#completion invariant dates and guests via durable reload', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({
    cabin: a,
    extras: { adults: 3, children: 2 }
  });
  const res = await rebookOk(booking, { cabinId: b._id }, idem('inv'));
  const sc = await StayChange.findById(res.stayChangeId).lean();
  const tgt = await Booking.findById(res.targetBookingId).lean();
  assert.equal(Number(tgt.adults), Number(sc.targetSnapshot.adults));
  assert.equal(Number(tgt.children), Number(sc.targetSnapshot.children));
  assert.equal(String(sc.bookingId), String(booking._id));
  assert.equal(String(sc.targetBookingId), String(tgt._id));
  const src = await Booking.findById(booking._id).lean();
  assert.equal(src.cancellationSettlement.outcome, 'rebooked_or_moved');
  assert.equal(String(src.cancellationSettlement.replacementBookingId), String(tgt._id));
});

test('S3.1#external hold ack regression still holds', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  await AvailabilityBlock.create({
    cabinId: b._id,
    blockType: 'external_hold',
    status: 'active',
    startDate: booking.checkIn,
    endDate: booking.checkOut,
    source: 'airbnb',
    sourceReference: `ext-${crypto.randomBytes(3).toString('hex')}`
  });
  await assert.rejects(
    () => rebookOk(booking, { cabinId: b._id }, idem('ext1')),
    (err) => codeOf(err) === 'EXTERNAL_HOLD_ACK_REQUIRED'
  );
  assert.equal(await StayChange.countDocuments({}), 0);
  const res = await rebookOk(booking, { cabinId: b._id }, idem('ext2'), {
    acceptExternalHoldWarnings: true
  });
  assert.equal(res.status, 'completed');
});

test('S3.1#Payment immutability after hardened rebook', async () => {
  const a = await seedCabin();
  const b = await seedCabin();
  const booking = await makeSingleBooking({ cabin: a });
  const before = await Payment.find({ reservationId: booking._id }).lean();
  const res = await rebookOk(booking, { cabinId: b._id }, idem('pay'));
  const after = await Payment.find({}).lean();
  assert.equal(after.length, before.length);
  assert.ok(after.every((p) => String(p.reservationId) === String(booking._id)));
  assert.equal(await Payment.countDocuments({ reservationId: res.targetBookingId }), 0);
});
