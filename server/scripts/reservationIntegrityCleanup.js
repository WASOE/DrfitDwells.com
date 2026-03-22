#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Integrity cleanup & preview (no hard-delete on bookings).
 *
 * Stale reservation blocks (tombstone):
 *   node scripts/reservationIntegrityCleanup.js --apply
 *
 * Previews (dry output JSON):
 *   node scripts/reservationIntegrityCleanup.js --preview-unsafe-blocking
 *   node scripts/reservationIntegrityCleanup.js --preview-ics-exclusion
 *
 * Remediation (updates Booking only):
 *   node scripts/reservationIntegrityCleanup.js --set-production-safe=<bookingId> --apply
 *   node scripts/reservationIntegrityCleanup.js --set-test=<bookingId> --apply
 *   node scripts/reservationIntegrityCleanup.js --clear-test=<bookingId> --apply
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const Booking = require('../models/Booking');
const { BLOCKING_BOOKING_STATUSES } = require('../services/calendar/blockingStatusConstants');
const { loadPaidOrPartialReservationIdSet, isBookingEligibleForPublicIcs } = require('../services/calendar/icsBlockingEligibility');
const { resolveBookingExportSafety } = require('../services/calendar/bookingExportSafety');
const { isPublicIcsStrictEligibility } = require('../config/publicIcsConfig');

const PREVIEW_LIMIT = 2000;

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const previewUnsafe = argv.includes('--preview-unsafe-blocking') || argv.includes('--preview-unsafe');
  const previewIcs = argv.includes('--preview-ics-exclusion') || argv.includes('--preview-ics');
  let setProductionSafeId = null;
  let setTestId = null;
  let clearTestId = null;
  for (const a of argv) {
    if (a.startsWith('--set-production-safe=')) setProductionSafeId = a.slice('--set-production-safe='.length);
    if (a.startsWith('--set-test=')) setTestId = a.slice('--set-test='.length);
    if (a.startsWith('--clear-test=')) clearTestId = a.slice('--clear-test='.length);
  }
  return { apply, previewUnsafe, previewIcs, setProductionSafeId, setTestId, clearTestId };
}

async function findStaleBlockIds() {
  const rows = await AvailabilityBlock.aggregate([
    {
      $match: {
        blockType: 'reservation',
        status: 'active',
        reservationId: { $exists: true, $ne: null }
      }
    },
    {
      $lookup: {
        from: 'bookings',
        localField: 'reservationId',
        foreignField: '_id',
        as: 'b'
      }
    },
    {
      $match: {
        $or: [{ b: { $size: 0 } }, { 'b.0.status': { $in: ['cancelled', 'completed'] } }]
      }
    },
    { $project: { _id: 1, reservationId: 1, bookingStatus: { $arrayElemAt: ['$b.status', 0] } } }
  ]);
  return rows;
}

async function loadBlockingSingleCabinSample() {
  return Booking.find({
    status: { $in: BLOCKING_BOOKING_STATUSES },
    cabinId: { $exists: true, $ne: null },
    $or: [{ cabinTypeId: null }, { cabinTypeId: { $exists: false } }]
  })
    .select('_id status isProductionSafe isTest provenance checkIn checkOut guestInfo.email')
    .limit(PREVIEW_LIMIT)
    .sort({ checkIn: 1 })
    .lean();
}

