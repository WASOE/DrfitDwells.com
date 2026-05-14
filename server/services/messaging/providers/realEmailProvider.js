'use strict';

/**
 * realEmailProvider (Batch 9)
 *
 * The real email adapter for the message-automation dispatcher. It is the
 * ONLY new-system code path that can produce an outbound email. It wraps the
 * existing public method `emailService.sendEmail(...)` and stamps each send
 * with a `dispatch:<dispatchId>` Postmark tag plus `Metadata.dispatchId` so
 * the webhook can later correlate Postmark delivery events to a
 * `MessageDispatch` row (and write a `MessageDeliveryEvent`, never an
 * `EmailEvent`).
 *
 * Hard contract — see docs/guest-message-automation/02_V1_SPEC.md §21 and
 * 03_IMPLEMENTATION_BATCHES.md Batch 9:
 *
 *   - Only requires `../../emailService` and `../../../utils/manualLifecycleResendContent`.
 *     No nodemailer, no postmark SDK, no axios, no `bookingLifecycleEmailService`,
 *     no `EmailEvent`, no `MessageDeliveryEvent`, no other models.
 *   - Calls ONLY the public method `emailService.sendEmail(...)`.
 *   - Always passes `skipIdempotencyWindow: true` and `omitBodyFromLogs: true`.
 *     The new DB-backed `MessageDispatch.idempotencyKey` is the authoritative
 *     duplicate guard; the legacy 10-min in-memory window is bypassed.
 *   - Requires `dispatchId`. The dispatcher pre-allocates this ObjectId and
 *     reserves a `MessageDispatch { status: 'pending' }` row BEFORE this
 *     adapter is called (outbox pattern).
 *   - In V1 every non-`sent` outcome (`logged`, `skipped-duplicate`,
 *     `unavailable`, `failed`) is a non-retryable throw. The dispatcher's
 *     real branch updates the pending row to `failed` and the job is
 *     terminally failed — no automatic retry of a real send.
 */

const emailService = require('../../emailService');
const { derivePlainTextFromHtml } = require('../../../utils/manualLifecycleResendContent');

const PROVIDER_NAME = 'postmark';

