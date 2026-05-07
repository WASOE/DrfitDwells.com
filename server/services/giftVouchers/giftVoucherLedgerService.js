const GiftVoucher = require('../../models/GiftVoucher');
const GiftVoucherRedemption = require('../../models/GiftVoucherRedemption');
const GiftVoucherEvent = require('../../models/GiftVoucherEvent');
const { assertIntegerCents } = require('./giftVoucherValidationService');
const { appendFinancialVoucherEvent } = require('./giftVoucherEventService');

function statusFromBalance(balanceRemainingCents, amountOriginalCents) {
  if (balanceRemainingCents === amountOriginalCents) return 'active';
  if (balanceRemainingCents >= 0 && balanceRemainingCents < amountOriginalCents) return 'partially_redeemed';
  return 'partially_redeemed';
}

function toNow(now) {
  return now instanceof Date ? now : new Date();
}

function buildStructuredError(code, fields = {}) {
  const err = new Error(code);
  err.code = code;
  Object.assign(err, fields);
  return err;
}

async function hasRedemptionEvent({ giftVoucherId, redemptionId, type }) {
  const hit = await GiftVoucherEvent.findOne({
    giftVoucherId,
    type,
    'metadata.redemptionId': String(redemptionId)
  })
    .select('_id')
    .lean();
  return Boolean(hit);
}

async function reserveVoucherAmount({
  giftVoucherId,
  amountToReserveCents,
  bookingId = null,
  reservationId = null,
  holdExpiresAt = null,
  actor = 'system',
  note = 'reserve voucher amount'
}) {
  assertIntegerCents(amountToReserveCents, 'amountToReserveCents');
  if (amountToReserveCents <= 0) {
    const err = new Error('amountToReserveCents must be greater than zero');
    err.code = 'INVALID_RESERVE_AMOUNT';
    throw err;
  }

  const now = new Date();
  const voucher = await GiftVoucher.findOneAndUpdate(
    {
      _id: giftVoucherId,
      status: { $in: ['active', 'partially_redeemed'] },
      expiresAt: { $gt: now },
      balanceRemainingCents: { $gte: amountToReserveCents }
    },
    {
      $inc: { balanceRemainingCents: -amountToReserveCents },
      $set: { status: 'partially_redeemed' }
    },
    { new: true }
  );

  if (!voucher) {
    const err = new Error('Voucher reserve failed');
    err.code = 'RESERVE_FAILED';
    throw err;
  }

  const previousBalanceCents = voucher.balanceRemainingCents + amountToReserveCents;
  const newBalanceCents = voucher.balanceRemainingCents;
  let redemption;

  try {
    redemption = await GiftVoucherRedemption.create({
      giftVoucherId: voucher._id,
      bookingId,
      reservationId,
      amountAppliedCents: amountToReserveCents,
      status: 'reserved',
      reservedAt: now,
      expiresAt: holdExpiresAt || null
    });
  } catch (error) {
    const compensation = { compensationAttempted: true, compensationSucceeded: false };
    try {
      const restored = await GiftVoucher.findByIdAndUpdate(
        voucher._id,
        { $inc: { balanceRemainingCents: amountToReserveCents } },
        { new: true }
      );
      if (restored) {
        const restoredStatus = statusFromBalance(restored.balanceRemainingCents, restored.amountOriginalCents);
        await GiftVoucher.updateOne(
          { _id: restored._id },
          { $set: { status: restoredStatus } }
        );
        compensation.compensationSucceeded = true;
      }
    } catch (compensationError) {
      compensation.compensationError = compensationError.message;
    }

    return {
      ok: false,
      code: 'RESERVE_REDEMPTION_CREATE_FAILED',
      compensationAttempted: compensation.compensationAttempted,
      compensationSucceeded: compensation.compensationSucceeded,
      voucherId: String(voucher._id),
      amountAppliedCents: amountToReserveCents
    };
  }

  try {
    await appendFinancialVoucherEvent({
      giftVoucherId: voucher._id,
      type: 'redeemed_reserved',
      actor,
      note,
      previousBalanceCents,
      newBalanceCents,
      deltaCents: -amountToReserveCents,
      metadata: {
        redemptionId: String(redemption._id),
        bookingId: bookingId ? String(bookingId) : null,
        reservationId: reservationId ? String(reservationId) : null
      }
    });
  } catch (eventErr) {
    throw buildStructuredError('RESERVE_EVENT_WRITE_FAILED', {
      voucherId: String(voucher._id),
      redemptionId: String(redemption._id),
      amountAppliedCents: amountToReserveCents,
      cause: eventErr.message
    });
  }

  return {
    ok: true,
    voucherId: String(voucher._id),
    redemptionId: String(redemption._id),
    amountAppliedCents: amountToReserveCents,
    previousBalanceCents,
    newBalanceCents
  };
}

