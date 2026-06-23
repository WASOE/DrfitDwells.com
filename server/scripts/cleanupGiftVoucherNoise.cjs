#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const path = require('node:path');
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherEvent = require('../models/GiftVoucherEvent');
const { appendVoucherEvent } = require('../services/giftVouchers/giftVoucherEventService');
const {
  isDryRunEnv,
  isTruthyEnv,
  parseOlderThanHours,
  classifyGiftVoucherNoiseRecord,
  buildCandidateQuery,
  groupReasonCounts
} = require('../services/giftVouchers/giftVoucherNoiseCleanupService');

const CLEANUP_ACTOR = 'system:noise_cleanup';
const CLEANUP_NOTE = 'Gift voucher marked voided by gift voucher noise cleanup script';

async function loadEventsByVoucherId(voucherIds) {
  if (!voucherIds.length) return new Map();
  const events = await GiftVoucherEvent.find({ giftVoucherId: { $in: voucherIds } })
    .select('giftVoucherId type metadata createdAt')
    .lean();
  const grouped = new Map();
  for (const event of events) {
    const key = String(event.giftVoucherId);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(event);
  }
  return grouped;
}

async function hasCleanupMarker(giftVoucherId) {
  const existing = await GiftVoucherEvent.findOne({
    giftVoucherId,
    'metadata.action': 'noise_cleanup'
  })
    .select('_id')
    .lean();
  return Boolean(existing);
}

async function applyNoiseCleanup({ voucher, classification, dryRun }) {
  if (!classification.matched) {
    return { updated: false, skipped: true };
  }

  if (classification.alreadyVoided) {
    return { updated: false, skipped: true, action: 'leave_voided' };
  }

  if (dryRun) {
    return { updated: false, dryRun: true, action: 'void' };
  }

  const updateResult = await GiftVoucher.updateOne(
    { _id: voucher._id, status: voucher.status },
    { $set: { status: 'voided' } }
  );
  if (!updateResult.modifiedCount) {
    return { updated: false, skipped: true, action: 'status_changed_concurrently' };
  }

  const alreadyTagged = await hasCleanupMarker(voucher._id);
  if (!alreadyTagged) {
    await appendVoucherEvent({
      giftVoucherId: voucher._id,
      type: 'voided',
      actor: CLEANUP_ACTOR,
      note: CLEANUP_NOTE,
      metadata: {
        action: 'noise_cleanup',
        script: 'cleanupGiftVoucherNoise',
        reasons: classification.reasons,
        previousStatus: voucher.status
      }
    });
  }

  return { updated: true, action: 'void' };
}

async function runCleanup({
  mongoUri,
  dryRun = true,
  includeJoseKremenaTests = false,
  olderThanHours = 0,
  giftVoucherModel = GiftVoucher,
  giftVoucherEventModel = GiftVoucherEvent,
  applyFn = applyNoiseCleanup
} = {}) {
  const uri = mongoUri || process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  const shouldConnect = mongoose.connection.readyState === 0;
  if (shouldConnect) {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  }

  try {
    const candidates = await giftVoucherModel.find(buildCandidateQuery({ includeJoseKremenaTests })).lean();
    const eventsByVoucherId = await loadEventsByVoucherId(candidates.map((row) => row._id));

    const summary = {
      dryRun,
      matchedCount: 0,
      wouldUpdateCount: 0,
      updatedCount: 0,
      skippedPaidCount: 0,
      skippedSafetyCount: 0,
      groupedReasons: {},
      records: []
    };

    for (const voucher of candidates) {
      const events = eventsByVoucherId.get(String(voucher._id)) || [];
      const classification = classifyGiftVoucherNoiseRecord(voucher, {
        includeJoseKremenaTests,
        olderThanHours,
        events
      });

      const record = {
        giftVoucherId: String(voucher._id),
        status: voucher.status,
        purchaseRequestId: voucher.purchaseRequestId || null,
        buyerEmail: voucher.buyerEmail || null,
        matched: classification.matched,
        reason: classification.reason || null,
        reasons: classification.reasons || [],
        action: classification.action || null
      };

      if (classification.skippedPaid) {
        summary.skippedPaidCount += 1;
        summary.records.push(record);
        continue;
      }

      if (!classification.matched) {
        summary.skippedSafetyCount += 1;
        summary.records.push(record);
        continue;
      }

      summary.matchedCount += 1;
      if (classification.wouldUpdate) {
        summary.wouldUpdateCount += 1;
      }

      const applyResult = await applyFn({
        voucher,
        classification,
        dryRun,
        giftVoucherEventModel
      });
      record.applyResult = applyResult;
      if (applyResult.updated) {
        summary.updatedCount += 1;
      }
      summary.records.push(record);
    }

    summary.groupedReasons = groupReasonCounts(
      summary.records.filter((record) => record.matched).map((record) => ({ reasons: record.reasons }))
    );

    return summary;
  } finally {
    if (shouldConnect) {
      await mongoose.disconnect();
    }
  }
}

async function main() {
  try {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  } catch {
    // optional
  }

  const dryRun = isDryRunEnv(process.env);
  const includeJoseKremenaTests = isTruthyEnv(process.env.INCLUDE_JOSE_KREMENA_TESTS);
  const olderThanHours = parseOlderThanHours(process.env);

  const summary = await runCleanup({
    dryRun,
    includeJoseKremenaTests,
    olderThanHours
  });

  console.log(JSON.stringify(summary, null, 2));
  if (dryRun) {
    console.log('[cleanup:gift-voucher-noise] DRY_RUN=1 — no records updated. Re-run with DRY_RUN=0 to apply.');
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(
      JSON.stringify(
        {
          success: false,
          script: 'cleanup:gift-voucher-noise',
          error: error?.message || String(error)
        },
        null,
        2
      )
    );
    process.exit(1);
  });
}

module.exports = {
  runCleanup,
  applyNoiseCleanup,
  CLEANUP_ACTOR,
  CLEANUP_NOTE
};
