import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { loadStripe } from '@stripe/stripe-js';

vi.mock('@stripe/stripe-js', () => ({ loadStripe: vi.fn() }));

const nodeProcess = globalThis.process;

const VALID_KEY = 'pk_test_abc123';

// Stripe.js fails asynchronously in the browser; mirror that so the module's own
// rejection guard is exercised the same way it is at runtime.
function rejectingLoad(message = 'network down') {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error(message)), 0);
  });
}

function Probe() {
  const { status, unavailable, stripePromise, retry } = useStripeAvailabilityRef.current();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="unavailable">{String(unavailable)}</span>
      <span data-testid="has-promise">{String(Boolean(stripePromise))}</span>
      <button type="button" onClick={retry}>retry</button>
    </div>
  );
}

const useStripeAvailabilityRef = { current: null };

async function loadModule() {
  vi.resetModules();
  const mod = await import('./stripeClient');
  useStripeAvailabilityRef.current = mod.useStripeAvailability;
  return mod;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', VALID_KEY);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('useStripeAvailability', () => {
  it('reports unavailable when no usable publishable key is configured', async () => {
    vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', '');
    await loadModule();
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unavailable'));
    expect(screen.getByTestId('unavailable')).toHaveTextContent('true');
    expect(screen.getByTestId('has-promise')).toHaveTextContent('false');
    expect(loadStripe).not.toHaveBeenCalled();
  });

  it('reports error when the Stripe promise resolves to null', async () => {
    loadStripe.mockReturnValue(Promise.resolve(null));
    await loadModule();
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
    expect(screen.getByTestId('unavailable')).toHaveTextContent('true');
    expect(screen.getByTestId('has-promise')).toHaveTextContent('false');
  });

  it('reports error when the Stripe promise rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    loadStripe.mockImplementation(() => rejectingLoad());
    await loadModule();
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('reports error when Stripe initialization throws synchronously', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      loadStripe.mockImplementation(() => { throw new Error('Stripe setup failed'); });
      await loadModule();
      render(<Probe />);
      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
      expect(consoleError).toHaveBeenCalledWith(
        'Stripe client initialization failed:', expect.any(Error)
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('reports ready and exposes the promise when Stripe loads', async () => {
    loadStripe.mockReturnValue(Promise.resolve({ id: 'stripe' }));
    await loadModule();
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    expect(screen.getByTestId('unavailable')).toHaveTextContent('false');
    expect(screen.getByTestId('has-promise')).toHaveTextContent('true');
  });

  it('retry re-attempts loading Stripe and can recover', async () => {
    loadStripe
      .mockReturnValueOnce(Promise.resolve(null))
      .mockReturnValueOnce(Promise.resolve({ id: 'stripe' }));
    await loadModule();
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    expect(loadStripe).toHaveBeenCalledTimes(2);
  });
});

describe('getStripePromise rejection handling', () => {
  it('does not emit an unhandled rejection when nothing subscribes to a failed load', async () => {
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    nodeProcess.on('unhandledRejection', onUnhandled);
    try {
      loadStripe.mockImplementation(() => rejectingLoad());
      const { getStripePromise } = await loadModule();
      getStripePromise();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
    } finally {
      nodeProcess.off('unhandledRejection', onUnhandled);
    }
  });

  it('still rejects for consumers that await the promise', async () => {
    loadStripe.mockImplementation(() => rejectingLoad());
    const { getStripePromise } = await loadModule();
    await expect(getStripePromise()).rejects.toThrow('network down');
  });

  it('returns a promise resolving to null without throwing when Stripe.js yields null', async () => {
    loadStripe.mockReturnValue(Promise.resolve(null));
    const { getStripePromise } = await loadModule();
    await expect(getStripePromise()).resolves.toBeNull();
  });
});
