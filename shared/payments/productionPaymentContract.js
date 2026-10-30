/**
 * Versioned production payment contract for Checkout Session V2.
 *
 * Shared by the release build verifier, production startup validation,
 * capability responses, and post-start deployment checks.
 * This module is pure: it does not read secrets into messages and it does
 * not contact Stripe or the database.
 */

export const PRODUCTION_PAYMENT_CONTRACT_VERSION = 'checkout-payment-v2-finalize-1';

export const PRODUCTION_PAYMENT_CONTRACT = Object.freeze({
  version: PRODUCTION_PAYMENT_CONTRACT_VERSION,
  capabilityFields: Object.freeze([
    'checkoutSessionV2',
    'finalizeIntentPersist',
    'finalizeIntentRequiredForPi',
    'paymentContractVersion'
  ]),
  serverFlags: Object.freeze({
    checkoutSessionV2: 'CHECKOUT_SESSION_V2',
    finalizeIntentPersist: 'FINALIZE_INTENT_PERSIST',
    finalizeIntentRequiredForPi: 'FINALIZE_INTENT_REQUIRED_FOR_PI'
  }),
  clientFlags: Object.freeze({
    checkoutSessionV2: 'VITE_CHECKOUT_SESSION_V2',
    finalizeIntentPersist: 'VITE_FINALIZE_INTENT_PERSIST',
    finalizeIntentRequiredForPi: 'VITE_FINALIZE_INTENT_REQUIRED_FOR_PI'
  })
});

const TRUE_TOKENS = new Set(['1', 'true', 'on', 'yes']);
const FALSE_TOKENS = new Set(['0', 'false', 'off', 'no']);

function envBag(env) {
  if (env && typeof env === 'object') return env;
  return globalThis.process?.env || {};
}

/**
 * Explicit flag state. Raw values are never returned.
 * @returns {'unset'|'enabled'|'disabled'|'invalid'}
 */
export function describeExplicitFlag(value) {
  if (value == null) return 'unset';
  const normalized = String(value).trim().toLowerCase();
  if (normalized === '') return 'unset';
  if (TRUE_TOKENS.has(normalized)) return 'enabled';
  if (FALSE_TOKENS.has(normalized)) return 'disabled';
  return 'invalid';
}

export function isExplicitlyEnabled(value) {
  return describeExplicitFlag(value) === 'enabled';
}

export function readServerPaymentCapabilityFlags(env) {
  const source = envBag(env);
  return {
    checkoutSessionV2: isExplicitlyEnabled(source.CHECKOUT_SESSION_V2),
    finalizeIntentPersist: isExplicitlyEnabled(source.FINALIZE_INTENT_PERSIST),
    finalizeIntentRequiredForPi: isExplicitlyEnabled(source.FINALIZE_INTENT_REQUIRED_FOR_PI)
  };
}

export function readClientPaymentCapabilityFlags(env) {
  const source = envBag(env);
  return {
    checkoutSessionV2: isExplicitlyEnabled(source.VITE_CHECKOUT_SESSION_V2),
    finalizeIntentPersist: isExplicitlyEnabled(source.VITE_FINALIZE_INTENT_PERSIST),
    finalizeIntentRequiredForPi: isExplicitlyEnabled(source.VITE_FINALIZE_INTENT_REQUIRED_FOR_PI)
  };
}

/**
 * Production fail-closed check.
 * When Checkout V2 is explicitly enabled, both finalize flags must also be
 * explicitly enabled. Non-production environments stay compatible with
 * existing development and test workflows.
 */
export function validateProductionPaymentContract(env) {
  const source = envBag(env);
  if (source.NODE_ENV !== 'production') {
    return { ok: true, errors: [] };
  }
  if (describeExplicitFlag(source.CHECKOUT_SESSION_V2) !== 'enabled') {
    return { ok: true, errors: [] };
  }

  const errors = [];
  for (const name of ['FINALIZE_INTENT_PERSIST', 'FINALIZE_INTENT_REQUIRED_FOR_PI']) {
    const state = describeExplicitFlag(source[name]);
    if (state !== 'enabled') {
      errors.push(
        `${name} is ${state} while CHECKOUT_SESSION_V2 is enabled. ` +
          `Production Checkout V2 requires ${name} to be explicitly enabled (1, true, on, or yes).`
      );
    }
  }
  return { ok: errors.length === 0, errors };
}

export function applicationReleaseFromEnv(env) {
  const source = envBag(env);
  const value = String(
    source.APP_RELEASE || source.APPLICATION_RELEASE || source.RELEASE_VERSION || ''
  ).trim();
  return value || null;
}

export function frontendReleaseFromEnv(env) {
  const source = envBag(env);
  const value = String(
    source.VITE_FRONTEND_RELEASE ||
      source.FRONTEND_RELEASE ||
      source.VITE_APP_RELEASE ||
      source.VITE_RELEASE_VERSION ||
      source.RELEASE ||
      ''
  ).trim();
  return value || null;
}

