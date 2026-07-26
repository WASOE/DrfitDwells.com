'use strict';

const Booking = require('../../../models/Booking');
const { formatSofiaDateOnly } = require('../../../utils/dateTime');
const { baseBookingFilter } = require('./reportingFilters');
const {
  bookingRevenueCents,
  bookingCashCollectedCents,
  resolveChannel
} = require('./normalizedStayRow');
const {
  resolveSummaryContext,
  baseLocationBookingRevenueFilter,
  locationBookingRevenueCents,
  locationBookingCashCollectedCents,
  locationBookingChannel
} = require('./revenueMetricsService');
const { parseStatusFilter, parsePagination } = require('./entityFilterValidation');

const LOCATION_BOOKINGS_COLLECTION = 'locationbookings';

function idString(value) {
  return value ? String(value) : null;
}

function bookingChannelMatch(channelFilter) {
  if (!channelFilter) return null;
  if (channelFilter === 'website') {
    return { 'provenance.source': 'guest_portal' };
  }
  if (channelFilter === 'staff') {
    return { 'provenance.source': { $in: ['admin_manual', 'operator_manual'] } };
  }
  return {
    $nor: [
      { 'provenance.source': 'guest_portal' },
      { 'provenance.source': { $in: ['admin_manual', 'operator_manual'] } }
    ]
  };
}

function locationChannelMatch(channelFilter) {
  if (!channelFilter) return null;
  if (channelFilter === 'website') {
    return { source: 'website' };
  }
  if (channelFilter === 'staff') {
    // LocationBooking has no staff channel today.
    return { source: '__never__' };
  }
  return { source: { $ne: 'website' } };
}

function statusMatch(statusFilter) {
  if (statusFilter === 'cancelled') return { status: 'cancelled' };
  if (statusFilter === 'active') return { status: { $ne: 'cancelled' } };
  return null;
}

function sortDateField(basis) {
  return basis === 'booked' ? 'createdAt' : 'checkIn';
}

function projectBookingRow(basis) {
  const sortField = sortDateField(basis);
  return {
    stayKind: { $literal: 'booking' },
    bookingId: { $toString: '$_id' },
    detailHref: { $concat: ['/ops/reservations/', { $toString: '$_id' }] },
    status: 1,
    channel: {
      $switch: {
        branches: [
          { case: { $eq: ['$provenance.source', 'guest_portal'] }, then: 'website' },
          {
            case: {
              $in: ['$provenance.source', ['admin_manual', 'operator_manual']]
            },
            then: 'staff'
          }
        ],
        default: 'other'
      }
    },
    checkInDateOnly: {
      $dateToString: { format: '%Y-%m-%d', date: '$checkIn', timezone: 'Europe/Sofia' }
    },
    checkOutDateOnly: {
      $dateToString: { format: '%Y-%m-%d', date: '$checkOut', timezone: 'Europe/Sofia' }
    },
    bookedAt: '$createdAt',
    bookedRevenueCents: {
      $cond: [
        { $and: [{ $ne: ['$totalValueCents', null] }, { $isNumber: '$totalValueCents' }] },
        { $max: [0, { $round: ['$totalValueCents', 0] }] },
        {
          $max: [0, { $round: [{ $multiply: [{ $ifNull: ['$totalPrice', 0] }, 100] }, 0] }]
        }
      ]
    },
    paymentSnapshotAtBookingCents: {
      $max: [0, { $round: [{ $ifNull: ['$stripePaidAmountCents', 0] }, 0] }]
    },
    cabinId: {
      $cond: [{ $ifNull: ['$cabinId', false] }, { $toString: '$cabinId' }, null]
    },
    cabinTypeId: {
      $cond: [{ $ifNull: ['$cabinTypeId', false] }, { $toString: '$cabinTypeId' }, null]
    },
    unitId: {
      $cond: [{ $ifNull: ['$unitId', false] }, { $toString: '$unitId' }, null]
    },
    provenanceSource: { $ifNull: ['$provenance.source', null] },
    sortDate: `$${sortField}`,
    sortStayKind: { $literal: 0 },
    sortId: '$_id'
  };
}

