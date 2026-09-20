import { afterEach, describe, expect, it } from 'vitest';
import {
  OPS_SIDEBAR_COLLAPSED,
  OPS_SIDEBAR_DESKTOP_MIN,
  OPS_SIDEBAR_EXPANDED,
  OPS_SIDEBAR_LG,
  OPS_SIDEBAR_STORAGE_KEY,
  getDefaultOpsSidebarMode,
  parseOpsSidebarPreference,
  readOpsSidebarPreference,
  resolveOpsSidebarMode,
  writeOpsSidebarPreference
} from './opsSidebarState';

afterEach(() => {
  localStorage.removeItem(OPS_SIDEBAR_STORAGE_KEY);
});

describe('opsSidebarState', () => {
  it('defaults to collapsed at 800px and expanded at 1200px when nothing is stored', () => {
    expect(getDefaultOpsSidebarMode(800)).toBe(OPS_SIDEBAR_COLLAPSED);
    expect(resolveOpsSidebarMode(800, null)).toBe(OPS_SIDEBAR_COLLAPSED);
    expect(getDefaultOpsSidebarMode(1200)).toBe(OPS_SIDEBAR_EXPANDED);
    expect(resolveOpsSidebarMode(1200, null)).toBe(OPS_SIDEBAR_EXPANDED);
    expect(OPS_SIDEBAR_DESKTOP_MIN).toBe(768);
    expect(OPS_SIDEBAR_LG).toBe(1024);
  });

  it('lets a stored collapsed preference win at 1200px', () => {
    expect(resolveOpsSidebarMode(1200, OPS_SIDEBAR_COLLAPSED)).toBe(OPS_SIDEBAR_COLLAPSED);
  });

  it('lets a stored expanded preference win at 800px', () => {
    expect(resolveOpsSidebarMode(800, OPS_SIDEBAR_EXPANDED)).toBe(OPS_SIDEBAR_EXPANDED);
  });

  it('treats invalid storage as a missing preference', () => {
    expect(parseOpsSidebarPreference('wide')).toBe(null);
    expect(parseOpsSidebarPreference('')).toBe(null);
    expect(parseOpsSidebarPreference(undefined)).toBe(null);
    localStorage.setItem(OPS_SIDEBAR_STORAGE_KEY, 'banana');
    expect(readOpsSidebarPreference()).toBe(null);
    expect(resolveOpsSidebarMode(800, readOpsSidebarPreference())).toBe(OPS_SIDEBAR_COLLAPSED);
    expect(resolveOpsSidebarMode(1200, readOpsSidebarPreference())).toBe(OPS_SIDEBAR_EXPANDED);
  });

  it('keeps an explicit preference when crossing 1024', () => {
    expect(resolveOpsSidebarMode(800, OPS_SIDEBAR_COLLAPSED)).toBe(OPS_SIDEBAR_COLLAPSED);
    expect(resolveOpsSidebarMode(1024, OPS_SIDEBAR_COLLAPSED)).toBe(OPS_SIDEBAR_COLLAPSED);
    expect(resolveOpsSidebarMode(1400, OPS_SIDEBAR_COLLAPSED)).toBe(OPS_SIDEBAR_COLLAPSED);
    expect(resolveOpsSidebarMode(1400, OPS_SIDEBAR_EXPANDED)).toBe(OPS_SIDEBAR_EXPANDED);
    expect(resolveOpsSidebarMode(800, OPS_SIDEBAR_EXPANDED)).toBe(OPS_SIDEBAR_EXPANDED);
  });

  it('follows breakpoint defaults when no preference exists', () => {
    expect(resolveOpsSidebarMode(767, null)).toBe(OPS_SIDEBAR_COLLAPSED);
    expect(resolveOpsSidebarMode(768, null)).toBe(OPS_SIDEBAR_COLLAPSED);
    expect(resolveOpsSidebarMode(1023, null)).toBe(OPS_SIDEBAR_COLLAPSED);
    expect(resolveOpsSidebarMode(1024, null)).toBe(OPS_SIDEBAR_EXPANDED);
  });

  it('does not erase a stored preference below 768', () => {
    writeOpsSidebarPreference(OPS_SIDEBAR_EXPANDED);
    expect(readOpsSidebarPreference()).toBe(OPS_SIDEBAR_EXPANDED);
    expect(resolveOpsSidebarMode(375, readOpsSidebarPreference())).toBe(OPS_SIDEBAR_EXPANDED);
    expect(localStorage.getItem(OPS_SIDEBAR_STORAGE_KEY)).toBe(OPS_SIDEBAR_EXPANDED);
  });
});
