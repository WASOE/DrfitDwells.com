'use strict';

const Booking = require('../../../models/Booking');
const { baseBookingFilter, buildRevenueBasisDateFilter } = require('./reportingFilters');
const { loadPropertyKindMaps, isAllowedPropertyKind } = require('./propertyKindJoin');
const { normalizeStayRow } = require('./normalizedStayRow');

function emptyChannelBucket() {
  return { count: 0, revenueCents: 0 };
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
    ...dateFilterResult.filter
  })
    .select(
      '_id status checkIn checkOut totalPrice totalValueCents stripePaidAmountCents provenance cabinId cabinTypeId unitId createdAt'
    )
    .lean();

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
