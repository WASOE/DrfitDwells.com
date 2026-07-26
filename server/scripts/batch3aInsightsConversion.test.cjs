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
const BookingFunnelEvent = require('../models/BookingFunnelEvent');
const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherCreatorCommission = require('../models/GiftVoucherCreatorCommission');
const CreatorPartner = require('../models/CreatorPartner');

const { buildRevenueBasisDateFilter } = require('../services/ops/reporting/reportingFilters');
const { buildInsightsDataQuality } = require('../services/ops/reporting/insightsDataQualityService');
const {
  getInsightsSummaryReadModel,
  getInsightsBookingsReadModel
} = require('../services/ops/readModels/insightsReadModel');
const { aggregateConversionSummary } = require('../services/conversion/conversionSummaryService');
const { ensureGiftVoucherCreatorCommissionAfterActivation } = require('../services/giftVouchers/giftVoucherCommissionService');
const { validateInsightsEntityFilters } = require('../services/ops/reporting/entityFilterValidation');

// Local copy of formatter under test (mirrors creatorPartnersRoutes).
function formatCreatorPartnerStats(stats) {
  return {
    attributedBookingValue: Number(stats?.attributedBookingValue || 0),
    paidStayRevenue: Number(stats?.paidStayRevenue || 0),
    grossBookingRevenue: Number(stats?.grossBookingRevenue || 0)
  };
}

let mongoServer;

async function createCabin(overrides = {}) {
  return Cabin.create({
    name: overrides.name || `Cabin ${new mongoose.Types.ObjectId()}`,
    description: 'd',
    location: 'Bachevo',
    capacity: 2,
    pricePerNight: 100,
    minNights: 2,
    propertyKind: overrides.propertyKind || 'cabin',
    imageUrl: 'https://example.com/cabin.jpg',
    ...overrides
  });
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await BookingFunnelEvent.syncIndexes();
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
    BookingFunnelEvent.deleteMany({}),
    GiftVoucher.deleteMany({}),
    GiftVoucherCreatorCommission.deleteMany({}),
    CreatorPartner.deleteMany({})
  ]);
});

test('booked basis includes full final Sofia calendar day', async () => {
  const cabin = await createCabin({ propertyKind: 'cabin' });
  const range = buildRevenueBasisDateFilter('booked', '2026-07-01', '2026-07-10');
  assert.ok(range);
  assert.equal(range.filter.createdAt.$gte.toISOString(), range.range.start.toISOString());
  assert.equal(range.filter.createdAt.$lt.toISOString(), range.range.endExclusive.toISOString());
  assert.ok(!('$lte' in range.filter.createdAt));

  const startInclusive = range.range.start;
  const duringFinalDay = moment
    .tz('2026-07-10 18:30', 'YYYY-MM-DD HH:mm', 'Europe/Sofia')
    .toDate();
  const nextDayBoundary = range.range.endExclusive;

  await Booking.create({
    cabinId: cabin._id,
    checkIn: new Date('2026-08-01T00:00:00.000Z'),
    checkOut: new Date('2026-08-03T00:00:00.000Z'),
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'A', lastName: 'B', email: 'start@test.com', phone: '+359800000001' },
    totalPrice: 100,
    totalValueCents: 10000,
    status: 'confirmed',
    provenance: { source: 'guest_portal' },
    createdAt: startInclusive
  });
  await Booking.create({
    cabinId: cabin._id,
    checkIn: new Date('2026-08-04T00:00:00.000Z'),
    checkOut: new Date('2026-08-06T00:00:00.000Z'),
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'A', lastName: 'B', email: 'mid@test.com', phone: '+359800000002' },
    totalPrice: 200,
    totalValueCents: 20000,
    status: 'confirmed',
    provenance: { source: 'guest_portal' },
    createdAt: duringFinalDay
  });
  await Booking.create({
    cabinId: cabin._id,
    checkIn: new Date('2026-08-07T00:00:00.000Z'),
    checkOut: new Date('2026-08-09T00:00:00.000Z'),
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'A', lastName: 'B', email: 'next@test.com', phone: '+359800000003' },
    totalPrice: 300,
    totalValueCents: 30000,
    status: 'confirmed',
    provenance: { source: 'guest_portal' },
    createdAt: nextDayBoundary
  });

  // Force createdAt (mongoose timestamps may overwrite)
  const bookings = await Booking.find({}).sort({ totalValueCents: 1 });
  await Booking.collection.updateOne(
    { _id: bookings[0]._id },
    { $set: { createdAt: startInclusive } }
  );
  await Booking.collection.updateOne(
    { _id: bookings[1]._id },
    { $set: { createdAt: duringFinalDay } }
  );
  await Booking.collection.updateOne(
    { _id: bookings[2]._id },
    { $set: { createdAt: nextDayBoundary } }
  );

  const summary = await getInsightsSummaryReadModel({
    propertyKind: 'cabin',
    from: '2026-07-01',
    to: '2026-07-10',
    revenueBasis: 'booked'
  });
  assert.equal(summary.metrics.bookingCount, 2);
  assert.equal(summary.metrics.grossBookedRevenueCents, 30000);
});

