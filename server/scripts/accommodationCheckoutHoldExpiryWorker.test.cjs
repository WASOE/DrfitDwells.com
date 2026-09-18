/**
 * B8F5B — Accommodation checkout-hold expiry worker tests.
 *
 * Run: cd server && node --test --test-concurrency=1 scripts/accommodationCheckoutHoldExpiryWorker.test.cjs
 */
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const workerMod = require('./runAccommodationCheckoutHoldExpiryWorker');
const {
  EXECUTE_ENV_FLAG,
  EXECUTE_ACCEPTED_TRUE,
  REQUIRED_INDEX_NAME,
  REQUIRED_INDEX_KEY_ORDER,
  DRAIN_YIELD_MS,
  IDLE_POLL_MS,
  ERROR_RETRY_MS,
  MIN_DELAY_MS,
  MAX_DELAY_MS,
  EXIT_DISABLED,
  EXIT_READINESS_STOP,
  EXIT_UNEXPECTED,
  isExecuteEnabled,
  indexKeyMatchesRequired,
  assertReleasedCleanupIndexReady,
  computeNextDelayMs,
  createAccommodationCheckoutHoldExpiryWorker,
  runStandaloneEntrypoint
} = workerMod;

const ORIG_EXECUTE = process.env[EXECUTE_ENV_FLAG];
const ORIG_LEASE_GATE = process.env.CHECKOUT_RESOURCE_LEASE_ENABLED;

function restoreEnv() {
  if (ORIG_EXECUTE === undefined) delete process.env[EXECUTE_ENV_FLAG];
  else process.env[EXECUTE_ENV_FLAG] = ORIG_EXECUTE;
  if (ORIG_LEASE_GATE === undefined) delete process.env.CHECKOUT_RESOURCE_LEASE_ENABLED;
  else process.env.CHECKOUT_RESOURCE_LEASE_ENABLED = ORIG_LEASE_GATE;
}

function makeFakeTimers() {
  const timers = [];
  let nowMs = 1_000_000;
  return {
    getNow: () => new Date(nowMs),
    advance(ms) {
      nowMs += ms;
      const due = timers.filter((t) => !t.cleared && t.when <= nowMs);
      for (const t of due) {
        t.cleared = true;
        t.fn();
      }
    },
    setTimeoutFn(fn, delay) {
      const handle = {
        when: nowMs + delay,
        fn,
        cleared: false
      };
      timers.push(handle);
      return handle;
    },
    clearTimeoutFn(handle) {
      if (handle) handle.cleared = true;
    },
    pending() {
      return timers.filter((t) => !t.cleared);
    },
    setNow(ms) {
      nowMs = ms;
    },
    nowMs: () => nowMs
  };
}

afterEach(() => {
  restoreEnv();
});

