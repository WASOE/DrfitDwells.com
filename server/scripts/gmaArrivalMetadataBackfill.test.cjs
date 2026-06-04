'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const {
  ALL_TARGETS,
  CABIN_ARRIVAL,
  VALLEY_ARRIVAL,
  pickArrivalSlice,
  buildDesiredSlice,
  slicesEqual,
  runBackfill
} = require('./gmaArrivalMetadataBackfill.cjs');

let mongoServer;

async function seedTarget(target, overrides = {}) {
  const Model = target.model === 'CabinType' ? CabinType : Cabin;
  const base =
    target.model === 'CabinType'
      ? {
          slug: 'a-frame-test',
          description: 'test type',
          capacity: 2,
          minGuests: 1,
          pricePerNight: 60,
          imageUrl: '/uploads/test.jpg',
          isActive: true
        }
      : {
          description: 'test cabin',
          capacity: 2,
          minGuests: 1,
          pricePerNight: 55,
          imageUrl: '/uploads/test.jpg',
          isActive: true
        };

  return Model.create({
    ...base,
    _id: new mongoose.Types.ObjectId(target.id),
    name: overrides.name ?? target.expectedName,
    location: 'Test location',
    meetingPoint: overrides.meetingPoint ?? {
      label: 'old',
      googleMapsUrl: 'https://www.google.com/maps/place/old'
    },
    arrivalGuideUrl: overrides.arrivalGuideUrl ?? '',
    arrivalWindowDefault: overrides.arrivalWindowDefault ?? '',
    ...(overrides.propertyKind != null && overrides.propertyKind !== ''
      ? { propertyKind: overrides.propertyKind }
      : {}),
    ...overrides
  });
}

async function seedAllTargets() {
  for (const target of ALL_TARGETS) {
    await seedTarget(target);
  }
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await Cabin.syncIndexes();
  await CabinType.syncIndexes();
});

test.beforeEach(async () => {
  await Cabin.deleteMany({});
  await CabinType.deleteMany({});
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test('dry-run writes nothing', async () => {
  await seedAllTargets();
  const before = await Cabin.findById(ALL_TARGETS[0].id).lean();

  const { summary, fatal } = await runBackfill({ apply: false });
  assert.equal(fatal, false);
  assert.ok(summary.to_write > 0);

  const after = await Cabin.findById(ALL_TARGETS[0].id).lean();
  assert.equal(after.meetingPoint.label, before.meetingPoint.label);
  assert.equal(after.description, before.description);
});

test('--apply writes expected fields for The Cabin and Valley stay', async () => {
  await seedAllTargets();

  const { summary, fatal } = await runBackfill({ apply: true });
  assert.equal(fatal, false);
  assert.equal(summary.written, summary.to_write);

  const cabin = await Cabin.findById('69b2ff933a7fff6621e785cc').lean();
  const desiredCabin = buildDesiredSlice(CABIN_ARRIVAL);
  assert.ok(slicesEqual(pickArrivalSlice(cabin), desiredCabin));

  const stone = await Cabin.findById('69b2ff947f141a71ffa7c452').lean();
  const desiredValley = buildDesiredSlice(VALLEY_ARRIVAL);
  assert.ok(slicesEqual(pickArrivalSlice(stone), desiredValley));

  const aFrameType = await CabinType.findById('69b2ff947f141a71ffa7c401').lean();
  assert.ok(slicesEqual(pickArrivalSlice(aFrameType), desiredValley));
});

test('idempotent second run is already_correct', async () => {
  await seedAllTargets();
  await runBackfill({ apply: true });

  const { summary, fatal } = await runBackfill({ apply: true });
  assert.equal(fatal, false);
  assert.equal(summary.already_correct, ALL_TARGETS.length);
  assert.equal(summary.to_write, 0);
  assert.equal(summary.written, 0);
});

test('missing document fails with exit fatal', async () => {
  for (const target of ALL_TARGETS) {
    if (target.id !== '69b2ff933a7fff6621e785cc') {
      await seedTarget(target);
    }
  }

  const { summary, fatal } = await runBackfill({ apply: false });
  assert.equal(fatal, true);
  assert.equal(summary.missing, 1);
});

test('name mismatch fails with exit fatal', async () => {
  await seedAllTargets();
  await Cabin.updateOne(
    { _id: '69b2ff933a7fff6621e785cc' },
    { $set: { name: 'Wrong Cabin Name' } }
  );

  const { summary, fatal } = await runBackfill({ apply: false });
  assert.equal(fatal, true);
  assert.equal(summary.name_mismatch, 1);
});

test('only allowed arrival fields are changed on apply', async () => {
  await seedTarget(ALL_TARGETS[0], {
    description: 'immutable-description',
    pricePerNight: 99
  });
  for (const target of ALL_TARGETS.slice(1)) {
    await seedTarget(target);
  }

  await runBackfill({ apply: true });

  const doc = await Cabin.findById(ALL_TARGETS[0].id).lean();
  assert.equal(doc.description, 'immutable-description');
  assert.equal(doc.pricePerNight, 99);
  assert.ok(slicesEqual(pickArrivalSlice(doc), buildDesiredSlice(CABIN_ARRIVAL)));
});

test('meetingPoint lat/lng preserved when not in patch', async () => {
  await seedTarget(ALL_TARGETS[0], {
    meetingPoint: {
      label: 'old',
      googleMapsUrl: 'https://www.google.com/maps/place/old',
      lat: 41.1,
      lng: 23.2
    }
  });
  for (const target of ALL_TARGETS.slice(1)) {
    await seedTarget(target);
  }

  await runBackfill({ apply: true });

  const doc = await Cabin.findById(ALL_TARGETS[0].id).lean();
  assert.equal(doc.meetingPoint.lat, 41.1);
  assert.equal(doc.meetingPoint.lng, 23.2);
});
