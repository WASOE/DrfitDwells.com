/* eslint-disable no-console */
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const {
  getDashboardReadModel
} = require('../services/ops/readModels/dashboardReadModel');
const {
  getCalendarReadModel
} = require('../services/ops/readModels/calendarReadModel');
const {
  getReservationsWorkspaceReadModel
} = require('../services/ops/readModels/reservationsReadModel');
const {
  getSyncCenterReadModel
} = require('../services/ops/readModels/syncCenterReadModel');
const {
  getPaymentsSummaryReadModel
} = require('../services/ops/readModels/paymentsReadModel');
const {
  getCabinsListReadModel
} = require('../services/ops/readModels/cabinsReadModel');
const {
  getReviewsReadModel,
  getCommunicationOversightReadModel
} = require('../services/ops/readModels/reviewsCommsReadModel');
const {
  getOpsHealthReadModel
} = require('../services/ops/readModels/healthReadModel');

async function run() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri);
  try {
    const now = new Date();
    const in14 = new Date(now.getTime());
    in14.setUTCDate(in14.getUTCDate() + 14);
    const out = {
      dashboard: await getDashboardReadModel(),
      calendar: await getCalendarReadModel({ from: now, to: in14 }),
      reservations: await getReservationsWorkspaceReadModel({ page: 1, limit: 5 }),
      sync: await getSyncCenterReadModel({}),
      payments: await getPaymentsSummaryReadModel(),
      cabins: await getCabinsListReadModel({ page: 1, limit: 5 }),
      reviews: await getReviewsReadModel({ page: 1, limit: 5 }),
      communications: await getCommunicationOversightReadModel(),
      health: await getOpsHealthReadModel()
    };
    console.log(JSON.stringify({ success: true, batch: 'build-batch-2', shapes: Object.keys(out) }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
  process.exit(1);
});
