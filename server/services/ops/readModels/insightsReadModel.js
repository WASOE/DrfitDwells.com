'use strict';

const { aggregateRevenueSummary } = require('../reporting/revenueMetricsService');
const { buildInsightsDataQuality } = require('../reporting/insightsDataQualityService');
const { aggregateInsightsBookings } = require('../reporting/insightsBookingsService');
const { getInsightsFilterOptions } = require('../reporting/insightsFilterOptionsService');
const { aggregateInsightsReconciliation } = require('../reporting/insightsReconciliationService');

function revenueBasisNote(revenueBasis) {
  if (revenueBasis === 'booked') {
    return 'Filtered by booking createdAt (Sofia day, end-exclusive). Not cash-collected date.';
  }
  return 'Filtered by check-in date (Sofia day, end-exclusive). Not prorated stay revenue. Multi-night stays count once on check-in.';
}

function paymentSnapshotNote() {
  return 'Payment snapshot at booking: sum of Booking.stripePaidAmountCents captured at finalize. Does not reflect later refunds or payment changes. Not live Stripe balance.';
}

async function getInsightsSummaryReadModel({
  propertyKind,
  from,
  to,
  revenueBasis = 'checkIn',
  cabinId = null,
  cabinTypeId = null,
  unitId = null,
  channel = null
}) {
  const basis = revenueBasis === 'booked' ? 'booked' : 'checkIn';
  const summary = await aggregateRevenueSummary({
    propertyKind,
    from,
    to,
    revenueBasis: basis,
    cabinId,
    cabinTypeId,
    unitId,
    channel
  });

  return {
    ...summary,
    provenance: {
      computedAt: new Date().toISOString(),
      revenueBasis: basis,
      revenueBasisNote: revenueBasisNote(basis),
      filtersApplied: [
        'baseBookingFilter',
        'fixtureExclusion',
        'propertyKindStrictJoin',
        'entityFiltersOptional',
        'excludeFromRevenueReporting'
      ],
      cashCollectedNote: paymentSnapshotNote(),
      paymentSnapshotNote: paymentSnapshotNote(),
      locationBookingIncluded: summary.locationBookingIncluded === true,
      locationBookingNote: summary.locationBookingIncluded
        ? 'Valley LocationBooking masters included once; child bookings with excludeFromRevenueReporting omitted.'
        : 'LocationBooking masters omitted for this filter set or propertyKind.'
    }
  };
}

async function getInsightsDataQualityReadModel({ propertyKind }) {
  const data = await buildInsightsDataQuality({ propertyKind });
  return {
    ...data,
    provenance: {
      computedAt: new Date().toISOString()
    }
  };
}

async function getInsightsBookingsReadModel(params) {
  return aggregateInsightsBookings(params);
}

async function getInsightsFilterOptionsReadModel({ propertyKind }) {
  return getInsightsFilterOptions({ propertyKind });
}

async function getInsightsReconciliationReadModel(params) {
  return aggregateInsightsReconciliation(params);
}

module.exports = {
  getInsightsSummaryReadModel,
  getInsightsDataQualityReadModel,
  getInsightsBookingsReadModel,
  getInsightsFilterOptionsReadModel,
  getInsightsReconciliationReadModel
};
