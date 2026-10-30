import { describe, expect, it } from 'vitest';
import {
  customerMessageForCheckoutCapability,
  evaluateCheckoutCapabilityCompatibility
} from './checkoutCapabilityHandshake';

const serverContract = {
  success: true,
  checkoutSessionV2: true,
  finalizeIntentPersist: true,
  finalizeIntentRequiredForPi: true,
  requiresFinalizeIntentPayload: true,
  paymentContractVersion: 'checkout-payment-v2-finalize-1'
};

const alignedClient = {
  checkoutSessionV2: true,
  finalizeIntentPersist: true,
  finalizeIntentRequiredForPi: true,
  paymentContractVersion: 'checkout-payment-v2-finalize-1'
};

describe('checkout capability handshake', () => {
  it('accepts an aligned Checkout V2 contract and never asks for a reload', () => {
    const result = evaluateCheckoutCapabilityCompatibility(serverContract, alignedClient);
    expect(result).toEqual({ ok: true, reason: null, shouldReload: false });
  });

  it('blocks when the API has finalize persistence disabled', () => {
    const result = evaluateCheckoutCapabilityCompatibility(
      { ...serverContract, finalizeIntentPersist: false },
      alignedClient
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('server_finalize_intent_persist_disabled');
    expect(result.shouldReload).toBe(false);
    expect(customerMessageForCheckoutCapability(result)).toMatch(/temporarily unavailable/i);
  });

  it('blocks when the API does not require finalize intent but the client does', () => {
    const result = evaluateCheckoutCapabilityCompatibility(
      { ...serverContract, finalizeIntentRequiredForPi: false, requiresFinalizeIntentPayload: false },
      alignedClient
    );
    expect(result.reason).toBe('server_finalize_intent_required_disabled');
    expect(result.shouldReload).toBe(false);
  });

  it('keeps stale-client reasons without reloading', () => {
    const missingV2 = evaluateCheckoutCapabilityCompatibility(serverContract, {
      ...alignedClient,
      checkoutSessionV2: false
    });
    expect(missingV2.reason).toBe('stale_client_missing_v2');
    expect(missingV2.shouldReload).toBe(false);

    const legacy = evaluateCheckoutCapabilityCompatibility(serverContract, {
      checkoutSessionV2: false,
      finalizeIntentPersist: false,
      finalizeIntentRequiredForPi: false,
      paymentContractVersion: 'checkout-payment-v2-finalize-1'
    });
    expect(legacy.reason).toBe('stale_client_missing_finalize_support');
    expect(customerMessageForCheckoutCapability(legacy)).toMatch(/refresh once/i);
  });

  it('flags a payment contract version mismatch', () => {
    const result = evaluateCheckoutCapabilityCompatibility(
      { ...serverContract, paymentContractVersion: 'checkout-payment-v1' },
      alignedClient
    );
    expect(result.reason).toBe('payment_contract_version_mismatch');
    expect(result.shouldReload).toBe(false);
  });
});
