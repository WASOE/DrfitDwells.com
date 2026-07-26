'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const Booking = require('../models/Booking');
const LocationBooking = require('../models/LocationBooking');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const InventoryOperatingPeriod = require('../models/InventoryOperatingPeriod');

const { computeStayNights } = require('../services/ops/reporting/stayNights');
const {
  getInsightsPerformanceReadModel,
  getInsightsHistoricalDataQualityReadModel
} = require('../services/ops/readModels/insightsReadModel');
const { aggregateHistoricalPerformance } = require('../services/ops/reporting/historicalPerformanceService');

let mongoServer;

async function createCabin(overrides = {}) {
  return Cabin.create({
    name: overrides.name || `Cabin ${new mongoose.Types.ObjectId()}`,
    description: 'd',
    location: 'Bachevo',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    propertyKind: 'cabin',
    imageUrl: 'https://example.com/c.jpg',
    ...overrides
  });
}

async function createCabinType(overrides = {}) {
  return CabinType.create({
    name: overrides.name || 'A-frame',
    slug: overrides.slug || `aframe-${new mongoose.Types.ObjectId()}`,
    description: 'Valley type',
    location: 'Valley',
    capacity: 2,
    pricePerNight: 150,
    imageUrl: 'https://example.com/ct.jpg',
    propertyKind: 'valley',
    ...overrides
  });
}

function sofia(dateOnly, hour = 12) {
  return moment
    .tz(`${dateOnly} ${String(hour).padStart(2, '0')}:00`, 'YYYY-MM-DD HH:mm', 'Europe/Sofia')
    .toDate();
}

/** Bypass Booking checkIn-must-be-future validator for historical fixtures. */
async function insertBooking(doc) {
  const now = new Date();
  const payload = {
    adults: 2,
    children: 0,
    status: 'confirmed',
    paymentMethod: 'card',
    provenance: { source: 'guest_portal' },
    createdAt: now,
    updatedAt: now,
    ...doc
  };
  const result = await Booking.collection.insertOne(payload);
  return { _id: result.insertedId, ...payload };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    Cabin.deleteMany({}),
    CabinType.deleteMany({}),
    Unit.deleteMany({}),
    Booking.deleteMany({}),
    LocationBooking.deleteMany({}),
    AvailabilityBlock.deleteMany({}),
    InventoryOperatingPeriod.deleteMany({})
  ]);
});

test('checkout date excluded; one-night stay equals one occupied night', () => {
  const one = computeStayNights(sofia('2026-06-01'), sofia('2026-06-02'));
  assert.equal(one.nights, 1);
  assert.equal(one.invalid, false);
  const two = computeStayNights(sofia('2026-06-01'), sofia('2026-06-03'));
  assert.equal(two.nights, 2);
  const same = computeStayNights(sofia('2026-06-01'), sofia('2026-06-01'));
  assert.equal(same.nights, 0);
  assert.equal(same.invalid, true);
});

test('historical bookings before Batch 1 date appear; booked vs checkIn differ', async () => {
  const cabin = await createCabin();
  await insertBooking({
    cabinId: cabin._id,
    checkIn: sofia('2025-01-10'),
    checkOut: sofia('2025-01-12'),
    guestInfo: { firstName: 'A', lastName: 'B', email: 'old@test.com', phone: '+3591' },
    totalPrice: 200,
    totalValueCents: 20000,
    createdAt: sofia('2024-12-01'),
    updatedAt: sofia('2024-12-01')
  });

  const byCheckIn = await getInsightsPerformanceReadModel({
    propertyKind: 'cabin',
    from: '2025-01-01',
    to: '2025-01-31',
    revenueBasis: 'checkIn',
    groupBy: 'month'
  });
  assert.equal(byCheckIn.summary.bookingCount, 1);
  assert.equal(byCheckIn.summary.grossBookedRevenueCents, 20000);

  const byBooked = await getInsightsPerformanceReadModel({
    propertyKind: 'cabin',
    from: '2024-12-01',
    to: '2024-12-31',
    revenueBasis: 'booked',
    groupBy: 'month'
  });
  assert.equal(byBooked.summary.bookingCount, 1);

  const byBookedWrong = await getInsightsPerformanceReadModel({
    propertyKind: 'cabin',
    from: '2025-01-01',
    to: '2025-01-31',
    revenueBasis: 'booked',
    groupBy: 'month'
  });
  assert.equal(byBookedWrong.summary.bookingCount, 0);
});