test('cross-zone cabin and cabinType filters return HTTP 400', async () => {
  const cabin = await createCabin({ propertyKind: 'cabin' });
  const cabinType = await CabinType.create({
    name: 'Valley Type',
    slug: `valley-type-${Date.now()}`,
    description: 'd',
    location: 'Valley',
    capacity: 2,
    pricePerNight: 120,
    minNights: 2,
    propertyKind: 'valley',
    imageUrl: 'https://example.com/type.jpg'
  });

  await assert.rejects(
    () =>
      validateInsightsEntityFilters({
        propertyKind: 'valley',
        cabinId: String(cabin._id)
      }),
    (err) => err.statusCode === 400 && /propertyKind/i.test(err.message)
  );

  await assert.rejects(
    () =>
      validateInsightsEntityFilters({
        propertyKind: 'cabin',
        cabinTypeId: String(cabinType._id)
      }),
    (err) => err.statusCode === 400 && /propertyKind/i.test(err.message)
  );
});

test('data-quality issue codes remain distinct', async () => {
  const cabin = await createCabin({ propertyKind: 'cabin' });
  const cabinType = await CabinType.create({
    name: 'Type A',
    slug: `type-a-${Date.now()}`,
    description: 'd',
    location: 'Valley',
    capacity: 2,
    pricePerNight: 100,
    minNights: 2,
    propertyKind: 'valley',
    imageUrl: 'https://example.com/t.jpg'
  });

  // Bypass XOR validator to seed historical invalid rows.
  await Booking.collection.insertOne({
    cabinId: cabin._id,
    cabinTypeId: cabinType._id,
    checkIn: new Date('2026-09-10T00:00:00.000Z'),
    checkOut: new Date('2026-09-12T00:00:00.000Z'),
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'A', lastName: 'B', email: 'both@test.com', phone: '+359800000010' },
    totalPrice: 100,
    status: 'confirmed',
    provenance: { source: 'guest_portal' },
    createdAt: new Date(),
    updatedAt: new Date()
  });
  await Booking.collection.insertOne({
    checkIn: new Date('2026-09-10T00:00:00.000Z'),
    checkOut: new Date('2026-09-12T00:00:00.000Z'),
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'A', lastName: 'B', email: 'none@test.com', phone: '+359800000011' },
    totalPrice: 100,
    status: 'confirmed',
    provenance: { source: 'guest_portal' },
    createdAt: new Date(),
    updatedAt: new Date()
  });

  const cabinMissingKind = await createCabin({ name: 'No Kind Cabin' });
  await Cabin.collection.updateOne({ _id: cabinMissingKind._id }, { $unset: { propertyKind: '' } });
  await Booking.create({
    cabinId: cabinMissingKind._id,
    checkIn: new Date('2026-09-10T00:00:00.000Z'),
    checkOut: new Date('2026-09-12T00:00:00.000Z'),
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'A', lastName: 'B', email: 'missingkind@test.com', phone: '+359800000012' },
    totalPrice: 100,
    status: 'confirmed',
    provenance: { source: 'guest_portal' }
  });

  const dq = await buildInsightsDataQuality({ propertyKind: 'cabin' });
  const byCode = Object.fromEntries(dq.issues.map((i) => [i.code, i.count]));
  assert.equal(byCode.both_cabin_and_cabin_type, 1);
  assert.equal(byCode.missing_inventory_ref, 1);
  assert.equal(byCode.missing_property_kind, 1);
});

