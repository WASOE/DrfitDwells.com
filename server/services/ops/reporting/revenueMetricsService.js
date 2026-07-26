'use strict';

const Booking = require('../../../models/Booking');
const LocationBooking = require('../../../models/LocationBooking');
const { baseBookingFilter, buildRevenueBasisDateFilter } = require('./reportingFilters');
const { isAllowedPropertyKind } = require('./propertyKindJoin');
const { normalizeStayRow, resolveChannel } = require('./normalizedStayRow');
const { FIXTURE_BOOKING_EMAIL_PATTERN } = require('../../../utils/fixtureExclusion');
const {
  validateInsightsEntityFilters,
  buildBookingEntityMatch,
  shouldIncludeLocationBookings,
  parseChannelFilter
} = require('./entityFilterValidation');

function emptyChannelBucket() {
  return { count: 0, revenueCents: 0 };
}

function baseLocationBookingRevenueFilter() {
  return {
    'guestInfo.email': { $not: FIXTURE_BOOKING_EMAIL_PATTERN }
  };
}

function locationBookingRevenueCents(locationBooking) {
  const totalPrice = Number(locationBooking?.totalPrice);
  if (!Number.isFinite(totalPrice)) return 0;
  return Math.max(0, Math.round(totalPrice * 100));
}

function locationBookingCashCollectedCents(locationBooking) {
  if (!locationBooking?.stripePaymentIntentId || locationBooking.status === 'cancelled') {
    return 0;
  }
  return locationBookingRevenueCents(locationBooking);
}

function locationBookingChannel(locationBooking) {
  const source = String(locationBooking?.source || '').trim();
  if (source === 'website') return 'website';
  return 'other';
}

function locationBookingPropertyKind(locationBooking) {
  return locationBooking?.locationKey === 'valley' ? 'valley' : null;
}

function buildEmptySummary({ propertyKind, from, to, revenueBasis }) {
  return {
    propertyKind,
    period: { from, to },
    revenueBasis,
    metrics: {
      bookingCount: 0,
      cancelledCount: 0,
      grossBookedRevenueCents: 0,
      cancelledRevenueCents: 0,
      avgBookingValueCents: null,
      cashCollectedCents: 0
    },
    channelBreakdown: {
      website: emptyChannelBucket(),
      staff: emptyChannelBucket(),
      other: emptyChannelBucket()
    }
  };
}

function statusIsCancelled(status) {
  return String(status || '') === 'cancelled';
}

function channelMatches(rowChannel, channelFilter) {
  if (!channelFilter) return true;
  return rowChannel === channelFilter;
}

async function resolveSummaryContext({
  propertyKind,
  from,
  to,
  revenueBasis = 'checkIn',
  cabinId = null,
  cabinTypeId = null,
  unitId = null,
  channel = null
}) {
  if (!isAllowedPropertyKind(propertyKind)) {
    const error = new Error('propertyKind must be cabin or valley');
    error.statusCode = 400;
    throw error;
  }

  const basis = revenueBasis === 'booked' ? 'booked' : 'checkIn';
  const dateFilterResult = buildRevenueBasisDateFilter(basis, from, to);
  if (!dateFilterResult) {
    const error = new Error('Invalid from/to date range');
    error.statusCode = 400;
    throw error;
  }

  const channelFilter = parseChannelFilter(channel);
  const entity = await validateInsightsEntityFilters({
    propertyKind,
    cabinId,
    cabinTypeId,
    unitId
  });
  const includeLocationBookings = shouldIncludeLocationBookings(propertyKind, entity);
  const bookingEntityMatch = buildBookingEntityMatch(propertyKind, entity, entity.maps);

  return {
    propertyKind,
    from,
    to,
    basis,
    dateFilterResult,
    channelFilter,
    entity,
    includeLocationBookings,
    bookingEntityMatch
  };
}

