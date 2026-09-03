import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHUNK_RECOVERY_KEY,
  attemptChunkLoadRecovery,
  isDynamicImportChunkError,
  resetAppReleaseUpdateState
} from '../utils/appReleaseUpdate.js';

afterEach(() => {
  resetAppReleaseUpdateState();
});

describe('ErrorBoundary chunk recovery integration', () => {
  it('recognizes chunk errors separately from ordinary runtime errors', () => {
    expect(
      isDynamicImportChunkError(
        new TypeError('Failed to fetch dynamically imported module: https://x/assets/Ops-a.js')
      )
    ).toBe(true);
    expect(isDynamicImportChunkError(new ReferenceError('x is not defined'))).toBe(false);
  });

  it('ordinary runtime errors do not consume the one-time recovery guard', () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn()
    };

    expect(isDynamicImportChunkError(new Error('render blew up'))).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalledWith(CHUNK_RECOVERY_KEY, '1');
  });

  it('chunk recovery guard prevents reload loops', () => {
    const storage = {
      map: new Map(),
      getItem(key) {
        return this.map.get(key) ?? null;
      },
      setItem(key, value) {
        this.map.set(key, String(value));
      },
      removeItem(key) {
        this.map.delete(key);
      }
    };
    const reload = vi.fn();

    attemptChunkLoadRecovery({ storage, reload, locationHref: 'https://driftdwells.com/ops', now: 1 });
    const second = attemptChunkLoadRecovery({ storage, reload, locationHref: 'https://driftdwells.com/ops', now: 2 });

    expect(reload).toHaveBeenCalledTimes(1);
    expect(second.reason).toBe('already_attempted');
  });
});
