#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Batch 5 — Seed `MessageTemplate` and `MessageAutomationRule` rows.
 *
 * Modes:
 *
 *   Dry-run (default — NO WRITES):
 *     node scripts/seedMessageAutomation.js
 *
 *   Apply (explicit, insert-only):
 *     node scripts/seedMessageAutomation.js --apply
 *
 * Rules (per docs/guest-message-automation/03_IMPLEMENTATION_BATCHES.md
 * Batch 5 and the Batch 5 implementation decisions):
 *
 *   - Dry-run is the default and never mutates data.
 *   - Apply is INSERT-ONLY. Existing rows are never updated, never deleted.
 *   - Apply is idempotent: a second run is a no-op summary.
 *   - All seeded rules ship `enabled: false, mode: 'shadow'`.
 *   - All seeded templates ship `status: 'draft'` (final copy is OPEN).
 *   - Production apply requires `ALLOW_PRODUCTION_SEED=1`. Dry-run is
 *     always allowed.
 *   - No public route. No OPS UI button. Engineer/operator shell only.
 *   - Reads only `MessageTemplate` and `MessageAutomationRule`. Never
 *     touches `Booking`, `EmailEvent`, or the legacy email pipeline.
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const MessageTemplate = require('../models/MessageTemplate');
const MessageAutomationRule = require('../models/MessageAutomationRule');

const { cabinWhatsappTemplate, cabinEmailTemplate } = require('../data/messageTemplates/arrival_3d_the_cabin');
const { valleyWhatsappTemplate, valleyEmailTemplate } = require('../data/messageTemplates/arrival_3d_the_valley');
const {
  opsAlertArriving8dTemplate,
  opsAlertCheckInTomorrowTemplate,
  opsAlertCheckoutTodayTemplate
} = require('../data/messageTemplates/opsAlerts');
const { MESSAGE_AUTOMATION_RULES } = require('../data/messageAutomationRules');

const TEMPLATE_MODEL_FIELDS = Object.freeze([
  'key',
  'version',
  'channel',
  'locale',
  'propertyKind',
  'status',
  'whatsappTemplateName',
  'whatsappLocale',
  'emailSubject',
  'emailBodyMarkup',
  'variableSchema',
  'notes',
  'approvedBy',
  'approvedAt'
]);

const RULE_MODEL_FIELDS = Object.freeze([
  'ruleKey',
  'description',
  'triggerType',
  'triggerConfig',
  'propertyScope',
  'channelStrategy',
  'templateKeyByChannel',
  'requiresConsent',
  'enabled',
  'mode',
  'audience',
  'requiredBookingStatus',
  'requirePaidIfStripe'
]);

function pickModelFields(source, allowed) {
  const out = {};
  for (const field of allowed) {
    if (Object.prototype.hasOwnProperty.call(source, field) && source[field] !== undefined) {
      out[field] = source[field];
    }
  }
  return out;
}

function buildAllTemplates() {
  return [
    cabinWhatsappTemplate,
    cabinEmailTemplate,
    valleyWhatsappTemplate,
    valleyEmailTemplate,
    opsAlertArriving8dTemplate,
    opsAlertCheckInTomorrowTemplate,
    opsAlertCheckoutTodayTemplate
  ].map((row) => pickModelFields(row, TEMPLATE_MODEL_FIELDS));
}

function buildAllRules() {
  return MESSAGE_AUTOMATION_RULES.map((row) => pickModelFields(row, RULE_MODEL_FIELDS));
}

function parseArgs(argv) {
  return {
    apply: argv.includes('--apply')
  };
}

function templateLookupKey(row) {
  return {
    key: row.key,
    channel: row.channel,
    locale: row.locale,
    propertyKind: row.propertyKind,
    version: row.version
  };
}

function ruleLookupKey(row) {
  return { ruleKey: row.ruleKey };
}

function templateReport(row) {
  return {
    kind: 'MessageTemplate',
    key: row.key,
    channel: row.channel,
    locale: row.locale,
    propertyKind: row.propertyKind,
    version: row.version,
    status: row.status
  };
}

function ruleReport(row) {
  return {
    kind: 'MessageAutomationRule',
    ruleKey: row.ruleKey,
    audience: row.audience,
    propertyScope: row.propertyScope,
    channelStrategy: row.channelStrategy,
    enabled: row.enabled,
    mode: row.mode
  };
}

async function classifyTemplates(rows) {
  const buckets = { to_insert: [], already_present: [] };
  for (const row of rows) {
    const existing = await MessageTemplate.findOne(templateLookupKey(row)).lean();
    if (existing) {
      buckets.already_present.push({ desired: templateReport(row), existingId: String(existing._id) });
    } else {
      buckets.to_insert.push({ desired: templateReport(row), row });
    }
  }
  return buckets;
}

