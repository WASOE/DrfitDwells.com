'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');

const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const Booking = require('../models/Booking');
const Guest = require('../models/Guest');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const UnitNightClaim = require('../models/UnitNightClaim');
const AuditEvent = require('../models/AuditEvent');
const ReservationNote = require('../models/ReservationNote');
const ManualReviewItem = require('../models/ManualReviewItem');
const { createBlock, editBlock } = require('../services/ops/domain/availabilityWriteService');
const { createManualReservation, editReservationDates } = require('../services/ops/domain/reservationWriteService');
const { clearAllRememberedResults } = require('../services/idempotencyService');
const {
  convertManualBlockToReservation
} = require('../services/ops/domain/manualBlockConversionService');
const {
  INDEX_NAME,
  INDEX_KEY,
  INDEX_PARTIAL_FILTER
} = require('../services/ops/domain/manualBlockConversionIndexService');
const { reconcileManualBlockConversions } = require('../services/ops/domain/manualBlockConversionReconciliationService');
const availabilityActionsRoutes = require('../routes/ops/modules/availabilityActionsRoutes');
const { getCalendarReadModel } = require('../services/ops/readModels/calendarReadModel');
const { getCleaningSchedule } = require('../services/ops/readModels/cleaningReadModel');
const { getDashboardReadModel } = require('../services/ops/readModels/dashboardReadModel');
const { normalizeGuestStayRange } = require('../services/publicAvailabilityService');

let mongoServer;

function stayRange(offset = 30) {
  const start = moment.tz('Europe/Sofia').startOf('day').add(offset, 'days');
  const end = start.clone().add(2, 'days');
  return {
    checkIn: start.format('YYYY-MM-DD'),
    checkOut: end.format('YYYY-MM-DD')
  };
}

function guestInfo() {
  return {
    firstName: 'Guest',
    lastName: 'Conversion',
    email: `guest-${new mongoose.Types.ObjectId()}@example.com`,
    phone: '+359888123456'
  };
}

async function createSingleCabin() {
  return Cabin.create({
    name: `Conversion cabin ${new mongoose.Types.ObjectId()}`,
    description: 'Manual block conversion test',
    capacity: 4,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'The Cabin',
    propertyKind: 'cabin',
    isActive: true,
    transportOptions: []
  });
}

async function createMultiCabin() {
  const suffix = new mongoose.Types.ObjectId().toString().slice(-6);
  const cabinType = await CabinType.create({
    name: `Conversion A-frame ${suffix}`,
    slug: `conversion-a-frame-${suffix}`,
    description: 'Manual conversion test type',
    capacity: 2,
    pricePerNight: 60,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'The Valley',
    propertyKind: 'valley',
    isActive: true,
    transportOptions: []
  });
  const cabin = await Cabin.create({
    name: `Conversion parent ${suffix}`,
    description: 'Manual conversion test parent',
    capacity: 2,
    pricePerNight: 60,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'The Valley',
    propertyKind: 'valley',
    inventoryType: 'multi',
    cabinTypeRef: cabinType._id,
    isActive: true,
    transportOptions: []
  });
  const units = await Unit.create([
    { cabinTypeId: cabinType._id, unitNumber: `AF-${suffix}-1`, isActive: true },
    { cabinTypeId: cabinType._id, unitNumber: `AF-${suffix}-2`, isActive: true }
  ]);
  return { cabin, cabinType, units };
}

async function createManualBlock(cabinId, range, { unitId = null, targetScope = 'single_cabin' } = {}) {
  return createBlock({
    blockType: 'manual_block',
    cabinId,
    unitId,
    targetScope,
    startDate: range.checkIn,
    endDate: range.checkOut,
    manualBlockPurpose: 'owner_hold',
    operatorNote: 'conversion regression fixture',
    reason: null,
    ctx: { user: { id: 'conversion-test', role: 'admin' }, route: 'test' }
  });
}

async function convert(blockId, range, overrides = {}) {
  return convertManualBlockToReservation({
    blockId,
    guestInfo: guestInfo(),
    adults: 2,
    children: 0,
    manualReservationPurpose: 'friends_family',
    initialStatus: 'pending',
    ...overrides,
    ctx: { user: { id: 'conversion-test', role: 'admin' }, route: 'test' }
  });
}

function availabilityApp(role = 'admin') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'conversion-route-test', role };
    next();
  });
  app.use('/api/ops/availability', availabilityActionsRoutes);
  return app;
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([
    Booking.syncIndexes(),
    AvailabilityBlock.syncIndexes(),
    UnitNightClaim.syncIndexes(),
    AuditEvent.syncIndexes(),
    ReservationNote.syncIndexes(),
    ManualReviewItem.syncIndexes()
  ]);
  const { keys, options } = AuditEvent.AUDIT_DEDUPE_INDEX_SPEC;
  await AuditEvent.collection.createIndex(keys, options);
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  clearAllRememberedResults();
  await Promise.all([
    Cabin.deleteMany({}),
    CabinType.deleteMany({}),
    Unit.deleteMany({}),
    Booking.deleteMany({}),
    AvailabilityBlock.deleteMany({}),
    UnitNightClaim.deleteMany({}),
    AuditEvent.collection.deleteMany({}),
    ReservationNote.deleteMany({}),
    ManualReviewItem.deleteMany({})
  ]);
});