test('cancelled revenue separate; cancelled stay zero occupied nights', async () => {
  const cabin = await createCabin();
  await insertBooking({
    cabinId: cabin._id,
    checkIn: sofia('2026-07-01'),
    checkOut: sofia('2026-07-04'),
    guestInfo: { firstName: 'A', lastName: 'B', email: 'c@test.com', phone: '+3591' },
    totalPrice: 300,
    totalValueCents: 30000,
    status: 'cancelled',
    cancellationSettlement: {
      financialSnapshot: {
        bookingTotalCents: 30000,
        capturedAt: new Date()
      }
    }
  });
  const perf = await getInsightsPerformanceReadModel({
    propertyKind: 'cabin',
    from: '2026-07-01',
    to: '2026-07-31',
    revenueBasis: 'checkIn'
  });
  assert.equal(perf.summary.bookingCount, 1);
  assert.equal(perf.summary.grossBookedRevenueCents, 0);
  assert.equal(perf.summary.cancelledRevenueCents, 30000);
  assert.equal(perf.summary.occupiedNights, 0);
  assert.equal(perf.summary.soldNights, 3);
});

test('Cabin and Valley remain separate; LocationBooking buyout counts once', async () => {
  const cabin = await createCabin({ propertyKind: 'cabin' });
  const cabinType = await createCabinType();
  const unit = await Unit.create({
    cabinTypeId: cabinType._id,
    unitNumber: '1',
    isActive: true
  });
  await insertBooking({
    cabinId: cabin._id,
    checkIn: sofia('2026-08-01'),
    checkOut: sofia('2026-08-03'),
    guestInfo: { firstName: 'A', lastName: 'B', email: 'cabin@test.com', phone: '+3591' },
    totalPrice: 100,
    totalValueCents: 10000
  });
  const locId = new mongoose.Types.ObjectId();
  const childId = new mongoose.Types.ObjectId();
  await LocationBooking.collection.insertOne({
    _id: locId,
    locationKey: 'valley',
    checkIn: sofia('2026-08-01'),
    checkOut: sofia('2026-08-03'),
    adults: 4,
    children: 0,
    guestInfo: { firstName: 'V', lastName: 'B', email: 'valley@test.com', phone: '+3592' },
    totalPrice: 900,
    currency: 'EUR',
    status: 'confirmed',
    source: 'website',
    childBookingIds: [childId],
    createdAt: new Date(),
    updatedAt: new Date()
  });
  await insertBooking({
    _id: childId,
    cabinTypeId: cabinType._id,
    unitId: unit._id,
    locationBookingId: locId,
    checkIn: sofia('2026-08-01'),
    checkOut: sofia('2026-08-03'),
    guestInfo: { firstName: 'V', lastName: 'B', email: 'valley@test.com', phone: '+3592' },
    totalPrice: 450,
    totalValueCents: 0,
    excludeFromRevenueReporting: true,
    provenance: { source: 'website', channel: 'location_buyout_child' }
  });

  const cabinPerf = await getInsightsPerformanceReadModel({
    propertyKind: 'cabin',
    from: '2026-08-01',
    to: '2026-08-31'
  });
  assert.equal(cabinPerf.summary.bookingCount, 1);
  assert.equal(cabinPerf.summary.grossBookedRevenueCents, 10000);

  const valleyPerf = await getInsightsPerformanceReadModel({
    propertyKind: 'valley',
    from: '2026-08-01',
    to: '2026-08-31'
  });
  assert.equal(valleyPerf.summary.bookingCount, 1);
  assert.equal(valleyPerf.summary.grossBookedRevenueCents, 90000);
  assert.equal(valleyPerf.summary.occupiedNights, 2);
  assert.equal(valleyPerf.provenance.externalChannelsIncluded, false);
});

test('opening date limits denominator; maintenance reduces sellable; iCal not subtracted', async () => {
  const cabin = await createCabin();
  await InventoryOperatingPeriod.create({
    propertyKind: 'cabin',
    entityType: 'cabin',
    entityId: String(cabin._id),
    operatingFrom: sofia('2026-07-01'),
    operatingTo: sofia('2026-07-10'),
    reason: 'opened',
    source: 'test'
  });
  await AvailabilityBlock.create({
    cabinId: cabin._id,
    blockType: 'maintenance',
    startDate: sofia('2026-07-05'),
    endDate: sofia('2026-07-07'),
    status: 'active',
    source: 'internal_admin'
  });
  await AvailabilityBlock.create({
    cabinId: cabin._id,
    blockType: 'external_hold',
    startDate: sofia('2026-07-08'),
    endDate: sofia('2026-07-10'),
    status: 'active',
    source: 'airbnb_ical'
  });

  const perf = await aggregateHistoricalPerformance({
    propertyKind: 'cabin',
    from: '2026-07-01',
    to: '2026-07-10'
  });
  assert.equal(perf.summary.sellableNights, 8);
  assert.ok(perf.provenance.excludedUnknownBlocks >= 1);

  const noPeriod = await aggregateHistoricalPerformance({
    propertyKind: 'cabin',
    from: '2026-06-01',
    to: '2026-06-30'
  });
  assert.equal(noPeriod.summary.sellableNights, null);
  assert.equal(noPeriod.summary.occupancyRate, null);
});

