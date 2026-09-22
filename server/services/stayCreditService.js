/**
 * SP7/SP7B — StayCredit issuance + reserve/consume/release + redemption audit.
 * Integer cents only. Never cash-convertible through the app.
 *
 * Quote preview never spends. Checkout reserve decrements spendable balance.
 * Consume attaches Booking. Release restores balance only from reserved.
 */
'use strict';

const StayCredit = require('../models/StayCredit');
const StayCreditReservation = require('../models/StayCreditReservation');

class StayCreditError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'StayCreditError';
    this.code = code;
    this.details = details;
  }
}

function normalizeEmail(email) {
  const s = email == null ? '' : String(email).trim().toLowerCase();
  if (!s || !s.includes('@')) {
    throw new StayCreditError('GUEST_EMAIL_REQUIRED', 'Guest email is required for stay credit');
  }
  return s;
}

function buildIssuanceIdempotencyKey(bookingId, installmentId) {
  return `stay-credit:issue:${bookingId}:${installmentId}`;
}

function buildReservationKey(checkoutSessionId, stayCreditId) {
  return `stay-credit:reserve:${checkoutSessionId}:${stayCreditId}`;
}

function desiredStatus(issuedCents, remainingCents) {
  const rem = Number(remainingCents);
  const issued = Number(issuedCents);
  if (rem === 0) return 'redeemed';
  if (rem < issued) return 'partially_redeemed';
  return 'active';
}

/**
 * Issue full paid installment amount as stay credit (idempotent).
 */
async function issueStayCreditForPaidInstallment({
  booking,
  installment,
  StayCreditModel = StayCredit,
  now = new Date()
} = {}) {
  if (!booking?._id || !installment?._id) {
    throw new StayCreditError('ORIGIN_REQUIRED', 'Booking and installment are required');
  }
  if (String(installment.status) !== 'paid') {
    throw new StayCreditError('INSTALLMENT_NOT_PAID', 'Only paid installments can issue stay credit');
  }
  if (String(installment.cancellationTreatment) !== 'stay_credit') {
    throw new StayCreditError(
      'TREATMENT_NOT_STAY_CREDIT',
      'Installment cancellationTreatment must be stay_credit'
    );
  }

  const issuedCents = Math.trunc(Number(installment.amountCents));
  if (!Number.isInteger(issuedCents) || issuedCents < 1) {
    throw new StayCreditError('INVALID_AMOUNT', 'Installment amountCents must be a positive integer');
  }

  const key = buildIssuanceIdempotencyKey(booking._id, installment._id);
  const existing = await StayCreditModel.findOne({ issuanceIdempotencyKey: key });
  if (existing) {
    if (existing.issuedCents !== issuedCents) {
      throw new StayCreditError(
        'ISSUANCE_AMOUNT_CONFLICT',
        'Existing stay credit amount does not match installment',
        { existingCents: existing.issuedCents, requestedCents: issuedCents }
      );
    }
    return { stayCredit: existing, idempotentReplay: true };
  }

  const byOrigin = await StayCreditModel.findOne({
    originBookingId: booking._id,
    originInstallmentId: installment._id
  });
  if (byOrigin) {
    return { stayCredit: byOrigin, idempotentReplay: true };
  }

  let code = StayCreditModel.generateCode();
  for (let i = 0; i < 5; i += 1) {
    try {
      const doc = await StayCreditModel.create({
        code,
        originBookingId: booking._id,
        originInstallmentId: installment._id,
        originInstallmentSequence: installment.sequence,
        guestEmail: normalizeEmail(booking.guestInfo?.email),
        currency: 'EUR',
        issuedCents,
        remainingCents: issuedCents,
        status: 'active',
        issuedAt: now,
        expiresAt: null,
        issuanceIdempotencyKey: key,
        cashConvertible: false,
        redemptions: []
      });
      return { stayCredit: doc, idempotentReplay: false };
    } catch (err) {
      if (err && err.code === 11000) {
        const raced = await StayCreditModel.findOne({ issuanceIdempotencyKey: key });
        if (raced) return { stayCredit: raced, idempotentReplay: true };
        code = StayCreditModel.generateCode();
        continue;
      }
      throw err;
    }
  }
  throw new StayCreditError('CODE_COLLISION', 'Could not allocate unique stay credit code');
}

