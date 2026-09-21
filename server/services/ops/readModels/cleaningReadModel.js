const Booking = require('../../../models/Booking');
const CleaningRecord = require('../../../models/CleaningRecord');
const AvailabilityBlock = require('../../../models/AvailabilityBlock');
const {
  normalizeDateToSofiaDayStart,
  CHECK_IN_TIME,
  CHECK_OUT_TIME
} = require('../../../utils/dateTime');
const { FIXTURE_BOOKING_EMAIL_PATTERN } = require('../../../utils/fixtureExclusion');
const {
  calculateCleaningPaymentSummary,
  calculateGlobalPayoutSummary
} = require('../cleaning/cleaningPricingService');
const {
  EXTERNAL_HOLD_SOURCE
} = require('./externalHoldDashboardMapper');
const { isExternalHoldEligibleForCleaning } = require('../cleaning/airbnbStayClassifier');

const SOFIA_DAY_MS = 24 * 60 * 60 * 1000;

function baseCleaningBookingFilter() {
  return {
    isTest: { $ne: true },
    $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }],
    'guestInfo.email': { $not: FIXTURE_BOOKING_EMAIL_PATTERN },
    status: { $ne: 'cancelled' }
  };
}

function resolveUnitLabel(entity) {
  const unit = entity?.unitId;
  if (!unit) return null;
  const displayName = typeof unit.displayName === 'string' ? unit.displayName.trim() : '';
  if (displayName) return displayName;
  const unitNumber = typeof unit.unitNumber === 'string' ? unit.unitNumber.trim() : '';
  if (!unitNumber) return null;
  if (/^unit\b/i.test(unitNumber)) return unitNumber;
  return `Unit ${unitNumber}`;
}

function resolveAccommodationDisplayName(entity) {
  return entity?.cabinId?.name || entity?.cabinTypeId?.name || 'Unknown';
}

function resolvePropertyKind(entity) {
  return entity?.cabinId?.propertyKind || entity?.cabinTypeId?.propertyKind || null;
}

function resolveCleaningTags(entity) {
  const cabinTags = entity?.cabinId?.cleaningTags;
  const typeTags = entity?.cabinTypeId?.cleaningTags;
  const tags = Array.isArray(cabinTags) && cabinTags.length ? cabinTags : typeTags;
  return Array.isArray(tags) ? tags.map((t) => String(t).trim()).filter(Boolean) : [];
}

function resolveCleaningMeta(entity) {
  return {
    cleaningTags: resolveCleaningTags(entity),
    cabinId: entity?.cabinId?._id ? String(entity.cabinId._id) : null,
    cabinTypeId: entity?.cabinTypeId?._id ? String(entity.cabinTypeId._id) : null
  };
}

/** Stable per-property key for same-day-turn matching (prefer unit, then cabin/type). */
function propertyTurnKey(entity) {
  if (entity?.unitId) return `unit:${String(entity.unitId._id || entity.unitId)}`;
  if (entity?.cabinId) return `cabin:${String(entity.cabinId._id || entity.cabinId)}`;
  if (entity?.cabinTypeId) return `ctype:${String(entity.cabinTypeId._id || entity.cabinTypeId)}`;
  return null;
}

function bookingGuestName(booking) {
  const info = booking?.guestInfo || {};
  const first = typeof info.firstName === 'string' ? info.firstName.trim() : '';
  const last = typeof info.lastName === 'string' ? info.lastName.trim() : '';
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;
  if (typeof info.name === 'string' && info.name.trim()) return info.name.trim();
  return 'Direct guest';
}

function buildTaskId(sourceKind, sourceId) {
  if (sourceKind === 'external_hold') return `ext:${sourceId}`;
  return String(sourceId);
}

function sortCleaningCheckouts(events) {
  const rank = (ev) => {
    const pending = ev.status !== 'cleaned';
    const unpaid = ev.paymentStatus !== 'paid';
    if (ev.sameDayTurn && pending) return 0;
    if (pending) return 1;
    if (!pending && unpaid) return 2;
    return 3;
  };
  return [...events].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    const ta = a.nextArrivalAt ? new Date(a.nextArrivalAt).getTime() : Number.POSITIVE_INFINITY;
    const tb = b.nextArrivalAt ? new Date(b.nextArrivalAt).getTime() : Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    return String(a.cabinName || '').localeCompare(String(b.cabinName || ''));
  });
}

const BOOKING_POPULATE = [
  { path: 'cabinId', select: 'name propertyKind cleaningTags inventoryMode' },
  { path: 'cabinTypeId', select: 'name propertyKind cleaningTags' },
  { path: 'unitId', select: 'unitNumber displayName' }
];

