'use strict';

/**
 * Shared canonical UnitNightClaim expected-occupancy projection (I1/I5).
 * Binding: docs/stay-change-implementation-plan.md — I5 expected-claim invariant.
 *
 * Invalid allocations NEVER expand expected nights.
 */

const Booking = require('../../models/Booking');
const Unit = require('../../models/Unit');
const { BLOCKING_BOOKING_STATUSES } = require('../calendar/blockingStatusConstants');
const { baseBookingFilter } = require('../ops/reporting/reportingFilters');
const { expandOccupiedSofiaNightDateOnlys } = require('../ops/reporting/stayNights');
const { formatSofiaDateOnly, normalizeDateToSofiaDayStart } = require('../../utils/dateTime');

const BOOKING_PROJECTION =
  '_id status checkIn checkOut unitId cabinTypeId cabinId locationBookingId isTest archivedAt';

function buildAllocatedBlockingScanFilter(extra = {}) {
  return {
    ...baseBookingFilter(),
    status: { $in: BLOCKING_BOOKING_STATUSES },
    unitId: { $exists: true, $ne: null },
    cabinTypeId: { $exists: true, $ne: null },
    ...extra
  };
}

function buildUnallocatedBlockingScanFilter(extra = {}) {
  return {
    ...baseBookingFilter(),
    status: { $in: BLOCKING_BOOKING_STATUSES },
    cabinTypeId: { $exists: true, $ne: null },
    $and: [
      {
        $or: [{ unitId: null }, { unitId: { $exists: false } }]
      }
    ],
    ...extra
  };
}

/** Compatibility alias used by I1 dry-run. */
function buildScanFilter() {
  return buildAllocatedBlockingScanFilter();
}

function nightDateFromDateOnly(dateOnly) {
  return normalizeDateToSofiaDayStart(`${dateOnly}T12:00:00.000Z`);
}

function dateOnlyFromNightDate(nightDate) {
  return formatSofiaDateOnly(nightDate);
}

function unitNightKey(unitId, nightDateOnly) {
  return `${unitId}|${nightDateOnly}`;
}

function parseUnitNightKey(key) {
  const idx = String(key).indexOf('|');
  if (idx < 0) return { unitId: null, night: null };
  return { unitId: key.slice(0, idx), night: key.slice(idx + 1) };
}

/**
 * Validate whether a blocking allocated Booking may contribute expected claims.
 * Returns { ok, reason, unit? } — when ok=false, caller must NOT expand nights.
 */
function validateAllocatedBookingForExpectedClaims(booking, unitById) {
  const bookingId = booking?._id ? String(booking._id) : null;
  const unitId = booking?.unitId ? String(booking.unitId) : null;
  const cabinTypeId = booking?.cabinTypeId ? String(booking.cabinTypeId) : null;
  const cabinId = booking?.cabinId ? String(booking.cabinId) : null;

  if (cabinId && cabinTypeId) {
    return {
      ok: false,
      reason: 'cabinId_and_cabinTypeId',
      classHint: 'MALFORMED_BOOKING',
      bookingId,
      unitId,
      cabinTypeId
    };
  }
  if (!unitId || !cabinTypeId) {
    return {
      ok: false,
      reason: 'missing_unit_or_cabinType',
      classHint: 'INVALID_ALLOCATION',
      bookingId,
      unitId,
      cabinTypeId
    };
  }

  const unit = unitById.get(unitId);
  if (!unit) {
    return {
      ok: false,
      reason: 'unit_not_found',
      classHint: 'INVALID_ALLOCATION',
      bookingId,
      unitId,
      cabinTypeId
    };
  }
  if (String(unit.cabinTypeId) !== cabinTypeId) {
    return {
      ok: false,
      reason: 'unit_cabinType_mismatch',
      classHint: 'INVALID_ALLOCATION',
      bookingId,
      unitId,
      cabinTypeId,
      unitCabinTypeId: String(unit.cabinTypeId),
      unitLabel: unit.displayName || unit.unitNumber || null
    };
  }

  const expanded = expandOccupiedSofiaNightDateOnlys(booking.checkIn, booking.checkOut);
  if (!expanded.ok) {
    return {
      ok: false,
      reason: expanded.reason || 'malformed_range',
      classHint: 'MALFORMED_BOOKING',
      bookingId,
      unitId,
      cabinTypeId,
      unitLabel: unit.displayName || unit.unitNumber || null
    };
  }

  return {
    ok: true,
    bookingId,
    unitId,
    cabinTypeId,
    unit,
    unitLabel: unit.displayName || unit.unitNumber || null,
    nights: expanded.dateOnlys
  };
}

