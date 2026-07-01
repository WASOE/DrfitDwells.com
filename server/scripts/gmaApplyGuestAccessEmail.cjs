#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * GMA-GUEST-ACCESS-1 — insert access email templates + rules (shadow only).
 *
 * Insert-only for new rows. Does not enable rules or set mode:auto.
 * Does not send email.
 *
 * Dry-run (default):
 *   node scripts/gmaApplyGuestAccessEmail.cjs
 *
 * Apply:
 *   node scripts/gmaApplyGuestAccessEmail.cjs --apply
 *
 * Production apply requires ALLOW_PRODUCTION_GMA_GUEST_ACCESS=1
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const MessageTemplate = require('../models/MessageTemplate');
const MessageAutomationRule = require('../models/MessageAutomationRule');
const { cabinAccessEmailTemplate } = require('../data/messageTemplates/access_day_before_the_cabin');
const { valleyAccessEmailTemplate } = require('../data/messageTemplates/access_day_before_the_valley');
const {
  checkInAccessDayBeforeCabinRule,
  checkInAccessDayBeforeValleyRule
} = require('../data/messageAutomationRules');

const TEMPLATE_ROWS = [cabinAccessEmailTemplate, valleyAccessEmailTemplate];
const RULE_ROWS = [checkInAccessDayBeforeCabinRule, checkInAccessDayBeforeValleyRule];

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

function parseArgs(argv) {
  return { apply: argv.includes('--apply') };
}

function assertProductionGate(apply) {
  if (!apply) return;
  if (process.env.NODE_ENV !== 'production') return;
  if (String(process.env.ALLOW_PRODUCTION_GMA_GUEST_ACCESS || '').trim() === '1') return;
  console.error(
    '[gma-guest-access-apply] Refused: NODE_ENV=production. Set ALLOW_PRODUCTION_GMA_GUEST_ACCESS=1.'
  );
  process.exit(1);
}

async function insertAccessRows({ apply }) {
  const templates = TEMPLATE_ROWS.map((row) => pickModelFields(row, TEMPLATE_MODEL_FIELDS));
  const rules = RULE_ROWS.map((row) => pickModelFields(row, RULE_MODEL_FIELDS));

  const summary = {
    templates: { wouldInsert: 0, inserted: 0, skipped: 0 },
    rules: { wouldInsert: 0, inserted: 0, skipped: 0 }
  };

  for (const row of templates) {
    const existing = await MessageTemplate.findOne({
      key: row.key,
      channel: row.channel,
      locale: row.locale,
      propertyKind: row.propertyKind,
      version: row.version
    }).lean();
    if (existing) {
      summary.templates.skipped += 1;
      console.log('[gma-guest-access-apply] template exists:', row.key, row.propertyKind);
      continue;
    }
    summary.templates.wouldInsert += 1;
    if (apply) {
      await MessageTemplate.create(row);
      summary.templates.inserted += 1;
      console.log('[gma-guest-access-apply] inserted template:', row.key, row.propertyKind);
    } else {
      console.log('[gma-guest-access-apply] DRY-RUN would insert template:', row.key, row.propertyKind);
    }
  }

  for (const row of rules) {
    const existing = await MessageAutomationRule.findOne({ ruleKey: row.ruleKey }).lean();
    if (existing) {
      summary.rules.skipped += 1;
      console.log('[gma-guest-access-apply] rule exists:', row.ruleKey, {
        enabled: existing.enabled,
        mode: existing.mode
      });
      continue;
    }
    summary.rules.wouldInsert += 1;
    if (apply) {
      await MessageAutomationRule.create(row);
      summary.rules.inserted += 1;
      console.log('[gma-guest-access-apply] inserted rule:', row.ruleKey, {
        enabled: row.enabled,
        mode: row.mode,
        channelStrategy: row.channelStrategy
      });
    } else {
      console.log('[gma-guest-access-apply] DRY-RUN would insert rule:', row.ruleKey, {
        enabled: row.enabled,
        mode: row.mode
      });
    }
  }

  return summary;
}

function printRolloutNotes() {
  console.log('\n=== ROLLOUT (manual) ===');
  console.log('1. Run: node scripts/gmaPreviewGuestAccessEmails.cjs');
  console.log('2. Approve previews — fix any manual_review / blocked rows');
  console.log('3. Approve templates in OPS if required by your process');
  console.log('4. Enable rules + set mode:auto + email_only in OPS (not done by this script)');
  console.log('shadow_only: this script never enables rules or sets auto');
  console.log('no_emails_sent: insert templates/rules only');
}

async function main() {
  const { apply } = parseArgs(process.argv.slice(2));
  assertProductionGate(apply);

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  if (!uri) {
    console.error('[gma-guest-access-apply] MONGODB_URI required.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`[gma-guest-access-apply] Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);

  const summary = await insertAccessRows({ apply });
  console.log('\n=== INSERT SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));

  printRolloutNotes();
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[gma-guest-access-apply] Fatal:', err?.message || err);
    mongoose.disconnect().finally(() => process.exit(1));
  });
}

module.exports = {
  TEMPLATE_ROWS,
  RULE_ROWS,
  insertAccessRows
};
