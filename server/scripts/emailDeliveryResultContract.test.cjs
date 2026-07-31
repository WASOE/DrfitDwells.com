'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyEmailDeliveryResult,
  isAuthoritativeConfirmationDelivery
} = require('../services/email/emailDeliveryResultContract');

test('success:true + method:sent is authoritative; messageId optional', () => {
  const withId = classifyEmailDeliveryResult({
    success: true,
    method: 'sent',
    messageId: 'msg_1'
  });
  assert.equal(withId.classification, 'provider_sent');
  assert.equal(withId.authoritativeDelivered, true);
  assert.equal(withId.providerMessageId, 'msg_1');
  assert.equal(isAuthoritativeConfirmationDelivery(withId), true);

  const noId = classifyEmailDeliveryResult({ success: true, method: 'sent' });
  assert.equal(noId.authoritativeDelivered, true);
  assert.equal(noId.providerMessageId, null);
});

test('lifecycle nested sendResult.method sent is authoritative', () => {
  const c = classifyEmailDeliveryResult({
    success: true,
    sendStatus: 'success',
    sendResult: { success: true, method: 'sent', messageId: 'nested' }
  });
  assert.equal(c.authoritativeDelivered, true);
  assert.equal(c.providerMessageId, 'nested');
});

test('method logged never succeeds', () => {
  const c = classifyEmailDeliveryResult({ success: true, method: 'logged' });
  assert.equal(c.classification, 'logged_fallback');
  assert.equal(c.authoritativeDelivered, false);
  assert.equal(c.retryable, true);
});

test('method unavailable never succeeds', () => {
  const c = classifyEmailDeliveryResult({
    success: false,
    method: 'unavailable',
    error: 'SMTP transport unavailable'
  });
  assert.equal(c.classification, 'unavailable');
  assert.equal(c.authoritativeDelivered, false);
  assert.equal(c.retryable, true);
});

test('generic success without method sent fails closed', () => {
  const c = classifyEmailDeliveryResult({ success: true, sendStatus: 'success' });
  assert.equal(c.authoritativeDelivered, false);
  assert.equal(c.classification, 'unknown');
  assert.equal(c.retryable, true);
  assert.match(c.reason, /success_without_method_sent/);
});

test('malformed result fails closed', () => {
  for (const bad of [null, undefined, 'x', 1]) {
    const c = classifyEmailDeliveryResult(bad);
    assert.equal(c.authoritativeDelivered, false);
    assert.equal(c.retryable, true);
  }
});

test('accepted/rejected arrays are not required', () => {
  const c = classifyEmailDeliveryResult({
    success: true,
    method: 'sent',
    accepted: undefined,
    rejected: undefined
  });
  assert.equal(c.authoritativeDelivered, true);
});

test('retryable failure classification', () => {
  const c = classifyEmailDeliveryResult({
    success: false,
    method: 'failed',
    error: 'relay said no'
  });
  assert.equal(c.classification, 'smtp_rejected');
  assert.equal(c.retryable, true);
  assert.equal(c.authoritativeDelivered, false);
});

test('ambiguous classification', () => {
  const c = classifyEmailDeliveryResult({ ambiguous: true, reason: 'timeout' });
  assert.equal(c.classification, 'ambiguous');
  assert.equal(c.ambiguous, true);
  assert.equal(c.authoritativeDelivered, false);
});

test('skipped duplicate with definitive prior evidence', () => {
  const c = classifyEmailDeliveryResult(
    { success: true, method: 'skipped-duplicate' },
    { hasDefinitivePriorDelivery: true }
  );
  assert.equal(c.classification, 'skipped_duplicate');
  assert.equal(c.adoptPriorDelivery, true);
  assert.equal(c.authoritativeDelivered, false);
});

test('skipped duplicate without prior evidence', () => {
  const c = classifyEmailDeliveryResult({
    success: true,
    method: 'skipped-duplicate'
  });
  assert.equal(c.adoptPriorDelivery, undefined);
  assert.equal(c.retryable, true);
  assert.equal(c.authoritativeDelivered, false);
});

test('deterministic provider-shaped test fixture', () => {
  const fixture = {
    success: true,
    method: 'sent',
    messageId: 'msg_test_1',
    sendStatus: 'success',
    sendResult: { success: true, method: 'sent', messageId: 'msg_test_1' }
  };
  const c = classifyEmailDeliveryResult(fixture);
  assert.equal(c.classification, 'provider_sent');
  assert.equal(c.authoritativeDelivered, true);
});