export function buildReleaseManifestContract(env, { applicationCommit = null } = {}) {
  const source = envBag(env);
  const flags = readClientPaymentCapabilityFlags(source);
  const frontendRelease = frontendReleaseFromEnv(source) || applicationCommit || null;
  return {
    paymentContractVersion: PRODUCTION_PAYMENT_CONTRACT_VERSION,
    checkoutSessionV2: flags.checkoutSessionV2,
    finalizeIntentPersist: flags.finalizeIntentPersist,
    finalizeIntentRequiredForPi: flags.finalizeIntentRequiredForPi,
    frontendRelease,
    applicationRelease: applicationReleaseFromEnv(source),
    applicationCommit: applicationCommit || null,
    enabledCapabilities: {
      checkoutSessionV2: flags.checkoutSessionV2,
      finalizeIntentPersist: flags.finalizeIntentPersist,
      finalizeIntentRequiredForPi: flags.finalizeIntentRequiredForPi,
      stripePublishableKeyPresent: Boolean(String(source.VITE_STRIPE_PUBLISHABLE_KEY || '').trim())
    }
  };
}

function pushMismatch(mismatches, field, expected, actual, reason) {
  mismatches.push({
    field,
    expected: expected ?? null,
    actual: actual ?? null,
    reason
  });
}

/**
 * Compare a build manifest with live health and checkout-capabilities payloads.
 * Application release is compared only when both sides provide one.
 */
export function compareManifestToRuntime({ manifest, health, capabilities } = {}) {
  const mismatches = [];
  const man = manifest && typeof manifest === 'object' ? manifest : {};
  const cap = capabilities && typeof capabilities === 'object' ? capabilities : null;
  const liveHealth = health && typeof health === 'object' ? health : null;

  if (!cap) {
    pushMismatch(mismatches, 'capabilities', 'object', null, 'missing');
  } else {
    const expectedFlags = {
      checkoutSessionV2: man.checkoutSessionV2 ?? man.enabledCapabilities?.checkoutSessionV2,
      finalizeIntentPersist:
        man.finalizeIntentPersist ?? man.enabledCapabilities?.finalizeIntentPersist,
      finalizeIntentRequiredForPi:
        man.finalizeIntentRequiredForPi ?? man.enabledCapabilities?.finalizeIntentRequiredForPi
    };
    for (const field of Object.keys(expectedFlags)) {
      if (expectedFlags[field] !== cap[field]) {
        pushMismatch(mismatches, field, expectedFlags[field], cap[field], 'mismatch');
      }
    }
    const expectedVersion = man.paymentContractVersion || null;
    if (expectedVersion !== (cap.paymentContractVersion || null)) {
      pushMismatch(
        mismatches,
        'paymentContractVersion',
        expectedVersion,
        cap.paymentContractVersion ?? null,
        'mismatch'
      );
    }
    const expectedFrontend = man.frontendRelease || null;
    const actualFrontend = cap.frontendReleaseHint || liveHealth?.frontendRelease || null;
    if (expectedFrontend && actualFrontend && expectedFrontend !== actualFrontend) {
      pushMismatch(mismatches, 'frontendRelease', expectedFrontend, actualFrontend, 'mismatch');
    } else if (expectedFrontend && !actualFrontend) {
      pushMismatch(mismatches, 'frontendRelease', expectedFrontend, null, 'runtime_missing');
    }
  }

  const expectedApp = man.applicationRelease || null;
  const actualApp = liveHealth?.applicationRelease || cap?.applicationRelease || null;
  if (expectedApp && actualApp && expectedApp !== actualApp) {
    pushMismatch(mismatches, 'applicationRelease', expectedApp, actualApp, 'mismatch');
  }

  const expectedCommit = man.applicationCommit || null;
  const actualCommit = liveHealth?.applicationCommit || null;
  if (expectedCommit && actualCommit && expectedCommit !== actualCommit) {
    pushMismatch(mismatches, 'applicationCommit', expectedCommit, actualCommit, 'mismatch');
  }

  return { ok: mismatches.length === 0, mismatches };
}

/**
 * Live production watchdog: Checkout V2 contract flags must be on and the
 * advertised contract version must match this module.
 */
export function evaluateLiveProductionCapabilities(capabilities) {
  const mismatches = [];
  if (!capabilities || typeof capabilities !== 'object') {
    pushMismatch(mismatches, 'capabilities', 'object', null, 'missing');
    return { ok: false, mismatches };
  }
  if (capabilities.paymentContractVersion !== PRODUCTION_PAYMENT_CONTRACT_VERSION) {
    pushMismatch(
      mismatches,
      'paymentContractVersion',
      PRODUCTION_PAYMENT_CONTRACT_VERSION,
      capabilities.paymentContractVersion ?? null,
      'mismatch'
    );
  }
  for (const field of [
    'checkoutSessionV2',
    'finalizeIntentPersist',
    'finalizeIntentRequiredForPi'
  ]) {
    if (capabilities[field] !== true) {
      pushMismatch(mismatches, field, true, capabilities[field] ?? null, 'not_enabled');
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

export function publicCapabilityContract(flags, { applicationRelease = null, frontendRelease = null } = {}) {
  const checkoutSessionV2 = flags.checkoutSessionV2 === true;
  const finalizeIntentPersist = flags.finalizeIntentPersist === true;
  const finalizeIntentRequiredForPi = flags.finalizeIntentRequiredForPi === true;
  return {
    success: true,
    flowVersion: checkoutSessionV2 ? 'v2' : 'legacy',
    checkoutSessionV2,
    finalizeIntentPersist,
    finalizeIntentRequiredForPi,
    requiresFinalizeIntentPayload: finalizeIntentRequiredForPi,
    applicationRelease: applicationRelease || null,
    frontendReleaseHint: frontendRelease || null,
    paymentContractVersion: PRODUCTION_PAYMENT_CONTRACT_VERSION,
    contractVersion: 2
  };
}
