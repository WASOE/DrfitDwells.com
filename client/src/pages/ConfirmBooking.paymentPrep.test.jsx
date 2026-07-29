/**
 * Frontend checkout: optional consents removed; payment prep error mapping.
 * Run: cd client && npm test -- --run src/pages/ConfirmBooking.paymentPrep.test.jsx
 */
import { describe, it, expect } from 'vitest';
import {
  buildFinalizeIntentClientPayload,
  mapPaymentPreparationErrorMessage,
  shouldRetryPaymentPreparation,
  shouldPersistFinalizeIntent,
  adoptCheckoutIdentityFromError,
  resolveFinalizeIntentInvalidFocusTarget
} from './ConfirmBooking';
import {
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
  LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT,
  LEGAL_ACCEPTANCE_TERMS_VERSION,
  LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION
} from '../constants/legalAcceptance';

describe('ConfirmBooking payment preparation helpers', () => {
  const formData = {
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.test',
    phone: '+359888000111',
    specialRequests: '',
    agreedToTerms: true,
    agreedToActivityRisk: true,
    quoteDeliveryRequested: true,
    bookingReminderConsent: true,
    marketingConsent: true
  };

  it('35. optional consent fields submitted internally are false', () => {
    const payload = buildFinalizeIntentClientPayload({
      formData,
      selectedExpKeys: new Set(),
      language: 'en'
    });
    expect(payload.consents).toEqual({
      quoteDeliveryRequested: false,
      bookingReminderConsent: false,
      marketingConsent: false
    });
  });

  it('23. legal acceptance snapshots use shared constants', () => {
    const payload = buildFinalizeIntentClientPayload({
      formData,
      selectedExpKeys: new Set(),
      language: 'en'
    });
    expect(payload.legalAcceptance.checkbox1TextSnapshot).toBe(LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT);
    expect(payload.legalAcceptance.checkbox2TextSnapshot).toBe(LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT);
    expect(payload.legalAcceptance.termsVersion).toBe(LEGAL_ACCEPTANCE_TERMS_VERSION);
    expect(payload.legalAcceptance.activityRiskVersion).toBe(LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION);
    expect(payload.guestInfo.phone).toBe('+359888000111');
    expect(payload.guestInfo.phoneNumber).toBeUndefined();
  });

  it('29-30. raw FINALIZE_INTENT_MISSING / internal messages are never returned', () => {
    const msg = mapPaymentPreparationErrorMessage(
      {
        response: {
          data: {
            code: 'FINALIZE_INTENT_MISSING',
            message: 'finalizeIntent is required before creating a PaymentIntent'
          }
        }
      },
      'fallback'
    );
    expect(msg).not.toMatch(/finalizeIntent/i);
    expect(msg).not.toMatch(/FINALIZE_INTENT/);
    expect(msg).toMatch(/prepare the secure payment form/i);

    const invalid = mapPaymentPreparationErrorMessage(
      {
        response: {
          data: {
            code: 'FINALIZE_INTENT_INVALID',
            message: 'guestInfo.firstName is required'
          }
        }
      },
      'fallback'
    );
    expect(invalid).not.toMatch(/guestInfo\.firstName/);
    expect(invalid).toMatch(/guest details/i);
  });

  it('27. transient failures are retryable; validation is not', () => {
    expect(
      shouldRetryPaymentPreparation({ response: { status: 503, data: { code: 'UPSTREAM_TIMEOUT' } } })
    ).toBe(true);
    expect(
      shouldRetryPaymentPreparation({
        response: {
          status: 409,
          data: { code: 'FINALIZE_INTENT_REQUIRED', details: { checkoutId: 'chk_adopt_me' } }
        }
      })
    ).toBe(true);
    expect(
      shouldRetryPaymentPreparation({
        response: { status: 409, data: { code: 'FINALIZE_INTENT_REQUIRED' } }
      })
    ).toBe(false);
    expect(
      shouldRetryPaymentPreparation({ response: { status: 400, data: { code: 'FINALIZE_INTENT_INVALID' } } })
    ).toBe(false);
    expect(
      shouldRetryPaymentPreparation({
        response: { status: 409, data: { code: 'FINALIZE_INTENT_SESSION_VERSION_CONFLICT' } }
      })
    ).toBe(false);
  });

  it('11. adopts checkoutId from safe error details before retry', () => {
    const adopted = adoptCheckoutIdentityFromError(
      {
        response: {
          data: {
            code: 'FINALIZE_INTENT_REQUIRED',
            details: { checkoutId: 'chk_server_minted', sessionVersion: 2 }
          }
        }
      },
      { checkoutId: null, sessionVersion: 1 }
    );
    expect(adopted.checkoutId).toBe('chk_server_minted');
    expect(adopted.sessionVersion).toBe(2);
    expect(adopted.adopted).toBe(true);
  });

  it('focuses the invalid phone field instead of generic-only handling', () => {
    expect(
      resolveFinalizeIntentInvalidFocusTarget({
        response: { data: { details: { field: 'guestInfo.phone' } } }
      })
    ).toBe('confirm-phone');
  });

  it('persist flag helper stays aligned for strict mode', () => {
    expect(
      shouldPersistFinalizeIntent({
        checkoutSessionV2Enabled: true,
        persistEnabled: true,
        requiredForPiEnabled: true
      })
    ).toBe(true);
  });
});
