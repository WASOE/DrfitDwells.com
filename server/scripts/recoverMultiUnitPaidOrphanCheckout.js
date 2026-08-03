#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * S0 — Allowlisted multi-unit paid-orphan recovery CLI.
 *
 * Dry-run (default, zero writes):
 *   node server/scripts/recoverMultiUnitPaidOrphanCheckout.js \
 *     --allowlist=docs/checkout-payment-architecture/examples/multi-unit-paid-orphan-allowlist.example.json
 *
 * Execute (initial):
 *   MULTI_UNIT_PAID_ORPHAN_RECOVERY=1 node server/scripts/recoverMultiUnitPaidOrphanCheckout.js \
 *     --execute \
 *     --allowlist=/secure/path/ops-approved-allowlist.json \
 *     --evidence=/secure/path/dry-run-evidence.json \
 *     --digest=<sha256> \
 *     --phrase='I CONFIRM THE GUEST INTENDS TO PURCHASE A SECOND PHYSICAL A-FRAME' \
 *     --operator=ops:alice \
 *     --intent-at=2026-08-03T12:00:00.000Z \
 *     --reason='Guest confirmed second physical A-frame'
 *
 * Resume:
 *   MULTI_UNIT_PAID_ORPHAN_RECOVERY=1 node server/scripts/recoverMultiUnitPaidOrphanCheckout.js \
 *     --resume --execute ...same evidence/digest/phrase...
 *
 * Docs: docs/checkout-payment-architecture/04_MULTI_UNIT_PAID_ORPHAN_RECOVERY_CLI.md
 */
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const {
  recoverAllowlistedMultiUnitPaidOrphanCheckout,
  INTENT_PHRASE,
  MultiUnitPaidOrphanRecoveryError
} = require('../services/checkout/multiUnitPaidOrphanRecoveryService');

function printHelp() {
  console.log(`Usage: node server/scripts/recoverMultiUnitPaidOrphanCheckout.js --allowlist=<file> [options]

Required:
  --allowlist=<file>   JSON object with incident identities (fake IDs in example only)

Modes:
  --dry-run            Zero writes; print sanitized evidence + digest (default)
  --execute            Initial execute (requires MULTI_UNIT_PAID_ORPHAN_RECOVERY=1)
  --resume             Resume incomplete recovery (with --execute)

Execute / resume overlay:
  --evidence=<file>    Original dry-run evidence JSON
  --digest=<hex>       SHA-256 of canonicalEvidence
  --phrase=<text>      Exact confirmation phrase
  --operator=ops:<id>  Operator actor id
  --intent-at=<iso>    Operator intent timestamp
  --reason=<text>      Recovery reason (≤500)
  --resumed-by=ops:<id> Optional resume actor

Hard bans:
  no Stripe charge/refund, no SMTP, no confirmation-worker start,
  no capability-module import, no bypass flags.

See: docs/checkout-payment-architecture/04_MULTI_UNIT_PAID_ORPHAN_RECOVERY_CLI.md

Exact phrase:
  ${INTENT_PHRASE}
`);
}

function parseArgs(argv) {
  const out = {
    execute: false,
    resume: false,
    dryRun: true,
    allowlist: null,
    evidence: null,
    digest: null,
    phrase: null,
    operator: null,
    intentAt: null,
    reason: null,
    resumedBy: null,
    help: false
  };

  for (const token of argv.slice(2)) {
    if (token === '--help' || token === '-h') {
      out.help = true;
      continue;
    }
    if (token === '--execute') {
      out.execute = true;
      out.dryRun = false;
      continue;
    }
    if (token === '--resume') {
      out.resume = true;
      continue;
    }
    if (token === '--dry-run') {
      out.dryRun = true;
      out.execute = false;
      continue;
    }
    if (token.startsWith('--allowlist=')) {
      out.allowlist = token.slice('--allowlist='.length).trim() || null;
      continue;
    }
    if (token.startsWith('--evidence=')) {
      out.evidence = token.slice('--evidence='.length).trim() || null;
      continue;
    }
    if (token.startsWith('--digest=')) {
      out.digest = token.slice('--digest='.length).trim() || null;
      continue;
    }
    if (token.startsWith('--phrase=')) {
      out.phrase = token.slice('--phrase='.length);
      continue;
    }
    if (token.startsWith('--operator=')) {
      out.operator = token.slice('--operator='.length).trim() || null;
      continue;
    }
    if (token.startsWith('--intent-at=')) {
      out.intentAt = token.slice('--intent-at='.length).trim() || null;
      continue;
    }
    if (token.startsWith('--reason=')) {
      out.reason = token.slice('--reason='.length).trim() || null;
      continue;
    }
    if (token.startsWith('--resumed-by=')) {
      out.resumedBy = token.slice('--resumed-by='.length).trim() || null;
      continue;
    }
  }
  return out;
}

function loadJson(filePath) {
  const abs = path.resolve(filePath);
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.allowlist) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const allowlistRaw = loadJson(args.allowlist);
  const allowlist = Array.isArray(allowlistRaw) ? allowlistRaw[0] : allowlistRaw;

  const mongoUri = process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri);

  try {
    if (!args.execute) {
      const result = await recoverAllowlistedMultiUnitPaidOrphanCheckout({
        mode: 'dry-run',
        allowlist,
        execute: false
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (!args.evidence || !args.digest || !args.phrase || !args.operator || !args.intentAt || !args.reason) {
      console.error('Execute/resume requires --evidence --digest --phrase --operator --intent-at --reason');
      process.exit(1);
    }

    const originalEvidence = loadJson(args.evidence);
    const mode = args.resume ? 'resume' : 'initial';
    const result = await recoverAllowlistedMultiUnitPaidOrphanCheckout({
      mode,
      allowlist,
      originalEvidence,
      digest: args.digest,
      execute: true,
      intentOverlay: {
        confirmationPhrase: args.phrase,
        operatorActorId: args.operator,
        operatorIntentConfirmedAt: args.intentAt,
        recoveryReason: args.reason,
        resumedBy: args.resumedBy
      }
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    if (err instanceof MultiUnitPaidOrphanRecoveryError || err?.name === 'MultiUnitPaidOrphanRecoveryError') {
      console.error(JSON.stringify(err.toJSON ? err.toJSON() : { code: err.code, summary: err.message }, null, 2));
      process.exit(2);
    }
    console.error(err?.message || String(err));
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

main();
