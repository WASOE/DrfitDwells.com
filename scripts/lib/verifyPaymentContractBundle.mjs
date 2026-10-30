/**
 * Verify that a compiled frontend bundle actually contains the production
 * checkout payment contract. Environment flags alone cannot certify a build.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseBooleanFlag } from '../../shared/env/parseBooleanFlag.js';
import { applicationReleaseFromEnv } from '../../shared/payments/productionPaymentContract.js';
import {
  EXPECTED_PAYMENT_CONTRACT_VERSION,
  compiledRecordsAgree,
  extractCompiledPaymentContracts
} from './paymentContractCompiledRecord.mjs';

const CHECKOUT_MARKERS = ['guestInfo', 'legalAcceptance', 'acceptedTermsAndCancellation'];

function assetName(specifier) {
  const base = String(specifier || '').split('?')[0].split('#')[0].split('/').pop();
  if (!base || !/^[A-Za-z0-9_.-]+\.js$/.test(base)) return null;
  return base;
}

function reachableAssetFiles(distDir, indexHtml) {
  const assetsDir = path.join(distDir, 'assets');
  const seen = new Set();
  const queue = [];
  const push = (name) => {
    if (!name || seen.has(name)) return;
    if (!fs.existsSync(path.join(assetsDir, name))) return;
    seen.add(name);
    queue.push(name);
  };
  for (const match of String(indexHtml || '').matchAll(/\/assets\/([A-Za-z0-9_.-]+\.js)/g)) {
    push(match[1]);
  }
  while (queue.length > 0) {
    const name = queue.shift();
    const source = fs.readFileSync(path.join(assetsDir, name), 'utf8');
    for (const match of source.matchAll(/["'`]([^"'`]+\.js)["'`]/g)) {
      push(assetName(match[1]));
    }
  }
  return [...seen].sort();
}

function readJsAssets(distDir, indexHtml) {
  const assetsDir = path.join(distDir, 'assets');
  if (!fs.existsSync(assetsDir)) {
    return { ok: false, error: 'client/dist/assets missing.', files: [], source: '' };
  }
  const files = reachableAssetFiles(distDir, indexHtml);
  if (files.length === 0) {
    return {
      ok: false,
      error: 'index.html does not reach any compiled JavaScript assets.',
      files: [],
      source: ''
    };
  }
  const source = files.map((file) => fs.readFileSync(path.join(assetsDir, file), 'utf8')).join('\n');
  return { ok: true, files, source };
}

function missingMarkers(source) {
  return CHECKOUT_MARKERS.filter((marker) => !source.includes(marker));
}

function frontendReleaseFromEnv(env) {
  return String(env.VITE_FRONTEND_RELEASE || env.FRONTEND_RELEASE || '').trim();
}

/**
 * Read-only assessment. Does not write a manifest.
 * Pass env only for the release command, which must align with the bundle.
 */