async function confirmReservedRedemption({
  redemptionId,
  actor = 'system',
  note = 'confirm voucher redemption'
}) {
  const existing = await GiftVoucherRedemption.findById(redemptionId);
  if (!existing) {
    const err = new Error('Redemption not found');
    err.code = 'REDEMPTION_NOT_FOUND';
    throw err;
  }
  if (existing.status === 'confirmed') {
    const eventExists = await hasRedemptionEvent({
      giftVoucherId: existing.giftVoucherId,
      redemptionId: existing._id,
      type: 'redeemed_confirmed'
    });
    if (eventExists) {
      return { ok: true, alreadyConfirmed: true, redemptionId: String(existing._id) };
    }
    const voucherForRecovery = await GiftVoucher.findById(existing.giftVoucherId);
    if (!voucherForRecovery) {
      const err = new Error('GiftVoucher not found for redemption');
      err.code = 'VOUCHER_NOT_FOUND';
      throw err;
    }
    await appendFinancialVoucherEvent({
      giftVoucherId: voucherForRecovery._id,
      type: 'redeemed_confirmed',
      actor,
      note,
      previousBalanceCents: voucherForRecovery.balanceRemainingCents,
      newBalanceCents: voucherForRecovery.balanceRemainingCents,
      deltaCents: 0,
      metadata: { redemptionId: String(existing._id), recovered: true }
    });
    return {
      ok: true,
      alreadyConfirmed: true,
      eventRecovered: true,
      redemptionId: String(existing._id)
    };
  }
  if (existing.status !== 'reserved') {
    const err = new Error(`Cannot confirm redemption in status ${existing.status}`);
    err.code = 'INVALID_REDEMPTION_STATUS';
    throw err;
  }

  const now = new Date();
  const transition = await GiftVoucherRedemption.updateOne(
    { _id: existing._id, status: 'reserved' },
    { $set: { status: 'confirmed', confirmedAt: now } }
  );
  if (transition.modifiedCount === 0) {
    const latest = await GiftVoucherRedemption.findById(existing._id).lean();
    if (latest?.status === 'confirmed') {
      const eventExists = await hasRedemptionEvent({
        giftVoucherId: existing.giftVoucherId,
        redemptionId: existing._id,
        type: 'redeemed_confirmed'
      });
      if (eventExists) {
        return { ok: true, alreadyConfirmed: true, redemptionId: String(existing._id) };
      }
      const voucherForRecovery = await GiftVoucher.findById(existing.giftVoucherId);
      if (!voucherForRecovery) {
        const err = new Error('GiftVoucher not found for redemption');
        err.code = 'VOUCHER_NOT_FOUND';
        throw err;
      }
      await appendFinancialVoucherEvent({
        giftVoucherId: voucherForRecovery._id,
        type: 'redeemed_confirmed',
        actor,
        note,
        previousBalanceCents: voucherForRecovery.balanceRemainingCents,
        newBalanceCents: voucherForRecovery.balanceRemainingCents,
        deltaCents: 0,
        metadata: { redemptionId: String(existing._id), recovered: true }
      });
      return {
        ok: true,
        alreadyConfirmed: true,
        eventRecovered: true,
        redemptionId: String(existing._id)
      };
    }
    const err = new Error('Redemption confirmation race failed');
    err.code = 'REDEMPTION_CONFIRM_RACE_FAILED';
    throw err;
  }

  const voucher = await GiftVoucher.findById(existing.giftVoucherId);
  if (!voucher) {
    const err = new Error('GiftVoucher not found for redemption');
    err.code = 'VOUCHER_NOT_FOUND';
    throw err;
  }

  const nextStatus = voucher.balanceRemainingCents === 0 ? 'redeemed' : 'partially_redeemed';
  await GiftVoucher.updateOne({ _id: voucher._id }, { $set: { status: nextStatus } });

  await appendFinancialVoucherEvent({
    giftVoucherId: voucher._id,
    type: 'redeemed_confirmed',
    actor,
    note,
    previousBalanceCents: voucher.balanceRemainingCents,
    newBalanceCents: voucher.balanceRemainingCents,
    deltaCents: 0,
    metadata: { redemptionId: String(existing._id) }
  });

  return { ok: true, alreadyConfirmed: false, redemptionId: String(existing._id) };
}

