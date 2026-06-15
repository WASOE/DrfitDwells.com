import { describe, expect, it } from 'vitest';
import { resolveOpsNotificationNavigationUrl } from './opsNotificationNavigation.js';

describe('opsNotificationNavigation', () => {
  const origin = 'https://booking.driftdwells.com';

  it('allows safe OPS paths', () => {
    expect(resolveOpsNotificationNavigationUrl('/ops/cleaning', origin)).toBe('/ops/cleaning');
    expect(resolveOpsNotificationNavigationUrl('/ops/reservations/1', origin)).toBe('/ops/reservations/1');
  });

  it('rejects external and non-OPS paths', () => {
    expect(resolveOpsNotificationNavigationUrl('https://evil.example/phish', origin)).toBe('/ops');
    expect(resolveOpsNotificationNavigationUrl('/bookings/1', origin)).toBe('/ops');
    expect(resolveOpsNotificationNavigationUrl(null, origin)).toBe('/ops');
  });
});