async function runPreviews() {
  const bookings = await loadBlockingSingleCabinSample();
  const ids = bookings.map((b) => String(b._id));
  const paidSet = ids.length > 0 ? await loadPaidOrPartialReservationIdSet(ids) : new Set();
  const strictIcs = isPublicIcsStrictEligibility();

  const unsafeBlocking = [];
  const icsExcluded = [];

  for (const b of bookings) {
    const safety = resolveBookingExportSafety(b, paidSet);
    if (!safety.effectiveSafe) {
      unsafeBlocking.push({
        bookingId: String(b._id),
        status: b.status,
        reasonCode: safety.reasonCode,
        uncertainty: safety.uncertainty,
        isTest: b.isTest,
        isProductionSafe: b.isProductionSafe,
        provenanceSource: b.provenance?.source || null
      });
    }
    const eligible = isBookingEligibleForPublicIcs(b, paidSet, strictIcs);
    if (!eligible) {
      icsExcluded.push({
        bookingId: String(b._id),
        status: b.status,
        strictIcs,
        exportSafetyEffectiveSafe: safety.effectiveSafe,
        exportSafetyReasonCode: safety.reasonCode,
        exportSafetyUncertainty: safety.uncertainty
      });
    }
  }

  return { unsafeBlocking, icsExcluded, previewLimit: PREVIEW_LIMIT, sampleSize: bookings.length };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri);

  try {
    if (args.previewUnsafe || args.previewIcs) {
      const previews = await runPreviews();
      if (args.previewUnsafe) {
        console.log(JSON.stringify({ kind: 'preview_unsafe_blocking', rows: previews.unsafeBlocking, meta: previews }, null, 2));
      }
      if (args.previewIcs) {
        console.log(JSON.stringify({ kind: 'preview_ics_exclusion', rows: previews.icsExcluded, meta: previews }, null, 2));
      }
      return;
    }

    if (args.setProductionSafeId) {
      if (!mongoose.Types.ObjectId.isValid(args.setProductionSafeId)) {
        throw new Error('Invalid --set-production-safe id');
      }
      const oid = new mongoose.Types.ObjectId(args.setProductionSafeId);
      if (!args.apply) {
        const doc = await Booking.findById(oid).select('status isProductionSafe isTest provenance').lean();
        console.log(
          JSON.stringify(
            { mode: 'dry-run', action: 'set_production_safe', bookingId: String(oid), before: doc },
            null,
            2
          )
        );
        return;
      }
      const res = await Booking.updateOne(
        { _id: oid },
        { $set: { isProductionSafe: true, isTest: false } }
      );
      console.log(JSON.stringify({ action: 'set_production_safe', matched: res.matchedCount, modified: res.modifiedCount }, null, 2));
      return;
    }

    if (args.setTestId) {
      if (!mongoose.Types.ObjectId.isValid(args.setTestId)) throw new Error('Invalid --set-test id');
      const oid = new mongoose.Types.ObjectId(args.setTestId);
      if (!args.apply) {
        console.log(JSON.stringify({ mode: 'dry-run', action: 'set_test_true', bookingId: String(oid) }, null, 2));
        return;
      }
      const res = await Booking.updateOne({ _id: oid }, { $set: { isTest: true, isProductionSafe: false } });
      console.log(JSON.stringify({ action: 'set_test_true', matched: res.matchedCount, modified: res.modifiedCount }, null, 2));
      return;
    }

    if (args.clearTestId) {
      if (!mongoose.Types.ObjectId.isValid(args.clearTestId)) throw new Error('Invalid --clear-test id');
      const oid = new mongoose.Types.ObjectId(args.clearTestId);
      if (!args.apply) {
        console.log(JSON.stringify({ mode: 'dry-run', action: 'clear_test', bookingId: String(oid) }, null, 2));
        return;
      }
      const res = await Booking.updateOne({ _id: oid }, { $set: { isTest: false } });
      console.log(JSON.stringify({ action: 'clear_test', matched: res.matchedCount, modified: res.modifiedCount }, null, 2));
      return;
    }

    const stale = await findStaleBlockIds();
    const now = new Date();

    console.log(
      JSON.stringify(
        {
          mode: args.apply ? 'apply' : 'dry-run',
          staleReservationBlocks: { count: stale.length, sample: stale.slice(0, 15) }
        },
        null,
        2
      )
    );

    if (stale.length === 0) {
      return;
    }

    if (!args.apply) {
      console.log('Stale blocks: dry run. Re-run with --apply to tombstone. Or use --preview-unsafe-blocking / --preview-ics-exclusion.');
      return;
    }

    const ids = stale.map((r) => r._id);
    const result = await AvailabilityBlock.updateMany(
      { _id: { $in: ids } },
      {
        $set: {
          status: 'tombstoned',
          tombstonedAt: now,
          tombstoneReason: 'integrity_cleanup_stale_reservation_block'
        }
      }
    );

    console.log(JSON.stringify({ tombstoneStaleBlocks: { modified: result.modifiedCount || 0, matched: result.matchedCount || 0 } }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(async (err) => {
  console.error(err?.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
