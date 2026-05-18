import { afterEach, describe, expect, it, vi } from 'vitest';

describe('checkoutSessionV2Flags', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function loadFlags() {
    vi.resetModules();
    const mod = await import('./checkoutSessionV2Flags.js');
    return mod.isCheckoutSessionV2Enabled;
  }

  it('returns false when env is undefined', async () => {
    vi.stubEnv('VITE_CHECKOUT_SESSION_V2', undefined);
    const isEnabled = await loadFlags();
    expect(isEnabled()).toBe(false);
  });

  it('returns false for "0"', async () => {
    vi.stubEnv('VITE_CHECKOUT_SESSION_V2', '0');
    const isEnabled = await loadFlags();
    expect(isEnabled()).toBe(false);
  });

  it('returns false for "false"', async () => {
    vi.stubEnv('VITE_CHECKOUT_SESSION_V2', 'false');
    const isEnabled = await loadFlags();
    expect(isEnabled()).toBe(false);
  });

  it('returns true for "1"', async () => {
    vi.stubEnv('VITE_CHECKOUT_SESSION_V2', '1');
    const isEnabled = await loadFlags();
    expect(isEnabled()).toBe(true);
  });

  it('returns true for "true"', async () => {
    vi.stubEnv('VITE_CHECKOUT_SESSION_V2', 'true');
    const isEnabled = await loadFlags();
    expect(isEnabled()).toBe(true);
  });

  it('is case-insensitive for TRUE', async () => {
    vi.stubEnv('VITE_CHECKOUT_SESSION_V2', 'TRUE');
    const isEnabled = await loadFlags();
    expect(isEnabled()).toBe(true);
  });
});
