import { describe, expect, it } from 'vitest';
import {
  OPS_SIDEBAR_FLYOUT_INSET_PX,
  computeOpsSidebarFlyoutPosition
} from './opsSidebarFlyoutPosition';

const INSET = OPS_SIDEBAR_FLYOUT_INSET_PX;

describe('computeOpsSidebarFlyoutPosition', () => {
  it('aligns to the trigger when it is near the top', () => {
    const result = computeOpsSidebarFlyoutPosition({
      triggerTop: 12,
      triggerRight: 56,
      flyoutHeight: 180,
      viewportHeight: 1024
    });
    expect(result.top).toBe(12);
    expect(result.left).toBe(56);
    expect(result.maxHeight).toBe(1024 - INSET * 2);
  });

  it('keeps middle-rail alignment unchanged', () => {
    const result = computeOpsSidebarFlyoutPosition({
      triggerTop: 400,
      triggerRight: 56,
      flyoutHeight: 180,
      viewportHeight: 1024
    });
    expect(result.top).toBe(400);
    expect(result.left).toBe(56);
  });

  it('shifts a bottom trigger upward so the flyout stays in view', () => {
    const result = computeOpsSidebarFlyoutPosition({
      triggerTop: 980,
      triggerRight: 56,
      flyoutHeight: 180,
      viewportHeight: 1024
    });
    expect(result.top).toBe(1024 - 180 - INSET);
    expect(result.top + 180).toBeLessThanOrEqual(1024 - INSET);
    expect(result.top).toBeGreaterThanOrEqual(INSET);
  });

  it('keeps a flyout that is taller than the space below the trigger fully inside the viewport', () => {
    const result = computeOpsSidebarFlyoutPosition({
      triggerTop: 900,
      triggerRight: 56,
      flyoutHeight: 200,
      viewportHeight: 1024
    });
    expect(result.top).toBe(1024 - 200 - INSET);
    expect(result.top).toBeGreaterThanOrEqual(INSET);
    expect(result.top + 200).toBeLessThanOrEqual(1024 - INSET);
  });

  it('keeps an Admin-style bottom flyout visible in a 600px viewport', () => {
    const result = computeOpsSidebarFlyoutPosition({
      triggerTop: 552,
      triggerRight: 56,
      flyoutHeight: 120,
      viewportHeight: 600
    });
    expect(result.top).toBe(600 - 120 - INSET);
    expect(result.top).toBeGreaterThanOrEqual(INSET);
    expect(result.top + 120).toBeLessThanOrEqual(600 - INSET);
    expect(result.top).toBeLessThan(552);
  });

  it('clamps a top trigger that sits above the inset', () => {
    const result = computeOpsSidebarFlyoutPosition({
      triggerTop: 0,
      triggerRight: 56,
      flyoutHeight: 80,
      viewportHeight: 768
    });
    expect(result.top).toBe(INSET);
  });

  it('caps maxHeight when the flyout is taller than the viewport', () => {
    const result = computeOpsSidebarFlyoutPosition({
      triggerTop: 40,
      triggerRight: 56,
      flyoutHeight: 800,
      viewportHeight: 600
    });
    expect(result.maxHeight).toBe(600 - INSET * 2);
    expect(result.top).toBe(INSET);
  });
});