/**
 * Preview only — does not reserve or spend.
 */
function computeCardObligationAfterStayCredit({
  totalCents,
  stayCreditRemainingCents,
  applyCents = null
}) {
  const total = Math.trunc(Number(totalCents));
  const remaining = Math.trunc(Number(stayCreditRemainingCents));
  if (!Number.isInteger(total) || total < 0) {
    throw new StayCreditError('INVALID_TOTAL', 'totalCents must be a non-negative integer');
  }
  if (!Number.isInteger(remaining) || remaining < 0) {
    throw new StayCreditError('INVALID_BALANCE', 'stayCreditRemainingCents must be non-negative');
  }
  let apply = applyCents == null ? remaining : Math.trunc(Number(applyCents));
  if (!Number.isInteger(apply) || apply < 0) {
    throw new StayCreditError('INVALID_APPLY', 'applyCents must be a non-negative integer');
  }
  apply = Math.min(apply, remaining, total);
  return {
    totalCents: total,
    appliedCents: apply,
    cardObligationCents: total - apply,
    splitDisabled: apply > 0
  };
}

async function previewStayCreditApplication({
  code,
  totalCents,
  guestEmail = null,
  StayCreditModel = StayCredit
} = {}) {
  const normalizedCode = String(code || '')
    .trim()
    .toUpperCase();
  if (!normalizedCode) {
    return {
      ok: true,
      appliedCents: 0,
      cardObligationCents: Math.max(0, Math.trunc(Number(totalCents)) || 0),
      stayCredit: null
    };
  }
  const credit = await StayCreditModel.findOne({
    code: normalizedCode,
    status: { $in: ['active', 'partially_redeemed'] }
  });
  if (!credit) {
    throw new StayCreditError('NOT_FOUND', 'Stay credit not found');
  }
  if (guestEmail) {
    if (normalizeEmail(credit.guestEmail) !== normalizeEmail(guestEmail)) {
      throw new StayCreditError('GUEST_MISMATCH', 'Stay credit does not belong to this guest');
    }
  }
  const obligation = computeCardObligationAfterStayCredit({
    totalCents,
    stayCreditRemainingCents: credit.remainingCents
  });
  return {
    ok: true,
    appliedCents: obligation.appliedCents,
    cardObligationCents: obligation.cardObligationCents,
    stayCredit: credit,
    splitDisabled: obligation.splitDisabled
  };
}

/**
 * Atomically reserve spendable balance for a checkout session.
 */