test('converts a single-cabin manual block into one zero-price canonical Booking and replays idempotently', async () => {
  const cabin = await createSingleCabin();
  const range = stayRange();
  const block = await createManualBlock(cabin._id, range);

  const created = await convert(block.blockId, range);
  const booking = await Booking.findById(created.reservationId).lean();
  const savedBlock = await AvailabilityBlock.findById(block.blockId).lean();

  assert.equal(booking.status, 'pending');
  assert.equal(booking.totalPrice, 0);
  assert.equal(booking.sendGuestConfirmationEmail, false);
  assert.equal(booking.provenance.convertedFromAvailabilityBlockId.toString(), block.blockId);
  assert.equal(booking.provenance.conversionHooks.status, 'completed');
  assert.equal(booking.provenance.conversionHooks.attemptCount, 1);
  assert.equal(booking.provenance.conversionHooks.completedSteps.length, 7);
  assert.equal(savedBlock.status, 'tombstoned');
  assert.equal(savedBlock.reservationId.toString(), created.reservationId);
  assert.equal(savedBlock.metadata.conversionReservationId, created.reservationId);

  const replay = await convert(block.blockId, range);
  assert.equal(replay.reservationId, created.reservationId);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(await Booking.countDocuments({ 'provenance.convertedFromAvailabilityBlockId': block.blockId }), 1);
  const afterReplay = await Booking.findById(created.reservationId).lean();
  assert.equal(afterReplay.provenance.conversionHooks.status, 'completed');
  assert.deepEqual(
    afterReplay.provenance.conversionHooks.completedSteps,
    booking.provenance.conversionHooks.completedSteps
  );
});

test('conversion route returns the canonical reservation and tombstones its source block', async () => {
  const cabin = await createSingleCabin();
  const range = stayRange(36);
  const block = await createManualBlock(cabin._id, range);
  const response = await request(availabilityApp())
    .post(`/api/ops/availability/manual-blocks/${block.blockId}/convert`)
    .send({
      guestInfo: guestInfo(),
      manualReservationPurpose: 'friends_family',
      initialStatus: 'pending'
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  const booking = await Booking.findById(response.body.data.reservationId).lean();
  assert.equal(booking.totalPrice, 0);
  assert.equal(booking.sendGuestConfirmationEmail, false);
  assert.equal((await AvailabilityBlock.findById(block.blockId).lean()).status, 'tombstoned');
});

test('conversion route preserves the source block when caller lacks permissions', async () => {
  const cabin = await createSingleCabin();
  const range = stayRange(37);
  const block = await createManualBlock(cabin._id, range);
  const response = await request(availabilityApp('cleaner'))
    .post(`/api/ops/availability/manual-blocks/${block.blockId}/convert`)
    .send({ guestInfo: guestInfo(), manualReservationPurpose: 'friends_family' });

  assert.equal(response.status, 403);
  assert.equal(response.body.errorType, 'permission');
  assert.equal((await AvailabilityBlock.findById(block.blockId).lean()).status, 'active');
  assert.equal(await Booking.countDocuments({}), 0);
});

test('conversion fails closed when the authoritative unique provenance index is missing', async () => {
  const cabin = await createSingleCabin();
  const range = stayRange(38);
  const block = await createManualBlock(cabin._id, range);
  await Booking.collection.dropIndex(INDEX_NAME);
  try {
    await assert.rejects(
      convert(block.blockId, range),
      (error) => error.status === 503 && error.details?.code === 'MANUAL_BLOCK_CONVERSION_INDEX_MISSING'
    );
    assert.equal((await AvailabilityBlock.findById(block.blockId).lean()).status, 'active');
    assert.equal(await Booking.countDocuments({}), 0);
  } finally {
    await Booking.collection.createIndex(INDEX_KEY, {
      name: INDEX_NAME,
      unique: true,
      partialFilterExpression: INDEX_PARTIAL_FILTER
    });
  }
});

test('conversion stores the source operator note as exactly one idempotent reservation note', async () => {
  const cabin = await createSingleCabin();
  const range = stayRange(39);
  const block = await createManualBlock(cabin._id, range);
  const created = await convert(block.blockId, range);
  await convert(block.blockId, range);
  const notes = await ReservationNote.find({
    reservationId: created.reservationId,
    'metadata.conversionSourceBlockId': block.blockId
  }).lean();
  assert.equal(notes.length, 1);
  assert.equal(notes[0].content, 'conversion regression fixture');
});

test('manual block notes are trimmed on edit and Other remains invalid without a note', async () => {
  const cabin = await createSingleCabin();
  const range = stayRange(39);
  await assert.rejects(
    createBlock({
      blockType: 'manual_block',
      cabinId: cabin._id,
      startDate: range.checkIn,
      endDate: range.checkOut,
      manualBlockPurpose: 'other',
      reason: 'audit-only reason',
      ctx: { user: { id: 'conversion-test', role: 'admin' }, route: 'test' }
    }),
    (error) => error.status === 400
  );
  assert.equal(await AvailabilityBlock.countDocuments({}), 0);

  const block = await createManualBlock(cabin._id, range);
  const ctx = { user: { id: 'conversion-test', role: 'admin' }, route: 'test' };

  await editBlock({
    blockId: block.blockId,
    manualBlockPurpose: 'owner_hold',
    operatorNote: '  owner requested maintenance  ',
    ctx
  });
  assert.equal(
    (await AvailabilityBlock.findById(block.blockId).lean()).metadata.operatorNote,
    'owner requested maintenance'
  );

  await assert.rejects(
    editBlock({
      blockId: block.blockId,
      manualBlockPurpose: 'other',
      operatorNote: '   ',
      ctx
    }),
    (error) => error.status === 400
  );
  assert.equal(
    (await AvailabilityBlock.findById(block.blockId).lean()).metadata.operatorNote,
    'owner requested maintenance'
  );
});

test('conversion resumes durable post-creation hooks after a failed first attempt', async () => {
  const cabin = await createSingleCabin();
  const range = stayRange(40);
  const block = await createManualBlock(cabin._id, range);
  const originalFindOneAndUpdate = Guest.findOneAndUpdate;
  let failOnce = true;
  Guest.findOneAndUpdate = function patchedFindOneAndUpdate(...args) {
    if (failOnce) {
      failOnce = false;
      const error = new Error('guest store temporarily unavailable');
      error.code = 'GUEST_STORE_UNAVAILABLE';
      throw error;
    }
    return originalFindOneAndUpdate.apply(this, args);
  };

  try {
    await assert.rejects(convert(block.blockId, range), (error) => error.code === 'GUEST_STORE_UNAVAILABLE');
  } finally {
    Guest.findOneAndUpdate = originalFindOneAndUpdate;
  }

  const bookingId = (await Booking.findOne({
    'provenance.convertedFromAvailabilityBlockId': block.blockId
  }).select('_id provenance.conversionHooks').lean());
  assert.ok(bookingId);
  assert.equal(bookingId.provenance.conversionHooks.status, 'failed');
  assert.equal(bookingId.provenance.conversionHooks.attemptCount, 1);
  assert.equal((await AvailabilityBlock.findById(block.blockId).lean()).status, 'tombstoned');

  const replay = await convert(block.blockId, range);
  assert.equal(replay.idempotentReplay, true);
  const completed = await Booking.findById(bookingId._id).select('provenance.conversionHooks').lean();
  assert.equal(completed.provenance.conversionHooks.status, 'completed');
  assert.equal(completed.provenance.conversionHooks.attemptCount, 2);
  assert.equal(await Booking.countDocuments({ 'provenance.convertedFromAvailabilityBlockId': block.blockId }), 1);
});

test('manual reservation validation rejects malformed guest data and allocated stays claim one physical unit', async () => {
  const { cabin, cabinType, units } = await createMultiCabin();
  const range = stayRange(42);
  const normalized = normalizeGuestStayRange(range.checkIn, range.checkOut);
  const ctx = { user: { id: 'manual-create-test', role: 'admin' }, route: 'test' };

  await assert.rejects(
    createManualReservation({
      cabinId: cabin._id,
      checkInDate: normalized.startDate,
      checkOutDate: normalized.endDate,
      adults: 1.5,
      children: 0,
      guestInfo: { ...guestInfo(), email: 'not-an-email' },
      ctx
    }),
    (error) => error.status === 400 && error.details?.code === 'INVALID_MANUAL_RESERVATION'
  );

  const pastRange = stayRange(-3);
  const pastNormalized = normalizeGuestStayRange(pastRange.checkIn, pastRange.checkOut);
  await assert.rejects(
    createManualReservation({
      cabinId: cabin._id,
      checkInDate: pastNormalized.startDate,
      checkOutDate: pastNormalized.endDate,
      adults: 1,
      children: 0,
      guestInfo: guestInfo(),
      ctx
    }),
    (error) => error.status === 400 && /today or in the future/.test(error.message)
  );

  const result = await createManualReservation({
    cabinId: cabin._id,
    unitId: units[0]._id,
    cabinTypeId: cabinType._id,
    checkInDate: normalized.startDate,
    checkOutDate: normalized.endDate,
    adults: 2,
    children: 0,
    guestInfo: guestInfo(),
    manualReservationPurpose: 'friends_family',
    deferPostCreateHooks: true,
    ctx
  });
  const booking = await Booking.findById(result.reservationId).lean();
  assert.equal(String(booking.unitId), String(units[0]._id));
  assert.equal(String(booking.cabinTypeId), String(cabinType._id));
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id, unitId: units[0]._id }), 2);
});

