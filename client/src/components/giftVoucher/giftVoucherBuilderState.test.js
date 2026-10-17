import { describe, expect, it, vi } from 'vitest';
import { PREVIEW_EXAMPLE } from '@shared/giftVoucher/cardCopy';
import {
  buildSubmitPayload,
  buildPreviewVoucher,
  CARD_OCCASIONS,
  CARD_TEMPLATE_IDS,
  computeEffectiveAmountCents,
  createInitialBuilderState,
  getScheduledDeliveryDateBounds,
  isValidEmail,
  POSTAL_MAX_LENGTHS,
  PRESET_AMOUNTS,
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

  function validState(changes = {}) {
    return {
      ...createInitialBuilderState('en'),
      buyerName: ' Maria Santos ', buyerEmail: 'maria@example.com',
      recipientName: ' Peter Novak ', recipientEmail: 'peter@example.com',
      termsAccepted: true, ...changes
    };
  }

  const postal = {
    deliveryOption: 'postal', addressLine1: '10 Forest Road', addressLine2: '',
    city: 'Sofia', postalCode: '1000', country: 'Bulgaria'
  };

  describe('production voucher builder contract', () => {
    it.each(PRESET_AMOUNTS)('accepts preset credit %i cents including EUR500', (amountOriginalCents) => {
      const state = validState({ amountOriginalCents });
      expect(buildSubmitPayload(state).amountOriginalCents).toBe(amountOriginalCents);
    });

    it.each([['15', 1500], ['15.01', 1501], ['50.10', 5010], ['10000.01', 1000001], ['0.29', 29]])(
      'converts custom %s to exact cents without silent rounding', (input, cents) => {
        expect(computeEffectiveAmountCents(validState({ useCustomAmount: true, customAmountEur: input }))).toBe(cents);
      }
    );

    it.each(['', ' ', '15.001', '15.999', 'NaN', 'Infinity', '-15', '1e3', '90071992547410'])(
      'rejects invalid precision or unrepresentable amount %s', (customAmountEur) => {
        const state = validState({ useCustomAmount: true, customAmountEur });
        expect(validateBuilderState(state)).toMatchObject({ ok: false, code: 'WHOLE_AMOUNT' });
        expect(buildSubmitPayload(state)).toBeNull();
      }
    );

    it.each([0, 1499, -1500])('rejects below-minimum credit %i', (amountOriginalCents) => {
      expect(validateBuilderState(validState({ amountOriginalCents }))).toMatchObject({ code: 'AMOUNT_BELOW_MINIMUM' });
    });

    it('does not invent the prototype EUR10000 business cap', () => {
      expect(validateBuilderState(validState({ useCustomAmount: true, customAmountEur: '10000.01' })).ok).toBe(true);
    });

    it.each([NaN, Infinity, 1500.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid preset numeric value %s', (amountOriginalCents) => {
      expect(buildSubmitPayload(validState({ amountOriginalCents }))).toBeNull();
    });

    it('rejects a postal sum that cannot be represented safely', () => {
      expect(buildSubmitPayload(validState({ ...postal, amountOriginalCents: Number.MAX_SAFE_INTEGER }))).toBeNull();
    });

    it.each(['buyerName', 'recipientName'])('enforces trimmed required names and API maximum for %s', (field) => {
      expect(validateBuilderState(validState({ [field]: ' ' })).code).toBe('NAMES_REQUIRED');
      expect(validateBuilderState(validState({ [field]: 'a'.repeat(120) })).ok).toBe(true);
      expect(validateBuilderState(validState({ [field]: 'a'.repeat(121) })).code).toBe('NAMES_TOO_LONG');
    });

    it('accepts a 250-character message, rejects 251 and omits blank messages', () => {
      expect(buildSubmitPayload(validState({ message: 'a'.repeat(250) })).message).toHaveLength(250);
      expect(validateBuilderState(validState({ message: 'a'.repeat(251) })).code).toBe('MESSAGE_TOO_LONG');
      expect(buildSubmitPayload(validState({ message: '  ' }))).not.toHaveProperty('message');
    });

    it.each(['bad', 'a@b', 'a@@example.com', 'a b@example.com', '.a@example.com', 'a..b@example.com', 'a@-example.com', 'a@example..com', 'a@example.c', 'a@example.123', 'a<b@example.com', `${'a'.repeat(65)}@example.com`, `${'я'.repeat(33)}@example.com`])(
      'rejects malformed email %s', (email) => {
        expect(isValidEmail(email)).toBe(false);
        expect(validateBuilderState(validState({ buyerEmail: email })).code).toBe('BUYER_EMAIL');
        expect(validateBuilderState(validState({ recipientEmail: email })).code).toBe('RECIPIENT_EMAIL');
        expect(validateBuilderState(validState({ ...postal, recipientEmail: email })).code).toBe('RECIPIENT_EMAIL');
      }
    );

    it.each(['user+gift@example.com', ' first.last@example.co.uk ', 'име@пример.бг', '"first last"@example.com', '"first@last"@example.com', 'user@xn--e1afmkfd.xn--p1ai'])('accepts normal API-compatible email %s', (email) => {
      expect(isValidEmail(email)).toBe(true);
    });

    it('omits unused recipient email for send_to_buyer and permits missing postal email', () => {
      expect(buildSubmitPayload(validState({ deliveryOption: 'send_to_buyer', recipientEmail: '' }))).not.toHaveProperty('recipientEmail');
      expect(buildSubmitPayload(validState({ ...postal, recipientEmail: '' }))).not.toHaveProperty('recipientEmail');
    });

    it.each(Object.entries(POSTAL_MAX_LENGTHS))('enforces API address length for %s', (field, max) => {
      expect(validateBuilderState(validState({ ...postal, [field]: 'a'.repeat(max) })).ok).toBe(true);
      expect(validateBuilderState(validState({ ...postal, [field]: 'a'.repeat(max + 1) })).code).toBe('POSTAL_TOO_LONG');
    });

    it.each(['addressLine1', 'city', 'postalCode', 'country'])('requires nonblank postal %s', (field) => {
      expect(validateBuilderState(validState({ ...postal, [field]: ' ' })).code).toBe('POSTAL_REQUIRED');
    });

    it('sends postal address and optional email without client pricing fields', () => {
      const payload = buildSubmitPayload(validState({ ...postal, addressLine1: ' 10 Forest Road ' }), {
        purchaseRequestId: 'gvr_payload_contract', attribution: { referralCode: 'gift' }
      });
      expect(payload).toMatchObject({
        amountOriginalCents: 5000, currency: 'EUR', buyerName: 'Maria Santos', recipientName: 'Peter Novak',
        recipientEmail: 'peter@example.com', purchaseRequestId: 'gvr_payload_contract', termsAccepted: true,
        termsVersion: 'v1', attribution: { referralCode: 'gift' },
        deliveryAddress: { addressLine1: '10 Forest Road', addressLine2: null, city: 'Sofia', postalCode: '1000', country: 'Bulgaria' }
      });
      for (const key of ['totalDueCents', 'physicalCardFeeCents', 'expiresAt', 'code']) expect(payload).not.toHaveProperty(key);
    });

    it.each(CARD_TEMPLATE_IDS)('preserves template %s across preview and payload', (cardTemplateId) => {
      const state = validState({ cardTemplateId });
      expect(buildPreviewVoucher(state, 5000).templateId).toBe(cardTemplateId);
      expect(buildSubmitPayload(state).cardTemplateId).toBe(cardTemplateId);
    });

    it.each(CARD_OCCASIONS)('preserves occasion %s across preview and payload', (cardOccasion) => {
      const state = validState({ cardOccasion, cardLocale: 'bg', message: 'Личен подарък' });
      expect(buildPreviewVoucher(state, 5000)).toMatchObject({ occasion: cardOccasion, locale: 'bg', message: 'Личен подарък' });
      expect(buildSubmitPayload(state)).toMatchObject({ cardOccasion, cardLocale: 'bg', message: 'Личен подарък' });
    });

    it.each([{ cardTemplateId: 'unknown' }, { cardOccasion: 'unknown' }, { cardLocale: 'fr' }])('rejects invalid customization %j', (changes) => {
      expect(validateBuilderState(validState(changes)).code).toBe('INVALID_CUSTOMIZATION_FIELD');
    });

    it('rejects unsupported delivery rather than producing a misleading payload', () => {
      expect(validateBuilderState(validState({ deliveryOption: 'manual' })).code).toBe('INVALID_DELIVERY_OPTION');
    });

    it('requires terms and both delivery-specific recipient emails', () => {
      expect(validateBuilderState(validState({ termsAccepted: false })).code).toBe('TERMS_NOT_ACCEPTED');
      for (const deliveryOption of ['recipient_now', 'scheduled']) {
        expect(validateBuilderState(validState({ deliveryOption, recipientEmail: '' }), { scheduledDeliveryEnabled: true }).code).toBe('RECIPIENT_EMAIL');
      }
    });

    it('gates scheduling and accepts exact shared date limits only', () => {
      const { minIso, maxIso } = getScheduledDeliveryDateBounds();
      const state = validState({ deliveryOption: 'scheduled', deliveryDate: minIso });
      expect(validateBuilderState(state).code).toBe('SCHEDULED_NOT_ENABLED');
      for (const deliveryDate of [minIso, maxIso]) {
        expect(buildSubmitPayload({ ...state, deliveryDate }, {}, { scheduledDeliveryEnabled: true }).deliveryDate).toBe(deliveryDate);
      }
      for (const deliveryDate of ['', '2026-02-30', 'not-a-date', '2000-01-01', '2099-01-01']) {
        expect(buildSubmitPayload({ ...state, deliveryDate }, {}, { scheduledDeliveryEnabled: true })).toBeNull();
      }
    });

    it('rejects an impossible in-window date rather than silently rolling it into another month', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
      try {
        expect(validateBuilderState(validState({ deliveryOption: 'scheduled', deliveryDate: '2026-02-30' }), {
          scheduledDeliveryEnabled: true
        }).code).toBe('INVALID_SCHEDULED_DELIVERY_DATE');
      } finally {
        vi.useRealTimers();
      }
    });
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
