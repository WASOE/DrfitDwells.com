const moment = require('moment-timezone');
const Booking = require('../../../models/Booking');
const AvailabilityBlock = require('../../../models/AvailabilityBlock');
const ChannelSyncEvent = require('../../../models/ChannelSyncEvent');
const CabinChannelSyncState = require('../../../models/CabinChannelSyncState'); // default export model
const Cabin = require('../../../models/Cabin');
const {
  PROPERTY_TIMEZONE,
  normalizeExclusiveDateRange,
  normalizeDateToSofiaDayStart
} = require('../../../utils/dateTime');
const { assertExclusiveCalendarRangeWithinMax } = require('../../../utils/calendarExclusiveRangeGuard');
const { BLOCKING_BOOKING_STATUSES } = require('../../calendar/blockingStatusConstants');

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function enumerateOccupiedDayKeysInWindow(blockStart, blockEndExclusive, windowStart, windowEndExclusive) {
  const keys = [];
  let cur = moment.tz(blockStart, PROPERTY_TIMEZONE).startOf('day');
  const end = moment.tz(blockEndExclusive, PROPERTY_TIMEZONE).startOf('day');
  const winStart = moment.tz(windowStart, PROPERTY_TIMEZONE).startOf('day');
  const winEnd = moment.tz(windowEndExclusive, PROPERTY_TIMEZONE).startOf('day');
  while (cur.isBefore(end)) {
    if (cur.isSameOrAfter(winStart) && cur.isBefore(winEnd)) {
      keys.push(cur.format('YYYY-MM-DD'));
    }
    cur = cur.clone().add(1, 'day');
  }
  return keys;
}

function guestShortFromBooking(b) {
  const g = b?.guestInfo || {};
  const first = String(g.firstName || '').trim();
  const last = String(g.lastName || '').trim();
  const fi = first ? first[0].toUpperCase() : '';
  const li = last ? last[0].toUpperCase() : '';
  const initials = `${fi}${li}` || null;
  const shortName = last ? `${first ? `${first[0]}. ` : ''}${last}`.trim() : first || null;
  const labelShort =
    shortName ||
    (initials ? initials : null) ||
    (b?.guestInfo?.email ? String(b.guestInfo.email).split('@')[0].slice(0, 12) : null);
  return { guestInitials: initials, guestShortName: shortName, labelShort };
}

function labelShortForBlockType(blockType) {
  switch (blockType) {
    case 'manual_block':
      return 'Manual';
    case 'maintenance':
      return 'Maintenance';
    case 'external_hold':
      return 'Channel hold';
    case 'reservation':
      return 'Reservation';
    default:
      return blockType;
  }
}

function attachConflictTokens(blocks, hardConflicts, warnings) {
  const hardIds = new Set();
  const warnIds = new Set();
  (hardConflicts || []).forEach((m) => {
    hardIds.add(m.blockA);
    hardIds.add(m.blockB);
  });
  (warnings || []).forEach((m) => {
    warnIds.add(m.blockA);
    warnIds.add(m.blockB);
  });
  return blocks.map((b) => {
    let conflictToken = null;
    if (hardIds.has(b.id)) conflictToken = 'hard';
    else if (warnIds.has(b.id)) conflictToken = 'warning';
    return { ...b, render: { ...(b.render || {}), conflictToken } };
  });
}

function enrichBlockRender(block, bookingById, windowStart, windowEndExclusive) {
  const start = new Date(block.startDate);
  const end = new Date(block.endDate);
  const occupiedDayKeys = enumerateOccupiedDayKeysInWindow(start, end, windowStart, windowEndExclusive);

  if (block.blockType === 'external_hold') {
    return {
      ...block,
      render: {
        labelShort: 'Channel hold',
        guestInitials: null,
        guestShortName: null,
        blockTypeToken: 'external_hold',
        holdCategory: 'channel_import',
        conflictToken: null,
        occupiedDayKeys
      }
    };
  }

  let guestInitials = null;
  let guestShortName = null;
  let labelShort = null;

  if (block.blockType === 'reservation' && block.sourceReference) {
    const booking = bookingById.get(String(block.sourceReference));
    if (booking && BLOCKING_BOOKING_STATUSES.includes(booking.status)) {
      const g = guestShortFromBooking(booking);
      guestInitials = g.guestInitials;
      guestShortName = g.guestShortName;
      labelShort = g.labelShort;
    }
  }
  if (!labelShort) {
    labelShort = labelShortForBlockType(block.blockType);
  }

  return {
    ...block,
    render: {
      labelShort,
      guestInitials,
      guestShortName,
      blockTypeToken: block.blockType,
      holdCategory: block.blockType === 'reservation' ? 'internal_reservation' : 'internal_block',
      conflictToken: null,
      occupiedDayKeys
    }
  };
}

