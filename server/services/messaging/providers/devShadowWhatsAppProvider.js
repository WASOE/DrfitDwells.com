'use strict';

/**
 * devShadowWhatsAppProvider
 *
 * The ONLY WhatsApp provider implementation in Batch 8. It is intentionally
 * incapable of producing a real send:
 *
 *   - no HTTP, no fetch, no axios, no provider SDK
 *   - no environment-variable lookups
 *   - no MessageDeliveryEvent writes
 *
 * It implements the WhatsAppProvider interface that real adapters (Meta /
 * Twilio / 360dialog) will implement in Batch 11. For now it just validates
 * the input shape, logs a redacted payload preview, and returns the standard
 * shadow response so the dispatcher can record a `MessageDispatch` row with
 * `providerName='internal'`, `providerMessageId=null`, `details.shadow=true`.
 *
 * See docs/guest-message-automation/02_V1_SPEC.md §20, §35.1.
 */

const PROVIDER_NAME = 'internal';

function clipForLog(text, max = 120) {
  if (typeof text !== 'string') return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

async function sendTemplate(input) {
  // Minimal shape validation. The dispatcher should not have called us
  // without these, but defence-in-depth is cheap.
  if (!input || typeof input !== 'object') {
    throw Object.assign(new Error('devShadowWhatsAppProvider: empty input'), { code: 'invalid_input', retryable: false });
  }
  const { to, templateName, locale, variables } = input;
  if (!to || typeof to !== 'string' || !to.startsWith('+')) {
    throw Object.assign(new Error('devShadowWhatsAppProvider: invalid recipient'), { code: 'invalid_recipient', retryable: false });
  }
  if (!templateName || typeof templateName !== 'string') {
    throw Object.assign(new Error('devShadowWhatsAppProvider: missing templateName'), { code: 'invalid_input', retryable: false });
  }
  if (!locale || typeof locale !== 'string') {
    throw Object.assign(new Error('devShadowWhatsAppProvider: missing locale'), { code: 'invalid_input', retryable: false });
  }
  if (!variables || typeof variables !== 'object') {
    throw Object.assign(new Error('devShadowWhatsAppProvider: missing variables'), { code: 'invalid_input', retryable: false });
  }

  // Structured log; redact recipient to last 4 digits.
  const recipientPreview = to.length > 4 ? `***${to.slice(-4)}` : to;
  const previewLine = clipForLog(
    Object.keys(variables).map((k) => `${k}=${String(variables[k] ?? '')}`).join(' | '),
    160
  );
  console.log(JSON.stringify({
    source: 'messaging-shadow-provider',
    channel: 'whatsapp',
    providerName: PROVIDER_NAME,
    to: recipientPreview,
    templateName,
    locale,
    variablesPreview: previewLine
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
  sendTemplate
};