async function reserveStayCredit({
  code,
  amountCents = null,
  checkoutSessionId,
  guestEmail,
  expiresAt,
  StayCreditModel = StayCredit,
  StayCreditReservationModel = StayCreditReservation,
  now = new Date()
} = {}) {
  if (!checkoutSessionId || !String(checkoutSessionId).trim()) {
    throw new StayCreditError('CHECKOUT_REQUIRED', 'checkoutSessionId is required');
  }
  const checkoutId = String(checkoutSessionId).trim();
  const email = normalizeEmail(guestEmail);
  if (!expiresAt || Number.isNaN(new Date(expiresAt).getTime())) {
    throw new StayCreditError('EXPIRES_REQUIRED', 'expiresAt is required for reservation');
  }

  const normalizedCode = String(code || '')
    .trim()
    .toUpperCase();
  if (!normalizedCode) {
    throw new StayCreditError('CODE_REQUIRED', 'Stay credit code is required');
  }

  const credit = await StayCreditModel.findOne({ code: normalizedCode });
  if (!credit) {
    throw new StayCreditError('NOT_FOUND', 'Stay credit not found');
  }
  if (normalizeEmail(credit.guestEmail) !== email) {
    throw new StayCreditError('GUEST_MISMATCH', 'Stay credit does not belong to this guest');
  }
  if (!['active', 'partially_redeemed'].includes(String(credit.status))) {
    throw new StayCreditError('NOT_SPENDABLE', 'Stay credit is not spendable');
  }

  const reservationKey = buildReservationKey(checkoutId, credit._id);
  const existingByKey = await StayCreditReservationModel.findOne({ reservationKey });
  if (existingByKey) {
    if (String(existingByKey.status) === 'reserved') {
      return {
        reservation: existingByKey,
        stayCredit: await StayCreditModel.findById(credit._id),
        idempotentReplay: true
      };
    }
    if (String(existingByKey.status) === 'consumed') {
      throw new StayCreditError(
        'RESERVATION_ALREADY_CONSUMED',
        'Stay credit reservation already consumed for this checkout'
      );
    }
    // released — allow new reservation with same key only if we create new key variant;
    // reservationKey is unique including terminal — use new key? Spec says idempotency key.
    // For released same checkout re-apply: create new reservation with key + attempt suffix.
  }

  const liveForCheckout = await StayCreditReservationModel.findOne({
    checkoutSessionId: checkoutId,
    status: 'reserved'
  });
  if (liveForCheckout) {
    if (String(liveForCheckout.stayCreditId) === String(credit._id)) {
      return {
        reservation: liveForCheckout,
        stayCredit: await StayCreditModel.findById(credit._id),
        idempotentReplay: true
      };
    }
    throw new StayCreditError(
      'CHECKOUT_HAS_OTHER_RESERVATION',
      'Checkout already has a reserved stay credit; release it first'
    );
  }

  let apply = amountCents == null ? Number(credit.remainingCents) : Math.trunc(Number(amountCents));
  if (!Number.isInteger(apply) || apply < 1) {
    throw new StayCreditError('INVALID_AMOUNT', 'amountCents must be a positive integer');
  }
  if (amountCents != null && apply > Number(credit.remainingCents)) {
    throw new StayCreditError(
      'INSUFFICIENT_BALANCE',
      'Stay credit has insufficient remaining balance'
    );
  }
  apply = Math.min(apply, Number(credit.remainingCents));
  if (apply < 1) {
    throw new StayCreditError('INSUFFICIENT_BALANCE', 'Stay credit has insufficient remaining balance');
  }

  const key =
    existingByKey && String(existingByKey.status) === 'released'
      ? `${reservationKey}:r${Date.now()}`
      : reservationKey;

  const debited = await StayCreditModel.findOneAndUpdate(
    {
      _id: credit._id,
      remainingCents: { $gte: apply },
      status: { $in: ['active', 'partially_redeemed'] }
    },
    {
      $inc: { remainingCents: -apply, revision: 1 }
    },
    { new: true }
  );
  if (!debited) {
    throw new StayCreditError('INSUFFICIENT_BALANCE', 'Stay credit has insufficient remaining balance');
  }

  const nextStatus = desiredStatus(debited.issuedCents, debited.remainingCents);
  // Keep spendable states until consume — if remaining 0 after reserve, mark partially_redeemed
  // until consume flips to redeemed (avoids treating reserved-as-fully-redeemed).
  const statusAfterReserve =
    Number(debited.remainingCents) === 0 ? 'partially_redeemed' : nextStatus === 'redeemed' ? 'partially_redeemed' : nextStatus;
  if (debited.status !== statusAfterReserve) {
    await StayCreditModel.updateOne({ _id: debited._id }, { $set: { status: statusAfterReserve } });
    debited.status = statusAfterReserve;
  }

  try {
    const reservation = await StayCreditReservationModel.create({
      stayCreditId: credit._id,
      stayCreditCode: credit.code,
      checkoutSessionId: checkoutId,
      reservationKey: key,
      amountCents: apply,
      currency: 'EUR',
      guestEmail: email,
      status: 'reserved',
      bookingId: null,
      expiresAt: new Date(expiresAt),
      reservedAt: now
    });
    return { reservation, stayCredit: debited, idempotentReplay: false };
  } catch (err) {
    // Roll back debit on create failure / unique race
    await StayCreditModel.updateOne(
      { _id: credit._id },
      {
        $inc: { remainingCents: apply, revision: 1 },
        $set: { status: desiredStatus(credit.issuedCents, Number(credit.remainingCents)) }
      }
    );
    if (err && err.code === 11000) {
      const raced = await StayCreditReservationModel.findOne({
        $or: [{ reservationKey: key }, { checkoutSessionId: checkoutId, status: 'reserved' }]
      });
      if (raced && String(raced.status) === 'reserved') {
        return {
          reservation: raced,
          stayCredit: await StayCreditModel.findById(credit._id),
          idempotentReplay: true
        };
      }
    }
    throw err;
  }
}