test('reconciliation reports a Booking linked to an active manual block without mutating it', async () => {
  const cabin = await createSingleCabin();
  const range = stayRange(41);
  const block = await createManualBlock(cabin._id, range);
  const created = await convert(block.blockId, range);
  await AvailabilityBlock.updateOne(
    { _id: block.blockId },
    { $set: { status: 'active', tombstonedAt: null } }
  );
  const before = await Booking.countDocuments({});
  const report = await reconcileManualBlockConversions();
  assert.ok(report.cases.some((item) =>
    item.type === 'booking_points_to_active_block' &&
    item.blockId === block.blockId &&
    item.bookingId === created.reservationId
  ));
  const response = await request(availabilityApp()).get('/api/ops/availability/manual-blocks/reconciliation');
  assert.equal(response.status, 200);
  assert.ok(response.body.data.cases.some((item) => item.type === 'booking_points_to_active_block'));
  assert.equal((await AvailabilityBlock.findById(block.blockId).lean()).status, 'active');
  assert.equal(await Booking.countDocuments({}), before);
});

test('manual reservation fallback idempotency replays the same unit but not a different physical unit', async () => {
  const { cabin, cabinType, units } = await createMultiCabin();
  const range = stayRange(64);
  const input = {
    cabinId: cabin._id,
    cabinTypeId: cabinType._id,
    unitId: units[0]._id,
    checkInDate: range.checkIn,
    checkOutDate: range.checkOut,
    guestInfo: guestInfo(),
    manualReservationPurpose: 'friends_family',
    deferPostCreateHooks: true,
    ctx: { user: { id: 'manual-create-test', role: 'admin' }, route: 'test' }
  };
  const first = await createManualReservation(input);
  const replay = await createManualReservation({ ...input, unitId: String(units[0]._id) });
  assert.equal(replay.reservationId, first.reservationId);
  const second = await createManualReservation({ ...input, unitId: units[1]._id });
  assert.notEqual(second.reservationId, first.reservationId);
  assert.equal(await Booking.countDocuments({}), 2);
  for (const [unitId, result] of [[units[0]._id, first], [units[1]._id, second]]) {
    const booking = await Booking.findById(result.reservationId).lean();
    assert.equal(String(booking.unitId), String(unitId));
    assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id, unitId }), 2);
  }

  const other = await createMultiCabin();
  await assert.rejects(
    createManualReservation({ ...input, unitId: other.units[0]._id }),
    (error) => error.status === 400 && /does not belong/.test(error.message)
  );
  await assert.rejects(
    createManualReservation({ ...input, cabinTypeId: other.cabinType._id }),
    (error) => error.status === 400 && /does not belong/.test(error.message)
  );
  assert.equal(await Booking.countDocuments({}), 2);
});

