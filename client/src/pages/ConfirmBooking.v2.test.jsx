import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCheckoutSessionV2BoundaryKey,
  CHECKOUT_SESSION_V2_STORAGE_KEY,
  clearCheckoutSessionV2Storage,
  readCheckoutSessionV2Storage,
  writeCheckoutSessionV2Storage
} from '../utils/checkoutSessionV2Storage';
import {
  buildV2PaymentElementKey,
  buildV2CheckoutIdentity,
  buildV2StorageRecordFromPaymentResponse,
  classifyV2CheckoutInitError,
  getV2CheckoutInitErrorHandling,
  readLegacyCheckoutSession,
  resolveV2ClientSecretAfterPaymentIntent,
  restoreV2SessionFieldsFromStorage,
  shouldBlockCardPaymentPrecheck,
  shouldReuseV2ClientSecret,
  validateV2CreatePaymentIntentResponse,
  V2_CHECKOUT_CONFIG_MISMATCH_MESSAGE,
  V2_CHECKOUT_RESTART_MESSAGE,
  V2_CHECKOUT_RETRY_PAYMENT_MESSAGE
} from './ConfirmBooking.jsx';

const BOUNDARY = buildCheckoutSessionV2BoundaryKey({
  entityType: 'cabin',
  entityId: 'cab_123',
  checkIn: '2026-06-10',
  checkOut: '2026-06-12'
});

const OTHER_BOUNDARY = buildCheckoutSessionV2BoundaryKey({
  entityType: 'cabin',
  entityId: 'cab_other',
  checkIn: '2026-06-10',
  checkOut: '2026-06-12'
});

