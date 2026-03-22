/* eslint-disable no-console */
/**
 * Deactivate validation fixture cabins and cancel fixture bookings (sync/batch overlap tests).
 *
 * Usage:
 *   node server/scripts/maintenance/archiveFixtureContamination.js           # dry-run
 *   node server/scripts/maintenance/archiveFixtureContamination.js --apply   # apply (local: always; remote: needs DRIFT_ALLOW_MAINTENANCE_APPLY=1)
 */
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../../config/dbDefaults');
const { assertMaintenanceApplyAllowedForMongoUri } = require('../../utils/scriptProductionGuard');
const { FIXTURE_CABIN_NAME_PATTERN } = require('../../utils/fixtureExclusion');
const Cabin = require('../../models/Cabin');
const Booking = require('../../models/Booking');
const AvailabilityBlock = require('../../models/AvailabilityBlock');
const CabinChannelSyncState = require('../../models/CabinChannelSyncState');

const FIXTURE_BOOKING_EMAIL_RE = /^(sync-overlap-|batch4-|smoke-)/i;

async function run() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  const apply = process.argv.includes('--apply');

  if (apply) {
    assertMaintenanceApplyAllowedForMongoUri(mongoUri);
  }

  await mongoose.connect(mongoUri);

  const cabinQuery = { name: { $regex: FIXTURE_CABIN_NAME_PATTERN } };
  const fixtureCabins = await Cabin.find(cabinQuery).select('_id name').lean();

  const bookingQuery = {
    $or: [{ 'guestInfo.email': { $regex: FIXTURE_BOOKING_EMAIL_RE } }, { isTest: true }]
  };
  const fixtureBookings = await Booking.find(bookingQuery).select('_id cabinId guestInfo').lean();

  console.log(
    JSON.stringify(
      {
        dryRun: !apply,
        fixtureCabins: fixtureCabins.map((c) => ({ id: String(c._id), name: c.name })),
        fixtureBookings: fixtureBookings.map((b) => ({
          id: String(b._id),
          email: b.guestInfo?.email,
          cabinId: b.cabinId ? String(b.cabinId) : null
        }))
      },
      null,
      2
    )
  );

  if (!apply) {
    console.log('[maintenance] Dry-run only. Re-run with --apply to deactivate cabins and cancel bookings.');
    await mongoose.disconnect();
    return;
  }

  const cabinIds = fixtureCabins.map((c) => c._id);
  const bookingIds = fixtureBookings.map((b) => b._id);

  if (cabinIds.length) {
    await Cabin.updateMany({ _id: { $in: cabinIds } }, { $set: { isActive: false } });
    await AvailabilityBlock.deleteMany({ cabinId: { $in: cabinIds } });
    await CabinChannelSyncState.deleteMany({ cabinId: { $in: cabinIds } });
  }

  if (bookingIds.length) {
    await Booking.updateMany(
      { _id: { $in: bookingIds } },
      { $set: { status: 'cancelled', isTest: true } }
    );
  }

  console.log(
    JSON.stringify(
      {
        applied: true,
        deactivatedCabins: cabinIds.length,
        cancelledBookings: bookingIds.length
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
