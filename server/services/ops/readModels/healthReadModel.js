const Guest = require('../../../models/Guest');
const AvailabilityBlock = require('../../../models/AvailabilityBlock');
const AuditEvent = require('../../../models/AuditEvent');
const ChannelSyncEvent = require('../../../models/ChannelSyncEvent');
const Payment = require('../../../models/Payment');
const Payout = require('../../../models/Payout');
const ManualReviewItem = require('../../../models/ManualReviewItem');
const StripeEventEvidence = require('../../../models/StripeEventEvidence');
const CabinChannelSyncState = require('../../../models/CabinChannelSyncState');
const { getIcalSyncSchedulerState } = require('../ingestion/icalSyncScheduler');
const { getReservationIntegritySignals } = require('../readiness/reservationIntegritySignals');

async function getOpsHealthReadModel() {
  const [
    guestCount,
    blockCount,
    auditCount,
    syncCount,
    paymentCount,
    payoutCount,
    manualReviewOpenCount,
    lastStripeEvent,
    syncStates,
    reservationIntegrity
  ] = await Promise.all([
    Guest.countDocuments({}),
    AvailabilityBlock.countDocuments({}),
    AuditEvent.countDocuments({}),
    ChannelSyncEvent.countDocuments({}),
    Payment.countDocuments({}),
    Payout.countDocuments({}),
    ManualReviewItem.countDocuments({ status: 'open' }),
    StripeEventEvidence.findOne({}).sort({ createdAtProvider: -1 }).lean(),
    CabinChannelSyncState.find({}).lean()
  ]);

  return {
    counts: {
      guests: guestCount,
      availabilityBlocks: blockCount,
      auditEvents: auditCount,
      syncEvents: syncCount,
      payments: paymentCount,
      payouts: payoutCount,
      manualReviewOpen: manualReviewOpenCount
    },
    readModelReadiness: {
      dashboard: true,
      calendar: true,
      reservations: true,
      syncCenter: true,
      payments: true,
      payouts: true,
      cabins: true,
      reviews: true,
      communications: true
    },
    degradedDependencies: [],
    dependencies: {
      stripeWebhookLastSeenAt: lastStripeEvent?.createdAtProvider || null,
      stripeWebhookLastType: lastStripeEvent?.eventType || null,
      syncLastSeenByCabinChannel: syncStates.map((s) => ({
        cabinId: String(s.cabinId),
        channel: s.channel,
        lastSyncedAt: s.lastSyncedAt || null,
        lastSyncOutcome: s.lastSyncOutcome || null
      }))
    },
    calendarSyncScheduler: getIcalSyncSchedulerState(),
    reservationIntegrity,
    generatedAt: new Date().toISOString()
  };
}

module.exports = {
  getOpsHealthReadModel
};
