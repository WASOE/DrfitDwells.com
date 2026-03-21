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
        unresolvedAnomalies: 0
      });
    }
    if (event.outcome !== 'success') {
      grouped.get(key).unresolvedAnomalies += 1;
    }
  }

  const stateMap = new Map(syncStates.map((s) => [`${String(s.cabinId)}:${s.channel}`, s]));
  const merged = Array.from(grouped.values());
  for (const state of syncStates) {
    const key = `${String(state.cabinId)}:${state.channel}`;
    if (!grouped.has(key)) {
      merged.push({
        cabinId: String(state.cabinId),
        channel: state.channel,
        lastSyncedAt: state.lastSyncedAt || null,
        lastSyncOutcome: state.lastSyncOutcome || null,
        syncStatus: state.lastSyncOutcome || 'stale',
        unresolvedAnomalies: 0
      });
    }
  }

  const healthByCabinChannel = merged.map((entry) => {
    const state = stateMap.get(`${entry.cabinId}:${entry.channel}`);
    return {
      ...entry,
      lastSyncedAt: state?.lastSyncedAt || entry.lastSyncedAt || null,
      lastSyncOutcome: state?.lastSyncOutcome || entry.lastSyncOutcome || null,
      configuredFeed: Boolean(state?.feedUrl),
      stale: state?.lastSyncedAt ? Date.now() - new Date(state.lastSyncedAt).getTime() > 24 * 60 * 60 * 1000 : true
    };
  });

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
