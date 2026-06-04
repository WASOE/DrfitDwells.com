#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * GMA — replace MessageTemplate copy with approved bilingual content.
 *
 * Targets exactly 7 templates (see gmaApprovedCopy.js).
 * Does not approve templates, enable rules, or send messages.
 *
 * Dry-run (default):
 *   node scripts/gmaReplaceTemplateCopy.cjs
 *
 * Apply:
 *   node scripts/gmaReplaceTemplateCopy.cjs --apply
 *
 * Production apply requires ALLOW_PRODUCTION_GMA_TEMPLATE_COPY=1
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const MessageTemplate = require('../models/MessageTemplate');
const { GMA_TEMPLATE_COPY_TARGETS } = require('../data/messageTemplates/gmaApprovedCopy');

function parseArgs(argv) {
  return { apply: argv.includes('--apply') };
}

function isProductionApplyAllowed(apply) {
  if (!apply) return true;
  if (process.env.NODE_ENV !== 'production') return true;
  return String(process.env.ALLOW_PRODUCTION_GMA_TEMPLATE_COPY || '').trim() === '1';
}

function assertProductionGate(apply) {
  if (isProductionApplyAllowed(apply)) return;
  console.error(
    '[gma-template-copy] Refused: NODE_ENV=production. Set ALLOW_PRODUCTION_GMA_TEMPLATE_COPY=1 to apply.'
  );
  process.exit(1);
}

function pickCopySlice(doc) {
  return {
    emailSubject: doc?.emailSubject ?? null,
    emailBodyMarkup: doc?.emailBodyMarkup ?? null,
    variableSchema: doc?.variableSchema ?? null,
    notes: doc?.notes ?? null,
    status: doc?.status ?? null
  };
}

function copySlicesEqual(a, b) {
  return (
    a.emailSubject === b.emailSubject
    && a.emailBodyMarkup === b.emailBodyMarkup
    && JSON.stringify(a.variableSchema) === JSON.stringify(b.variableSchema)
    && a.notes === b.notes
  );
}

function identityQuery(target) {
  return {
    key: target.key,
    channel: target.channel,
    locale: target.locale,
    propertyKind: target.propertyKind,
    version: target.version
  };
}

function identityMatches(doc, target) {
  if (!doc) return false;
  return (
    doc.key === target.key
    && doc.channel === target.channel
    && doc.locale === target.locale
    && doc.propertyKind === target.propertyKind
    && doc.version === target.version
  );
}

function printPreviewLine({ target, status, before, after }) {
  console.log(`\n--- ${target.label} — ${status} ---`);
  console.log('BEFORE:', JSON.stringify(before, null, 2));
  if (after) {
    console.log('AFTER:', JSON.stringify(after, null, 2));
  }
}

/**
 * @returns {{ summary: object, fatal: boolean }}
 */
async function runReplaceTemplateCopy({ apply }) {
  const summary = {
    already_correct: 0,
    to_write: 0,
    written: 0,
    missing: 0,
    mismatch: 0
  };

  let fatal = false;

  const count = await MessageTemplate.countDocuments({});
  const resolved = [];

  for (const target of GMA_TEMPLATE_COPY_TARGETS) {
    const doc = await MessageTemplate.findOne(identityQuery(target)).lean();

    if (!doc) {
      console.error(`[gma-template-copy] Missing template: ${target.label}`);
      summary.missing += 1;
      fatal = true;
      continue;
    }

    if (!identityMatches(doc, target)) {
      console.error(
        `[gma-template-copy] Identity mismatch for ${target.label}: `
        + JSON.stringify({
          expected: identityQuery(target),
          actual: {
            key: doc.key,
            channel: doc.channel,
            locale: doc.locale,
            propertyKind: doc.propertyKind,
            version: doc.version
          }
        })
      );
      summary.mismatch += 1;
      fatal = true;
      continue;
    }

    resolved.push({ target, doc });
  }

  if (count !== GMA_TEMPLATE_COPY_TARGETS.length) {
    console.error(
      `[gma-template-copy] Expected exactly ${GMA_TEMPLATE_COPY_TARGETS.length} MessageTemplate rows, found ${count}`
    );
    fatal = true;
    if (count > GMA_TEMPLATE_COPY_TARGETS.length) {
      summary.mismatch += 1;
    }
  }

  if (fatal) {
    return { summary, fatal };
  }

  for (const { target, doc } of resolved) {
    const before = pickCopySlice(doc);

    if (copySlicesEqual(before, target.desired)) {
      summary.already_correct += 1;
      printPreviewLine({ target, status: 'already_correct', before, after: null });
      continue;
    }

    summary.to_write += 1;
    printPreviewLine({
      target,
      status: apply ? 'will_write' : 'would_write',
      before,
      after: {
        emailSubject: target.desired.emailSubject,
        emailBodyMarkup: target.desired.emailBodyMarkup,
        variableSchema: target.desired.variableSchema,
        notes: target.desired.notes,
        status: doc.status
      }
    });

    if (!apply) continue;

    await MessageTemplate.updateOne(
      { _id: doc._id },
      {
        $set: {
          emailSubject: target.desired.emailSubject,
          emailBodyMarkup: target.desired.emailBodyMarkup,
          variableSchema: target.desired.variableSchema,
          notes: target.desired.notes
        }
      }
    );
    summary.written += 1;
  }

  return { summary, fatal };
}

async function main() {
  const { apply } = parseArgs(process.argv.slice(2));
  assertProductionGate(apply);

  const uri = process.env.MONGODB_URI || DEFAULT_MONGO_URI;
  if (!uri) {
    console.error('[gma-template-copy] MONGODB_URI (or DEFAULT_MONGO_URI) is required.');
    process.exit(1);
  }

  await mongoose.connect(uri);

  console.log(`[gma-template-copy] Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`[gma-template-copy] Targets: ${GMA_TEMPLATE_COPY_TARGETS.length}`);

  const { summary, fatal } = await runReplaceTemplateCopy({ apply });

  console.log('\n=== Summary ===');
  console.log(JSON.stringify(summary, null, 2));

  await mongoose.disconnect();

  if (fatal) {
    process.exit(1);
  }
  if (apply && summary.to_write > 0 && summary.written !== summary.to_write) {
    process.exit(1);
  }
}

module.exports = {
  GMA_TEMPLATE_COPY_TARGETS,
  isProductionApplyAllowed,
  assertProductionGate,
  pickCopySlice,
  copySlicesEqual,
  runReplaceTemplateCopy
};

if (require.main === module) {
  main().catch((err) => {
    console.error('[gma-template-copy] Fatal:', err?.message || err);
    mongoose.disconnect().finally(() => process.exit(1));
  });
}
