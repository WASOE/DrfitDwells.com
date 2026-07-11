const moment = require('moment-timezone');
const Booking = require('../../models/Booking');
const AvailabilityBlock = require('../../models/AvailabilityBlock');
const Cabin = require('../../models/Cabin');
const CabinType = require('../../models/CabinType');
const Unit = require('../../models/Unit');
const { resolveLocationTargets } = require('../ops/domain/locationInventoryService');
const { createDomainError } = require('../ops/domain/errors');
const { availabilityBlockUnitScopeClause } = require('../calendar/unitCalendarShared');
const {
  BLOCKING_BOOKING_STATUSES,
  HARD_BLOCK_TYPES
} = require('../ops/domain/conflictService');
const {
  PROPERTY_TIMEZONE,
  normalizeExclusiveDateRange,
  formatSofiaDateOnly
} = require('../../utils/dateTime');
const { getPublicSlugForLocationKey } = require('./locationSlugRegistry');

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Public calendar windows are capped at 12 months (exclusive end). Requests beyond this return 400. */
const MAX_AVAILABILITY_WINDOW_MONTHS = 12;

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function parseAvailabilityDateParam(value, fieldName) {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) {
    throw createDomainError('validation', `${fieldName} is required`, { field: fieldName }, 400);
  }
  if (!DATE_ONLY_RE.test(raw)) {
    throw createDomainError(
      'validation',
      `${fieldName} must be YYYY-MM-DD`,
      { field: fieldName, value: raw },
      400
    );
  }
  const parsed = moment.tz(raw, 'YYYY-MM-DD', PROPERTY_TIMEZONE).startOf('day');
  if (!parsed.isValid()) {
    throw createDomainError(
      'validation',
      `${fieldName} is not a valid calendar date`,
      { field: fieldName, value: raw },
      400
    );
  }
  return parsed;
}

function parseAvailabilityWindow(fromParam, toParam) {
  const fromM = parseAvailabilityDateParam(fromParam, 'from');
  const toM = parseAvailabilityDateParam(toParam, 'to');

  if (!toM.isAfter(fromM)) {
    throw createDomainError(
      'validation',
      'to must be after from',
      { from: fromM.format('YYYY-MM-DD'), to: toM.format('YYYY-MM-DD') },
      400
    );
  }

  const maxTo = fromM.clone().add(MAX_AVAILABILITY_WINDOW_MONTHS, 'months');
  if (toM.isAfter(maxTo)) {
    throw createDomainError(
      'validation',
      `Availability window cannot exceed ${MAX_AVAILABILITY_WINDOW_MONTHS} months`,
      {
        from: fromM.format('YYYY-MM-DD'),
        to: toM.format('YYYY-MM-DD'),
        maxTo: maxTo.format('YYYY-MM-DD')
      },
      400
    );
  }

  const { startDate, endDate } = normalizeExclusiveDateRange(
    fromM.format('YYYY-MM-DD'),
    toM.format('YYYY-MM-DD')
  );

  return {
    from: formatSofiaDateOnly(startDate),
    to: formatSofiaDateOnly(endDate),
    startDate,
    endDate
  };
}

function legacyBlockedDateSpans(blockedDates, windowStart, windowEnd) {
  const spans = [];
  const arr = Array.isArray(blockedDates) ? blockedDates : [];
  for (const blockedDate of arr) {
    const blocked = moment.tz(blockedDate, PROPERTY_TIMEZONE).startOf('day');
    if (!blocked.isValid()) continue;
    const nightStart = blocked.toDate();
    const nightEnd = blocked.clone().add(1, 'day').toDate();
    if (rangesOverlap(nightStart, nightEnd, windowStart, windowEnd)) {
      spans.push({ startDate: nightStart, endDate: nightEnd });
    }
  }
  return spans;
}

/**
 * Collect hard-blocking spans for one inventory target in [windowStart, windowEnd),
 * mirroring evaluateTargetConflicts filters with treatExternalHoldAsHard=true.
 */
