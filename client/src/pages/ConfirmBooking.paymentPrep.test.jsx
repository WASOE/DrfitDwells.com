/**
 * Frontend checkout: optional consents removed; payment prep error mapping.
 * Run: cd client && npm test -- --run src/pages/ConfirmBooking.paymentPrep.test.jsx
 */
import { describe, it, expect } from 'vitest';
import {
  buildFinalizeIntentClientPayload,
  mapPaymentPreparationErrorMessage,
  shouldRetryPaymentPreparation,
  shouldPersistFinalizeIntent
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
      shouldRetryPaymentPreparation({ response: { status: 503, data: { code: 'FINALIZE_INTENT_REQUIRED' } } })
    ).toBe(true);
    expect(
      shouldRetryPaymentPreparation({ response: { status: 400, data: { code: 'FINALIZE_INTENT_INVALID' } } })
    ).toBe(false);
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