describe('ConfirmBooking V2 helpers', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('readLegacyCheckoutSession returns stored checkoutId for matching attempt key', () => {
    const attemptKey = 'cabin|cab_123|2026-06-10|2026-06-12|2|0';
    sessionStorage.setItem(
      'confirm-booking-checkout-session',
      JSON.stringify({ attemptKey, checkoutId: 'chk_legacy_01' })
    );
    expect(readLegacyCheckoutSession(attemptKey)).toBe('chk_legacy_01');
    expect(readLegacyCheckoutSession('other-key')).toBeNull();
  });

  it('validateV2CreatePaymentIntentResponse fails closed without flowVersion or checkoutId', () => {
    expect(validateV2CreatePaymentIntentResponse({ flowVersion: 'legacy' })).toEqual({
      ok: false,
      error: V2_CHECKOUT_CONFIG_MISMATCH_MESSAGE
    });
    expect(validateV2CreatePaymentIntentResponse({ flowVersion: 'v2', checkoutId: '  ' })).toEqual({
      ok: false,
      error: V2_CHECKOUT_CONFIG_MISMATCH_MESSAGE
    });
    expect(validateV2CreatePaymentIntentResponse({ flowVersion: 'v2', checkoutId: 'chk_srv_1' })).toEqual({
      ok: true,
      checkoutId: 'chk_srv_1'
    });
  });

  it('buildV2StorageRecordFromPaymentResponse never includes clientSecret', () => {
    const record = buildV2StorageRecordFromPaymentResponse(
      {
        checkoutId: 'chk_srv_1',
        quoteSnapshotHash: 'hash_a',
        sessionVersion: 3,
        canonicalPaymentIntentId: 'pi_1',
        clientSecret: 'cs_test',
        client_secret: 'cs_test_2',
        voucherRedemptionId: 'red_1',
        stripeAmountCents: 12000,
        noPaymentRequired: false
      },
      BOUNDARY
    );
    expect(record.clientSecret).toBeUndefined();
    expect(record.client_secret).toBeUndefined();
    expect(record.commercialBoundaryKey).toBe(BOUNDARY);
    expect(record.clientSecretPresent).toBe(true);
  });

  it('noPaymentRequired response clears clientSecretPresent hint in storage record', () => {
    const record = buildV2StorageRecordFromPaymentResponse(
      {
        checkoutId: 'chk_srv_2',
        quoteSnapshotHash: 'hash_b',
        clientSecret: 'cs_should_not_persist',
        noPaymentRequired: true
      },
      BOUNDARY
    );
    expect(record.noPaymentRequired).toBe(true);
    expect(record.clientSecretPresent).toBe(false);
    writeCheckoutSessionV2Storage(record);
    const raw = JSON.parse(sessionStorage.getItem(CHECKOUT_SESSION_V2_STORAGE_KEY));
    expect(raw.clientSecret).toBeUndefined();
    expect(raw.client_secret).toBeUndefined();
  });

  it('V2 boundary change clears storage via read helper', () => {
    writeCheckoutSessionV2Storage({
      checkoutId: 'chk_srv_boundary',
      commercialBoundaryKey: BOUNDARY,
      quoteSnapshotHash: 'hash_a',
      sessionVersion: 1,
      canonicalPaymentIntentId: 'pi_1',
      clientSecretPresent: false,
      voucherRedemptionId: null,
      stripeAmountCents: 0,
      noPaymentRequired: false
    });
    expect(readCheckoutSessionV2Storage(OTHER_BOUNDARY)).toBeNull();
    expect(sessionStorage.getItem(CHECKOUT_SESSION_V2_STORAGE_KEY)).toBeNull();
  });

  it('restoreV2SessionFieldsFromStorage restores server checkoutId without clientSecret', () => {
    writeCheckoutSessionV2Storage({
      checkoutId: 'chk_srv_restore',
      commercialBoundaryKey: BOUNDARY,
      quoteSnapshotHash: 'hash_restore',
      sessionVersion: 4,
      canonicalPaymentIntentId: 'pi_restore',
      clientSecretPresent: true,
      voucherRedemptionId: 'red_restore',
      stripeAmountCents: 5000,
      noPaymentRequired: false
    });
    const stored = readCheckoutSessionV2Storage(BOUNDARY);
    const restored = restoreV2SessionFieldsFromStorage(stored);
    expect(restored.checkoutId).toBe('chk_srv_restore');
    expect(restored.canonicalPaymentIntentId).toBe('pi_restore');
    expect(restored.clientSecret).toBeUndefined();
  });

  it('restoreV2SessionFieldsFromStorage returns null checkoutId when storage empty', () => {
    const restored = restoreV2SessionFieldsFromStorage(null);
    expect(restored.checkoutId).toBeNull();
  });

  it('shouldBlockCardPaymentPrecheck skips minimum when V2 noPaymentRequired', () => {
    expect(
      shouldBlockCardPaymentPrecheck(
        { totalPrice: 0 },
        { noPaymentRequired: true, fullVoucherCoverage: false, checkoutSessionV2Enabled: true }
      )
    ).toBe(false);
  });

  it('shouldBlockCardPaymentPrecheck keeps legacy minimum guard when V2 flag off', () => {
    expect(
      shouldBlockCardPaymentPrecheck(
        { totalPrice: 0.1 },
        { noPaymentRequired: true, fullVoucherCoverage: false, checkoutSessionV2Enabled: false }
      )
    ).toBe(true);
  });

  it('boundary key ignores adults children promo voucher extras', () => {
    const withExtras = buildCheckoutSessionV2BoundaryKey({
      entityType: 'cabin',
      entityId: 'cab_123',
      checkIn: '2026-06-10',
      checkOut: '2026-06-12',
      adults: 5,
      children: 2,
      promoCode: 'SAVE',
      voucherCode: 'GIFT'
    });
    expect(withExtras).toBe(BOUNDARY);
  });
});

const BASE_IDENTITY = {
  checkoutId: 'chk_srv_1',
  canonicalPaymentIntentId: 'pi_canonical_1',
  quoteSnapshotHash: 'hash_abc'
};

