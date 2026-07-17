import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  __resetStripeLoaderForTests,
  ensureStripeLoaded,
  retryStripeLoad,
  getStripeLoaderSnapshot,
  STRIPE_LOADER_MAX_ATTEMPTS
} from './stripeLoader';

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn()
}));

import { loadStripe } from '@stripe/stripe-js';

describe('stripeLoader', () => {
  beforeEach(() => {
    __resetStripeLoaderForTests();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('resolves ready when loadStripe returns a stripe instance', async () => {
    const fakeStripe = { elements: () => ({}) };
    loadStripe.mockResolvedValue(fakeStripe);

    ensureStripeLoaded('pk_test_abc');
    await vi.waitFor(() => {
      expect(getStripeLoaderSnapshot().status).toBe('ready');
    });

    expect(getStripeLoaderSnapshot().stripe).toBe(fakeStripe);
    expect(loadStripe).toHaveBeenCalledTimes(1);
  });

  it('retries then fails when loadStripe returns null', async () => {
    vi.useFakeTimers();
    loadStripe.mockResolvedValue(null);

    ensureStripeLoaded('pk_test_abc');
    expect(getStripeLoaderSnapshot().status).toBe('loading');

    for (let i = 0; i < STRIPE_LOADER_MAX_ATTEMPTS; i += 1) {
      await vi.runAllTimersAsync();
    }

    await vi.waitFor(() => {
      expect(getStripeLoaderSnapshot().status).toBe('failed');
    });
    expect(loadStripe.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('retryStripeLoad clears cache and attempts again', async () => {
    loadStripe.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: 'stripe' });

    vi.useFakeTimers();
    ensureStripeLoaded('pk_test_abc');
    for (let i = 0; i < STRIPE_LOADER_MAX_ATTEMPTS; i += 1) {
      await vi.runAllTimersAsync();
    }
    await vi.waitFor(() => expect(getStripeLoaderSnapshot().status).toBe('failed'));

    retryStripeLoad('pk_test_abc');
    for (let i = 0; i < STRIPE_LOADER_MAX_ATTEMPTS; i += 1) {
      await vi.runAllTimersAsync();
    }
    await vi.waitFor(() => expect(getStripeLoaderSnapshot().status).toBe('ready'));
  });
});
