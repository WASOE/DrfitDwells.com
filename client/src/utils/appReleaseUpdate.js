/**
 * Centralized PWA / release update handling.
 * Ensures waiting service workers activate and provides last-resort chunk recovery.
 */

export const PAYMENT_FLOW_KEY = 'dd_payment_flow_active';
export const SW_UPDATE_PENDING_KEY = 'dd_sw_update_pending';
export const CHUNK_RECOVERY_KEY = 'dd_chunk_recovery_attempted';

/** @type {((reload?: boolean) => Promise<void>) | null} */
let pendingUpdateSW = null;
/** @type {ReturnType<typeof setInterval> | null} */
let deferredWatcherId = null;

export function isPaymentFlowActive(storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null) {
  return Boolean(storage && storage.getItem(PAYMENT_FLOW_KEY) === '1');
}

export function isDynamicImportChunkError(error) {
  if (!error) return false;
  const msg = String(error.message || error);
  const name = String(error.name || '');
  return (
    name === 'ChunkLoadError' ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /Loading chunk [\d]+ failed/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg)
  );
}

/**
 * @param {(reload?: boolean) => Promise<void>} updateSW
 */
export function setPendingServiceWorkerUpdate(updateSW) {
  pendingUpdateSW = updateSW;
}

export function getPendingServiceWorkerUpdate() {
  return pendingUpdateSW;
}

/**
 * Activate a waiting service worker. When `reload` is true, vite-plugin-pwa reloads
 * the page after skipWaiting completes.
 *
 * @param {(reload?: boolean) => Promise<void>} [updateSW]
 * @param {{ reload?: boolean, storage?: Storage | null }} [options]
 */
export function activatePendingServiceWorkerUpdate(updateSW = pendingUpdateSW, options = {}) {
  const { reload = true, storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null } = options;
  if (!updateSW) {
    return { activated: false, reason: 'no_update' };
  }

  storage?.removeItem(SW_UPDATE_PENDING_KEY);

  try {
    void updateSW(reload);
    return { activated: true, reloading: reload };
  } catch (error) {
    return { activated: false, reason: 'update_failed', error };
  }
}

/**
 * Called from registerSW onNeedRefresh.
 *
 * @param {(reload?: boolean) => Promise<void>} updateSW
 * @param {{ storage?: Storage | null }} [options]
 */
export function handleServiceWorkerNeedRefresh(updateSW, options = {}) {
  const storage = options.storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
  setPendingServiceWorkerUpdate(updateSW);

  if (isPaymentFlowActive(storage)) {
    storage?.setItem(SW_UPDATE_PENDING_KEY, '1');
    return { activated: false, deferred: true, reason: 'payment_active' };
  }

  return activatePendingServiceWorkerUpdate(updateSW, { reload: true, storage });
}

/**
 * When a deferred update was blocked by payment, activate once payment ends.
 *
 * @param {{ storage?: Storage | null }} [options]
 */
export function checkDeferredServiceWorkerUpdate(options = {}) {
  const storage = options.storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
  if (!storage || storage.getItem(SW_UPDATE_PENDING_KEY) !== '1') {
    return { activated: false, reason: 'not_pending' };
  }
  if (isPaymentFlowActive(storage)) {
    return { activated: false, reason: 'payment_active' };
  }
  return activatePendingServiceWorkerUpdate(pendingUpdateSW, { reload: true, storage });
}

/**
 * Last-resort recovery for stale lazy-chunk load failures.
 *
 * @param {{
 *   storage?: Storage | null,
 *   reload?: (url: string) => void,
 *   locationHref?: string,
 *   now?: number,
 * }} [options]
 */
export function attemptChunkLoadRecovery(options = {}) {
  const storage = options.storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
  const reload = options.reload ?? ((url) => {
    window.location.replace(url);
  });
  const locationHref = options.locationHref ?? (typeof window !== 'undefined' ? window.location.href : '/');
  const now = options.now ?? Date.now();

  if (storage?.getItem(CHUNK_RECOVERY_KEY) === '1') {
    return { recovered: false, reason: 'already_attempted' };
  }

  storage?.setItem(CHUNK_RECOVERY_KEY, '1');

  if (pendingUpdateSW || storage?.getItem(SW_UPDATE_PENDING_KEY) === '1') {
    const swResult = activatePendingServiceWorkerUpdate(pendingUpdateSW, { reload: true, storage });
    if (swResult.activated) {
      return { recovered: true, method: 'sw_update' };
    }
  }

  const url = new URL(locationHref);
  url.searchParams.set('__dd_recover', String(now));
  reload(url.toString());
  return { recovered: true, method: 'cache_bust_reload' };
}

/**
 * Register the application service worker with a single authoritative update path.
 *
 * @param {typeof import('virtual:pwa-register').registerSW} registerSW
 * @param {{ windowRef?: Window & typeof globalThis, documentRef?: Document }} [options]
 */
export function registerAppServiceWorker(registerSW, options = {}) {
  const windowRef = options.windowRef ?? (typeof window !== 'undefined' ? window : undefined);
  const documentRef = options.documentRef ?? (typeof document !== 'undefined' ? document : undefined);

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      handleServiceWorkerNeedRefresh(updateSW);
    },
    onOfflineReady() {
      // PWA is ready for offline use; no forced reload required.
    }
  });

  setPendingServiceWorkerUpdate(updateSW);

  if (windowRef) {
    windowRef.__ddUpdateSW = updateSW;
    startDeferredUpdateWatcher(windowRef, documentRef);
  }

  return updateSW;
}

/**
 * @param {Window & typeof globalThis} windowRef
 * @param {Document | undefined} documentRef
 */
export function startDeferredUpdateWatcher(windowRef, documentRef) {
  if (deferredWatcherId != null) {
    clearInterval(deferredWatcherId);
  }

  const tick = () => {
    checkDeferredServiceWorkerUpdate();
  };

  documentRef?.addEventListener('visibilitychange', () => {
    if (documentRef.visibilityState === 'visible') {
      tick();
    }
  });

  deferredWatcherId = windowRef.setInterval(() => {
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SW_UPDATE_PENDING_KEY) === '1') {
      tick();
    }
  }, 5000);
}

/** Test helper */
export function resetAppReleaseUpdateState() {
  pendingUpdateSW = null;
  if (deferredWatcherId != null && typeof clearInterval !== 'undefined') {
    clearInterval(deferredWatcherId);
    deferredWatcherId = null;
  }
}
