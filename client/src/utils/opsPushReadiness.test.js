import { describe, expect, it } from 'vitest';
import {
  findActiveServerSubscription,
  hasActivePushSubscription,
  isIosDevice,
  isPushApiSupported,
  isStandalonePwa,
  isValidOpsUserActorId,
  pushHealthLabel,
  resolveOpsPushReadiness
} from './opsPushReadiness.js';
import { pushSubscriptionToPayload } from './opsPushVapid.js';

describe('opsPushReadiness', () => {
  it('detects unsupported browsers', () => {
    expect(isPushApiSupported({ navigator: {} })).toBe(false);
    expect(
      resolveOpsPushReadiness({
        supported: false,
        needsInstall: false,
        permission: 'default',
        pushEnabled: true,
        hasOpsUserId: true,
        hasActiveSubscription: false
      })
    ).toBe('unsupported');
  });

  it('requires OPS user ObjectId', () => {
    expect(isValidOpsUserActorId('admin')).toBe(false);
    expect(isValidOpsUserActorId('507f1f77bcf86cd799439011')).toBe(true);
    expect(
      resolveOpsPushReadiness({
        supported: true,
        needsInstall: false,
        permission: 'default',
        pushEnabled: true,
        hasOpsUserId: false,
        hasActiveSubscription: false
      })
    ).toBe('ops_user_required');
  });

  it('shows push_not_configured when server push is disabled', () => {
    expect(
      resolveOpsPushReadiness({
        supported: true,
        needsInstall: false,
        permission: 'default',
        pushEnabled: false,
        hasOpsUserId: true,
        hasActiveSubscription: false
      })
    ).toBe('push_not_configured');
  });

  it('shows needs_install for iOS Safari outside standalone PWA', () => {
    const env = {
      navigator: {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
        platform: 'iPhone',
        maxTouchPoints: 5,
        standalone: false
      },
      matchMedia: () => ({ matches: false })
    };
    expect(isIosDevice(env)).toBe(true);
    expect(isStandalonePwa(env)).toBe(false);
    expect(
      resolveOpsPushReadiness({
        supported: true,
        needsInstall: true,
        permission: 'default',
        pushEnabled: true,
        hasOpsUserId: true,
        hasActiveSubscription: false
      })
    ).toBe('needs_install');
  });

  it('shows permission_denied without retry state', () => {
    expect(
      resolveOpsPushReadiness({
        supported: true,
        needsInstall: false,
        permission: 'denied',
        pushEnabled: true,
        hasOpsUserId: true,
        hasActiveSubscription: false
      })
    ).toBe('permission_denied');
  });

  it('matches active subscription by endpoint', () => {
    const serverSubs = [
      { id: '1', endpoint: 'https://push.test/a', invalidatedAt: null },
      { id: '2', endpoint: 'https://push.test/b', invalidatedAt: '2026-01-01T00:00:00.000Z' }
    ];
    expect(hasActivePushSubscription(serverSubs, 'https://push.test/a')).toBe(true);
    expect(hasActivePushSubscription(serverSubs, 'https://push.test/b')).toBe(false);
    expect(findActiveServerSubscription(serverSubs, 'https://push.test/a')?.id).toBe('1');
  });

  it('labels admin push health states', () => {
    expect(pushHealthLabel({ activeCount: 2, invalidatedCount: 0 })).toBe('Ready');
    expect(pushHealthLabel({ activeCount: 0, invalidatedCount: 0 })).toBe('None');
    expect(pushHealthLabel({ activeCount: 0, invalidatedCount: 1 })).toBe('Expired');
  });
});

describe('pushSubscriptionToPayload', () => {
  it('maps browser PushSubscription JSON to server payload shape', () => {
    const payload = pushSubscriptionToPayload({
      toJSON() {
        return {
          endpoint: 'https://push.example.test/device',
          keys: { p256dh: 'p256-key', auth: 'auth-key' }
        };
      }
    });
    expect(payload).toEqual({
      endpoint: 'https://push.example.test/device',
      keys: { p256dh: 'p256-key', auth: 'auth-key' }
    });
  });
});
