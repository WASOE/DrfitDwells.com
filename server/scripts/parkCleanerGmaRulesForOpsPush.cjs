#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * OPS-PUSH-6 — park obsolete cleaner checkout-today GMA rules superseded by OPS push.
 *
 * Dry-run (default):
 *   node scripts/parkCleanerGmaRulesForOpsPush.cjs
 *
 * Apply:
 *   node scripts/parkCleanerGmaRulesForOpsPush.cjs --apply
 *
 * Production apply requires ALLOW_PRODUCTION_GMA_PARK=1.
 * Does not delete rules or touch templates.
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

const MessageAutomationRule = require('../models/MessageAutomationRule');

const TARGET_RULE_KEYS = Object.freeze([
  'cleaner_checkout_today_cabin',
  'cleaner_checkout_today_valley'
]);

const DESCRIPTION_MARKER = '[OPS-PUSH superseded — do not enable]';

function printHelp() {
  console.log(`Park cleaner checkout-today GMA rules for OPS push

Usage:
  node scripts/parkCleanerGmaRulesForOpsPush.cjs [--apply] [--help]

Targets only:
  - cleaner_checkout_today_cabin
  - cleaner_checkout_today_valley

Does NOT touch prep rules, guest rules, ops_alert rules, or templates.

Requirements:
  MONGODB_URI must be set.

Production:
  --apply in NODE_ENV=production requires ALLOW_PRODUCTION_GMA_PARK=1
`);
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { help: true, apply: false };
  }
  return { help: false, apply: argv.includes('--apply') };
}

function buildDescription(current) {
  const base = String(current || '').trim();
  if (base.includes(DESCRIPTION_MARKER)) {
    return base;
  }
  return base ? `${base} ${DESCRIPTION_MARKER}` : DESCRIPTION_MARKER;
}

function buildUpdate(row) {
  return {
    enabled: false,
    mode: 'shadow',
    description: buildDescription(row.description)
  };
}

function summarizeRow(row) {
  return {
    ruleKey: row.ruleKey,
    enabled: row.enabled,
    mode: row.mode,
    description: row.description,
    audience: row.audience,
    propertyScope: row.propertyScope
  };
}

async function loadTargetRules() {
  return MessageAutomationRule.find({ ruleKey: { $in: [...TARGET_RULE_KEYS] } }).lean();
}

async function runDryRun(rows) {
  console.log(
    JSON.stringify(
      {
        kind: 'park_cleaner_gma_rules',
        mode: 'dry-run',
        targetRuleKeys: TARGET_RULE_KEYS,
        matchedCount: rows.length
      },
      null,
      2
    )
  );

  if (rows.length === 0) {
    console.log(JSON.stringify({ kind: 'noop', message: 'No matching MessageAutomationRule rows found.' }, null, 2));
    return 0;
  }

  for (const row of rows) {
    const proposed = buildUpdate(row);
    const changed =
      row.enabled !== proposed.enabled ||
      row.mode !== proposed.mode ||
      row.description !== proposed.description;

    console.log(
      JSON.stringify(
        {
          kind: 'proposed_update',
          current: summarizeRow(row),
          proposed,
          willChange: changed
        },
        null,
        2
      )
    );
  }
  return 0;
}

async function runApply(rows) {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRODUCTION_GMA_PARK !== '1') {
    console.error(
      JSON.stringify(
        {
          kind: 'apply_refused',
          reason: 'production_without_explicit_allow',
          guidance: 'Set ALLOW_PRODUCTION_GMA_PARK=1 to apply in production.'
        },
        null,
        2
      )
    );
    return 1;
  }

  console.log(
    JSON.stringify(
      {
        kind: 'park_cleaner_gma_rules',
        mode: 'apply',
        targetRuleKeys: TARGET_RULE_KEYS,
        matchedCount: rows.length
      },
      null,
      2
    )
  );

  if (rows.length === 0) {
    console.log(JSON.stringify({ kind: 'noop', message: 'No matching MessageAutomationRule rows found.' }, null, 2));
    return 0;
  }

  const results = [];
  for (const row of rows) {
    const proposed = buildUpdate(row);
    const res = await MessageAutomationRule.updateOne(
      { _id: row._id },
      { $set: proposed }
    );
    results.push({
      ruleKey: row.ruleKey,
      matched: res.matchedCount,
      modified: res.modifiedCount,
      proposed
    });
  }

  console.log(JSON.stringify({ kind: 'apply_results', results }, null, 2));
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('MONGODB_URI is required.');
    return 1;
  }

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 20000 });
  try {
    const rows = await loadTargetRules();
    if (args.apply) {
      return await runApply(rows);
    }
    return await runDryRun(rows);
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch(async (err) => {
      console.error(err?.stack || err?.message || err);
      try {
        await mongoose.disconnect();
      } catch {
        // ignore
      }
      process.exit(1);
    });
}

module.exports = {
  TARGET_RULE_KEYS,
  DESCRIPTION_MARKER,
  buildDescription,
  buildUpdate
};
