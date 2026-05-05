const Booking = require('../../../models/Booking');
const Payment = require('../../../models/Payment');
const AvailabilityBlock = require('../../../models/AvailabilityBlock');
const { mapBookingToReservationCompatible } = require('../../../mappers/bookingToReservationMapper');
const { formatSofiaDateOnly } = require('../../../utils/dateTime');
const { escapeRegex } = require('../../../utils/escapeRegex');

const STAY_SCOPE_VALUES = ['active', 'past'];
const OPS_BUCKET_VALUES = [
  'upcoming',
  'arriving_today',
  'in_house',
  'checking_out_today',
  'past',
  'cancelled',
  'payment_attention'
];
const EXPORT_LIMIT = 5000;

function validateStayScope(value) {
  if (value === undefined || value === null || value === '') return null;
  if (STAY_SCOPE_VALUES.includes(value)) return null;
  return `stayScope must be one of: ${STAY_SCOPE_VALUES.join(', ')}`;
}

function validateOpsBucket(value) {
  if (value === undefined || value === null || value === '') return null;
  if (OPS_BUCKET_VALUES.includes(value)) return null;
  return `opsBucket must be one of: ${OPS_BUCKET_VALUES.join(', ')}`;
}

function buildBookingFilters(query) {
  const includeArchived = query.includeArchived === '1' || query.includeArchived === 'true';
  const and = [{ isTest: { $ne: true } }];
  if (!includeArchived) {
    and.push({ $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }] });
  }
  if (query.status) and.push({ status: query.status });
  if (query.cabinId) and.push({ cabinId: query.cabinId });
  if (query.dateFrom || query.dateTo) {
    const checkIn = {};
    if (query.dateFrom) checkIn.$gte = new Date(query.dateFrom);
    if (query.dateTo) checkIn.$lte = new Date(query.dateTo);
    and.push({ checkIn });
  }
  if (query.stayScope === 'active' || query.stayScope === 'past') {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (query.stayScope === 'past') {
      and.push({ checkOut: { $lt: startOfToday } });
    } else {
      and.push({ checkOut: { $gte: startOfToday } });
    }
  }
  if (query.search) {
    const q = escapeRegex(String(query.search));
    and.push({
      $or: [
        { 'guestInfo.firstName': { $regex: q, $options: 'i' } },
        { 'guestInfo.lastName': { $regex: q, $options: 'i' } },
        { 'guestInfo.email': { $regex: q, $options: 'i' } }
      ]
    });
  }
  if (and.length === 1) return and[0];
  return { $and: and };
}