function clipForLog(text, max = 80) {
  if (typeof text !== 'string') return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function redactEmailForLog(addr) {
  if (typeof addr !== 'string') return '';
  return addr.replace(/(^.).*(@.*$)/, '$1***$2');
}

function throwInvalid(code, message) {
  throw Object.assign(new Error(message), { code, retryable: false });
}

function throwNonRetryable(code, message) {
  throw Object.assign(new Error(message), { code, retryable: false });
}

/**
 * Provider contract — input/output mirrors the shadow email provider so the
 * dispatcher's `attemptChannel` can hold a single shape per channel.
 *
 * Required input fields:
 *   - to:         lower-cased recipient email
 *   - subject:    rendered subject string
 *   - html:       rendered HTML body
 *   - dispatchId: pre-allocated Mongoose ObjectId (or 24-hex string)
 *
 * Optional input fields (used for Postmark metadata + trigger string):
 *   - bookingId, ruleKey, templateKey
 *
 * On success returns:
 *   { providerName: 'postmark', providerMessageId, providerStatus: 'sent', shadow: false }
 */
async function sendEmail(input) {
  if (!input || typeof input !== 'object') {
    throwInvalid('invalid_input', 'realEmailProvider: empty input');
  }
  const { to, subject, html, dispatchId, bookingId, ruleKey, templateKey } = input;

  if (!to || typeof to !== 'string' || !to.includes('@')) {
    throwInvalid('invalid_recipient', 'realEmailProvider: invalid recipient');
  }
  if (!subject || typeof subject !== 'string') {
    throwInvalid('invalid_input', 'realEmailProvider: missing subject');
  }
  if (!html || typeof html !== 'string') {
    throwInvalid('invalid_input', 'realEmailProvider: missing html body');
  }
  if (!dispatchId) {
    throwInvalid('invalid_input', 'realEmailProvider: missing dispatchId (outbox row must be reserved before send)');
  }

  const dispatchIdStr = String(dispatchId);
  if (!/^[0-9a-fA-F]{24}$/.test(dispatchIdStr)) {
    throwInvalid('invalid_input', 'realEmailProvider: dispatchId must be a 24-hex ObjectId');
  }

  const text = derivePlainTextFromHtml(html);

  const postmarkTag = `dispatch:${dispatchIdStr}`;
  const postmarkMetadata = {
    dispatchId: dispatchIdStr,
    bookingId: bookingId ? String(bookingId) : null,
    ruleKey: ruleKey || null,
    templateKey: templateKey || null,
    channel: 'email'
  };

  // One structured log per send. Body is not logged.
  console.log(JSON.stringify({
    source: 'messaging-real-provider',
    channel: 'email',
    providerName: PROVIDER_NAME,
    to: redactEmailForLog(to),
    subjectPreview: clipForLog(subject, 80),
    bookingId: bookingId ? String(bookingId) : null,
    ruleKey: ruleKey || null,
    dispatchId: dispatchIdStr,
    phase: 'sending'
  }));

  let result;
  try {
    result = await emailService.sendEmail({
      to,
      subject,
      html,
      text,
      // `trigger` is intentionally unique per dispatch attempt so the legacy
      // 10-min in-memory window cannot match a previous (bookingId, trigger).
      // The new DB-backed `MessageDispatch.idempotencyKey` is the authoritative
      // duplicate guard; `skipIdempotencyWindow: true` bypasses the legacy
      // window defensively per spec §21.
      trigger: `message_automation:${ruleKey || 'unknown'}:email:${dispatchIdStr}`,
      bookingId: bookingId || null,
      skipIdempotencyWindow: true,
      omitBodyFromLogs: true,
      postmarkTag,
      postmarkMetadata
    });
  } catch (err) {
    // `emailService.sendEmail` is not documented to throw, but if it does the
    // pending row cannot stay pending: treat as non-retryable.
    throwNonRetryable('provider_throw', `realEmailProvider: emailService threw: ${err?.message || String(err)}`);
  }

  if (result && result.success === true && result.method === 'sent') {
    console.log(JSON.stringify({
      source: 'messaging-real-provider',
      channel: 'email',
      providerName: PROVIDER_NAME,
      dispatchId: dispatchIdStr,
      phase: 'sent',
      messageId: result.messageId || null
    }));
    return {
      providerName: PROVIDER_NAME,
      providerMessageId: result.messageId || null,
      providerStatus: 'sent',
      shadow: false
    };
  }

  // Non-`sent` outcomes are all non-retryable in V1. Conservative for real email.
  if (result && result.success === true && result.method === 'logged') {
    // SMTP not configured AND `EMAIL_DELIVERY_REQUIRED` is not set. Email
    // definitely not sent, but we still treat as terminal to enforce the
    // "single attempt" guarantee for real email.
    throwNonRetryable('transport_not_configured', 'realEmailProvider: SMTP transport not configured');
  }
  if (result && result.success === true && result.method === 'skipped-duplicate') {
    // Defensive: skipIdempotencyWindow:true should prevent this.
    throwNonRetryable('skipped_legacy_window', 'realEmailProvider: legacy in-memory idempotency window matched unexpectedly');
  }
  if (result && result.method === 'unavailable') {
    throwNonRetryable('provider_unavailable', `realEmailProvider: emailService unavailable: ${result.error || ''}`);
  }
  // method 'failed' or 'logged' with error
  throwNonRetryable('provider_throw', `realEmailProvider: emailService returned failure: ${result && result.error ? result.error : 'unknown'}`);
}

module.exports = {
  PROVIDER_NAME,
  shadow: false,
  sendEmail
};
