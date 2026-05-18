/* eslint-disable no-console */
/**
 * Read-only audit: duplicate commercial stays among blocking bookings.
 * Fingerprint: guest email + entity (cabinId or cabinTypeId, not unitId) + check-in/out date-only.
 *
 * Exit 0 when no duplicates; exit 1 when duplicates exist; exit 2 on connection/runtime error.
 */
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const Booking = require('../models/Booking');
const {
  BLOCKING_BOOKING_STATUSES,
  buildCommercialStayFingerprintFromBooking,
  normalizeBookingForCommercialStay,
  isArchivedBooking
} = require('../services/checkout/bookingCommercialStayFingerprint');

const BLOCKING_MATCH = {
  status: { $in: BLOCKING_BOOKING_STATUSES },
  $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }]
};

const BOOKING_PROJECTION = {
  status: 1,
  checkIn: 1,
  checkOut: 1,
  cabinId: 1,
  cabinTypeId: 1,
  checkoutId: 1,
  stripePaymentIntentId: 1,
  guestInfo: 1,
  archivedAt: 1,
  createdAt: 1
};

async function runAudit() {
  const bookings = await Booking.find(BLOCKING_MATCH).select(BOOKING_PROJECTION).lean();

  const groups = new Map();

  for (const booking of bookings) {
    if (isArchivedBooking(booking)) {
      continue;
    }
    const fingerprint = buildCommercialStayFingerprintFromBooking(booking);
    if (!fingerprint) {
      continue;
    }
    const normalized = normalizeBookingForCommercialStay(booking);
    if (!groups.has(fingerprint)) {
      groups.set(fingerprint, {
        commercialStayFingerprint: fingerprint,
        guestEmail: normalized.guestEmail,
        entityType: normalized.entityType,
        entityId: normalized.entityId,
        checkIn: normalized.checkInDateOnly,
        checkOut: normalized.checkOutDateOnly,
        bookings: []
      });
    }
    groups.get(fingerprint).bookings.push({
      bookingId: String(booking._id),
      status: booking.status,
      checkoutId: booking.checkoutId || null,
      stripePaymentIntentId: booking.stripePaymentIntentId || null,
      createdAt: booking.createdAt ? new Date(booking.createdAt).toISOString() : null
    });
  }

  const duplicates = Array.from(groups.values())
    .filter((group) => group.bookings.length > 1)
    .map((group) => ({
      commercialStayFingerprint: group.commercialStayFingerprint,
      guestEmail: group.guestEmail,
      entityType: group.entityType,
      entityId: group.entityId,
      checkIn: group.checkIn,
      checkOut: group.checkOut,
      bookingCount: group.bookings.length,
      bookings: group.bookings.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
    }))
    .sort((a, b) => b.bookingCount - a.bookingCount);

  return {
    audit: 'booking_commercial_stay_duplicates_readonly_v1',
    readOnly: true,
    scannedAt: new Date().toISOString(),
    blockingStatusFilter: BLOCKING_BOOKING_STATUSES,
    duplicateCommercialStayCount: duplicates.length,
    duplicates
  };
}

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 8000 });
  try {
    const summary = await runAudit();
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = summary.duplicateCommercialStayCount > 0 ? 1 : 0;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.log(
      JSON.stringify({
        audit: 'booking_commercial_stay_duplicates_readonly_v1',
        error: true,
        message: err?.message || String(err)
      })
    );
    process.exit(2);
  });
}

module.exports = { runAudit, BLOCKING_MATCH, BOOKING_PROJECTION };
