'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CLIENT_ERROR_EVENT_TYPES
} = require('../models/ClientErrorEvent');
const {
  isPaymentResilienceEventType,
  PAYMENT_RESILIENCE_EVENT_TYPES
} = require('../services/conversion/funnelEventConstants');
const { buildPaymentResilienceDedupeKey } = require('../services/conversion/funnelEventDedupe');

test('client-error allowlist matches funnel payment resilience types', () => {
  assert.deepEqual([...CLIENT_ERROR_EVENT_TYPES], [...PAYMENT_RESILIENCE_EVENT_TYPES]);
  for (const type of CLIENT_ERROR_EVENT_TYPES) {
    assert.equal(isPaymentResilienceEventType(type), true);
  }
});

test('payment resilience dedupe key is stable per checkoutId+type', () => {
  const a = buildPaymentResilienceDedupeKey({
    eventType: 'payment_element_slow',
    checkoutId: 'chk_1',
    sessionKey: 'sess_1'
  });
  const b = buildPaymentResilienceDedupeKey({
    eventType: 'payment_element_slow',
    checkoutId: 'chk_1',
    sessionKey: 'sess_1'
  });
  assert.equal(a, b);
  assert.match(a, /^pr:payment_element_slow:chk_1:/);
});
