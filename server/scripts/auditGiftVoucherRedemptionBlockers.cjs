#!/usr/bin/env node
/**
 * Read-only audit: gift vouchers sold below legacy €100 redemption floor that may
 * still have redeemable balance or stale checkout holds.
 *
 * Usage:
 *   node scripts/auditGiftVoucherRedemptionBlockers.cjs
 *   MONGODB_URI=... node scripts/auditGiftVoucherRedemptionBlockers.cjs --json
 */
'use strict';

const mongoose = require('mongoose');
const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherRedemption = require('../models/GiftVoucherRedemption');
const ManualReviewItem = require('../models/ManualReviewItem');
const { MIN_GIFT_VOUCHER_AMOUNT_CENTS } = require('../services/giftVouchers/giftVoucherConstants');

const LEGACY_REDEMPTION_FLOOR_CENTS = 10000;
const JSON_OUTPUT = process.argv.includes('--json');

function printSection(title, rows) {
  if (JSON_OUTPUT) return;
  console.log(`\n=== ${title} (${rows.length}) ===`);
  if (rows.length === 0) {
    console.log('  (none)');
    return;
  }
  for (const row of rows) {
    console.log(JSON.stringify(row));
  }
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('Set MONGODB_URI or MONGO_URI');
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });

  const now = new Date();
  const staleHoldCutoff = new Date(Date.now() - 30 * 60 * 1000);

  const affectedVouchers = await GiftVoucher.find({
    status: { $in: ['active', 'partially_redeemed'] },
    amountOriginalCents: { $lt: LEGACY_REDEMPTION_FLOOR_CENTS, $gte: MIN_GIFT_VOUCHER_AMOUNT_CENTS },
    balanceRemainingCents: { $gt: 0 }
  })
    .select('code status amountOriginalCents balanceRemainingCents expiresAt activatedAt buyerEmail')
    .sort({ activatedAt: -1 })
    .lean();

  const staleHolds = await GiftVoucherRedemption.find({
    status: 'reserved',
    $or: [
      { expiresAt: { $lte: now } },
      { expiresAt: null, reservedAt: { $lte: staleHoldCutoff } }
    ]
  })
    .select('giftVoucherId checkoutId amountAppliedCents expiresAt reservedAt paymentIntentId')
    .sort({ expiresAt: 1, reservedAt: 1 })
    .limit(200)
    .lean();

  const recentAlerts = await ManualReviewItem.find({
    $or: [
      { category: 'gift_voucher_reservation_release_failed' },
      { category: 'payment_finalization_failure' },
      { title: /voucher/i }
    ],
    createdAt: { $gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) }
  })
    .select('category severity title entityType entityId createdAt status')
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  const report = {
    generatedAt: now.toISOString(),
    constants: {
      minGiftVoucherAmountCents: MIN_GIFT_VOUCHER_AMOUNT_CENTS,
      legacyRedemptionFloorCents: LEGACY_REDEMPTION_FLOOR_CENTS
    },
    affectedVouchers: affectedVouchers.map((v) => ({
      id: String(v._id),
      code: v.code,
      status: v.status,
      amountOriginalCents: v.amountOriginalCents,
      balanceRemainingCents: v.balanceRemainingCents,
      expiresAt: v.expiresAt,
      activatedAt: v.activatedAt,
      buyerEmail: v.buyerEmail
    })),
    staleHolds: staleHolds.map((r) => ({
      id: String(r._id),
      giftVoucherId: r.giftVoucherId ? String(r.giftVoucherId) : null,
      checkoutId: r.checkoutId,
      amountAppliedCents: r.amountAppliedCents,
      expiresAt: r.expiresAt,
      reservedAt: r.reservedAt,
      paymentIntentId: r.paymentIntentId
    })),
    recentAlerts: recentAlerts.map((a) => ({
      id: String(a._id),
      category: a.category,
      severity: a.severity,
      title: a.title,
      entityType: a.entityType,
      entityId: a.entityId,
      status: a.status,
      createdAt: a.createdAt
    }))
  };

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('Gift voucher redemption blocker audit (read-only)');
    console.log(`Min purchasable/redeemable amount: €${(MIN_GIFT_VOUCHER_AMOUNT_CENTS / 100).toFixed(2)}`);
    printSection('Active vouchers below legacy €100 floor with balance', report.affectedVouchers);
    printSection('Stale or expired voucher holds', report.staleHolds);
    printSection('Recent voucher/payment manual review alerts (14d)', report.recentAlerts);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
