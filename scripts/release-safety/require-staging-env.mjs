#!/usr/bin/env node
import { assessStagingEnvironment } from './frontend-compat.mjs';

const staging = assessStagingEnvironment(process.env);
if (!staging.ok) {
  console.error('[release-safety] BLOCK deployment.');
  for (const error of staging.errors) console.error(`  - ${error}`);
  console.error('Provide an isolated staging origin and RELEASE_STAGING_STRIPE_MODE=test.');
  console.error('Do not point this at https://driftdwells.com.');
  process.exit(2);
}
console.log(`[release-safety] staging environment accepted: ${process.env.RELEASE_STAGING_BASE_URL}`);