/**
 * Convert reserved → consumed after Booking persist. Does not re-debit balance.
 */
async function consumeStayCreditReservation({
  checkoutSessionId = null,
  reservationId = null,
  bookingId,
  actorId = 'checkout_finalize',
  StayCreditModel = StayCredit,
  StayCreditReservationModel = StayCreditReservation,
  now = new Date()
} = {}) {
  if (!bookingId) {
    throw new StayCreditError('BOOKING_REQUIRED', 'bookingId is required to consume stay credit');
  }

  let reservation = null;
  if (reservationId) {
    reservation = await StayCreditReservationModel.findById(reservationId);
  } else if (checkoutSessionId) {
    reservation = await StayCreditReservationModel.findOne({
      checkoutSessionId: String(checkoutSessionId),
      status: { $in: ['reserved', 'consumed'] }
    }).sort({ createdAt: -1 });
  }
  if (!reservation) {
    throw new StayCreditError('RESERVATION_NOT_FOUND', 'Stay credit reservation not found');
  }

  if (String(reservation.status) === 'consumed') {
    if (
      reservation.bookingId &&
      String(reservation.bookingId) !== String(bookingId)
    ) {
      throw new StayCreditError(
        'RESERVATION_BOOKING_CONFLICT',
        'Reservation already consumed for a different booking'
      );
    }
    return { reservation, idempotentReplay: true };
  }
  if (String(reservation.status) === 'released') {
    throw new StayCreditError('RESERVATION_RELEASED', 'Cannot consume a released reservation');
  }

  const updated = await StayCreditReservationModel.findOneAndUpdate(
    { _id: reservation._id, status: 'reserved' },
    {
      $set: {
        status: 'consumed',
        bookingId,
        consumedAt: now
      },
      $inc: { revision: 1 }
    },
    { new: true }
  );
  if (!updated) {
    const again = await StayCreditReservationModel.findById(reservation._id);
    if (again && String(again.status) === 'consumed') {
      return { reservation: again, idempotentReplay: true };
    }
    throw new StayCreditError('RESERVATION_NOT_RESERVED', 'Reservation is not in reserved state');
  }

  const redemptionKey = `stay-credit:consume:${updated.reservationKey}`;
  const credit = await StayCreditModel.findById(updated.stayCreditId);
  if (!credit) {
    throw new StayCreditError('NOT_FOUND', 'Stay credit missing during consume');
  }

  const prior = (credit.redemptions || []).find((r) => String(r.redemptionKey) === redemptionKey);
  if (!prior) {
    const redemption = {
      redemptionKey,
      amountCents: updated.amountCents,
      currency: 'EUR',
      checkoutSessionId: updated.checkoutSessionId,
      bookingId,
      redeemedAt: now,
      actorId: String(actorId)
    };
    // Balance already decremented at reserve — only audit + status.
    const rem = Number(credit.remainingCents);
    await StayCreditModel.updateOne(
      { _id: credit._id, 'redemptions.redemptionKey': { $ne: redemptionKey } },
      {
        $push: { redemptions: redemption },
        $set: { status: rem === 0 ? 'redeemed' : desiredStatus(credit.issuedCents, rem) },
        $inc: { revision: 1 }
      }
    );
  }

  return { reservation: updated, idempotentReplay: false };
}

/**
 * Release reserved credit back to spendable balance. Idempotent.
 * Never releases consumed. Never releases if bookingId entitled and paid finalize owns it
 * unless forceAbandoned (caller guarantees no entitled Booking).
 */
