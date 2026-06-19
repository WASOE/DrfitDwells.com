'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildQuoteReceivedDedupeKey,
  buildQuoteFailedDedupeKey,
  buildCheckoutStartedDedupeKey,
  resolveFunnelIdentity
} = require('../services/conversion/funnelEventDedupe');

test('resolveFunnelIdentity prefers session over visitor', () => {
  const identity = resolveFunnelIdentity('session-a', 'visitor-b');
  assert.equal(identity.kind, 'session');
  assert.equal(identity.value, 'session-a');
});

test('quote_received uses different keys for different sessions with same commercial params', () => {
  const base = {
    entityType: 'cabin',
    entityId: 'abc123',
    checkInDateOnly: '2026-07-01',
    checkOutDateOnly: '2026-07-05',
    adults: 2,
    children: 0,
    priceCents: 50000,
    promoCode: 'SAVE10'
  };
  const keyA = buildQuoteReceivedDedupeKey({ ...base, sessionKey: 'sess-a' });
  const keyB = buildQuoteReceivedDedupeKey({ ...base, sessionKey: 'sess-b' });
  assert.notEqual(keyA, keyB);
});

test('quote_received dedupes same session and commercial snapshot', () => {
  const base = {
    sessionKey: 'sess-a',
    entityType: 'cabin',
    entityId: 'abc123',
    checkInDateOnly: '2026-07-01',
    checkOutDateOnly: '2026-07-05',
    adults: 2,
    children: 0,
    priceCents: 50000
  };
  const keyA = buildQuoteReceivedDedupeKey(base);
  const keyB = buildQuoteReceivedDedupeKey(base);
  assert.equal(keyA, keyB);
});

test('quote_received orphan keys are unique per call', () => {
  const base = {
    entityType: 'cabin',
    entityId: 'abc123',
    checkInDateOnly: '2026-07-01',
    checkOutDateOnly: '2026-07-05',
    adults: 2,
    children: 0,
    priceCents: 50000
  };
  const keyA = buildQuoteReceivedDedupeKey(base);
  const keyB = buildQuoteReceivedDedupeKey(base);
  assert.notEqual(keyA, keyB);
  assert.match(keyA, /^qr:orphan:/);
});

test('quote_failed orphan keys are unique per call', () => {
  const base = {
    entityType: 'cabin',
    entityId: 'abc123',
    checkInDateOnly: '2026-07-01',
    checkOutDateOnly: '2026-07-05',
    quoteFailureClass: 'unavailable'
  };
  const keyA = buildQuoteFailedDedupeKey(base);
  const keyB = buildQuoteFailedDedupeKey(base);
  assert.notEqual(keyA, keyB);
});

test('checkout_started dedupes by checkoutId when present', () => {
  const base = {
    sessionKey: 'sess-a',
    checkoutId: 'chk-123',
    entityType: 'cabin',
    entityId: 'abc',
    checkInDateOnly: '2026-07-01',
    checkOutDateOnly: '2026-07-05'
  };
  const keyA = buildCheckoutStartedDedupeKey(base);
  const keyB = buildCheckoutStartedDedupeKey(base);
  assert.equal(keyA, keyB);
  assert.equal(keyA, 'cs:sess-a:chk-123');
});

test('checkout_started falls back to stay identity without checkoutId', () => {
  const key = buildCheckoutStartedDedupeKey({
    sessionKey: 'sess-a',
    entityType: 'cabinType',
    entityId: 'type-1',
    checkInDateOnly: '2026-07-01',
    checkOutDateOnly: '2026-07-05'
  });
  assert.equal(key, 'cs:sess-a:cabinType:type-1:2026-07-01:2026-07-05');
});

test('checkout_started keys differ across checkout sessions', () => {
  const base = {
    sessionKey: 'sess-a',
    entityType: 'cabin',
    entityId: 'abc',
    checkInDateOnly: '2026-07-01',
    checkOutDateOnly: '2026-07-05'
  };
  const keyA = buildCheckoutStartedDedupeKey({ ...base, checkoutId: 'chk-1' });
  const keyB = buildCheckoutStartedDedupeKey({ ...base, checkoutId: 'chk-2' });
  assert.notEqual(keyA, keyB);
});