export function assessPaymentContractBundle(distDir, { env = null } = {}) {
  const errors = [];
  if (!distDir || !fs.existsSync(distDir)) {
    return { ok: false, errors: ['client/dist missing. Build the client first.'], compiled: null };
  }
  const indexPath = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    errors.push('client/dist/index.html missing.');
  } else {
    const indexHtml = fs.readFileSync(indexPath, 'utf8');
    const assetRefs = [...indexHtml.matchAll(/\/assets\/([A-Za-z0-9_.-]+\.js)/g)].map((match) => match[1]);
    for (const ref of assetRefs) {
      if (!fs.existsSync(path.join(distDir, 'assets', ref))) {
        errors.push(`index.html references missing asset: ${ref}`);
      }
    }
  }

  const indexHtml = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : '';
  const assets = readJsAssets(distDir, indexHtml);
  if (!assets.ok) errors.push(assets.error);
  const absent = assets.ok ? missingMarkers(assets.source) : [];
  if (absent.length > 0) {
    errors.push(`Strict finalize build is missing ${absent.join(', ')} in the production bundle.`);
  }

  const records = assets.ok ? extractCompiledPaymentContracts(assets.source) : [];
  const compiled = compiledRecordsAgree(records);
  if (records.length === 0) {
    errors.push(
      'Compiled checkout bundle has no payment-contract object. Contract strings elsewhere in the assets are not accepted.'
    );
  } else if (!compiled) {
    errors.push('Compiled checkout bundle contains conflicting payment-contract objects.');
  } else {
    if (compiled.paymentContractVersion !== EXPECTED_PAYMENT_CONTRACT_VERSION) {
      errors.push(
        `Compiled payment contract version is ${compiled.paymentContractVersion || 'missing'}, expected ${EXPECTED_PAYMENT_CONTRACT_VERSION}.`
      );
    }
    for (const field of ['checkoutSessionV2', 'finalizeIntentPersist', 'finalizeIntentRequiredForPi']) {
      if (compiled[field] !== true) {
        errors.push(`Compiled checkout flag ${field} is not enabled.`);
      }
    }
    if (!compiled.frontendRelease) {
      errors.push('Compiled frontend release is missing.');
    }
  }

  if (env) {
    const expected = {
      checkoutSessionV2: parseBooleanFlag(env.VITE_CHECKOUT_SESSION_V2),
      finalizeIntentPersist: parseBooleanFlag(env.VITE_FINALIZE_INTENT_PERSIST),
      finalizeIntentRequiredForPi: parseBooleanFlag(env.VITE_FINALIZE_INTENT_REQUIRED_FOR_PI)
    };
    for (const [field, enabled] of Object.entries(expected)) {
      if (!enabled) {
        errors.push(`${envName(field)} must be explicitly enabled for a payment release build.`);
      } else if (compiled && compiled[field] !== true) {
        errors.push(`Compiled ${field} does not match ${envName(field)}.`);
      }
    }
    const stripePk = String(env.VITE_STRIPE_PUBLISHABLE_KEY || '').trim();
    if (!stripePk) {
      errors.push('VITE_STRIPE_PUBLISHABLE_KEY is absent.');
    } else if (assets.ok && !assets.source.includes(stripePk)) {
      errors.push('Compiled bundle does not contain VITE_STRIPE_PUBLISHABLE_KEY.');
    }
    const frontendRelease = frontendReleaseFromEnv(env);
    if (!frontendRelease) {
      errors.push('VITE_FRONTEND_RELEASE is absent.');
    } else if (compiled && compiled.frontendRelease !== frontendRelease) {
      errors.push('Compiled frontendRelease does not match VITE_FRONTEND_RELEASE.');
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    compiled: compiled || null,
    assetJsFiles: assets.files.length
  };
}

function envName(field) {
  if (field === 'checkoutSessionV2') return 'VITE_CHECKOUT_SESSION_V2';
  if (field === 'finalizeIntentPersist') return 'VITE_FINALIZE_INTENT_PERSIST';
  return 'VITE_FINALIZE_INTENT_REQUIRED_FOR_PI';
}

export function manifestFromCompiled(assessment, env = {}) {
  const compiled = assessment.compiled;
  return {
    ok: true,
    paymentContractVersion: compiled.paymentContractVersion,
    checkoutSessionV2: compiled.checkoutSessionV2,
    finalizeIntentPersist: compiled.finalizeIntentPersist,
    finalizeIntentRequiredForPi: compiled.finalizeIntentRequiredForPi,
    frontendRelease: compiled.frontendRelease,
    applicationRelease: applicationReleaseFromEnv(env),
    enabledCapabilities: {
      checkoutSessionV2: compiled.checkoutSessionV2,
      finalizeIntentPersist: compiled.finalizeIntentPersist,
      finalizeIntentRequiredForPi: compiled.finalizeIntentRequiredForPi,
      stripePublishableKeyPresent: Boolean(String(env.VITE_STRIPE_PUBLISHABLE_KEY || '').trim())
    },
    buildTimestamp: new Date().toISOString(),
    assetJsFiles: assessment.assetJsFiles,
    v2Explicit: compiled.checkoutSessionV2,
    persist: compiled.finalizeIntentPersist,
    required: compiled.finalizeIntentRequiredForPi
  };
}

/**
 * Remove any previous manifest first. Write ok:true only after the compiled
 * bundle passes. A failed run leaves no successful manifest behind.
 */
export function verifyPaymentContractBundle({ distDir, env, manifestPath }) {
  if (manifestPath) {
    fs.rmSync(manifestPath, { force: true });
  }
  const assessment = assessPaymentContractBundle(distDir, { env });
  if (!assessment.ok) {
    return { ok: false, errors: assessment.errors, manifest: null, compiled: assessment.compiled };
  }
  const manifest = manifestFromCompiled(assessment, env);
  if (
    manifest.ok !== true ||
    manifest.checkoutSessionV2 !== true ||
    manifest.finalizeIntentPersist !== true ||
    manifest.finalizeIntentRequiredForPi !== true ||
    manifest.paymentContractVersion !== EXPECTED_PAYMENT_CONTRACT_VERSION ||
    manifest.frontendRelease !== assessment.compiled.frontendRelease
  ) {
    return {
      ok: false,
      errors: ['Release manifest would not describe the compiled payment contract.'],
      manifest: null,
      compiled: assessment.compiled
    };
  }
  if (manifestPath) {
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return { ok: true, errors: [], manifest, compiled: assessment.compiled };
}
