/* eslint-disable no-console */
/**
 * Phase 1 verification: cancel → ICS + calendar truth, feedUrl persistence, external_hold-only import labels.
 * Run: npm run validate:phase1 (requires MongoDB)
 */
if (!process.env.PUBLIC_ICS_STRICT_ELIGIBILITY) {
  process.env.PUBLIC_ICS_STRICT_ELIGIBILITY = '0';
}
if (!process.env.PUBLIC_ICS_IGNORE_EXPORT_SAFETY) {
  process.env.PUBLIC_ICS_IGNORE_EXPORT_SAFETY = '1';
}
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const Cabin = require('../models/Cabin');
const Booking = require('../models/Booking');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const CabinChannelSyncState = require('../models/CabinChannelSyncState');
const { importIcalForCabin } = require('../services/ops/ingestion/icalIngestionService');
const { getCalendarReadModel } = require('../services/ops/readModels/calendarReadModel');
const { selectBlockingSpansForSingleCabin } = require('../services/calendar/selectBlockingSpans');
const { transitionReservation } = require('../services/ops/domain/reservationWriteService');
const { normalizeExclusiveDateRange } = require('../utils/dateTime');

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function addDaysUTC(date, days) {
  const x = new Date(date.getTime());
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

async function run() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri);

  const todayUtc = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const base = addDaysUTC(todayUtc, 35);
  const checkIn = addDaysUTC(base, 2);
  const checkOut = addDaysUTC(base, 5);

  const cabinName = `Phase1Integrity ${Date.now()}`;
  const cabin = await Cabin.create({
    name: cabinName,
    description: 'Phase 1 validation cabin',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/phase1.jpg',
    location: 'Bulgaria',
    geoLocation: { latitude: 42.6977, longitude: 23.3219 }
  });
  const cabinId = cabin._id;
  const channel = 'airbnb_ical';

  try {
    // --- A) Persisted feedUrl must not be cleared when import runs without a URL ---
    const persistedFeed = 'https://example.com/persisted-feed.ics';
    await CabinChannelSyncState.findOneAndUpdate(
      { cabinId, channel },
      { $set: { feedUrl: persistedFeed } },
      { upsert: true, new: true }
    );
    await importIcalForCabin({ cabinId, feedUrl: null, channel });
    const syncStateAfterMiss = await CabinChannelSyncState.findOne({ cabinId, channel }).lean();
    assert(
      syncStateAfterMiss?.feedUrl === persistedFeed,
      `feedUrl must remain after missing-URL run (got ${syncStateAfterMiss?.feedUrl})`
    );

    // --- B) Cancelled booking excluded from outbound ICS span selection ---
    const bookingCancelled = await Booking.create({
      cabinId,
      checkIn,
      checkOut,
      adults: 2,
      children: 0,
      status: 'confirmed',
      guestInfo: {
        firstName: 'Zed',
        lastName: 'Cancelled',
        email: `phase1-cancel-${Date.now()}@example.com`,
        phone: '+359000'
      },
      totalPrice: 100,
      tripType: 'retreat',
      romanticSetup: false
    });
    let spans = await selectBlockingSpansForSingleCabin(cabinId);
    assert(
      spans.some((s) => s.kind === 'booking' && s.sourceId === String(bookingCancelled._id)),
      'confirmed booking should produce blocking span'
    );
    bookingCancelled.status = 'cancelled';
    await bookingCancelled.save({ validateBeforeSave: false });
    spans = await selectBlockingSpansForSingleCabin(cabinId);
    assert(
      !spans.some((s) => s.sourceId === String(bookingCancelled._id)),
      'cancelled booking must not appear in ICS blocking spans'
    );

    // --- C) Calendar read model: no internal guest strip for cancelled booking ---
    const from = addDaysUTC(base, 0).toISOString();
    const to = addDaysUTC(base, 10).toISOString();
    const calAfterCancel = await getCalendarReadModel({ from, to, cabinId: String(cabinId) });
    assert(
      !(calAfterCancel.blocks || []).some((b) => b.id === `booking:${bookingCancelled._id}`),
      'cancelled booking must not appear as derived reservation block in calendar read model'
    );

    // --- D) Cancel transition tombstones reservation-backed AvailabilityBlock ---
    const bookingWithBlock = await Booking.create({
      cabinId,
      checkIn: addDaysUTC(base, 8),
      checkOut: addDaysUTC(base, 11),
      adults: 2,
      children: 0,
      status: 'confirmed',
      guestInfo: {
        firstName: 'Block',
        lastName: 'Tomb',
        email: `phase1-block-${Date.now()}@example.com`,
        phone: '+359001'
      },
      totalPrice: 100,
      tripType: 'retreat',
      romanticSetup: false
    });
    const range = normalizeExclusiveDateRange(bookingWithBlock.checkIn, bookingWithBlock.checkOut);
    await AvailabilityBlock.create({
      cabinId,
      unitId: null,
      reservationId: bookingWithBlock._id,
      blockType: 'reservation',
      source: 'internal',
      sourceReference: String(bookingWithBlock._id),
      startDate: range.startDate,
      endDate: range.endDate,
      status: 'active'
    });

    await transitionReservation({
      bookingId: String(bookingWithBlock._id),
      kind: 'cancel',
      ctx: { user: { role: 'admin', id: 'validate-phase1' }, route: 'validatePhase1ReservationIntegrity' }
    });

    const resBlock = await AvailabilityBlock.findOne({
      reservationId: bookingWithBlock._id,
      blockType: 'reservation'
    }).lean();
    assert(resBlock?.status === 'tombstoned', 'reservation AvailabilityBlock must tombstone on cancel');
    assert(
      resBlock?.tombstoneReason === 'reservation_cancelled',
      `expected reservation_cancelled tombstone reason, got ${resBlock?.tombstoneReason}`
    );

    // --- E) External hold render: channel label, no guest (never use iCal SUMMARY as guest name) ---
    const ext = await AvailabilityBlock.create({
      cabinId,
      unitId: null,
      reservationId: null,
      blockType: 'external_hold',
      source: channel,
      sourceReference: `${channel}:validate-phase1-key`,
      startDate: range.startDate,
      endDate: range.endDate,
      status: 'active',
      metadata: { summary: 'Airbnb Guest' }
    });
    const tombstonedNonExternal = await AvailabilityBlock.countDocuments({
      cabinId,
      blockType: 'reservation',
      status: 'tombstoned'
    });
    assert(tombstonedNonExternal >= 1, 'expected tombstoned reservation block after cancel');

    const calExt = await getCalendarReadModel({ from, to, cabinId: String(cabinId) });
    const rendered = (calExt.blocks || []).find((b) => b.id === `block:${ext._id}`);
    assert(rendered, 'external_hold block should appear in calendar');
    assert(
      rendered.render?.labelShort === 'Channel hold',
      `external_hold label should be Channel hold, got ${rendered.render?.labelShort}`
    );
    assert(
      rendered.render?.holdCategory === 'channel_import',
      'external_hold should set holdCategory channel_import'
    );
    assert(!rendered.render?.guestShortName, 'external_hold must not carry guestShortName');

    console.log(
      JSON.stringify(
        {
          success: true,
          batch: 'phase1-reservation-integrity',
          cabinId: String(cabinId),
          checks: ['feedUrl_persist', 'ics_spans_cancel', 'calendar_cancel', 'tombstone_on_cancel', 'external_hold_render']
        },
        null,
        2
      )
    );
  } finally {
    await AvailabilityBlock.deleteMany({ cabinId });
    await CabinChannelSyncState.deleteMany({ cabinId });
    await Booking.deleteMany({ cabinId });
    await Cabin.deleteOne({ _id: cabinId });
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error(JSON.stringify({ success: false, batch: 'phase1-reservation-integrity', error: error?.message || String(error) }, null, 2));
  process.exit(1);
});
