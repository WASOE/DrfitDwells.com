const Booking = require('../../../models/Booking');
const CleaningRecord = require('../../../models/CleaningRecord');
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

const SOFIA_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Base booking filter for the cleaning portal. Mirrors dashboardReadModel
 * baseBookingFilter (isTest / archived / fixture-email exclusion) and adds the
 * cancelled-status exclusion the cleaning schedule requires.
 */
function baseCleaningBookingFilter() {
  return {
    isTest: { $ne: true },
    $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }],
    'guestInfo.email': { $not: FIXTURE_BOOKING_EMAIL_PATTERN },
    status: { $ne: 'cancelled' }
  };
}

// Clean reimplementation of the dashboard unit-label resolver (not imported —
// dashboardReadModel does not export it). Kept privacy-safe: no guest fields.
function resolveUnitLabel(booking) {
  const unit = booking?.unitId;
  if (!unit) return null;
  const displayName = typeof unit.displayName === 'string' ? unit.displayName.trim() : '';
  if (displayName) return displayName;
  const unitNumber = typeof unit.unitNumber === 'string' ? unit.unitNumber.trim() : '';
  if (!unitNumber) return null;
  if (/^unit\b/i.test(unitNumber)) return unitNumber;
  return `Unit ${unitNumber}`;
}

function resolveAccommodationDisplayName(booking) {
  const base = booking?.cabinId?.name || booking?.cabinTypeId?.name || 'Unknown';
  const unit = resolveUnitLabel(booking);
  return unit ? `${base} · ${unit}` : base;
}

function resolvePropertyKind(booking) {
  return booking?.cabinId?.propertyKind || booking?.cabinTypeId?.propertyKind || null;
}

function resolveCleaningTags(booking) {
  const cabinTags = booking?.cabinId?.cleaningTags;
  const typeTags = booking?.cabinTypeId?.cleaningTags;
  const tags = Array.isArray(cabinTags) && cabinTags.length ? cabinTags : typeTags;
  return Array.isArray(tags) ? tags.map((t) => String(t).trim()).filter(Boolean) : [];
}

function resolveCleaningMeta(booking) {
  return {
    cleaningTags: resolveCleaningTags(booking),
    cabinId: booking?.cabinId?._id ? String(booking.cabinId._id) : null,
    cabinTypeId: booking?.cabinTypeId?._id ? String(booking.cabinTypeId._id) : null
  };
}

/** Stable per-property key for same-day-turn matching (prefer unit, then cabin/type). */
function propertyTurnKey(booking) {
  if (booking?.unitId) return `unit:${String(booking.unitId._id || booking.unitId)}`;
  if (booking?.cabinId) return `cabin:${String(booking.cabinId._id || booking.cabinId)}`;
  if (booking?.cabinTypeId) return `ctype:${String(booking.cabinTypeId._id || booking.cabinTypeId)}`;
  return null;
}

const POPULATE = [
  { path: 'cabinId', select: 'name propertyKind cleaningTags inventoryMode' },
  { path: 'cabinTypeId', select: 'name propertyKind cleaningTags' },
  { path: 'unitId', select: 'unitNumber displayName' }
];

/**
 * Read the day's cleaning schedule (checkouts + informational check-ins) for a
 * Sofia calendar day. Returns only a privacy-safe DTO allowlist.
 *
 * @param {Object} opts
 * @param {Date|string} opts.date
 * @param {('cabin'|'valley'|null)} [opts.propertyKind]
 */
async function getCleaningSchedule({ date, propertyKind = null } = {}) {
  const sofiaStart = normalizeDateToSofiaDayStart(date);
  const sofiaEnd = new Date(sofiaStart.getTime() + SOFIA_DAY_MS);

  const baseFilter = baseCleaningBookingFilter();

  const [rawCheckouts, rawCheckins] = await Promise.all([
    Booking.find({ ...baseFilter, checkOut: { $gte: sofiaStart, $lt: sofiaEnd } })
      .populate(POPULATE)
      .lean(),
    Booking.find({ ...baseFilter, checkIn: { $gte: sofiaStart, $lt: sofiaEnd } })
      .populate(POPULATE)
      .lean()
  ]);

  let checkouts = rawCheckouts;
  let checkins = rawCheckins;
  if (propertyKind) {
    checkouts = checkouts.filter((b) => resolvePropertyKind(b) === propertyKind);
    checkins = checkins.filter((b) => resolvePropertyKind(b) === propertyKind);
  }

  // Same-day-turn detection by property key.
  const checkinKeys = new Set(checkins.map(propertyTurnKey).filter(Boolean));
  const checkoutKeys = new Set(checkouts.map(propertyTurnKey).filter(Boolean));

  // Existing cleaning records for the day (never auto-create here).
  const checkoutIds = checkouts.map((b) => b._id);
  const records = checkoutIds.length
    ? await CleaningRecord.find({
        bookingId: { $in: checkoutIds },
        cleaningDate: { $gte: sofiaStart, $lt: sofiaEnd }
      }).lean()
    : [];
  const recordByBooking = new Map(records.map((r) => [String(r.bookingId), r]));

  const cleaningDateIso = sofiaStart.toISOString();

  const checkoutEvents = checkouts.map((b) => {
    const key = propertyTurnKey(b);
    const sameDayTurn = Boolean(key && checkinKeys.has(key));
    const record = recordByBooking.get(String(b._id)) || null;
    const cleaningMeta = resolveCleaningMeta(b);
    return {
      type: 'checkout',
      bookingId: String(b._id),
      cabinName: resolveAccommodationDisplayName(b),
      unitLabel: resolveUnitLabel(b),
      propertyKind: resolvePropertyKind(b),
      checkoutTime: CHECK_OUT_TIME,
      cleaningDate: cleaningDateIso,
      status: record ? record.status : 'pending',
      cleaningRecordId: record ? String(record._id) : null,
      sameDayTurn,
      nextCheckInTime: sameDayTurn ? CHECK_IN_TIME : null,
      cleaningNotes: b.cleaningNotes || null,
      cleaningTags: cleaningMeta.cleaningTags,
      cabinId: cleaningMeta.cabinId,
      cabinTypeId: cleaningMeta.cabinTypeId
    };
  });

  const checkinEvents = checkins.map((b) => {
    const key = propertyTurnKey(b);
    const sameDayTurn = Boolean(key && checkoutKeys.has(key));
    return {
      type: 'checkin',
      bookingId: String(b._id),
      cabinName: resolveAccommodationDisplayName(b),
      unitLabel: resolveUnitLabel(b),
      propertyKind: resolvePropertyKind(b),
      checkinTime: CHECK_IN_TIME,
      cleaningDate: cleaningDateIso,
      cleaningNotes: b.cleaningNotes || null,
      sameDayTurn
    };
  });

  return { checkouts: checkoutEvents, checkins: checkinEvents };
}

/**
 * Compute the day's cleaning payment summary for a property kind (or both).
 * Delegates to cleaningPricingService for line items and snapshot handling.
 */
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
  baseCleaningBookingFilter
};
