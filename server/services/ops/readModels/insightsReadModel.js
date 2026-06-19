'use strict';

const { aggregateRevenueSummary } = require('../reporting/revenueMetricsService');
const { buildInsightsDataQuality } = require('../reporting/insightsDataQualityService');

function revenueBasisNote(revenueBasis) {
  if (revenueBasis === 'booked') {
    return 'Filtered by booking createdAt. Not cash-collected date.';
  }
  return 'Filtered by check-in date. Not prorated stay revenue. Multi-night stays count once on check-in.';
}

async function getInsightsSummaryReadModel({ propertyKind, from, to, revenueBasis = 'checkIn' }) {
  const basis = revenueBasis === 'booked' ? 'booked' : 'checkIn';
  const summary = await aggregateRevenueSummary({ propertyKind, from, to, revenueBasis: basis });

  return {
    ...summary,
    provenance: {
      computedAt: new Date().toISOString(),
      revenueBasis: basis,
      revenueBasisNote: revenueBasisNote(basis),
      filtersApplied: ['baseBookingFilter', 'fixtureExclusion', 'propertyKindStrictJoin'],
      cashCollectedNote: 'Sum of Booking.stripePaidAmountCents at finalize; not webhook-updated.'
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

module.exports = {
  getInsightsSummaryReadModel,
  getInsightsDataQualityReadModel
};
