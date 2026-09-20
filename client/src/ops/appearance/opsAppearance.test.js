import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_OPS_APPEARANCE_MODE,
  OPS_APPEARANCE_STORAGE_KEY,
  applyOpsAppearanceToRoot,
  getOpsRootDomProps,
  initOpsAppearanceBootstrap,
  isOpsPathname,
  parseStoredOpsAppearanceMode,
  readOpsAppearanceMode,
  resolveOpsAppearance,
  writeOpsAppearanceMode
} from './opsAppearance.js';

function memoryStorage(initial = {}) {
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

function matchMediaFn(matches) {
  return () => ({ matches });
}

describe('ops appearance resolver', () => {
  it('parses stored modes and falls back to system for invalid values', () => {
    expect(parseStoredOpsAppearanceMode('system')).toBe('system');
    expect(parseStoredOpsAppearanceMode('light')).toBe('light');
    expect(parseStoredOpsAppearanceMode('dark')).toBe('dark');
    expect(parseStoredOpsAppearanceMode(null)).toBe('system');
    expect(parseStoredOpsAppearanceMode('')).toBe('system');
    expect(parseStoredOpsAppearanceMode('auto')).toBe('system');
    expect(parseStoredOpsAppearanceMode('LIGHT')).toBe('system');
    expect(parseStoredOpsAppearanceMode('foo')).toBe('system');
  });

  it('reads missing storage as system', () => {
    expect(readOpsAppearanceMode(memoryStorage())).toBe(DEFAULT_OPS_APPEARANCE_MODE);
  });

  it('reads persisted light and dark', () => {
    expect(readOpsAppearanceMode(memoryStorage({ [OPS_APPEARANCE_STORAGE_KEY]: 'light' }))).toBe('light');
    expect(readOpsAppearanceMode(memoryStorage({ [OPS_APPEARANCE_STORAGE_KEY]: 'dark' }))).toBe('dark');
  });

  it('treats invalid stored values as system', () => {
    expect(readOpsAppearanceMode(memoryStorage({ [OPS_APPEARANCE_STORAGE_KEY]: 'nope' }))).toBe('system');
  });

  it('resolves system + light preference to light', () => {
    expect(resolveOpsAppearance('system', false)).toBe('light');
  });

  it('resolves system + dark preference to dark', () => {
    expect(resolveOpsAppearance('system', true)).toBe('dark');
  });

  it('explicit light overrides a dark system preference', () => {
    expect(resolveOpsAppearance('light', true)).toBe('light');
  });

  it('explicit dark overrides a light system preference', () => {
    expect(resolveOpsAppearance('dark', false)).toBe('dark');
  });

  it('persists explicit mode per device storage', () => {
    const storage = memoryStorage();
    writeOpsAppearanceMode('dark', storage);
    expect(storage.getItem(OPS_APPEARANCE_STORAGE_KEY)).toBe('dark');
    expect(readOpsAppearanceMode(storage)).toBe('dark');
  });
});

describe('ops appearance bootstrap path gating', () => {
  it('recognizes /ops and nested ops paths only', () => {
    expect(isOpsPathname('/ops')).toBe(true);
    expect(isOpsPathname('/ops/')).toBe(true);
    expect(isOpsPathname('/ops/reservations')).toBe(true);
    expect(isOpsPathname('/')).toBe(false);
    expect(isOpsPathname('/login')).toBe(false);
    expect(isOpsPathname('/ops-unknown')).toBe(false);
    expect(isOpsPathname('/bg')).toBe(false);
  });

  it('does not apply attributes on public routes', () => {
    const root = document.createElement('html');
    const result = initOpsAppearanceBootstrap({
      pathname: '/',
      storage: memoryStorage({ [OPS_APPEARANCE_STORAGE_KEY]: 'dark' }),
      matchMedia: matchMediaFn(true),
      root
    });
    expect(result).toEqual({ applied: false, mode: null, appearance: null });
    expect(root.getAttribute('data-ops-active')).toBeNull();
    expect(root.getAttribute('data-ops-appearance')).toBeNull();
    expect(root.classList.contains('dark')).toBe(false);
  });

  it('applies resolved appearance on /ops from storage + system', () => {
    const root = document.createElement('html');
    const result = initOpsAppearanceBootstrap({
      pathname: '/ops',
      storage: memoryStorage(),
      matchMedia: matchMediaFn(true),
      root
    });
    expect(result).toEqual({ applied: true, mode: 'system', appearance: 'dark' });
    expect(root.getAttribute('data-ops-active')).toBe('true');
    expect(root.getAttribute('data-ops-appearance-mode')).toBe('system');
    expect(root.getAttribute('data-ops-appearance')).toBe('dark');
    expect(root.className).not.toMatch(/\bdark\b/);
    expect(root.style.colorScheme).toBe('');
  });

  it('applies explicit light on nested ops paths even when system is dark', () => {
    const root = document.createElement('html');
    initOpsAppearanceBootstrap({
      pathname: '/ops/calendar',
      storage: memoryStorage({ [OPS_APPEARANCE_STORAGE_KEY]: 'light' }),
      matchMedia: matchMediaFn(true),
      root
    });
    expect(root.getAttribute('data-ops-appearance-mode')).toBe('light');
    expect(root.getAttribute('data-ops-appearance')).toBe('light');
  });

  it('can clear html attributes when leaving ops', () => {
    const root = document.createElement('html');
    applyOpsAppearanceToRoot(root, { active: true, mode: 'dark', appearance: 'dark' });
    applyOpsAppearanceToRoot(root, { active: false });
    expect(root.getAttribute('data-ops-active')).toBeNull();
    expect(root.getAttribute('data-ops-appearance')).toBeNull();
    expect(root.getAttribute('data-ops-appearance-mode')).toBeNull();
  });

  it('exposes ops-root props without themed/color-scheme opt-in by default', () => {
    expect(getOpsRootDomProps({ appearance: 'dark', mode: 'system' })).toEqual({
      className: 'ops-root',
      'data-ops-appearance': 'dark',
      'data-ops-appearance-mode': 'system'
    });
    expect(getOpsRootDomProps({ appearance: 'light', mode: 'light', themed: true })['data-ops-themed']).toBe(
      'true'
    );
  });
});

describe('localStorage integration', () => {
  beforeEach(() => {
    localStorage.removeItem(OPS_APPEARANCE_STORAGE_KEY);
  });

  afterEach(() => {
    localStorage.removeItem(OPS_APPEARANCE_STORAGE_KEY);
  });

  it('uses dd_ops_appearance as the per-device key', () => {
    writeOpsAppearanceMode('light');
    expect(localStorage.getItem('dd_ops_appearance')).toBe('light');
    expect(readOpsAppearanceMode()).toBe('light');
  });
});
