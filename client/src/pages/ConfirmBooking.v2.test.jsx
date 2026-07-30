import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCheckoutSessionV2BoundaryKey,
  CHECKOUT_SESSION_V2_STORAGE_KEY,
  clearCheckoutSessionV2Storage,
  readCheckoutSessionV2Storage,
  writeCheckoutSessionV2Storage
} from '../utils/checkoutSessionV2Storage';
import {
  buildCreateBookingPayload,
  buildRedirectBookingPayloadFromPending,
  buildV2PaymentElementKey,
  buildV2CheckoutIdentity,
  buildV2PendingCheckoutPayload,
  buildV2StorageRecordFromPaymentResponse,
  classifyV2CheckoutInitError,
  clearCheckoutStorageAfterSuccessfulBooking,
  getV2CheckoutInitErrorHandling,
  mapCreateBookingErrorMessage,
  readLegacyCheckoutSession,
  resolveV2ClientSecretAfterPaymentIntent,
  restoreV2SessionFieldsFromStorage,
  shouldAllowV2NoPaymentSubmit,
  shouldBlockCardPaymentPrecheck,
  shouldHandleRedirectAsV2,
  shouldReuseV2ClientSecret,
  validateV2CreatePaymentIntentResponse,
  validateV2RedirectPaymentIntent,
  V2_CHECKOUT_CONFIG_MISMATCH_MESSAGE,
  V2_CHECKOUT_RESTART_MESSAGE,
  V2_CHECKOUT_RETRY_PAYMENT_MESSAGE,
  V2_NO_PAYMENT_MISSING_CHECKOUT_MESSAGE,
  V2_REDIRECT_PI_MISMATCH_MESSAGE
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

const PENDING_BASE = {
  cabinId: 'cab_123',
  bookingEntityId: 'cab_123',
  bookingEntityType: 'cabin',
  checkIn: '2026-06-10',
  checkOut: '2026-06-12',
  adults: 2,
  children: 0,
  checkoutId: 'chk_srv_redirect',
  voucherRedemptionId: 'red_redirect',
  formData: {
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    phone: '+359800000000',
    agreedToTerms: true,
    agreedToActivityRisk: true
  },
  experiences: [{ key: 'jeep_transfer' }]
};

const PENDING_V2 = buildV2PendingCheckoutPayload(PENDING_BASE, {
  checkoutId: 'chk_srv_redirect',
  canonicalPaymentIntentId: 'pi_canonical_redirect',
  quoteSnapshotHash: 'hash_redirect',
  noPaymentRequired: false,
  voucherRedemptionId: 'red_redirect'
});

describe('ConfirmBooking V2 redirect-back helpers', () => {
  it('buildV2PendingCheckoutPayload includes V2 identity fields', () => {
    expect(PENDING_V2).toMatchObject({
      flowVersion: 'v2',
      checkoutId: 'chk_srv_redirect',
      canonicalPaymentIntentId: 'pi_canonical_redirect',
      quoteSnapshotHash: 'hash_redirect',
      noPaymentRequired: false,
      voucherRedemptionId: 'red_redirect'
    });
    expect(PENDING_V2.cabinId).toBe('cab_123');
  });

  it('legacy pending base does not include flowVersion', () => {
    expect(PENDING_BASE.flowVersion).toBeUndefined();
  });

  it('shouldHandleRedirectAsV2 is true only when flag on and redirect succeeded', () => {
    expect(
      shouldHandleRedirectAsV2({
        checkoutSessionV2Enabled: true,
        paymentIntentId: 'pi_1',
        redirectStatus: 'succeeded'
      })
    ).toBe(true);
    expect(
      shouldHandleRedirectAsV2({
        checkoutSessionV2Enabled: false,
        paymentIntentId: 'pi_1',
        redirectStatus: 'succeeded'
      })
    ).toBe(false);
    expect(
      shouldHandleRedirectAsV2({
        checkoutSessionV2Enabled: true,
        paymentIntentId: 'pi_1',
        redirectStatus: 'failed'
      })
    ).toBe(false);
  });

  it('validateV2RedirectPaymentIntent allows finalize when URL PI matches canonical', () => {
    expect(
      validateV2RedirectPaymentIntent({
        pending: PENDING_V2,
        urlPaymentIntentId: 'pi_canonical_redirect'
      })
    ).toEqual({
      ok: true,
      reason: null,
      checkoutId: 'chk_srv_redirect',
      paymentIntentId: 'pi_canonical_redirect'
    });
  });

  it('buildRedirectBookingPayloadFromPending uses pending checkoutId and URL PI', () => {
    const payload = buildRedirectBookingPayloadFromPending(PENDING_V2, 'pi_canonical_redirect', {
      routeId: 'cab_123',
      language: 'en',
      attribution: null,
      metaClientContext: {}
    });
    expect(payload.checkoutId).toBe('chk_srv_redirect');
    expect(payload.paymentIntentId).toBe('pi_canonical_redirect');
    expect(payload.voucherRedemptionId).toBe('red_redirect');
    expect(payload.cabinId).toBe('cab_123');
  });

  it('validateV2RedirectPaymentIntent blocks mismatched PI', () => {
    expect(
      validateV2RedirectPaymentIntent({
        pending: PENDING_V2,
        urlPaymentIntentId: 'pi_other'
      }).ok
    ).toBe(false);
  });

  it('validateV2RedirectPaymentIntent blocks missing canonicalPaymentIntentId', () => {
    expect(
      validateV2RedirectPaymentIntent({
        pending: { ...PENDING_V2, canonicalPaymentIntentId: null },
        urlPaymentIntentId: 'pi_canonical_redirect'
      }).reason
    ).toBe('missing_canonical_pi');
  });

  it('validateV2RedirectPaymentIntent blocks legacy pending when V2 expected', () => {
    expect(
      validateV2RedirectPaymentIntent({
        pending: PENDING_BASE,
        urlPaymentIntentId: 'pi_canonical_redirect'
      })
    ).toEqual({ ok: false, reason: 'not_v2_pending' });
  });

  it('validateV2RedirectPaymentIntent blocks noPaymentRequired with redirect PI', () => {
    expect(
      validateV2RedirectPaymentIntent({
        pending: { ...PENDING_V2, noPaymentRequired: true },
        urlPaymentIntentId: 'pi_canonical_redirect'
      })
    ).toEqual({ ok: false, reason: 'no_payment_required' });
  });

  it('mismatched PI reason maps to user-facing redirect message constant', () => {
    const result = validateV2RedirectPaymentIntent({
      pending: PENDING_V2,
      urlPaymentIntentId: 'pi_stale'
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('pi_mismatch');
    expect(V2_REDIRECT_PI_MISMATCH_MESSAGE).toContain('Payment session changed');
  });
});

describe('ConfirmBooking V2 flag default', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('flag off means isCheckoutSessionV2Enabled is false by default', async () => {
    vi.stubEnv('VITE_CHECKOUT_SESSION_V2', undefined);
    vi.stubEnv('VITE_FINALIZE_INTENT_PERSIST', undefined);
    vi.stubEnv('VITE_FINALIZE_INTENT_REQUIRED_FOR_PI', undefined);
    vi.resetModules();
    const { isCheckoutSessionV2Enabled } = await import('../utils/checkoutSessionV2Flags.js');
    expect(isCheckoutSessionV2Enabled()).toBe(false);
  });

  it('does not infer V2 from finalize Vite flags alone', async () => {
    vi.stubEnv('VITE_CHECKOUT_SESSION_V2', undefined);
    vi.stubEnv('VITE_FINALIZE_INTENT_PERSIST', '1');
    vi.stubEnv('VITE_FINALIZE_INTENT_REQUIRED_FOR_PI', '1');
    vi.resetModules();
    const { isCheckoutSessionV2Enabled } = await import('../utils/checkoutSessionV2Flags.js');
    expect(isCheckoutSessionV2Enabled()).toBe(false);
  });

  it('explicit VITE_CHECKOUT_SESSION_V2 enables V2', async () => {
    vi.stubEnv('VITE_CHECKOUT_SESSION_V2', '1');
    vi.stubEnv('VITE_FINALIZE_INTENT_PERSIST', undefined);
    vi.stubEnv('VITE_FINALIZE_INTENT_REQUIRED_FOR_PI', undefined);
    vi.resetModules();
    const { isCheckoutSessionV2Enabled } = await import('../utils/checkoutSessionV2Flags.js');
    expect(isCheckoutSessionV2Enabled()).toBe(true);
  });
});

const FORM_DATA = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  phone: '+359800000000',
  specialRequests: '',
  agreedToTerms: true,
  agreedToActivityRisk: true
};

const CHECK_IN = new Date('2026-06-10T12:00:00');
const CHECK_OUT = new Date('2026-06-12T12:00:00');

function buildNoPaymentCreatePayload(overrides = {}) {
  return buildCreateBookingPayload({
    bookingEntityType: 'cabin',
    bookingEntityId: 'cab_123',
    checkIn: CHECK_IN,
    checkOut: CHECK_OUT,
    adults: 2,
    children: 0,
    selectedExpKeys: new Set(['jeep_transfer']),
    formData: FORM_DATA,
    checkoutId: 'chk_srv_no_pay',
    voucherRedemptionId: null,
    lockedPromoCode: null,
    appliedVoucherCode: '',
    language: 'en',
    paymentIntentId: null,
    ...overrides
  });
}

describe('ConfirmBooking V2 no-payment finalization', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('V2 noPaymentRequired booking payload omits paymentIntentId', () => {
    const payload = buildNoPaymentCreatePayload();
    expect(payload.paymentIntentId).toBeUndefined();
    expect('paymentIntentId' in payload).toBe(false);
  });

  it('V2 noPaymentRequired booking payload includes server checkoutId', () => {
    const payload = buildNoPaymentCreatePayload();
    expect(payload.checkoutId).toBe('chk_srv_no_pay');
  });

  it('V2 full voucher payload includes voucherRedemptionId', () => {
    const payload = buildNoPaymentCreatePayload({
      voucherRedemptionId: 'red_full_voucher',
      appliedVoucherCode: 'GIFT100'
    });
    expect(payload.voucherRedemptionId).toBe('red_full_voucher');
    expect(payload.voucherCode).toBe('GIFT100');
    expect(payload.paymentIntentId).toBeUndefined();
  });

  it('V2 zero-due promo payload includes promoCode and no paymentIntentId', () => {
    const payload = buildNoPaymentCreatePayload({
      lockedPromoCode: 'ZERODUE',
      voucherRedemptionId: null
    });
    expect(payload.promoCode).toBe('ZERODUE');
    expect(payload.paymentIntentId).toBeUndefined();
    expect(payload.voucherRedemptionId).toBeUndefined();
  });

  it('V2 noPaymentRequired missing checkoutId blocks submit via shouldAllowV2NoPaymentSubmit', () => {
    expect(
      shouldAllowV2NoPaymentSubmit({
        checkoutSessionV2Enabled: true,
        noPaymentRequired: true,
        checkoutId: null
      })
    ).toEqual({ allowed: false, reason: 'missing_checkout_id' });
    expect(V2_NO_PAYMENT_MISSING_CHECKOUT_MESSAGE).toContain('refresh payment');
  });

  it('shouldAllowV2NoPaymentSubmit allows submit with server checkoutId', () => {
    expect(
      shouldAllowV2NoPaymentSubmit({
        checkoutSessionV2Enabled: true,
        noPaymentRequired: true,
        checkoutId: 'chk_srv_no_pay'
      })
    ).toEqual({ allowed: true, reason: null, checkoutId: 'chk_srv_no_pay' });
  });

  it('V2 successful no-payment booking clears V2 storage', () => {
    writeCheckoutSessionV2Storage({
      checkoutId: 'chk_srv_no_pay',
      commercialBoundaryKey: BOUNDARY,
      quoteSnapshotHash: 'hash_no_pay',
      sessionVersion: 2,
      canonicalPaymentIntentId: null,
      clientSecretPresent: false,
      voucherRedemptionId: 'red_full',
      stripeAmountCents: 0,
      noPaymentRequired: true
    });
    clearCheckoutStorageAfterSuccessfulBooking({ checkoutSessionV2Enabled: true });
    expect(sessionStorage.getItem(CHECKOUT_SESSION_V2_STORAGE_KEY)).toBeNull();
  });

  it('legacy full voucher create payload has no flowVersion requirement', () => {
    const payload = buildNoPaymentCreatePayload({
      voucherRedemptionId: 'red_legacy',
      appliedVoucherCode: 'LEGACYGIFT'
    });
    expect(payload.flowVersion).toBeUndefined();
    expect(payload.voucherRedemptionId).toBe('red_legacy');
    expect(payload.paymentIntentId).toBeUndefined();
  });

  it('shouldBlockCardPaymentPrecheck allows V2 noPaymentRequired below €0.50', () => {
    expect(
      shouldBlockCardPaymentPrecheck(
        { totalPrice: 0 },
        { noPaymentRequired: true, fullVoucherCoverage: false, checkoutSessionV2Enabled: true }
      )
    ).toBe(false);
  });

  it('shouldBlockCardPaymentPrecheck still blocks legacy below €0.50', () => {
    expect(
      shouldBlockCardPaymentPrecheck(
        { totalPrice: 0.1 },
        { noPaymentRequired: true, fullVoucherCoverage: false, checkoutSessionV2Enabled: false }
      )
    ).toBe(true);
  });

  it('mapCreateBookingErrorMessage uses V2 restart message for CHECKOUT_SESSION_EXPIRED', () => {
    expect(
      mapCreateBookingErrorMessage(
        { response: { data: { error: { code: 'CHECKOUT_SESSION_EXPIRED' } } } },
        'fallback'
      )
    ).toBe(V2_CHECKOUT_RESTART_MESSAGE);
  });

  it('mapCreateBookingErrorMessage uses V2 retry message for SUPERSEDED_PAYMENT_INTENT', () => {
    expect(
      mapCreateBookingErrorMessage(
        { response: { data: { code: 'SUPERSEDED_PAYMENT_INTENT' } } },
        'fallback'
      )
    ).toBe(V2_CHECKOUT_RETRY_PAYMENT_MESSAGE);
  });
});
