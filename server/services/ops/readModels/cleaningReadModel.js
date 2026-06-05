const Booking = require('../../../models/Booking');
const CleaningRecord = require('../../../models/CleaningRecord');
const CleaningPayment = require('../../../models/CleaningPayment');
const CleaningSettings = require('../../../models/CleaningSettings');
const {
  normalizeDateToSofiaDayStart,
  CHECK_IN_TIME,
  CHECK_OUT_TIME
} = require('../../../utils/dateTime');
const { FIXTURE_BOOKING_EMAIL_PATTERN } = require('../../../utils/fixtureExclusion');

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

function resolveCleaningFee(booking) {
  const fee = booking?.cabinId?.cleaningFee ?? booking?.cabinTypeId?.cleaningFee ?? null;
  return typeof fee === 'number' ? fee : null;
}

/** Stable per-property key for same-day-turn matching (prefer unit, then cabin/type). */
function propertyTurnKey(booking) {
  if (booking?.unitId) return `unit:${String(booking.unitId._id || booking.unitId)}`;
  if (booking?.cabinId) return `cabin:${String(booking.cabinId._id || booking.cabinId)}`;
  if (booking?.cabinTypeId) return `ctype:${String(booking.cabinTypeId._id || booking.cabinTypeId)}`;
  return null;
}

const POPULATE = [
  { path: 'cabinId', select: 'name propertyKind cleaningFee inventoryMode' },
  { path: 'cabinTypeId', select: 'name propertyKind cleaningFee' },
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
      cleaningFee: resolveCleaningFee(b)
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
 *
 * @param {Object} opts
 * @param {Date|string} opts.date
 * @param {('cabin'|'valley'|null)} [opts.propertyKind]
 */
async function getCleaningPaymentSummary({ date, propertyKind = null } = {}) {
  const sofiaStart = normalizeDateToSofiaDayStart(date);

  const { checkouts } = await getCleaningSchedule({ date, propertyKind });

  // Live base fee from CleaningSettings (only meaningful when a kind is given).
  let baseFee = 0;
  if (propertyKind) {
    const settings = await CleaningSettings.findOne({ propertyKind }).lean();
    baseFee = settings && typeof settings.baseFee === 'number' ? settings.baseFee : 0;
  }
  const feeSum = checkouts.reduce(
    (sum, ev) => sum + (typeof ev.cleaningFee === 'number' ? ev.cleaningFee : 0),
    0
  );
  const totalAmount = baseFee + feeSum;

  // CleaningPayment is per (date, propertyKind); only meaningful when a kind is given.
  const payment = propertyKind
    ? await CleaningPayment.findOne({ date: sofiaStart, propertyKind }).lean()
    : null;

  return {
    date: sofiaStart.toISOString(),
    propertyKind: propertyKind || null,
    totalAmount,
    paidAmount: payment ? payment.paidAmount || 0 : 0,
    status: payment ? payment.status : 'pending',
    cabinCount: checkouts.length,
    cleaningPaymentId: payment ? String(payment._id) : null
  };
}

module.exports = {
  getCleaningSchedule,
  getCleaningPaymentSummary,
  baseCleaningBookingFilter
};
