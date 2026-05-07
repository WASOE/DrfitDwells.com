const crypto = require('crypto');
const GiftVoucher = require('../../models/GiftVoucher');
const GiftVoucherRedemption = require('../../models/GiftVoucherRedemption');
const { reserveVoucherAmount, confirmReservedRedemption, releaseReservedRedemption } = require('../giftVouchers/giftVoucherLedgerService');
const {
  assertIntegerCents,
  assertVoucherRedeemable,
  computeRedeemableAmountCents,
  buildPublicGenericVoucherError
} = require('../giftVouchers/giftVoucherValidationService');

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

async function previewVoucherApplication({ voucherCode, totalValueCents, now = new Date() }) {
  assertIntegerCents(totalValueCents, 'totalValueCents');
  const normalizedVoucherCode = normalizeVoucherCode(voucherCode);
  if (!normalizedVoucherCode || totalValueCents <= 0) {
    return {
      voucherAppliedCents: 0,
      remainingDueCents: Math.max(0, totalValueCents),
      fullVoucherCoverage: false
    };
  }

  const voucher = await GiftVoucher.findOne({ code: normalizedVoucherCode }).lean();
  try {
    assertVoucherRedeemable(voucher, { now });
    const voucherAppliedCents = computeRedeemableAmountCents({ voucher, amountDueCents: totalValueCents });
    return {
      voucherAppliedCents,
      remainingDueCents: Math.max(0, totalValueCents - voucherAppliedCents),
      fullVoucherCoverage: voucherAppliedCents >= totalValueCents,
      giftVoucherId: String(voucher._id),
      voucherCode: normalizedVoucherCode
    };
  } catch {
    return {
      ...buildPublicGenericVoucherError(),
      voucherAppliedCents: 0,
      remainingDueCents: Math.max(0, totalValueCents),
      fullVoucherCoverage: false
    };
  }
}

async function releaseExpiredVoucherReservations({ now = new Date(), limit = 25 }) {
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
    } catch {
      summary.failed += 1;
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
  const voucher = await GiftVoucher.findOne({ code: normalizedVoucherCode });
  const giftVoucherId = voucher?._id ? String(voucher._id) : 'missing_voucher';
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

    if (existingByCheckout.status === 'reserved' && !isExpired(existingByCheckout)) {
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
  }
  assertVoucherRedeemable(voucher, { now: new Date() });
  const voucherAppliedCents = computeRedeemableAmountCents({ voucher, amountDueCents: totalValueCents });

  const holdExpiry = redemptionExpiresAt instanceof Date ? redemptionExpiresAt : null;
  const reservation = await reserveVoucherAmount({
    giftVoucherId: voucher._id,
    amountToReserveCents: voucherAppliedCents,
    actor,
    note: 'reserve voucher for booking checkout'
  });

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
    remainingDueCents: Math.max(0, totalValueCents - voucherAppliedCents),
    fullVoucherCoverage: voucherAppliedCents >= totalValueCents,
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
  previewVoucherApplication,
  reserveVoucherForCheckout,
  attachPaymentIntentToReservation,
  validateReservedRedemptionForBooking,
  releaseVoucherReservation,
  confirmVoucherReservation,
  releaseExpiredVoucherReservations
};
