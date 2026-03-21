/* eslint-disable no-console */
const http = require('http');
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const Payment = require('../models/Payment');
const Payout = require('../models/Payout');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const ChannelSyncEvent = require('../models/ChannelSyncEvent');
const StripeEventEvidence = require('../models/StripeEventEvidence');
const ManualReviewItem = require('../models/ManualReviewItem');
const CabinChannelSyncState = require('../models/CabinChannelSyncState');
const { processStripeWebhookEvent } = require('../services/ops/ingestion/stripeIngestionService');
const { importIcalForCabin } = require('../services/ops/ingestion/icalIngestionService');
const { getReservationsWorkspaceReadModel } = require('../services/ops/readModels/reservationsReadModel');
const { getDashboardReadModel } = require('../services/ops/readModels/dashboardReadModel');
const { getSyncCenterReadModel } = require('../services/ops/readModels/syncCenterReadModel');

function plusDays(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function makeStripeEvent({ id, type, created, object }) {
  return {
    id,
    type,
    created,
    livemode: false,
    data: {
      object
    }
  };
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI);

  const stamp = Date.now();
  const bookingEmail = `batch4-${stamp}@example.com`;
  const cabin = await Cabin.create({
    name: `Batch4 Cabin ${stamp}`,
    description: 'Batch4 validation cabin',
    capacity: 2,
    pricePerNight: 120,
    minNights: 1,
    imageUrl: 'https://example.com/batch4.jpg',
    location: 'Bulgaria'
  });
  const booking = await Booking.create({
    cabinId: cabin._id,
    checkIn: plusDays(5),
    checkOut: plusDays(7),
    adults: 2,
    children: 0,
    status: 'pending',
    guestInfo: {
      firstName: 'Batch4',
      lastName: 'Tester',
      email: bookingEmail,
      phone: '+359123456'
    },
    totalPrice: 240
  });

  let icsPayload = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:uid-${stamp}
DTSTART:20260420
DTEND:20260422
SUMMARY:Airbnb hold
END:VEVENT
END:VCALENDAR`;

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/calendar' });
    res.end(icsPayload);
  });
  await new Promise((resolve) => server.listen(19091, '127.0.0.1', resolve));

  const syncState = await CabinChannelSyncState.findOneAndUpdate(
    { cabinId: cabin._id, channel: 'airbnb_ical' },
    { $set: { feedUrl: 'http://127.0.0.1:19091/feed.ics' } },
    { upsert: true, new: true }
  );

  const stripeBaseTs = Math.floor(Date.now() / 1000);
  await processStripeWebhookEvent(
    makeStripeEvent({
      id: `evt_paid_${stamp}`,
      type: 'payment_intent.succeeded',
      created: stripeBaseTs,
      object: {
        object: 'payment_intent',
        id: `pi_${stamp}`,
        amount: 24000,
        amount_received: 24000,
        currency: 'eur',
        metadata: {
          bookingId: String(booking._id)
        }
      }
    })
  );
  await processStripeWebhookEvent(
    makeStripeEvent({
      id: `evt_payout_${stamp}`,
      type: 'payout.created',
      created: stripeBaseTs + 1,
      object: {
        object: 'payout',
        id: `po_${stamp}`,
        amount: 5000,
        currency: 'eur',
        metadata: {}
      }
    })
  );
  await processStripeWebhookEvent(
    makeStripeEvent({
      id: `evt_unlinked_payment_${stamp}`,
      type: 'payment_intent.succeeded',
      created: stripeBaseTs + 2,
      object: {
        object: 'payment_intent',
        id: `pi_unlinked_${stamp}`,
        amount: 7000,
        amount_received: 7000,
        currency: 'eur',
        metadata: {}
      }
    })
  );
  // duplicate idempotent replay
  await processStripeWebhookEvent(
    makeStripeEvent({
      id: `evt_paid_${stamp}`,
      type: 'payment_intent.succeeded',
      created: stripeBaseTs,
      object: {
        object: 'payment_intent',
        id: `pi_${stamp}`,
        amount: 24000,
        amount_received: 24000,
        currency: 'eur',
        metadata: {
          bookingId: String(booking._id)
        }
      }
    })
  );

  const firstImport = await importIcalForCabin({
    cabinId: cabin._id,
    feedUrl: syncState.feedUrl,
    channel: 'airbnb_ical'
  });
  const blockCountAfterFirst = await AvailabilityBlock.countDocuments({
    cabinId: cabin._id,
    blockType: 'external_hold',
    source: 'airbnb_ical'
  });

  const secondImport = await importIcalForCabin({
    cabinId: cabin._id,
    feedUrl: syncState.feedUrl,
    channel: 'airbnb_ical'
  });
  const blockCountAfterSecond = await AvailabilityBlock.countDocuments({
    cabinId: cabin._id,
    blockType: 'external_hold',
    source: 'airbnb_ical'
  });

  icsPayload = `BEGIN:VCALENDAR
VERSION:2.0
END:VCALENDAR`;
  const thirdImport = await importIcalForCabin({
    cabinId: cabin._id,
    feedUrl: syncState.feedUrl,
    channel: 'airbnb_ical'
  });
  const tombstonedCount = await AvailabilityBlock.countDocuments({
    cabinId: cabin._id,
    blockType: 'external_hold',
    source: 'airbnb_ical',
    status: 'tombstoned'
  });

  const reservationsRead = await getReservationsWorkspaceReadModel({
    search: bookingEmail,
    page: 1,
    limit: 5
  });
  const row = reservationsRead.items.find((item) => item.reservationId === String(booking._id));
  const paymentStatusDerived = row?.paymentStatus || null;

  const [paymentsCount, payoutsCount, evidenceCount, syncEventsCount, unlinkedItemsCount, dashboard, syncRead] = await Promise.all([
    Payment.countDocuments({}),
    Payout.countDocuments({}),
    StripeEventEvidence.countDocuments({}),
    ChannelSyncEvent.countDocuments({ cabinId: cabin._id, channel: 'airbnb_ical' }),
    ManualReviewItem.countDocuments({ category: { $in: ['payment_unlinked', 'payout_unlinked'] }, status: 'open' }),
    getDashboardReadModel(),
    getSyncCenterReadModel({ cabinId: String(cabin._id) })
  ]);

  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();

  const report = {
    dbName: (process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI).split('/').pop(),
    stripe: {
      paymentsCount,
      payoutsCount,
      evidenceCount,
      paymentStatusDerived,
      idempotentEvidenceCountExpectedAtLeast3: evidenceCount >= 3
    },
    manualReview: {
      unlinkedItemsCount
    },
    ical: {
      firstImport,
      secondImport,
      thirdImport,
      blockCountAfterFirst,
      blockCountAfterSecond,
      tombstonedCount,
      syncEventsCount
    },
    readModels: {
      dashboardOk: Boolean(dashboard?.aggregates),
      syncCenterHasData: Boolean(syncRead && Array.isArray(syncRead.healthByCabinChannel))
    }
  };

  console.log(JSON.stringify({ success: true, report }, null, 2));
}

run().catch(async (error) => {
  console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
