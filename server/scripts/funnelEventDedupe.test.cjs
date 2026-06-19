'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildQuoteReceivedDedupeKey,
  buildQuoteFailedDedupeKey,
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
