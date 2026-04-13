const ChannelSyncEvent = require('../../../models/ChannelSyncEvent');
const AvailabilityBlock = require('../../../models/AvailabilityBlock');
const ManualReviewItem = require('../../../models/ManualReviewItem');
const CabinChannelSyncState = require('../../../models/CabinChannelSyncState');

function deriveSyncStatus(lastEvent) {
  if (!lastEvent) return 'stale';
  if (lastEvent.outcome === 'failed') return 'failed';
  if (lastEvent.outcome === 'warning') return 'warning';
  return 'healthy';
}

async function getSyncCenterReadModel({ cabinId = null }) {
  const syncFilter = {};
  const holdFilter = { blockType: 'external_hold', status: 'active' };
  if (cabinId) {
    syncFilter.cabinId = cabinId;
    holdFilter.cabinId = cabinId;
  }

  const [events, externalHoldCount, unresolvedManualReviews, syncStates] = await Promise.all([
    ChannelSyncEvent.find(syncFilter).sort({ runAt: -1 }).limit(100).lean(),
    AvailabilityBlock.countDocuments(holdFilter),
    ManualReviewItem.countDocuments({ category: { $in: ['sync_anomaly', 'sync_feed_unreachable', 'sync_parse_failure', 'sync_duplicate_import', 'sync_deterministic_key_risk'] }, status: 'open' }),
    CabinChannelSyncState.find(cabinId ? { cabinId } : {}).lean()
  ]);

  const eventAnomalyCount = new Map();
  for (const event of events) {
    const key = `${String(event.cabinId)}:${event.channel}`;
    if (event.outcome !== 'success') {
      eventAnomalyCount.set(key, (eventAnomalyCount.get(key) || 0) + 1);
    }
  }

  const grouped = new Map();
  for (const event of events) {
    const key = `${String(event.cabinId)}:${event.channel}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        cabinId: String(event.cabinId),
        channel: event.channel,
        lastSyncedAt: event.runAt,
        lastSyncOutcome: event.outcome,
        syncStatus: deriveSyncStatus(event),
        unresolvedAnomalies: eventAnomalyCount.get(key) || 0
      });
    }
  }

  function syncStatusFromStateOutcome(o) {
    if (o === 'failed') return 'failed';
    if (o === 'warning') return 'warning';
    if (o === 'success') return 'healthy';
    return 'stale';
  }

  const healthByCabinChannel = [
    ...syncStates.map((state) => ({
      cabinId: String(state.cabinId),
      channel: state.channel,
      unitId: state.unitId ? String(state.unitId) : null,
      lastSyncedAt: state.lastSyncedAt || null,
      lastSyncOutcome: state.lastSyncOutcome || null,
      syncStatus: syncStatusFromStateOutcome(state.lastSyncOutcome),
      unresolvedAnomalies: eventAnomalyCount.get(`${String(state.cabinId)}:${state.channel}`) || 0,
      configuredFeed: Boolean(state.feedUrl),
      stale: state.lastSyncedAt
        ? Date.now() - new Date(state.lastSyncedAt).getTime() > 24 * 60 * 60 * 1000
        : true
    })),
    ...Array.from(grouped.values()).filter((ev) => {
      const hasState = syncStates.some(
        (s) => String(s.cabinId) === ev.cabinId && s.channel === ev.channel
      );
      return !hasState;
    })
  ];

  return {
    healthByCabinChannel,
    recentEvents: events.map((evt) => ({
      eventId: String(evt._id),
      cabinId: String(evt.cabinId),
      channel: evt.channel,
      runAt: evt.runAt,
      outcome: evt.outcome,
      anomalyType: evt.anomalyType || null,
      sourceReference: evt.sourceReference || null
    })),
    aggregates: {
      externalHoldCount,
      unresolvedSyncManualReviews: unresolvedManualReviews
    },
    degraded: {
      hasNoSyncData: events.length === 0
    }
  };
}

module.exports = {
  getSyncCenterReadModel
};
