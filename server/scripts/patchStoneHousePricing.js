#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Stone House commercial pricing cutover (scoped Cabin document only).
 *
 * READ ONLY (default):
 *   node scripts/patchStoneHousePricing.js
 *   node scripts/patchStoneHousePricing.js --dry-run
 *
 * APPLY (explicit):
 *   node scripts/patchStoneHousePricing.js --apply
 *
 * Production APPLY additionally requires:
 *   ALLOW_PRODUCTION_STONE_HOUSE_PRICING_PATCH=1
 *
 * Exit codes:
 *   0 — dry-run / apply success / already-desired no-op
 *   2 — safety refusal (ambiguous target, unexpected state, production guard, CAS mismatch)
 *   1 — operational / database error
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const Cabin = require('../models/Cabin');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const { parseArgs, runStoneHousePricingPatch, EXIT } = require('./patchStoneHousePricingCore');

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error) {
    console.error(JSON.stringify({ kind: 'argument_error', message: parsed.error }, null, 2));
    return EXIT.REFUSED;
  }

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  if (!uri) {
    console.error(JSON.stringify({ kind: 'config_error', message: 'MONGODB_URI (or MONGO_URI) is required.' }, null, 2));
    return EXIT.ERROR;
  }

  await mongoose.connect(uri);
  try {
    const result = await runStoneHousePricingPatch({
      Cabin,
      apply: parsed.apply
    });
    console.log(JSON.stringify({ kind: 'stone_house_pricing_patch', ...result.report }, null, 2));
    return result.exitCode;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch(async (err) => {
      console.error(JSON.stringify({
        kind: 'fatal_error',
        message: err?.message || String(err)
      }, null, 2));
      try {
        await mongoose.disconnect();
      } catch {
        // ignore
      }
      process.exit(EXIT.ERROR);
    });
}

module.exports = { main, parseArgs, runStoneHousePricingPatch };
