'use strict';

/**
 * providerRegistry
 *
 * Resolves the provider implementation for a given channel.
 *
 *   - WhatsApp: shadow-only in V1. The real provider integration is Batch 11.
 *   - Email:    mode-aware (GMA mode semantics safety batch):
 *               - `automationMode === 'shadow'` → always dev shadow email.
 *               - `automationMode === 'auto'`   → real adapter only when
 *                 `MESSAGE_EMAIL_PROVIDER_ENABLED='1'`, else shadow.
 *               - `automationMode === 'manual_approve'` → shadow defensively;
 *                 the dispatcher must not invoke providers for that mode.
 *               - Missing `automationMode` defaults to `'shadow'` (safest).
 *                 The dispatcher always passes `rule.mode`.
 *
 * The env flag is checked at CALL TIME (not at module load) so tests and OPS
 * can flip it via `process.env` without a restart.
 *
 * `getEmailProvider()` remains a convenience for `'auto'`-mode resolution
 * (env gate only), for legacy callers and tests.
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

function resolveEmailProviderForAutomationMode(automationMode) {
  const mode = automationMode == null || automationMode === '' ? 'shadow' : String(automationMode);
  if (mode === 'shadow' || mode === 'manual_approve') {
    return devShadowEmail;
  }
  if (mode === 'auto') {
    if (isRealEmailProviderEnabled()) {
      // Lazy require so test cleanups can mutate the env between calls without
      // a stale module reference, and so the real adapter (which requires
      // `emailService`) is never loaded in flag-off processes.
      return require('./realEmailProvider');
    }
    return devShadowEmail;
  }
  return devShadowEmail;
}

/** Resolves email provider for `mode: 'auto'` rules (env gate only). */
function getEmailProvider() {
  return resolveEmailProviderForAutomationMode('auto');
}

function getProviderForChannel(channel, opts = {}) {
  if (channel === 'whatsapp') return getWhatsAppProvider();
  if (channel === 'email') {
    const automationMode = opts.automationMode == null || opts.automationMode === '' ? 'shadow' : opts.automationMode;
    return resolveEmailProviderForAutomationMode(automationMode);
  }
  throw new Error(`providerRegistry: unknown channel ${JSON.stringify(channel)}`);
}

module.exports = {
  getWhatsAppProvider,
  getEmailProvider,
  getProviderForChannel,
  resolveEmailProviderForAutomationMode,
  isRealEmailProviderEnabled,
  ENV_EMAIL_PROVIDER_FLAG
};
