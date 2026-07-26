'use strict';

const { loadHistoricalStayFacts, CONFIDENCE } = require('./historicalStayFactsService');
const { computeSellableNights, computeSellableNightsSeries } = require('./sellableInventoryService');
const { periodKeyForDate } = require('./stayNights');
const { buildInclusiveDateRange } = require('./reportingFilters');
const moment = require('moment-timezone');
const { PROPERTY_TIMEZONE } = require('../../../utils/dateTime');

const MAX_RANGE_DAYS = 800;

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function safeRate(numerator, denominator) {
  if (denominator == null || !Number.isFinite(denominator) || denominator <= 0) return null;
  if (!Number.isFinite(numerator)) return null;
  return numerator / denominator;
}

function emptyMetrics() {
  return {
    bookingCount: 0,
    soldNights: 0,
    occupiedNights: 0,
    unallocatedOccupiedNights: 0,
    sellableNights: null,
    occupancyRate: null,
    grossBookedRevenueCents: 0,
    cancelledRevenueCents: 0,
    adrCents: null,
    revenuePerSellableNightCents: null,
    dataConfidence: CONFIDENCE.VERIFIED
  };
}

function worstConfidence(...values) {
  const order = [
    CONFIDENCE.VERIFIED,
    CONFIDENCE.USABLE,
    CONFIDENCE.REVENUE_ONLY,
    CONFIDENCE.UNRELIABLE
  ];
  let worst = CONFIDENCE.VERIFIED;
  for (const v of values) {
    if (!v) continue;
    if (order.indexOf(v) > order.indexOf(worst)) worst = v;
  }
  return worst;
}

function periodBucket() {
  return {
    bookingCount: 0,
    soldNights: 0,
    occupiedNights: 0,
    sellableNights: null,
    grossBookedRevenueCents: 0,
    cancelledRevenueCents: 0,
    confidences: new Set()
  };
}

function finalizeBucket(bucket, sellableNights) {
  const occupied = bucket.occupiedNights;
  const revenue = bucket.grossBookedRevenueCents;
  const sellable = sellableNights == null ? null : sellableNights;
  let dataConfidence = CONFIDENCE.VERIFIED;
  if (bucket.confidences.has(CONFIDENCE.UNRELIABLE)) dataConfidence = CONFIDENCE.UNRELIABLE;
  else if (bucket.confidences.has(CONFIDENCE.REVENUE_ONLY) || sellable == null) {
    dataConfidence = CONFIDENCE.REVENUE_ONLY;
  } else if (bucket.confidences.has(CONFIDENCE.USABLE)) dataConfidence = CONFIDENCE.USABLE;

  return {
    bookingCount: bucket.bookingCount,
    soldNights: bucket.soldNights,
    occupiedNights: occupied,
    sellableNights: sellable,
    occupancyRate: safeRate(occupied, sellable),
    grossBookedRevenueCents: revenue,
    cancelledRevenueCents: bucket.cancelledRevenueCents,
    adrCents: occupied > 0 ? Math.round(revenue / occupied) : null,
    revenuePerSellableNightCents:
      sellable != null && sellable > 0 ? Math.round(revenue / sellable) : null,
    dataConfidence
  };
}

/**
 * Historical direct-booking performance (Batch 5A). Live aggregation.
 */