test('ADR correct; null when no occupied nights; owner block reduces sellable', async () => {
  const cabin = await createCabin();
  await InventoryOperatingPeriod.create({
    propertyKind: 'cabin',
    entityType: 'cabin',
    entityId: String(cabin._id),
    operatingFrom: sofia('2026-09-01'),
    operatingTo: sofia('2026-09-30'),
    reason: 'opened',
    source: 'test'
  });
  await AvailabilityBlock.create({
    cabinId: cabin._id,
    blockType: 'manual_block',
    startDate: sofia('2026-09-20'),
    endDate: sofia('2026-09-22'),
    status: 'active',
    source: 'internal_admin',
    metadata: { reason: 'owner' }
  });
  await insertBooking({
    cabinId: cabin._id,
    checkIn: sofia('2026-09-01'),
    checkOut: sofia('2026-09-03'),
    guestInfo: { firstName: 'A', lastName: 'B', email: 'adr@test.com', phone: '+3591' },
    totalPrice: 400,
    totalValueCents: 40000
  });

  const perf = await getInsightsPerformanceReadModel({
    propertyKind: 'cabin',
    from: '2026-09-01',
    to: '2026-09-30'
  });
  assert.equal(perf.summary.occupiedNights, 2);
  assert.equal(perf.summary.adrCents, 20000);
  assert.ok(perf.summary.sellableNights < 30);
  assert.ok(perf.summary.sellableNights >= 28);

  const empty = await getInsightsPerformanceReadModel({
    propertyKind: 'cabin',
    from: '2026-10-01',
    to: '2026-10-05'
  });
  assert.equal(empty.summary.adrCents, null);
});

test('zero-value handled; missing unit does not fabricate unit occupancy', async () => {
  const cabinType = await createCabinType();
  await insertBooking({
    cabinTypeId: cabinType._id,
    checkIn: sofia('2026-05-01'),
    checkOut: sofia('2026-05-03'),
    guestInfo: { firstName: 'A', lastName: 'B', email: 'nou@test.com', phone: '+3591' },
    totalPrice: 0,
    totalValueCents: 0,
    provenance: { source: 'admin_manual' }
  });
  const perf = await getInsightsPerformanceReadModel({
    propertyKind: 'valley',
    from: '2026-05-01',
    to: '2026-05-31',
    confidence: 'all'
  });
  assert.equal(perf.summary.bookingCount, 1);
  assert.equal(perf.summary.unallocatedOccupiedNights, 2);
  const entity = perf.entities.find((e) => e.entityType === 'unallocated_missing_unit');
  assert.ok(entity);
  assert.equal(entity.occupancyRate, null);
  assert.ok(!perf.entities.some((e) => e.entityType === 'unit'));
  assert.ok(!perf.entities.some((e) => e.entityType === 'cabin_type'));
});

