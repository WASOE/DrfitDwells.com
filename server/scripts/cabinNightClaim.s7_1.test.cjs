'use strict';

/**
 * REBOOK-S1.7.1 — API authoritative boot-order gate tests.
 *
 * These behavioral tests would fail against the pre-fix pattern where
 * app.listen and in-process workers raced ahead of the async authority assert.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { startApiProcess } = require('../bootstrap/startApiProcess');
const { MODES } = require('../services/inventory/cabinNightClaimMode');

const ORIG_MODE = process.env.CABIN_NIGHT_CLAIM_MODE;

function restoreMode() {
  if (ORIG_MODE === undefined) delete process.env.CABIN_NIGHT_CLAIM_MODE;
  else process.env.CABIN_NIGHT_CLAIM_MODE = ORIG_MODE;
}

beforeEach(() => {
  process.env.CABIN_NIGHT_CLAIM_MODE = MODES.SHADOW;
});

afterEach(() => {
  restoreMode();
});

function readRepoSource(relFromServer) {
  return fs.readFileSync(path.join(__dirname, '..', relFromServer), 'utf8');
}

function createHarness(overrides = {}) {
  const events = [];
  let exitCode = null;
  let resolveAssert;
  let assertStarted = false;

  const pendingAssert = new Promise((resolve) => {
    resolveAssert = resolve;
  });

  const harness = {
    events,
    getExitCode: () => exitCode,
    resolveAssert: (value) => resolveAssert(value),
    rejectAssert: (err) => resolveAssert(Promise.reject(err)),
    isAssertStarted: () => assertStarted,
    opts: {
      connectDbFn:
        overrides.connectDbFn ||
        (async () => {
          events.push('mongo_connected');
          return { connection: { host: 'test' } };
        }),
      assertAuthorityBootFn:
        overrides.assertAuthorityBootFn ||
        (async () => {
          assertStarted = true;
          events.push('assert_started');
          const result = await pendingAssert;
          events.push('assert_resolved');
          return result;
        }),
      startHttpListenerFn:
        overrides.startHttpListenerFn ||
        (() => {
          events.push('listen');
          return { close() {} };
        }),
      startPostConnectRuntimeFn:
        overrides.startPostConnectRuntimeFn ||
        (() => {
          events.push('workers_started');
          events.push('checkout_finalization_worker');
        }),
      processName: overrides.processName || 'driftdwells-test',
      env: overrides.env || { CABIN_NIGHT_CLAIM_MODE: MODES.AUTHORITATIVE },
      exitFn:
        overrides.exitFn ||
        ((code) => {
          exitCode = code;
          events.push(`exit:${code}`);
        }),
      logError: overrides.logError || (() => {}),
      logInfo: overrides.logInfo || (() => {})
    }
  };
  return harness;
}

describe('S1.7.1 API startApiProcess boot gate', () => {
  it('authoritative + exact authority: Mongo → assert → workers → listen', async () => {
    const h = createHarness();
    const run = startApiProcess(h.opts);
    await Promise.resolve();
    assert.equal(h.events.includes('listen'), false);
    assert.equal(h.events.includes('workers_started'), false);
    assert.deepEqual(h.events, ['mongo_connected', 'assert_started']);

    h.resolveAssert({ required: true, ok: true, mode: MODES.AUTHORITATIVE });
    const result = await run;

    assert.equal(result.ok, true);
    assert.equal(result.listened, true);
    assert.equal(result.workersStarted, true);
    assert.equal(h.getExitCode(), null);
    assert.deepEqual(h.events, [
      'mongo_connected',
      'assert_started',
      'assert_resolved',
      'workers_started',
      'checkout_finalization_worker',
      'listen'
    ]);
  });

  it('delayed authority assertion: listen NOT called while promise pending', async () => {
    const h = createHarness();
    const run = startApiProcess(h.opts);

    await new Promise((r) => setTimeout(r, 20));
    assert.equal(h.isAssertStarted(), true);
    assert.equal(h.events.includes('listen'), false);
    assert.equal(h.events.includes('workers_started'), false);
    assert.equal(h.events.includes('checkout_finalization_worker'), false);

    h.resolveAssert({ required: true, ok: true, mode: MODES.AUTHORITATIVE });
    await run;
    assert.equal(h.events.includes('listen'), true);
    const listenIdx = h.events.indexOf('listen');
    const assertIdx = h.events.indexOf('assert_resolved');
    assert.ok(assertIdx >= 0 && listenIdx > assertIdx);
  });

  it('authoritative + missing index: listen never called; exits nonzero', async () => {
    const missing = new Error('CabinNightClaim authoritative boot failed');
    missing.code = 'CABIN_NIGHT_CLAIM_INDEX_MISSING';
    const events = [];
    let exitCode = null;
    const result = await startApiProcess({
      connectDbFn: async () => {
        events.push('mongo_connected');
        return { connection: { host: 'test' } };
      },
      assertAuthorityBootFn: async () => {
        events.push('assert_started');
        throw missing;
      },
      startHttpListenerFn: () => {
        events.push('listen');
        return { close() {} };
      },
      startPostConnectRuntimeFn: () => {
        events.push('workers_started');
        events.push('checkout_finalization_worker');
      },
      env: { CABIN_NIGHT_CLAIM_MODE: MODES.AUTHORITATIVE },
      exitFn: (code) => {
        exitCode = code;
        events.push(`exit:${code}`);
      },
      logError: () => {},
      logInfo: () => {}
    });

    assert.equal(result.ok, false);
    assert.equal(result.listened, false);
    assert.equal(result.workersStarted, false);
    assert.equal(exitCode, 1);
    assert.equal(events.includes('listen'), false);
    assert.equal(events.includes('workers_started'), false);
    assert.equal(events.includes('checkout_finalization_worker'), false);
    assert.ok(events.includes('exit:1'));
  });

  it('authoritative + wrong index: listen never called; exits nonzero', async () => {
    const wrong = new Error('CabinNightClaim authoritative boot failed: wrong index');
    wrong.code = 'CABIN_NIGHT_CLAIM_INDEX_WRONG';
    const h = createHarness({
      assertAuthorityBootFn: async () => {
        throw wrong;
      }
    });

    const result = await startApiProcess(h.opts);
    assert.equal(result.ok, false);
    assert.equal(result.listened, false);
    assert.equal(h.getExitCode(), 1);
    assert.equal(h.events.includes('listen'), false);
    assert.equal(h.events.includes('workers_started'), false);
  });

  it('authority assertion unexpected rejection: listen never called', async () => {
    const h = createHarness({
      assertAuthorityBootFn: async () => {
        throw new Error('unexpected boot failure');
      }
    });

    const result = await startApiProcess(h.opts);
    assert.equal(result.ok, false);
    assert.equal(result.listened, false);
    assert.equal(h.getExitCode(), 1);
    assert.equal(h.events.includes('listen'), false);
  });

  it('authoritative + Mongo unavailable: listen never called; exits nonzero', async () => {
    const h = createHarness({
      connectDbFn: async () => {
        h.events.push('mongo_failed');
        return null;
      }
    });

    const result = await startApiProcess(h.opts);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'mongo_unavailable');
    assert.equal(result.listened, false);
    assert.equal(h.getExitCode(), 1);
    assert.equal(h.events.includes('listen'), false);
    assert.equal(h.events.includes('assert_started'), false);
    assert.equal(h.events.includes('workers_started'), false);
  });

  it('shadow: startup proceeds without authoritative gating', async () => {
    let assertCalls = 0;
    const h = createHarness({
      env: { CABIN_NIGHT_CLAIM_MODE: MODES.SHADOW },
      assertAuthorityBootFn: async () => {
        assertCalls += 1;
        return { required: true, ok: true, mode: MODES.AUTHORITATIVE };
      }
    });

    const result = await startApiProcess(h.opts);
    assert.equal(result.ok, true);
    assert.equal(result.mode, MODES.SHADOW);
    assert.equal(result.listened, true);
    assert.equal(assertCalls, 0);
    assert.deepEqual(h.events, [
      'mongo_connected',
      'workers_started',
      'checkout_finalization_worker',
      'listen'
    ]);
    assert.equal(h.getExitCode(), null);
  });

  it('off: startup proceeds without authoritative gating', async () => {
    let assertCalls = 0;
    const h = createHarness({
      env: { CABIN_NIGHT_CLAIM_MODE: MODES.OFF },
      assertAuthorityBootFn: async () => {
        assertCalls += 1;
        throw new Error('should not run');
      }
    });

    const result = await startApiProcess(h.opts);
    assert.equal(result.ok, true);
    assert.equal(result.mode, MODES.OFF);
    assert.equal(result.listened, true);
    assert.equal(assertCalls, 0);
    assert.equal(h.events.includes('listen'), true);
    assert.equal(h.getExitCode(), null);
  });

  it('shadow with Mongo unavailable: still listens (legacy semantics)', async () => {
    const h = createHarness({
      env: { CABIN_NIGHT_CLAIM_MODE: MODES.SHADOW },
      connectDbFn: async () => null
    });

    const result = await startApiProcess(h.opts);
    assert.equal(result.ok, true);
    assert.equal(result.listened, true);
    assert.equal(result.workersStarted, false);
    assert.equal(h.events.includes('listen'), true);
    assert.equal(h.events.includes('workers_started'), false);
  });

  it('inventory-mutating worker is not started before assertion resolves', async () => {
    const h = createHarness();
    const run = startApiProcess(h.opts);
    await Promise.resolve();
    assert.equal(h.events.includes('checkout_finalization_worker'), false);

    h.resolveAssert({ required: true, ok: true, mode: MODES.AUTHORITATIVE });
    await run;

    const workerIdx = h.events.indexOf('checkout_finalization_worker');
    const assertIdx = h.events.indexOf('assert_resolved');
    const listenIdx = h.events.indexOf('listen');
    assert.ok(workerIdx > assertIdx);
    assert.ok(listenIdx > workerIdx);
  });

  it('assertion failure: inventory-mutating worker never starts', async () => {
    const h = createHarness({
      assertAuthorityBootFn: async () => {
        throw Object.assign(new Error('index missing'), {
          code: 'CABIN_NIGHT_CLAIM_INDEX_MISSING'
        });
      }
    });

    await startApiProcess(h.opts);
    assert.equal(h.events.includes('checkout_finalization_worker'), false);
    assert.equal(h.events.includes('workers_started'), false);
    assert.equal(h.getExitCode(), 1);
  });
});

describe('S1.7.1 static boot-path containment', () => {
  it('startApiProcess never mutates indexes/claims/backfill', () => {
    const src = readRepoSource('bootstrap/startApiProcess.js');
    assert.doesNotMatch(src, /\.createIndex\s*\(/);
    assert.doesNotMatch(src, /\.dropIndex\s*\(/);
    assert.doesNotMatch(src, /\.syncIndexes\s*\(/);
    assert.doesNotMatch(src, /runBackfill|S1Backfill|backfillService/i);
    assert.doesNotMatch(src, /claimCabinNights\(/);
    assert.doesNotMatch(src, /releaseCabinNights\(/);
    assert.doesNotMatch(src, /CabinNightClaim\.(create|insertMany|deleteMany|deleteOne)/);
  });

  it('server.js sequences startApiProcess before listen and workers', () => {
    const src = readRepoSource('server.js');
    assert.match(src, /startApiProcess/);
    assert.match(src, /assertCabinNightClaimAuthoritativeBootReady/);
    assert.match(src, /startPostConnectRuntime/);
    assert.match(src, /startHttpListener/);
    assert.match(src, /INVENTORY-MUTATING/);

    const apiIdx = src.indexOf('startApiProcess({');
    const listenDefIdx = src.indexOf('function startHttpListener');
    const workersDefIdx = src.indexOf('function startPostConnectRuntime');
    assert.ok(apiIdx > 0);
    assert.ok(workersDefIdx > 0 && workersDefIdx < apiIdx);
    assert.ok(listenDefIdx > 0);
  });

  it('server.js does not fire-and-forget the authority assertion', () => {
    const src = readRepoSource('server.js');
    assert.doesNotMatch(src, /void \(async \(\) => \{/);
    assert.doesNotMatch(src, /connectDB\(\)\.then\(/);
  });

  it('standalone finalize worker ordering remains correct', () => {
    const src = readRepoSource('scripts/runCheckoutFinalizationWorker.js');
    const envIdx = src.indexOf('loadServerEnv();');
    const connectIdx = src.indexOf('await mongoose.connect');
    const bootIdx = src.indexOf('assertCabinNightClaimAuthoritativeBootReady({');
    const startIdx = src.indexOf('startCheckoutFinalizationWorkerIfEnabled()');
    assert.ok(envIdx >= 0 && connectIdx > envIdx);
    assert.ok(bootIdx > connectIdx);
    assert.ok(startIdx > bootIdx);
  });

  it('per-acquisition exact-index assertion behavior is unchanged', () => {
    const src = readRepoSource('services/inventory/cabinNightClaimService.js');
    assert.match(src, /assertAuthoritativeCabinNightIndex/);
    assert.match(src, /ACQUISITION_MODES\.AUTHORITATIVE/);
    const claimFn = src.indexOf('async function claimCabinNights');
    const assertIdx = src.indexOf('await assertAuthoritativeCabinNightIndex()', claimFn);
    assert.ok(claimFn >= 0 && assertIdx > claimFn);
  });

  it('CABIN_NIGHT_CLAIM_MODE still defaults to off, not authoritative', () => {
    const src = readRepoSource('services/inventory/cabinNightClaimMode.js');
    assert.match(src, /if \(!value \|\| value === MODES\.OFF\) return MODES\.OFF;/);
    assert.doesNotMatch(
      src,
      /if \(!value\|\| value === MODES\.OFF\) return MODES\.AUTHORITATIVE/
    );
  });
});
