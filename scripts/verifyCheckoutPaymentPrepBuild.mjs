/**
 * Fails the release if the production Vite bundle is incompatible with strict
 * finalize-intent payment preparation.
 *
 * Invalid combination:
 *   - backend requires finalize intent for PI (or the build compiles that intent)
 *   - frontend bundle does not submit guestInfo / legalAcceptance
 *
 * Usage:
 *   node scripts/verifyCheckoutPaymentPrepBuild.mjs
 *   (run after `cd client && vite build` with release env)
 *
 * Env (optional, mirrors Vite build env):
 *   VITE_CHECKOUT_SESSION_V2
 *   VITE_FINALIZE_INTENT_PERSIST
 *   VITE_FINALIZE_INTENT_REQUIRED_FOR_PI
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'client/dist');
const assetsDir = path.join(distDir, 'assets');

function parseFlag(raw) {
  if (typeof raw !== 'string') return false;
  const n = raw.trim().toLowerCase();
  return n === '1' || n === 'true' || n === 'on' || n === 'yes';
}

const v2 = parseFlag(process.env.VITE_CHECKOUT_SESSION_V2);
const persist = parseFlag(process.env.VITE_FINALIZE_INTENT_PERSIST);
const required = parseFlag(process.env.VITE_FINALIZE_INTENT_REQUIRED_FOR_PI);
const strictFinalize = persist || required;
const effectiveV2 = v2 || strictFinalize;

function fail(message) {
  console.error(`[verify-checkout-payment-prep] FAIL: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(distDir)) {
  fail(`client/dist missing. Build the client first.`);
}

if (required && !v2 && !persist) {
  // still ok if we infer V2 from required alone in source — check bundle markers below
}

if (required && !effectiveV2) {
  fail(
    'VITE_FINALIZE_INTENT_REQUIRED_FOR_PI is enabled but CheckoutSession V2 is not effective. Set VITE_CHECKOUT_SESSION_V2=1.'
  );
}

if (strictFinalize && !fs.existsSync(assetsDir)) {
  fail('client/dist/assets missing.');
}

const assetFiles = fs.existsSync(assetsDir)
  ? fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js'))
  : [];

const concatenated = assetFiles
  .map((f) => fs.readFileSync(path.join(assetsDir, f), 'utf8'))
  .join('\n');

if (strictFinalize) {
  const hasGuestInfo = concatenated.includes('guestInfo');
  const hasLegalAcceptance = concatenated.includes('legalAcceptance');
  const hasAcceptedTerms = concatenated.includes('acceptedTermsAndCancellation');
  if (!hasGuestInfo || !hasLegalAcceptance || !hasAcceptedTerms) {
    fail(
      'Strict finalize build is missing guestInfo/legalAcceptance markers in the production bundle. Customers will hit FINALIZE_INTENT_REQUIRED.'
    );
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      v2Explicit: v2,
      persist,
      required,
      effectiveV2,
      assetJsFiles: assetFiles.length
    },
    null,
    2
  )
);
