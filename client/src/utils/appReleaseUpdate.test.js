import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHUNK_RECOVERY_KEY,
  PAYMENT_FLOW_KEY,
  SW_UPDATE_PENDING_KEY,
  activatePendingServiceWorkerUpdate,
  attemptChunkLoadRecovery,
  checkDeferredServiceWorkerUpdate,
  handleServiceWorkerNeedRefresh,
  isDynamicImportChunkError,
  isPaymentFlowActive,
  registerAppServiceWorker,
  resetAppReleaseUpdateState,
  setPendingServiceWorkerUpdate
} from './appReleaseUpdate.js';

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    }
  };
}

afterEach(() => {
  resetAppReleaseUpdateState();
});

describe('appReleaseUpdate', () => {
  it('detects dynamic import / chunk load failures', () => {
    expect(
      isDynamicImportChunkError(
        new TypeError('Failed to fetch dynamically imported module: https://example.com/assets/Ops-abc.js')
      )
    ).toBe(true);
    expect(isDynamicImportChunkError(new Error('Cannot read properties of undefined'))).toBe(false);
  });

  it('activates waiting SW immediately when payment is not active', async () => {
    const storage = makeStorage();
    const updateSW = vi.fn().mockResolvedValue(undefined);

    const result = handleServiceWorkerNeedRefresh(updateSW, { storage });

    expect(result.activated).toBe(true);
    expect(updateSW).toHaveBeenCalledWith(true);
    expect(storage.getItem(SW_UPDATE_PENDING_KEY)).toBeNull();
  });

  it('defers SW activation while checkout/payment is active', async () => {
    const storage = makeStorage({ [PAYMENT_FLOW_KEY]: '1' });
    const updateSW = vi.fn().mockResolvedValue(undefined);

    const result = handleServiceWorkerNeedRefresh(updateSW, { storage });

    expect(result.deferred).toBe(true);
    expect(updateSW).not.toHaveBeenCalled();
    expect(storage.getItem(SW_UPDATE_PENDING_KEY)).toBe('1');
  });

  it('activates deferred SW once payment ends', async () => {
    const storage = makeStorage({ [SW_UPDATE_PENDING_KEY]: '1' });
    const updateSW = vi.fn().mockResolvedValue(undefined);
    setPendingServiceWorkerUpdate(updateSW);

    const result = checkDeferredServiceWorkerUpdate({ storage });

    expect(result.activated).toBe(true);
    expect(updateSW).toHaveBeenCalledWith(true);
    expect(storage.getItem(SW_UPDATE_PENDING_KEY)).toBeNull();
  });

  it('registerAppServiceWorker wires onNeedRefresh to activation (no dead custom event)', () => {
    const storage = makeStorage();
    let captured = null;
    const registerSW = vi.fn((options) => {
      captured = options;
      return vi.fn().mockResolvedValue(undefined);
    });
    const windowRef = {
      __ddUpdateSW: undefined,
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn()
    };
    const documentRef = {
      addEventListener: vi.fn(),
      visibilityState: 'visible'
    };

    registerAppServiceWorker(registerSW, { windowRef, documentRef });

    expect(typeof captured.onNeedRefresh).toBe('function');
    expect(typeof captured.onOfflineReady).toBe('function');

    const updateSW = registerSW.mock.results[0].value;
    captured.onNeedRefresh();
    expect(updateSW).toHaveBeenCalledWith(true);
  });

  it('attemptChunkLoadRecovery performs at most one cache-busted reload', () => {
    const storage = makeStorage();
    const reload = vi.fn();

    const first = attemptChunkLoadRecovery({
      storage,
      reload,
      locationHref: 'https://driftdwells.com/ops/reservations/abc',
      now: 123
    });
    const second = attemptChunkLoadRecovery({ storage, reload, locationHref: 'https://driftdwells.com/ops' });

    expect(first.recovered).toBe(true);
    expect(first.method).toBe('cache_bust_reload');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reload.mock.calls[0][0]).toContain('__dd_recover=123');
    expect(second.recovered).toBe(false);
    expect(second.reason).toBe('already_attempted');
    expect(storage.getItem(CHUNK_RECOVERY_KEY)).toBe('1');
  });

  it('prefers SW activation during chunk recovery when an update is pending', () => {
    const storage = makeStorage({ [SW_UPDATE_PENDING_KEY]: '1' });
    const updateSW = vi.fn().mockResolvedValue(undefined);
    setPendingServiceWorkerUpdate(updateSW);
    const reload = vi.fn();

    const result = attemptChunkLoadRecovery({ storage, reload });

    expect(result.recovered).toBe(true);
    expect(result.method).toBe('sw_update');
    expect(updateSW).toHaveBeenCalledWith(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not treat payment-active as chunk recovery trigger by itself', () => {
    const storage = makeStorage({ [PAYMENT_FLOW_KEY]: '1' });
    expect(isPaymentFlowActive(storage)).toBe(true);
    expect(isDynamicImportChunkError(new Error('boom'))).toBe(false);
  });

  it('activatePendingServiceWorkerUpdate returns no_update when callback missing', () => {
    expect(activatePendingServiceWorkerUpdate(null).reason).toBe('no_update');
  });

  it('main.jsx no longer dispatches the dead dd:sw-update-available event', () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const mainSource = fs.readFileSync(path.join(testDir, '../main.jsx'), 'utf8');
    expect(mainSource).not.toContain('dd:sw-update-available');
    expect(mainSource).toContain('registerAppServiceWorker');
  });
});