function getStartOfToday(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function getEndOfToday(startOfToday) {
  const end = new Date(startOfToday);
  end.setHours(23, 59, 59, 999);
  return end;
}

function getEndOfTomorrow(startOfToday) {
  const end = new Date(startOfToday);
  end.setDate(end.getDate() + 1);
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

function resolveCabinSummary(booking, mapped) {
  const cabinName = booking?.cabinId?.name || booking?.cabinTypeId?.name || null;
  const unitLabel = resolveUnitLabel(booking);
  return {
    cabinId: mapped.cabinId,
    cabinTypeId: booking?.cabinTypeId?._id ? String(booking.cabinTypeId._id) : booking?.cabinTypeId ? String(booking.cabinTypeId) : null,
    unitId: booking?.unitId?._id ? String(booking.unitId._id) : booking?.unitId ? String(booking.unitId) : null,
    name: cabinName,
    unitLabel,
    displayName: cabinName ? (unitLabel ? `${cabinName} · ${unitLabel}` : cabinName) : null,
    location: booking?.cabinId?.location || booking?.cabinTypeId?.location || null
  };
}

function deriveStayTiming(booking, startOfToday) {
  const endOfToday = getEndOfToday(startOfToday);
  const endOfTomorrow = getEndOfTomorrow(startOfToday);
  const checkIn = booking?.checkIn ? new Date(booking.checkIn) : null;
  const checkOut = booking?.checkOut ? new Date(booking.checkOut) : null;
  const isCancelled = booking?.status === 'cancelled';

  const arrivingToday = !isCancelled && !!checkIn && checkIn >= startOfToday && checkIn <= endOfToday;
  const checkingOutToday = !isCancelled && !!checkOut && checkOut >= startOfToday && checkOut <= endOfToday;
  const currentlyStaying = !isCancelled && !!checkIn && !!checkOut && checkIn < startOfToday && checkOut > endOfToday;
  const upcoming = !isCancelled && !!checkIn && checkIn > endOfToday;
  const arrivingTomorrow = upcoming && checkIn <= endOfTomorrow;
  const checkedOut = !isCancelled && !!checkOut && checkOut < startOfToday;
  const daysUntilCheckIn = !checkIn
    ? null
    : Math.floor((getStartOfToday(checkIn).getTime() - startOfToday.getTime()) / (1000 * 60 * 60 * 24));

  return {
    checkIn,
    checkOut,
    arrivingToday,
    arrivingTomorrow,
    checkingOutToday,
    currentlyStaying,
    checkedOut,
    upcoming,
    isCancelled,
    daysUntilCheckIn
  };
}

function derivePaymentAttention({ reservationStatus, paymentStatus }) {
  const baseAttentionStatuses = new Set([
    'unpaid',
    'failed',
    'disputed',
    'pending_verification',
    'unlinked_payment'
  ]);
  const cancelled = reservationStatus === 'cancelled';
  const cancelledPaid = cancelled && (paymentStatus === 'paid' || paymentStatus === 'partial');
  const refundPending = cancelled && (paymentStatus === 'paid' || paymentStatus === 'partial' || paymentStatus === 'pending_verification');
  const paymentAttention = baseAttentionStatuses.has(paymentStatus) || cancelledPaid || refundPending;
  return { cancelledPaid, refundPending, paymentAttention };
}

function deriveOpsBucket({ reservationStatus, stayTiming, paymentAttention }) {
  if (paymentAttention) return 'payment_attention';
  if (stayTiming.arrivingToday) return 'arriving_today';
  if (stayTiming.checkingOutToday) return 'checking_out_today';
  if (stayTiming.currentlyStaying) return 'in_house';
  if (stayTiming.upcoming) return 'upcoming';
  if (reservationStatus === 'cancelled') return 'cancelled';
  return 'past';
}

function matchesOpsBucket(opsBucketFilter, row) {
  if (!opsBucketFilter) return true;
  const timing = row?.operational?.stayTiming || {};
  const paymentAttention = !!row?.operational?.paymentAttention;
  const cancelled = row?.reservationStatus === 'cancelled';
  if (opsBucketFilter === 'payment_attention') return paymentAttention;
  if (opsBucketFilter === 'cancelled') return cancelled;
  if (opsBucketFilter === 'arriving_today') return !!timing.arrivingToday;
  if (opsBucketFilter === 'checking_out_today') return !!timing.checkingOutToday;
  if (opsBucketFilter === 'in_house') return !!timing.currentlyStaying;
  if (opsBucketFilter === 'upcoming') return !!timing.upcoming;
  if (opsBucketFilter === 'past') return !!timing.checkedOut;
  return false;
}

function sortPriority(row) {
  const status = row.operational?.opsBucket;
  const map = {
    payment_attention: 0,
    arriving_today: 1,
    checking_out_today: 2,
    in_house: 3,
    upcoming: 4,
    past: 5,
    cancelled: 6
  };
  return map[status] ?? 7;
}

function sortReservations(rows) {
  return rows.sort((a, b) => {
    const priorityDelta = sortPriority(a) - sortPriority(b);
    if (priorityDelta !== 0) return priorityDelta;

    const aUpcoming = a.operational?.stayTiming?.upcoming ? 1 : 0;
    const bUpcoming = b.operational?.stayTiming?.upcoming ? 1 : 0;
    if (aUpcoming !== bUpcoming) return bUpcoming - aUpcoming;

    const aCheckIn = a.dateRange?.startDate ? new Date(a.dateRange.startDate).getTime() : Number.POSITIVE_INFINITY;
    const bCheckIn = b.dateRange?.startDate ? new Date(b.dateRange.startDate).getTime() : Number.POSITIVE_INFINITY;
    if (aCheckIn !== bCheckIn) return aCheckIn - bCheckIn;

    const aCreatedAt = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bCreatedAt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (aCreatedAt !== bCreatedAt) return bCreatedAt - aCreatedAt;

    return String(b.reservationId || '').localeCompare(String(a.reservationId || ''));
  });
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

  if (hasStripePaymentIntent && hasUnlinkedStripePayment) {
    return 'unlinked_payment';
  }
  if (hasStripePaymentIntent && !hasUnlinkedStripePayment) {
    return 'pending_verification';
  }
  if (isManualReservation) {
    return 'manual_not_required';
  }
  if (booking?.totalPrice > 0) {
    return 'unpaid';
  }
  return 'unknown';
}

function deriveArrivalStatus(booking) {
  if (booking.status === 'confirmed') return 'sent';
  if (booking.status === 'cancelled') return 'not_sent';
  return null;
}

async function getReservationsWorkspaceReadModel(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const filters = buildBookingFilters(query);
  const startOfToday = getStartOfToday();

  const bookings = await Booking.find(filters)
    .populate('cabinId', 'name location')
    .populate('cabinTypeId', 'name location')
    .populate('unitId', 'displayName unitNumber')
    .sort({ createdAt: -1 })
    .lean();

  const reservationIds = bookings.map((b) => String(b._id));
  const stripePaymentIntentIds = bookings
    .map((b) => (typeof b.stripePaymentIntentId === 'string' ? b.stripePaymentIntentId.trim() : ''))
    .filter(Boolean);
  const [payments, conflicts] = await Promise.all([
    Payment.find({ reservationId: { $in: reservationIds } }).lean(),
    AvailabilityBlock.find({
      reservationId: { $in: reservationIds },
      status: 'active'
    }).lean()
  ]);
  const unlinkedPayments = stripePaymentIntentIds.length
    ? await Payment.find({
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
    : [];

  const paymentsByReservation = new Map();
  for (const payment of payments) {
    const key = payment.reservationId ? String(payment.reservationId) : null;
    if (!key) continue;
    if (!paymentsByReservation.has(key)) paymentsByReservation.set(key, []);
    paymentsByReservation.get(key).push(payment);
  }

  const conflictByReservation = new Map();
  for (const conflict of conflicts) {
    const key = conflict.reservationId ? String(conflict.reservationId) : null;
    if (!key) continue;
    conflictByReservation.set(key, true);
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
    for (const key of candidateKeys) {
      unlinkedPaymentByPaymentIntent.add(key);
    }
  }

  const rows = bookings.map((booking) => {
    const mapped = mapBookingToReservationCompatible(booking);
    const paymentTrail = paymentsByReservation.get(String(booking._id)) || [];
    const pi = typeof booking.stripePaymentIntentId === 'string' ? booking.stripePaymentIntentId.trim() : '';
    const paymentStatus = classifyReservationPaymentStatus({
      booking,
      linkedPaymentTrail: paymentTrail,
      hasUnlinkedStripePayment: pi ? unlinkedPaymentByPaymentIntent.has(pi) : false
    });
    const reservationStatus = mapped.reservationStatus;
    const stayTiming = deriveStayTiming(booking, startOfToday);
    const paymentSignals = derivePaymentAttention({ reservationStatus, paymentStatus });
    const opsBucket = deriveOpsBucket({
      reservationStatus,
      stayTiming,
      paymentAttention: paymentSignals.paymentAttention
    });
    return {
      reservationId: mapped.reservationId,
      reservationStatus,
      createdAt: booking.createdAt || null,
      guestSummary: mapped.guest,
      dateRange: {
        startDate: mapped.checkInDate,
        endDate: mapped.checkOutDate,
        startDateOnly: mapped.checkInDateOnly,
        endDateOnly: mapped.checkOutDateOnly
      },
      cabinSummary: resolveCabinSummary(booking, mapped),
      adults: booking.adults ?? null,
      children: booking.children ?? null,
      source: mapped.source,
      sourceReference: mapped.sourceReference,
      amount: mapped.amount,
      currency: mapped.currency,
      paymentStatus,
      arrivalStatus: deriveArrivalStatus(booking),
      conflict: {
        hasConflict: conflictByReservation.get(String(booking._id)) || false,
        severity: conflictByReservation.get(String(booking._id)) ? 'hard' : null
      },
      operational: {
        opsBucket,
        stayTiming,
        paymentAttention: paymentSignals.paymentAttention,
        cancelledPaid: paymentSignals.cancelledPaid,
        refundPending: paymentSignals.refundPending
      },
      degraded: {
        paymentLinkageIncomplete: paymentStatus === 'pending_verification' || paymentStatus === 'unlinked_payment'
      }
    };
  });

  const opsBucketFilter = query.opsBucket || '';
  const effectiveOpsBucket = opsBucketFilter || (query.stayScope === 'active' ? 'upcoming' : query.stayScope === 'past' ? 'past' : '');
  const filteredRows = rows.filter((row) => {
    if (query.paymentStatus && row.paymentStatus !== query.paymentStatus) return false;
    if (!matchesOpsBucket(effectiveOpsBucket, row)) return false;
    return true;
  });
  const sortedRows = sortReservations(filteredRows);
  const total = sortedRows.length;
  const skip = (page - 1) * limit;
  const items = sortedRows.slice(skip, skip + limit);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    },
    derived: {
      paymentStatus: 'derived_from_payment_source_truth',
      conflict: 'derived_from_availability_blocks',
      opsBucket: 'derived_from_booking_dates_status_and_payment_signals'
    }
  };
}

async function getReservationsExportRows(query = {}) {
  const filters = buildBookingFilters(query);

  const total = await Booking.countDocuments(filters);
  if (total > EXPORT_LIMIT) {
    const error = new Error(
      `Export size ${total} exceeds limit of ${EXPORT_LIMIT}. Refine filters and try again.`
    );
    error.type = 'export_too_large';
    error.status = 413;
    error.details = { limit: EXPORT_LIMIT, total };
    throw error;
  }

  const bookings = await Booking.find(filters)
    .populate('cabinId', 'name location')
    .populate('cabinTypeId', 'name location')
    .populate('unitId', 'displayName unitNumber')
    .sort({ createdAt: -1 })
    .lean();

  return bookings.map((booking) => ({
    _id: booking._id,
    createdAt: booking.createdAt,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    checkInDateOnly: booking.checkIn ? formatSofiaDateOnly(booking.checkIn) : null,
    checkOutDateOnly: booking.checkOut ? formatSofiaDateOnly(booking.checkOut) : null,
    cabinName: booking.cabinId?.name || booking.cabinTypeId?.name || null,
    cabinLocation: booking.cabinId?.location || booking.cabinTypeId?.location || null,
    unitLabel: resolveUnitLabel(booking),
    guestInfo: {
      firstName: booking.guestInfo?.firstName || '',
      lastName: booking.guestInfo?.lastName || '',
      email: booking.guestInfo?.email || ''
    },
    adults: booking.adults,
    children: booking.children,
    tripType: booking.tripType || '',
    transportMethod: booking.transportMethod || null,
    totalPrice: booking.totalPrice,
    status: booking.status
  }));
}

module.exports = {
  getReservationsWorkspaceReadModel,
  getReservationsExportRows,
  validateStayScope,
  validateOpsBucket,
  EXPORT_LIMIT,
  STAY_SCOPE_VALUES,
  OPS_BUCKET_VALUES
};
