/**
 * Dashboard sync alert: only latest-per-source unresolved warning/failed events.
 * Run: cd server && node --test scripts/dashboardSyncRecoveredFailures.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const ChannelSyncEvent = require('../models/ChannelSyncEvent');
const {
  getDashboardReadModel,
  queryUnresolvedLatestSyncIssues,
  buildSyncSourceKey
} = require('../services/ops/readModels/dashboardReadModel');

let mongoServer;

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000);
}

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function createSyncEvent({
  cabinId,
  channel = 'airbnb_ical',
  outcome,
  runAt,
  feedUrl,
  unitId = null,
  anomalyType = null,
  message = ''
}) {
  return ChannelSyncEvent.create({
    cabinId,
    channel,
    runAt,
    outcome,
    message,
    anomalyType,
    metadata: {
      feedUrl,
      unitId: unitId != null ? String(unitId) : null
    }
  });
}

function syncAlerts(dashboardResult) {
  const alerts = dashboardResult?.dashboard?.alerts || dashboardResult?.sections?.actionNeeded || [];
  return alerts.filter((a) => a.type === 'sync_issue');
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await ChannelSyncEvent.syncIndexes();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  // ChannelSyncEvent is append-only via mongoose middleware; use native collection for test isolation.
  await ChannelSyncEvent.collection.deleteMany({});
});

test('buildSyncSourceKey excludes outcome and anomalyType', () => {
  const cabinId = new mongoose.Types.ObjectId();
  const a = buildSyncSourceKey({
    cabinId,
    channel: 'airbnb_ical',
    outcome: 'failed',
    anomalyType: 'feed_unreachable',
    metadata: { feedUrl: 'https://example.test/a.ics', unitId: 'u1' }
  });
  const b = buildSyncSourceKey({
    cabinId,
    channel: 'airbnb_ical',
    outcome: 'success',
    anomalyType: null,
    metadata: { feedUrl: 'https://example.test/a.ics', unitId: 'u1' }
  });
  assert.equal(a, b);
});

test('1. Failed event followed by success for the same feed produces no dashboard sync alert', async () => {
  const cabinId = new mongoose.Types.ObjectId();
  const feedUrl = 'https://example.test/feeds/recover-fail.ics';

  await createSyncEvent({
    cabinId,
    outcome: 'failed',
    runAt: daysAgo(5),
    feedUrl,
    anomalyType: 'feed_unreachable',
    message: 'HTTP 500'
  });
  await createSyncEvent({
    cabinId,
    outcome: 'success',
    runAt: minutesAgo(15),
    feedUrl,
    anomalyType: null,
    message: 'ok'
  });

  const dashboard = await getDashboardReadModel();
  assert.equal(syncAlerts(dashboard).length, 0);
  assert.equal(dashboard.dashboard.health.sync.recentIssuesCount, 0);
  assert.equal(dashboard.aggregates.syncWarnings, 0);
});

test('2. Warning followed by success produces no alert', async () => {
  const cabinId = new mongoose.Types.ObjectId();
  const feedUrl = 'https://example.test/feeds/recover-warn.ics';

  await createSyncEvent({
    cabinId,
    outcome: 'warning',
    runAt: daysAgo(2),
    feedUrl,
    anomalyType: 'import_warning'
  });
  await createSyncEvent({
    cabinId,
    outcome: 'success',
    runAt: minutesAgo(5),
    feedUrl,
    anomalyType: null
  });

  const dashboard = await getDashboardReadModel();
  assert.equal(syncAlerts(dashboard).length, 0);
  assert.equal(dashboard.dashboard.health.sync.recentIssuesCount, 0);
});

test('3. Success followed by failure produces an alert', async () => {
  const cabinId = new mongoose.Types.ObjectId();
  const feedUrl = 'https://example.test/feeds/later-fail.ics';

  await createSyncEvent({
    cabinId,
    outcome: 'success',
    runAt: minutesAgo(60),
    feedUrl
  });
  await createSyncEvent({
    cabinId,
    outcome: 'failed',
    runAt: minutesAgo(10),
    feedUrl,
    anomalyType: 'feed_unreachable'
  });

  const dashboard = await getDashboardReadModel();
  const alerts = syncAlerts(dashboard);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].severity, 'high');
  assert.equal(dashboard.dashboard.health.sync.recentIssuesCount, 1);
});

test('4. Latest failure for one feed is not cleared by success from a different feed', async () => {
  const cabinId = new mongoose.Types.ObjectId();
  const feedA = 'https://example.test/feeds/a.ics';
  const feedB = 'https://example.test/feeds/b.ics';

  await createSyncEvent({
    cabinId,
    outcome: 'failed',
    runAt: minutesAgo(40),
    feedUrl: feedA,
    anomalyType: 'feed_unreachable'
  });
  await createSyncEvent({
    cabinId,
    outcome: 'success',
    runAt: minutesAgo(5),
    feedUrl: feedB
  });

  const dashboard = await getDashboardReadModel();
  const alerts = syncAlerts(dashboard);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].severity, 'high');
  assert.equal(dashboard.dashboard.health.sync.recentIssuesCount, 1);

  const unresolved = await queryUnresolvedLatestSyncIssues({
    since: daysAgo(7),
    limit: 5
  });
  assert.equal(unresolved.unresolvedCount, 1);
  assert.equal(unresolved.unresolvedEvents[0].metadata.feedUrl, feedA);
});

test('5. Multiple old failures followed by repeated successes produce no alert', async () => {
  const cabinId = new mongoose.Types.ObjectId();
  const feedUrl = 'https://example.test/feeds/many-fails-then-ok.ics';

  for (let i = 0; i < 4; i += 1) {
    await createSyncEvent({
      cabinId,
      outcome: 'failed',
      runAt: daysAgo(6 - i),
      feedUrl,
      anomalyType: 'feed_unreachable',
      message: `fail ${i}`
    });
  }
  for (let i = 0; i < 6; i += 1) {
    await createSyncEvent({
      cabinId,
      outcome: 'success',
      runAt: minutesAgo(90 - i * 15),
      feedUrl,
      anomalyType: null,
      message: `ok ${i}`
    });
  }

  const dashboard = await getDashboardReadModel();
  assert.equal(syncAlerts(dashboard).length, 0);
  assert.equal(dashboard.dashboard.health.sync.recentIssuesCount, 0);
  assert.equal(dashboard.aggregates.syncWarnings, 0);
});

test('6. Current unresolved warning produces medium severity', async () => {
  const cabinId = new mongoose.Types.ObjectId();
  await createSyncEvent({
    cabinId,
    outcome: 'warning',
    runAt: minutesAgo(8),
    feedUrl: 'https://example.test/feeds/warn-now.ics',
    anomalyType: 'import_warning'
  });

  const dashboard = await getDashboardReadModel();
  const alerts = syncAlerts(dashboard);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].severity, 'medium');
  assert.equal(alerts[0].title, 'Sync needs review');
});

test('7. Current unresolved failure produces high severity', async () => {
  const cabinId = new mongoose.Types.ObjectId();
  await createSyncEvent({
    cabinId,
    outcome: 'failed',
    runAt: minutesAgo(3),
    feedUrl: 'https://example.test/feeds/fail-now.ics',
    anomalyType: 'feed_unreachable'
  });

  const dashboard = await getDashboardReadModel();
  const alerts = syncAlerts(dashboard);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].severity, 'high');
});

test('8. Historical ChannelSyncEvent records remain unchanged', async () => {
  const cabinId = new mongoose.Types.ObjectId();
  const feedUrl = 'https://example.test/feeds/immutable.ics';
  const failed = await createSyncEvent({
    cabinId,
    outcome: 'failed',
    runAt: daysAgo(4),
    feedUrl,
    anomalyType: 'feed_unreachable',
    message: 'HTTP 500'
  });
  const success = await createSyncEvent({
    cabinId,
    outcome: 'success',
    runAt: minutesAgo(2),
    feedUrl,
    anomalyType: null,
    message: 'recovered'
  });

  await getDashboardReadModel();

  const afterFailed = await ChannelSyncEvent.findById(failed._id).lean();
  const afterSuccess = await ChannelSyncEvent.findById(success._id).lean();
  assert.equal(afterFailed.outcome, 'failed');
  assert.equal(afterFailed.message, 'HTTP 500');
  assert.equal(afterSuccess.outcome, 'success');
  assert.equal(afterSuccess.message, 'recovered');
  assert.equal(await ChannelSyncEvent.collection.countDocuments({}), 2);

  await assert.rejects(
    () => ChannelSyncEvent.updateOne({ _id: failed._id }, { $set: { outcome: 'success' } }),
    /append-only and immutable/
  );
});