test('manual reservation explicit request IDs replay without collapsing distinct requests', async () => {
  const { cabin, cabinType, units } = await createMultiCabin();
  const range = stayRange(67);
  const input = {
    cabinId: cabin._id,
    cabinTypeId: cabinType._id,
    unitId: units[0]._id,
    checkInDate: range.checkIn,
    checkOutDate: range.checkOut,
    guestInfo: guestInfo(),
    manualReservationPurpose: 'friends_family',
    deferPostCreateHooks: true,
    ctx: { user: { id: 'manual-create-test', role: 'admin' }, idempotencyKey: 'request-one' }
  };
  const first = await createManualReservation(input);
  const replay = await createManualReservation(input);
  assert.equal(replay.reservationId, first.reservationId);
  await assert.rejects(
    createManualReservation({ ...input, ctx: { ...input.ctx, idempotencyKey: 'request-two' } }),
    (error) => error.type === 'conflict' && error.status === 409
  );
  assert.equal(await Booking.countDocuments({}), 1);
});

test('general reservation date editing allows an otherwise valid historical correction', async () => {
  const cabin = await createSingleCabin();
  const range = stayRange(70);
  const created = await createManualReservation({
    cabinId: cabin._id,
    checkInDate: range.checkIn,
    checkOutDate: range.checkOut,
    guestInfo: guestInfo(),
    manualReservationPurpose: 'friends_family',
    deferPostCreateHooks: true,
    ctx: { user: { id: 'manual-create-test', role: 'admin' } }
  });
  const historical = stayRange(-10);
  const corrected = await editReservationDates({
    bookingId: created.reservationId,
    checkInDate: historical.checkIn,
    checkOutDate: historical.checkOut,
    reason: 'Historical administrative correction',
    ctx: { user: { id: 'manual-create-test', role: 'admin' } }
  });
  assert.equal(corrected.reservationId, created.reservationId);
  const saved = await Booking.findById(created.reservationId).lean();
  assert.equal(moment(saved.checkIn).tz('Europe/Sofia').format('YYYY-MM-DD'), historical.checkIn);
  assert.equal(moment(saved.checkOut).tz('Europe/Sofia').format('YYYY-MM-DD'), historical.checkOut);
  assert.equal(await AuditEvent.countDocuments({
    entityId: created.reservationId, action: 'reservation_edit_dates'
  }), 1);
});

test('reconciliation returns block audit/handoff and Booking hook review items with correctly typed IDs', async () => {
  const cabin = await createSingleCabin();
  const range = stayRange(55);
  const block = await createManualBlock(cabin._id, range);
  const created = await convert(block.blockId, range);
  const reviewItems = await ManualReviewItem.create([
    {
      category: 'manual_block_conversion_audit_incomplete',
      entityType: 'AvailabilityBlock',
      entityId: block.blockId,
      title: 'Audit needs recovery'
    },
    {
      category: 'manual_block_conversion_handoff_incomplete',
      entityType: 'AvailabilityBlock',
      entityId: block.blockId,
      title: 'Handoff needs recovery'
    },
    {
      category: 'manual_block_conversion_hook_failure',
      entityType: 'Booking',
      entityId: created.reservationId,
      title: 'Hook needs recovery'
    },
    {
      category: 'manual_block_conversion_hook_failure',
      entityType: 'AvailabilityBlock',
      entityId: block.blockId,
      title: 'Wrong entity type must not match'
    }
  ]);

  const report = await reconcileManualBlockConversions();
  assert.equal(report.manualReviewItems.length, 3);
  for (const item of reviewItems.slice(0, 3)) {
    const result = report.manualReviewItems.find((entry) => entry.id === String(item._id));
    assert.ok(result);
    assert.equal(result.entityType, item.entityType);
    assert.equal(result.entityId, item.entityId);
    assert.equal(result.blockId, block.blockId);
    assert.equal(result.bookingId, created.reservationId);
  }
  assert.equal(await ManualReviewItem.countDocuments({}), 4);
});

test('reconciliation reports malformed legacy linkage and continues through remaining records read-only', async () => {
  const cabin = await createSingleCabin();
  const range = stayRange(56);
  const malformed = await createManualBlock(cabin._id, range);
  await AvailabilityBlock.collection.updateOne({ _id: new mongoose.Types.ObjectId(malformed.blockId) }, {
    $set: {
      status: 'tombstoned',
      reservationId: 'not-a-booking-id',
      'metadata.conversionReservationId': 'also-malformed'
    }
  });
  const valid = await createManualBlock(cabin._id, stayRange(59));
  const created = await convert(valid.blockId, stayRange(59));
  await AvailabilityBlock.updateOne({ _id: valid.blockId }, { $set: { status: 'active' } });
  const before = await AvailabilityBlock.findById(malformed.blockId).lean();

  const report = await reconcileManualBlockConversions();
  const invalidCases = report.cases.filter((item) => item.type === 'block_has_invalid_booking_linkage');
  assert.equal(invalidCases.length, 2);
  assert.deepEqual(invalidCases.map((item) => ({
    blockId: item.blockId,
    bookingId: item.bookingId,
    linkageField: item.linkageField,
    linkedValue: item.linkedValue
  })), [
    { blockId: malformed.blockId, bookingId: null, linkageField: 'reservationId', linkedValue: 'not-a-booking-id' },
    { blockId: malformed.blockId, bookingId: null, linkageField: 'metadata.conversionReservationId', linkedValue: 'also-malformed' }
  ]);
  assert.ok(report.cases.some((item) =>
    item.type === 'booking_points_to_active_block' &&
    item.blockId === valid.blockId && item.bookingId === created.reservationId
  ));
  assert.deepEqual(await AvailabilityBlock.findById(malformed.blockId).lean(), before);
});

