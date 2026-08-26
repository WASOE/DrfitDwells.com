/**
 * Work Windows OPS read model — on-demand snapshot of guest-free practical windows.
 * Batched queries only; no per-target availability helper loops.
 */
'use strict';

const moment = require('moment-timezone');
const Booking = require('../../../models/Booking');
const AvailabilityBlock = require('../../../models/AvailabilityBlock');
const Cabin = require('../../../models/Cabin');
const Unit = require('../../../models/Unit');
const { BLOCKING_BOOKING_STATUSES } = require('../../calendar/blockingStatusConstants');
const { HARD_BLOCK_TYPES } = require('../domain/conflictService');
const { resolveLocationTargets } = require('../domain/locationInventoryService');
const { assertAllowedLocationKey } = require('../domain/locationRegistry');
const { createDomainError } = require('../domain/errors');
const { formatSofiaDateOnly } = require('../../../utils/dateTime');
const {
  STATES,
  MAX_WORK_WINDOWS_EXCLUSIVE_DAYS,
  PROPERTY_TIMEZONE,
  CHECK_IN_TIME,
  CHECK_OUT_TIME,
  guestPracticalInterval,
  blockPracticalInterval,
  buildResourceSpans,
  buildBestWindows,
  buildDayKeys,
  planningWindowBounds,
  resolvePlanningActionableBounds,
  guestLabelFromBooking,
  legacyBlockedDateSpans
} = require('../domain/workWindowsIntervals');

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDateOnlyParam(value, fieldName) {
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
  return parsed.format('YYYY-MM-DD');
}

function parseWorkWindowsWindow(fromParam, toParam) {
  const from = parseDateOnlyParam(fromParam, 'from');
  const to = parseDateOnlyParam(toParam, 'to');
  const fromM = moment.tz(from, 'YYYY-MM-DD', PROPERTY_TIMEZONE).startOf('day');
  const toM = moment.tz(to, 'YYYY-MM-DD', PROPERTY_TIMEZONE).startOf('day');
  if (!toM.isAfter(fromM)) {
    throw createDomainError('validation', 'to must be after from', { from, to }, 400);
  }
  const spanDays = toM.diff(fromM, 'days');
  if (spanDays > MAX_WORK_WINDOWS_EXCLUSIVE_DAYS) {
    throw createDomainError(
      'validation',
      `Work Windows range cannot exceed ${MAX_WORK_WINDOWS_EXCLUSIVE_DAYS} exclusive days`,
      { from, to, spanDays, max: MAX_WORK_WINDOWS_EXCLUSIVE_DAYS },
      400
    );
  }
  return { from, to, spanDays };
}

function isLocationWideBlock(block) {
  const meta = block?.metadata || {};
  return meta.scope === 'location_wide' || Boolean(meta.locationBlockGroupId);
}

function blockAppliesToUnitTarget(block, target) {
  if (String(block.cabinId) !== String(target.cabinId)) return false;
  if (block.unitId == null || block.unitId === undefined) return true;
  return String(block.unitId) === String(target.unitId);
}

function blockAppliesToSingleCabin(block, target) {
  if (String(block.cabinId) !== String(target.cabinId)) return false;
  return block.unitId == null || block.unitId === undefined;
}

function bookingSource(booking) {
  return {
    type: 'booking',
    bookingId: String(booking._id),
    status: booking.status || null,
    guestLabel: guestLabelFromBooking(booking)
  };
}

function blockSource(block, blockTypeOverride = null) {
  const blockType = blockTypeOverride || block.blockType;
  return {
    type: blockType === 'legacy_blocked_date' ? 'legacy_blocked_date' : 'availability_block',
    blockId: block._id ? String(block._id) : null,
    blockType,
    locationBlockGroupId: block.metadata?.locationBlockGroupId
      ? String(block.metadata.locationBlockGroupId)
      : null
  };
}

