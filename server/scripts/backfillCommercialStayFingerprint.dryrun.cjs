/* eslint-disable no-console */
/**
 * Dry-run only: report what commercialStayFingerprint would be set on existing bookings.
 * No writes.
 *
 * Exit 0 on success; exit 2 on connection/runtime error.
 */
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const Booking = require('../models/Booking');
const {
  buildCommercialStayFingerprintFromBooking,
  normalizeBookingForCommercialStay,
  isBlockingBookingStatus,
  isArchivedBooking
} = require('../services/checkout/bookingCommercialStayFingerprint');

const SAMPLE_LIMIT = 10;

const BOOKING_PROJECTION = {
  status: 1,
  checkIn: 1,
  checkOut: 1,
  cabinId: 1,
  cabinTypeId: 1,
  unitId: 1,
  commercialStayFingerprint: 1,
  guestInfo: 1,
  archivedAt: 1
};

function hasNonEmptyFingerprint(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function classifyBooking(booking) {
  if (isArchivedBooking(booking)) {
    return { bucket: 'skippedArchived', reason: 'archived' };
  }
  if (!isBlockingBookingStatus(booking.status)) {
    return { bucket: 'skippedStatus', reason: booking.status || 'unknown' };
  }
  if (hasNonEmptyFingerprint(booking.commercialStayFingerprint)) {
    return { bucket: 'alreadyHasFingerprint', reason: null };
  }

  const normalized = normalizeBookingForCommercialStay(booking);
  if (!normalized?.guestEmail) {
    return { bucket: 'skippedMissingEmail', reason: null };
  }
  if (!normalized.entityType || !normalized.entityId) {
    return { bucket: 'skippedMissingEntity', reason: null };
  }
  if (!normalized.checkInDateOnly || !normalized.checkOutDateOnly) {
    return { bucket: 'skippedMissingDates', reason: null };
  }

  const fingerprint = buildCommercialStayFingerprintFromBooking(booking);
  if (!fingerprint) {
    return { bucket: 'skippedMissingEntity', reason: 'fingerprint_null' };
  }

  return {
    bucket: 'wouldUpdate',
    reason: null,
    commercialStayFingerprint: fingerprint,
    normalized
  };
}

async function runDryRun() {
  const bookings = await Booking.find({}).select(BOOKING_PROJECTION).lean();

  const counts = {
    scanned: bookings.length,
    eligible: 0,
    alreadyHasFingerprint: 0,
    wouldUpdate: 0,
    skippedMissingEmail: 0,
    skippedMissingEntity: 0,
    skippedMissingDates: 0,
    skippedStatus: 0,
    skippedArchived: 0
  };

  const samples = {
    wouldUpdate: [],
    skippedMissingEmail: [],
    skippedMissingEntity: [],
    skippedMissingDates: [],
    skippedStatus: [],
    skippedArchived: []
  };

  for (const booking of bookings) {
    const result = classifyBooking(booking);
    const countKey = result.bucket;
    if (counts[countKey] != null) {
      counts[countKey] += 1;
    }
    if (
      isBlockingBookingStatus(booking.status) &&
      !isArchivedBooking(booking) &&
      !hasNonEmptyFingerprint(booking.commercialStayFingerprint)
    ) {
      counts.eligible += 1;
    }

    const sampleList = samples[result.bucket];
    if (sampleList && sampleList.length < SAMPLE_LIMIT) {
      const row = {
        bookingId: String(booking._id),
        status: booking.status,
        reason: result.reason || undefined
      };
      if (result.commercialStayFingerprint) {
        row.commercialStayFingerprint = result.commercialStayFingerprint;
        row.entityType = result.normalized.entityType;
        row.entityId = result.normalized.entityId;
        row.guestEmail = result.normalized.guestEmail;
        row.checkIn = result.normalized.checkInDateOnly;
        row.checkOut = result.normalized.checkOutDateOnly;
        if (booking.unitId) {
          row.unitId = String(booking.unitId);
        }
      }
      sampleList.push(row);
    }
  }

  return {
    dryRun: 'booking_commercial_stay_fingerprint_backfill_v1',
    readOnly: true,
    scannedAt: new Date().toISOString(),
    counts,
    samples
  };
}

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 8000 });
  try {
    const summary = await runDryRun();
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = 0;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.log(
      JSON.stringify({
        dryRun: 'booking_commercial_stay_fingerprint_backfill_v1',
        error: true,
        message: err?.message || String(err)
      })
    );
    process.exit(2);
  });
}

module.exports = { runDryRun, classifyBooking };
