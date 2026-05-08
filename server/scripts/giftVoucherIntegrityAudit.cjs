/* eslint-disable no-console */
/**
 * Read-only integrity checks for gift vouchers, redemptions, bookings, and commission rows.
 * Prints JSON summary to stdout. Exit 0 when no findings, 1 when any critical finding exists.
 */
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherRedemption = require('../models/GiftVoucherRedemption');
const GiftVoucherCreatorCommission = require('../models/GiftVoucherCreatorCommission');
const Booking = require('../models/Booking');

function sampleIds(docs) {
  return docs.map((d) => String(d._id)).slice(0, 25);
}

async function runAudit() {
  const now = new Date();
  const checks = {};

  const activeNoCode = await GiftVoucher.find({
    status: 'active',
    $or: [{ code: { $exists: false } }, { code: null }, { code: '' }]
  })
    .select('_id')
    .limit(100)
    .lean();
  checks.activeVoucherWithoutCode = { count: activeNoCode.length, sampleIds: sampleIds(activeNoCode) };

  const activeNoExpiry = await GiftVoucher.find({
    status: 'active',
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }]
  })
    .select('_id')
    .limit(100)
    .lean();
  checks.activeVoucherWithoutExpiresAt = { count: activeNoExpiry.length, sampleIds: sampleIds(activeNoExpiry) };

  const activePastExpiry = await GiftVoucher.find({
    status: { $in: ['active', 'partially_redeemed'] },
    expiresAt: { $lt: now }
  })
    .select('_id expiresAt')
    .limit(100)
    .lean();
  checks.activeOrPartialWithExpiresAtInPast = {
    count: activePastExpiry.length,
    sampleIds: sampleIds(activePastExpiry)
  };

  const negBalance = await GiftVoucher.find({ balanceRemainingCents: { $lt: 0 } })
    .select('_id balanceRemainingCents')
    .limit(100)
    .lean();
  checks.balanceRemainingCentsNegative = { count: negBalance.length, sampleIds: sampleIds(negBalance) };

  const balanceOverOriginal = await GiftVoucher.find({
    $expr: { $gt: ['$balanceRemainingCents', '$amountOriginalCents'] }
  })
    .select('_id balanceRemainingCents amountOriginalCents')
    .limit(100)
    .lean();
  checks.balanceRemainingGreaterThanOriginal = {
    count: balanceOverOriginal.length,
    sampleIds: sampleIds(balanceOverOriginal)
  };

  const redeemedWithBalance = await GiftVoucher.find({
    status: 'redeemed',
    balanceRemainingCents: { $gt: 0 }
  })
    .select('_id balanceRemainingCents')
    .limit(100)
    .lean();
  checks.redeemedWithPositiveBalance = {
    count: redeemedWithBalance.length,
    sampleIds: sampleIds(redeemedWithBalance)
  };

  const staleReserved = await GiftVoucherRedemption.find({
    status: 'reserved',
    expiresAt: { $lt: now }
  })
    .select('_id expiresAt')
    .limit(100)
    .lean();
  checks.reservedRedemptionWithExpiresAtInPast = {
    count: staleReserved.length,
    sampleIds: sampleIds(staleReserved)
  };

  const confirmedNoBooking = await GiftVoucherRedemption.find({
    status: 'confirmed',
    $or: [{ bookingId: null }, { bookingId: { $exists: false } }]
  })
    .select('_id')
    .limit(100)
    .lean();
  checks.confirmedRedemptionWithoutBookingId = {
    count: confirmedNoBooking.length,
    sampleIds: sampleIds(confirmedNoBooking)
  };

  const bookingMissingRedemption = await Booking.find({
    giftVoucherAppliedCents: { $gt: 0 },
    $or: [{ giftVoucherRedemptionId: null }, { giftVoucherRedemptionId: { $exists: false } }]
  })
    .select('_id giftVoucherAppliedCents')
    .limit(100)
    .lean();
  checks.bookingVoucherAppliedWithoutRedemptionId = {
    count: bookingMissingRedemption.length,
    sampleIds: sampleIds(bookingMissingRedemption)
  };

  const giftVoucherPaidMismatch = await Booking.find({
    paymentMethod: 'gift_voucher',
    stripePaidAmountCents: { $gt: 0 }
  })
    .select('_id stripePaidAmountCents giftVoucherAppliedCents')
    .limit(100)
    .lean();
  checks.bookingGiftVoucherMethodWithStripePaid = {
    count: giftVoucherPaidMismatch.length,
    sampleIds: sampleIds(giftVoucherPaidMismatch)
  };

  const stripePlusNoVoucher = await Booking.find({
    paymentMethod: 'stripe_plus_gift_voucher',
    giftVoucherAppliedCents: { $lte: 0 }
  })
    .select('_id giftVoucherAppliedCents')
    .limit(100)
    .lean();
  checks.bookingStripePlusGiftVoucherWithNoAppliedCents = {
    count: stripePlusNoVoucher.length,
    sampleIds: sampleIds(stripePlusNoVoucher)
  };

  const dupCommissionGroups = await GiftVoucherCreatorCommission.aggregate([
    { $group: { _id: '$giftVoucherId', count: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 50 }
  ]);

  checks.duplicateGiftVoucherCreatorCommissionRows = {
    count: dupCommissionGroups.length,
    sampleGroups: dupCommissionGroups.map((g) => ({
      giftVoucherId: String(g._id),
      count: g.count,
      commissionRowIds: g.ids.slice(0, 10).map((id) => String(id))
    }))
  };

  const criticalKeys = Object.keys(checks);
  let criticalCount = 0;
  for (const k of criticalKeys) {
    criticalCount += checks[k].count || 0;
  }

  return {
    audit: 'gift_voucher_integrity_readonly_v1',
    readOnly: true,
    scannedAt: now.toISOString(),
    checks,
    criticalCount,
    severity: criticalCount > 0 ? 'critical_present' : 'clean'
  };
}

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 8000 });
  try {
    const summary = await runAudit();
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = summary.criticalCount > 0 ? 1 : 0;
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.log(
    JSON.stringify({
      audit: 'gift_voucher_integrity_readonly_v1',
      error: true,
      message: err?.message || String(err)
    })
  );
  process.exit(2);
});