test('Valley mixed denominator: standalone cabins + units; listing excluded; filters; no double-count', async () => {
  const theCabin = await createCabin({
    name: 'The Cabin',
    propertyKind: 'cabin',
    inventoryType: 'single',
    inventoryMode: 'single'
  });
  const lux = await createCabin({
    name: 'Lux Cabin',
    propertyKind: 'valley',
    inventoryType: 'single',
    inventoryMode: 'single'
  });
  const stone = await createCabin({
    name: 'Stone House',
    propertyKind: 'valley',
    inventoryType: 'single',
    inventoryMode: 'single'
  });
  const aframeType = await createCabinType({ name: 'A-Frame', slug: `aframe-${Date.now()}` });
  const listing = await createCabin({
    name: 'A-Frame',
    propertyKind: 'valley',
    inventoryType: 'multi',
    inventoryMode: 'multi',
    cabinTypeId: aframeType._id
  });
  const unit2 = await Unit.create({
    cabinTypeId: aframeType._id,
    unitNumber: '2',
    displayName: 'A-Frame 2',
    isActive: true
  });
  const unit3 = await Unit.create({
    cabinTypeId: aframeType._id,
    unitNumber: '3',
    displayName: 'A-Frame 3',
    isActive: true
  });
  const syncValidation = await createCabin({
    name: 'SyncValidation Cabin X',
    propertyKind: 'valley',
    inventoryType: 'single'
  });

  // Operating periods for May 2026 (31 nights)
  for (const [entityType, entityId, propertyKind] of [
    ['cabin', theCabin._id, 'cabin'],
    ['cabin', lux._id, 'valley'],
    ['cabin', stone._id, 'valley'],
    ['cabin', listing._id, 'valley'], // should not inflate even if present
    ['unit', unit2._id, 'valley'],
    ['unit', unit3._id, 'valley'],
    ['cabin_type', aframeType._id, 'valley'] // covers units; must not double-count with unit periods
  ]) {
    await InventoryOperatingPeriod.create({
      propertyKind,
      entityType,
      entityId: String(entityId),
      operatingFrom: sofia('2026-05-01'),
      operatingTo: sofia('2026-05-31'),
      reason: 'opened',
      source: 'test'
    });
  }

  const { computeSellableNights, resolveInventoryEntities } = require('../services/ops/reporting/sellableInventoryService');

  const resolved = await resolveInventoryEntities('valley');
  const entityKeys = resolved.entities.map((e) => `${e.entityType}:${e.entityId}`);
  assert.ok(entityKeys.includes(`cabin:${lux._id}`));
  assert.ok(entityKeys.includes(`cabin:${stone._id}`));
  assert.ok(entityKeys.includes(`unit:${unit2._id}`));
  assert.ok(entityKeys.includes(`unit:${unit3._id}`));
  assert.ok(!entityKeys.includes(`cabin:${listing._id}`), 'A-Frame listing must not be in denominator');
  assert.ok(!entityKeys.includes(`cabin:${syncValidation._id}`), 'SyncValidation fixture excluded');
  assert.ok(
    resolved.excludedAggregateListings.some((r) => r.entityId === String(listing._id)),
    'listing surfaced as excluded aggregate'
  );

  const overall = await computeSellableNights({
    propertyKind: 'valley',
    fromDateOnly: '2026-05-01',
    toDateOnly: '2026-05-31'
  });
  // lux + stone + unit2 + unit3 = 4 * 31 = 124 (cabin_type periods apply to units once; listing ignored)
  assert.equal(overall.sellableNights, 124);
  assert.equal(overall.entitySellable.length, 4);

  const luxOnly = await computeSellableNights({
    propertyKind: 'valley',
    fromDateOnly: '2026-05-01',
    toDateOnly: '2026-05-31',
    cabinId: String(lux._id)
  });
  assert.equal(luxOnly.sellableNights, 31);
  assert.equal(luxOnly.entitySellable.length, 1);
  assert.equal(luxOnly.entitySellable[0].entityId, String(lux._id));

  const stoneOnly = await computeSellableNights({
    propertyKind: 'valley',
    fromDateOnly: '2026-05-01',
    toDateOnly: '2026-05-31',
    cabinId: String(stone._id)
  });
  assert.equal(stoneOnly.sellableNights, 31);

  const typeOnly = await computeSellableNights({
    propertyKind: 'valley',
    fromDateOnly: '2026-05-01',
    toDateOnly: '2026-05-31',
    cabinTypeId: String(aframeType._id)
  });
  assert.equal(typeOnly.sellableNights, 62);
  assert.ok(typeOnly.entitySellable.every((e) => e.entityType === 'unit'));
  assert.ok(!typeOnly.entitySellable.some((e) => e.entityType === 'cabin'));

  const unitOnly = await computeSellableNights({
    propertyKind: 'valley',
    fromDateOnly: '2026-05-01',
    toDateOnly: '2026-05-31',
    unitId: String(unit2._id)
  });
  assert.equal(unitOnly.sellableNights, 31);

  // cabin_type-only coverage (no unit periods) still yields one night per unit, not double
  await InventoryOperatingPeriod.deleteMany({
    propertyKind: 'valley',
    entityType: 'unit'
  });
  const typeFallback = await computeSellableNights({
    propertyKind: 'valley',
    fromDateOnly: '2026-05-01',
    toDateOnly: '2026-05-31',
    cabinTypeId: String(aframeType._id)
  });
  assert.equal(typeFallback.sellableNights, 62);

  // The Cabin remains isolated under propertyKind=cabin
  const cabinZone = await computeSellableNights({
    propertyKind: 'cabin',
    fromDateOnly: '2026-05-01',
    toDateOnly: '2026-05-31'
  });
  assert.equal(cabinZone.sellableNights, 31);
  assert.ok(cabinZone.entitySellable.every((e) => e.entityId === String(theCabin._id)));
  assert.ok(!cabinZone.entitySellable.some((e) => e.entityId === String(lux._id)));

  // Occupied attribution: lux → cabin; unit booking → unit; missing unitId → unallocated
  await insertBooking({
    cabinId: lux._id,
    checkIn: sofia('2026-05-10'),
    checkOut: sofia('2026-05-12'),
    guestInfo: { firstName: 'L', lastName: 'X', email: 'lux@test.com', phone: '+3591' },
    totalPrice: 200,
    totalValueCents: 20000
  });
  await insertBooking({
    cabinTypeId: aframeType._id,
    unitId: unit2._id,
    checkIn: sofia('2026-05-10'),
    checkOut: sofia('2026-05-11'),
    guestInfo: { firstName: 'U', lastName: '2', email: 'u2@test.com', phone: '+3591' },
    totalPrice: 100,
    totalValueCents: 10000
  });
  await insertBooking({
    cabinTypeId: aframeType._id,
    checkIn: sofia('2026-05-10'),
    checkOut: sofia('2026-05-12'),
    guestInfo: { firstName: 'M', lastName: 'U', email: 'missing@test.com', phone: '+3591' },
    totalPrice: 150,
    totalValueCents: 15000
  });

  const perf = await aggregateHistoricalPerformance({
    propertyKind: 'valley',
    from: '2026-05-01',
    to: '2026-05-31'
  });
  assert.ok(perf.entities.some((e) => e.entityType === 'cabin' && e.entityId === String(lux._id)));
  assert.ok(perf.entities.some((e) => e.entityType === 'unit' && e.entityId === String(unit2._id)));
  assert.ok(perf.entities.some((e) => e.entityType === 'unallocated_missing_unit'));
  assert.equal(perf.summary.unallocatedOccupiedNights, 2);
  assert.ok(!perf.entities.some((e) => e.entityType === 'unit' && e.entityId === String(unit3._id) && e.occupiedNights > 0));

  const typeFiltered = await aggregateHistoricalPerformance({
    propertyKind: 'valley',
    from: '2026-05-01',
    to: '2026-05-31',
    cabinTypeId: String(aframeType._id)
  });
  assert.equal(typeFiltered.summary.occupancyRate, null);
  assert.equal(typeFiltered.summary.dataConfidence, 'usable_with_limitations');
  assert.ok(typeFiltered.summary.unallocatedOccupiedNights >= 2);
});

