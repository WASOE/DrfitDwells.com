#!/usr/bin/env node
import { assessStagingEnvironment } from './frontend-compat.mjs';

const staging = assessStagingEnvironment(process.env);
if (!staging.ok) {
  console.error('[release-safety] BLOCK deployment.');
  for (const error of staging.errors) console.error(`  - ${error}`);
  console.error('Owner action: provision a separate staging origin and database, deploy this branch there, and set repository secrets:');
  console.error('  RELEASE_STAGING_BASE_URL — not driftdwells.com or www.driftdwells.com; must serve the site and /api');
  console.error('  RELEASE_STAGING_STRIPE_MODE=test — the staging server must also report stripeMode "test" from /api/health');
  console.error('  RELEASE_STAGING_ALLOW_PAYMENT_INIT=1');
  console.error('Use a Stripe test secret (sk_test_) and a database that is not production.');
  console.error('Setting these variables does not count as a passing quote, finalize-intent, or payment test.');
  console.error('Do not point this at https://driftdwells.com.');
  process.exit(2);
}
console.log(`[release-safety] staging target accepted for a real test: ${process.env.RELEASE_STAGING_BASE_URL}`);
