import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acquireOpsScrollLock,
  getOpsScrollLockCount,
  releaseOpsScrollLock,
  resetOpsOverlayRuntime
} from './opsOverlay';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

afterEach(() => {
  resetOpsOverlayRuntime();
});

describe('ops overlay scroll lock', () => {
  it('reference-counts locks and restores the previous overflow value', () => {
    document.body.style.overflow = 'scroll';
    acquireOpsScrollLock();
    expect(getOpsScrollLockCount()).toBe(1);
    expect(document.body.style.overflow).toBe('hidden');
    acquireOpsScrollLock();
    expect(getOpsScrollLockCount()).toBe(2);
    expect(document.body.style.overflow).toBe('hidden');
    releaseOpsScrollLock();
    expect(getOpsScrollLockCount()).toBe(1);
    expect(document.body.style.overflow).toBe('hidden');
    releaseOpsScrollLock();
    expect(getOpsScrollLockCount()).toBe(0);
    expect(document.body.style.overflow).toBe('scroll');
  });
});

describe('ops overlay appearance and motion source', () => {
  it('uses semantic overlay classes and reduced-motion handling', () => {
    const css = fs.readFileSync(path.join(__dirname, 'opsPrimitives.css'), 'utf8');
    const overlayCss = css.slice(css.indexOf('.ops-overlay-host'));
    expect(overlayCss).toContain('var(--ops-scrim)');
    expect(overlayCss).toContain('var(--ops-surface)');
    expect(overlayCss).toContain('var(--ops-border)');
    expect(overlayCss).toContain('var(--ops-text)');
    expect(overlayCss).toContain('var(--ops-shadow-modal)');
    expect(overlayCss).toContain('var(--ops-z-overlay)');
    expect(overlayCss).toContain('var(--ops-z-modal)');
    expect(overlayCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(overlayCss).not.toMatch(/z-\[9999\]/);
    expect(overlayCss).not.toMatch(/\bhtml\.dark\b/);
    expect(overlayCss).not.toMatch(/\bdark:/);
    expect(overlayCss).not.toMatch(/\bgray-\d+/);
    expect(overlayCss).not.toMatch(/#[0-9A-Fa-f]{3,8}/);
  });
});
