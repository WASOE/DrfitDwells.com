#!/usr/bin/env node
/**
 * Integration fixture matrix for source-neutral cleaning schedule.
 * Uses local Mongo; cleans up tagged fixtures afterward.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const assert = require('node:assert/strict');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const Booking = require('../models/Booking');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const CleaningRecord = require('../models/CleaningRecord');
const {
  getCleaningSchedule,
  buildTaskId
} = require('../services/ops/readModels/cleaningReadModel');
const { normalizeDateToSofiaDayStart } = require('../utils/dateTime');

const TAG = `cleaning-fixture-${Date.now()}`;
const suffix = crypto.randomBytes(3).toString('hex');

function sofiaDayOffset(days) {
  const start = normalizeDateToSofiaDayStart(new Date());
  return new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
}

async function insertBooking(doc) {
  const booking = new Booking(doc);
  const obj = booking.toObject();
  delete obj._id;
  const res = await Booking.collection.insertOne({
    ...obj,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  return Booking.findById(res.insertedId);
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  assert.ok(uri, 'MONGODB_URI required');
  await mongoose.connect(uri);

  const created = { cabins: [], types: [], units: [], bookings: [], blocks: [], records: [] };
  try {
    const today = sofiaDayOffset(0);
    const yesterday = sofiaDayOffset(-1);
    const tomorrow = sofiaDayOffset(1);

    const cabinType = await CabinType.create({
      name: `${TAG}-A-Frame-Type`,
      slug: `${TAG}-aframe-type-${suffix}`,
      description: 'fixture type',
      capacity: 2,
      pricePerNight: 100,
      imageUrl: 'https://example.com/aframe.jpg',
      location: 'The Cabin',
      propertyKind: 'cabin'
    });
    created.types.push(cabinType._id);

    const unit2 = await Unit.create({
      cabinTypeId: cabinType._id,
      unitNumber: '2',
      displayName: 'A-Frame 2',
      isActive: true
    });
    const unit3 = await Unit.create({
      cabinTypeId: cabinType._id,
      unitNumber: '3',
      displayName: 'A-Frame 3',
      isActive: true
    });
    created.units.push(unit2._id, unit3._id);

    const cabinA = await Cabin.create({
      name: `${TAG}-A-Frame`,
      slug: `${TAG}-aframe-${suffix}`,
      description: 'fixture cabin',
      location: 'The Cabin',
      capacity: 2,
      minGuests: 1,
      pricePerNight: 100,
      minNights: 1,
      imageUrl: 'https://example.com/cabin.jpg',
      propertyKind: 'cabin',
      inventoryMode: 'multi',
      cabinTypeRef: cabinType._id,
      isActive: true
    });
    created.cabins.push(cabinA._id);

    // A: Direct checkout → Needs cleaning (unit 2)
    const directOut = await insertBooking({
      cabinId: cabinA._id,
      unitId: unit2._id,
      checkIn: yesterday,
      checkOut: today,
      adults: 2,
      children: 0,
      status: 'confirmed',
      guestInfo: {
        firstName: 'Elena',
        lastName: 'Direct',
        email: `${TAG}@example.com`,
        phone: '+359881111111'
      },
      totalPrice: 100,
      subtotalPrice: 100,
      currency: 'EUR'
    });
    created.bookings.push(directOut._id);

    // B: Airbnb checkout → Needs cleaning (unit 3)
    const airbnbOut = await AvailabilityBlock.create({
      cabinId: cabinA._id,
      unitId: unit3._id,
      blockType: 'external_hold',
      source: 'airbnb_ical',
      sourceReference: `airbnb_ical:uid:${TAG}-out`,
      startDate: yesterday,
      endDate: today,
      status: 'active',
      metadata: { summary: 'Reserved' }
    });
    created.blocks.push(airbnbOut._id);

    // C: Airbnb out + direct same-day arrival on unit 3
    const directInSame = await insertBooking({
      cabinId: cabinA._id,
      unitId: unit3._id,
      checkIn: today,
      checkOut: tomorrow,
      adults: 2,
      children: 0,
      status: 'confirmed',
      guestInfo: {
        firstName: 'Sofia',
        lastName: 'Arrival',
        email: `${TAG}-in@example.com`,
        phone: '+359882222222'
      },
      totalPrice: 120,
      subtotalPrice: 120,
      currency: 'EUR'
    });
    created.bookings.push(directInSame._id);

    // D: Direct out + Airbnb same-day arrival on unit 2
    const airbnbIn = await AvailabilityBlock.create({
      cabinId: cabinA._id,
      unitId: unit2._id,
      blockType: 'external_hold',
      source: 'airbnb_ical',
      sourceReference: `airbnb_ical:uid:${TAG}-in`,
      startDate: today,
      endDate: tomorrow,
      status: 'active',
      metadata: { summary: 'Reserved' }
    });
    created.blocks.push(airbnbIn._id);

    // F: Manual block ending today → no cleaning
    const manual = await AvailabilityBlock.create({
      cabinId: cabinA._id,
      unitId: unit2._id,
      blockType: 'manual_block',
      source: 'internal',
      startDate: yesterday,
      endDate: today,
      status: 'active',
      metadata: { summary: 'Owner hold' }
    });
    created.blocks.push(manual._id);

    // G: Maintenance ending today → no cleaning
    const maint = await AvailabilityBlock.create({
      cabinId: cabinA._id,
      unitId: unit3._id,
      blockType: 'maintenance',
      source: 'internal',
      startDate: yesterday,
      endDate: today,
      status: 'active',
      metadata: { summary: 'Maintenance' }
    });
    created.blocks.push(maint._id);

    // Not-available Airbnb block ending today → no cleaning
    const notAvail = await AvailabilityBlock.create({
      cabinId: cabinA._id,
      unitId: unit2._id,
      blockType: 'external_hold',
      source: 'airbnb_ical',
      sourceReference: `airbnb_ical:uid:${TAG}-block`,
      startDate: yesterday,
      endDate: today,
      status: 'active',
      metadata: { summary: 'Airbnb (Not available)' }
    });
    created.blocks.push(notAvail._id);

    // H: Tombstoned reserved stay → no cleaning
    const cancelled = await AvailabilityBlock.create({
      cabinId: cabinA._id,
      unitId: unit2._id,
      blockType: 'external_hold',
      source: 'airbnb_ical',
      sourceReference: `airbnb_ical:uid:${TAG}-cancelled`,
      startDate: yesterday,
      endDate: today,
      status: 'tombstoned',
      tombstonedAt: new Date(),
      metadata: { summary: 'Reserved' }
    });
    created.blocks.push(cancelled._id);

    const schedule = await getCleaningSchedule({ date: today.toISOString() });
    const checkouts = schedule.checkouts.filter(
      (c) => c.cabinName && String(c.cabinName).includes(TAG)
    );

    assert.equal(
      checkouts.length,
      2,
      `expected 2 checkout tasks, got ${checkouts.length}: ${JSON.stringify(checkouts.map((c) => ({ id: c.taskId, u: c.unitLabel, s: c.source })))}`
    );

    const directTask = checkouts.find((c) => c.source === 'direct' && c.unitLabel === 'A-Frame 2');
    const airbnbTask = checkouts.find((c) => c.source === 'airbnb' && c.unitLabel === 'A-Frame 3');
    assert.ok(directTask, 'A: direct checkout missing');
    assert.ok(airbnbTask, 'B: airbnb checkout missing');
    assert.equal(directTask.status, 'pending');
    assert.equal(airbnbTask.status, 'pending');
    assert.equal(directTask.paymentStatus, 'unpaid');
    assert.equal(airbnbTask.paymentStatus, 'unpaid');

    assert.equal(directTask.sameDayTurn, true, 'D: direct out + airbnb in should be same-day');
    assert.equal(airbnbTask.sameDayTurn, true, 'C: airbnb out + direct in should be same-day');
    assert.equal(directTask.arrivingNext?.source, 'airbnb');
    assert.equal(airbnbTask.arrivingNext?.source, 'direct');
    assert.equal(airbnbTask.leavingGuest?.name, 'Airbnb guest');
    assert.match(directTask.leavingGuest?.name || '', /Elena/);

    assert.notEqual(directTask.taskId, airbnbTask.taskId);
    assert.equal(airbnbTask.taskId, buildTaskId('external_hold', String(airbnbOut._id)));

    assert.equal(checkouts.filter((c) => c.availabilityBlockId === String(manual._id)).length, 0);
    assert.equal(checkouts.filter((c) => c.availabilityBlockId === String(notAvail._id)).length, 0);
    assert.equal(checkouts.filter((c) => c.availabilityBlockId === String(cancelled._id)).length, 0);
    assert.equal(checkouts.filter((c) => c.availabilityBlockId === String(maint._id)).length, 0);

    const cleaned = await CleaningRecord.create({
      sourceKind: 'external_hold',
      sourceId: String(airbnbOut._id),
      availabilityBlockId: airbnbOut._id,
      sourceReference: airbnbOut.sourceReference,
      cabinId: cabinA._id,
      unitId: unit3._id,
      cleaningDate: today,
      status: 'cleaned',
      paymentStatus: 'unpaid',
      markedCleanedAt: new Date(),
      markedCleanedBy: 'test'
    });
    created.records.push(cleaned._id);

    let after = await getCleaningSchedule({ date: today.toISOString() });
    let airbnbAfter = after.checkouts.find((c) => c.taskId === airbnbTask.taskId);
    assert.equal(airbnbAfter.status, 'cleaned');
    assert.equal(airbnbAfter.paymentStatus, 'unpaid');

    cleaned.paymentStatus = 'paid';
    cleaned.markedPaidAt = new Date();
    await cleaned.save();
    after = await getCleaningSchedule({ date: today.toISOString() });
    airbnbAfter = after.checkouts.find((c) => c.taskId === airbnbTask.taskId);
    assert.equal(airbnbAfter.status, 'cleaned');
    assert.equal(airbnbAfter.paymentStatus, 'paid');

    const paidPending = await CleaningRecord.create({
      sourceKind: 'booking',
      sourceId: String(directOut._id),
      bookingId: directOut._id,
      cabinId: cabinA._id,
      unitId: unit2._id,
      cleaningDate: today,
      status: 'pending',
      paymentStatus: 'paid',
      markedPaidAt: new Date(),
      markedPaidBy: 'admin'
    });
    created.records.push(paidPending._id);
    after = await getCleaningSchedule({ date: today.toISOString() });
    const directAfter = after.checkouts.find((c) => c.taskId === directTask.taskId);
    assert.equal(directAfter.status, 'pending');
    assert.equal(directAfter.paymentStatus, 'paid');

    await AvailabilityBlock.updateOne(
      { _id: airbnbOut._id },
      { $set: { 'metadata.summary': 'Reserved — guest' } }
    );
    after = await getCleaningSchedule({ date: today.toISOString() });
    airbnbAfter = after.checkouts.find((c) => c.taskId === airbnbTask.taskId);
    assert.equal(airbnbAfter.status, 'cleaned');
    assert.equal(airbnbAfter.paymentStatus, 'paid');

    await AvailabilityBlock.updateOne(
      { _id: airbnbOut._id },
      { $set: { endDate: tomorrow, startDate: today } }
    );
    await Booking.deleteOne({ _id: directInSame._id });
    const movedDay = await getCleaningSchedule({ date: tomorrow.toISOString() });
    const moved = movedDay.checkouts.find(
      (c) => c.taskId === buildTaskId('external_hold', String(airbnbOut._id))
    );
    assert.ok(moved, 'moved Airbnb checkout missing on new day');
    assert.equal(moved.status, 'cleaned');
    assert.equal(moved.paymentStatus, 'paid');

    console.log(JSON.stringify({ ok: true, tag: TAG, checkoutCount: checkouts.length }, null, 2));
  } finally {
    if (created.records.length) await CleaningRecord.deleteMany({ _id: { $in: created.records } });
    if (created.bookings.length || created.blocks.length) {
      await CleaningRecord.deleteMany({
        $or: [
          { bookingId: { $in: created.bookings } },
          { availabilityBlockId: { $in: created.blocks } }
        ]
      });
    }
    if (created.bookings.length) await Booking.deleteMany({ _id: { $in: created.bookings } });
    if (created.blocks.length) await AvailabilityBlock.deleteMany({ _id: { $in: created.blocks } });
    if (created.units.length) await Unit.deleteMany({ _id: { $in: created.units } });
    if (created.cabins.length) await Cabin.deleteMany({ _id: { $in: created.cabins } });
    if (created.types.length) await CabinType.deleteMany({ _id: { $in: created.types } });
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