test('filtered drill-down totals reconcile with summary and LocationBooking appears once', async () => {
  const cabin = await createCabin({ propertyKind: 'cabin', name: 'Cabin Reconcile' });
  await Booking.create({
    cabinId: cabin._id,
    checkIn: new Date('2026-09-10T00:00:00.000Z'),
    checkOut: new Date('2026-09-12T00:00:00.000Z'),
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'A', lastName: 'B', email: 'cabin@test.com', phone: '+359800000020' },
    totalPrice: 150,
    totalValueCents: 15000,
    stripePaidAmountCents: 15000,
    status: 'confirmed',
    provenance: { source: 'guest_portal' }
  });

  const cabinType = await CabinType.create({
    name: 'A-frame',
    slug: `aframe-${Date.now()}`,
    description: 'd',
    location: 'Valley',
    capacity: 2,
    pricePerNight: 100,
    minNights: 2,
    propertyKind: 'valley',
    imageUrl: 'https://example.com/a.jpg'
  });
  const unit = await Unit.create({
    cabinTypeId: cabinType._id,
    unitNumber: '1',
    displayName: 'Unit 1',
    isActive: true
  });

  const master = await LocationBooking.create({
    locationKey: 'valley',
    checkIn: new Date('2026-09-15T00:00:00.000Z'),
    checkOut: new Date('2026-09-18T00:00:00.000Z'),
    adults: 8,
    children: 0,
    guestInfo: { firstName: 'V', lastName: 'B', email: 'valleybuy@test.com', phone: '+359800000021' },
    totalPrice: 900,
    status: 'confirmed',
    source: 'website',
    stripePaymentIntentId: 'pi_valley_master'
  });

  await Booking.create({
    cabinTypeId: cabinType._id,
    unitId: unit._id,
    checkIn: new Date('2026-09-15T00:00:00.000Z'),
    checkOut: new Date('2026-09-18T00:00:00.000Z'),
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'C', lastName: 'H', email: 'child@test.com', phone: '+359800000022' },
    totalPrice: 300,
    totalValueCents: 30000,
    status: 'confirmed',
    provenance: { source: 'guest_portal' },
    excludeFromRevenueReporting: true,
    locationBookingId: master._id
  });

  const cabinSummary = await getInsightsSummaryReadModel({
    propertyKind: 'cabin',
    from: '2026-09-01',
    to: '2026-09-30',
    revenueBasis: 'checkIn'
  });
  const cabinBookings = await getInsightsBookingsReadModel({
    propertyKind: 'cabin',
    from: '2026-09-01',
    to: '2026-09-30',
    revenueBasis: 'checkIn',
    status: 'active'
  });
  assert.equal(cabinBookings.pagination.total, cabinSummary.metrics.bookingCount);
  assert.equal(cabinBookings.rows[0].detailHref, `/ops/reservations/${cabinBookings.rows[0].bookingId}`);

  const valleySummary = await getInsightsSummaryReadModel({
    propertyKind: 'valley',
    from: '2026-09-01',
    to: '2026-09-30',
    revenueBasis: 'checkIn'
  });
  const valleyBookings = await getInsightsBookingsReadModel({
    propertyKind: 'valley',
    from: '2026-09-01',
    to: '2026-09-30',
    revenueBasis: 'checkIn',
    status: 'active'
  });

  assert.equal(valleySummary.metrics.bookingCount, 1);
  assert.equal(valleySummary.metrics.grossBookedRevenueCents, 90000);
  assert.equal(valleyBookings.pagination.total, 1);
  assert.equal(valleyBookings.rows[0].stayKind, 'location_booking');
  assert.equal(valleyBookings.rows[0].detailHref, null);
  assert.equal(valleyBookings.rows[0].bookingId, String(master._id));
});

