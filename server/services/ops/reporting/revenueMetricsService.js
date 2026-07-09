'use strict';

const Booking = require('../../../models/Booking');
const LocationBooking = require('../../../models/LocationBooking');
const { baseBookingFilter, buildRevenueBasisDateFilter } = require('./reportingFilters');
const { loadPropertyKindMaps, isAllowedPropertyKind } = require('./propertyKindJoin');
const { normalizeStayRow } = require('./normalizedStayRow');
const { FIXTURE_BOOKING_EMAIL_PATTERN } = require('../../../utils/fixtureExclusion');

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

async function aggregateRevenueSummary({ propertyKind, from, to, revenueBasis = 'checkIn' }) {
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

  const maps = await loadPropertyKindMaps();
  const bookings = await Booking.find({
    ...baseBookingFilter(),
    excludeFromRevenueReporting: { $ne: true },
    ...dateFilterResult.filter
  })
    .select(
      '_id status checkIn checkOut totalPrice totalValueCents stripePaidAmountCents provenance cabinId cabinTypeId unitId createdAt excludeFromRevenueReporting'
    )
    .lean();

  const locationBookings =
    propertyKind === 'valley'
      ? await LocationBooking.find({
          ...baseLocationBookingRevenueFilter(),
          ...dateFilterResult.filter
        })
          .select(
            '_id status checkIn checkOut totalPrice stripePaymentIntentId source locationKey createdAt'
          )
          .lean()
      : [];

  const summary = buildEmptySummary({ propertyKind, from, to, revenueBasis: basis });

  for (const booking of bookings) {
    const row = normalizeStayRow(booking, maps);
    if (row.propertyKind !== propertyKind) continue;

    if (row.status === 'cancelled') {
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
    if (locationBookingPropertyKind(locationBooking) !== propertyKind) continue;

    const bookedRevenueCents = locationBookingRevenueCents(locationBooking);
    const cashCollectedCents = locationBookingCashCollectedCents(locationBooking);
    const channel = locationBookingChannel(locationBooking);

    if (locationBooking.status === 'cancelled') {
      summary.metrics.cancelledCount += 1;
      summary.metrics.cancelledRevenueCents += bookedRevenueCents;
      continue;
    }

    summary.metrics.bookingCount += 1;
    summary.metrics.grossBookedRevenueCents += bookedRevenueCents;
    summary.metrics.cashCollectedCents += cashCollectedCents;

    const bucket = summary.channelBreakdown[channel] || summary.channelBreakdown.other;
    bucket.count += 1;
    bucket.revenueCents += bookedRevenueCents;
  }

  if (summary.metrics.bookingCount > 0) {
    summary.metrics.avgBookingValueCents = Math.round(
      summary.metrics.grossBookedRevenueCents / summary.metrics.bookingCount
    );
  }

  return summary;
}

module.exports = {
  aggregateRevenueSummary
};
