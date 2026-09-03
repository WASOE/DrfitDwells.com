'use strict';

/**
 * S1.7.1 API process startup sequencer.
 * Binding: docs/stay-change-implementation-plan.md — §24.44.4 / §24.44.24
 *
 * Authoritative mode:
 *   await Mongo → await exact CabinNightClaim authority assertion →
 *   await CreatorPartner ownedCodes unique-index readiness (when connected) →
 *   ONLY THEN start post-connect runtime (incl. inventory-mutating workers) →
 *   ONLY THEN begin HTTP listen.
 *
 * Shadow/off: no CabinNightClaim exact-index startup requirement; preserve existing
 * "listen even if Mongo unavailable" semantics. When Mongo IS connected, the
 * CreatorPartner ownedCodes unique-index gate still fails closed before listen.
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
 * @param {(args: object) => Promise<object>} [opts.assertOwnedCodesIndexBootFn]
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
  assertOwnedCodesIndexBootFn = null,
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

  async function assertOwnedCodesReadyOrExit() {
    if (!conn) return { ok: true, skipped: true, reason: 'mongo_unavailable' };
    if (typeof assertOwnedCodesIndexBootFn !== 'function') {
      // Injectable for unit harnesses; production server.js always supplies the real gate.
      return { ok: true, skipped: true, reason: 'assert_fn_not_provided' };
    }
    try {
      const boot = await assertOwnedCodesIndexBootFn({ processName, env });
      logInfo(`[creator-partner] ownedCodes unique-index boot assertion passed (${processName})`);
      return { ok: true, skipped: false, boot };
    } catch (err) {
      logError(
        `[creator-partner] ownedCodes unique-index boot assertion failed (${processName}):`,
        err?.message || err
      );
      exitFn(1);
      return {
        ok: false,
        skipped: false,
        reason: 'owned_codes_index_boot_failed',
        error: err
      };
    }
  }

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

    const ownedCodesBoot = await assertOwnedCodesReadyOrExit();
    if (!ownedCodesBoot.ok) {
      return {
        ok: false,
        listened: false,
        workersStarted: false,
        mode,
        reason: ownedCodesBoot.reason,
        error: ownedCodesBoot.error
      };
    }

    // Inventory-capable runtime and HTTP listen only after the gates pass.
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

  // shadow / off — no CabinNightClaim authoritative index gate; keep prior Mongo-optional listen.
  // When Mongo IS connected, ownedCodes unique-index readiness still fails closed before listen.
  const ownedCodesBoot = await assertOwnedCodesReadyOrExit();
  if (!ownedCodesBoot.ok) {
    return {
      ok: false,
      listened: false,
      workersStarted: false,
      mode,
      reason: ownedCodesBoot.reason,
      error: ownedCodesBoot.error,
      mongoConnected: Boolean(conn)
    };
  }

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
