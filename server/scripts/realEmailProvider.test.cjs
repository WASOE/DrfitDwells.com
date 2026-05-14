/**
 * Batch 9 — realEmailProvider contract tests.
 *
 * Run: npm run test:email-provider-adapter (from server/)
 *
 * Covers:
 *   - Provider declares shadow:false and PROVIDER_NAME='postmark'.
 *   - Calls only the public `emailService.sendEmail` method.
 *   - Always passes skipIdempotencyWindow:true and omitBodyFromLogs:true.
 *   - Stamps dispatch:<id> Postmark tag + Metadata.dispatchId.
 *   - Rejects calls without dispatchId / with a non-ObjectId dispatchId.
 *   - Translates emailService return shapes into provider-contract throws.
 *   - Adapter source contains no postmark/nodemailer/axios/booking-lifecycle imports.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');

const emailService = require('../services/emailService');
const realProvider = require('../services/messaging/providers/realEmailProvider');

function stubSend(fn) {
  const original = emailService.sendEmail.bind(emailService);
  emailService.sendEmail = fn;
  return () => { emailService.sendEmail = original; };
}

const sampleInput = () => ({
  to: 'guest@example.com',
  subject: 'Your arrival to The Cabin',
  html: '<p>Hello Ada</p>',
  dispatchId: new mongoose.Types.ObjectId(),
  bookingId: new mongoose.Types.ObjectId(),
  ruleKey: 'arrival_instructions_pre_arrival_cabin',
  templateKey: 'arrival_3d_the_cabin'
});

test('realEmailProvider declares postmark, shadow:false', () => {
  assert.equal(realProvider.PROVIDER_NAME, 'postmark');
  assert.equal(realProvider.shadow, false);
  assert.equal(typeof realProvider.sendEmail, 'function');
});

test('sendEmail: calls emailService.sendEmail with expected shape', async () => {
  const input = sampleInput();
  let captured = null;
  const restore = stubSend(async (params) => {
    captured = params;
    return { success: true, method: 'sent', messageId: 'pm_unit_001' };
  });
  let result;
  try {
    result = await realProvider.sendEmail(input);
  } finally {
    restore();
  }
  assert.deepEqual(result, {
    providerName: 'postmark',
    providerMessageId: 'pm_unit_001',
    providerStatus: 'sent',
    shadow: false
  });
  assert.equal(captured.to, 'guest@example.com');
  assert.equal(captured.subject, 'Your arrival to The Cabin');
  assert.equal(captured.html, '<p>Hello Ada</p>');
  assert.ok(typeof captured.text === 'string' && captured.text.length > 0, 'plain-text body must be derived');
  assert.equal(captured.skipIdempotencyWindow, true);
  assert.equal(captured.omitBodyFromLogs, true);
  assert.equal(captured.postmarkTag, `dispatch:${String(input.dispatchId)}`);
  assert.deepEqual(captured.postmarkMetadata, {
    dispatchId: String(input.dispatchId),
    bookingId: String(input.bookingId),
    ruleKey: input.ruleKey,
    templateKey: input.templateKey,
    channel: 'email'
  });
  // The legacy trigger string is unique per dispatch so the legacy
  // in-memory window cannot match a previous (bookingId, trigger).
  assert.match(captured.trigger, /^message_automation:arrival_instructions_pre_arrival_cabin:email:[0-9a-fA-F]{24}$/);
});

test('sendEmail: returns shadow:false on success', async () => {
  const restore = stubSend(async () => ({ success: true, method: 'sent', messageId: 'mid' }));
  try {
    const out = await realProvider.sendEmail(sampleInput());
    assert.equal(out.shadow, false);
  } finally {
    restore();
  }
});

test('sendEmail: rejects without dispatchId', async () => {
  await assert.rejects(realProvider.sendEmail({
    to: 'g@example.com', subject: 's', html: '<p/>'
  }), (err) => err.code === 'invalid_input' && err.retryable === false);
});

test('sendEmail: rejects non-ObjectId dispatchId', async () => {
  await assert.rejects(realProvider.sendEmail({
    ...sampleInput(),
    dispatchId: 'not-a-hex-id'
  }), (err) => err.code === 'invalid_input' && err.retryable === false);
});

test('sendEmail: rejects invalid recipient', async () => {
  await assert.rejects(realProvider.sendEmail({
    ...sampleInput(), to: 'not-an-email'
  }), (err) => err.code === 'invalid_recipient' && err.retryable === false);
});

test('sendEmail: emailService method "logged" → throws transport_not_configured (non-retryable)', async () => {
  const restore = stubSend(async () => ({ success: true, method: 'logged' }));
  try {
    await assert.rejects(realProvider.sendEmail(sampleInput()), (err) =>
      err.code === 'transport_not_configured' && err.retryable === false
    );
  } finally {
    restore();
  }
});

test('sendEmail: emailService method "unavailable" → throws provider_unavailable (non-retryable in Batch 9)', async () => {
  const restore = stubSend(async () => ({ success: false, method: 'unavailable', error: 'SMTP transport unavailable' }));
  try {
    await assert.rejects(realProvider.sendEmail(sampleInput()), (err) =>
      err.code === 'provider_unavailable' && err.retryable === false
    );
  } finally {
    restore();
  }
});

test('sendEmail: emailService method "failed" → throws provider_throw (non-retryable)', async () => {
  const restore = stubSend(async () => ({ success: false, method: 'failed', error: 'smtp 500' }));
  try {
    await assert.rejects(realProvider.sendEmail(sampleInput()), (err) =>
      err.code === 'provider_throw' && err.retryable === false
    );
  } finally {
    restore();
  }
});

test('sendEmail: emailService method "skipped-duplicate" → throws skipped_legacy_window (defensive)', async () => {
  const restore = stubSend(async () => ({ success: true, method: 'skipped-duplicate' }));
  try {
    await assert.rejects(realProvider.sendEmail(sampleInput()), (err) =>
      err.code === 'skipped_legacy_window' && err.retryable === false
    );
  } finally {
    restore();
  }
});

test('sendEmail: emailService throws unexpectedly → throws provider_throw (non-retryable)', async () => {
  const restore = stubSend(async () => { throw new Error('kaboom'); });
  try {
    await assert.rejects(realProvider.sendEmail(sampleInput()), (err) =>
      err.code === 'provider_throw' && err.retryable === false
    );
  } finally {
    restore();
  }
});

test('invariant: realEmailProvider source has no forbidden imports and no EmailEvent/MessageDeliveryEvent references', () => {
  function stripComments(src) {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\s\/\/[^\n]*$/gm, '');
  }
  const src = stripComments(fs.readFileSync(
    path.join(__dirname, '..', 'services/messaging/providers/realEmailProvider.js'), 'utf8'
  ));
  const banned = [
    /require\(\s*['"]axios['"]\s*\)/,
    /require\(\s*['"]nodemailer['"]\s*\)/,
    /require\(\s*['"]postmark['"]\s*\)/,
    /require\(\s*['"]twilio['"]\s*\)/,
    /require\(\s*['"][^'"]*bookingLifecycleEmailService['"]\s*\)/,
    /require\(\s*['"][^'"]*giftVoucherEmailService['"]\s*\)/,
    /require\(\s*['"][^'"]*communicationWriteService['"]\s*\)/,
    /require\(\s*['"][^'"]*creatorPortalEmail['"]\s*\)/,
    /require\(\s*['"][^'"]*EmailEvent['"]\s*\)/,
    /require\(\s*['"][^'"]*MessageDeliveryEvent['"]\s*\)/
  ];
  for (const pat of banned) {
    assert.equal(pat.test(src), false, `realEmailProvider must not include ${pat.source}`);
  }
  // It MUST require emailService — the only allowed bridge.
  assert.ok(/require\(\s*['"]\.\.\/\.\.\/emailService['"]\s*\)/.test(src),
    'realEmailProvider must require ../../emailService');
});
