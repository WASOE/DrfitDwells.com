/**
 * Fails the release unless the compiled frontend contains the production
 * checkout payment contract. Environment flags are necessary and are not
 * sufficient: a stale bundle is rejected even when those flags are enabled.
 *
 * Usage (after vite build with release env):
 *   node scripts/verifyCheckoutPaymentPrepBuild.mjs
 *
 * Required release env:
 *   VITE_CHECKOUT_SESSION_V2=1
 *   VITE_FINALIZE_INTENT_PERSIST=1
 *   VITE_FINALIZE_INTENT_REQUIRED_FOR_PI=1
 *   VITE_STRIPE_PUBLISHABLE_KEY=pk_...
 *   VITE_FRONTEND_RELEASE=<id>
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_PAYMENT_CONTRACT_VERSION } from '../shared/payments/productionPaymentContract.js';
import { verifyPaymentContractBundle } from './lib/verifyPaymentContractBundle.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(repoRoot, 'client/dist');
const manifestPath = path.join(distDir, 'release-manifest.json');

if (PRODUCTION_PAYMENT_CONTRACT_VERSION !== 'checkout-payment-v2-finalize-1') {
  console.error(
    '[verify-checkout-payment-prep] FAIL: Production payment contract version drifted from checkout-payment-v2-finalize-1.'
  );
  process.exit(1);
}

const result = verifyPaymentContractBundle({
  distDir,
  env: process.env,
  manifestPath
});

if (!result.ok) {
  for (const error of result.errors) {
    console.error(`[verify-checkout-payment-prep] FAIL: ${error}`);
  }
  process.exit(1);
}

console.log(JSON.stringify(result.manifest, null, 2));
