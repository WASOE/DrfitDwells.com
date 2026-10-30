import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyPaymentContractBundle } from './lib/verifyPaymentContractBundle.mjs';
import { extractCompiledPaymentContracts } from './lib/paymentContractCompiledRecord.mjs';
import { extractFlagCalls } from '../client/vite/paymentContractCompiledPlugin.mjs';

const MARKERS = 'guestInfo legalAcceptance acceptedTermsAndCancellation pk_test_fixture';
const RELEASE_ENV = {
  VITE_CHECKOUT_SESSION_V2: '1',
  VITE_FINALIZE_INTENT_PERSIST: '1',
  VITE_FINALIZE_INTENT_REQUIRED_FOR_PI: '1',
  VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_fixture',
  VITE_FRONTEND_RELEASE: 'frontend-2026-10-28'
};

function writeFixture(js) {
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'payment-contract-bundle-'));
  fs.mkdirSync(path.join(distDir, 'assets'));
  fs.writeFileSync(path.join(distDir, 'assets', 'checkout.js'), js);
  fs.writeFileSync(
    path.join(distDir, 'index.html'),
    '<script type="module" src="/assets/checkout.js"></script>\n'
  );
  return distDir;
}

function compiledReturn(record) {
  return `function readPaymentContractCompiled(){return${JSON.stringify(record).replaceAll(
    'true',
    '!0'
  ).replaceAll('false', '!1')}}`;
}

const alignedRecord = {
  paymentContractVersion: 'checkout-payment-v2-finalize-1',
  checkoutSessionV2: true,
  finalizeIntentPersist: true,
  finalizeIntentRequiredForPi: true,
  frontendRelease: 'frontend-2026-10-28'
};

test('stale September-style bundle with production flags enabled fails and writes no manifest', () => {
  const distDir = writeFixture(`
    function on(e){return!1}
    function ts(){return on()}
    "checkout-payment-v2-finalize-1"
    ${MARKERS}
  `);
  const manifestPath = path.join(distDir, 'release-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ ok: true, checkoutSessionV2: true }));
  const result = verifyPaymentContractBundle({ distDir, env: RELEASE_ENV, manifestPath });
  assert.equal(result.ok, false);
  assert.equal(fs.existsSync(manifestPath), false);
  assert.match(result.errors.join('\n'), /no payment-contract object/i);
});

test('compatible compiled bundle and aligned flags pass and the manifest copies the bundle', () => {
  const distDir = writeFixture(`${compiledReturn(alignedRecord)}\n${MARKERS}`);
  const manifestPath = path.join(distDir, 'release-manifest.json');
  const result = verifyPaymentContractBundle({ distDir, env: RELEASE_ENV, manifestPath });
  assert.equal(result.ok, true, result.errors.join('\n'));
  const written = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(written.ok, true);
  assert.equal(written.paymentContractVersion, 'checkout-payment-v2-finalize-1');
  assert.equal(written.checkoutSessionV2, true);
  assert.equal(written.finalizeIntentPersist, true);
  assert.equal(written.finalizeIntentRequiredForPi, true);
  assert.equal(written.frontendRelease, 'frontend-2026-10-28');
  assert.equal(written.frontendRelease, result.compiled.frontendRelease);
});

test('contract strings and a stringified true record do not override incompatible compiled flags', () => {
  const quotedTrue = JSON.stringify(compiledReturn(alignedRecord));
  const incompatible = compiledReturn({
    ...alignedRecord,
    checkoutSessionV2: false,
    finalizeIntentPersist: false,
    finalizeIntentRequiredForPi: false
  });
  const distDir = writeFixture(`
    const decoy = ${quotedTrue};
    /* checkout-payment-v2-finalize-1 checkoutSessionV2 finalizeIntentPersist */
    ${incompatible}
    ${MARKERS}
  `);
  const manifestPath = path.join(distDir, 'release-manifest.json');
  const result = verifyPaymentContractBundle({ distDir, env: RELEASE_ENV, manifestPath });
  assert.equal(result.ok, false);
  assert.equal(fs.existsSync(manifestPath), false);
  assert.match(result.errors.join('\n'), /checkoutSessionV2 is not enabled/);
  const extracted = extractCompiledPaymentContracts(fs.readFileSync(path.join(distDir, 'assets', 'checkout.js'), 'utf8'));
  assert.equal(extracted.length, 1);
  assert.equal(extracted[0].checkoutSessionV2, false);
});

test('missing or incorrect contract version fails', () => {
  const wrongVersion = writeFixture(`
    ${compiledReturn({ ...alignedRecord, paymentContractVersion: 'checkout-payment-v1' })}
    ${MARKERS}
  `);
  const wrong = verifyPaymentContractBundle({
    distDir: wrongVersion,
    env: RELEASE_ENV,
    manifestPath: path.join(wrongVersion, 'release-manifest.json')
  });
  assert.equal(wrong.ok, false);
  assert.match(wrong.errors.join('\n'), /checkout-payment-v1/);

  const missingVersion = writeFixture(`
    const label = "checkout-payment-v2-finalize-1";
    function readPaymentContractCompiled(){return{checkoutSessionV2:!0,finalizeIntentPersist:!0,finalizeIntentRequiredForPi:!0,frontendRelease:"frontend-2026-10-28"}}
    ${MARKERS}
  `);
  const missing = verifyPaymentContractBundle({
    distDir: missingVersion,
    env: RELEASE_ENV,
    manifestPath: path.join(missingVersion, 'release-manifest.json')
  });
  assert.equal(missing.ok, false);
  assert.equal(fs.existsSync(path.join(missingVersion, 'release-manifest.json')), false);
  assert.match(missing.errors.join('\n'), /no payment-contract object/i);
});

test('an unreferenced asset or a regex literal cannot certify the bundle', () => {
  const distDir = writeFixture(`
    ${MARKERS}
    var forged = /function xa(){return{paymentContractVersion:"checkout-payment-v2-finalize-1",checkoutSessionV2:!0,finalizeIntentPersist:!0,finalizeIntentRequiredForPi:!0,frontendRelease:"frontend-2026-10-28"}}/;
  `);
  fs.writeFileSync(
    path.join(distDir, 'assets', 'extra.js'),
    `${compiledReturn(alignedRecord)}\n`
  );
  const result = verifyPaymentContractBundle({
    distDir,
    env: RELEASE_ENV,
    manifestPath: path.join(distDir, 'release-manifest.json')
  });
  assert.equal(result.ok, false);
  assert.equal(fs.existsSync(path.join(distDir, 'release-manifest.json')), false);
  assert.match(result.errors.join('\n'), /no payment-contract object/i);
});

test('flag capture reads Vite-substituted calls and rejects unsubstituted modules', () => {
  const enabled = extractFlagCalls(`
    export function isCheckoutSessionV2Enabled(){return parseBooleanFlag("1")}
  `);
  assert.deepEqual(enabled.values, [true]);
  const disabled = extractFlagCalls(`
    export function isFinalizeIntentPersistEnabled(){return parseBooleanFlag("false")}
    export function isFinalizeIntentRequiredForPiEnabled(){return parseBooleanFlag(undefined)}
  `);
  assert.deepEqual(disabled.values, [false, false]);
  const unsubstituted = extractFlagCalls(
    'export function isCheckoutSessionV2Enabled(){return parseBooleanFlag(import.meta.env.VITE_CHECKOUT_SESSION_V2)}'
  );
  assert.equal(unsubstituted.ok, false);
});
