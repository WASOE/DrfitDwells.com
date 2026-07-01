#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Apply English-only guest arrival EMAIL copy to MessageTemplate rows.
 *
 * Targets only:
 *   arrival_3d_the_cabin / email / en / cabin / v1
 *   arrival_3d_the_valley / email / en / valley / v1
 *
 * Does not touch WhatsApp templates, rules, or template status (approved stays approved).
 * Does not send email.
 *
 * Dry-run (default):
 *   node scripts/gmaApplyGuestArrivalEmailEnOnly.cjs
 *
 * Apply:
 *   node scripts/gmaApplyGuestArrivalEmailEnOnly.cjs --apply
 *
 * Preview (after apply or when DB already matches source):
 *   node scripts/gmaApplyGuestArrivalEmailEnOnly.cjs --preview
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const MessageTemplate = require('../models/MessageTemplate');
const {
  CABIN_EMAIL_SUBJECT,
  CABIN_EMAIL_BODY,
  VALLEY_EMAIL_SUBJECT,
  VALLEY_EMAIL_BODY
} = require('../data/messageTemplates/gmaApprovedCopy');
const { previewGmaMessageForReservation } = require('../services/messaging/messageTemplatePreviewService');

const TARGETS = Object.freeze([
  {
    label: 'arrival_3d_the_cabin / email',
    query: { key: 'arrival_3d_the_cabin', channel: 'email', locale: 'en', propertyKind: 'cabin', version: 1 },
    desired: { emailSubject: CABIN_EMAIL_SUBJECT, emailBodyMarkup: CABIN_EMAIL_BODY },
    preview: {
      reservationId: '6a2912e774dcf49733f7e9a4',
      ruleKey: 'arrival_instructions_pre_arrival_cabin',
      channel: 'email'
    }
  },
  {
    label: 'arrival_3d_the_valley / email',
    query: { key: 'arrival_3d_the_valley', channel: 'email', locale: 'en', propertyKind: 'valley', version: 1 },
    desired: { emailSubject: VALLEY_EMAIL_SUBJECT, emailBodyMarkup: VALLEY_EMAIL_BODY },
    preview: {
      reservationId: '6a09995fa863be686608319f',
      ruleKey: 'arrival_instructions_pre_arrival_valley',
      channel: 'email'
    }
  }
]);

function parseArgs(argv) {
  return {
    apply: argv.includes('--apply'),
    preview: argv.includes('--preview')
  };
}

function assertProductionGate(apply) {
  if (!apply) return;
  if (process.env.NODE_ENV !== 'production') return;
  if (String(process.env.ALLOW_PRODUCTION_GMA_TEMPLATE_COPY || '').trim() === '1') return;
  console.error(
    '[gma-email-en-only] Refused: NODE_ENV=production. Set ALLOW_PRODUCTION_GMA_TEMPLATE_COPY=1 to apply.'
  );
  process.exit(1);
}

function slicesEqual(before, desired) {
  return before.emailSubject === desired.emailSubject
    && before.emailBodyMarkup === desired.emailBodyMarkup;
}

async function runApply({ apply }) {
  const results = [];
  for (const target of TARGETS) {
    const doc = await MessageTemplate.findOne(target.query).lean();
    if (!doc) {
      console.error(`[gma-email-en-only] Missing template: ${target.label}`);
      process.exit(1);
    }
    const before = {
      emailSubject: doc.emailSubject,
      emailBodyMarkup: doc.emailBodyMarkup,
      status: doc.status
    };
    const row = {
      label: target.label,
      _id: String(doc._id),
      status: doc.status,
      beforeSubject: before.emailSubject,
      afterSubject: target.desired.emailSubject,
      alreadyCorrect: slicesEqual(before, target.desired),
      modified: 0
    };
    if (!row.alreadyCorrect && apply) {
      const r = await MessageTemplate.updateOne(
        { _id: doc._id },
        { $set: target.desired }
      );
      row.modified = r.modifiedCount || 0;
    }
    results.push(row);
    console.log(JSON.stringify(row, null, 2));
  }
  return results;
}

async function runPreview() {
  const previews = [];
  for (const target of TARGETS) {
    try {
      const data = await previewGmaMessageForReservation(target.preview);
      previews.push({
        label: target.label,
        bookingId: data.bookingId,
        ruleKey: data.ruleKey,
        templateStatus: data.template.status,
        subject: data.email?.subject || null,
        text: data.email?.text || null,
        hasBulgarianSection: Boolean(
          data.email?.fragmentHtml?.includes('lang="bg"')
          || (data.email?.text && /Здравейте/.test(data.email.text))
        )
      });
      console.log(`\n=== PREVIEW ${target.label} ===`);
      console.log('subject:', data.email?.subject || '');
      console.log('--- plain text ---');
      console.log(data.email?.text || '');
    } catch (err) {
      console.error(`[gma-email-en-only] Preview failed for ${target.label}:`, err?.message || err);
      process.exit(1);
    }
  }
  return previews;
}

function printEnvSafety() {
  const flags = [
    'MESSAGE_ORCHESTRATOR_ENABLED',
    'MESSAGE_SCHEDULER_WORKER_ENABLED',
    'MESSAGE_DISPATCHER_ENABLED',
    'MESSAGE_EMAIL_PROVIDER_ENABLED'
  ];
  const out = {};
  for (const k of flags) out[k] = process.env[k] || null;
  console.log('\n=== ENV (GMA safety) ===');
  console.log(JSON.stringify(out, null, 2));
  console.log('shadow_only: rules unchanged by this script');
  console.log('no_emails_sent: preview/apply only update MessageTemplate copy');
}

async function main() {
  const { apply, preview } = parseArgs(process.argv.slice(2));
  assertProductionGate(apply);

  const uri = process.env.MONGODB_URI || DEFAULT_MONGO_URI;
  if (!uri) {
    console.error('[gma-email-en-only] MONGODB_URI required.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`[gma-email-en-only] Mode: ${apply ? 'APPLY' : 'DRY-RUN'}${preview ? ' + PREVIEW' : ''}`);

  await runApply({ apply });
  if (preview) {
    await runPreview();
  }
  printEnvSafety();

  await mongoose.disconnect();
}

module.exports = { TARGETS, runApply, runPreview, slicesEqual };

if (require.main === module) {
  main().catch((err) => {
    console.error('[gma-email-en-only] Fatal:', err?.message || err);
    mongoose.disconnect().finally(() => process.exit(1));
  });
}
