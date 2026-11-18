'use strict';

/**
 * Periodic cleanup for expired location-checkout holds.
 *
 * Location checkout holds are AvailabilityBlock rows with blockType
 * 'checkout_hold' and a 30 minute expiresAt. The public availability read model
 * already ignores expired rows, but Ops read models and the calendar need the
 * rows tombstoned so they stop rendering and stop accumulating.
 *
 * Safe by construction: the sweep only touches active checkout_hold rows whose
 * expiresAt is in the past. Bookings, paid stays and live holds are untouched.
 *
 * Enabled by default. Set CHECKOUT_HOLD_SWEEP_ENABLED=0 to disable.
 */

const { sweepExpiredCheckoutHolds } = require('./locationCheckoutHoldService');

const DEFAULT_TICK_MS = 60 * 1000;
const MAX_BATCH = 1000;

const state = {
  timer: null,
  running: false,
  tickMs: DEFAULT_TICK_MS,
  lastRunAt: null,
  lastTombstoned: 0,
  lastError: null
};

function isEnabled(env = process.env) {
  return String(env.CHECKOUT_HOLD_SWEEP_ENABLED ?? '1').trim() !== '0';
}

function resolveTickMs(env = process.env) {
  const parsed = Number.parseInt(env.CHECKOUT_HOLD_SWEEP_TICK_MS, 10);
  if (!Number.isFinite(parsed) || parsed < 5000) return DEFAULT_TICK_MS;
  return Math.min(parsed, 60 * 60 * 1000);
}

async function runCheckoutHoldSweepOnce({ now = new Date(), limit = MAX_BATCH } = {}) {
  if (state.running) return { skipped: true, reason: 'already_running' };
  state.running = true;
  try {
    const result = await sweepExpiredCheckoutHolds({ now, limit });
    state.lastRunAt = new Date();
    state.lastTombstoned = result.tombstoned;
    state.lastError = null;
    return result;
  } catch (error) {
    state.lastError = error?.message || String(error);
    throw error;
  } finally {
    state.running = false;
  }
}

function startCheckoutHoldSweeperIfEnabled(env = process.env) {
  if (!isEnabled(env)) {
    return { started: false, reason: 'CHECKOUT_HOLD_SWEEP_ENABLED_disabled' };
  }
  if (state.timer) {
    return { started: true, alreadyRunning: true };
  }

  state.tickMs = resolveTickMs(env);
  state.timer = setInterval(() => {
    void runCheckoutHoldSweepOnce().catch((error) => {
      console.error('[checkout-hold-sweeper] sweep failed:', error?.message || error);
    });
  }, state.tickMs);
  if (typeof state.timer.unref === 'function') state.timer.unref();

  // Run immediately so a restart clears any backlog without waiting a tick.
  void runCheckoutHoldSweepOnce().catch((error) => {
    console.error('[checkout-hold-sweeper] initial sweep failed:', error?.message || error);
  });

  console.log(`[checkout-hold-sweeper] started tickMs=${state.tickMs}`);
  return { started: true };
}

function stopCheckoutHoldSweeperForTest() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  state.running = false;
}

function checkoutHoldSweeperState() {
  return { ...state };
}

module.exports = {
  isEnabled,
  resolveTickMs,
  runCheckoutHoldSweepOnce,
  startCheckoutHoldSweeperIfEnabled,
  stopCheckoutHoldSweeperForTest,
  checkoutHoldSweeperState
};
