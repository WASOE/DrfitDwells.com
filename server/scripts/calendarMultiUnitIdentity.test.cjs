const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const Booking = require('../models/Booking');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const { getCalendarReadModel } = require('../services/ops/readModels/calendarReadModel');
const { getCabinDetailReadModel } = require('../services/ops/readModels/cabinsReadModel');
const { normalizeDateToSofiaDayStart } = require('../utils/dateTime');

let mongo;
let parent, type, single, units;
const day = normalizeDateToSofiaDayStart;
const read = (id, from = '2026-10-30', to = '2026-11-01') =>
  getCalendarReadModel({ cabinId: String(id), from, to });
const details = { description: 'Calendar identity regression', capacity: 2, pricePerNight: 100, location: 'Valley', imageUrl: '/uploads/test.jpg' };

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  type = await CabinType.create({ ...details, name: 'A-Frame', slug: 'identity-a-frame' });
  parent = await Cabin.create({
    ...details, name: 'A-Frame',
    inventoryType: 'multi', cabinTypeId: type._id
  });
  single = await Cabin.create({ ...details, name: 'Single' });
  units = await Unit.create([
    { cabinTypeId: type._id, unitNumber: 'AF-03', displayName: 'A-Frame 2' },
    { cabinTypeId: type._id, unitNumber: 'AF-04', displayName: 'A-Frame 3' }
  ]);
  for (const [index, unit] of units.entries()) {
    await Booking.collection.insertOne({
      _id: new mongoose.Types.ObjectId(index === 0 ? '6ac913f5da3c11a444777976' : '6acf6c6eda3c11a44478016b'),
      cabinTypeId: type._id, unitId: unit._id, status: 'confirmed',
      checkIn: day('2026-10-30'), checkOut: day('2026-11-01'), isTest: false, archivedAt: null
    });
  }
  for (const excluded of [{ status: 'cancelled' }, { status: 'confirmed', archivedAt: new Date() }, { status: 'confirmed', isTest: true }]) {
    await Booking.collection.insertOne({
      cabinTypeId: type._id, unitId: units[0]._id,
      checkIn: day('2026-10-30'), checkOut: day('2026-11-01'), ...excluded
    });
  }
});
test.after(async () => { await mongoose.disconnect(); await mongo.stop(); });

test('parent/type entry points return identical allocated bookings, canonical type and physical labels', async () => {
  const a = await read(parent._id), b = await read(type._id);
  assert.deepEqual(a.blocks, b.blocks);
  assert.equal(a.blocks.length, 2);
  assert.equal(a.calendarScope.cabinTypeId, String(type._id));
  assert.equal(a.calendarScope.renderCabinId, String(parent._id));
  assert.deepEqual(a.blocks.map(block => block.render.unitLabel), ['A-Frame 2', 'A-Frame 3']);
  assert.deepEqual(a.blocks.map(block => block.unitId), units.map(unit => String(unit._id)));
  assert.ok(a.blocks.every(block => block.startDateOnly === '2026-10-30' && block.endDateOnly === '2026-11-01'));
});

test('parent/type accommodation details expose identical physical inventory', async () => {
  const a = await getCabinDetailReadModel(String(parent._id));
  const b = await getCabinDetailReadModel(String(type._id));
  assert.deepEqual(a, b);
  assert.equal(a.kind, 'multi_unit_type');
  assert.equal(a.cabinId, String(parent._id));
  assert.equal(a.cabinTypeId, String(type._id));
  assert.equal(a.units.length, 2);
});

test('exclusive checkout and Sofia dates preserve adjacent availability and occupied nights', async () => {
  for (const id of [parent._id, type._id]) {
    assert.equal((await read(id, '2026-10-29', '2026-10-30')).blocks.length, 0);
    assert.equal((await read(id, '2026-11-01', '2026-11-02')).blocks.length, 0);
    assert.equal((await read(id, '2026-10-30', '2026-10-31')).blocks.length, 2);
    assert.equal((await read(id, '2026-10-31', '2026-11-01')).blocks.length, 2);
  }
});

test('unit holds and parent-wide blocks retain distinct identities through both scopes', async () => {
  const inserted = await AvailabilityBlock.collection.insertMany([
    { cabinId: parent._id, unitId: units[1]._id, blockType: 'external_hold', status: 'active', startDate: day('2026-10-30'), endDate: day('2026-11-01') },
    { cabinId: parent._id, unitId: null, blockType: 'maintenance', status: 'active', startDate: day('2026-10-30'), endDate: day('2026-11-01') }
  ]);
  try {
    const a = await read(parent._id), b = await read(type._id);
    assert.deepEqual(a.blocks, b.blocks);
    assert.equal(a.blocks.find(block => block.blockType === 'external_hold').unitId, String(units[1]._id));
    assert.equal(a.blocks.find(block => block.blockType === 'maintenance').unitId, null);
    assert.ok(a.blocks.every(block => block.cabinId === String(parent._id)));
  } finally { await AvailabilityBlock.deleteMany({ _id: { $in: Object.values(inserted.insertedIds) } }); }
});

test('single cabin metadata and booking identity remain unchanged, even with stale type reference', async () => {
  await Cabin.updateOne({ _id: single._id }, { $set: { cabinTypeId: type._id } });
  await Booking.collection.insertOne({ cabinId: single._id, status: 'confirmed', checkIn: day('2026-10-30'), checkOut: day('2026-11-01') });
  const detail = await getCabinDetailReadModel(String(single._id));
  const calendar = await read(single._id);
  assert.equal(detail.kind, 'single_cabin');
  assert.equal(calendar.calendarScope.scope, 'cabin');
  assert.equal(calendar.blocks.length, 1);
  assert.equal(calendar.blocks[0].unitId, null);
});

test('legacy cabinTypeRef resolves identically and missing multi-unit configuration fails explicitly', async () => {
  await Cabin.updateOne({ _id: parent._id }, { $set: { cabinTypeId: null, cabinTypeRef: type._id } });
  assert.equal((await read(parent._id)).calendarScope.cabinTypeId, String(type._id));
  assert.equal((await getCabinDetailReadModel(String(parent._id))).kind, 'multi_unit_type');
  await Cabin.updateOne({ _id: parent._id }, { $set: { cabinTypeRef: null } });
  await assert.rejects(read(parent._id), /no canonical cabin type/);
  await assert.rejects(getCabinDetailReadModel(String(parent._id)), /no canonical cabin type/);
});