describe('B8F5B flag and import side effects', () => {
  it('importing the module has no startup timers or mongo connect side effects', () => {
    const src = fs.readFileSync(
      path.join(__dirname, 'runAccommodationCheckoutHoldExpiryWorker.js'),
      'utf8'
    );
    assert.match(src, /require\.main === module/);
    assert.equal(typeof createAccommodationCheckoutHoldExpiryWorker, 'function');
    // Module load must not flip execute flag or start work.
    assert.equal(isExecuteEnabled({}), false);
  });

  it('execution flag absent / false / malformed remains disabled', () => {
    assert.equal(isExecuteEnabled({}), false);
    assert.equal(isExecuteEnabled({ [EXECUTE_ENV_FLAG]: '' }), false);
    assert.equal(isExecuteEnabled({ [EXECUTE_ENV_FLAG]: '0' }), false);
    assert.equal(isExecuteEnabled({ [EXECUTE_ENV_FLAG]: 'true' }), false);
    assert.equal(isExecuteEnabled({ [EXECUTE_ENV_FLAG]: 'yes' }), false);
    assert.equal(isExecuteEnabled({ [EXECUTE_ENV_FLAG]: 'TRUE' }), false);
    assert.equal(isExecuteEnabled({ [EXECUTE_ENV_FLAG]: EXECUTE_ACCEPTED_TRUE }), true);
  });

  it('disabled entrypoint does not connect or invoke expiry', async () => {
    let connected = false;
    let expired = false;
    let exitCode = null;
    delete process.env[EXECUTE_ENV_FLAG];
    const res = await runStandaloneEntrypoint({
      env: {},
      exit: (code) => {
        exitCode = code;
      },
      connectMongo: async () => {
        connected = true;
      },
      disconnectMongo: async () => {},
      expireFn: async () => {
        expired = true;
        return {};
      },
      skipSignalHandlers: true
    });
    assert.equal(res.started, false);
    assert.equal(res.reason, 'disabled');
    assert.equal(connected, false);
    assert.equal(expired, false);
    assert.equal(exitCode, 0);
  });

  it('execution enabled with CHECKOUT_RESOURCE_LEASE_ENABLED unset still runs', async () => {
    let connected = false;
    let expireCalls = 0;
    let exitCode = null;
    const clocks = makeFakeTimers();
    delete process.env.CHECKOUT_RESOURCE_LEASE_ENABLED;
    const collection = {
      indexes: async () => [
        {
          name: REQUIRED_INDEX_NAME,
          key: Object.fromEntries(REQUIRED_INDEX_KEY_ORDER)
        }
      ]
    };
    const res = await runStandaloneEntrypoint({
      env: { [EXECUTE_ENV_FLAG]: '1' },
      exit: (code) => {
        exitCode = code;
      },
      connectMongo: async () => {
        connected = true;
      },
      disconnectMongo: async () => {},
      getLeaseCollection: () => collection,
      getNow: clocks.getNow,
      setTimeoutFn: clocks.setTimeoutFn,
      clearTimeoutFn: clocks.clearTimeoutFn,
      expireFn: async (deps) => {
        expireCalls += 1;
        assert.ok(deps.now instanceof Date);
        assert.deepEqual(Object.keys(deps), ['now']);
        return {
          releasedCleanupSelected: 0,
          releasedCleanupAttempted: 0,
          releasedCleanupCompleted: 0,
          releasedCleanupFailed: 0,
          releasedCleanupDeferred: 0,
          releasedCleanupAnnotationFailed: 0,
          releasedCleanupEligibleHasMore: false,
          releasedCleanupPendingTotal: 0,
          releasedCleanupNextRetryAt: null,
          expiredCount: 0
        };
      },
      skipSignalHandlers: true
    });
    assert.equal(connected, true);
    assert.equal(res.started, true);
    assert.equal(exitCode, null);
    clocks.advance(DRAIN_YIELD_MS);
    await new Promise((r) => setImmediate(r));
    assert.equal(expireCalls >= 1, true);
    if (res.worker) await res.worker.stop({ waitForInFlight: true });
    assert.equal(process.env.CHECKOUT_RESOURCE_LEASE_ENABLED, undefined);
  });
});