function projectLocationRow(basis) {
  const sortField = sortDateField(basis);
  return {
    stayKind: { $literal: 'location_booking' },
    bookingId: { $toString: '$_id' },
    detailHref: { $literal: null },
    status: 1,
    channel: {
      $cond: [{ $eq: ['$source', 'website'] }, 'website', 'other']
    },
    checkInDateOnly: {
      $dateToString: { format: '%Y-%m-%d', date: '$checkIn', timezone: 'Europe/Sofia' }
    },
    checkOutDateOnly: {
      $dateToString: { format: '%Y-%m-%d', date: '$checkOut', timezone: 'Europe/Sofia' }
    },
    bookedAt: '$createdAt',
    bookedRevenueCents: {
      $max: [0, { $round: [{ $multiply: [{ $ifNull: ['$totalPrice', 0] }, 100] }, 0] }]
    },
    paymentSnapshotAtBookingCents: {
      $cond: [
        {
          $and: [
            { $ne: ['$status', 'cancelled'] },
            { $gt: [{ $strLenCP: { $ifNull: ['$stripePaymentIntentId', ''] } }, 0] }
          ]
        },
        { $max: [0, { $round: [{ $multiply: [{ $ifNull: ['$totalPrice', 0] }, 100] }, 0] }] },
        0
      ]
    },
    cabinId: { $literal: null },
    cabinTypeId: { $literal: null },
    unitId: { $literal: null },
    provenanceSource: { $ifNull: ['$source', null] },
    sortDate: `$${sortField}`,
    sortStayKind: { $literal: 1 },
    sortId: '$_id'
  };
}

function buildBookingMatch(ctx, statusFilter) {
  const match = {
    ...baseBookingFilter(),
    excludeFromRevenueReporting: { $ne: true },
    ...ctx.dateFilterResult.filter,
    ...ctx.bookingEntityMatch
  };
  const channelMatch = bookingChannelMatch(ctx.channelFilter);
  if (channelMatch) Object.assign(match, channelMatch);
  const status = statusMatch(statusFilter);
  if (status) Object.assign(match, status);
  return match;
}

function buildLocationMatch(ctx, statusFilter) {
  const match = {
    ...baseLocationBookingRevenueFilter(),
    ...ctx.dateFilterResult.filter,
    locationKey: 'valley'
  };
  const channelMatch = locationChannelMatch(ctx.channelFilter);
  if (channelMatch) Object.assign(match, channelMatch);
  const status = statusMatch(statusFilter);
  if (status) Object.assign(match, status);
  return match;
}

