#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * GMA — approve Cabin arrival MessageTemplate rows only (shadow rollout prep).
 *
 * Approves exactly two templates:
 *   - arrival_3d_the_cabin / email / en / cabin / v1
 *   - arrival_3d_the_cabin / whatsapp / en / cabin / v1
 *
 * Modes:
 *   Dry-run (default — NO WRITES):
 *     node scripts/gmaApproveCabinArrivalTemplates.cjs
 *
 *   Apply (explicit):
 *     node scripts/gmaApproveCabinArrivalTemplates.cjs --apply
 *
 * Production apply additionally requires:
 *   ALLOW_PRODUCTION_GMA_TEMPLATE_APPROVAL=1
 *
 * Does not approve Valley or OPS templates, enable rules, or send messages.
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const MessageTemplate = require('../models/MessageTemplate');

const APPROVED_BY = 'system:gma-cabin-shadow-rollout';

const TARGET_IDENTITY = Object.freeze({
  key: 'arrival_3d_the_cabin',
  locale: 'en',
  propertyKind: 'cabin',
  version: 1
});

const TARGETS = Object.freeze([
  { channel: 'email', label: 'arrival_3d_the_cabin / email' },
  { channel: 'whatsapp', label: 'arrival_3d_the_cabin / whatsapp' }
]);

function parseArgs(argv) {
  return { apply: argv.includes('--apply') };
}

function identityQuery(channel) {
  return {
    key: TARGET_IDENTITY.key,
    channel,
    locale: TARGET_IDENTITY.locale,
    propertyKind: TARGET_IDENTITY.propertyKind,
    version: TARGET_IDENTITY.version
  };
}

function pickApprovalSlice(doc) {
  return {
    status: doc?.status ?? null,
    approvedBy: doc?.approvedBy ?? null,
    approvedAt: doc?.approvedAt ?? null
  };
}

function identityMatches(doc) {
  if (!doc) return false;
  return (
    doc.key === TARGET_IDENTITY.key
    && doc.locale === TARGET_IDENTITY.locale
    && doc.propertyKind === TARGET_IDENTITY.propertyKind
    && doc.version === TARGET_IDENTITY.version
    && (doc.channel === 'email' || doc.channel === 'whatsapp')
  );
}

function isAlreadyApproved(doc) {
  return doc.status === 'approved' && doc.approvedBy === APPROVED_BY;
}

function buildDesiredApprovalSlice(approvedAt) {
  return {
    status: 'approved',
    approvedBy: APPROVED_BY,
    approvedAt
  };
}

function approvalSlicesEqual(current, desired) {
  return (
    current.status === desired.status
    && current.approvedBy === desired.approvedBy
    && isAlreadyApproved({ status: current.status, approvedBy: current.approvedBy })
  );
}

function isProductionApplyAllowed(apply) {
  if (!apply) return true;
  if (process.env.NODE_ENV !== 'production') return true;
  return String(process.env.ALLOW_PRODUCTION_GMA_TEMPLATE_APPROVAL || '').trim() === '1';
}

function assertProductionGate(apply) {
  if (isProductionApplyAllowed(apply)) return;
  console.error(
    '[gma-template-approval] Refused: NODE_ENV=production. '
    + 'Set ALLOW_PRODUCTION_GMA_TEMPLATE_APPROVAL=1 to apply.'
  );
  process.exit(1);
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
async function runApproval({ apply, now = new Date() }) {
  const summary = {
    already_correct: 0,
    to_write: 0,
    written: 0,
    missing: 0,
    mismatch: 0
  };

  let fatal = false;

  const cabinArrivalCount = await MessageTemplate.countDocuments({
    key: TARGET_IDENTITY.key,
    locale: TARGET_IDENTITY.locale,
    propertyKind: TARGET_IDENTITY.propertyKind
  });

  if (cabinArrivalCount !== TARGETS.length) {
    console.error(
      `[gma-template-approval] Expected exactly ${TARGETS.length} cabin templates for `
      + `${TARGET_IDENTITY.key} (${TARGET_IDENTITY.locale}/${TARGET_IDENTITY.propertyKind}), `
      + `found ${cabinArrivalCount}`
    );
    fatal = true;
    if (cabinArrivalCount > TARGETS.length) {
      summary.mismatch += 1;
    } else {
      summary.missing += 1;
    }
    return { summary, fatal };
  }

  const desiredAtApply = buildDesiredApprovalSlice(now);

  for (const target of TARGETS) {
    const doc = await MessageTemplate.findOne(identityQuery(target.channel)).lean();

    if (!doc) {
      console.error(`[gma-template-approval] Missing template: ${target.label}`);
      summary.missing += 1;
      fatal = true;
      continue;
    }

    if (!identityMatches(doc) || doc.channel !== target.channel) {
      console.error(
        `[gma-template-approval] Identity mismatch for ${target.label}: `
        + JSON.stringify({
          expected: { ...TARGET_IDENTITY, channel: target.channel },
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

    const before = pickApprovalSlice(doc);

    if (isAlreadyApproved(doc)) {
      summary.already_correct += 1;
      printPreviewLine({ target, status: 'already_correct', before, after: null });
      continue;
    }

    if (doc.status === 'approved' && doc.approvedBy !== APPROVED_BY) {
      console.error(
        `[gma-template-approval] Template ${target.label} is approved by "${doc.approvedBy}", `
        + `not "${APPROVED_BY}" — manual review required`
      );
      summary.mismatch += 1;
      fatal = true;
      continue;
    }

    const after = desiredAtApply;
    summary.to_write += 1;
    printPreviewLine({
      target,
      status: apply ? 'will_write' : 'would_write',
      before,
      after
    });

    if (!apply) continue;

    await MessageTemplate.updateOne(
      { _id: doc._id },
      {
        $set: {
          status: 'approved',
          approvedBy: APPROVED_BY,
          approvedAt: now
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
    console.error('[gma-template-approval] MONGODB_URI (or DEFAULT_MONGO_URI) is required.');
    process.exit(1);
  }

  await mongoose.connect(uri);

  console.log(`[gma-template-approval] Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`[gma-template-approval] Targets: ${TARGETS.length} (cabin only)`);

  const { summary, fatal } = await runApproval({ apply });

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
  APPROVED_BY,
  TARGET_IDENTITY,
  TARGETS,
  identityQuery,
  pickApprovalSlice,
  identityMatches,
  isAlreadyApproved,
  isProductionApplyAllowed,
  assertProductionGate,
  runApproval
};

if (require.main === module) {
  main().catch((err) => {
    console.error('[gma-template-approval] Fatal:', err?.message || err);
    mongoose.disconnect().finally(() => process.exit(1));
  });
}
