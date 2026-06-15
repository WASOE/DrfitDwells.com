#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * OPS-PUSH-6 — sync MongoDB indexes for OPS push collections.
 *
 * Dry-run (default — no writes):
 *   node scripts/opsPushSyncIndexes.cjs
 *
 * Apply:
 *   node scripts/opsPushSyncIndexes.cjs --apply
 *
 * Production apply requires ALLOW_PRODUCTION_OPS_PUSH_INDEX_SYNC=1.
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

const OpsPushSubscription = require('../models/OpsPushSubscription');
const OpsNotification = require('../models/OpsNotification');
const OpsPushScheduledJob = require('../models/OpsPushScheduledJob');

const MODELS = Object.freeze([
  { name: 'OpsPushSubscription', model: OpsPushSubscription },
  { name: 'OpsNotification', model: OpsNotification },
  { name: 'OpsPushScheduledJob', model: OpsPushScheduledJob }
]);

function printHelp() {
  console.log(`OPS push index sync

Usage:
  node scripts/opsPushSyncIndexes.cjs [--apply] [--help]

Modes:
  (default)  Dry-run — list existing and expected indexes; no syncIndexes()
  --apply    Call Model.syncIndexes() for each OPS push model

Requirements:
  MONGODB_URI must be set.

Production:
  --apply in NODE_ENV=production requires ALLOW_PRODUCTION_OPS_PUSH_INDEX_SYNC=1
`);
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { help: true, apply: false };
  }
  return { help: false, apply: argv.includes('--apply') };
}

function formatIndexSpec(index) {
  const key = index.key || index;
  const options = { ...index };
  delete options.key;
  delete options.ns;
  delete options.v;
  delete options.name;
  const optionKeys = Object.keys(options).filter((k) => options[k] != null);
  if (optionKeys.length === 0) {
    return JSON.stringify(key);
  }
  return `${JSON.stringify(key)} ${JSON.stringify(options)}`;
}

function getExpectedIndexes(model) {
  return model.schema.indexes().map(([fields, options]) => ({
    key: fields,
    options: options || {},
    label: formatIndexSpec({ key: fields, ...options })
  }));
}

async function listExistingIndexes(model) {
  const collection = model.collection;
  const raw = await collection.indexes();
  return raw.map((index) => ({
    name: index.name,
    key: index.key,
    label: formatIndexSpec(index)
  }));
}

function printModelReport({ modelName, collectionName, existing, expected, mode }) {
  console.log(
    JSON.stringify(
      {
        kind: 'ops_push_index_report',
        mode,
        model: modelName,
        collection: collectionName,
        existingIndexes: existing,
        expectedIndexes: expected.map((row) => ({
          key: row.key,
          options: row.options,
          label: row.label
        }))
      },
      null,
      2
    )
  );
}

async function runDryRun() {
  console.log(JSON.stringify({ kind: 'ops_push_index_sync', mode: 'dry-run' }, null, 2));
  for (const entry of MODELS) {
    const existing = await listExistingIndexes(entry.model);
    const expected = getExpectedIndexes(entry.model);
    printModelReport({
      modelName: entry.name,
      collectionName: entry.model.collection.collectionName,
      existing,
      expected,
      mode: 'dry-run'
    });
  }
}

async function runApply() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRODUCTION_OPS_PUSH_INDEX_SYNC !== '1') {
    console.error(
      JSON.stringify(
        {
          kind: 'apply_refused',
          reason: 'production_without_explicit_allow',
          guidance: 'Set ALLOW_PRODUCTION_OPS_PUSH_INDEX_SYNC=1 to apply in production.'
        },
        null,
        2
      )
    );
    return 1;
  }

  console.log(JSON.stringify({ kind: 'ops_push_index_sync', mode: 'apply' }, null, 2));
  for (const entry of MODELS) {
    const existing = await listExistingIndexes(entry.model);
    const expected = getExpectedIndexes(entry.model);
    printModelReport({
      modelName: entry.name,
      collectionName: entry.model.collection.collectionName,
      existing,
      expected,
      mode: 'apply-before'
    });

    const result = await entry.model.syncIndexes();
    console.log(
      JSON.stringify(
        {
          kind: 'sync_indexes_result',
          model: entry.name,
          collection: entry.model.collection.collectionName,
          result
        },
        null,
        2
      )
    );

    const after = await listExistingIndexes(entry.model);
    printModelReport({
      modelName: entry.name,
      collectionName: entry.model.collection.collectionName,
      existing: after,
      expected,
      mode: 'apply-after'
    });
  }
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
    if (args.apply) {
      return await runApply();
    }
    await runDryRun();
    return 0;
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
  MODELS,
  getExpectedIndexes,
  formatIndexSpec
};
