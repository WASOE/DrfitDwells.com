import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildCheckoutSessionV2BoundaryKey,
  CHECKOUT_SESSION_V2_STORAGE_KEY,
  clearCheckoutSessionV2Storage,
  isSameCheckoutSessionV2Identity,
  readCheckoutSessionV2Storage,
  writeCheckoutSessionV2Storage
} from './checkoutSessionV2Storage';

const BOUNDARY_CABIN = buildCheckoutSessionV2BoundaryKey({
  entityType: 'cabin',
  entityId: 'cab_123',
  checkIn: '2026-06-10',
  checkOut: '2026-06-12'
});

const BOUNDARY_CABIN_TYPE = buildCheckoutSessionV2BoundaryKey({
  entityType: 'cabinType',
  entityId: 'type_456',
  checkIn: '2026-07-01',
  checkOut: '2026-07-05'
});

function baseState(overrides = {}) {
  return {
    checkoutId: 'chk_test_v2_01',
    commercialBoundaryKey: BOUNDARY_CABIN,
    quoteSnapshotHash: 'hash_abc',
    sessionVersion: 2,
    canonicalPaymentIntentId: 'pi_canonical_1',
    clientSecretPresent: true,
    voucherRedemptionId: 'red_1',
    stripeAmountCents: 36000,
    noPaymentRequired: false,
    ...overrides
  };
}

describe('checkoutSessionV2Storage', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('builds boundary key for cabin', () => {
    expect(BOUNDARY_CABIN).toBe('v1|cabin|cab_123|2026-06-10|2026-06-12');
  });

  it('builds boundary key for cabinType', () => {
    expect(BOUNDARY_CABIN_TYPE).toBe('v1|cabinType|type_456|2026-07-01|2026-07-05');
  });

  it('does not include adults, children, promo, or voucher in boundary', () => {
    const key = buildCheckoutSessionV2BoundaryKey({
      entityType: 'cabin',
      entityId: 'cab_123',
      checkIn: '2026-06-10',
      checkOut: '2026-06-12',
      adults: 4,
      children: 2,
      promoCode: 'SAVE10',
      voucherCode: 'GIFT'
    });
    expect(key).toBe(BOUNDARY_CABIN);
  });

  it('writes and reads valid storage', () => {
    const state = baseState();
    expect(writeCheckoutSessionV2Storage(state)).toBe(true);

    const read = readCheckoutSessionV2Storage(BOUNDARY_CABIN);
    expect(read).toEqual({
      ...state,
      updatedAt: expect.any(String)
    });
    expect(read.clientSecret).toBeUndefined();
    expect(read.client_secret).toBeUndefined();
  });

  it('returns null and clears on malformed JSON', () => {
    sessionStorage.setItem(CHECKOUT_SESSION_V2_STORAGE_KEY, '{not-json');
    expect(readCheckoutSessionV2Storage(BOUNDARY_CABIN)).toBeNull();
    expect(sessionStorage.getItem(CHECKOUT_SESSION_V2_STORAGE_KEY)).toBeNull();
  });

  it('returns null and clears on boundary mismatch', () => {
    writeCheckoutSessionV2Storage(baseState());
    expect(readCheckoutSessionV2Storage('v1|cabin|other|2026-06-10|2026-06-12')).toBeNull();
    expect(sessionStorage.getItem(CHECKOUT_SESSION_V2_STORAGE_KEY)).toBeNull();
  });

  it('does not persist clientSecret or client_secret from input', () => {
    writeCheckoutSessionV2Storage({
      ...baseState(),
      clientSecret: 'cs_test_secret',
      client_secret: 'cs_test_secret_2'
    });

    const raw = JSON.parse(sessionStorage.getItem(CHECKOUT_SESSION_V2_STORAGE_KEY));
    expect(raw.clientSecret).toBeUndefined();
    expect(raw.client_secret).toBeUndefined();

    const read = readCheckoutSessionV2Storage(BOUNDARY_CABIN);
    expect(read.clientSecret).toBeUndefined();
    expect(read.client_secret).toBeUndefined();
  });

  it('isSameCheckoutSessionV2Identity is true for matching identity fields', () => {
    const a = baseState();
    const b = baseState({ sessionVersion: 99, stripeAmountCents: 1 });
    expect(isSameCheckoutSessionV2Identity(a, b)).toBe(true);
  });

  it('isSameCheckoutSessionV2Identity is false when checkoutId changes', () => {
    expect(
      isSameCheckoutSessionV2Identity(baseState(), baseState({ checkoutId: 'chk_other' }))
    ).toBe(false);
  });

  it('isSameCheckoutSessionV2Identity is false when quoteSnapshotHash changes', () => {
    expect(
      isSameCheckoutSessionV2Identity(baseState(), baseState({ quoteSnapshotHash: 'hash_other' }))
    ).toBe(false);
  });

  it('isSameCheckoutSessionV2Identity is false when canonicalPaymentIntentId changes', () => {
    expect(
      isSameCheckoutSessionV2Identity(
        baseState(),
        baseState({ canonicalPaymentIntentId: 'pi_other' })
      )
    ).toBe(false);
  });

  it('clearCheckoutSessionV2Storage removes the key', () => {
    writeCheckoutSessionV2Storage(baseState());
    clearCheckoutSessionV2Storage();
    expect(sessionStorage.getItem(CHECKOUT_SESSION_V2_STORAGE_KEY)).toBeNull();
  });
});