test('conversion entity filter scopes zone funnel but not search_results; unitId rejected', async () => {
  const cabin = await createCabin({ propertyKind: 'cabin' });
  const other = await createCabin({ propertyKind: 'cabin', name: 'Other Cabin' });

  await BookingFunnelEvent.insertMany([
    {
      eventId: '33333333-3333-4333-8333-333333333331',
      eventType: 'property_view',
      source: 'client',
      dedupeKey: 'pv:1',
      sessionKey: 's1',
      propertyKind: 'cabin',
      cabinId: cabin._id,
      createdAt: new Date('2026-06-05T10:00:00.000Z')
    },
    {
      eventId: '33333333-3333-4333-8333-333333333332',
      eventType: 'property_view',
      source: 'client',
      dedupeKey: 'pv:2',
      sessionKey: 's2',
      propertyKind: 'cabin',
      cabinId: other._id,
      createdAt: new Date('2026-06-05T11:00:00.000Z')
    },
    {
      eventId: '33333333-3333-4333-8333-333333333333',
      eventType: 'search_results',
      source: 'client',
      dedupeKey: 'sr:1',
      sessionKey: 's-search',
      searchResultCount: 3,
      createdAt: new Date('2026-06-05T12:00:00.000Z')
    }
  ]);

  const scoped = await aggregateConversionSummary({
    propertyKind: 'cabin',
    from: '2026-06-01',
    to: '2026-06-30',
    cabinId: String(cabin._id)
  });
  const propertyView = scoped.steps.find((s) => s.eventType === 'property_view');
  assert.equal(propertyView.sessionCount, 1);
  assert.equal(scoped.supplementary.searchResults.sessionCount, 1);
  assert.equal(scoped.supplementary.searchResults.siteWide, true);

  await assert.rejects(
    () =>
      aggregateConversionSummary({
        propertyKind: 'cabin',
        from: '2026-06-01',
        to: '2026-06-30',
        unitId: new mongoose.Types.ObjectId().toString()
      }),
    (err) => err.statusCode === 400 && /unitId/i.test(err.message)
  );
});

test('creator DTO preserves paidStayRevenue and attributedBookingValue', () => {
  const formatted = formatCreatorPartnerStats({
    attributedBookingValue: 123.45,
    paidStayRevenue: 67.89,
    grossBookingRevenue: 200
  });
  assert.equal(formatted.attributedBookingValue, 123.45);
  assert.equal(formatted.paidStayRevenue, 67.89);
});

test('non-purchase voucher does not accrue creator commission', async () => {
  const creator = await CreatorPartner.create({
    name: 'Creator',
    slug: `creator-${Date.now()}`,
    status: 'active',
    referral: { code: 'creator.ref', cookieDays: 30 },
    commission: { rateBps: 1000 }
  });

  for (const issuanceSource of ['cancellation_compensation', 'goodwill_ops']) {
    await GiftVoucherCreatorCommission.deleteMany({});
    const gv = await GiftVoucher.create({
      code: `DD-${issuanceSource.slice(0, 2).toUpperCase()}-${Date.now().toString().slice(-8)}`,
      amountOriginalCents: 5000,
      balanceRemainingCents: 5000,
      buyerName: 'Buyer',
      buyerEmail: 'buy@test.com',
      recipientName: 'Rec',
      recipientEmail: 'rec@test.com',
      deliveryMode: 'email',
      status: 'active',
      activatedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
      stripePaymentIntentId: `pi_${issuanceSource}`,
      issuanceSource,
      attribution: {
        referralCode: 'creator.ref',
        creatorPartnerId: creator._id
      }
    });

    const out = await ensureGiftVoucherCreatorCommissionAfterActivation(gv.toObject());
    assert.equal(out.ok, true);
    assert.equal(out.skipped, true);
    assert.equal(out.code, 'issuance_source_not_purchase');
    assert.equal(await GiftVoucherCreatorCommission.countDocuments({}), 0);
  }
});
