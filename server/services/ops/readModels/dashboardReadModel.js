const Booking = require('../../../models/Booking');
const Payment = require('../../../models/Payment');
const Payout = require('../../../models/Payout');
const ChannelSyncEvent = require('../../../models/ChannelSyncEvent');
const EmailEvent = require('../../../models/EmailEvent');
const ManualReviewItem = require('../../../models/ManualReviewItem');
const StripeEventEvidence = require('../../../models/StripeEventEvidence');
const { mapBookingToReservationCompatible } = require('../../../mappers/bookingToReservationMapper');
const { normalizeDateToSofiaDayStart } = require('../../../utils/dateTime');
const { FIXTURE_BOOKING_EMAIL_PATTERN } = require('../../../utils/fixtureExclusion');

function dayRange(dateInput = new Date()) {
  const start = normalizeDateToSofiaDayStart(dateInput);
  const end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function startOfMonth(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function startOfNextMonth(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function baseBookingFilter() {
  return {
    isTest: { $ne: true },
    $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }],
    'guestInfo.email': { $not: FIXTURE_BOOKING_EMAIL_PATTERN }
  };
}

function severityScore(severity) {
  const order = { critical: 4, high: 3, medium: 2, low: 1 };
  return order[severity] || 1;
}

function paymentSeverity(status) {
  if (status === 'failed' || status === 'disputed') return 'critical';
  if (status === 'pending_verification' || status === 'unlinked_payment') return 'high';
  if (status === 'unpaid') return 'medium';
  return 'low';
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

function mapReservationRow(booking, paymentStatus) {
  const mapped = mapBookingToReservationCompatible(booking);
  const guestsLabel = `${booking.adults ?? 0}A${(booking.children ?? 0) > 0 ? ` ${(booking.children ?? 0)}C` : ''}`;
  return {
    reservationId: mapped.reservationId,
    href: `/ops/reservations/${mapped.reservationId}`,
    guestName: `${mapped.guest?.firstName || ''} ${mapped.guest?.lastName || ''}`.trim() || 'Guest',
    guestEmail: mapped.guest?.email || null,
    accommodationDisplayName: resolveAccommodationDisplayName(booking),
    datesLabel: `${mapped.checkInDateOnly || '—'} - ${mapped.checkOutDateOnly || '—'}`,
    guestsLabel,
    reservationStatus: mapped.reservationStatus,
    paymentStatus,
    statusLabel: mapped.reservationStatus || 'unknown',
    checkInDate: mapped.checkInDate,
    checkInDateOnly: mapped.checkInDateOnly,
    checkOutDateOnly: mapped.checkOutDateOnly
  };
}

function hydrateAlerts(alerts = []) {
  return alerts
    .sort((a, b) => {
      const sev = severityScore(b.severity) - severityScore(a.severity);
      if (sev !== 0) return sev;
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    })
    .slice(0, 8);
}

async function getDashboardReadModel() {
  const now = new Date();
  const { start: startOfToday } = dayRange(now);
  const endOfToday = endOfDay(startOfToday);
  const endOf7Days = endOfDay(addDays(startOfToday, 7));
  const endOf14Days = endOfDay(addDays(startOfToday, 14));
  const monthStart = startOfMonth(now);
  const nextMonthStart = startOfNextMonth(now);
  const twoWeeksAgo = addDays(startOfToday, -14);
  const oneWeekAgo = addDays(startOfToday, -7);

  const bookingBase = baseBookingFilter();
  const todayArrivingFilter = {
    ...bookingBase,
    status: { $ne: 'cancelled' },
    checkIn: { $gte: startOfToday, $lte: endOfToday }
  };
  const stayingFilter = {
    ...bookingBase,
    status: { $ne: 'cancelled' },
    checkIn: { $lt: startOfToday },
    checkOut: { $gt: endOfToday }
  };
  const leavingFilter = {
    ...bookingBase,
    status: { $ne: 'cancelled' },
    checkOut: { $gte: startOfToday, $lte: endOfToday }
  };
  const upcoming14Filter = {
    ...bookingBase,
    status: { $ne: 'cancelled' },
    checkIn: { $gt: endOfToday, $lte: endOf14Days }
  };
  const nextArrivalsFilter = {
    ...bookingBase,
    status: { $ne: 'cancelled' },
    checkIn: { $gt: endOfToday }
  };
  const alertBookingFilter = {
    ...bookingBase,
    $or: [
      { status: { $ne: 'cancelled' }, checkOut: { $gte: startOfToday } },
      { status: 'cancelled', updatedAt: { $gte: twoWeeksAgo } }
    ]
  };
  const activeForPulseFilter = {
    ...bookingBase,
    status: { $ne: 'cancelled' },
    checkOut: { $gte: startOfToday }
  };
  const pulseMonthFilter = {
    ...bookingBase,
    status: { $ne: 'cancelled' },
    createdAt: { $gte: monthStart, $lt: nextMonthStart }
  };

  const [
    arrivingBookings,
    stayingBookings,
    leavingBookings,
    next14Count,
    nextArrivalsBookings,
    alertBookings,
    pulseActiveBookings,
    pulseMonthAgg,
    upcoming7Count,
    cancellationsMTD,
    refundsMTD,
    failedEmailCountRecent,
    failedEmailEvents,
    syncEventsRecent,
    syncWarningsRecent,
    manualReviewOpenCount,
    manualReviewOpenItems,
    upcomingPayouts,
    stripeLastWebhook
  ] = await Promise.all([
    Booking.find(todayArrivingFilter).populate('cabinId', 'name').populate('cabinTypeId', 'name').populate('unitId', 'displayName unitNumber').sort({ checkIn: 1 }).limit(20).lean(),
    Booking.find(stayingFilter).populate('cabinId', 'name').populate('cabinTypeId', 'name').populate('unitId', 'displayName unitNumber').sort({ checkOut: 1 }).limit(20).lean(),
    Booking.find(leavingFilter).populate('cabinId', 'name').populate('cabinTypeId', 'name').populate('unitId', 'displayName unitNumber').sort({ checkOut: 1 }).limit(20).lean(),
    Booking.countDocuments(upcoming14Filter),
    Booking.find(nextArrivalsFilter).populate('cabinId', 'name').populate('cabinTypeId', 'name').populate('unitId', 'displayName unitNumber').sort({ checkIn: 1 }).limit(5).lean(),
    Booking.find(alertBookingFilter).populate('cabinId', 'name').populate('cabinTypeId', 'name').populate('unitId', 'displayName unitNumber').sort({ updatedAt: -1 }).limit(120).lean(),
    Booking.find(activeForPulseFilter).select('_id status totalPrice stripePaymentIntentId provenance createdAt checkIn checkOut guestInfo').lean(),
    Booking.aggregate([
      { $match: pulseMonthFilter },
      { $group: { _id: null, bookingsMTD: { $sum: 1 }, bookingValueMTD: { $sum: '$totalPrice' } } }
    ]),
    Booking.countDocuments({
      ...bookingBase,
      status: { $ne: 'cancelled' },
      checkIn: { $gt: endOfToday, $lte: endOf7Days }
    }),
    Booking.countDocuments({ ...bookingBase, status: 'cancelled', updatedAt: { $gte: monthStart, $lt: nextMonthStart } }),
    Payment.countDocuments({ status: 'refunded', updatedAt: { $gte: monthStart, $lt: nextMonthStart } }),
    EmailEvent.countDocuments({
      createdAt: { $gte: twoWeeksAgo },
      $or: [{ type: { $in: ['Bounce', 'SpamComplaint'] } }, { sendStatus: 'failed' }]
    }),
    EmailEvent.find({
      createdAt: { $gte: twoWeeksAgo },
      $or: [{ type: { $in: ['Bounce', 'SpamComplaint'] } }, { sendStatus: 'failed' }]
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
    ChannelSyncEvent.find({ runAt: { $gte: oneWeekAgo }, outcome: { $in: ['warning', 'failed'] } }).sort({ runAt: -1 }).limit(5).lean(),
    ChannelSyncEvent.countDocuments({ runAt: { $gte: oneWeekAgo }, outcome: { $in: ['warning', 'failed'] } }),
    ManualReviewItem.countDocuments({ status: 'open' }),
    ManualReviewItem.find({ status: 'open' }).sort({ severity: -1, createdAt: -1 }).limit(5).lean(),
    Payout.countDocuments({ expectedArrivalDate: { $gte: startOfToday } }),
    StripeEventEvidence.findOne({}).sort({ createdAtProvider: -1 }).lean()
  ]);

  const allBookingRefs = [
    ...arrivingBookings,
    ...stayingBookings,
    ...leavingBookings,
    ...nextArrivalsBookings,
    ...alertBookings,
    ...pulseActiveBookings
  ];
  const uniqueById = new Map();
  for (const booking of allBookingRefs) uniqueById.set(String(booking._id), booking);
  const uniqueBookings = [...uniqueById.values()];

  const reservationIds = uniqueBookings.map((b) => String(b._id));
  const stripePaymentIntentIds = uniqueBookings
    .map((b) => (typeof b.stripePaymentIntentId === 'string' ? b.stripePaymentIntentId.trim() : ''))
    .filter(Boolean);

  const [payments, unlinkedPayments] = await Promise.all([
    reservationIds.length ? Payment.find({ reservationId: { $in: reservationIds } }).lean() : [],
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

  const unlinkedPaymentByIntent = new Set();
  for (const payment of unlinkedPayments) {
    const keys = [
      payment.providerReference,
      payment.paymentIntentId,
      payment.stripePaymentIntentId,
      payment.metadata?.paymentIntentId,
      payment.metadata?.stripePaymentIntentId,
      payment.metadata?.id
    ]
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter(Boolean);
    for (const key of keys) unlinkedPaymentByIntent.add(key);
  }

  const paymentStatusByReservation = new Map();
  for (const booking of uniqueBookings) {
    const key = String(booking._id);
    const trail = paymentsByReservation.get(key) || [];
    const pi = typeof booking.stripePaymentIntentId === 'string' ? booking.stripePaymentIntentId.trim() : '';
    const paymentStatus = classifyReservationPaymentStatus({
      booking,
      linkedPaymentTrail: trail,
      hasUnlinkedStripePayment: pi ? unlinkedPaymentByIntent.has(pi) : false
    });
    paymentStatusByReservation.set(key, paymentStatus);
  }

  const mapRows = (bookings) =>
    bookings.map((booking) => {
      const paymentStatus = paymentStatusByReservation.get(String(booking._id)) || 'unknown';
      return mapReservationRow(booking, paymentStatus);
    });

  const todayArrivingRows = mapRows(arrivingBookings);
  const todayStayingRows = mapRows(stayingBookings);
  const todayLeavingRows = mapRows(leavingBookings);
  const nextArrivalsRows = mapRows(nextArrivalsBookings).map((row) => {
    const checkIn = row.checkInDate ? new Date(row.checkInDate) : null;
    const days = checkIn ? Math.floor((checkIn.getTime() - startOfToday.getTime()) / (1000 * 60 * 60 * 24)) : null;
    return { ...row, statusLabel: Number.isFinite(days) ? `Arrives in ${days} day${days === 1 ? '' : 's'}` : 'Upcoming arrival' };
  });

  const alerts = [];
  for (const booking of alertBookings) {
    const reservationId = String(booking._id);
    const paymentStatus = paymentStatusByReservation.get(reservationId) || 'unknown';
    const row = mapReservationRow(booking, paymentStatus);
    const cancelled = booking.status === 'cancelled';
    const detailBase = `${row.guestName} · ${row.accommodationDisplayName} · ${row.datesLabel}`;
    const checkIn = booking.checkIn ? new Date(booking.checkIn) : null;
    const within14d = checkIn && checkIn > endOfToday && checkIn <= endOf14Days;

    if (cancelled && (paymentStatus === 'paid' || paymentStatus === 'partial')) {
      alerts.push({
        id: `refund-follow-up-${reservationId}`,
        type: 'refund_follow_up',
        severity: 'high',
        title: 'Refund follow-up',
        detail: `${detailBase} has cancelled status with paid/partial payment.`,
        href: row.href,
        createdAt: booking.updatedAt || booking.createdAt,
        entityType: 'reservation',
        entityId: reservationId
      });
    }
    if (cancelled && paymentStatus === 'unlinked_payment') {
      alerts.push({
        id: `cancelled-unlinked-${reservationId}`,
        type: 'payment_link_audit',
        severity: 'high',
        title: 'Check payment link',
        detail: `${detailBase} is cancelled with unlinked payment evidence.`,
        href: row.href,
        createdAt: booking.updatedAt || booking.createdAt,
        entityType: 'reservation',
        entityId: reservationId
      });
    }
    if (paymentStatus === 'failed' || paymentStatus === 'disputed') {
      alerts.push({
        id: `payment-failed-${reservationId}`,
        type: 'payment_failed',
        severity: paymentSeverity(paymentStatus),
        title: 'Payment failed',
        detail: `${detailBase} has ${paymentStatus} payment status.`,
        href: row.href,
        createdAt: booking.updatedAt || booking.createdAt,
        entityType: 'reservation',
        entityId: reservationId
      });
    }
    if (paymentStatus === 'pending_verification') {
      alerts.push({
        id: `payment-verify-${reservationId}`,
        type: 'payment_pending_verification',
        severity: 'high',
        title: 'Verify payment',
        detail: `${detailBase} requires payment verification.`,
        href: row.href,
        createdAt: booking.updatedAt || booking.createdAt,
        entityType: 'reservation',
        entityId: reservationId
      });
    }
    if (paymentStatus === 'unlinked_payment' && !cancelled) {
      alerts.push({
        id: `payment-unlinked-${reservationId}`,
        type: 'payment_unlinked',
        severity: 'high',
        title: 'Unlinked payment',
        detail: `${detailBase} has payment evidence without reservation linkage.`,
        href: row.href,
        createdAt: booking.updatedAt || booking.createdAt,
        entityType: 'reservation',
        entityId: reservationId
      });
    }
    if (!cancelled && paymentStatus === 'unpaid' && within14d) {
      alerts.push({
        id: `unpaid-upcoming-${reservationId}`,
        type: 'unpaid_upcoming',
        severity: 'medium',
        title: 'Unpaid upcoming booking',
        detail: `${detailBase} arrives soon and remains unpaid.`,
        href: row.href,
        createdAt: booking.updatedAt || booking.createdAt,
        entityType: 'reservation',
        entityId: reservationId
      });
    }
  }

  for (const evt of failedEmailEvents) {
    alerts.push({
      id: `email-failed-${String(evt._id)}`,
      type: 'guest_email_failed',
      severity: 'high',
      title: 'Guest email failed',
      detail: `${evt.to || 'Unknown recipient'} · ${evt.type || evt.sendStatus || 'email failure'}`,
      href: evt.bookingId ? `/ops/reservations/${String(evt.bookingId)}` : '/ops/communications',
      createdAt: evt.createdAt,
      entityType: 'email',
      entityId: String(evt._id)
    });
  }

  if (syncEventsRecent.length > 0) {
    const rawCount = syncEventsRecent.length;
    const hasFailed = syncEventsRecent.some((evt) => evt.outcome === 'failed');
    const newestEvent = syncEventsRecent[0];
    const uniqueSignatureCount = new Set(
      syncEventsRecent.map((evt) => {
        const cabinId = evt.cabinId ? String(evt.cabinId) : '';
        const channel = evt.channel || '';
        const anomalyType = evt.anomalyType || '';
        const outcome = evt.outcome || '';
        const feedUrl = evt.metadata?.feedUrl || '';
        const unitId = evt.metadata?.unitId || '';
        return `${cabinId}|${channel}|${anomalyType}|${outcome}|${feedUrl}|${unitId}`;
      })
    ).size;
    alerts.push({
      id: 'sync-summary-recent-issues',
      type: 'sync_issue',
      severity: hasFailed ? 'high' : 'medium',
      title: 'Sync needs review',
      detail: rawCount === 1 ? '1 recent sync issue. Review Sync.' : `${rawCount} recent sync issues. Review Sync.`,
      href: '/ops/sync',
      createdAt: newestEvent?.runAt || newestEvent?.createdAt || new Date().toISOString(),
      entityType: 'sync_event',
      entityId: newestEvent?._id ? String(newestEvent._id) : null,
      metadata: {
        rawCount,
        uniqueSignatureCount
      }
    });
  }

  for (const item of manualReviewOpenItems) {
    alerts.push({
      id: `manual-review-${String(item._id)}`,
      type: 'manual_review',
      severity: item.severity || 'medium',
      title: item.title || 'Manual review item',
      detail: item.category ? `Category: ${item.category}` : 'Manual review item requires operator attention.',
      href: '/ops/manual-review',
      createdAt: item.createdAt,
      entityType: 'manual_review',
      entityId: String(item._id)
    });
  }

  const criticalAlerts = hydrateAlerts(alerts);

  const pulseAgg = pulseMonthAgg[0] || { bookingsMTD: 0, bookingValueMTD: 0 };
  const paidActiveCount = pulseActiveBookings.filter((b) => paymentStatusByReservation.get(String(b._id)) === 'paid').length;
  const activeUnpaidCount = Math.max(0, pulseActiveBookings.length - paidActiveCount);

  const latestSyncEvent = await ChannelSyncEvent.findOne({}).sort({ runAt: -1 }).lean();
  const latestSyncOutcome = latestSyncEvent?.outcome || null;
  const webhookSeen = Boolean(stripeLastWebhook?.createdAtProvider);
  const healthStatus =
    !webhookSeen || criticalAlerts.some((a) => a.severity === 'critical') || latestSyncOutcome === 'failed'
      ? 'degraded'
      : criticalAlerts.length > 0 || latestSyncOutcome === 'warning'
        ? 'warning'
        : 'healthy';

  const dashboard = {
    alerts: criticalAlerts,
    today: {
      arriving: { total: todayArrivingRows.length, rows: todayArrivingRows.slice(0, 5) },
      staying: { total: todayStayingRows.length, rows: todayStayingRows.slice(0, 5) },
      leaving: { total: todayLeavingRows.length, rows: todayLeavingRows.slice(0, 5) }
    },
    upcoming: {
      horizonDays: 14,
      next14DaysArrivalCount: next14Count,
      nextArrivals: nextArrivalsRows
    },
    pulse: {
      month: `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`,
      bookingsMTD: pulseAgg.bookingsMTD || 0,
      bookingValueMTD: pulseAgg.bookingValueMTD || 0,
      activePaidCount: paidActiveCount,
      activeUnpaidCount,
      cancellationsMTD,
      refundsMTD
    },
    health: {
      status: healthStatus,
      sync: {
        lastEventAt: latestSyncEvent?.runAt || null,
        lastOutcome: latestSyncOutcome,
        recentIssuesCount: syncWarningsRecent,
        href: '/ops/sync'
      },
      email: {
        recentFailuresCount: failedEmailCountRecent,
        href: '/ops/communications'
      },
      payments: {
        webhookLastSeenAt: stripeLastWebhook?.createdAtProvider || null,
        webhookLastEventType: stripeLastWebhook?.eventType || null,
        href: '/ops/payments'
      },
      manualReview: {
        openCount: manualReviewOpenCount,
        href: '/ops/manual-review'
      }
    }
  };

  return {
    generatedAt: new Date().toISOString(),
    freshness: {
      isStale: false,
      degraded: healthStatus !== 'healthy',
      reason: !webhookSeen ? 'webhook_not_seen_yet' : healthStatus === 'healthy' ? null : 'alerts_or_health_signals'
    },
    dashboard,
    // legacy compatibility fields
    aggregates: {
      arrivalsToday: dashboard.today.arriving.total,
      departuresToday: dashboard.today.leaving.total,
      inHouse: dashboard.today.staying.total,
      actionNeeded: dashboard.alerts.length,
      upcoming7Days: upcoming7Count,
      cancelledRefundPending: dashboard.alerts.filter((a) => a.type === 'refund_follow_up').length,
      pendingActions: manualReviewOpenCount,
      failedPayments: dashboard.alerts.filter((a) => a.type === 'payment_failed').length,
      failedEmails: failedEmailCountRecent,
      upcomingPayouts,
      syncWarnings: syncWarningsRecent
    },
    sections: {
      actionNeeded: dashboard.alerts,
      arrivalsToday: dashboard.today.arriving.rows,
      inHouse: dashboard.today.staying.rows,
      checkingOutToday: dashboard.today.leaving.rows,
      upcoming7Days: dashboard.upcoming.nextArrivals
    },
    occupancySnapshot: {
      source: 'derived',
      value: { inHouse: dashboard.today.staying.total }
    },
    quickActionTargets: {
      reservationsPath: '/api/ops/reservations',
      calendarPath: '/api/ops/calendar',
      cabinsPath: '/api/ops/cabins'
    },
    sync: {
      lastSyncAt: latestSyncEvent?.runAt || null,
      lastSyncOutcome: latestSyncOutcome
    },
    provenance: {
      dashboardV1: 'structured_read_model',
      primarySectionCounts: 'derived_from_structured_sections'
    }
  };
}

module.exports = {
  getDashboardReadModel
};
