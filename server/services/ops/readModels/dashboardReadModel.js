const Booking = require('../../../models/Booking');
const Payment = require('../../../models/Payment');
const Payout = require('../../../models/Payout');
const ChannelSyncEvent = require('../../../models/ChannelSyncEvent');
const CommunicationEventLegacy = require('../../../models/EmailEvent');
const ManualReviewItem = require('../../../models/ManualReviewItem');
const { normalizeDateToSofiaDayStart } = require('../../../utils/dateTime');

function dayRange(dateInput = new Date()) {
  const start = normalizeDateToSofiaDayStart(dateInput);
  const end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

async function getDashboardReadModel() {
  const now = new Date();
  const { start, end } = dayRange(now);

  const [arrivalsToday, departuresToday, inHouse, failedPayments, failedEmails, upcomingPayouts, openManualReviews] =
    await Promise.all([
      Booking.countDocuments({ checkIn: { $gte: start, $lt: end } }),
      Booking.countDocuments({ checkOut: { $gte: start, $lt: end } }),
      Booking.countDocuments({ checkIn: { $lte: start }, checkOut: { $gt: start }, status: { $in: ['pending', 'confirmed'] } }),
      Payment.countDocuments({ status: { $in: ['failed', 'disputed'] } }),
      CommunicationEventLegacy.countDocuments({ type: { $in: ['Bounce', 'SpamComplaint'] } }),
      Payout.countDocuments({ expectedArrivalDate: { $gte: start } }),
      ManualReviewItem.countDocuments({ status: 'open' })
    ]);

  const latestSync = await ChannelSyncEvent.findOne({}).sort({ runAt: -1 }).lean();
  const syncWarnings = await ChannelSyncEvent.countDocuments({ outcome: { $in: ['warning', 'failed'] } });

  return {
    generatedAt: new Date().toISOString(),
    freshness: {
      isStale: false,
      degraded: false,
      reason: null
    },
    aggregates: {
      arrivalsToday,
      departuresToday,
      inHouse,
      pendingActions: openManualReviews,
      failedPayments,
      failedEmails,
      upcomingPayouts,
      syncWarnings
    },
    occupancySnapshot: {
      source: 'derived',
      value: {
        inHouse
      }
    },
    quickActionTargets: {
      reservationsPath: '/api/ops/reservations',
      calendarPath: '/api/ops/calendar',
      cabinsPath: '/api/ops/cabins'
    },
    sync: {
      lastSyncAt: latestSync?.runAt || null,
      lastSyncOutcome: latestSync?.outcome || null
    },
    provenance: {
      arrivalsToday: 'derived_on_read',
      departuresToday: 'derived_on_read',
      inHouse: 'derived_on_read',
      failedPayments: 'derived_on_read',
      failedEmails: 'derived_on_read',
      upcomingPayouts: 'derived_on_read',
      syncWarnings: 'derived_on_read'
    }
  };
}

module.exports = {
  getDashboardReadModel
};
