import { describe, expect, it } from 'vitest';
import { resolveOpsPushAttention } from './opsPushAttention';

describe('resolveOpsPushAttention', () => {
  it('returns null while loading or when healthy subscribed', () => {
    expect(resolveOpsPushAttention({ loading: true, readiness: 'ready_to_subscribe' })).toBeNull();
    expect(
      resolveOpsPushAttention({
        loading: false,
        readiness: 'subscribed',
        isAdmin: true,
        health: {
          pushEnabled: true,
          workerEnabled: true,
          worker: { running: true },
          scheduledJobs: { failed: 0 }
        }
      })
    ).toBeNull();
  });

  it('flags device disabled with enable action', () => {
    const attention = resolveOpsPushAttention({
      loading: false,
      readiness: 'ready_to_subscribe'
    });
    expect(attention.key).toBe('device_disabled');
    expect(attention.action).toBe('enable');
  });

  it('flags failed jobs and worker down for admin health', () => {
    expect(
      resolveOpsPushAttention({
        loading: false,
        readiness: 'subscribed',
        isAdmin: true,
        health: {
          pushEnabled: true,
          workerEnabled: true,
          worker: { running: true },
          scheduledJobs: { failed: 3 }
        }
      }).key
    ).toBe('failed_jobs');

    expect(
      resolveOpsPushAttention({
        loading: false,
        readiness: 'subscribed',
        isAdmin: true,
        health: {
          pushEnabled: true,
          workerEnabled: true,
          worker: { running: false },
          scheduledJobs: { failed: 0 }
        }
      }).key
    ).toBe('worker_down');
  });

  it('does not expose admin health attention to non-admin when subscribed', () => {
    expect(
      resolveOpsPushAttention({
        loading: false,
        readiness: 'subscribed',
        isAdmin: false,
        health: {
          pushEnabled: true,
          workerEnabled: true,
          worker: { running: false },
          scheduledJobs: { failed: 9 }
        }
      })
    ).toBeNull();
  });
});
