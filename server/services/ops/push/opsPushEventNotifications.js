'use strict';

const mongoose = require('mongoose');
const Booking = require('../../../models/Booking');
const Cabin = require('../../../models/Cabin');
const CabinType = require('../../../models/CabinType');
const GiftVoucher = require('../../../models/GiftVoucher');
const Payment = require('../../../models/Payment');
const Review = require('../../../models/Review');
const { formatSofiaDisplayDate } = require('../../../utils/dateTime');
const { sendOpsPushSafely } = require('./opsPushService');

const PAYMENT_ALERT_STATUSES = new Set(['failed', 'refunded', 'partial']);

let sendOpsPushSafelyImpl = sendOpsPushSafely;

function __setSendOpsPushSafelyForTesting(fn) {
  sendOpsPushSafelyImpl = typeof fn === 'function' ? fn : sendOpsPushSafely;
}

function __resetSendOpsPushSafelyForTesting() {
  sendOpsPushSafelyImpl = sendOpsPushSafely;
}

function safePush(params) {
  return sendOpsPushSafelyImpl(params);
}

function formatGuestName(guestInfo) {
  const first = String(guestInfo?.firstName || '').trim();
  const last = String(guestInfo?.lastName || '').trim();
  return [first, last].filter(Boolean).join(' ') || 'Guest';
}

function formatEuroAmount(amount) {
  if (!Number.isFinite(Number(amount))) {
    return '—';
  }
  return `€${Number(amount).toFixed(2)}`;
}

function isGiftVoucherPaymentMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return false;
  }
  if (metadata.type === 'gift_voucher') {
    return true;
  }
  if (metadata.giftVoucherId) {
    return true;
  }
  const purchaseRequestId = metadata.purchaseRequestId;
  if (typeof purchaseRequestId === 'string' && purchaseRequestId.startsWith('gvr_')) {
    return true;
  }
  return false;
}

async function loadBookingContext(bookingId) {
  const booking = await Booking.findById(bookingId)
    .select('guestInfo checkIn checkOut status cabinId cabinTypeId')
    .lean();
  if (!booking) {
    return null;
  }

  let propertyLabel = 'Property';
  if (booking.cabinId) {
    const cabin = await Cabin.findById(booking.cabinId).select('name').lean();
    if (cabin?.name) {
      propertyLabel = cabin.name;
    }
  } else if (booking.cabinTypeId) {
    const cabinType = await CabinType.findById(booking.cabinTypeId).select('name').lean();
    if (cabinType?.name) {
      propertyLabel = cabinType.name;
    }
  }

  const checkIn = formatSofiaDisplayDate(booking.checkIn);
  const checkOut = formatSofiaDisplayDate(booking.checkOut);
  const dateRange = checkIn && checkOut ? `${checkIn}–${checkOut}` : 'dates unknown';

  return {
    guestName: formatGuestName(booking.guestInfo),
    propertyLabel,
    dateRange,
    status: booking.status || 'pending'
  };
}

function buildBookingBody(ctx) {
  if (!ctx) {
    return 'New reservation received';
  }
  return `${ctx.guestName} · ${ctx.propertyLabel} · ${ctx.dateRange} · ${ctx.status}`;
}

function resolveReservationId(payment) {
  if (payment?.reservationId) {
    return String(payment.reservationId);
  }
  const metadata = payment?.metadata || {};
  const fromMeta = metadata.bookingId || metadata.reservationId || null;
  return fromMeta ? String(fromMeta) : null;
}

function resolveGiftVoucherId(payment) {
  const metadata = payment?.metadata || {};
  if (metadata.giftVoucherId) {
    return String(metadata.giftVoucherId);
  }
  return null;
}

function paymentAlertTitle(status, eventType) {
  if (status === 'failed' && eventType === 'refund.failed') {
    return 'Refund failed';
  }
  if (status === 'failed') {
    return 'Payment failed';
  }
  if (status === 'refunded') {
    return 'Payment refunded';
  }
  if (status === 'partial') {
    return 'Partial refund';
  }
  return 'Payment alert';
}

