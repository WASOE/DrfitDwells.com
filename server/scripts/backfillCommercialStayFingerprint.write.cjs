/* eslint-disable no-console */
/**
 * Write backfill: set Booking.commercialStayFingerprint when missing (C3).
 * Requires BACKFILL_COMMERCIAL_STAY_FINGERPRINT_WRITE=1.
 *
 * Exit 0 on success; exit 2 on refusal or connection/runtime error.
 */
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const Booking = require('../models/Booking');
const {
  isBlockingBookingStatus,
  isArchivedBooking
} = require('../services/checkout/bookingCommercialStayFingerprint');
const { classifyBooking } = require('./backfillCommercialStayFingerprint.dryrun.cjs');

const SAMPLE_LIMIT = 10;
const WRITE_ENV = 'BACKFILL_COMMERCIAL_STAY_FINGERPRINT_WRITE';

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

function isWriteEnabled() {
  return process.env[WRITE_ENV] === '1';
}

function buildRefusalPayload() {
  return {
    write: 'booking_commercial_stay_fingerprint_backfill_v1',
    refused: true,
    message: `Set ${WRITE_ENV}=1 to run writes`
  };
}

function buildMissingFingerprintFilter(bookingId) {
  return {
    _id: bookingId,
    $or: [
      { commercialStayFingerprint: { $exists: false } },
      { commercialStayFingerprint: null },
      { commercialStayFingerprint: '' }
    ]
  };
}

function initCounts() {
  return {
    scanned: 0,
    eligible: 0,
    updated: 0,
    alreadyHasFingerprint: 0,
    skippedMissingEmail: 0,
    skippedMissingEntity: 0,
    skippedMissingDates: 0,
    skippedStatus: 0,
    skippedArchived: 0,
    failed: 0
  };
}

function initSamples() {
  return {
    updated: [],
    failed: [],
    skippedMissingEmail: [],
    skippedMissingEntity: [],
    skippedMissingDates: [],
    skippedStatus: [],
    skippedArchived: []
  };
}

function pushSample(samples, bucket, row) {
  const list = samples[bucket];
  if (list && list.length < SAMPLE_LIMIT) {
    list.push(row);
  }
}

function buildSampleRow(booking, result) {
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
  return row;
}

async function applyFingerprintUpdate(bookingId, fingerprint) {
  return Booking.updateOne(buildMissingFingerprintFilter(bookingId), {
    $set: { commercialStayFingerprint: fingerprint }
  });
}

async function runWrite() {
  const bookings = await Booking.find({}).select(BOOKING_PROJECTION).lean();
  const counts = initCounts();
  const samples = initSamples();

  for (const booking of bookings) {
    counts.scanned += 1;
    const result = classifyBooking(booking);

    if (counts[result.bucket] != null && result.bucket !== 'wouldUpdate') {
      counts[result.bucket] += 1;
    }

    if (
      isBlockingBookingStatus(booking.status) &&
      !isArchivedBooking(booking) &&
      !hasNonEmptyFingerprint(booking.commercialStayFingerprint)
    ) {
      counts.eligible += 1;
    }

    if (result.bucket === 'wouldUpdate') {
      const updateResult = await applyFingerprintUpdate(
        booking._id,
        result.commercialStayFingerprint
      );
      if (updateResult.modifiedCount === 1) {
        counts.updated += 1;
        pushSample(samples, 'updated', buildSampleRow(booking, result));
      } else if (updateResult.matchedCount === 0) {
        counts.alreadyHasFingerprint += 1;
      } else {
        counts.failed += 1;
        pushSample(samples, 'failed', {
          bookingId: String(booking._id),
          reason: 'update_matched_but_not_modified',
          commercialStayFingerprint: result.commercialStayFingerprint
        });
      }
      continue;
    }

    const sampleBucket =
      result.bucket === 'alreadyHasFingerprint' ? null : result.bucket;
    if (sampleBucket) {
      pushSample(samples, sampleBucket, buildSampleRow(booking, result));
    }
  }

  return {
    write: 'booking_commercial_stay_fingerprint_backfill_v1',
    readOnly: false,
    writtenAt: new Date().toISOString(),
    scanned: counts.scanned,
    eligible: counts.eligible,
    updated: counts.updated,
    alreadyHasFingerprint: counts.alreadyHasFingerprint,
    skippedStatus: counts.skippedStatus,
    skippedArchived: counts.skippedArchived,
    skippedMissingEmail: counts.skippedMissingEmail,
    skippedMissingEntity: counts.skippedMissingEntity,
    skippedMissingDates: counts.skippedMissingDates,
    failed: counts.failed,
    samples
  };
}

async function main() {
  if (!isWriteEnabled()) {
    console.log(JSON.stringify(buildRefusalPayload(), null, 2));
    process.exitCode = 2;
    return;
  }

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 8000 });
  try {
    const summary = await runWrite();
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
        write: 'booking_commercial_stay_fingerprint_backfill_v1',
        error: true,
        message: err?.message || String(err)
      })
    );
    process.exit(2);
  });
}

module.exports = {
  WRITE_ENV,
  isWriteEnabled,
  buildRefusalPayload,
  buildMissingFingerprintFilter,
  applyFingerprintUpdate,
  runWrite
};
