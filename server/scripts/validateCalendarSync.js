/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const http = require('http');
const mongoose = require('mongoose');

const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const { assertScriptWriteAllowedForMongoUri } = require('../utils/scriptProductionGuard');
const Cabin = require('../models/Cabin');
const Booking = require('../models/Booking');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const ChannelSyncEvent = require('../models/ChannelSyncEvent');
const { importIcalForCabin } = require('../services/ops/ingestion/icalIngestionService');
const { getCalendarReadModel } = require('../services/ops/readModels/calendarReadModel');

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatYmdUtc(d) {
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
}

function addDaysUTC(date, days) {
  const x = new Date(date.getTime());
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

function templateLoad(filePath, replacements) {
  const raw = fs.readFileSync(filePath, 'utf8');
  let out = raw;
  for (const [k, v] of Object.entries(replacements)) {
    out = out.replaceAll(`{{${k}}}`, String(v));
  }
  return out;
}

async function run() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri);
  assertScriptWriteAllowedForMongoUri(mongoUri);

  const todayUtc = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  // Future window so Booking schema validation passes (check-in must be in the future).
  const base = addDaysUTC(todayUtc, 30);

  // success_case_a: two events
  const ev1Start = addDaysUTC(base, 0);
  const ev1End = addDaysUTC(base, 2);
  const ev2Start = addDaysUTC(base, 4);
  const ev2End = addDaysUTC(base, 6);

  // overlap_case: reservation sits under the external_hold window
  const bookingCheckIn = addDaysUTC(base, 4);
  const bookingCheckOut = addDaysUTC(base, 7);
  const overStart = addDaysUTC(base, 5);
  const overEnd = addDaysUTC(base, 8);

  const badStart = addDaysUTC(base, 1);

  const replacements = {
    EV1_START: formatYmdUtc(ev1Start),
    EV1_END: formatYmdUtc(ev1End),
    EV2_START: formatYmdUtc(ev2Start),
    EV2_END: formatYmdUtc(ev2End),
    OV_START: formatYmdUtc(overStart),
    OV_END: formatYmdUtc(overEnd),
    BAD_START: formatYmdUtc(badStart)
  };

  const fixtureDir = path.resolve(__dirname, '..', 'fixtures', 'calendar-sync');
  const fixtures = {
    success_case_a: templateLoad(path.join(fixtureDir, 'success_case_a.ics'), replacements),
    success_case_b: templateLoad(path.join(fixtureDir, 'success_case_b.ics'), replacements),
    overlap_case: templateLoad(path.join(fixtureDir, 'overlap_case.ics'), replacements),
    broken_case: templateLoad(path.join(fixtureDir, 'broken_case.ics'), replacements)
  };

  const cabinName = `SyncValidation Cabin ${Date.now()}`;
  const cabin = await Cabin.create({
    name: cabinName,
    description: 'Local iCal sync validation cabin',
    capacity: 2,
    pricePerNight: 120,
    minNights: 1,
    imageUrl: 'https://example.com/sync-validation.jpg',
    location: 'Bulgaria',
    geoLocation: { latitude: 42.6977, longitude: 23.3219 }
  });

  const booking = await Booking.create({
    cabinId: cabin._id,
    checkIn: bookingCheckIn,
    checkOut: bookingCheckOut,
    adults: 2,
    children: 0,
    status: 'pending',
    isTest: true,
    isProductionSafe: false,
    guestInfo: {
      firstName: 'Sync',
      lastName: 'Overlap',
      email: `sync-overlap-${Date.now()}@example.com`,
      phone: '+359123456'
    },
    totalPrice: 200,
    tripType: 'retreat',
    romanticSetup: false
  });

  // HTTP server to serve fixtures locally (so importer uses its real axios+HTTP fetch path).
  const feedRoutes = {
    '/success_case_a.ics': fixtures.success_case_a,
    '/success_case_b.ics': fixtures.success_case_b,
    '/overlap_case.ics': fixtures.overlap_case,
    '/broken_case.ics': fixtures.broken_case
  };

  const server = http.createServer((req, res) => {
    const url = String(req.url || '').split('?')[0];
    if (!feedRoutes[url]) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/calendar' });
    res.end(feedRoutes[url]);
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const feedUrlA = `${baseUrl}/success_case_a.ics`;
  const feedUrlB = `${baseUrl}/success_case_b.ics`;
  const feedUrlOverlap = `${baseUrl}/overlap_case.ics`;
  const feedUrlBroken = `${baseUrl}/broken_case.ics`;

  const channel = 'airbnb_ical';
  const source = channel;
  const cabinId = String(cabin._id);

  async function countExternalHolds(status) {
    return AvailabilityBlock.countDocuments({
      cabinId: cabin._id,
      blockType: 'external_hold',
      source,
      status
    });
  }

  async function countNonExternalBlocks() {
    return AvailabilityBlock.countDocuments({
      cabinId: cabin._id,
      blockType: { $ne: 'external_hold' }
    });
  }

  async function latestSyncEvent() {
    return ChannelSyncEvent.findOne({ cabinId: cabin._id, channel }).sort({ runAt: -1 }).lean();
  }

  const bookingBefore = await Booking.findById(booking._id).lean();
  const bookingCountBefore = await Booking.countDocuments({ cabinId: cabin._id });
  assert(await countNonExternalBlocks() === 0, 'test cabin should start with no non-external AvailabilityBlocks');

  try {
    // 1) broken_case: should not create active external_hold; should record non-success sync evidence.
    const brokenRes = await importIcalForCabin({ cabinId: cabin._id, feedUrl: feedUrlBroken, channel });
    const activeBroken = await countExternalHolds('active');
    const brokenEvent = await latestSyncEvent();

    assert(activeBroken === 0, `broken_case should create 0 active external_hold, got ${activeBroken}`);
    assert(
      brokenEvent?.outcome === 'warning' || brokenEvent?.outcome === 'failed',
      `broken_case should mark sync outcome as warning/failed, got ${brokenEvent?.outcome}`
    );
    assert(
      brokenEvent?.anomalyType === 'import_warning' || brokenRes?.outcome !== 'success',
      `broken_case should not be treated as success (anomalyType/import evidence missing)`
    );
    assert(
      await Booking.countDocuments({ cabinId: cabin._id }) === bookingCountBefore,
      'broken_case must not create new Reservation/Booking records'
    );
    assert(await countNonExternalBlocks() === 0, 'broken_case must not create any non-external AvailabilityBlocks');

    // 2) success_case_a: two events => 2 active external_hold.
    const resA1 = await importIcalForCabin({ cabinId: cabin._id, feedUrl: feedUrlA, channel });
    const activeA1 = await countExternalHolds('active');
    assert(activeA1 === 2, `success_case_a should create 2 active external_hold, got ${activeA1}`);
    assert(resA1?.outcome === 'success' || resA1?.outcome === 'warning', 'unexpected outcome for success_case_a');
    assert(await countNonExternalBlocks() === 0, 'success_case_a must only create external_hold AvailabilityBlocks');

    // Idempotency: replay same feed.
    const resA2 = await importIcalForCabin({ cabinId: cabin._id, feedUrl: feedUrlA, channel });
    const activeA2 = await countExternalHolds('active');
    assert(activeA2 === 2, `success_case_a replay should remain 2 active external_hold, got ${activeA2}`);

    // 3) success_case_b: one event removed => 1 active, 1 tombstoned.
    await importIcalForCabin({ cabinId: cabin._id, feedUrl: feedUrlB, channel });
    const activeB = await countExternalHolds('active');
    const tombstonedB = await countExternalHolds('tombstoned');
    assert(activeB === 1, `success_case_b should end with 1 active external_hold, got ${activeB}`);
    assert(tombstonedB === 1, `success_case_b should tombstone exactly 1 external_hold, got ${tombstonedB}`);
    assert(await countNonExternalBlocks() === 0, 'success_case_b must only create external_hold AvailabilityBlocks');

    // 4) overlap_case: should create external_hold that conflicts (warning) without mutating Booking truth.
    const bookingBeforeOverlap = await Booking.findById(booking._id).lean();
    await importIcalForCabin({ cabinId: cabin._id, feedUrl: feedUrlOverlap, channel });
    const bookingAfterOverlap = await Booking.findById(booking._id).lean();

    assert(bookingAfterOverlap?.status === bookingBeforeOverlap?.status, 'overlap_case must not mutate Reservation/Booking status');
    assert(
      String(bookingAfterOverlap?.checkIn) === String(bookingBeforeOverlap?.checkIn) &&
        String(bookingAfterOverlap?.checkOut) === String(bookingBeforeOverlap?.checkOut),
      'overlap_case must not mutate Booking check-in/out'
    );

    const from = addDaysUTC(base, -1);
    const to = addDaysUTC(base, 12);
    const cal = await getCalendarReadModel({ from: from.toISOString(), to: to.toISOString(), cabinId: cabin._id });
    const warningsCount = cal?.conflictMarkers?.warnings?.length || 0;
    assert(warningsCount > 0, `overlap_case should produce at least 1 warning conflict, got ${warningsCount}`);

    const hasExternalWarning = (cal?.blocks || []).some(
      (b) => b.blockType === 'external_hold' && b.render?.conflictToken === 'warning'
    );
    assert(hasExternalWarning, 'overlap_case should mark external_hold blocks with warning conflictToken');

    const activeOverlap = await countExternalHolds('active');
    assert(activeOverlap === 1, `overlap_case should end with 1 active external_hold, got ${activeOverlap}`);
    assert(await countNonExternalBlocks() === 0, 'overlap_case must only create external_hold AvailabilityBlocks');

    const finalBookingCount = await Booking.countDocuments({ cabinId: cabin._id });
    assert(finalBookingCount === bookingCountBefore, 'overlap_case must not create new Reservation/Booking records');

    console.log(
      JSON.stringify(
        {
          success: true,
          batch: 'calendar-sync',
          cabinId,
          fixtures: {
            broken_case: { activeExternalHolds: activeBroken, syncOutcome: brokenEvent?.outcome },
            success_case_a: { idempotent: activeA1 === 2 && activeA2 === 2, activeCount: activeA2 },
            success_case_b: { activeCount: activeB, tombstonedCount: tombstonedB },
            overlap_case: { warningsCount, activeExternalHolds: activeOverlap }
          }
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          success: false,
          batch: 'calendar-sync',
          cabinId,
          error: error?.message || 'Unknown error'
        },
        null,
        2
      )
    );
    throw error;
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ success: false, batch: 'calendar-sync', error: error?.message || 'Unknown error (top-level)' }, null, 2));
  process.exit(1);
});

