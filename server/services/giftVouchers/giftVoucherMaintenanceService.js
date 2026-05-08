/**
 * Callable maintenance helpers for gift vouchers (Batch 9).
 *
 * Deferred: expiry reminder emails (not implemented).
 * No cron/scheduler wiring — callers invoke explicitly.
 */

const GiftVoucher = require('../../models/GiftVoucher');
const GiftVoucherEvent = require('../../models/GiftVoucherEvent');
const giftVoucherEventService = require('./giftVoucherEventService');
const { releaseExpiredVoucherReservations } = require('../bookings/bookingVoucherRedemptionService');
const { openManualReviewItem } = require('../ops/ingestion/manualReviewService');

function toDate(now) {
  return now instanceof Date ? now : new Date(now);
}

function clampLimit(limit, max = 500) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n < 1) return 100;
  return Math.min(Math.trunc(n), max);
}

async function findNextExpiredVoucherMissingExpiryEvent(scanNow) {
  const eventColl = GiftVoucherEvent.collection.collectionName;
  const rows = await GiftVoucher.aggregate([
    {
      $match: {
        status: 'expired',
        expiresAt: { $lte: scanNow, $exists: true, $ne: null }
      }
    },
    {
      $lookup: {
        from: eventColl,
        let: { vid: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [{ $eq: ['$giftVoucherId', '$$vid'] }, { $eq: ['$type', 'expired'] }]
              }
            }
          },
          { $limit: 1 }
        ],
        as: 'expiredEv'
      }
    },
    { $match: { expiredEv: { $size: 0 } } },
    { $sort: { expiresAt: 1 } },
    { $limit: 1 }
  ]);
  return rows[0] || null;
}

async function openExpiryEventWriteFailureReview({
  phase,
  voucherDoc,
  error,
  actor = 'system'
}) {
  const balance = Math.trunc(Number(voucherDoc.balanceRemainingCents) || 0);
  const expiresAt =
    voucherDoc.expiresAt instanceof Date ? voucherDoc.expiresAt.toISOString() : String(voucherDoc.expiresAt || '');
  await openManualReviewItem({
    category: 'gift_voucher_expiry_event_failed',
    severity: 'high',
    entityType: 'GiftVoucher',
    entityId: String(voucherDoc._id),
    title: 'Gift voucher expired ledger event write failed',
    details: `${phase}: ${String(error?.message || error)}`,
    provenance: { source: 'gift_voucher_maintenance', sourceReference: String(voucherDoc._id) },
    evidence: {
      phase,
      giftVoucherId: String(voucherDoc._id),
      expiresAt,
      balanceRemainingCents: balance,
      error: String(error?.message || error)
    }
  });
}

/**
 * Transition due vouchers from active/partially_redeemed → expired with a single financial ledger event each.
 * Repairs vouchers already in status `expired` (expiresAt due) that lack an `expired` event — e.g. after an event
 * write failure following status transition.
 *
 * Idempotent: never duplicates `expired` events.
 *
 * Does not expire: voided, refunded, redeemed, pending_payment, draft (only active / partially_redeemed).
 */
async function expireDueGiftVouchers({ now = new Date(), limit = 100, actor = 'system' } = {}) {
  const scanNow = toDate(now);
  const lim = clampLimit(limit);
  const normalizedActor = String(actor || '').trim() || 'system';

  const summary = {
    processed: 0,
    transitioned: 0,
    eventsSkippedExisting: 0,
    eventsAppended: 0,
    stoppedEarlyNoMatch: false,
    repairProcessed: 0,
    repairEventsAppended: 0,
    repairStoppedNoMatch: false,
    expiryEventWriteFailures: 0
  };

  let remaining = lim;

  while (remaining > 0) {
    const orphan = await findNextExpiredVoucherMissingExpiryEvent(scanNow);
    if (!orphan) {
      summary.repairStoppedNoMatch = true;
      break;
    }
    summary.repairProcessed += 1;
    remaining -= 1;
    const balance = Math.trunc(Number(orphan.balanceRemainingCents) || 0);
    try {
      await giftVoucherEventService.appendFinancialVoucherEvent({
        giftVoucherId: orphan._id,
        type: 'expired',
        actor: normalizedActor,
        note: 'voucher expired after expiry date (maintenance repair)',
        previousBalanceCents: balance,
        newBalanceCents: balance,
        deltaCents: 0,
        metadata: { source: 'giftVoucherMaintenanceService', phase: 'repair' }
      });
      summary.repairEventsAppended += 1;
    } catch (repairErr) {
      summary.expiryEventWriteFailures += 1;
      try {
        await openExpiryEventWriteFailureReview({
          phase: 'repair',
          voucherDoc: orphan,
          error: repairErr,
          actor: normalizedActor
        });
      } catch {
        /* non-fatal */
      }
      break;
    }
  }

  while (remaining > 0) {
    const updated = await GiftVoucher.findOneAndUpdate(
      {
        status: { $in: ['active', 'partially_redeemed'] },
        expiresAt: { $lte: scanNow, $exists: true, $ne: null }
      },
      { $set: { status: 'expired' } },
      { new: true, sort: { expiresAt: 1 } }
    ).lean();

    if (!updated) {
      summary.stoppedEarlyNoMatch = true;
      break;
    }

    summary.processed += 1;
    summary.transitioned += 1;
    remaining -= 1;

    const existingExpired = await GiftVoucherEvent.findOne({
      giftVoucherId: updated._id,
      type: 'expired'
    })
      .select('_id')
      .lean();

    if (existingExpired) {
      summary.eventsSkippedExisting += 1;
      continue;
    }

    const balance = Math.trunc(Number(updated.balanceRemainingCents) || 0);

    try {
      await giftVoucherEventService.appendFinancialVoucherEvent({
        giftVoucherId: updated._id,
        type: 'expired',
        actor: normalizedActor,
        note: 'voucher expired after expiry date (maintenance)',
        previousBalanceCents: balance,
        newBalanceCents: balance,
        deltaCents: 0,
        metadata: { source: 'giftVoucherMaintenanceService', phase: 'transition' }
      });
      summary.eventsAppended += 1;
    } catch (transitionErr) {
      summary.expiryEventWriteFailures += 1;
      try {
        await openExpiryEventWriteFailureReview({
          phase: 'transition',
          voucherDoc: updated,
          error: transitionErr,
          actor: normalizedActor
        });
      } catch {
        /* non-fatal */
      }
    }
  }

  return summary;
}

/**
 * Releases reserved redemptions whose hold has expired ({@link GiftVoucherRedemption#expiresAt}).
 * Delegates to releaseExpiredVoucherReservations with manual-review escalation when a release fails.
 */
async function releaseStaleGiftVoucherReservations(params = {}) {
  return releaseExpiredVoucherReservations({
    ...params,
    openManualReviewOnFailure: true
  });
}

module.exports = {
  expireDueGiftVouchers,
  releaseStaleGiftVoucherReservations
};