test('reconciliation loads a selected Booking source directly beyond the unrelated conversion-block limit', async () => {
  const cabin = await createSingleCabin();
  const range = stayRange(62);
  const source = await createManualBlock(cabin._id, range);
  const created = await convert(source.blockId, range);
  const normalized = normalizeGuestStayRange(range.checkIn, range.checkOut);
  await AvailabilityBlock.create([1, 2, 3].map((index) => ({
    _id: new mongoose.Types.ObjectId(index.toString(16).padStart(24, '0')),
    cabinId: cabin._id,
    blockType: 'manual_block',
    status: 'active',
    source: 'internal_admin',
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    metadata: { conversionHandoffStatus: 'prepared' }
  })));
  const before = await AvailabilityBlock.countDocuments({});
  const report = await reconcileManualBlockConversions({ limit: 1 });
  assert.equal(report.cases.some((item) =>
    item.type === 'booking_source_block_missing' && item.bookingId === created.reservationId
  ), false);
  assert.equal(await AvailabilityBlock.countDocuments({}), before);

  await AvailabilityBlock.deleteOne({ _id: source.blockId });
  const missingReport = await reconcileManualBlockConversions({ limit: 1 });
  assert.ok(missingReport.cases.some((item) =>
    item.type === 'booking_source_block_missing' &&
    item.blockId === source.blockId && item.bookingId === created.reservationId
  ));
});

test('converted zero-price Booking appears in calendar and cleaner check-in/checkout workflows', async () => {
  const cabin = await createSingleCabin();
  const range = stayRange(3);
  const priorCheckIn = moment.tz(range.checkIn, 'YYYY-MM-DD', 'Europe/Sofia').subtract(2, 'days');
  const priorCheckOut = moment.tz(range.checkIn, 'YYYY-MM-DD', 'Europe/Sofia');
  const prior = await Booking.create({
    cabinId: cabin._id,
    checkIn: priorCheckIn.toDate(),
    checkOut: priorCheckOut.toDate(),
    adults: 1,
    children: 0,
    guestInfo: { firstName: 'Prior', lastName: 'Guest', email: 'prior@example.com', phone: '+359888000001' },
    totalPrice: 10,
    status: 'confirmed'
  });
  const block = await createManualBlock(cabin._id, range);
  const created = await convert(block.blockId, range);
  await Booking.updateOne(
    { _id: created.reservationId },
    { $set: { 'guestInfo.firstName': 'Visible', 'guestInfo.lastName': 'Guest', cleaningNotes: 'Late arrival' } }
  );

  const calendar = await getCalendarReadModel({
    from: range.checkIn,
    to: range.checkOut,
    cabinId: String(cabin._id)
  });
  const visibleReservation = calendar.blocks.find(
    (entry) => entry.blockType === 'reservation' && entry.sourceReference === created.reservationId
  );
  assert.ok(visibleReservation);
  assert.equal(calendar.blocks.some((entry) => entry.id === `block:${block.blockId}`), false);

  const dashboard = await getDashboardReadModel();
  assert.ok(
    dashboard.sections.upcoming7Days.some((entry) => entry.reservationId === created.reservationId)
  );

  const arrivals = await getCleaningSchedule({ date: range.checkIn });
  const checkin = arrivals.checkins.find((entry) => entry.bookingId === created.reservationId);
  const checkout = arrivals.checkouts.find((entry) => entry.bookingId === String(prior._id));
  assert.ok(checkin);
  assert.equal(checkin.arrivingGuest.name, 'Visible Guest');
  assert.equal(checkin.cleaningNotes, 'Late arrival');
  assert.ok(checkout);
  assert.equal(checkout.sameDayTurn, true);
  assert.deepEqual(checkout.arrivingNext, {
    name: 'Visible Guest',
    source: 'direct',
    checkinTime: checkout.nextCheckInTime
  });

  const departure = await getCleaningSchedule({ date: range.checkOut });
  const convertedCheckout = departure.checkouts.find(
    (entry) => entry.bookingId === created.reservationId
  );
  assert.ok(convertedCheckout);
  assert.equal(convertedCheckout.paymentStatus, 'unpaid');
  assert.equal(convertedCheckout.leavingGuest.name, 'Visible Guest');
});

test('requires an explicit physical unit for a parent-wide multi-unit conversion', async () => {
  const { cabin, cabinType, units } = await createMultiCabin();
  const range = stayRange(40);
  const block = await createManualBlock(cabin._id, range, { targetScope: 'all_units' });

  await assert.rejects(
    convert(block.blockId, range),
    (error) => error.type === 'validation' && /Choose a physical unit/.test(error.message)
  );
  assert.equal((await AvailabilityBlock.findById(block.blockId).lean()).status, 'active');
  assert.equal(await Booking.countDocuments({}), 0);

  const created = await convert(block.blockId, range, { unitId: units[0]._id });
  const booking = await Booking.findById(created.reservationId).lean();

  assert.equal(String(booking.cabinTypeId), String(cabinType._id));
  assert.equal(String(booking.unitId), String(units[0]._id));
  assert.equal(booking.cabinId, null);
  assert.equal(
    await UnitNightClaim.countDocuments({ bookingId: booking._id, unitId: units[0]._id }),
    2
  );
});

test('rejects a selected unit with a booking conflict without retiring the parent-wide hold', async () => {
  const { cabin, cabinType, units } = await createMultiCabin();
  const range = stayRange(45);
  const normalized = normalizeGuestStayRange(range.checkIn, range.checkOut);
  await Booking.create({
    cabinTypeId: cabinType._id,
    unitId: units[0]._id,
    checkIn: normalized.startDate,
    checkOut: normalized.endDate,
    adults: 2,
    children: 0,
    guestInfo: guestInfo(),
    totalPrice: 120,
    status: 'confirmed'
  });
  const block = await createManualBlock(cabin._id, range, { targetScope: 'all_units' });

  await assert.rejects(
    convert(block.blockId, range, { unitId: units[0]._id }),
    (error) => error.type === 'conflict' && error.status === 409
  );
  assert.equal((await AvailabilityBlock.findById(block.blockId).lean()).status, 'active');

  const created = await convert(block.blockId, range, { unitId: units[1]._id });
  const booking = await Booking.findById(created.reservationId).lean();

  assert.equal(String(booking.unitId), String(units[1]._id));
});