async function classifyRules(rows) {
  const buckets = { to_insert: [], already_present: [] };
  for (const row of rows) {
    const existing = await MessageAutomationRule.findOne(ruleLookupKey(row)).lean();
    if (existing) {
      buckets.already_present.push({ desired: ruleReport(row), existingId: String(existing._id) });
    } else {
      buckets.to_insert.push({ desired: ruleReport(row), row });
    }
  }
  return buckets;
}

function printReport({ mode, templateBuckets, ruleBuckets, willApply }) {
  const summary = {
    kind: 'summary',
    mode,
    willApply,
    templates: {
      to_insert: templateBuckets.to_insert.length,
      already_present: templateBuckets.already_present.length
    },
    rules: {
      to_insert: ruleBuckets.to_insert.length,
      already_present: ruleBuckets.already_present.length
    }
  };
  console.log(JSON.stringify(summary, null, 2));

  if (templateBuckets.to_insert.length > 0) {
    console.log(
      JSON.stringify(
        { kind: 'templates_to_insert', rows: templateBuckets.to_insert.map((e) => e.desired) },
        null,
        2
      )
    );
  }
  if (ruleBuckets.to_insert.length > 0) {
    console.log(
      JSON.stringify(
        { kind: 'rules_to_insert', rows: ruleBuckets.to_insert.map((e) => e.desired) },
        null,
        2
      )
    );
  }
  if (templateBuckets.already_present.length > 0) {
    console.log(
      JSON.stringify(
        {
          kind: 'templates_already_present',
          rows: templateBuckets.already_present.map((e) => ({ ...e.desired, existingId: e.existingId }))
        },
        null,
        2
      )
    );
  }
  if (ruleBuckets.already_present.length > 0) {
    console.log(
      JSON.stringify(
        {
          kind: 'rules_already_present',
          rows: ruleBuckets.already_present.map((e) => ({ ...e.desired, existingId: e.existingId }))
        },
        null,
        2
      )
    );
  }
}

async function applyInserts({ templateBuckets, ruleBuckets }) {
  const writes = { templates: [], rules: [] };

  for (const entry of templateBuckets.to_insert) {
    try {
      const created = await MessageTemplate.create(entry.row);
      writes.templates.push({ ...entry.desired, inserted: true, _id: String(created._id) });
    } catch (err) {
      // E11000 here means a concurrent run beat us to the insert; treat as
      // already-present rather than failing the whole batch.
      if (err && (err.code === 11000 || /E11000/.test(String(err.message)))) {
        writes.templates.push({ ...entry.desired, inserted: false, skipped: 'race_already_present' });
      } else {
        throw err;
      }
    }
  }

  for (const entry of ruleBuckets.to_insert) {
    try {
      const created = await MessageAutomationRule.create(entry.row);
      writes.rules.push({ ...entry.desired, inserted: true, _id: String(created._id) });
    } catch (err) {
      if (err && (err.code === 11000 || /E11000/.test(String(err.message)))) {
        writes.rules.push({ ...entry.desired, inserted: false, skipped: 'race_already_present' });
      } else {
        throw err;
      }
    }
  }

  return writes;
}

async function runSeed({ apply, connection }) {
  const templates = buildAllTemplates();
  const rules = buildAllRules();

  const templateBuckets = await classifyTemplates(templates);
  const ruleBuckets = await classifyRules(rules);

  printReport({
    mode: apply ? 'apply' : 'dry-run',
    templateBuckets,
    ruleBuckets,
    willApply: Boolean(apply)
  });

  if (!apply) {
    return { exitCode: 0, writes: null };
  }

  if (
    process.env.NODE_ENV === 'production'
    && process.env.ALLOW_PRODUCTION_SEED !== '1'
  ) {
    console.error(
      JSON.stringify(
        {
          kind: 'apply_refused',
          reason: 'production_without_explicit_allow',
          guidance:
            'Re-run with ALLOW_PRODUCTION_SEED=1 in the environment if intentional. Dry-run is unaffected.'
        },
        null,
        2
      )
    );
    return { exitCode: 1, writes: null };
  }

  if (templateBuckets.to_insert.length === 0 && ruleBuckets.to_insert.length === 0) {
    console.log(
      JSON.stringify(
        { kind: 'apply_noop', message: 'Nothing to insert; all desired rows already present.' },
        null,
        2
      )
    );
    return { exitCode: 0, writes: { templates: [], rules: [] } };
  }

  const writes = await applyInserts({ templateBuckets, ruleBuckets });
  console.log(JSON.stringify({ kind: 'apply_results', ...writes }, null, 2));

  // `connection` is intentionally unused on purpose; the caller manages it.
  void connection;

  return { exitCode: 0, writes };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;

  await mongoose.connect(mongoUri);
  try {
    const result = await runSeed({ apply: args.apply, connection: mongoose.connection });
    return result.exitCode;
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
  buildAllTemplates,
  buildAllRules,
  classifyTemplates,
  classifyRules,
  applyInserts,
  runSeed
};