async function notifyOpsPushBookingCreated({ bookingId, source = 'booking_created' }) {
  if (!bookingId || !mongoose.Types.ObjectId.isValid(String(bookingId))) {
    return;
  }
  try {
    const ctx = await loadBookingContext(bookingId);
    await safePush({
      role: 'admin',
      title: 'New reservation',
      body: buildBookingBody(ctx),
      url: `/ops/reservations/${String(bookingId)}`,
      tag: 'booking-created',
      dedupeKey: `booking_created:${String(bookingId)}`,
      source: source || 'booking_created'
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        source: 'ops-push',
        phase: 'booking_created_notify_error',
        bookingId: String(bookingId),
        error: err?.message || String(err)
      })
    );
  }
}

async function notifyOpsPushManualReservationCreated({ bookingId }) {
  if (!bookingId || !mongoose.Types.ObjectId.isValid(String(bookingId))) {
    return;
  }
  try {
    const ctx = await loadBookingContext(bookingId);
    await safePush({
      role: 'admin',
      title: 'Manual reservation',
      body: buildBookingBody(ctx),
      url: `/ops/reservations/${String(bookingId)}`,
      tag: 'booking-created',
      dedupeKey: `manual_reservation_created:${String(bookingId)}`,
      source: 'manual_reservation_created'
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        source: 'ops-push',
        phase: 'manual_reservation_notify_error',
        bookingId: String(bookingId),
        error: err?.message || String(err)
      })
    );
  }
}

async function notifyOpsPushGiftVoucherSold({ giftVoucherId }) {
  if (!giftVoucherId || !mongoose.Types.ObjectId.isValid(String(giftVoucherId))) {
    return;
  }
  try {
    const voucher = await GiftVoucher.findById(giftVoucherId)
      .select('amountOriginalCents code')
      .lean();
    const amount = voucher ? formatEuroAmount(Number(voucher.amountOriginalCents || 0) / 100) : '—';
    const code = voucher?.code ? String(voucher.code) : 'pending';
    await safePush({
      role: 'admin',
      title: 'Gift voucher sold',
      body: `${amount} · code ${code}`,
      url: `/ops/gift-vouchers/${String(giftVoucherId)}`,
      tag: 'gift-voucher-sold',
      dedupeKey: `gift_voucher_sold:${String(giftVoucherId)}`,
      source: 'gift_voucher_sold'
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        source: 'ops-push',
        phase: 'gift_voucher_sold_notify_error',
        giftVoucherId: String(giftVoucherId),
        error: err?.message || String(err)
      })
    );
  }
}

async function notifyOpsPushPaymentAlert({ eventId, eventType, paymentId }) {
  if (!eventId || !paymentId || !mongoose.Types.ObjectId.isValid(String(paymentId))) {
    return;
  }
  try {
    const payment = await Payment.findById(paymentId)
      .select('status amount reservationId metadata')
      .lean();
    if (!payment || !PAYMENT_ALERT_STATUSES.has(payment.status)) {
      return;
    }

    const reservationId = resolveReservationId(payment);
    const giftVoucherId = resolveGiftVoucherId(payment);
    const isVoucherPayment = isGiftVoucherPaymentMetadata(payment.metadata);

    if (!reservationId && !giftVoucherId && !isVoucherPayment) {
      return;
    }

    const effectiveVoucherId = giftVoucherId || (isVoucherPayment ? payment.metadata?.giftVoucherId : null);
    const url = reservationId
      ? `/ops/reservations/${reservationId}`
      : effectiveVoucherId
        ? `/ops/gift-vouchers/${String(effectiveVoucherId)}`
        : null;
    if (!url) {
      return;
    }

    const amountLabel = formatEuroAmount(payment.amount);
    const body = reservationId
      ? `Reservation ${reservationId} · ${amountLabel}`
      : `Gift voucher ${String(effectiveVoucherId)} · ${amountLabel}`;

    await safePush({
      role: 'admin',
      title: paymentAlertTitle(payment.status, eventType),
      body,
      url,
      tag: 'payment-alert',
      dedupeKey: `stripe_payment_event:${String(eventId)}`,
      source: `stripe_payment_${payment.status}`
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        source: 'ops-push',
        phase: 'payment_alert_notify_error',
        eventId: String(eventId),
        paymentId: String(paymentId),
        error: err?.message || String(err)
      })
    );
  }
}

