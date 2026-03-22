const Booking = require('../../../models/Booking');
const Payment = require('../../../models/Payment');
const AvailabilityBlock = require('../../../models/AvailabilityBlock');
const { mapBookingToReservationCompatible } = require('../../../mappers/bookingToReservationMapper');
const { escapeRegex } = require('../../../utils/escapeRegex');

function buildBookingFilters(query) {
  const filters = {};
  if (query.status) filters.status = query.status;
  if (query.cabinId) filters.cabinId = query.cabinId;
  if (query.dateFrom || query.dateTo) {
    filters.checkIn = {};
    if (query.dateFrom) filters.checkIn.$gte = new Date(query.dateFrom);
    if (query.dateTo) filters.checkIn.$lte = new Date(query.dateTo);
  }
  if (query.search) {
    const q = escapeRegex(String(query.search));
    filters.$or = [
      { 'guestInfo.firstName': { $regex: q, $options: 'i' } },
      { 'guestInfo.lastName': { $regex: q, $options: 'i' } },
      { 'guestInfo.email': { $regex: q, $options: 'i' } }
    ];
  }
  return filters;
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

function deriveArrivalStatus(booking) {
  if (booking.status === 'confirmed') return 'sent';
  if (booking.status === 'cancelled') return 'not_sent';
  return null;
}

async function getReservationsWorkspaceReadModel(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const filters = buildBookingFilters(query);
  const skip = (page - 1) * limit;

  const [bookings, total] = await Promise.all([
    Booking.find(filters).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Booking.countDocuments(filters)
  ]);

  const reservationIds = bookings.map((b) => String(b._id));
  const [payments, conflicts] = await Promise.all([
    Payment.find({ reservationId: { $in: reservationIds } }).lean(),
    AvailabilityBlock.find({
      reservationId: { $in: reservationIds },
      status: 'active'
    }).lean()
  ]);

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

  const items = bookings.map((booking) => {
    const mapped = mapBookingToReservationCompatible(booking);
    const paymentTrail = paymentsByReservation.get(String(booking._id)) || [];
    const paymentStatus = derivePaymentStatus(paymentTrail);
    return {
      reservationId: mapped.reservationId,
      guestSummary: mapped.guest,
      dateRange: {
        startDate: mapped.checkInDate,
        endDate: mapped.checkOutDate
      },
      cabinSummary: {
        cabinId: mapped.cabinId,
        name: null,
        location: null
      },
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
      degraded: {
        paymentLinkageIncomplete: paymentStatus === null
      }
    };
  });

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
      conflict: 'derived_from_availability_blocks'
    }
  };
}

module.exports = {
  getReservationsWorkspaceReadModel
};
