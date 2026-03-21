/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const http = require('http');
const mongoose = require('mongoose');

const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const Cabin = require('../models/Cabin');
const CabinChannelSyncState = require('../models/CabinChannelSyncState');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const ChannelSyncEvent = require('../models/ChannelSyncEvent');

const { startIcalSyncSchedulerIfEnabled, stopIcalSyncSchedulerForTest, getIcalSyncSchedulerState, runManualIcalSync } = require('../services/ops/ingestion/icalSyncScheduler');
const { getOpsHealthReadModel } = require('../services/ops/readModels/healthReadModel');

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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, { timeoutMs = 8000, intervalMs = 150 } = {}) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const ok = await predicate();
    if (ok) return ok;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout');
    await wait(intervalMs);
  }
}

async function run() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri);

  const channel = 'airbnb_ical';

  const fixtureDir = path.resolve(__dirname, '..', 'fixtures', 'calendar-sync');
  const todayUtc = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const base = addDaysUTC(todayUtc, 30);

  const replacements = {
    EV1_START: formatYmdUtc(addDaysUTC(base, 0)),
    EV1_END: formatYmdUtc(addDaysUTC(base, 2)),
    EV2_START: formatYmdUtc(addDaysUTC(base, 4)),
    EV2_END: formatYmdUtc(addDaysUTC(base, 6))
  };
  const successA = templateLoad(path.join(fixtureDir, 'success_case_a.ics'), replacements);

  // Local HTTP server for fixture endpoints.
  let retryRequests = 0;
  let overlapInFlight = false;

  const server = http.createServer((req, res) => {
    const urlPath = String(req.url || '').split('?')[0];

    if (urlPath === '/feedRetry') {
      retryRequests += 1;
      if (retryRequests <= 2) {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('temporary error');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/calendar' });
      res.end(successA);
      return;
    }

    if (urlPath === '/feedBroken') {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('permanent iCal feed failure');
      return;
    }

    if (urlPath === '/feedOverlapSlow') {
      overlapInFlight = true;
      const delayMs = 2500;
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'text/calendar' });
        res.end(successA);
      }, delayMs);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });

  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  // Isolation: clear existing configured cabins so scheduler candidates are deterministic.
  await CabinChannelSyncState.deleteMany({ channel });

  async function cleanupEvidenceForCabin(cabinId) {
    await AvailabilityBlock.deleteMany({ cabinId, blockType: 'external_hold', source: channel });
  }

  async function createCabinAndConfigure({ feedUrl, nameSuffix }) {
    const cabin = await Cabin.create({
      name: `Scheduler Test Cabin ${nameSuffix} ${Date.now()}`,
      description: 'Automatic iCal scheduler validation cabin',
      capacity: 2,
      pricePerNight: 120,
      minNights: 1,
      imageUrl: 'https://example.com/sync-validation.jpg',
      location: 'Bulgaria',
      geoLocation: { latitude: 42.6977, longitude: 23.3219 }
    });
    await CabinChannelSyncState.findOneAndUpdate(
      { cabinId: cabin._id, channel },
      { $set: { feedUrl } },
      { upsert: true, new: true }
    );
    return cabin;
  }

  // ---------------- Phase 1: Retry test (transient 503 then 200) ----------------
  const cabinRetry = await createCabinAndConfigure({ feedUrl: `${baseUrl}/feedRetry`, nameSuffix: 'retry' });

  await cleanupEvidenceForCabin(cabinRetry._id);

  process.env.OPS_ICAL_SYNC_SCHEDULER_ENABLED = 'true';
  process.env.OPS_ICAL_SYNC_INTERVAL_MS = '5000'; // long enough to avoid second scheduler cycle
  process.env.OPS_ICAL_SYNC_RETRY_MAX = '2';
  process.env.OPS_ICAL_SYNC_RETRY_DELAY_MS = '100';
  process.env.OPS_ICAL_SYNC_COOLDOWN_MS = '1000';
  process.env.OPS_ICAL_SYNC_FAILURE_COOLDOWN_MS = '2000';
  process.env.OPS_ICAL_SYNC_MAX_CABINS_PER_CYCLE = '5';
  process.env.OPS_ICAL_SYNC_MAX_CONCURRENT_RUNS = '1';

  stopIcalSyncSchedulerForTest();
  await (async () => {
    // start scheduler
    startIcalSyncSchedulerIfEnabled();
    await waitFor(async () => {
      const events = await ChannelSyncEvent.find({ cabinId: cabinRetry._id, channel }).lean();
      const hadSuccess = events.some((e) => e.outcome === 'success' || e.outcome === 'warning');
      const hadAtLeastAttempts = events.length >= 3;
      return hadSuccess || hadAtLeastAttempts;
    }, { timeoutMs: 8000, intervalMs: 150 });
  })();

  await waitFor(async () => {
    const events = await ChannelSyncEvent.find({ cabinId: cabinRetry._id, channel }).lean();
    return events.some((e) => e.outcome === 'success' || e.outcome === 'warning');
  }, { timeoutMs: 3000, intervalMs: 150 }).catch(() => {});

  const eventsRetry = await ChannelSyncEvent.find({ cabinId: cabinRetry._id, channel }).lean();
  assert(eventsRetry.length >= 2, 'retry phase should produce at least 2 sync evidence events');
  const hadFailed = eventsRetry.some((e) => e.outcome === 'failed');
  const hadSuccess = eventsRetry.some((e) => e.outcome === 'success' || e.outcome === 'warning');
  assert(hadFailed, 'retry phase should record at least one failed outcome');
  assert(hadSuccess, 'retry phase should eventually succeed after retries');

  const activeHoldsRetry = await AvailabilityBlock.countDocuments({ cabinId: cabinRetry._id, blockType: 'external_hold', source: channel, status: 'active' });
  assert(activeHoldsRetry >= 2, 'retry phase should create external_hold blocks');

  const healthAfter = await getOpsHealthReadModel();
  assert(healthAfter?.calendarSyncScheduler?.enabled === true, 'readiness/health must surface scheduler enabled');
  assert(healthAfter?.calendarSyncScheduler?.intervalMs, 'readiness/health must surface scheduler intervalMs');

  // Idempotency smoke: wait one more interval and ensure active holds count does not increase.
  await wait(5200);
  const activeHoldsRetryAfter = await AvailabilityBlock.countDocuments({ cabinId: cabinRetry._id, blockType: 'external_hold', source: channel, status: 'active' });
  assert(
    activeHoldsRetryAfter === activeHoldsRetry,
    `idempotency expectation failed: active holds changed from ${activeHoldsRetry} to ${activeHoldsRetryAfter}`
  );

  stopIcalSyncSchedulerForTest();

  // Remove configured sync state so later phases don't run this cabin.
  await CabinChannelSyncState.deleteMany({ cabinId: cabinRetry._id, channel });

  // ---------------- Phase 2: Overlap prevention + manual compatibility ----------------
  // In this phase: server delays > interval, so a second automatic tick must not start a second import for same cabin.
  retryRequests = 0;
  overlapInFlight = false;

  const cabinOverlap = await createCabinAndConfigure({ feedUrl: `${baseUrl}/feedOverlapSlow`, nameSuffix: 'overlap' });
  await cleanupEvidenceForCabin(cabinOverlap._id);

  process.env.OPS_ICAL_SYNC_SCHEDULER_ENABLED = 'true';
  process.env.OPS_ICAL_SYNC_INTERVAL_MS = '1000';
  process.env.OPS_ICAL_SYNC_RETRY_MAX = '0';
  process.env.OPS_ICAL_SYNC_RETRY_DELAY_MS = '100';
  process.env.OPS_ICAL_SYNC_COOLDOWN_MS = '5000';
  process.env.OPS_ICAL_SYNC_FAILURE_COOLDOWN_MS = '5000';
  process.env.OPS_ICAL_SYNC_MAX_CABINS_PER_CYCLE = '5';
  process.env.OPS_ICAL_SYNC_MAX_CONCURRENT_RUNS = '1';

  stopIcalSyncSchedulerForTest();
  startIcalSyncSchedulerIfEnabled();

  // Wait a bit so the first run is in progress.
  await waitFor(async () => {
    const st = getIcalSyncSchedulerState();
    return st.inProgressCount >= 1;
  }, { timeoutMs: 5000, intervalMs: 100 });
  const manualRes = await runManualIcalSync({ cabinId: cabinOverlap._id, feedUrl: `${baseUrl}/feedOverlapSlow`, channel });
  assert(manualRes?.status === 'in_progress', 'manual trigger must be blocked while scheduler run is in progress');

  await waitFor(async () => {
    const count = await ChannelSyncEvent.countDocuments({ cabinId: cabinOverlap._id, channel });
    return count >= 1;
  }, { timeoutMs: 10000, intervalMs: 200 });

  // Wait briefly but stay before the next 1s interval tick would normally start.
  await wait(600);
  const eventsOverlap = await ChannelSyncEvent.find({ cabinId: cabinOverlap._id, channel }).lean();
  const eventCount = eventsOverlap.length;
  assert(eventCount === 1, `overlap prevention should produce exactly 1 ChannelSyncEvent run before the next tick, got ${eventCount}`);

  stopIcalSyncSchedulerForTest();

  await CabinChannelSyncState.deleteMany({ cabinId: cabinOverlap._id, channel });

  // ---------------- Phase 3: Permanent broken-feed failure honesty ----------------
  const cabinBroken = await createCabinAndConfigure({ feedUrl: `${baseUrl}/feedBroken`, nameSuffix: 'broken' });
  await cleanupEvidenceForCabin(cabinBroken._id);

  process.env.OPS_ICAL_SYNC_SCHEDULER_ENABLED = 'true';
  process.env.OPS_ICAL_SYNC_INTERVAL_MS = '5000';
  process.env.OPS_ICAL_SYNC_RETRY_MAX = '1';
  process.env.OPS_ICAL_SYNC_RETRY_DELAY_MS = '100';
  process.env.OPS_ICAL_SYNC_COOLDOWN_MS = '1000';
  process.env.OPS_ICAL_SYNC_FAILURE_COOLDOWN_MS = '2000';
  process.env.OPS_ICAL_SYNC_MAX_CABINS_PER_CYCLE = '5';
  process.env.OPS_ICAL_SYNC_MAX_CONCURRENT_RUNS = '1';

  stopIcalSyncSchedulerForTest();
  startIcalSyncSchedulerIfEnabled();

  await waitFor(async () => {
    const outcomes = await ChannelSyncEvent.find({ cabinId: cabinBroken._id, channel }).lean();
    return outcomes.length >= 1;
  }, { timeoutMs: 8000, intervalMs: 150 });

  const eventsBroken = await ChannelSyncEvent.find({ cabinId: cabinBroken._id, channel }).lean();
  assert(eventsBroken.some((e) => e.outcome === 'failed'), 'broken feed should record failed outcomes');

  const activeHoldsBroken = await AvailabilityBlock.countDocuments({
    cabinId: cabinBroken._id,
    blockType: 'external_hold',
    source: channel,
    status: 'active'
  });
  assert(activeHoldsBroken === 0, 'broken feed should not create active external_hold');

  stopIcalSyncSchedulerForTest();

  await CabinChannelSyncState.deleteMany({ cabinId: cabinBroken._id, channel });

  server.close();
  await mongoose.disconnect();

  console.log(JSON.stringify({ success: true, batch: 'calendar-sync-scheduler' }, null, 2));
}

run().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ success: false, batch: 'calendar-sync-scheduler', error: error?.message || String(error) }, null, 2));
  process.exit(1);
});