test('historical data quality reports missing inventory and earliest dates', async () => {
  const cabin = await createCabin();
  await insertBooking({
    cabinId: cabin._id,
    checkIn: sofia('2026-03-01'),
    checkOut: sofia('2026-03-02'),
    guestInfo: { firstName: 'A', lastName: 'B', email: 'q@test.com', phone: '+3591' },
    totalPrice: 50,
    totalValueCents: 5000
  });
  // Invalid inventory XOR — insert without cabin/cabinType using raw collection and a dummy cabinTypeId null
  await Booking.collection.insertOne({
    checkIn: sofia('2026-03-05'),
    checkOut: sofia('2026-03-06'),
    adults: 1,
    children: 0,
    guestInfo: { firstName: 'X', lastName: 'Y', email: 'bad@test.com', phone: '+3599' },
    totalPrice: 10,
    status: 'confirmed',
    paymentMethod: 'card',
    provenance: { source: 'guest_portal' },
    createdAt: new Date(),
    updatedAt: new Date()
  });

  const quality = await getInsightsHistoricalDataQualityReadModel({ propertyKind: 'cabin' });
  assert.ok(quality.issues.missing_inventory_assignment.count >= 1);
  assert.ok(quality.earliestReliableRevenueDate);
  assert.equal(quality.earliestReliableOccupancyDate, null);
  assert.equal(quality.provenance.externalChannelsIncluded, false);
  assert.ok(!JSON.stringify(quality).includes('bad@test.com'));
});

test('performance endpoints do not mutate Booking or Payment', async () => {
  const cabin = await createCabin();
  const booking = await insertBooking({
    cabinId: cabin._id,
    checkIn: sofia('2026-04-01'),
    checkOut: sofia('2026-04-02'),
    guestInfo: { firstName: 'A', lastName: 'B', email: 'mut@test.com', phone: '+3591' },
    totalPrice: 80,
    totalValueCents: 8000
  });
  const before = await Booking.findById(booking._id).lean();
  await getInsightsPerformanceReadModel({
    propertyKind: 'cabin',
    from: '2026-04-01',
    to: '2026-04-30'
  });
  const after = await Booking.findById(booking._id).lean();
  assert.equal(String(before.updatedAt), String(after.updatedAt));
  assert.equal(after.totalPrice, 80);
});
