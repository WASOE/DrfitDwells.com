const Booking = require('../../../models/Booking');
const Payment = require('../../../models/Payment');
const Payout = require('../../../models/Payout');
const ChannelSyncEvent = require('../../../models/ChannelSyncEvent');
const CommunicationEventLegacy = require('../../../models/EmailEvent');
const ManualReviewItem = require('../../../models/ManualReviewItem');
const { mapBookingToReservationCompatible } = require('../../../mappers/bookingToReservationMapper');
const { normalizeDateToSofiaDayStart } = require('../../../utils/dateTime');
const { isFixtureBookingEmail } = require('../../../utils/fixtureExclusion');

function dayRange(dateInput = new Date()) {
  const start = normalizeDateToSofiaDayStart(dateInput);
  const end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function getEndOfToday(startOfToday) {
  const end = new Date(startOfToday);
  end.setHours(23, 59, 59, 999);
  return end;
}

function getEndOf7Days(startOfToday) {
  const end = new Date(startOfToday);
  end.setDate(end.getDate() + 7);
  end.setHours(23, 59, 59, 999);
  return end;
}

function resolveUnitLabel(booking) {
  if (!booking?.unitId) return null;
  const displayName = typeof booking.unitId.displayName === 'string' ? booking.unitId.displayName.trim() : '';
  if (displayName) return displayName;
  const unitNumber = typeof booking.unitId.unitNumber === 'string' ? booking.unitId.unitNumber.trim() : '';
  if (!unitNumber) return null;
  if (/^unit\b/i.test(unitNumber)) return unitNumber;
  return `Unit ${unitNumber}`;
}

function resolveAccommodationDisplayName(booking) {
  const base = booking?.cabinId?.name || booking?.cabinTypeId?.name || 'Unknown';
  const unit = resolveUnitLabel(booking);
  return unit ? `${base} · ${unit}` : base;
}

function derivePaymentStatus(payments) {
  if (!payments || payments.length === 0) return null;
  if (payments.some((p) => p.status === 'disputed')) return 'disputed';
  if (payments.some((p) => p.status === 'failed')) return 'failed';
  if (payments.some((p) => p.status === 'refunded')) return 'refunded';
  if (payments.some((p) => p.status === 'partial')) return 'partial';
  if (payments.some((p) => p.status === 'paid')) return 'paid';
  return null;
}

function classifyReservationPaymentStatus({ booking, linkedPaymentTrail, hasUnlinkedStripePayment }) {
  const linkedStatus = derivePaymentStatus(linkedPaymentTrail);
  if (linkedStatus) return linkedStatus;

  const provenanceSource = String(booking?.provenance?.source || '').trim();
  const hasStripePaymentIntent = typeof booking?.stripePaymentIntentId === 'string' && booking.stripePaymentIntentId.trim().length > 0;
  const isManualReservation = provenanceSource === 'admin_manual' || provenanceSource === 'operator_manual';

  if (hasStripePaymentIntent && hasUnlinkedStripePayment) return 'unlinked_payment';
  if (hasStripePaymentIntent && !hasUnlinkedStripePayment) return 'pending_verification';
  if (isManualReservation) return 'manual_not_required';
  if (booking?.totalPrice > 0) return 'unpaid';
  return 'unknown';
}

function deriveStayTiming(booking, startOfToday) {
  const endOfToday = getEndOfToday(startOfToday);
  const checkIn = booking?.checkIn ? new Date(booking.checkIn) : null;
  const checkOut = booking?.checkOut ? new Date(booking.checkOut) : null;
  const isCancelled = booking?.status === 'cancelled';
  return {
    arrivingToday: !isCancelled && !!checkIn && checkIn >= startOfToday && checkIn <= endOfToday,
    checkingOutToday: !isCancelled && !!checkOut && checkOut >= startOfToday && checkOut <= endOfToday,
    currentlyStaying: !isCancelled && !!checkIn && !!checkOut && checkIn < startOfToday && checkOut > endOfToday,
    checkedOut: !isCancelled && !!checkOut && checkOut < startOfToday,
    upcoming: !isCancelled && !!checkIn && checkIn > endOfToday
  };
}

function derivePaymentAttentionSignals({ reservationStatus, paymentStatus }) {
  const failedOrDisputed = paymentStatus === 'failed' || paymentStatus === 'disputed';
  const pendingVerification = paymentStatus === 'pending_verification';
  const unlinkedPayment = paymentStatus === 'unlinked_payment';
  const unpaid = paymentStatus === 'unpaid';
  const cancelled = reservationStatus === 'cancelled';
  const cancelledPaid = cancelled && (paymentStatus === 'paid' || paymentStatus === 'partial');
  const cancelledUnlinkedAudit = cancelled && unlinkedPayment;
  const refundPending = cancelled && (paymentStatus === 'paid' || paymentStatus === 'partial' || pendingVerification);
  const unpaidActiveAttention = !cancelled && unpaid;
  const paymentAttention =
    failedOrDisputed ||
    pendingVerification ||
    unlinkedPayment ||
    cancelledPaid ||
    cancelledUnlinkedAudit ||
    refundPending ||
    unpaidActiveAttention;
  return {
    paymentAttention,
    cancelledPaid,
    cancelledUnlinkedAudit,
    refundPending,
    unlinkedPayment,
    failedOrDisputed,
    pendingVerification,
    unpaidActiveAttention
  };
}

function buildActionBadges({ reservationStatus, paymentStatus, stayTiming, paymentSignals }) {
  const badges = [];
  if (reservationStatus === 'cancelled') badges.push('Cancelled');
  if (stayTiming.arrivingToday) badges.push('Arriving today');
  if (stayTiming.currentlyStaying) badges.push('Currently staying');
  if (stayTiming.checkingOutToday) badges.push('Checking out today');
  if (paymentSignals.failedOrDisputed) badges.push('Failed/disputed');
  if (paymentSignals.pendingVerification) badges.push('Pending verification');
  if (paymentSignals.unlinkedPayment) badges.push('Unlinked payment');
  if (paymentSignals.unpaidActiveAttention) badges.push('Unpaid');
  if (paymentSignals.cancelledPaid) badges.push('Cancelled + paid');
  if (paymentSignals.cancelledUnlinkedAudit) badges.push('Cancelled + unlinked');
  if (paymentStatus === 'refunded') badges.push('Refunded');
  if (paymentSignals.refundPending) badges.push('Refund follow-up');
  if (paymentSignals.paymentAttention) badges.push('Payment attention');
  return badges;
}

async function getDashboardReadModel() {
  const now = new Date();
  const { start, end } = dayRange(now);
  const endOfToday = getEndOfToday(start);
  const endOf7Days = getEndOf7Days(start);

  const [failedEmails, upcomingPayouts, openManualReviews] =
    await Promise.all([
      CommunicationEventLegacy.countDocuments({ type: { $in: ['Bounce', 'SpamComplaint'] } }),
      Payout.countDocuments({ expectedArrivalDate: { $gte: start } }),
      ManualReviewItem.countDocuments({ status: 'open' })
    ]);

  const bookings = await Booking.find({
    isTest: { $ne: true },
    $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }]
  })
    .populate('cabinId', 'name location')
    .populate('cabinTypeId', 'name location')
    .populate('unitId', 'displayName unitNumber')
    .sort({ createdAt: -1 })
    .lean();
  const reservationIds = bookings.map((b) => String(b._id));
  const stripePaymentIntentIds = bookings
    .map((b) => (typeof b.stripePaymentIntentId === 'string' ? b.stripePaymentIntentId.trim() : ''))
    .filter(Boolean);

  const [payments, unlinkedPayments] = await Promise.all([
    Payment.find({ reservationId: { $in: reservationIds } }).lean(),
    stripePaymentIntentIds.length
      ? Payment.find({
          provider: 'stripe',
          reservationId: null,
          $or: [
            { providerReference: { $in: stripePaymentIntentIds } },
            { paymentIntentId: { $in: stripePaymentIntentIds } },
            { stripePaymentIntentId: { $in: stripePaymentIntentIds } },
            { 'metadata.paymentIntentId': { $in: stripePaymentIntentIds } },
            { 'metadata.stripePaymentIntentId': { $in: stripePaymentIntentIds } },
            { 'metadata.id': { $in: stripePaymentIntentIds } }
          ]
        }).lean()
      : []
  ]);

  const paymentsByReservation = new Map();
  for (const payment of payments) {
    const key = payment.reservationId ? String(payment.reservationId) : null;
    if (!key) continue;
    if (!paymentsByReservation.has(key)) paymentsByReservation.set(key, []);
    paymentsByReservation.get(key).push(payment);
  }

  const unlinkedPaymentByPaymentIntent = new Set();
  for (const payment of unlinkedPayments) {
    const candidateKeys = [
      payment.providerReference,
      payment.paymentIntentId,
      payment.stripePaymentIntentId,
      payment.metadata?.paymentIntentId,
      payment.metadata?.stripePaymentIntentId,
      payment.metadata?.id
    ]
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter(Boolean);
    for (const key of candidateKeys) unlinkedPaymentByPaymentIntent.add(key);
  }

  const rows = bookings
    .filter((booking) => !isFixtureBookingEmail(booking?.guestInfo?.email))
    .map((booking) => {
    const mapped = mapBookingToReservationCompatible(booking);
    const paymentTrail = paymentsByReservation.get(String(booking._id)) || [];
    const pi = typeof booking.stripePaymentIntentId === 'string' ? booking.stripePaymentIntentId.trim() : '';
    const paymentStatus = classifyReservationPaymentStatus({
      booking,
      linkedPaymentTrail: paymentTrail,
      hasUnlinkedStripePayment: pi ? unlinkedPaymentByPaymentIntent.has(pi) : false
    });
    const stayTiming = deriveStayTiming(booking, start);
    const paymentSignals = derivePaymentAttentionSignals({
      reservationStatus: mapped.reservationStatus,
      paymentStatus
    });

      return {
        reservationId: mapped.reservationId,
        detailPath: `/ops/reservations/${mapped.reservationId}`,
        guestName: `${mapped.guest?.firstName || ''} ${mapped.guest?.lastName || ''}`.trim() || 'Guest',
        guestEmail: mapped.guest?.email || null,
        accommodationDisplayName: resolveAccommodationDisplayName(booking),
        checkInDateOnly: mapped.checkInDateOnly,
        checkOutDateOnly: mapped.checkOutDateOnly,
        checkInDate: mapped.checkInDate,
        adults: booking.adults ?? 0,
        children: booking.children ?? 0,
        reservationStatus: mapped.reservationStatus,
        paymentStatus,
        source: mapped.source || null,
        signals: paymentSignals,
        badges: buildActionBadges({
          reservationStatus: mapped.reservationStatus,
          paymentStatus,
          stayTiming,
          paymentSignals
        }),
        stayTiming
      };
    });

  const actionNeeded = rows.filter((row) => row.signals.paymentAttention);
  const arrivalsTodayRows = rows.filter((row) => row.stayTiming.arrivingToday);
  const inHouseRows = rows.filter((row) => row.stayTiming.currentlyStaying);
  const checkingOutTodayRows = rows.filter((row) => row.stayTiming.checkingOutToday);
  const upcoming7Days = rows.filter((row) => {
    if (row.reservationStatus === 'cancelled') return false;
    const checkInDate = row.checkInDate ? new Date(row.checkInDate) : null;
    return checkInDate && checkInDate > endOfToday && checkInDate <= endOf7Days;
  });
  const cancelledRefundPending = rows.filter(
    (row) => row.reservationStatus === 'cancelled' && (row.signals.refundPending || row.signals.cancelledPaid)
  );
  const failedPayments = rows.filter((row) => row.signals.failedOrDisputed).length;

  const latestSync = await ChannelSyncEvent.findOne({}).sort({ runAt: -1 }).lean();
  const syncWarnings = await ChannelSyncEvent.countDocuments({ outcome: { $in: ['warning', 'failed'] } });

  return {
    generatedAt: new Date().toISOString(),
    freshness: {
      isStale: false,
      degraded: false,
      reason: null
    },
    aggregates: {
      arrivalsToday: arrivalsTodayRows.length,
      departuresToday: checkingOutTodayRows.length,
      inHouse: inHouseRows.length,
      actionNeeded: actionNeeded.length,
      upcoming7Days: upcoming7Days.length,
      cancelledRefundPending: cancelledRefundPending.length,
      pendingActions: openManualReviews,
      failedPayments,
      failedEmails,
      upcomingPayouts,
      syncWarnings,
      totalReservationsConsidered: rows.length
    },
    sections: {
      actionNeeded,
      arrivalsToday: arrivalsTodayRows,
      inHouse: inHouseRows,
      checkingOutToday: checkingOutTodayRows,
      upcoming7Days,
      cancelledRefundPending
    },
    occupancySnapshot: {
      source: 'derived',
      value: {
        inHouse: inHouseRows.length
      }
    },
    quickActionTargets: {
      reservationsPath: '/api/ops/reservations',
      calendarPath: '/api/ops/calendar',
      cabinsPath: '/api/ops/cabins'
    },
    sync: {
      lastSyncAt: latestSync?.runAt || null,
      lastSyncOutcome: latestSync?.outcome || null
    },
    provenance: {
      rows: 'derived_from_bookings_and_payments',
      primarySectionCounts: 'derived_from_section_arrays',
      secondaryMetrics: 'derived_on_read'
    }
  };
}

module.exports = {
  getDashboardReadModel
};
