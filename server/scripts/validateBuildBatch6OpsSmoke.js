/* eslint-disable no-console */
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');

const Booking = require('../models/Booking');
const Payout = require('../models/Payout');
const Cabin = require('../models/Cabin');
const ManualReviewItem = require('../models/ManualReviewItem');

const { getPaymentsSummaryReadModel, getPaymentsLedgerReadModel } = require('../services/ops/readModels/paymentsReadModel');
const {
  getPayoutsListReadModel,
  getPayoutDetailReadModel,
  getPayoutReconciliationSummaryReadModel
} = require('../services/ops/readModels/paymentsReadModel');
const { getSyncCenterReadModel } = require('../services/ops/readModels/syncCenterReadModel');
const { getCabinsListReadModel, getCabinDetailReadModel } = require('../services/ops/readModels/cabinsReadModel');
const { getReviewsReadModel, getCommunicationOversightReadModel } = require('../services/ops/readModels/reviewsCommsReadModel');
const { getOpsHealthReadModel } = require('../services/ops/readModels/healthReadModel');
const { getReservationDetailReadModel } = require('../services/ops/readModels/reservationDetailReadModel');

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function run() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri);

  try {
    const firstBooking = await Booking.findOne({}).select('_id').lean();
    const firstPayout = await Payout.findOne({}).select('_id').lean();
    const firstCabin = await Cabin.findOne({}).select('_id').lean();
    const manualOpenCount = await ManualReviewItem.countDocuments({ status: 'open' });

    const [
      paymentsSummary,
      paymentsLedger,
      payoutsList,
      payoutDetail,
      payoutReconciliation,
      syncCenter,
      cabinsList,
      cabinDetail,
      reviews,
      commsOversight,
      health,
      reservationDetail
    ] = await Promise.all([
      getPaymentsSummaryReadModel(),
      getPaymentsLedgerReadModel({ page: 1, limit: 5 }),
      getPayoutsListReadModel({ page: 1, limit: 5 }),
      firstPayout ? getPayoutDetailReadModel(String(firstPayout._id)) : Promise.resolve(null),
      getPayoutReconciliationSummaryReadModel(),
      getSyncCenterReadModel({}),
      getCabinsListReadModel({ page: 1, limit: 5, search: '' }),
      firstCabin ? getCabinDetailReadModel(String(firstCabin._id)) : Promise.resolve(null),
      getReviewsReadModel({ page: 1, limit: 5 }),
      getCommunicationOversightReadModel(),
      getOpsHealthReadModel(),
      firstBooking ? getReservationDetailReadModel(String(firstBooking._id)) : Promise.resolve(null)
    ]);

    // Payments
    assert(paymentsSummary && paymentsSummary.totals, 'paymentsSummary.totals missing');
    assert(typeof paymentsSummary.observability?.webhookLastSeenAt !== 'undefined', 'paymentsSummary.observability.webhookLastSeenAt missing');
    assert(Array.isArray(paymentsLedger.items), 'paymentsLedger.items must be an array');

    // Payouts
    assert(Array.isArray(payoutsList.items), 'payoutsList.items must be an array');
    assert(payoutReconciliation && payoutReconciliation.totals, 'payoutReconciliation.totals missing');
    if (firstPayout) assert(payoutDetail && payoutDetail.payout, 'payoutDetail.payout missing');

    // Sync
    assert(Array.isArray(syncCenter.healthByCabinChannel), 'syncCenter.healthByCabinChannel must be an array');
    assert(Array.isArray(syncCenter.recentEvents), 'syncCenter.recentEvents must be an array');
    assert(syncCenter.aggregates && typeof syncCenter.aggregates.unresolvedSyncManualReviews !== 'undefined', 'syncCenter.aggregates missing');

    // Cabins
    assert(cabinsList && Array.isArray(cabinsList.items), 'cabinsList.items must be an array');
    if (firstCabin) assert(cabinDetail && cabinDetail.operationalSettings, 'cabinDetail.operationalSettings missing');

    // Reviews / Comms
    assert(Array.isArray(reviews.items), 'reviews.items must be an array');
    assert(commsOversight && commsOversight.summary, 'commsOversight.summary missing');

    // Manual review backlog
    assert(typeof manualOpenCount === 'number', 'manualOpenCount must be a number');

    // Reservation detail w/ notes integration
    if (firstBooking) {
      assert(reservationDetail && reservationDetail.notes && Array.isArray(reservationDetail.notes.items), 'reservationDetail.notes.items must be an array');
    }

    console.log(
      JSON.stringify(
        {
          success: true,
          batch: 'build-batch-6',
          sampleIds: {
            booking: firstBooking?._id ? String(firstBooking._id) : null,
            payout: firstPayout?._id ? String(firstPayout._id) : null,
            cabin: firstCabin?._id ? String(firstCabin._id) : null
          },
          manualReviewOpenCount: manualOpenCount,
          checks: ['payments', 'payouts', 'sync', 'cabins', 'reviews', 'communications', 'manual-review', 'reservation-notes']
        },
        null,
        2
      )
    );
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error(JSON.stringify({ success: false, batch: 'build-batch-6', error: error.message }, null, 2));
  process.exit(1);
});