async function collectHardBlockingSpansForTarget(target, windowStart, windowEnd) {
  const { cabinId, unitId, cabinTypeId } = target;
  const spans = [];

  if (unitId) {
    const unit = await Unit.findById(unitId).select('blockedDates').lean();
    spans.push(...legacyBlockedDateSpans(unit?.blockedDates, windowStart, windowEnd));
  } else if (cabinId) {
    const cabin = await Cabin.findById(cabinId).select('blockedDates').lean();
    spans.push(...legacyBlockedDateSpans(cabin?.blockedDates, windowStart, windowEnd));
  }

  const bookingClauses = [];
  if (unitId && cabinTypeId) {
    bookingClauses.push({ unitId });
    bookingClauses.push({
      cabinTypeId,
      $or: [{ unitId: null }, { unitId: { $exists: false } }]
    });
  } else if (cabinId) {
    bookingClauses.push({ cabinId });
  }

  const bookingFilter = bookingClauses.length
    ? {
        $or: bookingClauses,
        status: { $in: BLOCKING_BOOKING_STATUSES },
        isTest: { $ne: true },
        $and: [{ $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }] }],
        checkIn: { $lt: windowEnd },
        checkOut: { $gt: windowStart }
      }
    : null;

  const blockFilter = {
    cabinId,
    status: 'active',
    blockType: { $in: HARD_BLOCK_TYPES },
    startDate: { $lt: windowEnd },
    endDate: { $gt: windowStart }
  };
  if (unitId) {
    Object.assign(blockFilter, availabilityBlockUnitScopeClause(unitId));
  } else {
    blockFilter.$or = [{ unitId: null }, { unitId: { $exists: false } }];
  }

  const [bookings, blocks] = await Promise.all([
    bookingFilter
      ? Booking.find(bookingFilter).select('checkIn checkOut').lean()
      : [],
    AvailabilityBlock.find(blockFilter)
      .select('blockType startDate endDate expiresAt checkoutSessionId')
      .lean()
  ]);

  for (const booking of bookings) {
    if (rangesOverlap(booking.checkIn, booking.checkOut, windowStart, windowEnd)) {
      spans.push({ startDate: booking.checkIn, endDate: booking.checkOut });
    }
  }

  const now = new Date();
  for (const block of blocks) {
    if (!rangesOverlap(block.startDate, block.endDate, windowStart, windowEnd)) continue;
    if (block.blockType === 'checkout_hold') {
      if (block.expiresAt && block.expiresAt <= now) continue;
    }
    spans.push({ startDate: block.startDate, endDate: block.endDate });
  }

  return spans;
}

function expandSpanToBlockedNights(spanStart, spanEnd, windowStart, windowEnd) {
  const nights = [];
  let cursor = moment.tz(windowStart, PROPERTY_TIMEZONE).startOf('day');
  const windowEndM = moment.tz(windowEnd, PROPERTY_TIMEZONE).startOf('day');

  while (cursor.isBefore(windowEndM)) {
    const nightStart = cursor.toDate();
    const nightEnd = cursor.clone().add(1, 'day').toDate();
    if (rangesOverlap(spanStart, spanEnd, nightStart, nightEnd)) {
      nights.push(formatSofiaDateOnly(nightStart));
    }
    cursor.add(1, 'day');
  }
  return nights;
}

async function resolveMaxMinNights(inventory) {
  const singleCabinIds = inventory.targets
    .filter((t) => t.kind === 'single_cabin')
    .map((t) => t.cabinId);
  const cabinTypeIds = [
    ...new Set(inventory.targets.filter((t) => t.kind === 'unit').map((t) => String(t.cabinTypeId)))
  ];

  const [cabins, cabinTypes] = await Promise.all([
    singleCabinIds.length
      ? Cabin.find({ _id: { $in: singleCabinIds } }).select('minNights').lean()
      : [],
    cabinTypeIds.length
      ? CabinType.find({ _id: { $in: cabinTypeIds } }).select('minNights').lean()
      : []
  ]);

  let maxMinNights = 1;
  for (const row of [...cabins, ...cabinTypes]) {
    maxMinNights = Math.max(maxMinNights, row.minNights || 1);
  }
  return maxMinNights;
}

/**
 * @param {string} locationKey
 * @param {{ from: string, to: string }} query
 */
async function buildPublicLocationAvailability(locationKey, query) {
  const window = parseAvailabilityWindow(query?.from, query?.to);
  const inventory = await resolveLocationTargets(locationKey);

  if (inventory.inventoryGaps.length > 0) {
    throw createDomainError(
      'validation',
      'Location inventory is incomplete',
      { inventoryGaps: inventory.inventoryGaps },
      422
    );
  }

  const maxMinNights = await resolveMaxMinNights(inventory);
  const blockedSet = new Set();

  for (const target of inventory.targets) {
    const spans = await collectHardBlockingSpansForTarget(
      target,
      window.startDate,
      window.endDate
    );
    for (const span of spans) {
      for (const night of expandSpanToBlockedNights(
        span.startDate,
        span.endDate,
        window.startDate,
        window.endDate
      )) {
        blockedSet.add(night);
      }
    }
  }

  const blockedNights = [...blockedSet].sort();

  return {
    locationKey: inventory.locationKey,
    locationSlug: getPublicSlugForLocationKey(locationKey),
    timezone: PROPERTY_TIMEZONE,
    minNights: maxMinNights,
    from: window.from,
    to: window.to,
    blockedNights,
    generatedAt: new Date().toISOString()
  };
}

module.exports = {
  MAX_AVAILABILITY_WINDOW_MONTHS,
  buildPublicLocationAvailability,
  parseAvailabilityWindow,
  collectHardBlockingSpansForTarget,
  expandSpanToBlockedNights
};