test('a foreign unit-night claim prevents conversion and leaves the source block active', async () => {
  const { cabin, units } = await createMultiCabin();
  const range = stayRange(44);
  const normalized = normalizeGuestStayRange(range.checkIn, range.checkOut);
  const foreignBookingId = new mongoose.Types.ObjectId();
  await UnitNightClaim.create({
    unitId: units[0]._id,
    night: normalized.startDate,
    bookingId: foreignBookingId,
    source: 'conversion-test'
  });
  const block = await AvailabilityBlock.create({
    cabinId: cabin._id,
    unitId: units[0]._id,
    blockType: 'manual_block',
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    status: 'active',
    source: 'internal_admin',
    metadata: { availabilityTargetScope: 'unit', manualBlockPurpose: 'owner_hold' }
  });

  await assert.rejects(
    convert(block._id, range),
    (error) => error.type === 'conflict' && error.status === 409
  );
  assert.equal((await AvailabilityBlock.findById(block._id).lean()).status, 'active');
  assert.equal(await Booking.countDocuments({ 'provenance.convertedFromAvailabilityBlockId': block._id }), 0);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: foreignBookingId }), 1);
});

test('rejects a selected unit outside the resolved cabin type', async () => {
  const { cabin, units } = await createMultiCabin();
  const other = await createMultiCabin();
  const range = stayRange(46);
  const block = await createManualBlock(cabin._id, range, { targetScope: 'all_units' });

  await assert.rejects(
    convert(block.blockId, range, { unitId: other.units[0]._id }),
    (error) => error.type === 'validation' && /does not belong/.test(error.message)
  );
  assert.equal((await AvailabilityBlock.findById(block.blockId).lean()).status, 'active');
  assert.equal(await Booking.countDocuments({}), 0);
  assert.ok(units.length > 0);
});

test('safely resolves a unique legacy CabinType target during conversion', async () => {
  const { cabinType, units } = await createMultiCabin();
  const range = stayRange(47);
  const normalized = normalizeGuestStayRange(range.checkIn, range.checkOut);
  const block = await AvailabilityBlock.create({
    cabinId: cabinType._id,
    blockType: 'manual_block',
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    status: 'active',
    source: 'internal_admin',
    metadata: { availabilityTargetScope: 'all_units', manualBlockPurpose: 'owner_hold' }
  });

  const created = await convert(block._id, range, { unitId: units[1]._id });
  const booking = await Booking.findById(created.reservationId).lean();
  assert.equal(String(booking.cabinTypeId), String(cabinType._id));
  assert.equal(String(booking.unitId), String(units[1]._id));
  assert.equal(booking.cabinId, null);
  assert.equal((await AvailabilityBlock.findById(block._id).lean()).status, 'tombstoned');
});

test('converts a legacy single-cabin block that has no structured target scope', async () => {
  const cabin = await createSingleCabin();
  const range = stayRange(48);
  const normalized = normalizeGuestStayRange(range.checkIn, range.checkOut);
  const block = await AvailabilityBlock.create({
    cabinId: cabin._id,
    blockType: 'manual_block',
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    status: 'active',
    source: 'internal_admin',
    metadata: {}
  });

  const created = await convert(block._id, range);
  const booking = await Booking.findById(created.reservationId).lean();
  assert.equal(String(booking.cabinId), String(cabin._id));
  assert.ok(!booking.cabinTypeId);
  assert.ok(!booking.unitId);
  assert.equal((await AvailabilityBlock.findById(block._id).lean()).status, 'tombstoned');
});

test('rejects ambiguous legacy CabinType targets without mutating the source block', async () => {
  const { cabin, cabinType } = await createMultiCabin();
  const duplicateParent = await Cabin.create({
    name: `Ambiguous parent ${new mongoose.Types.ObjectId()}`,
    description: 'Ambiguous legacy conversion test',
    capacity: 2,
    pricePerNight: 60,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'The Valley',
    propertyKind: 'valley',
    inventoryType: 'multi',
    cabinTypeRef: cabinType._id,
    isActive: true,
    transportOptions: []
  });
  const range = stayRange(49);
  const normalized = normalizeGuestStayRange(range.checkIn, range.checkOut);
  const block = await AvailabilityBlock.create({
    cabinId: cabinType._id,
    blockType: 'manual_block',
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    status: 'active',
    source: 'internal_admin',
    metadata: { availabilityTargetScope: 'all_units' }
  });

  await assert.rejects(
    convert(block._id, range),
    (error) => error.type === 'validation' && /ambiguous/i.test(error.message)
  );
  assert.equal((await AvailabilityBlock.findById(block._id).lean()).status, 'active');
  assert.equal(await Booking.countDocuments({}), 0);
  assert.ok(cabin);
  assert.ok(duplicateParent);
});

test('concurrent retries never create more than one canonical Booking', async () => {
  const cabin = await createSingleCabin();
  const range = stayRange(48);
  const block = await createManualBlock(cabin._id, range);

  const outcomes = await Promise.allSettled([
    convert(block.blockId, range),
    convert(block.blockId, range)
  ]);
  const completed = outcomes.filter((outcome) => outcome.status === 'fulfilled');
  assert.ok(completed.length >= 1);
  const ids = new Set(completed.map((outcome) => outcome.value.reservationId));
  assert.equal(ids.size, 1);
  assert.equal(await Booking.countDocuments({ 'provenance.convertedFromAvailabilityBlockId': block.blockId }), 1);
});

