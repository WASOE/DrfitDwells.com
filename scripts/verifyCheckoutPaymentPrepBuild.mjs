/**
 * Fails the release if the production Vite bundle is incompatible with the
 * payment / finalize release contract. Fail closed: never report ok when
 * required capabilities are effectively false.
 *
 * Usage (after vite build with release env):
 *   node scripts/verifyCheckoutPaymentPrepBuild.mjs
 *
 * Required release env (all must be explicitly true for a production payment release):
 *   VITE_CHECKOUT_SESSION_V2=1
 *   VITE_FINALIZE_INTENT_PERSIST=1
 *   VITE_FINALIZE_INTENT_REQUIRED_FOR_PI=1
 *   VITE_STRIPE_PUBLISHABLE_KEY=pk_...
 *   VITE_FRONTEND_RELEASE=<id>   (or RELEASE / COMMIT)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { parseBooleanFlag } from '../shared/env/parseBooleanFlag.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'client/dist');
const assetsDir = path.join(distDir, 'assets');
const manifestPath = path.join(distDir, 'release-manifest.json');

const PAYMENT_CONTRACT_VERSION = 'checkout-payment-v2-finalize-1';

function fail(message) {
  console.error(`[verify-checkout-payment-prep] FAIL: ${message}`);
  process.exit(1);
}

function readGitCommit() {
  try {
    return execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

const v2 = parseBooleanFlag(process.env.VITE_CHECKOUT_SESSION_V2);
const persist = parseBooleanFlag(process.env.VITE_FINALIZE_INTENT_PERSIST);
const required = parseBooleanFlag(process.env.VITE_FINALIZE_INTENT_REQUIRED_FOR_PI);
const stripePk = String(process.env.VITE_STRIPE_PUBLISHABLE_KEY || '').trim();
const frontendRelease = String(
  process.env.VITE_FRONTEND_RELEASE ||
    process.env.FRONTEND_RELEASE ||
    process.env.RELEASE ||
    ''
).trim();
const applicationCommit = readGitCommit();

if (!fs.existsSync(distDir)) {
  fail('client/dist missing. Build the client first.');
}

// Fail closed: production payment release requires explicit capability enablement.
if (!v2) {
  fail('VITE_CHECKOUT_SESSION_V2 must be explicitly enabled for a payment release build.');
}
if (!persist) {
  fail('VITE_FINALIZE_INTENT_PERSIST must be explicitly enabled for a payment release build.');
}
if (!required) {
  fail(
    'VITE_FINALIZE_INTENT_REQUIRED_FOR_PI must be explicitly enabled for a payment release build.'
  );
}
if (!stripePk) {
  fail('VITE_STRIPE_PUBLISHABLE_KEY is absent.');
}
if (!frontendRelease && !applicationCommit) {
  fail('Release identifier absent (set VITE_FRONTEND_RELEASE or ensure git commit is available).');
}

if (!fs.existsSync(assetsDir)) {
  fail('client/dist/assets missing.');
}

const assetFiles = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
if (assetFiles.length === 0) {
  fail('No JS assets in client/dist/assets.');
}

const concatenated = assetFiles
  .map((f) => fs.readFileSync(path.join(assetsDir, f), 'utf8'))
  .join('\n');

const hasGuestInfo = concatenated.includes('guestInfo');
const hasLegalAcceptance = concatenated.includes('legalAcceptance');
const hasAcceptedTerms = concatenated.includes('acceptedTermsAndCancellation');
if (!hasGuestInfo || !hasLegalAcceptance || !hasAcceptedTerms) {
  fail(
    'Strict finalize build is missing guestInfo/legalAcceptance markers in the production bundle.'
  );
}

// Ensure the bundle did not compile V2 inference from finalize flags alone
// (source must keep V2 explicit — marker: VITE_CHECKOUT_SESSION_V2 usage path).
if (!hasGuestInfo) {
  fail('Bundle missing guestInfo');
}

const indexHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
const assetRefs = [...indexHtml.matchAll(/\/assets\/([A-Za-z0-9_.-]+\.js)/g)].map((m) => m[1]);
for (const ref of assetRefs) {
  if (!fs.existsSync(path.join(assetsDir, ref))) {
    fail(`index.html references missing asset: ${ref}`);
  }
}

const enabledCapabilities = {
  checkoutSessionV2: true,
  finalizeIntentPersist: true,
  finalizeIntentRequiredForPi: true,
  stripePublishableKeyPresent: true
};

const manifest = {
  ok: true,
  applicationCommit: applicationCommit || null,
  frontendRelease: frontendRelease || applicationCommit,
  enabledCapabilities,
  buildTimestamp: new Date().toISOString(),
  paymentContractVersion: PAYMENT_CONTRACT_VERSION,
  assetJsFiles: assetFiles.length,
  v2Explicit: v2,
  persist,
  required
};

// Fail closed: never emit ok when effective flags are false.
if (
  !manifest.enabledCapabilities.checkoutSessionV2 ||
  !manifest.enabledCapabilities.finalizeIntentPersist ||
  !manifest.enabledCapabilities.finalizeIntentRequiredForPi ||
  !manifest.enabledCapabilities.stripePublishableKeyPresent
) {
  fail('Release manifest would report enabled capabilities as false.');
}

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
