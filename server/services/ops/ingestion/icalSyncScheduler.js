const CabinChannelSyncState = require('../../../models/CabinChannelSyncState');
const { importIcalForCabin } = require('./icalIngestionService');

const CHANNEL = 'airbnb_ical';

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_RETRY_MAX = 2;
const DEFAULT_RETRY_DELAY_MS = 60 * 1000;
const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000;
const DEFAULT_FAILURE_COOLDOWN_MS = 30 * 60 * 1000;
const DEFAULT_MAX_CABINS_PER_CYCLE = 50;
const DEFAULT_MAX_CONCURRENT_RUNS = 2;

// Module-level singleton storage (works inside one Node process).
// For multi-instance deployments, this is NOT a DB-level lock.
const globalKey = '__DDW_ICAL_SYNC_SCHEDULER__';

function state() {
  if (!global[globalKey]) {
    global[globalKey] = {
      timer: null,
      enabled: false,
      intervalMs: DEFAULT_INTERVAL_MS,
      retryMax: DEFAULT_RETRY_MAX,
      retryDelayMs: DEFAULT_RETRY_DELAY_MS,
      cooldownMs: DEFAULT_COOLDOWN_MS,
      failureCooldownMs: DEFAULT_FAILURE_COOLDOWN_MS,
      maxCabinsPerCycle: DEFAULT_MAX_CABINS_PER_CYCLE,
      maxConcurrentRuns: DEFAULT_MAX_CONCURRENT_RUNS,
      lastCycleAt: null,
      lastCycleDurationMs: null,
      lastCycleSummary: null,
      inProgress: new Map(), // key => { startedAt, cabinId, channel }
      cooldownUntil: new Map(), // key => timestampMs
      activeRunsCount: 0,
      lastRunError: null
    };
  }
  return global[globalKey];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeKey(cabinId, channel) {
  return `${cabinId}|${channel}`;
}

function getConfigFromEnv() {
  const enabled = String(process.env.OPS_ICAL_SYNC_SCHEDULER_ENABLED || '').toLowerCase() === '1' ||
    String(process.env.OPS_ICAL_SYNC_SCHEDULER_ENABLED || '').toLowerCase() === 'true';

  const intervalMs = parseInt(process.env.OPS_ICAL_SYNC_INTERVAL_MS || '', 10) || DEFAULT_INTERVAL_MS;
  const retryMax = parseInt(process.env.OPS_ICAL_SYNC_RETRY_MAX || '', 10) || DEFAULT_RETRY_MAX;
  const retryDelayMs = parseInt(process.env.OPS_ICAL_SYNC_RETRY_DELAY_MS || '', 10) || DEFAULT_RETRY_DELAY_MS;
  const cooldownMs = parseInt(process.env.OPS_ICAL_SYNC_COOLDOWN_MS || '', 10) || DEFAULT_COOLDOWN_MS;
  const failureCooldownMs = parseInt(process.env.OPS_ICAL_SYNC_FAILURE_COOLDOWN_MS || '', 10) || DEFAULT_FAILURE_COOLDOWN_MS;
  const maxCabinsPerCycle = parseInt(process.env.OPS_ICAL_SYNC_MAX_CABINS_PER_CYCLE || '', 10) || DEFAULT_MAX_CABINS_PER_CYCLE;
  const maxConcurrentRuns = parseInt(process.env.OPS_ICAL_SYNC_MAX_CONCURRENT_RUNS || '', 10) || DEFAULT_MAX_CONCURRENT_RUNS;

  return {
    enabled,
    intervalMs,
    retryMax,
    retryDelayMs,
    cooldownMs,
    failureCooldownMs,
    maxCabinsPerCycle,
    maxConcurrentRuns
  };
}

async function runOnceForCabin({ cabinId, feedUrl, channel = CHANNEL, source = 'scheduler' }) {
  const s = state();
  const key = makeKey(cabinId, channel);
  const now = Date.now();

  const cooldownUntil = s.cooldownUntil.get(key);
  if (cooldownUntil && cooldownUntil > now) {
    return { status: 'skipped_cooldown', outcome: null };
  }

  if (s.inProgress.has(key)) {
    return { status: 'in_progress', outcome: null };
  }

  s.inProgress.set(key, { startedAt: now, cabinId, channel, source });
  s.activeRunsCount += 1;
  s.lastRunError = null;

  try {
    let lastOutcome = null;
    let lastWarnings = null;
    let imported = 0;
    let tombstoned = 0;

    for (let attempt = 1; attempt <= s.retryMax + 1; attempt += 1) {
      const res = await importIcalForCabin({ cabinId, feedUrl, channel });
      lastOutcome = res?.outcome || null;
      lastWarnings = res?.warnings ?? 0;
      imported = res?.imported ?? 0;
      tombstoned = res?.tombstoned ?? 0;

      if (lastOutcome !== 'failed') {
        break;
      }

      if (attempt <= s.retryMax) {
        const delay = s.retryDelayMs * attempt;
        if (delay > 0) await sleep(delay);
      }
    }

    // Cooldown based on final outcome.
    const cooldown = lastOutcome === 'failed' ? s.failureCooldownMs : s.cooldownMs;
    s.cooldownUntil.set(key, Date.now() + cooldown);

    return {
      status: 'done',
      outcome: lastOutcome,
      warnings: lastWarnings,
      imported,
      tombstoned,
      attempts: s.retryMax + 1
    };
  } catch (err) {
    const cooldown = s.failureCooldownMs;
    s.cooldownUntil.set(key, Date.now() + cooldown);
    s.lastRunError = err?.message || String(err);
    throw err;
  } finally {
    s.inProgress.delete(key);
    s.activeRunsCount = Math.max(0, s.activeRunsCount - 1);
  }
}

async function tickOnce({ reason = 'scheduler_cycle' } = {}) {
  const s = state();
  const startedAt = Date.now();
  s.lastCycleAt = new Date(startedAt).toISOString();
  s.lastCycleSummary = null;
  s.lastRunError = null;

  // Discover configured cabins from source truth.
  // We only run cabins/channels with a configured feedUrl.
  const configured = await CabinChannelSyncState.find({
    channel: CHANNEL,
    feedUrl: { $exists: true, $nin: [null, ''] }
  })
    .select('cabinId feedUrl')
    .lean();

  const candidates = configured.slice(0, s.maxCabinsPerCycle);
  const runList = [];
  for (const c of candidates) {
    const key = makeKey(String(c.cabinId), CHANNEL);
    if (s.inProgress.has(key)) continue;
    const cooldownUntil = s.cooldownUntil.get(key);
    if (cooldownUntil && cooldownUntil > Date.now()) continue;
    runList.push({ cabinId: String(c.cabinId), feedUrl: c.feedUrl });
  }

  // Avoid hammering a single failing feed: cooldown + per-cabin in-progress lock.
  let i = 0;
  const results = [];
  const workers = new Array(Math.max(1, s.maxConcurrentRuns)).fill(0).map(async () => {
    while (i < runList.length) {
      const idx = i;
      i += 1;
      const item = runList[idx];
      if (!item) continue;
      const res = await runOnceForCabin({ cabinId: item.cabinId, feedUrl: item.feedUrl, channel: CHANNEL, source: 'scheduler' });
      results.push({ cabinId: item.cabinId, ...res });
    }
  });

  await Promise.all(workers);
  const dur = Date.now() - startedAt;
  s.lastCycleDurationMs = dur;
  s.lastCycleSummary = {
    reason,
    configuredCount: configured.length,
    candidatesCount: candidates.length,
    runCount: results.length,
    durMs: dur
  };
  return results;
}

function startIcalSyncSchedulerIfEnabled() {
  const s = state();
  const cfg = getConfigFromEnv();
  s.enabled = cfg.enabled;
  s.intervalMs = cfg.intervalMs;
  s.retryMax = cfg.retryMax;
  s.retryDelayMs = cfg.retryDelayMs;
  s.cooldownMs = cfg.cooldownMs;
  s.failureCooldownMs = cfg.failureCooldownMs;
  s.maxCabinsPerCycle = cfg.maxCabinsPerCycle;
  s.maxConcurrentRuns = cfg.maxConcurrentRuns;

  if (!s.enabled) {
    console.log('[ical-sync] Scheduler disabled via env.');
    return { started: false };
  }

  if (s.timer) {
    // Hot reload or double-import: keep single timer.
    console.log('[ical-sync] Scheduler already started (timer exists).');
    return { started: true, alreadyStarted: true };
  }

  console.log(`[ical-sync] Starting automatic iCal sync scheduler. intervalMs=${s.intervalMs} retryMax=${s.retryMax} retryDelayMs=${s.retryDelayMs}`);
  tickOnce({ reason: 'startup_immediate' }).catch((err) => {
    console.error('[ical-sync] Startup tick failed:', err?.message || err);
    s.lastRunError = err?.message || String(err);
  });

  s.timer = setInterval(() => {
    tickOnce({ reason: 'interval_tick' }).catch((err) => {
      console.error('[ical-sync] Tick failed:', err?.message || err);
      s.lastRunError = err?.message || String(err);
    });
  }, s.intervalMs);

  return { started: true };
}

function stopIcalSyncSchedulerForTest() {
  const s = state();
  if (s.timer) clearInterval(s.timer);
  s.timer = null;
}

function getIcalSyncSchedulerState() {
  const s = state();
  return {
    enabled: Boolean(s.enabled),
    intervalMs: s.intervalMs,
    retryMax: s.retryMax,
    retryDelayMs: s.retryDelayMs,
    cooldownMs: s.cooldownMs,
    failureCooldownMs: s.failureCooldownMs,
    lastCycleAt: s.lastCycleAt,
    lastCycleDurationMs: s.lastCycleDurationMs,
    activeRunsCount: s.activeRunsCount,
    inProgressCount: s.inProgress.size,
    lastCycleSummary: s.lastCycleSummary || null,
    lastRunError: s.lastRunError || null
  };
}

async function runManualIcalSync({ cabinId, feedUrl, channel = CHANNEL }) {
  const s = state();
  const key = makeKey(String(cabinId), channel);
  if (s.inProgress.has(key)) {
    return {
      status: 'in_progress',
      message: 'iCal sync already running for this cabin+channel'
    };
  }
  const res = await runOnceForCabin({ cabinId, feedUrl, channel, source: 'manual' });
  return res;
}

module.exports = {
  CHANNEL,
  startIcalSyncSchedulerIfEnabled,
  stopIcalSyncSchedulerForTest,
  getIcalSyncSchedulerState,
  runManualIcalSync,
  tickOnce
};