describe('ConfirmBooking V2 payment element key and clientSecret reuse', () => {
  it('buildV2PaymentElementKey uses checkoutId, canonical PI, and quote hash', () => {
    expect(buildV2PaymentElementKey(BASE_IDENTITY)).toBe('chk_srv_1:pi_canonical_1:hash_abc');
  });

  it('idempotentReplay with same identity keeps existing clientSecret', () => {
    const current = buildV2CheckoutIdentity(BASE_IDENTITY);
    const resolved = resolveV2ClientSecretAfterPaymentIntent({
      currentIdentity: current,
      responseData: {
        ...BASE_IDENTITY,
        idempotentReplay: true,
        clientSecret: 'cs_new_from_server'
      },
      checkoutId: BASE_IDENTITY.checkoutId,
      existingClientSecret: 'cs_in_memory'
    });
    expect(resolved.reused).toBe(true);
    expect(resolved.clientSecret).toBe('cs_in_memory');
  });

  it('idempotentReplay with same identity does not change Elements key', () => {
    const keyBefore = buildV2PaymentElementKey(BASE_IDENTITY);
    const resolved = resolveV2ClientSecretAfterPaymentIntent({
      currentIdentity: buildV2CheckoutIdentity(BASE_IDENTITY),
      responseData: { ...BASE_IDENTITY, idempotentReplay: true, clientSecret: 'cs_other' },
      checkoutId: BASE_IDENTITY.checkoutId,
      existingClientSecret: 'cs_in_memory'
    });
    const keyAfter = buildV2PaymentElementKey(resolved.nextIdentity);
    expect(keyAfter).toBe(keyBefore);
  });

  it('new canonicalPaymentIntentId replaces clientSecret and changes Elements key', () => {
    const resolved = resolveV2ClientSecretAfterPaymentIntent({
      currentIdentity: buildV2CheckoutIdentity(BASE_IDENTITY),
      responseData: {
        checkoutId: BASE_IDENTITY.checkoutId,
        canonicalPaymentIntentId: 'pi_canonical_2',
        quoteSnapshotHash: BASE_IDENTITY.quoteSnapshotHash,
        idempotentReplay: false,
        clientSecret: 'cs_new_pi'
      },
      checkoutId: BASE_IDENTITY.checkoutId,
      existingClientSecret: 'cs_in_memory'
    });
    expect(resolved.reused).toBe(false);
    expect(resolved.clientSecret).toBe('cs_new_pi');
    expect(buildV2PaymentElementKey(resolved.nextIdentity)).toBe('chk_srv_1:pi_canonical_2:hash_abc');
    expect(buildV2PaymentElementKey(resolved.nextIdentity)).not.toBe(buildV2PaymentElementKey(BASE_IDENTITY));
  });

  it('new quoteSnapshotHash replaces clientSecret and changes Elements key', () => {
    const resolved = resolveV2ClientSecretAfterPaymentIntent({
      currentIdentity: buildV2CheckoutIdentity(BASE_IDENTITY),
      responseData: {
        checkoutId: BASE_IDENTITY.checkoutId,
        canonicalPaymentIntentId: BASE_IDENTITY.canonicalPaymentIntentId,
        quoteSnapshotHash: 'hash_xyz',
        idempotentReplay: true,
        clientSecret: 'cs_new_hash'
      },
      checkoutId: BASE_IDENTITY.checkoutId,
      existingClientSecret: 'cs_in_memory'
    });
    expect(resolved.reused).toBe(false);
    expect(resolved.clientSecret).toBe('cs_new_hash');
    expect(buildV2PaymentElementKey(resolved.nextIdentity)).toBe('chk_srv_1:pi_canonical_1:hash_xyz');
  });

  it('shouldReuseV2ClientSecret is false without in-memory clientSecret', () => {
    expect(
      shouldReuseV2ClientSecret({
        currentIdentity: buildV2CheckoutIdentity(BASE_IDENTITY),
        nextIdentity: buildV2CheckoutIdentity(BASE_IDENTITY),
        idempotentReplay: true,
        clientSecret: null
      })
    ).toBe(false);
  });
});