function toGuestIntervalRow(booking) {
  const practical = guestPracticalInterval(booking.checkIn, booking.checkOut);
  if (!practical) return null;
  return {
    ...practical,
    source: bookingSource(booking),
    booking
  };
}

function toBlockIntervalRow(block, typeOverride = null) {
  const practical = blockPracticalInterval(block.startDate, block.endDate);
  if (!practical) return null;
  const source = blockSource(block, typeOverride);
  return {
    ...practical,
    meta: { blockSubtype: source.blockType },
    source
  };
}

/**
 * @param {{ locationKey: string, from: string, to: string }} query
 * @param {{ now?: Date }} [options] — inject snapshot time for tests; production uses Date.now once
 */
async function getWorkWindowsReadModel(query = {}, options = {}) {
  const locationKey = assertAllowedLocationKey(query.locationKey);
  const window = parseWorkWindowsWindow(query.from, query.to);
  const inventory = await resolveLocationTargets(locationKey);

  if (inventory.inventoryGaps.length > 0 && inventory.targets.length === 0) {
    throw createDomainError(
      'validation',
      'Location inventory is incomplete',
      { inventoryGaps: inventory.inventoryGaps },
      422
    );
  }

  // One stable snapshot instant for generatedAt, hold expiry, and actionable clipping.
  const generatedAtDate =
    options.now instanceof Date && !Number.isNaN(options.now.getTime())
      ? options.now
      : new Date();
  const generatedAtIso = generatedAtDate.toISOString();

  const { windowStartMs, windowEndMs, startDate, endDate } = planningWindowBounds(
    window.from,
    window.to
  );
  const { actionableStartMs } = resolvePlanningActionableBounds(
    windowStartMs,
    windowEndMs,
    generatedAtDate
  );

  const singleTargets = inventory.targets.filter((t) => t.kind === 'single_cabin');
  const unitTargets = inventory.targets.filter((t) => t.kind === 'unit');
  const singleCabinIds = singleTargets.map((t) => t.cabinId);
  const unitIds = unitTargets.map((t) => t.unitId);
  const cabinTypeIdSet = new Set(
    unitTargets.map((t) => String(t.cabinTypeId)).filter(Boolean)
  );
  const cabinTypeIds = unitTargets
    .map((t) => t.cabinTypeId)
    .filter((id, index, arr) => id && cabinTypeIdSet.has(String(id)) && arr.findIndex((x) => String(x) === String(id)) === index);

  const bookingOr = [];
  if (singleCabinIds.length) {
    bookingOr.push({ cabinId: { $in: singleCabinIds } });
  }
  if (unitIds.length) {
    bookingOr.push({ unitId: { $in: unitIds } });
  }
  if (cabinTypeIds.length) {
    bookingOr.push({ cabinTypeId: { $in: cabinTypeIds } });
  }

  const bookingFilter = bookingOr.length
    ? {
        $or: bookingOr,
        status: { $in: BLOCKING_BOOKING_STATUSES },
        isTest: { $ne: true },
        $and: [{ $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }] }],
        checkIn: { $lt: endDate },
        checkOut: { $gt: startDate }
      }
    : null;

  const allCabinObjectIds = inventory.targets.map((t) => t.cabinId).filter(Boolean);
  const uniqueCabinObjectIds = [
    ...new Map(allCabinObjectIds.map((id) => [String(id), id])).values()
  ];

  const blockFilter = uniqueCabinObjectIds.length
    ? {
        cabinId: { $in: uniqueCabinObjectIds },
        status: 'active',
        blockType: { $in: HARD_BLOCK_TYPES },
        startDate: { $lt: endDate },
        endDate: { $gt: startDate }
      }
    : null;

  const [bookingsRaw, blocksRaw, cabinsLegacy, unitsLegacy] = await Promise.all([
    bookingFilter
      ? Booking.find(bookingFilter)
          .select('_id cabinId unitId cabinTypeId checkIn checkOut status guestInfo')
          .lean()
      : Promise.resolve([]),
    blockFilter
      ? AvailabilityBlock.find(blockFilter)
          .select('_id cabinId unitId blockType startDate endDate expiresAt metadata checkoutSessionId')
          .lean()
      : Promise.resolve([]),
    singleCabinIds.length
      ? Cabin.find({ _id: { $in: singleCabinIds } }).select('_id blockedDates').lean()
      : Promise.resolve([]),
    unitIds.length
      ? Unit.find({ _id: { $in: unitIds } }).select('_id blockedDates').lean()
      : Promise.resolve([])
  ]);

  // Dedupe bookings by _id
  const bookingById = new Map();
  for (const b of bookingsRaw) {
    bookingById.set(String(b._id), b);
  }
  const bookings = [...bookingById.values()];

  const blocks = blocksRaw.filter((block) => {
    if (block.blockType === 'checkout_hold') {
      if (block.expiresAt && block.expiresAt <= generatedAtDate) return false;
    }
    return true;
  });

  const cabinBlockedById = new Map(
    cabinsLegacy.map((c) => [String(c._id), c.blockedDates || []])
  );
  const unitBlockedById = new Map(
    unitsLegacy.map((u) => [String(u._id), u.blockedDates || []])
  );

  const unitsByType = new Map();
  for (const t of unitTargets) {
    const key = String(t.cabinTypeId);
    if (!unitsByType.has(key)) unitsByType.set(key, []);
    unitsByType.get(key).push(t);
  }

  /** @type {Map<string, object[]>} resourceId -> guest interval rows */
  const guestsByResource = new Map();
  /** @type {Map<string, object[]>} */
  const blocksByResource = new Map();

  function ensureList(map, key) {
    if (!map.has(key)) map.set(key, []);
    return map.get(key);
  }

  const locationResourceId = `location:${locationKey}`;

  // Assign guest intervals
  for (const booking of bookings) {
    const row = toGuestIntervalRow(booking);
    if (!row) continue;

    // Always site-wide union
    ensureList(guestsByResource, locationResourceId).push(row);

    if (booking.unitId) {
      const resourceId = `unit:${booking.unitId}`;
      ensureList(guestsByResource, resourceId).push(row);
      continue;
    }

    if (booking.cabinTypeId && (booking.unitId == null || booking.unitId === undefined)) {
      // Unallocated: every unit of that type + site (site already)
      const typeUnits = unitsByType.get(String(booking.cabinTypeId)) || [];
      for (const t of typeUnits) {
        ensureList(guestsByResource, `unit:${t.unitId}`).push(row);
      }
      continue;
    }

    if (booking.cabinId) {
      ensureList(guestsByResource, `cabin:${booking.cabinId}`).push(row);
    }
  }

  // Assign availability blocks
  const locationWideSeen = new Set();
  for (const block of blocks) {
    const row = toBlockIntervalRow(block);
    if (!row) continue;

    if (isLocationWideBlock(block)) {
      const groupKey = `${block.metadata?.locationBlockGroupId || block._id}:${row.startMs}:${row.endMs}`;
      if (!locationWideSeen.has(groupKey)) {
        locationWideSeen.add(groupKey);
        ensureList(blocksByResource, locationResourceId).push(row);
      }
      // Also paint each child resource (location fan-out rows)
      for (const t of inventory.targets) {
        if (t.kind === 'unit' && blockAppliesToUnitTarget(block, t)) {
          ensureList(blocksByResource, `unit:${t.unitId}`).push(row);
        } else if (t.kind === 'single_cabin' && blockAppliesToSingleCabin(block, t)) {
          ensureList(blocksByResource, `cabin:${t.cabinId}`).push(row);
        }
      }
      continue;
    }

    // Child / cabin-scoped — never infer site-wide from a single child block
    for (const t of inventory.targets) {
      if (t.kind === 'unit' && blockAppliesToUnitTarget(block, t)) {
        ensureList(blocksByResource, `unit:${t.unitId}`).push(row);
      } else if (t.kind === 'single_cabin' && blockAppliesToSingleCabin(block, t)) {
        ensureList(blocksByResource, `cabin:${t.cabinId}`).push(row);
      }
    }
  }

  // Legacy blockedDates
  for (const t of singleTargets) {
    const legacy = legacyBlockedDateSpans(cabinBlockedById.get(String(t.cabinId)) || []);
    for (const span of legacy) {
      const row = toBlockIntervalRow(
        {
          _id: null,
          startDate: span.startDate,
          endDate: span.endDate,
          blockType: 'legacy_blocked_date',
          metadata: {}
        },
        'legacy_blocked_date'
      );
      if (row) ensureList(blocksByResource, `cabin:${t.cabinId}`).push(row);
    }
  }
  for (const t of unitTargets) {
    const legacy = legacyBlockedDateSpans(unitBlockedById.get(String(t.unitId)) || []);
    for (const span of legacy) {
      const row = toBlockIntervalRow(
        {
          _id: null,
          startDate: span.startDate,
          endDate: span.endDate,
          blockType: 'legacy_blocked_date',
          metadata: {}
        },
        'legacy_blocked_date'
      );
      if (row) ensureList(blocksByResource, `unit:${t.unitId}`).push(row);
    }
  }

  function buildResource({ resourceId, kind, label, targetKey, cabinId, unitId, cabinTypeId }) {
    const spans = buildResourceSpans({
      guestIntervals: guestsByResource.get(resourceId) || [],
      blockIntervals: blocksByResource.get(resourceId) || [],
      windowStartMs,
      windowEndMs,
      actionableStartMs,
      resourceId
    }).map((span) => {
      // Strip internal sources array from API
      const { sources, ...rest } = span;
      return rest;
    });
    return {
      resourceId,
      kind,
      label,
      locationKey,
      targetKey: targetKey || null,
      cabinId: cabinId ? String(cabinId) : null,
      unitId: unitId ? String(unitId) : null,
      cabinTypeId: cabinTypeId ? String(cabinTypeId) : null,
      spans
    };
  }

  const resources = [
    buildResource({
      resourceId: locationResourceId,
      kind: 'location',
      label: inventory.locationLabel,
      targetKey: null,
      cabinId: null,
      unitId: null,
      cabinTypeId: null
    })
  ];

  for (const t of inventory.targets) {
    if (t.kind === 'single_cabin') {
      resources.push(
        buildResource({
          resourceId: `cabin:${t.cabinId}`,
          kind: 'single_cabin',
          label: t.label,
          targetKey: t.targetKey,
          cabinId: t.cabinId,
          unitId: null,
          cabinTypeId: null
        })
      );
    } else {
      resources.push(
        buildResource({
          resourceId: `unit:${t.unitId}`,
          kind: 'unit',
          label: t.label,
          targetKey: t.targetKey,
          cabinId: t.cabinId,
          unitId: t.unitId,
          cabinTypeId: t.cabinTypeId
        })
      );
    }
  }

  const bestWindows = buildBestWindows(resources);

  return {
    generatedAt: generatedAtIso,
    timezone: PROPERTY_TIMEZONE,
    checkInTime: CHECK_IN_TIME,
    checkOutTime: CHECK_OUT_TIME,
    locationKey: inventory.locationKey,
    locationLabel: inventory.locationLabel,
    window: { from: window.from, to: window.to },
    actionableFrom: new Date(actionableStartMs).toISOString(),
    dayKeys: buildDayKeys(window.from, window.to),
    resources,
    bestWindows,
    inventoryGaps: inventory.inventoryGaps
  };
}

module.exports = {
  getWorkWindowsReadModel,
  parseWorkWindowsWindow,
  MAX_WORK_WINDOWS_EXCLUSIVE_DAYS,
  STATES,
  formatSofiaDateOnly
};
