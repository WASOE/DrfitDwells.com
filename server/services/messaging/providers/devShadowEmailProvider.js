'use strict';

/**
 * devShadowEmailProvider
 *
 * The ONLY email provider implementation in Batch 8. It is intentionally
 * incapable of producing a real send:
 *
 *   - does NOT require or call `emailService` / `bookingLifecycleEmailService`
 *   - does NOT call Postmark / nodemailer / any HTTP client
 *   - does NOT write to EmailEvent or MessageDeliveryEvent
 *
 * The real email adapter that wraps `emailService.sendEmail` (per spec §21)
 * is Batch 9. Until then, the dispatcher routes every email channel attempt
 * through this shadow provider.
 *
 * See docs/guest-message-automation/02_V1_SPEC.md §21, §35.1.
 */

const PROVIDER_NAME = 'internal';

function clipForLog(text, max = 120) {
  if (typeof text !== 'string') return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

async function sendEmail(input) {
  if (!input || typeof input !== 'object') {
    throw Object.assign(new Error('devShadowEmailProvider: empty input'), { code: 'invalid_input', retryable: false });
  }
  // `dispatchId` is accepted and ignored so the dispatcher call shape is
  // symmetric with the real provider.
  const { to, subject, html } = input;
  if (!to || typeof to !== 'string' || !to.includes('@')) {
    throw Object.assign(new Error('devShadowEmailProvider: invalid recipient'), { code: 'invalid_recipient', retryable: false });
  }
  if (!subject || typeof subject !== 'string') {
    throw Object.assign(new Error('devShadowEmailProvider: missing subject'), { code: 'invalid_input', retryable: false });
  }
  if (!html || typeof html !== 'string') {
    throw Object.assign(new Error('devShadowEmailProvider: missing html body'), { code: 'invalid_input', retryable: false });
  }

  const recipientPreview = to.replace(/(^.).*(@.*$)/, '$1***$2');
  console.log(JSON.stringify({
    source: 'messaging-shadow-provider',
    channel: 'email',
    providerName: PROVIDER_NAME,
    to: recipientPreview,
    subjectPreview: clipForLog(subject, 80),
    bodyPreview: clipForLog(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), 160)
  }));

  return {
    providerName: PROVIDER_NAME,
    providerMessageId: null,
    providerStatus: 'shadow_accepted',
    shadow: true
  };
}

module.exports = {
  PROVIDER_NAME,
  shadow: true,
  sendEmail
};