const BLOCK_POPULATE = [
  { path: 'cabinId', select: 'name propertyKind cleaningTags inventoryMode' },
  { path: 'unitId', select: 'unitNumber displayName' }
];

/**
 * Read the day's cleaning schedule (checkouts + informational check-ins).
 * Includes direct Bookings and eligible Airbnb external_hold stays.
 */
async function getCleaningSchedule({ date, propertyKind = null } = {}) {
  const sofiaStart = normalizeDateToSofiaDayStart(date);
  const sofiaEnd = new Date(sofiaStart.getTime() + SOFIA_DAY_MS);

  const baseFilter = baseCleaningBookingFilter();
  const holdBase = {
    blockType: 'external_hold',
    source: EXTERNAL_HOLD_SOURCE,
    status: 'active'
  };

  const [rawCheckouts, rawCheckins, rawHoldLeaving, rawHoldArriving] = await Promise.all([
    Booking.find({ ...baseFilter, checkOut: { $gte: sofiaStart, $lt: sofiaEnd } })
      .populate(BOOKING_POPULATE)
      .lean(),
    Booking.find({ ...baseFilter, checkIn: { $gte: sofiaStart, $lt: sofiaEnd } })
      .populate(BOOKING_POPULATE)
      .lean(),
    AvailabilityBlock.find({
      ...holdBase,
      endDate: { $gte: sofiaStart, $lt: sofiaEnd }
    })
      .populate(BLOCK_POPULATE)
      .lean(),
    AvailabilityBlock.find({
      ...holdBase,
      startDate: { $gte: sofiaStart, $lt: sofiaEnd }
    })
      .populate(BLOCK_POPULATE)
      .lean()
  ]);

  const holdLeaving = rawHoldLeaving.filter(isExternalHoldEligibleForCleaning);
  const holdArriving = rawHoldArriving.filter(isExternalHoldEligibleForCleaning);

  let checkouts = rawCheckouts;
  let checkins = rawCheckins;
  let externalLeaving = holdLeaving;
  let externalArriving = holdArriving;
  if (propertyKind) {
    checkouts = checkouts.filter((b) => resolvePropertyKind(b) === propertyKind);
    checkins = checkins.filter((b) => resolvePropertyKind(b) === propertyKind);
    externalLeaving = externalLeaving.filter((b) => resolvePropertyKind(b) === propertyKind);
    externalArriving = externalArriving.filter((b) => resolvePropertyKind(b) === propertyKind);
  }

  /** @type {Map<string, Array<{source:string, name:string, checkinTime:string, at:Date|null, taskId:string}>>} */
  const arrivalsByKey = new Map();
  function pushArrival(entity, meta) {
    const key = propertyTurnKey(entity);
    if (!key) return;
    if (!arrivalsByKey.has(key)) arrivalsByKey.set(key, []);
    arrivalsByKey.get(key).push(meta);
  }

  for (const b of checkins) {
    pushArrival(b, {
      source: 'direct',
      name: bookingGuestName(b),
      checkinTime: CHECK_IN_TIME,
      at: b.checkIn || null,
      taskId: buildTaskId('booking', String(b._id))
    });
  }
  for (const block of externalArriving) {
    pushArrival(block, {
      source: 'airbnb',
      name: 'Airbnb guest',
      checkinTime: CHECK_IN_TIME,
      at: block.startDate || null,
      taskId: buildTaskId('external_hold', String(block._id))
    });
  }

  const arrivalKeys = new Set(arrivalsByKey.keys());
  const checkoutKeys = new Set(
    [...checkouts, ...externalLeaving].map(propertyTurnKey).filter(Boolean)
  );

  const bookingIds = checkouts.map((b) => b._id);
  const blockIds = externalLeaving.map((b) => b._id);
  // Load by source identity (not only today's cleaningDate) so cleaned/paid
  // survives Airbnb date moves / resync onto a new checkout day.
  const recordQueryParts = [];
  if (bookingIds.length) {
    recordQueryParts.push(
      { sourceKind: 'booking', sourceId: { $in: bookingIds.map(String) } },
      { bookingId: { $in: bookingIds } }
    );
  }
  if (blockIds.length) {
    recordQueryParts.push(
      { sourceKind: 'external_hold', sourceId: { $in: blockIds.map(String) } },
      { availabilityBlockId: { $in: blockIds } }
    );
  }
  const records = recordQueryParts.length
    ? await CleaningRecord.find({ $or: recordQueryParts }).lean()
    : [];

  const recordByTaskKey = new Map();
  const migrateOps = [];
  for (const r of records) {
    const kind = r.sourceKind || (r.bookingId ? 'booking' : 'external_hold');
    const id =
      r.sourceId ||
      (r.bookingId
        ? String(r.bookingId)
        : r.availabilityBlockId
          ? String(r.availabilityBlockId)
          : null);
    if (!id) continue;
    const key = `${kind}:${id}`;
    const rMatchesToday =
      r.cleaningDate &&
      new Date(r.cleaningDate).getTime() >= sofiaStart.getTime() &&
      new Date(r.cleaningDate).getTime() < sofiaEnd.getTime();
    const existing = recordByTaskKey.get(key);
    const existingMatchesToday =
      existing?.cleaningDate &&
      new Date(existing.cleaningDate).getTime() >= sofiaStart.getTime() &&
      new Date(existing.cleaningDate).getTime() < sofiaEnd.getTime();
    if (!existing) {
      recordByTaskKey.set(key, r);
      if (!rMatchesToday) migrateOps.push(r._id);
    } else if (rMatchesToday && !existingMatchesToday) {
      recordByTaskKey.set(key, r);
    }
  }
  if (migrateOps.length) {
    // Move prior cleaned/paid row onto today's checkout day (date-moved stay).
    // Skip any that would collide with an already-present today row.
    const todayKeys = new Set(
      [...recordByTaskKey.entries()]
        .filter(([, r]) => {
          const t = r.cleaningDate ? new Date(r.cleaningDate).getTime() : 0;
          return t >= sofiaStart.getTime() && t < sofiaEnd.getTime();
        })
        .map(([k]) => k)
    );
    const idsToMigrate = migrateOps.filter((id) => {
      const row = records.find((r) => String(r._id) === String(id));
      if (!row) return false;
      const kind = row.sourceKind || (row.bookingId ? 'booking' : 'external_hold');
      const sid =
        row.sourceId ||
        (row.bookingId
          ? String(row.bookingId)
          : row.availabilityBlockId
            ? String(row.availabilityBlockId)
            : null);
      return sid && !todayKeys.has(`${kind}:${sid}`);
    });
    if (idsToMigrate.length) {
      await CleaningRecord.updateMany(
        { _id: { $in: idsToMigrate } },
        { $set: { cleaningDate: sofiaStart } }
      ).catch(() => {});
    }
  }

  const cleaningDateIso = sofiaStart.toISOString();

  function pickNextArrival(key) {
    if (!key) return null;
    const list = arrivalsByKey.get(key) || [];
    if (!list.length) return null;
    return [...list].sort((a, b) => {
      const ta = a.at ? new Date(a.at).getTime() : 0;
      const tb = b.at ? new Date(b.at).getTime() : 0;
      return ta - tb;
    })[0];
  }

  function mapRecordFields(record) {
    return {
      status: record ? record.status : 'pending',
      paymentStatus: record ? record.paymentStatus || 'unpaid' : 'unpaid',
      cleaningRecordId: record ? String(record._id) : null
    };
  }

  const bookingCheckoutEvents = checkouts.map((b) => {
    const key = propertyTurnKey(b);
    const sameDayTurn = Boolean(key && arrivalKeys.has(key));
    const next = pickNextArrival(key);
    const record = recordByTaskKey.get(`booking:${String(b._id)}`) || null;
    const cleaningMeta = resolveCleaningMeta(b);
    const taskId = buildTaskId('booking', String(b._id));
    return {
      type: 'checkout',
      taskId,
      sourceKind: 'booking',
      source: 'direct',
      bookingId: String(b._id),
      availabilityBlockId: null,
      sourceReference: null,
      cabinName: resolveAccommodationDisplayName(b),
      unitLabel: resolveUnitLabel(b),
      propertyKind: resolvePropertyKind(b),
      checkoutTime: CHECK_OUT_TIME,
      cleaningDate: cleaningDateIso,
      ...mapRecordFields(record),
      sameDayTurn,
      nextCheckInTime: sameDayTurn ? next?.checkinTime || CHECK_IN_TIME : null,
      nextArrivalAt: next?.at ? new Date(next.at).toISOString() : null,
      leavingGuest: { name: bookingGuestName(b), source: 'direct' },
      arrivingNext: next
        ? { name: next.name, source: next.source, checkinTime: next.checkinTime }
        : null,
      cleaningNotes: b.cleaningNotes || null,
      cleaningTags: cleaningMeta.cleaningTags,
      cabinId: cleaningMeta.cabinId,
      cabinTypeId: cleaningMeta.cabinTypeId,
      _turnKey: key
    };
  });

  const externalCheckoutEvents = externalLeaving.map((block) => {
    const key = propertyTurnKey(block);
    const sameDayTurn = Boolean(key && arrivalKeys.has(key));
    const next = pickNextArrival(key);
    const record = recordByTaskKey.get(`external_hold:${String(block._id)}`) || null;
    const cleaningMeta = resolveCleaningMeta(block);
    const taskId = buildTaskId('external_hold', String(block._id));
    return {
      type: 'checkout',
      taskId,
      sourceKind: 'external_hold',
      source: 'airbnb',
      bookingId: null,
      availabilityBlockId: String(block._id),
      sourceReference: block.sourceReference || null,
      cabinName: resolveAccommodationDisplayName(block),
      unitLabel: resolveUnitLabel(block),
      propertyKind: resolvePropertyKind(block),
      checkoutTime: CHECK_OUT_TIME,
      cleaningDate: cleaningDateIso,
      ...mapRecordFields(record),
      sameDayTurn,
      nextCheckInTime: sameDayTurn ? next?.checkinTime || CHECK_IN_TIME : null,
      nextArrivalAt: next?.at ? new Date(next.at).toISOString() : null,
      leavingGuest: { name: 'Airbnb guest', source: 'airbnb' },
      arrivingNext: next
        ? { name: next.name, source: next.source, checkinTime: next.checkinTime }
        : null,
      cleaningNotes: null,
      cleaningTags: cleaningMeta.cleaningTags,
      cabinId: cleaningMeta.cabinId,
      cabinTypeId: cleaningMeta.cabinTypeId,
      _turnKey: key
    };
  });

  // Prefer direct booking over Airbnb hold for the same unit on the same day.
  const bookingTurnKeys = new Set(
    bookingCheckoutEvents.map((ev) => ev._turnKey).filter(Boolean)
  );
  const dedupedExternalCheckoutEvents = externalCheckoutEvents
    .filter((ev) => !ev._turnKey || !bookingTurnKeys.has(ev._turnKey))
    .map(({ _turnKey, ...ev }) => ev);
  const normalizedBookingCheckoutEvents = bookingCheckoutEvents.map(({ _turnKey, ...ev }) => ev);

  const checkoutEvents = sortCleaningCheckouts([
    ...normalizedBookingCheckoutEvents,
    ...dedupedExternalCheckoutEvents
  ]);

  const checkinEvents = [
    ...checkins.map((b) => {
      const key = propertyTurnKey(b);
      const sameDayTurn = Boolean(key && checkoutKeys.has(key));
      return {
        type: 'checkin',
        taskId: buildTaskId('booking', String(b._id)),
        sourceKind: 'booking',
        source: 'direct',
        bookingId: String(b._id),
        cabinName: resolveAccommodationDisplayName(b),
        unitLabel: resolveUnitLabel(b),
        propertyKind: resolvePropertyKind(b),
        checkinTime: CHECK_IN_TIME,
        cleaningDate: cleaningDateIso,
        cleaningNotes: b.cleaningNotes || null,
        sameDayTurn,
        arrivingGuest: { name: bookingGuestName(b), source: 'direct' }
      };
    }),
    ...externalArriving.map((block) => {
      const key = propertyTurnKey(block);
      const sameDayTurn = Boolean(key && checkoutKeys.has(key));
      return {
        type: 'checkin',
        taskId: buildTaskId('external_hold', String(block._id)),
        sourceKind: 'external_hold',
        source: 'airbnb',
        bookingId: null,
        availabilityBlockId: String(block._id),
        cabinName: resolveAccommodationDisplayName(block),
        unitLabel: resolveUnitLabel(block),
        propertyKind: resolvePropertyKind(block),
        checkinTime: CHECK_IN_TIME,
        cleaningDate: cleaningDateIso,
        cleaningNotes: null,
        sameDayTurn,
        arrivingGuest: { name: 'Airbnb guest', source: 'airbnb' }
      };
    })
  ];

  return { checkouts: checkoutEvents, checkins: checkinEvents };
}

async function getCleaningPaymentSummary({ date, propertyKind = null } = {}) {
  return calculateCleaningPaymentSummary({ date, propertyKind });
}

async function getGlobalPayoutSummary({ date } = {}) {
  return calculateGlobalPayoutSummary({ date });
}

module.exports = {
  getCleaningSchedule,
  getCleaningPaymentSummary,
  getGlobalPayoutSummary,
  baseCleaningBookingFilter,
  buildTaskId,
  sortCleaningCheckouts,
  propertyTurnKey
};
