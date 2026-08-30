'use strict';

/**
 * Stone House pricing cutover patch — safety contract tests.
 * Run: node --test server/scripts/patchStoneHousePricing.test.cjs
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const CheckoutSession = require('../models/CheckoutSession');
const CabinNightClaim = require('../models/CabinNightClaim');
const UnitNightClaim = require('../models/UnitNightClaim');

const {
  LEGACY_STATE,
  DESIRED_STATE,
  EXIT,
  parseArgs,
  classifyStoneHousePricingState,
  extractPricingState,
  verifyDesiredState,
  runStoneHousePricingPatch
} = require('./patchStoneHousePricingCore');

let mongoServer;

const CABIN_BASE = {
  description: 'Stone House test fixture',
  imageUrl: '/uploads/cabins/test.jpg',
  location: 'The Valley',
  propertyKind: 'valley',
  minNights: 2,
  bedConfig: [{ bedType: 'double', count: 2 }],
  isActive: true,
  transportOptions: []
};

async function createLegacyStoneHouse(overrides = {}) {
  return Cabin.create({
    name: 'Stone House',
    slug: 'stone-house',
    capacity: LEGACY_STATE.capacity,
    minGuests: LEGACY_STATE.minGuests,
    pricePerNight: LEGACY_STATE.pricePerNight,
    pricingModel: LEGACY_STATE.pricingModel,
    ...CABIN_BASE,
    ...overrides
  });
}

async function createDesiredStoneHouse(overrides = {}) {
  return Cabin.create({
    name: 'Stone House',
    slug: 'stone-house',
    capacity: DESIRED_STATE.capacity,
    minGuests: DESIRED_STATE.minGuests,
    pricePerNight: DESIRED_STATE.pricePerNight,
    pricingModel: DESIRED_STATE.pricingModel,
    includedGuests: DESIRED_STATE.includedGuests,
    extraGuestPricePerNight: DESIRED_STATE.extraGuestPricePerNight,
    ...CABIN_BASE,
    ...overrides
  });
}

async function createOtherCabin() {
  return Cabin.create({
    name: 'Lux Cabin',
    slug: `lux-${new mongoose.Types.ObjectId()}`,
    description: 'Other cabin',
    capacity: 2,
    minGuests: 1,
    pricePerNight: 85,
    pricingModel: 'per_night',
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'The Valley',
    propertyKind: 'valley',
    minNights: 2,
    isActive: true,
    transportOptions: []
  });
}

async function seedGuardDocuments(cabinId) {
  const checkIn = new Date('2030-10-01T00:00:00.000Z');
  const checkOut = new Date('2030-10-03T00:00:00.000Z');
  const booking = await Booking.create({
    cabinId,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    totalPrice: 200,
    status: 'confirmed',
    guestInfo: {
      firstName: 'Guard',
      lastName: 'Test',
      email: 'guard@example.com',
      phone: '+359800000001'
    }
  });

  const payment = await Payment.create({
    reservationId: booking._id,
    provider: 'stripe',
    providerReference: `pi_guard_${booking._id}`,
    status: 'paid',
    amount: 200,
    currency: 'eur'
  });

  const session = await CheckoutSession.create({
    checkoutId: `chk_guard_${new mongoose.Types.ObjectId()}`,
    flowVersion: 'v2',
    status: 'draft',
    paymentStatus: 'unpaid',
    finalizeStatus: 'open',
    quoteSnapshot: { totalCents: 20000 }
  });

  const cabinClaim = await CabinNightClaim.create({
    cabinId,
    night: checkIn,
    bookingId: booking._id,
    source: 'test'
  });

  const unitClaim = await UnitNightClaim.create({
    unitId: new mongoose.Types.ObjectId(),
    night: checkIn,
    bookingId: booking._id,
    source: 'test'
  });

  const cabinType = await CabinType.create({
    name: 'A-Frame Guard',
    slug: `a-frame-guard-${new mongoose.Types.ObjectId()}`,
    description: 'Guard type',
    capacity: 2,
    pricePerNight: 60,
    pricingModel: 'per_night',
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'The Valley'
  });

  return { booking, payment, session, cabinClaim, unitClaim, cabinType };
}

async function snapshotGuardDocs(ids) {
  const [booking, payment, session, cabinClaim, unitClaim, cabinType] = await Promise.all([
    Booking.findById(ids.booking._id).lean(),
    Payment.findById(ids.payment._id).lean(),
    CheckoutSession.findById(ids.session._id).lean(),
    CabinNightClaim.findById(ids.cabinClaim._id).lean(),
    UnitNightClaim.findById(ids.unitClaim._id).lean(),
    CabinType.findById(ids.cabinType._id).lean()
  ]);
  return { booking, payment, session, cabinClaim, unitClaim, cabinType };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    Cabin.deleteMany({}),
    CabinType.deleteMany({}),
    Booking.deleteMany({}),
    Payment.deleteMany({}),
    CheckoutSession.deleteMany({}),
    CabinNightClaim.deleteMany({}),
    UnitNightClaim.deleteMany({})
  ]);
});

test('1. default invocation (apply=false) is read-only', async () => {
  const stone = await createLegacyStoneHouse();
  const before = extractPricingState(stone.toObject());
  const result = await runStoneHousePricingPatch({ Cabin, apply: false });
  assert.equal(result.exitCode, EXIT.OK);
  assert.equal(result.report.mode, 'dry-run');
  assert.equal(result.report.writes, 0);
  const after = extractPricingState(await Cabin.findById(stone._id).lean());
  assert.deepEqual(after, before);
});

test('2. --dry-run parse flag is read-only', async () => {
  const parsed = parseArgs(['--dry-run']);
  assert.equal(parsed.apply, false);
  const stone = await createLegacyStoneHouse();
  const result = await runStoneHousePricingPatch({ Cabin, apply: parsed.apply });
  assert.equal(result.report.writes, 0);
  assert.equal(extractPricingState(await Cabin.findById(stone._id).lean()).pricingModel, 'per_person');
});

test('3. legacy exact classification', () => {
  assert.equal(classifyStoneHousePricingState({ ...LEGACY_STATE }), 'LEGACY_EXACT');
});

test('4. already desired classification', () => {
  assert.equal(classifyStoneHousePricingState({ ...DESIRED_STATE }), 'ALREADY_DESIRED');
});

test('5. unexpected partial state classification', () => {
  assert.equal(
    classifyStoneHousePricingState({
      pricePerNight: 75,
      pricingModel: 'per_person',
      minGuests: 3,
      capacity: 6,
      includedGuests: null,
      extraGuestPricePerNight: null
    }),
    'UNEXPECTED_STATE'
  );
  assert.equal(
    classifyStoneHousePricingState({
      pricePerNight: 25,
      pricingModel: 'per_person',
      minGuests: 1,
      capacity: 6,
      includedGuests: null,
      extraGuestPricePerNight: null
    }),
    'UNEXPECTED_STATE'
  );
  assert.equal(
    classifyStoneHousePricingState({
      pricePerNight: 25,
      pricingModel: 'per_person',
      minGuests: 3,
      capacity: 6,
      includedGuests: 3,
      extraGuestPricePerNight: null
    }),
    'UNEXPECTED_STATE'
  );
});

test('6. zero Stone House matches refuses', async () => {
  await createOtherCabin();
  const result = await runStoneHousePricingPatch({ Cabin, apply: false });
  assert.equal(result.exitCode, EXIT.REFUSED);
  assert.equal(result.report.refusalReason, 'zero_matches');
  assert.equal(result.report.targetCount, 0);
});

test('7. multiple matches refuses', async () => {
  const legacyNoSlug = {
    name: 'Stone House',
    capacity: LEGACY_STATE.capacity,
    minGuests: LEGACY_STATE.minGuests,
    pricePerNight: LEGACY_STATE.pricePerNight,
    pricingModel: LEGACY_STATE.pricingModel,
    ...CABIN_BASE
  };
  await Cabin.create(legacyNoSlug);
  await Cabin.create(legacyNoSlug);

  const result = await runStoneHousePricingPatch({ Cabin, apply: false });
  assert.equal(result.exitCode, EXIT.REFUSED);
  assert.equal(result.report.refusalReason, 'multiple_matches');
  assert.ok(result.report.targetCount > 1);
  assert.equal(result.report.matchStrategy, 'name');
});

test('8. --apply without production guard refuses in production', async () => {
  await createLegacyStoneHouse();
  const result = await runStoneHousePricingPatch({
    Cabin,
    apply: true,
    nodeEnv: 'production',
    productionAllowEnv: undefined
  });
  assert.equal(result.exitCode, EXIT.REFUSED);
  assert.equal(result.report.refusalReason, 'production_apply_without_allow_env');
  assert.equal(extractPricingState(await Cabin.findOne({ slug: 'stone-house' }).lean()).pricingModel, 'per_person');
});

test('9. production guard alone without --apply remains read-only', async () => {
  await createLegacyStoneHouse();
  const result = await runStoneHousePricingPatch({
    Cabin,
    apply: false,
    nodeEnv: 'production',
    productionAllowEnv: '1'
  });
  assert.equal(result.exitCode, EXIT.OK);
  assert.equal(result.report.writes, 0);
  assert.equal(extractPricingState(await Cabin.findOne({ slug: 'stone-house' }).lean()).pricePerNight, 25);
});

test('10. --apply + guard changes exact legacy state', async () => {
  const stone = await createLegacyStoneHouse();
  const result = await runStoneHousePricingPatch({
    Cabin,
    apply: true,
    nodeEnv: 'production',
    productionAllowEnv: '1'
  });
  assert.equal(result.exitCode, EXIT.OK);
  assert.equal(result.report.outcome, 'applied');
  assert.equal(result.report.writes, 1);
  assert.deepEqual(extractPricingState(await Cabin.findById(stone._id).lean()), DESIRED_STATE);
});

test('11. only intended pricing fields change', async () => {
  const stone = await createLegacyStoneHouse({
    buyoutPricePerNight: 180,
    cleaningTags: ['stone-house'],
    description: 'Keep me'
  });
  const before = await Cabin.findById(stone._id).lean();
  await runStoneHousePricingPatch({ Cabin, apply: true });
  const after = await Cabin.findById(stone._id).lean();
  assert.equal(after.description, before.description);
  assert.equal(after.buyoutPricePerNight, before.buyoutPricePerNight);
  assert.deepEqual(after.cleaningTags, before.cleaningTags);
  assert.equal(after.slug, before.slug);
  assert.equal(after.name, before.name);
  assert.deepEqual(extractPricingState(after), DESIRED_STATE);
});

test('12. no Booking mutation', async () => {
  const stone = await createLegacyStoneHouse();
  const guards = await seedGuardDocuments(stone._id);
  const before = await snapshotGuardDocs(guards);
  await runStoneHousePricingPatch({ Cabin, apply: true });
  const after = await snapshotGuardDocs(guards);
  assert.deepEqual(after.booking, before.booking);
});

test('13. no Payment mutation', async () => {
  const stone = await createLegacyStoneHouse();
  const guards = await seedGuardDocuments(stone._id);
  const before = await snapshotGuardDocs(guards);
  await runStoneHousePricingPatch({ Cabin, apply: true });
  const after = await snapshotGuardDocs(guards);
  assert.deepEqual(after.payment, before.payment);
});

test('14. no CheckoutSession mutation', async () => {
  const stone = await createLegacyStoneHouse();
  const guards = await seedGuardDocuments(stone._id);
  const before = await snapshotGuardDocs(guards);
  await runStoneHousePricingPatch({ Cabin, apply: true });
  const after = await snapshotGuardDocs(guards);
  assert.deepEqual(after.session, before.session);
});

test('15. no inventory claim mutation', async () => {
  const stone = await createLegacyStoneHouse();
  const guards = await seedGuardDocuments(stone._id);
  const before = await snapshotGuardDocs(guards);
  await runStoneHousePricingPatch({ Cabin, apply: true });
  const after = await snapshotGuardDocs(guards);
  assert.deepEqual(after.cabinClaim, before.cabinClaim);
  assert.deepEqual(after.unitClaim, before.unitClaim);
});

test('16. CAS mismatch refuses', async () => {
  const stone = await createLegacyStoneHouse();
  const originalUpdateOne = Cabin.updateOne.bind(Cabin);
  Cabin.updateOne = async () => ({ acknowledged: true, matchedCount: 0, modifiedCount: 0 });
  try {
    const result = await runStoneHousePricingPatch({ Cabin, apply: true });
    assert.equal(result.exitCode, EXIT.REFUSED);
    assert.equal(result.report.refusalReason, 'cas_mismatch');
    assert.equal(extractPricingState(await Cabin.findById(stone._id).lean()).pricingModel, 'per_person');
  } finally {
    Cabin.updateOne = originalUpdateOne;
  }
});

test('17. concurrent already-desired result becomes safe no-op', async () => {
  await createDesiredStoneHouse();
  const result = await runStoneHousePricingPatch({ Cabin, apply: true });
  assert.equal(result.exitCode, EXIT.OK);
  assert.equal(result.report.outcome, 'already_desired_noop');
  assert.equal(result.report.writes, 0);
});

test('18. post-write verification success', async () => {
  await createLegacyStoneHouse();
  const result = await runStoneHousePricingPatch({ Cabin, apply: true });
  assert.equal(result.exitCode, EXIT.OK);
  assert.deepEqual(result.report.verifiedState, DESIRED_STATE);
});

test('19. post-write verification mismatch produces failure', () => {
  const bad = verifyDesiredState({
    slug: 'stone-house',
    pricePerNight: 75,
    pricingModel: 'base_plus_extra',
    minGuests: 1,
    capacity: 6,
    includedGuests: 2,
    extraGuestPricePerNight: 25
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'post_write_verification_failed');
});

test('20. second apply is idempotent no-op', async () => {
  await createLegacyStoneHouse();
  const first = await runStoneHousePricingPatch({ Cabin, apply: true });
  assert.equal(first.report.outcome, 'applied');
  const second = await runStoneHousePricingPatch({ Cabin, apply: true });
  assert.equal(second.exitCode, EXIT.OK);
  assert.equal(second.report.outcome, 'already_desired_noop');
  assert.equal(second.report.writes, 0);
});

test('21. unrelated Cabin unchanged', async () => {
  const stone = await createLegacyStoneHouse();
  const other = await createOtherCabin();
  const otherBefore = extractPricingState(await Cabin.findById(other._id).lean());
  await runStoneHousePricingPatch({ Cabin, apply: true });
  assert.deepEqual(extractPricingState(await Cabin.findById(other._id).lean()), otherBefore);
  assert.deepEqual(extractPricingState(await Cabin.findById(stone._id).lean()), DESIRED_STATE);
});

test('22. no CabinType mutation', async () => {
  const stone = await createLegacyStoneHouse();
  const guards = await seedGuardDocuments(stone._id);
  const before = await snapshotGuardDocs(guards);
  await runStoneHousePricingPatch({ Cabin, apply: true });
  const after = await snapshotGuardDocs(guards);
  assert.deepEqual(after.cabinType, before.cabinType);
});

test('23. slug not changed (pricing-only patch)', async () => {
  const stone = await createLegacyStoneHouse({ slug: 'stone-house' });
  await runStoneHousePricingPatch({ Cabin, apply: true });
  const doc = await Cabin.findById(stone._id).lean();
  assert.equal(doc.slug, 'stone-house');
});

test('parseArgs rejects --apply with --dry-run', () => {
  const parsed = parseArgs(['--apply', '--dry-run']);
  assert.ok(parsed.error);
});

test('apply refuses UNEXPECTED_STATE without writes', async () => {
  await createLegacyStoneHouse({ pricePerNight: 75, pricingModel: 'per_person' });
  const result = await runStoneHousePricingPatch({ Cabin, apply: true });
  assert.equal(result.exitCode, EXIT.REFUSED);
  assert.equal(result.report.refusalReason, 'unexpected_state');
  assert.equal(result.report.writes, 0);
});

test('CAS race to already-desired after legacy preflight', async () => {
  const stone = await createLegacyStoneHouse();
  const originalUpdateOne = Cabin.updateOne.bind(Cabin);
  Cabin.updateOne = async (filter, update) => {
    await originalUpdateOne(
      { _id: stone._id },
      {
        $set: {
          pricePerNight: 75,
          pricingModel: 'base_plus_extra',
          minGuests: 1,
          includedGuests: 3,
          extraGuestPricePerNight: 25
        }
      }
    );
    return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
  };
  try {
    const result = await runStoneHousePricingPatch({ Cabin, apply: true });
    assert.equal(result.exitCode, EXIT.OK);
    assert.equal(result.report.outcome, 'concurrent_already_desired_noop');
  } finally {
    Cabin.updateOne = originalUpdateOne;
  }
});
