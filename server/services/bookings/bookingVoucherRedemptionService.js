const crypto = require('crypto');
const GiftVoucher = require('../../models/GiftVoucher');
const GiftVoucherRedemption = require('../../models/GiftVoucherRedemption');
const { reserveVoucherAmount, confirmReservedRedemption, releaseReservedRedemption } = require('../giftVouchers/giftVoucherLedgerService');
const {
  assertIntegerCents,
  evaluateVoucherForBookingAmount
} = require('../giftVouchers/giftVoucherValidationService');
const { openManualReviewItem } = require('../ops/ingestion/manualReviewService');

function normalizeVoucherCode(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return normalized || null;
}

function buildReservationKey({ checkoutId, normalizedVoucherCode, totalValueCents, giftVoucherId }) {
  const raw = `${checkoutId}|${normalizedVoucherCode}|${totalValueCents}|${giftVoucherId}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

function isExpired(redemption, now = new Date()) {
  if (!redemption?.expiresAt) return false;
  const expiry = toDate(redemption.expiresAt);
  return !Number.isNaN(expiry.getTime()) && expiry <= now;
}

/**
 * Effective voucher availability: balance after releasing expired holds globally.
 */
async function getVoucherAvailableBalanceCents(giftVoucherId, { now = new Date(), limit = 25 } = {}) {
  await releaseExpiredVoucherReservations({ now, limit });
  const voucher = await GiftVoucher.findById(giftVoucherId).select('balanceRemainingCents').lean();
  return Number(voucher?.balanceRemainingCents || 0);
}

async function previewVoucherApplication({ voucherCode, totalValueCents, now = new Date() }) {
  assertIntegerCents(totalValueCents, 'totalValueCents');
  await releaseExpiredVoucherReservations({ now, limit: 25 });

  const normalizedVoucherCode = normalizeVoucherCode(voucherCode);
  if (!normalizedVoucherCode || totalValueCents <= 0) {
    return {
      ok: true,
      success: true,
      voucherAppliedCents: 0,
      remainingDueCents: Math.max(0, totalValueCents),
      fullVoucherCoverage: false
    };
  }

  const voucher = await GiftVoucher.findOne({ code: normalizedVoucherCode }).lean();
  return evaluateVoucherForBookingAmount({
    voucher,
    voucherCode: normalizedVoucherCode,
    totalValueCents,
    now
  });
}

async function releaseExpiredVoucherReservations({
  now = new Date(),
  limit = 25,
  openManualReviewOnFailure = false
} = {}) {
  const scanNow = toDate(now);
  const stale = await GiftVoucherRedemption.find({
    status: 'reserved',
    expiresAt: { $lte: scanNow }
  })
    .sort({ expiresAt: 1 })
    .limit(Math.max(1, Number(limit) || 25))
    .lean();

  const summary = { scanned: stale.length, released: 0, alreadyReleased: 0, failed: 0 };
  for (const item of stale) {
    try {
      const release = await releaseReservedRedemption({
        redemptionId: item._id,
        reason: 'expired_hold',
        actor: 'system',
        note: 'release expired booking voucher reservation'
      });
      if (release.alreadyReleased) {
        summary.alreadyReleased += 1;
      } else {
        summary.released += 1;
      }
    } catch (err) {
      summary.failed += 1;
      if (openManualReviewOnFailure) {
        try {
          await openManualReviewItem({
            category: 'gift_voucher_reservation_release_failed',
            severity: 'high',
            entityType: 'GiftVoucherRedemption',
            entityId: String(item._id),
            title: 'Stale gift voucher reservation release failed',
            details: String(err?.message || err),
            provenance: { source: 'gift_voucher_maintenance', sourceReference: String(item._id) },
            evidence: {
              redemptionId: String(item._id),
              giftVoucherId: item.giftVoucherId ? String(item.giftVoucherId) : null,
              error: String(err?.message || err)
            }
          });
        } catch {
          /* non-fatal */
        }
      }
    }
  }
  return summary;
}

async function reserveVoucherForCheckout({
  voucherCode,
  checkoutId,
  totalValueCents,
  redemptionExpiresAt,
  actor = 'guest'
}) {
  assertIntegerCents(totalValueCents, 'totalValueCents');
  const now = new Date();
  await releaseExpiredVoucherReservations({ now, limit: 25 });

  const normalizedVoucherCode = normalizeVoucherCode(voucherCode);
  if (!normalizedVoucherCode) {
    const err = new Error('voucherCode is required');
    err.code = 'VOUCHER_CODE_REQUIRED';
    throw err;
  }
  if (!checkoutId) {
    const err = new Error('checkoutId is required for voucher reservation');
    err.code = 'CHECKOUT_ID_REQUIRED';
    throw err;
  }

  const existingByCheckout = await GiftVoucherRedemption.findOne({ checkoutId }).sort({ createdAt: -1 });
  const voucherLookup = await GiftVoucher.findOne({ code: normalizedVoucherCode }).lean();
  const giftVoucherId = voucherLookup?._id ? String(voucherLookup._id) : 'missing_voucher';
  const reservationKey = buildReservationKey({
    checkoutId,
    normalizedVoucherCode,
    totalValueCents,
    giftVoucherId
  });

  if (existingByCheckout) {
    if (existingByCheckout.reservationKey !== reservationKey) {
      const err = new Error('checkoutId conflicts with existing voucher reservation');
      err.code = 'CHECKOUT_ID_CONFLICT';
      throw err;
    }

    if (existingByCheckout.status === 'reserved') {
      if (!isExpired(existingByCheckout, now)) {
        return {
          ok: true,
          idempotentReplay: true,
          redemptionId: String(existingByCheckout._id),
          giftVoucherId: String(existingByCheckout.giftVoucherId),
          voucherAppliedCents: existingByCheckout.amountAppliedCents,
          remainingDueCents: Math.max(0, totalValueCents - existingByCheckout.amountAppliedCents),
          fullVoucherCoverage: existingByCheckout.amountAppliedCents >= totalValueCents,
          paymentIntentId: existingByCheckout.paymentIntentId || null,
          reservationKey
        };
      }

      await releaseVoucherReservation({
        redemptionId: existingByCheckout._id,
        reason: 'expired_hold',
        actor: 'system',
        note: 'release expired hold before new reservation for same checkout'
      });
    }
  }

  const voucher = await GiftVoucher.findOne({ code: normalizedVoucherCode });
  const evaluation = evaluateVoucherForBookingAmount({
    voucher: voucher ? voucher.toObject() : null,
    voucherCode: normalizedVoucherCode,
    totalValueCents,
    now
  });
  if (!evaluation.ok) {
    const err = new Error(evaluation.publicMessage);
    err.code = evaluation.internalCode;
    throw err;
  }

  const voucherAppliedCents = evaluation.voucherAppliedCents;
  const holdExpiry = redemptionExpiresAt instanceof Date ? redemptionExpiresAt : null;
  const reservation = await reserveVoucherAmount({
    giftVoucherId: voucher._id,
    amountToReserveCents: voucherAppliedCents,
    holdExpiresAt: holdExpiry,
    actor,
    note: 'reserve voucher for booking checkout'
  });

  if (!reservation.ok) {
    const err = new Error('Voucher reserve failed');
    err.code = reservation.code === 'RESERVE_REDEMPTION_CREATE_FAILED' ? 'RESERVE_FAILED' : (reservation.code || 'RESERVE_FAILED');
    throw err;
  }

  await GiftVoucherRedemption.updateOne(
    { _id: reservation.redemptionId },
    {
      $set: {
        checkoutId: String(checkoutId),
        reservationKey,
        paymentIntentId: null,
        expiresAt: holdExpiry
      }
    }
  );

  return {
    ok: true,
    idempotentReplay: false,
    redemptionId: String(reservation.redemptionId),
    giftVoucherId: String(voucher._id),
    voucherAppliedCents,
    remainingDueCents: evaluation.remainingDueCents,
    fullVoucherCoverage: evaluation.fullVoucherCoverage,
    paymentIntentId: null,
    reservationKey
  };
}

async function attachPaymentIntentToReservation({ redemptionId, paymentIntentId }) {
  await GiftVoucherRedemption.updateOne(
    { _id: redemptionId, status: 'reserved' },
    { $set: { paymentIntentId: String(paymentIntentId || '').trim() || null } }
  );
}

async function validateReservedRedemptionForBooking({
  redemptionId,
  checkoutId,
  totalValueCents,
  paymentIntentId = null
}) {
  assertIntegerCents(totalValueCents, 'totalValueCents');
  const redemption = await GiftVoucherRedemption.findById(redemptionId);
  if (!redemption) {
    const err = new Error('Voucher redemption not found');
    err.code = 'REDEMPTION_NOT_FOUND';
    throw err;
  }
  if (String(redemption.checkoutId || '') !== String(checkoutId || '')) {
    const err = new Error('Voucher redemption does not belong to this checkout');
    err.code = 'REDEMPTION_CHECKOUT_MISMATCH';
    throw err;
  }
  if (redemption.status !== 'reserved') {
    const err = new Error('Voucher redemption is not reserved');
    err.code = 'REDEMPTION_NOT_RESERVED';
    err.redemption = redemption;
    throw err;
  }
  if (isExpired(redemption)) {
    const err = new Error('Voucher redemption has expired');
    err.code = 'REDEMPTION_EXPIRED';
    err.redemption = redemption;
    throw err;
  }
  if (Number(redemption.amountAppliedCents || 0) > totalValueCents) {
    const err = new Error('Voucher reservation amount exceeds total booking value');
    err.code = 'REDEMPTION_AMOUNT_INVALID';
    throw err;
  }
  if (paymentIntentId && redemption.paymentIntentId && String(redemption.paymentIntentId) !== String(paymentIntentId)) {
    const err = new Error('Voucher reservation payment intent mismatch');
    err.code = 'REDEMPTION_PAYMENT_INTENT_MISMATCH';
    throw err;
  }
  return redemption;
}

async function releaseVoucherReservation({ redemptionId, reason, actor = 'system', note }) {
  return releaseReservedRedemption({ redemptionId, reason, actor, note });
}

async function confirmVoucherReservation({ redemptionId, actor = 'system', note }) {
  return confirmReservedRedemption({ redemptionId, actor, note });
}

module.exports = {
  normalizeVoucherCode,
  buildReservationKey,
  getVoucherAvailableBalanceCents,
  previewVoucherApplication,
  reserveVoucherForCheckout,
  attachPaymentIntentToReservation,
  validateReservedRedemptionForBooking,
  releaseVoucherReservation,
  confirmVoucherReservation,
  releaseExpiredVoucherReservations
};