describe('B8F5B index readiness', () => {
  it('missing index fails closed', async () => {
    const r = await assertReleasedCleanupIndexReady({
      indexes: async () => [{ name: 'other', key: { leaseId: 1 } }]
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'required_index_missing');
  });

  it('mismatched key order fails closed', async () => {
    assert.equal(
      indexKeyMatchesRequired({
        leaseId: 1,
        status: 1,
        isLive: 1,
        checkoutClaimCleanupStatus: 1,
        checkoutClaimCleanupNextAttemptAt: 1
      }),
      false
    );
    const r = await assertReleasedCleanupIndexReady({
      indexes: async () => [
        {
          name: REQUIRED_INDEX_NAME,
          key: {
            leaseId: 1,
            status: 1,
            isLive: 1,
            checkoutClaimCleanupStatus: 1,
            checkoutClaimCleanupNextAttemptAt: 1
          }
        }
      ]
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'required_index_key_mismatch');
  });

  it('exact index present is ok', async () => {
    const r = await assertReleasedCleanupIndexReady({
      indexes: async () => [
        {
          name: REQUIRED_INDEX_NAME,
          key: Object.fromEntries(REQUIRED_INDEX_KEY_ORDER)
        }
      ]
    });
    assert.equal(r.ok, true);
  });

  it('entrypoint with missing index exits 78 and never expires', async () => {
    let expired = false;
    let exitCode = null;
    let disconnects = 0;
    const res = await runStandaloneEntrypoint({
      env: { [EXECUTE_ENV_FLAG]: '1' },
      exit: (code) => {
        exitCode = code;
      },
      connectMongo: async () => {},
      disconnectMongo: async () => {
        disconnects += 1;
      },
      getLeaseCollection: () => ({
        indexes: async () => []
      }),
      expireFn: async () => {
        expired = true;
        return {};
      },
      skipSignalHandlers: true
    });
    assert.equal(res.started, false);
    assert.equal(res.reason, 'required_index_missing');
    assert.equal(expired, false);
    assert.equal(exitCode, EXIT_READINESS_STOP);
    assert.equal(res.exitCode, EXIT_READINESS_STOP);
    assert.equal(disconnects, 1);
  });

  it('entrypoint with mismatched index keys exits 78', async () => {
    let expired = false;
    let exitCode = null;
    const res = await runStandaloneEntrypoint({
      env: { [EXECUTE_ENV_FLAG]: '1' },
      exit: (code) => {
        exitCode = code;
      },
      connectMongo: async () => {},
      disconnectMongo: async () => {},
      getLeaseCollection: () => ({
        indexes: async () => [
          {
            name: REQUIRED_INDEX_NAME,
            key: { leaseId: 1, status: 1 }
          }
        ]
      }),
      expireFn: async () => {
        expired = true;
        return {};
      },
      skipSignalHandlers: true
    });
    assert.equal(res.started, false);
    assert.equal(exitCode, EXIT_READINESS_STOP);
    assert.equal(expired, false);
  });
});

describe('B8F5B scheduling and trusted clock', () => {
  it('production call receives Date and only { now } — no authority keys', async () => {
    const clocks = makeFakeTimers();
    const calls = [];
    const logs = [];
    const worker = createAccommodationCheckoutHoldExpiryWorker({
      getNow: clocks.getNow,
      setTimeoutFn: clocks.setTimeoutFn,
      clearTimeoutFn: clocks.clearTimeoutFn,
      log: (event, fields) => logs.push({ event, fields }),
      expireFn: async (deps) => {
        calls.push(deps);
        // Inherited / nested poison must not be present — worker builds fresh object.
        assert.equal(deps.skipCleanupAttemptReservation, undefined);
        assert.equal(deps.ignoreCleanupNextAttemptAt, undefined);
        assert.equal(deps.cleanupAttemptAuthority, undefined);
        assert.deepEqual(Object.keys(deps).sort(), ['now']);
        assert.ok(deps.now instanceof Date);
        return {
          releasedCleanupEligibleHasMore: false,
          releasedCleanupPendingTotal: 0,
          releasedCleanupNextRetryAt: null,
          releasedCleanupSelected: 0,
          releasedCleanupAttempted: 0,
          releasedCleanupCompleted: 0,
          releasedCleanupFailed: 0,
          releasedCleanupDeferred: 0,
          releasedCleanupAnnotationFailed: 0
        };
      }
    });
    worker.start();
    clocks.advance(DRAIN_YIELD_MS);
    // Allow microtask completion of async tick
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 1);
    await worker.stop({ waitForInFlight: true });
  });

  it('no overlapping calls when batch is pending', async () => {
    const clocks = makeFakeTimers();
    let inExpire = 0;
    let maxConcurrent = 0;
    let releaseExpire;
    const gate = new Promise((resolve) => {
      releaseExpire = resolve;
    });
    const worker = createAccommodationCheckoutHoldExpiryWorker({
      getNow: clocks.getNow,
      setTimeoutFn: clocks.setTimeoutFn,
      clearTimeoutFn: clocks.clearTimeoutFn,
      log: () => {},
      expireFn: async () => {
        inExpire += 1;
        maxConcurrent = Math.max(maxConcurrent, inExpire);
        await gate;
        inExpire -= 1;
        return {
          releasedCleanupEligibleHasMore: false,
          releasedCleanupNextRetryAt: null
        };
      }
    });
    worker.start();
    clocks.advance(DRAIN_YIELD_MS);
    await new Promise((r) => setImmediate(r));
    assert.equal(worker.getState().inFlight, true);
    // Fire another timer while in flight — should no-op / not double-enter
    clocks.advance(IDLE_POLL_MS);
    await new Promise((r) => setImmediate(r));
    assert.equal(maxConcurrent, 1);
    releaseExpire();
    await new Promise((r) => setImmediate(r));
    await worker.stop({ waitForInFlight: true });
  });

  it('eligibleHasMore schedules drain yield', () => {
    const delay = computeNextDelayMs(
      { releasedCleanupEligibleHasMore: true },
      new Date()
    );
    assert.equal(delay, DRAIN_YIELD_MS);
  });

  it('Correction 1: distant nextRetryAt is capped by idle poll (no busy loop)', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const delay = computeNextDelayMs(
      {
        releasedCleanupEligibleHasMore: false,
        releasedCleanupNextRetryAt: new Date(now.getTime() + 45_000)
      },
      now
    );
    assert.equal(delay, IDLE_POLL_MS);
  });

  it('future nextRetryAt sooner than idle poll is preserved', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const delay = computeNextDelayMs(
      {
        releasedCleanupEligibleHasMore: false,
        releasedCleanupNextRetryAt: new Date(now.getTime() + 12_000)
      },
      now
    );
    assert.equal(delay, 12_000);
  });

  it('invalid or past nextRetryAt remains bounded (not zero)', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    assert.equal(
      computeNextDelayMs(
        {
          releasedCleanupEligibleHasMore: false,
          releasedCleanupNextRetryAt: new Date(now.getTime() - 1000)
        },
        now
      ),
      IDLE_POLL_MS
    );
    assert.equal(
      computeNextDelayMs(
        { releasedCleanupEligibleHasMore: false, releasedCleanupNextRetryAt: 'not-a-date' },
        now
      ),
      IDLE_POLL_MS
    );
    assert.equal(
      computeNextDelayMs({ releasedCleanupEligibleHasMore: false }, now),
      IDLE_POLL_MS
    );
  });

  it('top-level batch rejection schedules error retry and continues', async () => {
    const clocks = makeFakeTimers();
    let calls = 0;
    const worker = createAccommodationCheckoutHoldExpiryWorker({
      getNow: clocks.getNow,
      setTimeoutFn: clocks.setTimeoutFn,
      clearTimeoutFn: clocks.clearTimeoutFn,
      log: () => {},
      expireFn: async () => {
        calls += 1;
        if (calls === 1) {
          const err = new Error('boom');
          err.code = 'BATCH_FAIL';
          throw err;
        }
        return { releasedCleanupEligibleHasMore: false };
      }
    });
    worker.start();
    clocks.advance(DRAIN_YIELD_MS);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, 1);
    assert.equal(worker.getState().lastDelayMs, ERROR_RETRY_MS);
    clocks.advance(ERROR_RETRY_MS);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, 2);
    await worker.stop({ waitForInFlight: true });
  });

  it('graceful shutdown stops new work', async () => {
    const clocks = makeFakeTimers();
    let calls = 0;
    const worker = createAccommodationCheckoutHoldExpiryWorker({
      getNow: clocks.getNow,
      setTimeoutFn: clocks.setTimeoutFn,
      clearTimeoutFn: clocks.clearTimeoutFn,
      log: () => {},
      expireFn: async () => {
        calls += 1;
        return { releasedCleanupEligibleHasMore: false };
      }
    });
    worker.start();
    clocks.advance(DRAIN_YIELD_MS);
    await new Promise((r) => setImmediate(r));
    const afterFirst = calls;
    await worker.stop({ waitForInFlight: true });
    clocks.advance(IDLE_POLL_MS * 2);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, afterFirst);
    assert.equal(worker.getState().started, false);
    assert.equal(worker.getState().hasTimer, false);
  });
});