async function aggregateHistoricalPerformance({
  propertyKind,
  from,
  to,
  groupBy = 'month',
  cabinId = null,
  cabinTypeId = null,
  unitId = null,
  channel = null,
  confidence = 'all',
  revenueBasis = 'checkIn'
} = {}) {
  const range = buildInclusiveDateRange(from, to);
  if (!range) throw badRequest('Invalid from/to date range');

  const spanDays = Math.round((range.endInclusive - range.start) / 86400000) + 1;
  if (spanDays > MAX_RANGE_DAYS) {
    throw badRequest(`Date range cannot exceed ${MAX_RANGE_DAYS} days`);
  }

  const g = ['day', 'week', 'month'].includes(groupBy) ? groupBy : 'month';
  const fromDateOnly = String(from).slice(0, 10);
  const toDateOnly = String(to).slice(0, 10);

  const sellable = await computeSellableNightsSeries({
    propertyKind,
    fromDateOnly,
    toDateOnly,
    groupBy: g,
    cabinId,
    cabinTypeId,
    unitId
  });

  const { facts, revenueBasis: basis } = await loadHistoricalStayFacts({
    propertyKind,
    from,
    to,
    revenueBasis,
    cabinId,
    cabinTypeId,
    unitId,
    channel,
    confidence,
    occupancyDenominatorAvailable: sellable.occupancyDenominatorAvailable
  });

  const summary = emptyMetrics();
  summary.sellableNights = sellable.sellableNights;

  const seriesMap = new Map();
  const entityMap = new Map();

  // Seed series keys across full range so empty periods appear
  const cursor = moment.tz(fromDateOnly, 'YYYY-MM-DD', PROPERTY_TIMEZONE).startOf('day');
  const end = moment.tz(toDateOnly, 'YYYY-MM-DD', PROPERTY_TIMEZONE).startOf('day');
  while (cursor.isSameOrBefore(end)) {
    const key = periodKeyForDate(cursor.format('YYYY-MM-DD'), g);
    if (!seriesMap.has(key)) seriesMap.set(key, periodBucket());
    cursor.add(1, 'day');
  }

  const summaryConfidences = new Set();

  for (const fact of facts) {
    summary.bookingCount += 1;
    summary.soldNights += fact.soldNightsInWindow || 0;
    summary.occupiedNights += fact.occupiedNightsInWindow || 0;
    summary.grossBookedRevenueCents += fact.bookedRevenueCents || 0;
    summary.cancelledRevenueCents += fact.cancelledRevenueCents || 0;
    summaryConfidences.add(fact.dataConfidence);
    if (fact.occupancyAttribution === 'unallocated_missing_unit') {
      summary.unallocatedOccupiedNights += fact.occupiedNightsInWindow || 0;
    }

    // Period attribution: use check-in date for booked/checkIn basis alignment with revenue series
    const anchor =
      basis === 'booked' && fact.bookedAt
        ? require('../../../utils/dateTime').formatSofiaDateOnly(fact.bookedAt)
        : fact.checkInDateOnly;
    if (anchor) {
      const key = periodKeyForDate(anchor, g);
      if (!seriesMap.has(key)) seriesMap.set(key, periodBucket());
      const b = seriesMap.get(key);
      b.bookingCount += 1;
      b.soldNights += fact.soldNightsInWindow || 0;
      b.occupiedNights += fact.occupiedNightsInWindow || 0;
      b.grossBookedRevenueCents += fact.bookedRevenueCents || 0;
      b.cancelledRevenueCents += fact.cancelledRevenueCents || 0;
      b.confidences.add(fact.dataConfidence);
    }

    // Entity comparison — location buyouts as location; never fabricate unit from missing assignment
    let entityKey;
    let entityType;
    let entityId;
    let displayName;
    if (fact.isLocationBuyout) {
      entityType = 'location';
      entityId = fact.locationKey || 'valley';
      displayName = 'The Valley (buyout)';
      entityKey = `${entityType}:${entityId}`;
    } else if (fact.unitId) {
      entityType = 'unit';
      entityId = fact.unitId;
      displayName = `Unit ${fact.unitId.slice(-6)}`;
      entityKey = `${entityType}:${entityId}`;
    } else if (fact.occupancyAttribution === 'unallocated_missing_unit') {
      entityType = 'unallocated_missing_unit';
      entityId = fact.cabinTypeId || 'unknown';
      displayName = 'Unallocated Valley nights (missing unitId)';
      entityKey = `${entityType}:${entityId}`;
    } else if (fact.cabinId) {
      entityType = 'cabin';
      entityId = fact.cabinId;
      displayName = `Cabin ${fact.cabinId.slice(-6)}`;
      entityKey = `${entityType}:${entityId}`;
    } else if (fact.cabinTypeId) {
      entityType = 'cabin_type';
      entityId = fact.cabinTypeId;
      displayName = `CabinType ${fact.cabinTypeId.slice(-6)}`;
      entityKey = `${entityType}:${entityId}`;
    } else {
      entityType = 'unknown';
      entityId = 'unknown';
      displayName = 'Unassigned inventory';
      entityKey = 'unknown:unknown';
    }

    if (!entityMap.has(entityKey)) {
      entityMap.set(entityKey, {
        entityType,
        entityId,
        displayName,
        bookingCount: 0,
        occupiedNights: 0,
        sellableNights: null,
        grossBookedRevenueCents: 0,
        issues: new Set(),
        confidences: new Set()
      });
    }
    const e = entityMap.get(entityKey);
    e.bookingCount += 1;
    e.occupiedNights += fact.occupiedNightsInWindow || 0;
    e.grossBookedRevenueCents += fact.bookedRevenueCents || 0;
    e.confidences.add(fact.dataConfidence);
    for (const issue of fact.dataQualityIssues || []) e.issues.add(issue);
  }

  const entityFiltered = Boolean(cabinTypeId || unitId);
  const hasUnallocated = summary.unallocatedOccupiedNights > 0;

  let summaryConfidence = CONFIDENCE.VERIFIED;
  if (summaryConfidences.has(CONFIDENCE.UNRELIABLE)) summaryConfidence = CONFIDENCE.UNRELIABLE;
  else if (
    summaryConfidences.has(CONFIDENCE.REVENUE_ONLY) ||
    !sellable.occupancyDenominatorAvailable
  ) {
    summaryConfidence = CONFIDENCE.REVENUE_ONLY;
  } else if (summaryConfidences.has(CONFIDENCE.USABLE) || hasUnallocated) {
    summaryConfidence = CONFIDENCE.USABLE;
  }

  // Precise unit/type occupancy is unreliable when unallocated missing-unit nights are in the filter.
  if (entityFiltered && hasUnallocated) {
    summary.occupancyRate = null;
    summaryConfidence = worstConfidence(summaryConfidence, CONFIDENCE.USABLE);
  } else {
    summary.occupancyRate = safeRate(summary.occupiedNights, summary.sellableNights);
  }
  summary.dataConfidence = summaryConfidence;
  summary.adrCents =
    summary.occupiedNights > 0
      ? Math.round(summary.grossBookedRevenueCents / summary.occupiedNights)
      : null;
  summary.revenuePerSellableNightCents =
    summary.sellableNights != null && summary.sellableNights > 0
      ? Math.round(summary.grossBookedRevenueCents / summary.sellableNights)
      : null;

  const series = [...seriesMap.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([period, bucket]) => {
      const sellableForPeriod = sellable.occupancyDenominatorAvailable
        ? sellable.seriesByPeriod.get(period) || 0
        : null;
      return {
        period,
        ...finalizeBucket(bucket, sellableForPeriod)
      };
    });

  const sellableByEntity = new Map(
    (sellable.entitySellable || []).map((row) => [`${row.entityType}:${row.entityId}`, row])
  );

  const entities = [...entityMap.values()].map((e) => {
    const sellableRow = sellableByEntity.get(`${e.entityType}:${e.entityId}`);
    const sellableNights = sellableRow ? sellableRow.sellableNights : null;
    let dataConfidence = CONFIDENCE.VERIFIED;
    if (e.confidences.has(CONFIDENCE.UNRELIABLE)) dataConfidence = CONFIDENCE.UNRELIABLE;
    else if (e.confidences.has(CONFIDENCE.REVENUE_ONLY) || sellableNights == null) {
      dataConfidence = CONFIDENCE.REVENUE_ONLY;
    } else if (e.confidences.has(CONFIDENCE.USABLE)) dataConfidence = CONFIDENCE.USABLE;

    const isUnallocated = e.entityType === 'unallocated_missing_unit';
    return {
      entityType: e.entityType,
      entityId: e.entityId,
      displayName: e.displayName,
      bookingCount: e.bookingCount,
      occupiedNights: e.occupiedNights,
      sellableNights: isUnallocated ? null : sellableNights,
      occupancyRate: isUnallocated ? null : safeRate(e.occupiedNights, sellableNights),
      grossBookedRevenueCents: e.grossBookedRevenueCents,
      adrCents:
        e.occupiedNights > 0
          ? Math.round(e.grossBookedRevenueCents / e.occupiedNights)
          : null,
      dataConfidence: isUnallocated
        ? worstConfidence(dataConfidence, CONFIDENCE.USABLE)
        : dataConfidence,
      issues: [...e.issues]
    };
  });

  const limitations = [
    ...(sellable.limitations || []),
    'Direct revenue per sellable night is not total RevPAR — Airbnb and other external channels are excluded.',
    'iCal external_hold blocks are availability signals only and are not treated as paid stays.',
    'Location buyouts count once; represented child bookings do not duplicate revenue or nights.',
    'Cancelled bookings contribute cancelled revenue, not occupied nights.'
  ];
  if (propertyKind === 'valley') {
    limitations.push(
      'Valley sellable nights mix standalone Valley cabins and unit-backed inventory; multi/listing parent Cabins are excluded from the denominator.'
    );
  }
  if ((sellable.excludedAggregateListings || []).length) {
    limitations.push(
      `Excluded ${sellable.excludedAggregateListings.length} aggregate listing Cabin(s) from the occupancy denominator (unit-backed inventory is canonical).`
    );
  }
  if (hasUnallocated) {
    limitations.push(
      'Some Valley occupied nights lack unitId and are surfaced as unallocated_missing_unit — they do not fabricate unit occupancy.'
    );
  }

  return {
    propertyKind,
    period: { from: fromDateOnly, to: toDateOnly },
    revenueBasis: basis,
    groupBy: g,
    summary,
    series,
    entities,
    provenance: {
      directBookingsOnly: true,
      externalChannelsIncluded: false,
      occupancyMethod:
        'operating_periods_minus_verified_maintenance_and_manual_blocks',
      valleyDenominator:
        propertyKind === 'valley'
          ? 'standalone_valley_cabins_plus_canonical_units'
          : null,
      excludedAggregateListings: sellable.excludedAggregateListings || [],
      unallocatedOccupiedNights: summary.unallocatedOccupiedNights,
      excludedUnknownBlocks: sellable.excludedUnknownBlocks || 0,
      limitations,
      occupancyUnavailableMessage: sellable.occupancyDenominatorAvailable
        ? null
        : 'Occupancy unavailable for this period because historical sellable inventory cannot be verified.',
      computedAt: new Date().toISOString()
    }
  };
}

module.exports = {
  aggregateHistoricalPerformance,
  MAX_RANGE_DAYS,
  safeRate
};