async function releaseReservedRedemption({
  redemptionId,
  reason = 'released',
  actor = 'system',
  note = 'release voucher redemption'
}) {
  const existing = await GiftVoucherRedemption.findById(redemptionId);
  if (!existing) {
    const err = new Error('Redemption not found');
    err.code = 'REDEMPTION_NOT_FOUND';
    throw err;
  }
  if (existing.status === 'released') {
    const eventExists = await hasRedemptionEvent({
      giftVoucherId: existing.giftVoucherId,
      redemptionId: existing._id,
      type: 'redeemed_released'
    });
    if (eventExists) {
      return { ok: true, alreadyReleased: true, redemptionId: String(existing._id) };
    }
    throw buildStructuredError('RELEASE_STATE_INCOMPLETE_REQUIRES_REVIEW', {
      redemptionId: String(existing._id),
      giftVoucherId: String(existing.giftVoucherId),
      amountAppliedCents: existing.amountAppliedCents
    });
  }
  if (existing.status !== 'reserved') {
    const err = new Error(`Cannot release redemption in status ${existing.status}`);
    err.code = 'INVALID_REDEMPTION_STATUS';
    throw err;
  }

  const now = toNow(new Date());
  const transition = await GiftVoucherRedemption.updateOne(
    { _id: existing._id, status: 'reserved' },
    { $set: { status: 'released', releasedAt: now, reason: String(reason || '').trim() || 'released' } }
  );
  if (transition.modifiedCount === 0) {
    const latest = await GiftVoucherRedemption.findById(existing._id).lean();
    if (latest?.status === 'released') {
      return { ok: true, alreadyReleased: true, redemptionId: String(existing._id) };
    }
    const err = new Error('Redemption release race failed');
    err.code = 'REDEMPTION_RELEASE_RACE_FAILED';
    throw err;
  }

  const voucher = await GiftVoucher.findByIdAndUpdate(
    existing.giftVoucherId,
    { $inc: { balanceRemainingCents: existing.amountAppliedCents } },
    { new: true }
  );
  if (!voucher) {
    const err = new Error('GiftVoucher not found for redemption release');
    err.code = 'VOUCHER_NOT_FOUND';
    throw err;
  }

  const previousBalanceCents = voucher.balanceRemainingCents - existing.amountAppliedCents;
  const newBalanceCents = voucher.balanceRemainingCents;
  const nextStatus = statusFromBalance(newBalanceCents, voucher.amountOriginalCents);
  await GiftVoucher.updateOne({ _id: voucher._id }, { $set: { status: nextStatus } });

  await appendFinancialVoucherEvent({
    giftVoucherId: voucher._id,
    type: 'redeemed_released',
    actor,
    note,
    previousBalanceCents,
    newBalanceCents,
    deltaCents: existing.amountAppliedCents,
    metadata: { redemptionId: String(existing._id) }
  });

  return { ok: true, alreadyReleased: false, redemptionId: String(existing._id) };
}

module.exports = {
  reserveVoucherAmount,
  confirmReservedRedemption,
  releaseReservedRedemption
};