describe('ConfirmBooking V2 checkout init error handling', () => {
  it('STALE_CLIENT_SECRET clears payment identity but keeps checkout session', () => {
    const handling = getV2CheckoutInitErrorHandling('STALE_CLIENT_SECRET');
    expect(handling.clearPaymentIdentity).toBe(true);
    expect(handling.clearClientSecret).toBe(true);
    expect(handling.clearAll).toBe(false);
    expect(handling.message).toBe(V2_CHECKOUT_RETRY_PAYMENT_MESSAGE);
  });

  it('SUPERSEDED_PAYMENT_INTENT clears payment identity but keeps checkout session', () => {
    const handling = getV2CheckoutInitErrorHandling('SUPERSEDED_PAYMENT_INTENT');
    expect(handling.clearPaymentIdentity).toBe(true);
    expect(handling.clearAll).toBe(false);
  });

  it('CANONICAL_PAYMENT_INTENT_MISMATCH clears payment identity but keeps checkout session', () => {
    expect(classifyV2CheckoutInitError('CANONICAL_PAYMENT_INTENT_MISMATCH').kind).toBe(
      'clearPaymentKeepCheckout'
    );
  });

  it('CHECKOUT_SESSION_EXPIRED clears full V2 session', () => {
    const handling = getV2CheckoutInitErrorHandling('CHECKOUT_SESSION_EXPIRED');
    expect(handling.clearAll).toBe(true);
    expect(handling.message).toBe(V2_CHECKOUT_RESTART_MESSAGE);
  });

  it('CHECKOUT_SESSION_SUPERSEDED and COMMERCIAL_BOUNDARY_CHANGED restart checkout', () => {
    expect(getV2CheckoutInitErrorHandling('CHECKOUT_SESSION_SUPERSEDED').clearAll).toBe(true);
    expect(getV2CheckoutInitErrorHandling('COMMERCIAL_BOUNDARY_CHANGED').clearAll).toBe(true);
  });

  it('CHECKOUT_SESSION_CONCURRENCY_CONFLICT keeps checkoutId scope but clears clientSecret', () => {
    const handling = getV2CheckoutInitErrorHandling('CHECKOUT_SESSION_CONCURRENCY_CONFLICT');
    expect(handling.clearAll).toBe(false);
    expect(handling.clearPaymentIdentity).toBe(false);
    expect(handling.clearClientSecret).toBe(true);
  });

  it('VOUCHER_PAYMENT_INTENT_ATTACH_FAILED and CHECKOUT_SESSION_NOT_USABLE clear clientSecret only', () => {
    expect(getV2CheckoutInitErrorHandling('VOUCHER_PAYMENT_INTENT_ATTACH_FAILED').clearClientSecret).toBe(
      true
    );
    expect(getV2CheckoutInitErrorHandling('CHECKOUT_SESSION_NOT_USABLE').clearAll).toBe(false);
  });

  it('config mismatch validation still fails closed', () => {
    expect(validateV2CreatePaymentIntentResponse({ flowVersion: 'legacy', checkoutId: 'x' })).toEqual({
      ok: false,
      error: V2_CHECKOUT_CONFIG_MISMATCH_MESSAGE
    });
  });
});

describe('ConfirmBooking V2 flag default', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('flag off means isCheckoutSessionV2Enabled is false by default', async () => {
    vi.stubEnv('VITE_CHECKOUT_SESSION_V2', undefined);
    vi.resetModules();
    const { isCheckoutSessionV2Enabled } = await import('../utils/checkoutSessionV2Flags.js');
    expect(isCheckoutSessionV2Enabled()).toBe(false);
  });
});