async function aggregateInsightsBookings({
  propertyKind,
  from,
  to,
  revenueBasis = 'checkIn',
  cabinId = null,
  cabinTypeId = null,
  unitId = null,
  channel = null,
  status = 'active',
  page = 1,
  limit = 50
}) {
  const statusFilter = parseStatusFilter(status);
  const pagination = parsePagination({ page, limit });
  const ctx = await resolveSummaryContext({
    propertyKind,
    from,
    to,
    revenueBasis,
    cabinId,
    cabinTypeId,
    unitId,
    channel
  });

  const bookingMatch = buildBookingMatch(ctx, statusFilter);
  const skip = (pagination.page - 1) * pagination.limit;
  const basis = ctx.basis;

  let total;
  let rows;

  if (ctx.includeLocationBookings) {
    const locationMatch = buildLocationMatch(ctx, statusFilter);
    const pipeline = [
      { $match: bookingMatch },
      { $project: projectBookingRow(basis) },
      {
        $unionWith: {
          coll: LOCATION_BOOKINGS_COLLECTION,
          pipeline: [{ $match: locationMatch }, { $project: projectLocationRow(basis) }]
        }
      },
      {
        $facet: {
          total: [{ $count: 'count' }],
          rows: [
            { $sort: { sortDate: -1, sortStayKind: 1, sortId: -1 } },
            { $skip: skip },
            { $limit: pagination.limit },
            {
              $project: {
                _id: 0,
                stayKind: 1,
                bookingId: 1,
                detailHref: 1,
                status: 1,
                channel: 1,
                checkInDateOnly: 1,
                checkOutDateOnly: 1,
                bookedAt: 1,
                bookedRevenueCents: 1,
                paymentSnapshotAtBookingCents: 1,
                cabinId: 1,
                cabinTypeId: 1,
                unitId: 1,
                provenanceSource: 1
              }
            }
          ]
        }
      }
    ];

    const [facet] = await Booking.aggregate(pipeline).allowDiskUse(true);
    total = facet?.total?.[0]?.count || 0;
    rows = facet?.rows || [];
  } else {
    const [count, docs] = await Promise.all([
      Booking.countDocuments(bookingMatch),
      Booking.find(bookingMatch)
        .sort({ [sortDateField(basis)]: -1, _id: -1 })
        .skip(skip)
        .limit(pagination.limit)
        .select(
          '_id status checkIn checkOut createdAt totalPrice totalValueCents stripePaidAmountCents provenance cabinId cabinTypeId unitId'
        )
        .lean()
    ]);
    total = count;
    rows = docs.map((booking) => ({
      stayKind: 'booking',
      bookingId: String(booking._id),
      detailHref: `/ops/reservations/${booking._id}`,
      status: booking.status,
      channel: resolveChannel(booking),
      checkInDateOnly: booking.checkIn ? formatSofiaDateOnly(booking.checkIn) : null,
      checkOutDateOnly: booking.checkOut ? formatSofiaDateOnly(booking.checkOut) : null,
      bookedAt: booking.createdAt || null,
      bookedRevenueCents: bookingRevenueCents(booking),
      paymentSnapshotAtBookingCents: bookingCashCollectedCents(booking),
      cabinId: idString(booking.cabinId),
      cabinTypeId: idString(booking.cabinTypeId),
      unitId: idString(booking.unitId),
      provenanceSource: booking?.provenance?.source || null
    }));
  }

  const entityFiltersActive = Boolean(
    ctx.entity.cabinId || ctx.entity.cabinTypeId || ctx.entity.unitId
  );

  return {
    propertyKind: ctx.propertyKind,
    period: { from: String(from).trim().slice(0, 10), to: String(to).trim().slice(0, 10) },
    revenueBasis: basis,
    filters: {
      cabinId: ctx.entity.cabinId ? String(ctx.entity.cabinId) : null,
      cabinTypeId: ctx.entity.cabinTypeId ? String(ctx.entity.cabinTypeId) : null,
      unitId: ctx.entity.unitId ? String(ctx.entity.unitId) : null,
      channel: ctx.channelFilter,
      status: statusFilter
    },
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      hasMore: skip + rows.length < total
    },
    rows,
    provenance: {
      revenueSource: 'Booking.totalValueCents|totalPrice; LocationBooking.totalPrice for valley masters',
      paymentSnapshotSource:
        'Booking.stripePaidAmountCents finalize snapshot; LocationBooking uses totalPrice when stripePaymentIntentId present',
      locationBookingIncluded: ctx.includeLocationBookings,
      locationBookingLimitations: ctx.includeLocationBookings
        ? 'Valley buyout masters included once. Child bookings with excludeFromRevenueReporting are omitted.'
        : entityFiltersActive
          ? 'LocationBooking rows omitted because entity filters cannot apply to location masters.'
          : 'LocationBooking rows only apply to propertyKind=valley.',
      computedAt: new Date().toISOString()
    }
  };
}

module.exports = {
  aggregateInsightsBookings
};
