#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Batch 5A historical data audit (read-only).
 *
 *   node server/scripts/auditHistoricalDirectSales.cjs
 *
 * Prints JSON covering Booking / LocationBooking coverage, inventory, blocks,
 * and confidence classification hints. Does not mutate data.
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const { FIXTURE_BOOKING_EMAIL_PATTERN } = require('../utils/fixtureExclusion');

async function runAudit() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 12000 });
  const db = mongoose.connection.db;

  const bookings = db.collection('bookings');
  const locs = db.collection('locationbookings');
  const cabins = db.collection('cabins');
  const cabinTypes = db.collection('cabintypes');
  const units = db.collection('units');
  const blocks = db.collection('availabilityblocks');
  const periods = db.collection('inventoryoperatingperiods');

  const nonTest = {
    isTest: { $ne: true },
    $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }],
    'guestInfo.email': { $not: FIXTURE_BOOKING_EMAIL_PATTERN }
  };

  const totalBookings = await bookings.countDocuments({});
  const reportingBookings = await bookings.countDocuments({
    ...nonTest,
    excludeFromRevenueReporting: { $ne: true }
  });
  const earliestCreated = await bookings
    .find(nonTest)
    .sort({ createdAt: 1 })
    .limit(1)
    .project({ createdAt: 1, checkIn: 1, status: 1 })
    .toArray();
  const earliestCheckIn = await bookings
    .find({ ...nonTest, checkIn: { $exists: true } })
    .sort({ checkIn: 1 })
    .limit(1)
    .project({ createdAt: 1, checkIn: 1, status: 1 })
    .toArray();
  const earliestLoc = await locs
    .find({ 'guestInfo.email': { $not: FIXTURE_BOOKING_EMAIL_PATTERN } })
    .sort({ createdAt: 1 })
    .limit(1)
    .project({ createdAt: 1, checkIn: 1, status: 1 })
    .toArray();

  const byMonth = await bookings
    .aggregate([
      { $match: { ...nonTest, excludeFromRevenueReporting: { $ne: true } } },
      {
        $group: {
          _id: {
            y: { $year: '$checkIn' },
            m: { $month: '$checkIn' }
          },
          n: { $sum: 1 },
          cancelled: {
            $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
          }
        }
      },
      { $sort: { '_id.y': 1, '_id.m': 1 } }
    ])
    .toArray();

  const missingInventory = await bookings.countDocuments({
    ...nonTest,
    cabinId: null,
    cabinTypeId: null
  });
  const bothInventory = await bookings.countDocuments({
    ...nonTest,
    cabinId: { $ne: null },
    cabinTypeId: { $ne: null }
  });
  const valleyMissingUnit = await bookings.countDocuments({
    ...nonTest,
    cabinTypeId: { $ne: null },
    unitId: null,
    excludeFromRevenueReporting: { $ne: true }
  });
  const cancelled = await bookings.countDocuments({ ...nonTest, status: 'cancelled' });
  const cancelledWithSnap = await bookings.countDocuments({
    ...nonTest,
    status: 'cancelled',
    'cancellationSettlement.financialSnapshot.capturedAt': { $ne: null }
  });
  const zeroValue = await bookings.countDocuments({
    ...nonTest,
    excludeFromRevenueReporting: { $ne: true },
    $or: [{ totalPrice: 0 }, { totalValueCents: 0 }]
  });
  const isTest = await bookings.countDocuments({ isTest: true });
  const archived = await bookings.countDocuments({ archivedAt: { $ne: null } });
  const excludeRev = await bookings.countDocuments({ excludeFromRevenueReporting: true });
  const locationMasters = await locs.countDocuments({});
  const children = await bookings.countDocuments({ locationBookingId: { $ne: null } });

  const cabinCreated = await cabins
    .find({})
    .sort({ createdAt: 1 })
    .limit(5)
    .project({ name: 1, createdAt: 1, propertyKind: 1, isActive: 1 })
    .toArray();
  const cabinPkMissing = await cabins.countDocuments({
    $or: [{ propertyKind: null }, { propertyKind: { $exists: false } }]
  });
  const blockTypes = await blocks
    .aggregate([
      {
        $group: {
          _id: { t: '$blockType', s: '$source', st: '$status' },
          n: { $sum: 1 },
          minStart: { $min: '$startDate' },
          maxEnd: { $max: '$endDate' }
        }
      },
      { $sort: { n: -1 } }
    ])
    .toArray();
  const operatingPeriodCount = await periods.countDocuments({});

  const report = {
    auditAt: new Date().toISOString(),
    totals: {
      totalBookings,
      reportingBookings,
      locationMasters,
      children,
      isTest,
      archived,
      excludeFromRevenueReporting: excludeRev
    },
    earliestReliableBookingCreatedAt: earliestCreated[0]?.createdAt || null,
    earliestReliableBookingCheckIn: earliestCheckIn[0]?.checkIn || null,
    earliestReliableLocationBooking: earliestLoc[0]?.createdAt || earliestLoc[0]?.checkIn || null,
    recordsByYearMonth: byMonth.map((row) => ({
      year: row._id.y,
      month: row._id.m,
      count: row.n,
      cancelled: row.cancelled
    })),
    missingPropertyKindHint:
      'Booking has no propertyKind field; resolved via Cabin/CabinType. Count cabins/cabinTypes missing propertyKind.',
    cabinsMissingPropertyKind: cabinPkMissing,
    missingInventoryAssignment: missingInventory,
    bothCabinAndCabinType: bothInventory,
    valleyBookingsMissingUnit: valleyMissingUnit,
    cancelledWithFinancialSnapshot: cancelledWithSnap,
    cancelledWithoutFinancialSnapshot: cancelled - cancelledWithSnap,
    zeroValueOrManual: zeroValue,
    inventoryCreationDates: cabinCreated,
    operatingPeriodsConfigured: operatingPeriodCount,
    operatingStartNote:
      'Do not treat Cabin.createdAt as operating start without explicit InventoryOperatingPeriod review.',
    availabilityBlocks: blockTypes,
    icalClassification:
      'external_hold / airbnb_ical is availability only and cannot be auto-classified as paid stays.',
    confidenceGuidance: {
      verified: 'Resolved propertyKind, valid dates, operating period covers occupancy window',
      usable_with_limitations: 'Missing unit on Valley, soft DQ issues',
      revenue_only: 'Revenue trustworthy; occupancy denominator unavailable',
      unreliable: 'Missing inventory, invalid dates, conflicting refs'
    },
    historicalOccupancyTrust:
      operatingPeriodCount === 0
        ? 'No periods configured — occupancy unreliable for all history until backfill.'
        : 'Occupancy trustworthy only inside configured InventoryOperatingPeriod ranges minus verified maintenance/manual blocks.',
    historicalRevenueTrust:
      'Direct Booking + LocationBooking revenue trustworthy where propertyKind resolves and fixtures/tests excluded.',
    repairableVsAmbiguous: {
      repairable: [
        'Cabin/CabinType propertyKind via backfillPropertyKind.js',
        'InventoryOperatingPeriod explicit upsert',
        'Mark isTest / archive fixtures',
        'Link known unitId where operationally known'
      ],
      permanentlyAmbiguous: [
        'Unidentified historical iCal blocks as paid Airbnb stays',
        'Pre-operating-period sellable nights without documentation',
        'Cancelled bookings without financialSnapshot'
      ]
    }
  };

  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
  return report;
}

if (require.main === module) {
  runAudit().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err.message }));
    process.exit(2);
  });
}

module.exports = { runAudit };