/**
 * Project expected occupancy from valid allocated blocking Bookings.
 * Cursor/batch oriented; accumulates only slim owner rows.
 */
async function projectCanonicalExpectedOccupancy(opts = {}) {
  const BookingModel = opts.BookingModel || Booking;
  const UnitModel = opts.UnitModel || Unit;
  const batchSize = Math.max(1, Number(opts.batchSize) || 200);
  const limit = opts.limit != null ? Math.max(0, Number(opts.limit)) : null;
  const bookingId = opts.bookingId || null;
  const detectedAt = new Date().toISOString();

  const filter = buildAllocatedBlockingScanFilter(
    bookingId ? { _id: bookingId } : {}
  );

  /** @type {Map<string, object[]>} */
  const byUnitNight = new Map();
  const invalidAllocations = [];
  const unallocatedBlocking = [];
  let blockingBookingsScanned = 0;
  let validAllocatedMultiUnitBookings = 0;
  let expectedClaims = 0;
  let malformedRanges = 0;
  let truncatedByLimit = false;

  // Unallocated (full or when not booking-targeted): separate lightweight scan.
  if (!bookingId) {
    const unallocCursor = BookingModel.find(buildUnallocatedBlockingScanFilter())
      .select(BOOKING_PROJECTION)
      .lean()
      .cursor({ batchSize });
    for await (const b of unallocCursor) {
      if (limit != null && blockingBookingsScanned + unallocatedBlocking.length >= limit) {
        truncatedByLimit = true;
        break;
      }
      unallocatedBlocking.push({
        type: 'unallocated_blocking',
        bookingId: String(b._id),
        status: b.status,
        cabinTypeId: b.cabinTypeId ? String(b.cabinTypeId) : null,
        detectedAt
      });
    }
  } else {
    const one = await BookingModel.findById(bookingId).select(BOOKING_PROJECTION).lean();
    if (
      one &&
      BLOCKING_BOOKING_STATUSES.includes(one.status) &&
      one.cabinTypeId &&
      !one.unitId &&
      one.isTest !== true &&
      !one.archivedAt
    ) {
      unallocatedBlocking.push({
        type: 'unallocated_blocking',
        bookingId: String(one._id),
        status: one.status,
        cabinTypeId: String(one.cabinTypeId),
        detectedAt
      });
    }
  }

  const cursor = BookingModel.find(filter)
    .select(BOOKING_PROJECTION)
    .lean()
    .cursor({ batchSize });

  /** @type {object[]} */
  let batch = [];

  async function flushBatch(rows) {
    if (!rows.length) return;
    const unitIds = [...new Set(rows.map((b) => String(b.unitId)).filter(Boolean))];
    const units = await UnitModel.find({ _id: { $in: unitIds } })
      .select('_id unitNumber displayName cabinTypeId isActive')
      .lean();
    const unitById = new Map(units.map((u) => [String(u._id), u]));

    for (const booking of rows) {
      blockingBookingsScanned += 1;
      const validated = validateAllocatedBookingForExpectedClaims(booking, unitById);
      if (!validated.ok) {
        if (validated.reason === 'malformed_range' || validated.classHint === 'MALFORMED_BOOKING') {
          malformedRanges += 1;
        }
        invalidAllocations.push({
          type: validated.reason,
          bookingId: validated.bookingId,
          status: booking.status,
          unitId: validated.unitId,
          cabinTypeId: validated.cabinTypeId,
          unitCabinTypeId: validated.unitCabinTypeId || null,
          unitLabel: validated.unitLabel || null,
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
          detectedAt
        });
        continue;
      }

      validAllocatedMultiUnitBookings += 1;
      const ownerSlim = {
        bookingId: validated.bookingId,
        status: booking.status,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        cabinTypeId: validated.cabinTypeId,
        unitId: validated.unitId,
        unitLabel: validated.unitLabel,
        locationBookingId: booking.locationBookingId ? String(booking.locationBookingId) : null
      };

      for (const night of validated.nights) {
        expectedClaims += 1;
        const key = unitNightKey(validated.unitId, night);
        if (!byUnitNight.has(key)) byUnitNight.set(key, []);
        byUnitNight.get(key).push({ ...ownerSlim });
      }
    }
  }

  for await (const doc of cursor) {
    if (limit != null && blockingBookingsScanned + batch.length >= limit) {
      truncatedByLimit = true;
      break;
    }
    batch.push(doc);
    if (batch.length >= batchSize) {
      // eslint-disable-next-line no-await-in-loop
      await flushBatch(batch);
      batch = [];
    }
  }
  if (batch.length) {
    await flushBatch(batch);
  }

  const conflicts = [];
  /** @type {Set<string>} */
  const denyWriteKeys = new Set();
  /** @type {Map<string, object>} expected owner for uncontested keys */
  const expectedOwnerByKey = new Map();
  let cleanUnitNights = 0;

  for (const [key, owners] of byUnitNight.entries()) {
    const { unitId, night } = parseUnitNightKey(key);
    const uniqueBookingIds = [...new Set(owners.map((o) => o.bookingId))];
    if (uniqueBookingIds.length > 1) {
      denyWriteKeys.add(key);
      conflicts.push({
        unitId,
        unitLabel: owners[0].unitLabel || null,
        cabinTypeId: owners[0].cabinTypeId,
        night,
        bookingIds: uniqueBookingIds,
        bookings: owners.map((o) => ({
          id: o.bookingId,
          status: o.status,
          checkIn: o.checkIn,
          checkOut: o.checkOut,
          locationBookingId: o.locationBookingId
        })),
        detectedAt
      });
    } else {
      cleanUnitNights += 1;
      expectedOwnerByKey.set(key, owners[0]);
    }
  }

  let scanCompleteness = 'full';
  if (bookingId) scanCompleteness = 'targeted';
  else if (limit != null || truncatedByLimit) scanCompleteness = 'partial';

  return {
    detectedAt,
    scanCompleteness,
    truncatedByLimit,
    byUnitNight,
    expectedOwnerByKey,
    denyWriteKeys,
    conflicts,
    invalidAllocations,
    unallocatedBlocking,
    summary: {
      blockingBookingsScanned,
      validAllocatedMultiUnitBookings,
      expectedClaims,
      conflictingUnitNights: conflicts.length,
      invalidAllocations: invalidAllocations.length,
      unallocatedBlocking: unallocatedBlocking.length,
      cleanUnitNights,
      malformedRanges
    }
  };
}