async function notifyOpsPushPaymentFlowAlert({
  route,
  statusCode,
  errorReason,
  count,
  windowMinutes,
  immediate = false,
  suggestedAction,
  dedupeKey
}) {
  const title = immediate ? 'Payment flow error' : 'Payment flow warning';
  const body = [
    immediate
      ? 'Payment initialization failed.'
      : `Checkout failed ${count} times in ${windowMinutes} minutes.`,
    `Route: ${route}`,
    `Status: ${statusCode}`,
    `Reason: ${errorReason}`,
    `Action: ${suggestedAction}`
  ].join(' · ');

  try {
    await safePush({
      role: 'admin',
      title,
      body,
      url: '/ops/manual-review',
      tag: 'payment-flow-alert',
      dedupeKey: dedupeKey || `payment_flow:${route}:${errorReason}`,
      source: immediate ? 'payment_flow_immediate' : 'payment_flow_threshold'
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        source: 'ops-push',
        phase: 'payment_flow_alert_notify_error',
        route,
        statusCode,
        errorReason,
        error: err?.message || String(err)
      })
    );
  }
}

async function notifyOpsPushManualReviewOpened({
  manualReviewItemId,
  category,
  failedInvariant = null,
  correlationId = null
}) {
  if (!manualReviewItemId) return;
  const invariant = failedInvariant ? String(failedInvariant) : 'unspecified';
  const corr = correlationId ? String(correlationId) : String(manualReviewItemId);
  try {
    await safePush({
      role: 'admin',
      title: 'Manual review required',
      body: [
        `Category: ${category || 'unknown'}`,
        `Invariant: ${invariant}`,
        `Ref: ${corr}`
      ].join(' · '),
      url: '/ops/manual-review',
      tag: 'manual-review-opened',
      dedupeKey: `manual_review:${String(manualReviewItemId)}`,
      source: 'manual_review_opened'
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        source: 'ops-push',
        phase: 'manual_review_opened_notify_error',
        manualReviewItemId: String(manualReviewItemId),
        error: err?.message || String(err)
      })
    );
  }
}

async function notifyOpsPushReviewCreated({ reviewId }) {
  if (!reviewId || !mongoose.Types.ObjectId.isValid(String(reviewId))) {
    return;
  }
  try {
    const review = await Review.findById(reviewId).select('cabinId rating reviewerName').lean();
    let cabinName = 'Property';
    if (review?.cabinId) {
      const cabin = await Cabin.findById(review.cabinId).select('name').lean();
      if (cabin?.name) {
        cabinName = cabin.name;
      }
    }
    const rating = review?.rating != null ? String(review.rating) : '?';
    const reviewerName = review?.reviewerName?.trim() ? review.reviewerName.trim() : 'Guest';
    await safePush({
      role: 'admin',
      title: 'New review',
      body: `${cabinName} · ${rating}★ · ${reviewerName}`,
      url: '/ops/reviews',
      tag: 'review-created',
      dedupeKey: `review_created:${String(reviewId)}`,
      source: 'review_created'
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        source: 'ops-push',
        phase: 'review_created_notify_error',
        reviewId: String(reviewId),
        error: err?.message || String(err)
      })
    );
  }
}

module.exports = {
  notifyOpsPushBookingCreated,
  notifyOpsPushManualReservationCreated,
  notifyOpsPushGiftVoucherSold,
  notifyOpsPushPaymentAlert,
  notifyOpsPushPaymentFlowAlert,
  notifyOpsPushManualReviewOpened,
  notifyOpsPushReviewCreated,
  __setSendOpsPushSafelyForTesting,
  __resetSendOpsPushSafelyForTesting
};
