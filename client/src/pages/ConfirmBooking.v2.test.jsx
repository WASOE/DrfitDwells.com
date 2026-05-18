import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCheckoutSessionV2BoundaryKey,
  CHECKOUT_SESSION_V2_STORAGE_KEY,
  clearCheckoutSessionV2Storage,
  readCheckoutSessionV2Storage,
  writeCheckoutSessionV2Storage
} from '../utils/checkoutSessionV2Storage';
import {
  buildV2StorageRecordFromPaymentResponse,
  readLegacyCheckoutSession,
  restoreV2SessionFieldsFromStorage,
  shouldBlockCardPaymentPrecheck,
  validateV2CreatePaymentIntentResponse,
  V2_CHECKOUT_CONFIG_MISMATCH_MESSAGE
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
