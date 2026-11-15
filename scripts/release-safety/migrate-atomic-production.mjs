#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateDocumentRoot, recoverDocumentRootMigration, verifyPreparedRelease } from './atomic-frontend.mjs';
import { hasWishlist, scriptFromRelease, smokeProduction } from './production-smoke.mjs';

const BASE = '/home/illoc/releases/frontend';
const WEBROOT = '/home/illoc/domains/driftdwells.com/public_html';

async function main() {
  const [operation, commit, apiCommit, ...extra] = process.argv.slice(2);
  if (!['apply', 'recover'].includes(operation) || extra.length || !/^[a-f0-9]{40}$/.test(apiCommit || '') || (operation === 'apply' && !/^[a-f0-9]{40}$/.test(commit || ''))) {
    throw new Error('Usage: migrate-atomic-production.mjs apply <staged-frontend-sha> <api-sha> | recover ignored <api-sha>');
  }
  const common = { state: `${BASE}/state`, smoke: async ({ active, rollback }) => rollback
    ? smokeProduction({ token: process.env.OPS_VERIFY_TOKEN, releaseAsset: scriptFromRelease(active), wishlist: hasWishlist(active), expectedApiRelease: apiCommit })
    : smokeProduction({ token: process.env.OPS_VERIFY_TOKEN, releaseAsset: scriptFromRelease(active), wishlist: hasWishlist(active), expectedApiRelease: apiCommit }) };
  if (operation === 'recover') return recoverDocumentRootMigration(common);
  const release = `${BASE}/releases/${commit}`;
  const inventory = JSON.parse(fs.readFileSync(path.join(release, '.frontend-inventory.json'), 'utf8'));
  verifyPreparedRelease({ release, inventory, sharedAssets: `${BASE}/shared-assets` });
  const owner = fs.statSync(BASE);
  return migrateDocumentRoot({ ...common, webroot: WEBROOT, base: BASE, releases: `${BASE}/releases`, pointer: `${BASE}/current`, observedRelease: release, expectedUid: owner.uid, expectedGid: owner.gid });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main())); }
  catch (error) { console.error(`[migrate-atomic-production] ${error.message}`); process.exitCode = 1; }
}
