'use strict';

/**
 * Inventory Integrity I1 — READ-ONLY dry-run projection of expected UnitNightClaims.
 *
 * Usage:
 *   cd server && node scripts/unitNightClaimIntegrityDryRun.js
 *   cd server && node scripts/unitNightClaimIntegrityDryRun.js --json
 *
 * Default mode NEVER writes UnitNightClaim or Booking documents.
 * --apply / bootstrap write modes are intentionally NOT authorized in I1.
 *
 * Binding: docs/stay-change-implementation-plan.md Batch I / I1–I5
 */

const crypto = require('crypto');
const path = require('path');

// Allow requiring from server/ when run as node scripts/...
const root = path.join(__dirname, '..');
process.chdir(root);

const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Unit = require('../models/Unit');
const UnitNightClaim = require('../models/UnitNightClaim');
const { BLOCKING_BOOKING_STATUSES } = require('../services/calendar/blockingStatusConstants');
const { baseBookingFilter } = require('../services/ops/reporting/reportingFilters');
const { expandOccupiedSofiaNightDateOnlys } = require('../services/ops/reporting/stayNights');
const { formatSofiaDateOnly } = require('../utils/dateTime');

function hashEmail(email) {
  const normalized = String(email || '')
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 16);
}

function parseArgs(argv) {
  const args = {
    json: false,
    apply: false,
    mongoUri: process.env.MONGODB_URI || process.env.MONGO_URI || null
  };
  for (const a of argv) {
    if (a === '--json') args.json = true;
    if (a === '--apply' || a === '--bootstrap') args.apply = true;
    if (a.startsWith('--mongo=')) args.mongoUri = a.slice('--mongo='.length);
  }
  return args;
}

function buildScanFilter() {
  return {
    ...baseBookingFilter(),
    status: { $in: BLOCKING_BOOKING_STATUSES },
    unitId: { $exists: true, $ne: null },
    cabinTypeId: { $exists: true, $ne: null }
  };
}

/**
 * Project expected ownership without writing.
 * @param {object} [opts]
 * @param {import('mongoose').Model} [opts.BookingModel]
 * @param {import('mongoose').Model} [opts.UnitModel]
 */
