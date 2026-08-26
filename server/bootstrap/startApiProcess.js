'use strict';

/**
 * S1.7.1 API process startup sequencer.
 * Binding: docs/stay-change-implementation-plan.md — §24.44.4 / §24.44.24
 *
 * Authoritative mode:
 *   await Mongo → await exact CabinNightClaim authority assertion →
 *   ONLY THEN start post-connect runtime (incl. inventory-mutating workers) →
 *   ONLY THEN begin HTTP listen.
 *
 * Shadow/off: no exact-index startup requirement; preserve existing
 * "listen even if Mongo unavailable" semantics.
 *
 * Never create/drop/sync indexes, backfill, or mutate claims here.
 */

const {
  getCabinNightClaimMode,
  MODES
} = require('../services/inventory/cabinNightClaimMode');

/**
 * @param {object} opts
 * @param {() => Promise<unknown>} opts.connectDbFn
 * @param {(args: object) => Promise<object>} opts.assertAuthorityBootFn
 * @param {() => unknown} opts.startHttpListenerFn
 * @param {(ctx?: object) => unknown|Promise<unknown>} opts.startPostConnectRuntimeFn
 * @param {string} [opts.processName]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {(code: number) => void} [opts.exitFn]
 * @param {(...args: unknown[]) => void} [opts.logError]
 * @param {(...args: unknown[]) => void} [opts.logInfo]
 */
async function startApiProcess({
  connectDbFn,
  assertAuthorityBootFn,
  startHttpListenerFn,
  startPostConnectRuntimeFn,
  processName = 'driftdwells',
  env = process.env,
  exitFn = (code) => process.exit(code),
  logError = (...args) => console.error(...args),
  logInfo = (...args) => console.log(...args)
} = {}) {
  if (typeof connectDbFn !== 'function') {
    throw new Error('connectDbFn is required');
  }
  if (typeof assertAuthorityBootFn !== 'function') {
    throw new Error('assertAuthorityBootFn is required');
  }
  if (typeof startHttpListenerFn !== 'function') {
    throw new Error('startHttpListenerFn is required');
  }
  if (typeof startPostConnectRuntimeFn !== 'function') {
    throw new Error('startPostConnectRuntimeFn is required');
  }

  const mode = getCabinNightClaimMode(null, env);
  const conn = await connectDbFn();

  if (mode === MODES.AUTHORITATIVE) {
    if (!conn) {
      logError(
        `[cabin-night-claim] authoritative boot assertion failed (${processName}):`,
        'MongoDB connection required before CabinNightClaim authority assertion'
      );
      exitFn(1);
      return {
        ok: false,
        listened: false,
        workersStarted: false,
        mode,
        reason: 'mongo_unavailable'
      };
    }

    try {
      const boot = await assertAuthorityBootFn({
        processName,
        env
      });
      if (boot && boot.required) {
        logInfo(`[cabin-night-claim] authoritative boot assertion passed (${processName})`);
      }
    } catch (err) {
      logError(
        `[cabin-night-claim] authoritative boot assertion failed (${processName}):`,
        err?.message || err
      );
      exitFn(1);
      return {
        ok: false,
        listened: false,
        workersStarted: false,
        mode,
        reason: 'authority_boot_failed',
        error: err
      };
    }

    // Inventory-capable runtime and HTTP listen only after the gate passes.
    await Promise.resolve(startPostConnectRuntimeFn({ conn, mode }));
    const server = startHttpListenerFn();
    return {
      ok: true,
      listened: true,
      workersStarted: true,
      mode,
      mongoConnected: true,
      server
    };
  }

  // shadow / off — no authoritative index gate; keep prior Mongo-optional listen.
  let workersStarted = false;
  if (conn) {
    await Promise.resolve(startPostConnectRuntimeFn({ conn, mode }));
    workersStarted = true;
  }
  const server = startHttpListenerFn();
  return {
    ok: true,
    listened: true,
    workersStarted,
    mode,
    mongoConnected: Boolean(conn),
    server
  };
}

module.exports = {
  startApiProcess
};