async function releaseStayCreditReservation({
  checkoutSessionId = null,
  reservationId = null,
  reason = 'checkout_abandoned',
  StayCreditModel = StayCredit,
  StayCreditReservationModel = StayCreditReservation,
  now = new Date()
} = {}) {
  let reservation = null;
  if (reservationId) {
    reservation = await StayCreditReservationModel.findById(reservationId);
  } else if (checkoutSessionId) {
    reservation = await StayCreditReservationModel.findOne({
      checkoutSessionId: String(checkoutSessionId),
      status: { $in: ['reserved', 'released'] }
    }).sort({ createdAt: -1 });
  }
  if (!reservation) {
    return { released: false, reason: 'not_found' };
  }
  if (String(reservation.status) === 'released') {
    return { reservation, released: true, idempotentReplay: true };
  }
  if (String(reservation.status) === 'consumed') {
    throw new StayCreditError('RESERVATION_CONSUMED', 'Cannot release a consumed reservation');
  }

  const updated = await StayCreditReservationModel.findOneAndUpdate(
    { _id: reservation._id, status: 'reserved' },
    {
      $set: {
        status: 'released',
        releasedAt: now,
        releaseReason: String(reason).slice(0, 200)
      },
      $inc: { revision: 1 }
    },
    { new: true }
  );
  if (!updated) {
    const again = await StayCreditReservationModel.findById(reservation._id);
    if (again && String(again.status) === 'released') {
      return { reservation: again, released: true, idempotentReplay: true };
    }
    if (again && String(again.status) === 'consumed') {
      throw new StayCreditError('RESERVATION_CONSUMED', 'Cannot release a consumed reservation');
    }
    return { released: false, reason: 'cas_miss' };
  }

  const credit = await StayCreditModel.findByIdAndUpdate(
    updated.stayCreditId,
    {
      $inc: { remainingCents: updated.amountCents, revision: 1 }
    },
    { new: true }
  );
  if (credit) {
    const st = desiredStatus(credit.issuedCents, credit.remainingCents);
    if (credit.status !== st) {
      await StayCreditModel.updateOne({ _id: credit._id }, { $set: { status: st } });
    }
  }

  return { reservation: updated, stayCredit: credit, released: true, idempotentReplay: false };
}

/**
 * Release expired reserved credits only when checkout is expired and no Booking owns them.
 */
async function releaseExpiredStayCreditReservations({
  now = new Date(),
  limit = 50,
  BookingModel = null,
  StayCreditReservationModel = StayCreditReservation
} = {}) {
  const Booking = BookingModel || require('../models/Booking');
  const rows = await StayCreditReservationModel.find({
    status: 'reserved',
    expiresAt: { $lte: now }
  })
    .sort({ expiresAt: 1 })
    .limit(limit);

  const results = [];
  for (const row of rows) {
    const entitled = await Booking.findOne({
      checkoutId: row.checkoutSessionId,
      status: { $in: ['confirmed', 'pending'] }
    }).select('_id status').lean();
    if (entitled) {
      results.push({
        reservationId: String(row._id),
        released: false,
        reason: 'booking_entitled',
        bookingId: String(entitled._id)
      });
      continue;
    }
    try {
      const r = await releaseStayCreditReservation({
        reservationId: row._id,
        reason: 'reservation_expired',
        now
      });
      results.push({ reservationId: String(row._id), ...r });
    } catch (err) {
      results.push({
        reservationId: String(row._id),
        released: false,
        reason: err.code || 'error',
        message: err.message
      });
    }
  }
  return results;
}

async function findStayCreditsForBooking(bookingId, StayCreditModel = StayCredit) {
  return StayCreditModel.find({ originBookingId: bookingId }).sort({ originInstallmentSequence: 1 });
}

module.exports = {
  StayCreditError,
  buildIssuanceIdempotencyKey,
  buildReservationKey,
  issueStayCreditForPaidInstallment,
  previewStayCreditApplication,
  computeCardObligationAfterStayCredit,
  reserveStayCredit,
  consumeStayCreditReservation,
  releaseStayCreditReservation,
  releaseExpiredStayCreditReservations,
  findStayCreditsForBooking
};
