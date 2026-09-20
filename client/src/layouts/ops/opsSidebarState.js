import { useCallback, useEffect, useState } from 'react';

/**
 * Desktop sidebar expanded/collapsed preference.
 * Persisted locally as `expanded` | `collapsed`. Breakpoint defaults apply when unset.
 */

export const OPS_SIDEBAR_STORAGE_KEY = 'dd_ops_sidebar';
export const OPS_SIDEBAR_EXPANDED = 'expanded';
export const OPS_SIDEBAR_COLLAPSED = 'collapsed';

/** Locked --ops-bp-md. Desktop shell starts here. */
export const OPS_SIDEBAR_DESKTOP_MIN = 768;
/** Locked --ops-bp-lg. Expanded default starts here. */
export const OPS_SIDEBAR_LG = 1024;

/**
 * @param {unknown} value
 * @returns {'expanded' | 'collapsed' | null}
 */
export function parseOpsSidebarPreference(value) {
  if (value === OPS_SIDEBAR_EXPANDED || value === OPS_SIDEBAR_COLLAPSED) {
    return value;
  }
  return null;
}

/**
 * @param {Pick<Storage, 'getItem'>} [storage]
 * @returns {'expanded' | 'collapsed' | null}
 */
export function readOpsSidebarPreference(storage = defaultStorage()) {
  if (!storage) return null;
  try {
    return parseOpsSidebarPreference(storage.getItem(OPS_SIDEBAR_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * @param {'expanded' | 'collapsed'} value
 * @param {Pick<Storage, 'setItem'>} [storage]
 */
export function writeOpsSidebarPreference(value, storage = defaultStorage()) {
  const parsed = parseOpsSidebarPreference(value);
  if (!parsed || !storage) return;
  try {
    storage.setItem(OPS_SIDEBAR_STORAGE_KEY, parsed);
  } catch {
    // Quota / private mode: keep the in-memory choice only.
  }
}

/**
 * @param {number} viewportWidth
 * @returns {'expanded' | 'collapsed'}
 */
export function getDefaultOpsSidebarMode(viewportWidth) {
  return viewportWidth >= OPS_SIDEBAR_LG ? OPS_SIDEBAR_EXPANDED : OPS_SIDEBAR_COLLAPSED;
}

/**
 * Stored choice always wins at desktop widths. Invalid/missing storage follows the breakpoint.
 * @param {number} viewportWidth
 * @param {unknown} storedPreference
 * @returns {'expanded' | 'collapsed'}
 */
export function resolveOpsSidebarMode(viewportWidth, storedPreference) {
  const stored = parseOpsSidebarPreference(storedPreference);
  if (stored) return stored;
  return getDefaultOpsSidebarMode(viewportWidth);
}

export function isOpsDesktopViewport(viewportWidth) {
  return viewportWidth >= OPS_SIDEBAR_DESKTOP_MIN;
}

function defaultStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function getViewportWidth() {
  if (typeof window === 'undefined') return OPS_SIDEBAR_LG;
  return window.innerWidth;
}

/**
 * Live desktop sidebar mode. Reading storage does not write. Only persistMode writes.
 */
export function useOpsSidebarMode() {
  const [viewportWidth, setViewportWidth] = useState(getViewportWidth);
  const [storedPreference, setStoredPreference] = useState(readOpsSidebarPreference);

  useEffect(() => {
    function onResize() {
      setViewportWidth(getViewportWidth());
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const persistMode = useCallback((nextMode) => {
    const parsed = parseOpsSidebarPreference(nextMode);
    if (!parsed) return;
    writeOpsSidebarPreference(parsed);
    setStoredPreference(parsed);
  }, []);

  return {
    mode: resolveOpsSidebarMode(viewportWidth, storedPreference),
    isDesktop: isOpsDesktopViewport(viewportWidth),
    viewportWidth,
    storedPreference,
    persistMode
  };
}