async function syncIndicatorsForCabin(cabinId) {
  const state = await CabinChannelSyncState.findOne({ cabinId, channel: 'airbnb_ical' }).lean();
  if (state?.lastSyncedAt) {
    const outcome = state.lastSyncOutcome;
    return {
      lastSyncAt: state.lastSyncedAt,
      lastSyncOutcome: outcome,
      syncStatus:
        outcome === 'failed' ? 'failed' : outcome === 'warning' ? 'warning' : outcome === 'success' ? 'healthy' : 'stale',
      source: 'cabin_channel_sync_state'
    };
  }
  const latest = await ChannelSyncEvent.findOne({ cabinId }).sort({ runAt: -1 }).lean();
  if (!latest) {
    return { lastSyncAt: null, lastSyncOutcome: null, syncStatus: 'stale', source: 'none' };
  }
  return {
    lastSyncAt: latest.runAt,
    lastSyncOutcome: latest.outcome,
    syncStatus: latest.outcome === 'failed' ? 'failed' : latest.outcome === 'warning' ? 'warning' : 'healthy',
    source: 'channel_sync_event'
  };
}

async function pricingHintForCabin(cabinId) {
  if (!cabinId) return { nightPrice: null, currency: 'eur', source: null };
  const c = await Cabin.findById(cabinId).select('pricePerNight').lean();
  if (!c || c.pricePerNight == null) {
    return { nightPrice: null, currency: 'eur', source: null };
  }
  return {
    nightPrice: Number(c.pricePerNight),
    currency: 'eur',
    source: 'cabin_price_per_night'
  };
}

async function buildBlocksForRange(normalized, cabinId) {
  const filters = {
    startDate: { $lt: normalized.endDate },
    endDate: { $gt: normalized.startDate },
    status: 'active'
  };
  if (cabinId) filters.cabinId = cabinId;

  const bookingFilters = {
    checkIn: { $lt: normalized.endDate },
    checkOut: { $gt: normalized.startDate }
  };
  if (cabinId) bookingFilters.cabinId = cabinId;

  const [availabilityBlocks, bookings] = await Promise.all([
    AvailabilityBlock.find(filters).lean(),
    Booking.find(bookingFilters).lean()
  ]);

  const bookingById = new Map(bookings.map((b) => [String(b._id), b]));

  const reservationBlockBookingIds = new Set(
    availabilityBlocks
      .filter((b) => b.status === 'active' && b.blockType === 'reservation' && b.reservationId)
      .map((b) => String(b.reservationId))
  );

  const reservationBacked = bookings
    .filter((b) => b.cabinId && BLOCKING_BOOKING_STATUSES.includes(b.status))
    .filter((b) => !reservationBlockBookingIds.has(String(b._id)))
    .map((b) => {
      const range = normalizeExclusiveDateRange(b.checkIn, b.checkOut);
      return {
        id: `booking:${b._id}`,
        blockType: 'reservation',
        sourceType: 'reservation',
        sourceReference: String(b._id),
        cabinId: String(b.cabinId),
        unitId: b.unitId ? String(b.unitId) : null,
        startDate: range.startDate.toISOString(),
        endDate: range.endDate.toISOString(),
        status: 'active',
        tombstonedAt: null,
        provenance: {
          source: 'internal',
          sourceReference: String(b._id)
        }
      };
    });

  const canonicalBlocks = availabilityBlocks.map((blk) => ({
    id: `block:${blk._id}`,
    blockType: blk.blockType,
    sourceType: 'availability_block',
    sourceReference:
      blk.blockType === 'reservation' && blk.reservationId ? String(blk.reservationId) : String(blk._id),
    cabinId: String(blk.cabinId),
    unitId: blk.unitId ? String(blk.unitId) : null,
    startDate: normalizeDateToSofiaDayStart(blk.startDate).toISOString(),
    endDate: normalizeDateToSofiaDayStart(blk.endDate).toISOString(),
    status: blk.status,
    tombstonedAt: blk.tombstonedAt || null,
    provenance: {
      source: blk.source,
      sourceReference: blk.sourceReference || null
    }
  }));

  const allBlocks = [...canonicalBlocks, ...reservationBacked];

  const hardConflicts = [];
  const warnings = [];

  for (let i = 0; i < allBlocks.length; i += 1) {
    for (let j = i + 1; j < allBlocks.length; j += 1) {
      const a = allBlocks[i];
      const b = allBlocks[j];
      if (a.cabinId !== b.cabinId) continue;
      if (a.status === 'tombstoned' || b.status === 'tombstoned') continue;
      const isOverlap = overlaps(new Date(a.startDate), new Date(a.endDate), new Date(b.startDate), new Date(b.endDate));
      if (!isOverlap) continue;

      const isExternalWarning = a.blockType === 'external_hold' || b.blockType === 'external_hold';
      const marker = {
        cabinId: a.cabinId,
        blockA: a.id,
        blockB: b.id,
        type: isExternalWarning ? 'warning' : 'hard_conflict'
      };
      if (isExternalWarning) warnings.push(marker);
      else hardConflicts.push(marker);
    }
  }

  const enriched = allBlocks.map((blk) => enrichBlockRender(blk, bookingById, normalized.startDate, normalized.endDate));
  const withConflict = attachConflictTokens(enriched, hardConflicts, warnings);

  return {
    blocks: withConflict,
    conflictMarkers: { hard: hardConflicts, warnings },
    bookingById
  };
}

