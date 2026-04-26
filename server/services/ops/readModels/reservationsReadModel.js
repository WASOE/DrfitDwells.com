const Booking = require('../../../models/Booking');
const Payment = require('../../../models/Payment');
const AvailabilityBlock = require('../../../models/AvailabilityBlock');
const { mapBookingToReservationCompatible } = require('../../../mappers/bookingToReservationMapper');
const { escapeRegex } = require('../../../utils/escapeRegex');

const STAY_SCOPE_VALUES = ['active', 'past'];
const EXPORT_LIMIT = 5000;

function validateStayScope(value) {
  if (value === undefined || value === null || value === '') return null;
  if (STAY_SCOPE_VALUES.includes(value)) return null;
  return `stayScope must be one of: ${STAY_SCOPE_VALUES.join(', ')}`;
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
    .sort({ createdAt: -1 })
    .lean();

  return bookings.map((booking) => ({
    _id: booking._id,
    createdAt: booking.createdAt,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    cabinName: booking.cabinId?.name || null,
    cabinLocation: booking.cabinId?.location || null,
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
  EXPORT_LIMIT,
  STAY_SCOPE_VALUES
};