describe('B8F5B process manifest and logging hygiene', () => {
  it('ecosystem declares one instance and leaves execution disabled with stop codes', () => {
    const eco = require('../../ecosystem.config.cjs');
    const conf = eco.apps.find((a) => a.name === 'driftdwells-confirmation-worker');
    assert.ok(conf);
    assert.equal(conf.env.BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED, '0');
    assert.equal(conf.env_production.BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED, '1');
    assert.equal(conf.stop_exit_codes, undefined);
    assert.equal(conf.max_restarts, 20);

    const expiry = eco.apps.find(
      (a) => a.name === 'driftdwells-accommodation-hold-expiry-worker'
    );
    assert.ok(expiry);
    assert.equal(expiry.instances, 1);
    assert.equal(expiry.exec_mode, 'fork');
    assert.equal(expiry.env[EXECUTE_ENV_FLAG], '0');
    assert.equal(expiry.env_production[EXECUTE_ENV_FLAG], '0');
    assert.deepEqual(expiry.stop_exit_codes, [0, 78]);
    assert.equal(expiry.restart_delay, 15000);
    assert.equal(expiry.exp_backoff_restart_delay, 1000);
    assert.equal(expiry.max_restarts, 10);
    assert.equal(expiry.cron_restart, undefined);
    assert.equal(expiry.watch, undefined);
    assert.equal(
      expiry.script,
      'server/scripts/runAccommodationCheckoutHoldExpiryWorker.js'
    );
  });

  it('worker source never calls Unit/Cabin claim deletion APIs directly', () => {
    const src = fs.readFileSync(
      path.join(__dirname, 'runAccommodationCheckoutHoldExpiryWorker.js'),
      'utf8'
    );
    assert.doesNotMatch(src, /expireUnitCheckoutClaims|expireCabinCheckoutClaims|deleteMany/);
    assert.match(src, /expireAccommodationCheckoutHolds/);
    assert.doesNotMatch(src, /setInterval\s*\(/);
    assert.doesNotMatch(src, /\.createIndex\s*\(|\.syncIndexes\s*\(|\.ensureIndexes\s*\(/);
  });

  it('batch logs include counts not customer/payment payloads', async () => {
    const clocks = makeFakeTimers();
    const logs = [];
    const worker = createAccommodationCheckoutHoldExpiryWorker({
      getNow: clocks.getNow,
      setTimeoutFn: clocks.setTimeoutFn,
      clearTimeoutFn: clocks.clearTimeoutFn,
      log: (event, fields) => logs.push({ event, fields }),
      expireFn: async () => ({
        releasedCleanupSelected: 2,
        releasedCleanupAttempted: 2,
        releasedCleanupCompleted: 1,
        releasedCleanupFailed: 1,
        releasedCleanupDeferred: 0,
        releasedCleanupAnnotationFailed: 0,
        releasedCleanupEligibleHasMore: false,
        releasedCleanupPendingTotal: 1,
        releasedCleanupNextRetryAt: new Date(clocks.nowMs() + 30_000),
        releasedCleanupFailedIdentities: [{ leaseId: 'secret_lease', email: 'x@y.com' }],
        expiredCount: 0
      })
    });
    worker.start();
    clocks.advance(DRAIN_YIELD_MS);
    await new Promise((r) => setImmediate(r));
    const batch = logs.find((l) => l.event === 'accommodation_hold_expiry_batch');
    assert.ok(batch);
    assert.equal(batch.fields.selected, 2);
    assert.equal(batch.fields.failed, 1);
    assert.equal(batch.fields.pendingTotal, 1);
    assert.equal(batch.fields.releasedCleanupFailedIdentities, undefined);
    assert.equal(JSON.stringify(batch).includes('secret_lease'), false);
    assert.equal(JSON.stringify(batch).includes('@'), false);
    await worker.stop({ waitForInFlight: true });
  });

  it('fresh deps object ignores inherited cleanup-authority-looking properties', async () => {
    const clocks = makeFakeTimers();
    const proto = { skipCleanupAttemptReservation: true, ignoreCleanupNextAttemptAt: true };
    // Prove worker does not spread a poisoned bag — it only passes { now }.
    const worker = createAccommodationCheckoutHoldExpiryWorker({
      getNow: clocks.getNow,
      setTimeoutFn: clocks.setTimeoutFn,
      clearTimeoutFn: clocks.clearTimeoutFn,
      log: () => {},
      expireFn: async (deps) => {
        assert.equal(Object.getPrototypeOf(deps), Object.prototype);
        assert.equal(
          Object.prototype.hasOwnProperty.call(deps, 'skipCleanupAttemptReservation'),
          false
        );
        // Even if someone polluted Object.prototype (extreme), own keys are only now.
        assert.deepEqual(Object.keys(deps), ['now']);
        return { releasedCleanupEligibleHasMore: false };
      }
    });
    worker.start();
    clocks.advance(DRAIN_YIELD_MS);
    await new Promise((r) => setImmediate(r));
    await worker.stop({ waitForInFlight: true });
    void proto;
  });
});

describe('B8F5B Correction 1: discovery delay matrix', () => {
  const now = new Date('2026-09-17T12:00:00.000Z');

  it('eligibleHasMore → DRAIN_YIELD_MS (250)', () => {
    assert.equal(
      computeNextDelayMs({ releasedCleanupEligibleHasMore: true }, now),
      DRAIN_YIELD_MS
    );
  });

  it('nextRetryAt = now + 500ms → IDLE floor via clamp then capped → 1000ms', () => {
    assert.equal(
      computeNextDelayMs(
        {
          releasedCleanupEligibleHasMore: false,
          releasedCleanupNextRetryAt: new Date(now.getTime() + 500)
        },
        now
      ),
      MIN_DELAY_MS
    );
  });

  it('nextRetryAt = now + 10s → 10s', () => {
    assert.equal(
      computeNextDelayMs(
        {
          releasedCleanupEligibleHasMore: false,
          releasedCleanupNextRetryAt: new Date(now.getTime() + 10_000)
        },
        now
      ),
      10_000
    );
  });

  it('nextRetryAt = now + 30s → 30s', () => {
    assert.equal(
      computeNextDelayMs(
        {
          releasedCleanupEligibleHasMore: false,
          releasedCleanupNextRetryAt: new Date(now.getTime() + 30_000)
        },
        now
      ),
      IDLE_POLL_MS
    );
  });

  it('nextRetryAt = now + 45s → IDLE_POLL 30s (not 45s)', () => {
    assert.equal(
      computeNextDelayMs(
        {
          releasedCleanupEligibleHasMore: false,
          releasedCleanupNextRetryAt: new Date(now.getTime() + 45_000)
        },
        now
      ),
      IDLE_POLL_MS
    );
  });

  it('nextRetryAt = now + 1h → IDLE_POLL 30s (never suppress discovery)', () => {
    assert.equal(
      computeNextDelayMs(
        {
          releasedCleanupEligibleHasMore: false,
          releasedCleanupNextRetryAt: new Date(now.getTime() + 3_600_000)
        },
        now
      ),
      IDLE_POLL_MS
    );
  });

  it('missing / invalid / past / equal → IDLE_POLL 30s', () => {
    assert.equal(
      computeNextDelayMs({ releasedCleanupEligibleHasMore: false }, now),
      IDLE_POLL_MS
    );
    assert.equal(
      computeNextDelayMs(
        {
          releasedCleanupEligibleHasMore: false,
          releasedCleanupNextRetryAt: 'bogus'
        },
        now
      ),
      IDLE_POLL_MS
    );
    assert.equal(
      computeNextDelayMs(
        {
          releasedCleanupEligibleHasMore: false,
          releasedCleanupNextRetryAt: new Date(now.getTime() - 5_000)
        },
        now
      ),
      IDLE_POLL_MS
    );
    assert.equal(
      computeNextDelayMs(
        {
          releasedCleanupEligibleHasMore: false,
          releasedCleanupNextRetryAt: new Date(now.getTime())
        },
        now
      ),
      IDLE_POLL_MS
    );
  });

  it('clock moves backward or forward → finite delay between MIN and IDLE', () => {
    // Clock jumped past nextRetryAt → past/equal path → IDLE.
    const delayPast = computeNextDelayMs(
      {
        releasedCleanupEligibleHasMore: false,
        releasedCleanupNextRetryAt: new Date(now.getTime() + 20_000)
      },
      new Date(now.getTime() + 25_000)
    );
    assert.equal(delayPast, IDLE_POLL_MS);

    // Clock jumped backward → larger positive delta, still capped by IDLE.
    const delayRewound = computeNextDelayMs(
      {
        releasedCleanupEligibleHasMore: false,
        releasedCleanupNextRetryAt: new Date(now.getTime() + 20_000)
      },
      new Date(now.getTime() - 5_000)
    );
    assert.equal(delayRewound, 25_000);
    assert.ok(Number.isFinite(delayPast));
    assert.ok(Number.isFinite(delayRewound));
    assert.ok(delayPast >= MIN_DELAY_MS && delayPast <= IDLE_POLL_MS);
    assert.ok(delayRewound >= MIN_DELAY_MS && delayRewound <= IDLE_POLL_MS);

    // Mild forward skew still within idle bound.
    const delayMild = computeNextDelayMs(
      {
        releasedCleanupEligibleHasMore: false,
        releasedCleanupNextRetryAt: new Date(now.getTime() + 20_000)
      },
      new Date(now.getTime() + 5_000)
    );
    assert.equal(delayMild, 15_000);
    assert.ok(delayMild >= MIN_DELAY_MS && delayMild <= IDLE_POLL_MS);
  });

  it('one-hour deferred retry does not suppress 30s polling in live worker', async () => {
    const clocks = makeFakeTimers();
    const delays = [];
    const origScheduleLog = [];
    const worker = createAccommodationCheckoutHoldExpiryWorker({
      getNow: clocks.getNow,
      setTimeoutFn: (fn, delay) => {
        delays.push(delay);
        return clocks.setTimeoutFn(fn, delay);
      },
      clearTimeoutFn: clocks.clearTimeoutFn,
      log: (event, fields) => origScheduleLog.push({ event, fields }),
      expireFn: async () => ({
        releasedCleanupEligibleHasMore: false,
        releasedCleanupNextRetryAt: new Date(clocks.nowMs() + 3_600_000)
      })
    });
    worker.start();
    clocks.advance(DRAIN_YIELD_MS);
    await new Promise((r) => setImmediate(r));
    assert.equal(worker.getState().lastDelayMs, IDLE_POLL_MS);
    assert.ok(delays.includes(IDLE_POLL_MS) || delays[delays.length - 1] === IDLE_POLL_MS);
    await worker.stop({ waitForInFlight: true });
  });

  it('distant deferred header plus new work at +10s is discovered by +30s', async () => {
    const clocks = makeFakeTimers();
    let calls = 0;
    let sawNewWork = false;
    const worker = createAccommodationCheckoutHoldExpiryWorker({
      getNow: clocks.getNow,
      setTimeoutFn: clocks.setTimeoutFn,
      clearTimeoutFn: clocks.clearTimeoutFn,
      log: () => {},
      expireFn: async () => {
        calls += 1;
        const elapsed = clocks.nowMs() - 1_000_000;
        if (elapsed >= 10_000) {
          sawNewWork = true;
          return {
            releasedCleanupEligibleHasMore: false,
            releasedCleanupSelected: 1,
            releasedCleanupCompleted: 1,
            releasedCleanupNextRetryAt: null
          };
        }
        return {
          releasedCleanupEligibleHasMore: false,
          releasedCleanupDeferred: 1,
          releasedCleanupNextRetryAt: new Date(clocks.nowMs() + 3_600_000)
        };
      }
    });
    worker.start();
    clocks.advance(DRAIN_YIELD_MS);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, 1);
    // Advance through one idle poll window — new work must be seen by 30s.
    clocks.advance(IDLE_POLL_MS);
    await new Promise((r) => setImmediate(r));
    assert.ok(calls >= 2);
    assert.equal(sawNewWork, true);
    assert.ok(clocks.nowMs() - 1_000_000 <= IDLE_POLL_MS + DRAIN_YIELD_MS);
    await worker.stop({ waitForInFlight: true });
  });
});

describe('B8F5B Correction 1: exit codes, PM2 policy, timers', () => {
  const { spawnSync } = require('node:child_process');
  const workerPath = path.join(__dirname, 'runAccommodationCheckoutHoldExpiryWorker.js');
  const ecoPath = path.join(__dirname, '../../ecosystem.config.cjs');

  it('disabled child exits 0 once; no production expiry', () => {
    const probe = `
      const mod = require(${JSON.stringify(workerPath)});
      let exits = [];
      const logs = [];
      const origLog = console.log;
      const origErr = console.error;
      console.log = (...a) => { logs.push(a.join(' ')); };
      console.error = (...a) => { logs.push(a.join(' ')); };
      mod.runStandaloneEntrypoint({
        env: { ACCOMMODATION_CHECKOUT_HOLD_EXPIRY_EXECUTE: '0' },
        exit: (c) => exits.push(c),
        connectMongo: async () => { throw new Error('must_not_connect'); },
        expireFn: async () => { throw new Error('must_not_expire'); },
        skipSignalHandlers: true
      }).then((r) => {
        console.log = origLog;
        console.error = origErr;
        process.stdout.write('__PROBE__' + JSON.stringify({ exits, r, logCount: logs.length }));
        process.exit(0);
      }).catch((e) => {
        console.log = origLog;
        console.error = origErr;
        process.stderr.write(String(e && e.stack || e));
        process.exit(2);
      });
    `;
    const out = spawnSync(process.execPath, ['-e', probe], {
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, ACCOMMODATION_CHECKOUT_HOLD_EXPIRY_EXECUTE: '0' }
    });
    assert.equal(out.status, 0, out.stderr);
    const marker = out.stdout.indexOf('__PROBE__');
    assert.ok(marker >= 0, out.stdout);
    const parsed = JSON.parse(out.stdout.slice(marker + '__PROBE__'.length));
    assert.deepEqual(parsed.exits, [0]);
    assert.equal(parsed.r.exitCode, EXIT_DISABLED);
    assert.equal(parsed.r.started, false);
  });

  it('PM2 treats exit 0 and 78 as stopped; unexpected 1 retains restart policy', () => {
    // Fresh require of ecosystem (clear cache if prior tests loaded it).
    delete require.cache[require.resolve(ecoPath)];
    const eco = require(ecoPath);
    const expiry = eco.apps.find(
      (a) => a.name === 'driftdwells-accommodation-hold-expiry-worker'
    );
    const confirmation = eco.apps.find((a) => a.name === 'driftdwells-confirmation-worker');
    assert.ok(expiry);
    assert.deepEqual(expiry.stop_exit_codes, [EXIT_DISABLED, EXIT_READINESS_STOP]);
    assert.equal(expiry.autorestart, true);
    assert.equal(expiry.restart_delay, 15000);
    assert.equal(expiry.exp_backoff_restart_delay, 1000);
    assert.equal(expiry.max_restarts, 10);
    assert.equal(expiry.instances, 1);
    assert.equal(expiry.exec_mode, 'fork');
    assert.equal(expiry.env[EXECUTE_ENV_FLAG], '0');
    assert.equal(expiry.cron_restart, undefined);
    assert.equal(expiry.watch, undefined);
    // Existing confirmation app unchanged (no global stop policy).
    assert.equal(confirmation.stop_exit_codes, undefined);
    assert.equal(confirmation.max_restarts, 20);
    assert.equal(confirmation.instances, 1);
    assert.equal(confirmation.exec_mode, 'fork');
  });

  it('missing-index child exits 78 after disconnect; no expiry', async () => {
    let disconnectOrder = [];
    let exitCode = null;
    let expired = false;
    const res = await runStandaloneEntrypoint({
      env: { [EXECUTE_ENV_FLAG]: '1' },
      exit: (code) => {
        exitCode = code;
        disconnectOrder.push('exit');
      },
      connectMongo: async () => {
        disconnectOrder.push('connect');
      },
      disconnectMongo: async () => {
        disconnectOrder.push('disconnect');
      },
      getLeaseCollection: () => ({
        indexes: async () => []
      }),
      expireFn: async () => {
        expired = true;
        return {};
      },
      skipSignalHandlers: true
    });
    assert.equal(expired, false);
    assert.equal(exitCode, EXIT_READINESS_STOP);
    assert.equal(res.exitCode, EXIT_READINESS_STOP);
    assert.deepEqual(disconnectOrder, ['connect', 'disconnect', 'exit']);
  });

  it('mismatched-index child exits 78', async () => {
    let exitCode = null;
    let expired = false;
    await runStandaloneEntrypoint({
      env: { [EXECUTE_ENV_FLAG]: '1' },
      exit: (code) => {
        exitCode = code;
      },
      connectMongo: async () => {},
      disconnectMongo: async () => {},
      getLeaseCollection: () => ({
        indexes: async () => [
          {
            name: REQUIRED_INDEX_NAME,
            key: {
              leaseId: 1,
              status: 1,
              isLive: 1,
              checkoutClaimCleanupStatus: 1,
              checkoutClaimCleanupNextAttemptAt: 1
            }
          }
        ]
      }),
      expireFn: async () => {
        expired = true;
        return {};
      },
      skipSignalHandlers: true
    });
    assert.equal(exitCode, EXIT_READINESS_STOP);
    assert.equal(expired, false);
  });

  it('no unconditional keep-alive; enabled worker stays alive via recursive schedule', async () => {
    const src = fs.readFileSync(workerPath, 'utf8');
    assert.doesNotMatch(src, /setInterval\s*\(/);
    const clocks = makeFakeTimers();
    let calls = 0;
    const worker = createAccommodationCheckoutHoldExpiryWorker({
      getNow: clocks.getNow,
      setTimeoutFn: clocks.setTimeoutFn,
      clearTimeoutFn: clocks.clearTimeoutFn,
      log: () => {},
      expireFn: async () => {
        calls += 1;
        return { releasedCleanupEligibleHasMore: false };
      }
    });
    worker.start();
    assert.equal(worker.getState().started, true);
    assert.equal(worker.getState().hasTimer, true);
    clocks.advance(DRAIN_YIELD_MS);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, 1);
    assert.equal(worker.getState().hasTimer, true);
    clocks.advance(IDLE_POLL_MS);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, 2);
    await worker.stop({ waitForInFlight: true });
    assert.equal(worker.getState().hasTimer, false);
    assert.equal(clocks.pending().length, 0);
  });

  it('repeated signals disconnect once', async () => {
    let disconnects = 0;
    let exits = 0;
    const clocks = makeFakeTimers();
    const res = await runStandaloneEntrypoint({
      env: { [EXECUTE_ENV_FLAG]: '1' },
      exit: () => {
        exits += 1;
      },
      connectMongo: async () => {},
      disconnectMongo: async () => {
        disconnects += 1;
      },
      getLeaseCollection: () => ({
        indexes: async () => [
          {
            name: REQUIRED_INDEX_NAME,
            key: Object.fromEntries(REQUIRED_INDEX_KEY_ORDER)
          }
        ]
      }),
      expireFn: async () => ({ releasedCleanupEligibleHasMore: false }),
      getNow: clocks.getNow,
      setTimeoutFn: clocks.setTimeoutFn,
      clearTimeoutFn: clocks.clearTimeoutFn,
      skipSignalHandlers: true
    });
    assert.equal(res.started, true);
    await res.shutdown('SIGTERM');
    await res.shutdown('SIGINT');
    await res.shutdown('SIGTERM');
    assert.equal(disconnects, 1);
    assert.equal(exits, 1);
    assert.equal(res.worker.getState().started, false);
  });

  it('no index create helpers and flags remain unset in this process', () => {
    const src = fs.readFileSync(workerPath, 'utf8');
    assert.doesNotMatch(src, /\.createIndex\s*\(|syncIndexes\s*\(|ensureIndex/);
    assert.equal(process.env[EXECUTE_ENV_FLAG], undefined);
    assert.equal(process.env.CHECKOUT_RESOURCE_LEASE_ENABLED, undefined);
  });
});