async function loadSummaryBookings(ctx) {
  return Booking.find({
    ...baseBookingFilter(),
    excludeFromRevenueReporting: { $ne: true },
    ...ctx.dateFilterResult.filter,
    ...ctx.bookingEntityMatch
  })
    .select(
      '_id status checkIn checkOut totalPrice totalValueCents stripePaidAmountCents provenance cabinId cabinTypeId unitId createdAt excludeFromRevenueReporting'
    )
    .lean();
}

async function loadSummaryLocationBookings(ctx) {
  if (!ctx.includeLocationBookings) return [];
  return LocationBooking.find({
    ...baseLocationBookingRevenueFilter(),
    ...ctx.dateFilterResult.filter,
    locationKey: 'valley'
  })
    .select('_id status checkIn checkOut totalPrice stripePaymentIntentId source locationKey createdAt')
    .lean();
}

async function aggregateRevenueSummary({
  propertyKind,
  from,
  to,
  revenueBasis = 'checkIn',
  cabinId = null,
  cabinTypeId = null,
  unitId = null,
  channel = null
}) {
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

  const [bookings, locationBookings] = await Promise.all([
    loadSummaryBookings(ctx),
    loadSummaryLocationBookings(ctx)
  ]);

  const summary = buildEmptySummary({
    propertyKind: ctx.propertyKind,
    from: ctx.from,
    to: ctx.to,
    revenueBasis: ctx.basis
  });

  for (const booking of bookings) {
    const row = normalizeStayRow(booking, ctx.entity.maps);
    if (row.propertyKind !== ctx.propertyKind) continue;
    if (!channelMatches(row.channel, ctx.channelFilter)) continue;

    if (statusIsCancelled(row.status)) {
      summary.metrics.cancelledCount += 1;
      summary.metrics.cancelledRevenueCents += row.bookedRevenueCents;
      continue;
    }

    summary.metrics.bookingCount += 1;
    summary.metrics.grossBookedRevenueCents += row.bookedRevenueCents;
    summary.metrics.cashCollectedCents += row.cashCollectedCents;

    const bucket = summary.channelBreakdown[row.channel] || summary.channelBreakdown.other;
    bucket.count += 1;
    bucket.revenueCents += row.bookedRevenueCents;
  }

  for (const locationBooking of locationBookings) {
    if (locationBookingPropertyKind(locationBooking) !== ctx.propertyKind) continue;
    const channelValue = locationBookingChannel(locationBooking);
    if (!channelMatches(channelValue, ctx.channelFilter)) continue;

    const bookedRevenueCents = locationBookingRevenueCents(locationBooking);
    const cashCollectedCents = locationBookingCashCollectedCents(locationBooking);

    if (statusIsCancelled(locationBooking.status)) {
      summary.metrics.cancelledCount += 1;
      summary.metrics.cancelledRevenueCents += bookedRevenueCents;
      continue;
    }

    summary.metrics.bookingCount += 1;
    summary.metrics.grossBookedRevenueCents += bookedRevenueCents;
    summary.metrics.cashCollectedCents += cashCollectedCents;

    const bucket = summary.channelBreakdown[channelValue] || summary.channelBreakdown.other;
    bucket.count += 1;
    bucket.revenueCents += bookedRevenueCents;
  }

  if (summary.metrics.bookingCount > 0) {
    summary.metrics.avgBookingValueCents = Math.round(
      summary.metrics.grossBookedRevenueCents / summary.metrics.bookingCount
    );
  }

  summary.entityFilters = {
    cabinId: ctx.entity.cabinId ? String(ctx.entity.cabinId) : null,
    cabinTypeId: ctx.entity.cabinTypeId ? String(ctx.entity.cabinTypeId) : null,
    unitId: ctx.entity.unitId ? String(ctx.entity.unitId) : null,
    channel: ctx.channelFilter
  };
  summary.locationBookingIncluded = ctx.includeLocationBookings;

  return summary;
}

module.exports = {
  aggregateRevenueSummary,
  resolveSummaryContext,
  baseLocationBookingRevenueFilter,
  locationBookingRevenueCents,
  locationBookingCashCollectedCents,
  locationBookingChannel,
  locationBookingPropertyKind
};