/**
 * I1-compatible report shape (read-only projection).
 */
async function projectUnitNightClaimIntegrity(opts = {}) {
  const proj = await projectCanonicalExpectedOccupancy(opts);
  return {
    mode: 'dry-run',
    detectedAt: proj.detectedAt,
    summary: {
      blockingBookingsScanned: proj.summary.blockingBookingsScanned,
      expectedClaims: proj.summary.expectedClaims,
      conflictingUnitNights: proj.summary.conflictingUnitNights,
      invalidAllocations: proj.summary.invalidAllocations,
      cleanUnitNights: proj.summary.cleanUnitNights,
      malformedRanges: proj.summary.malformedRanges
    },
    conflicts: proj.conflicts,
    invalidAllocations: proj.invalidAllocations
  };
}

module.exports = {
  BLOCKING_BOOKING_STATUSES,
  BOOKING_PROJECTION,
  buildScanFilter,
  buildAllocatedBlockingScanFilter,
  buildUnallocatedBlockingScanFilter,
  validateAllocatedBookingForExpectedClaims,
  projectCanonicalExpectedOccupancy,
  projectUnitNightClaimIntegrity,
  unitNightKey,
  parseUnitNightKey,
  nightDateFromDateOnly,
  dateOnlyFromNightDate
};
