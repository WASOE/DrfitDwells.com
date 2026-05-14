'use strict';

/**
 * providerRegistry
 *
 * Resolves the provider implementation for a given channel.
 *
 *   - WhatsApp: shadow-only in V1. The real provider integration is Batch 11.
 *   - Email:    shadow by default. The real provider is returned only when
 *               `MESSAGE_EMAIL_PROVIDER_ENABLED='1'` (Batch 9). Any other
 *               value returns the shadow provider.
 *
 * The flag is checked at CALL TIME (not at module load) so tests and OPS
 * can flip it via `process.env` without a restart.
 *
 * Real email sends additionally require:
 *   - `MESSAGE_DISPATCHER_ENABLED='1'`            (dispatcher entrypoint)
 *   - `MESSAGE_SCHEDULER_WORKER_ENABLED='1'`      (if running via jobs)
 *   - a rule with `enabled: true` AND `mode in {auto, manual_approve}`
 *   - all Batch 8 safety gates passing
 *   - `emailService.isConfigured === true` (real SMTP transport available)
 *
 * Any provider that fails to declare `shadow: <boolean>` is treated as
 * shadow by the dispatcher (safer default; new providers that forget the
 * flag cannot accidentally produce a real send).
 *
 * See docs/guest-message-automation/02_V1_SPEC.md §20, §21, §35.
 */

const devShadowWhatsApp = require('./devShadowWhatsAppProvider');
const devShadowEmail = require('./devShadowEmailProvider');

const ENV_EMAIL_PROVIDER_FLAG = 'MESSAGE_EMAIL_PROVIDER_ENABLED';

function isRealEmailProviderEnabled() {
  return String(process.env[ENV_EMAIL_PROVIDER_FLAG] || '').trim() === '1';
}

function getWhatsAppProvider() {
  // Real WhatsApp provider lands in Batch 11; until then shadow only.
  return devShadowWhatsApp;
}

function getEmailProvider() {
  if (isRealEmailProviderEnabled()) {
    // Lazy require so test cleanups can mutate the env between calls without
    // a stale module reference, and so the real adapter (which requires
    // `emailService`) is never loaded in flag-off processes.
    return require('./realEmailProvider');
  }
  return devShadowEmail;
}

function getProviderForChannel(channel) {
  if (channel === 'whatsapp') return getWhatsAppProvider();
  if (channel === 'email') return getEmailProvider();
  throw new Error(`providerRegistry: unknown channel ${JSON.stringify(channel)}`);
}

module.exports = {
  getWhatsAppProvider,
  getEmailProvider,
  getProviderForChannel,
  isRealEmailProviderEnabled,
  ENV_EMAIL_PROVIDER_FLAG
};
