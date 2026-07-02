import { describe, expect, it } from 'vitest';
import { PREVIEW_EXAMPLE } from '@shared/giftVoucher/cardCopy';
import {
  buildSubmitPayload,
  createInitialBuilderState,
  payloadContainsPreviewExampleStrings,
  validateBuilderState
} from './giftVoucherBuilderState';

describe('giftVoucherBuilderState payload separation', () => {
  it('pristine state fails validation and produces no submittable payload', () => {
    const state = createInitialBuilderState('en');
    const validation = validateBuilderState(state, { scheduledDeliveryEnabled: true });
    expect(validation.ok).toBe(false);

    const payload = buildSubmitPayload(
      state,
      { purchaseRequestId: 'gvr_test_pristine' },
      { scheduledDeliveryEnabled: true }
    );
    expect(payload).toBeNull();
  });

  it('filled state payload contains zero PREVIEW_EXAMPLE strings', () => {
    const state = {
      ...createInitialBuilderState('en'),
      buyerName: 'Maria Santos',
      buyerEmail: 'maria@example.com',
      recipientName: 'Peter Novak',
      recipientEmail: 'peter@example.com',
      message: 'Take a slow weekend when you can.',
      termsAccepted: true
    };

    const validation = validateBuilderState(state);
    expect(validation.ok).toBe(true);

    const payload = buildSubmitPayload(state, { purchaseRequestId: 'gvr_test_filled' });
    expect(payload).not.toBeNull();
    expect(payloadContainsPreviewExampleStrings(payload)).toBe(false);
    expect(payload.recipientName).not.toBe(PREVIEW_EXAMPLE.recipientName);
    expect(payload.buyerName).not.toBe(PREVIEW_EXAMPLE.buyerName);
    expect(payload.message).not.toBe(PREVIEW_EXAMPLE.message.en);
    expect(payload.message).not.toBe(PREVIEW_EXAMPLE.message.bg);
  });
});