function buildMeta(normalized) {
  const today = moment.tz(PROPERTY_TIMEZONE).format('YYYY-MM-DD');
  return {
    propertyTimezone: PROPERTY_TIMEZONE,
    today,
    rangeStart: normalized.startDate.toISOString(),
    rangeEnd: normalized.endDate.toISOString()
  };
}

function summarizePreview(blocks, hardConflicts, warnings) {
  let reservationCount = 0;
  let manualCount = 0;
  let maintenanceCount = 0;
  let externalCount = 0;
  blocks.forEach((b) => {
    if (b.status === 'tombstoned') return;
    if (b.blockType === 'reservation') reservationCount += 1;
    else if (b.blockType === 'manual_block') manualCount += 1;
    else if (b.blockType === 'maintenance') maintenanceCount += 1;
    else if (b.blockType === 'external_hold') externalCount += 1;
  });
  return {
    reservationCount,
    manualCount,
    maintenanceCount,
    externalCount,
    hardConflictCount: hardConflicts.length,
    warningCount: warnings.length,
    hasConflict: hardConflicts.length > 0 || warnings.length > 0
  };
}

/**
 * @param {Object} opts
 * @param {string|Date} opts.from
 * @param {string|Date} opts.to
 * @param {string|null} [opts.cabinId]
 * @param {boolean} [opts.indexPreview]
 * @param {number} [opts.previewDays] default 14
 */
async function getCalendarReadModel({ from, to, cabinId = null, indexPreview = false, previewDays = 14 }) {
  if (indexPreview) {
    const days = Math.min(31, Math.max(7, parseInt(previewDays, 10) || 14));
    const startM = moment.tz(PROPERTY_TIMEZONE).startOf('day');
    const endM = startM.clone().add(days, 'days');
    const normalized = normalizeExclusiveDateRange(startM.toDate(), endM.toDate());

    const cabins = await Cabin.find({}).sort({ name: 1 }).select('_id name isActive imageUrl').lean();

    const previewByCabin = [];
    for (const c of cabins) {
      const cid = String(c._id);
      const { blocks, conflictMarkers } = await buildBlocksForRange(normalized, cid);
      const syncIndicators = await syncIndicatorsForCabin(cid);
      previewByCabin.push({
        cabinId: cid,
        listing: {
          name: c.name || null,
          isActive: c.isActive !== false,
          imageUrl: c.imageUrl || null
        },
        blocks,
        conflictMarkers,
        syncIndicators,
        summary: summarizePreview(blocks, conflictMarkers.hard, conflictMarkers.warnings)
      });
    }

    return {
      mode: 'index_preview',
      meta: buildMeta(normalized),
      request: {
        from: normalized.startDate.toISOString(),
        to: normalized.endDate.toISOString(),
        cabinId: null,
        indexPreview: true,
        previewDays: days
      },
      previewByCabin,
      degraded: {
        conflictEnginePartial: false,
        reason: null
      },
      provenance: {
        blocks: 'source_truth_plus_derived',
        renderFields: 'derived_on_read_for_ui_only'
      }
    };
  }

  const normalized = normalizeExclusiveDateRange(from, to);
  assertExclusiveCalendarRangeWithinMax(normalized.startDate, normalized.endDate);
  const { blocks, conflictMarkers } = await buildBlocksForRange(normalized, cabinId || null);
  const latestScoped = await ChannelSyncEvent.findOne(cabinId ? { cabinId } : {}).sort({ runAt: -1 }).lean();
  const mergedSync = cabinId
    ? await syncIndicatorsForCabin(cabinId)
    : {
        lastSyncAt: latestScoped?.runAt || null,
        lastSyncOutcome: latestScoped?.outcome || null,
        syncStatus: latestScoped
          ? latestScoped.outcome === 'failed'
            ? 'failed'
            : latestScoped.outcome === 'warning'
              ? 'warning'
              : 'healthy'
          : 'stale',
        source: latestScoped ? 'channel_sync_event' : 'none'
      };

  const pricingHint = await pricingHintForCabin(cabinId);

  return {
    mode: 'range',
    meta: buildMeta(normalized),
    request: {
      from: normalized.startDate.toISOString(),
      to: normalized.endDate.toISOString(),
      cabinId: cabinId || null,
      indexPreview: false
    },
    blocks,
    conflictMarkers,
    syncIndicators: mergedSync,
    pricingHint,
    degraded: {
      conflictEnginePartial: false,
      reason: null
    },
    provenance: {
      blocks: 'source_truth_plus_derived',
      renderFields: 'derived_on_read_for_ui_only'
    }
  };
}

module.exports = {
  getCalendarReadModel,
  syncIndicatorsForCabin
};