async function projectUnitNightClaimIntegrity(opts = {}) {
  const BookingModel = opts.BookingModel || Booking;
  const UnitModel = opts.UnitModel || Unit;
  const detectedAt = new Date().toISOString();

  const bookings = await BookingModel.find(buildScanFilter())
    .select(
      '_id status checkIn checkOut unitId cabinTypeId cabinId guestInfo.email locationBookingId isTest archivedAt'
    )
    .lean();

  const unitIds = [...new Set(bookings.map((b) => String(b.unitId)).filter(Boolean))];
  const units = await UnitModel.find({ _id: { $in: unitIds } })
    .select('_id unitNumber displayName cabinTypeId isActive')
    .lean();
  const unitById = new Map(units.map((u) => [String(u._id), u]));

  /** @type {Map<string, object[]>} */
  const byUnitNight = new Map();
  const invalidAllocations = [];
  let expectedClaims = 0;
  let malformedRanges = 0;

  for (const booking of bookings) {
    const bookingId = String(booking._id);
    const unitId = booking.unitId ? String(booking.unitId) : null;
    const cabinTypeId = booking.cabinTypeId ? String(booking.cabinTypeId) : null;
    const unit = unitId ? unitById.get(unitId) : null;

    if (!unitId || !cabinTypeId) {
      invalidAllocations.push({
        type: 'missing_unit_or_cabinType',
        bookingId,
        status: booking.status,
        unitId,
        cabinTypeId,
        detectedAt
      });
      continue;
    }

    if (!unit) {
      invalidAllocations.push({
        type: 'unit_not_found',
        bookingId,
        status: booking.status,
        unitId,
        cabinTypeId,
        detectedAt
      });
      continue;
    }

    if (String(unit.cabinTypeId) !== cabinTypeId) {
      invalidAllocations.push({
        type: 'unit_cabinType_mismatch',
        bookingId,
        status: booking.status,
        unitId,
        cabinTypeId,
        unitCabinTypeId: String(unit.cabinTypeId),
        unitLabel: unit.displayName || unit.unitNumber || null,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        guestEmailHash: hashEmail(booking.guestInfo?.email),
        detectedAt
      });
    }

    const expanded = expandOccupiedSofiaNightDateOnlys(booking.checkIn, booking.checkOut);
    if (!expanded.ok) {
      malformedRanges += 1;
      invalidAllocations.push({
        type: 'malformed_range',
        bookingId,
        status: booking.status,
        unitId,
        cabinTypeId,
        reason: expanded.reason,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        guestEmailHash: hashEmail(booking.guestInfo?.email),
        detectedAt
      });
      continue;
    }

    for (const night of expanded.dateOnlys) {
      expectedClaims += 1;
      const key = `${unitId}|${night}`;
      if (!byUnitNight.has(key)) byUnitNight.set(key, []);
      byUnitNight.get(key).push({
        bookingId,
        status: booking.status,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        cabinTypeId,
        unitId,
        unitLabel: unit.displayName || unit.unitNumber || null,
        guestEmailHash: hashEmail(booking.guestInfo?.email),
        locationBookingId: booking.locationBookingId ? String(booking.locationBookingId) : null
      });
    }
  }

  const conflicts = [];
  let cleanUnitNights = 0;

  for (const [key, owners] of byUnitNight.entries()) {
    const [unitId, night] = key.split('|');
    if (owners.length > 1) {
      conflicts.push({
        unitId,
        unitLabel: owners[0].unitLabel || null,
        cabinTypeId: owners[0].cabinTypeId,
        night,
        bookingIds: owners.map((o) => o.bookingId),
        bookings: owners.map((o) => ({
          id: o.bookingId,
          status: o.status,
          checkIn: o.checkIn,
          checkOut: o.checkOut,
          guestEmailHash: o.guestEmailHash,
          locationBookingId: o.locationBookingId
        })),
        detectedAt
      });
    } else {
      cleanUnitNights += 1;
    }
  }

  return {
    mode: 'dry-run',
    detectedAt,
    summary: {
      blockingBookingsScanned: bookings.length,
      expectedClaims,
      conflictingUnitNights: conflicts.length,
      invalidAllocations: invalidAllocations.length,
      cleanUnitNights,
      malformedRanges
    },
    conflicts,
    invalidAllocations
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.apply) {
    console.error(
      '[unitNightClaimIntegrityDryRun] --apply/--bootstrap is NOT authorized in Inventory Integrity I1. Aborting with no writes.'
    );
    process.exitCode = 2;
    return;
  }

  if (!args.mongoUri && !mongoose.connection.readyState) {
    // Allow importing projectUnitNightClaimIntegrity in tests without connecting.
    if (require.main !== module) return;
  }

  let connectedHere = false;
  if (require.main === module) {
    if (!args.mongoUri) {
      console.error('MONGODB_URI / MONGO_URI required (or --mongo=...)');
      process.exitCode = 1;
      return;
    }
    await mongoose.connect(args.mongoUri);
    connectedHere = true;
  }

  try {
    const beforeClaims = await UnitNightClaim.countDocuments();
    const report = await projectUnitNightClaimIntegrity();
    const afterClaims = await UnitNightClaim.countDocuments();

    if (beforeClaims !== afterClaims) {
      throw new Error('Dry-run mutated UnitNightClaim collection unexpectedly');
    }

    report.claimCollectionCountUnchanged = true;
    report.unitNightClaimCount = afterClaims;

    if (args.json || require.main === module) {
      console.log(JSON.stringify(report, null, 2));
    }
    return report;
  } finally {
    if (connectedHere) {
      await mongoose.disconnect();
    }
  }
}

module.exports = {
  projectUnitNightClaimIntegrity,
  buildScanFilter,
  hashEmail,
  main
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