test('ignores only the source block and refuses conversion when another overlapping block exists', async () => {
  const cabin = await createSingleCabin();
  const range = stayRange(50);
  const source = await createManualBlock(cabin._id, range);
  const other = await AvailabilityBlock.create({
    cabinId: cabin._id,
    blockType: 'maintenance',
    startDate: normalizeGuestStayRange(range.checkIn, range.checkOut).startDate,
    endDate: normalizeGuestStayRange(range.checkIn, range.checkOut).endDate,
    status: 'active',
    source: 'internal_admin'
  });

  await assert.rejects(
    convert(source.blockId, range),
    (error) => error.type === 'conflict' && error.status === 409
  );
  assert.equal((await AvailabilityBlock.findById(source.blockId).lean()).status, 'active');
  assert.equal(await Booking.countDocuments({}), 0);
  assert.ok(await AvailabilityBlock.findById(other._id));
});

test('recovers a failed tombstone handoff without duplicating its conversion audit', async () => {
  const cabin = await createSingleCabin();
  const range = stayRange(51);
  const block = await createManualBlock(cabin._id, range);
  const originalFindOneAndUpdate = AvailabilityBlock.findOneAndUpdate;
  let failHandoff = true;
  AvailabilityBlock.findOneAndUpdate = function patchedFindOneAndUpdate(filter, ...args) {
    if (failHandoff && filter?.['metadata.conversionAttemptId'] && !filter.$or) {
      failHandoff = false;
      return { lean: async () => null };
    }
    return originalFindOneAndUpdate.call(this, filter, ...args);
  };

  try {
    await assert.rejects(
      convert(block.blockId, range),
      (error) => error.type === 'conflict' && /handoff did not complete/.test(error.message)
    );
  } finally {
    AvailabilityBlock.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal((await AvailabilityBlock.findById(block.blockId).lean()).status, 'active');
  assert.equal(await Booking.countDocuments({ 'provenance.convertedFromAvailabilityBlockId': block.blockId }), 1);
  assert.equal(
    await AuditEvent.countDocuments({ entityId: block.blockId, action: 'manual_block_convert_to_reservation' }),
    0
  );
  assert.equal(await AuditEvent.countDocuments({ entityId: block.blockId, action: 'manual_block_conversion_prepared' }), 1);

  const replay = await convert(block.blockId, range);
  assert.equal(replay.idempotentReplay, false);
  assert.equal((await AvailabilityBlock.findById(block.blockId).lean()).status, 'tombstoned');
  assert.equal(
    await AuditEvent.countDocuments({
      entityId: block.blockId,
      action: 'manual_block_convert_to_reservation'
    }),
    1
  );
  assert.equal(await AuditEvent.countDocuments({ entityId: block.blockId, action: 'manual_block_conversion_prepared' }), 1);
});

test('surfaces an audit failure after Booking creation and retries without creating another Booking', async () => {
  const cabin = await createSingleCabin();
  const range = stayRange(52);
  const block = await createManualBlock(cabin._id, range);
  const originalCreate = AuditEvent.create;
  AuditEvent.create = function patchedAuditCreate(payload, ...args) {
    if (payload?.action === 'manual_block_convert_to_reservation') {
      const error = new Error('audit unavailable');
      error.code = 'AUDIT_WRITE_FAILED';
      throw error;
    }
    return originalCreate.call(this, payload, ...args);
  };

  try {
    await assert.rejects(
      convert(block.blockId, range),
      (error) => error.code === 'AUDIT_WRITE_FAILED'
    );
    await assert.rejects(
      convert(block.blockId, range),
      (error) => error.code === 'AUDIT_WRITE_FAILED'
    );
  } finally {
    AuditEvent.create = originalCreate;
  }

  assert.equal((await AvailabilityBlock.findById(block.blockId).lean()).status, 'tombstoned');
  assert.equal(await Booking.countDocuments({ 'provenance.convertedFromAvailabilityBlockId': block.blockId }), 1);
  assert.equal(await AuditEvent.countDocuments({ action: 'manual_block_convert_to_reservation' }), 0);
  assert.equal(await AuditEvent.countDocuments({ action: 'manual_block_conversion_prepared' }), 1);
  const interrupted = await AvailabilityBlock.findById(block.blockId).lean();
  assert.equal(interrupted.metadata.conversionCompletionAuditPending, true);
  assert.ok(interrupted.metadata.conversionCompletionAuditFailureAt);
  assert.equal(await ManualReviewItem.countDocuments({
    category: 'manual_block_conversion_audit_incomplete', entityId: block.blockId
  }), 1);

  const replay = await convert(block.blockId, range);
  assert.equal(replay.idempotentReplay, true);
  assert.equal((await AvailabilityBlock.findById(block.blockId).lean()).status, 'tombstoned');
  assert.equal(await Booking.countDocuments({ 'provenance.convertedFromAvailabilityBlockId': block.blockId }), 1);
  assert.equal(
    await AuditEvent.countDocuments({
      entityId: block.blockId,
      action: 'manual_block_convert_to_reservation'
    }),
    1
  );
  assert.equal(await AuditEvent.countDocuments({ action: 'manual_block_conversion_prepared' }), 1);
  const repaired = await AvailabilityBlock.findById(block.blockId).lean();
  assert.equal(repaired.metadata.conversionCompletionAuditPending, undefined);
  assert.equal(repaired.metadata.conversionCompletionAuditFailureAt, undefined);
  assert.equal(await ManualReviewItem.countDocuments({
    category: 'manual_block_conversion_audit_incomplete', entityId: block.blockId
  }), 1);
});

for (const action of ['manual_block_conversion_prepared', 'manual_block_convert_to_reservation']) {
  test(`${action} dedupe insertion race converges without duplicate audits`, async () => {
    const cabin = await createSingleCabin();
    const range = stayRange(73);
    const block = await createManualBlock(cabin._id, range);
    const originalCreate = AuditEvent.create;
    let simulatedRace = false;
    AuditEvent.create = async function raceAuditInsertion(payload, ...args) {
      if (payload.action === action) {
        simulatedRace = true;
        await originalCreate.call(this, payload, ...args);
        // The second insert exercises Mongo's real unique-dedupe E11000 response.
      }
      if (payload.action === 'reservation_manual_create') {
        assert.equal(
          (await AvailabilityBlock.findById(block.blockId).lean()).metadata.conversionHandoffStatus,
          'prepared'
        );
      }
      return originalCreate.call(this, payload, ...args);
    };
    try {
      await convert(block.blockId, range);
    } finally {
      AuditEvent.create = originalCreate;
    }
    assert.equal(simulatedRace, true);
    assert.equal(await AuditEvent.countDocuments({ entityId: block.blockId, action }), 1);
    const saved = await AvailabilityBlock.findById(block.blockId).lean();
    assert.equal(saved.status, 'tombstoned');
    assert.equal(saved.metadata.conversionCompletionAuditPending, undefined);
    assert.equal(saved.metadata.conversionCompletionAuditFailureAt, undefined);
  });

  test(`${action} does not suppress an unrelated duplicate-key error`, async () => {
    const cabin = await createSingleCabin();
    const range = stayRange(76);
    const block = await createManualBlock(cabin._id, range);
    const originalCreate = AuditEvent.create;
    AuditEvent.create = async function unrelatedDuplicate(payload, ...args) {
      if (payload.action === action) {
        await originalCreate.call(this, payload, ...args);
        const error = new Error('unrelated audit index collision');
        error.code = 11000;
        error.keyValue = { _id: new mongoose.Types.ObjectId() };
        throw error;
      }
      return originalCreate.call(this, payload, ...args);
    };
    try {
      await assert.rejects(convert(block.blockId, range), /unrelated audit index collision/);
    } finally {
      AuditEvent.create = originalCreate;
    }
    assert.equal(await AuditEvent.countDocuments({ entityId: block.blockId, action }), 1);
    const saved = await AvailabilityBlock.findById(block.blockId).lean();
    if (action === 'manual_block_conversion_prepared') {
      assert.equal(saved.status, 'active');
      assert.equal(await Booking.countDocuments({}), 0);
    } else {
      assert.equal(saved.metadata.conversionCompletionAuditPending, true);
      assert.ok(saved.metadata.conversionCompletionAuditFailureAt);
    }
  });
}

test('retry repairs prepared metadata when the intent audit survived an interrupted metadata update', async () => {
  const cabin = await createSingleCabin();
  const range = stayRange(53);
  const block = await createManualBlock(cabin._id, range);
  const originalUpdateOne = AvailabilityBlock.updateOne;
  AvailabilityBlock.updateOne = function interruptedPreparedUpdate(filter, update, ...args) {
    if (update.$set?.['metadata.conversionHandoffStatus'] === 'prepared') {
      throw new Error('prepared metadata update interrupted');
    }
    return originalUpdateOne.call(this, filter, update, ...args);
  };
  try {
    await assert.rejects(convert(block.blockId, range), /prepared metadata update interrupted/);
  } finally {
    AvailabilityBlock.updateOne = originalUpdateOne;
  }
  assert.equal(await AuditEvent.countDocuments({
    dedupeKey: `manual_block_conversion_intent:${block.blockId}`
  }), 1);
  assert.equal((await AvailabilityBlock.findById(block.blockId).lean()).metadata.conversionHandoffStatus, undefined);

  const originalCreate = AuditEvent.create;
  let checkedPreparedMetadata = false;
  AuditEvent.create = async function checkPreparedBeforeReservation(payload, ...args) {
    if (payload.action === 'reservation_manual_create') {
      assert.equal(
        (await AvailabilityBlock.findById(block.blockId).lean()).metadata.conversionHandoffStatus,
        'prepared'
      );
      checkedPreparedMetadata = true;
    }
    return originalCreate.call(this, payload, ...args);
  };
  try {
    await convert(block.blockId, range);
  } finally {
    AuditEvent.create = originalCreate;
  }
  assert.equal(checkedPreparedMetadata, true);
  assert.equal(await AuditEvent.countDocuments({
    dedupeKey: `manual_block_conversion_intent:${block.blockId}`
  }), 1);
});

test('retry clears interrupted completion metadata when the completion audit already exists', async () => {
  const cabin = await createSingleCabin();
  const range = stayRange(54);
  const block = await createManualBlock(cabin._id, range);
  const created = await convert(block.blockId, range);
  await AvailabilityBlock.updateOne({ _id: block.blockId }, {
    $set: {
      'metadata.conversionCompletionAuditPending': true,
      'metadata.conversionCompletionAuditFailureAt': new Date()
    }
  });

  const replay = await convert(block.blockId, range);
  assert.equal(replay.reservationId, created.reservationId);
  const repaired = await AvailabilityBlock.findById(block.blockId).lean();
  assert.equal(repaired.metadata.conversionCompletionAuditPending, undefined);
  assert.equal(repaired.metadata.conversionCompletionAuditFailureAt, undefined);
  assert.equal(await AuditEvent.countDocuments({
    dedupeKey: `manual_block_conversion_complete:${block.blockId}`
  }), 1);
});

test('conversion requires both reservation-create and block-remove permissions', async () => {
  const blockId = new mongoose.Types.ObjectId();
  await assert.rejects(
    convertManualBlockToReservation({
      blockId,
      guestInfo: guestInfo(),
      manualReservationPurpose: 'friends_family',
      ctx: { user: { role: 'cleaner' } }
    }),
    (error) => error.code === 'PERMISSION_DENIED' && error.status === 403
  );
});
