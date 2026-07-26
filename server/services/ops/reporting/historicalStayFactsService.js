'use strict';

const Booking = require('../../../models/Booking');
const LocationBooking = require('../../../models/LocationBooking');
const { baseBookingFilter, buildRevenueBasisDateFilter } = require('./reportingFilters');
const { loadPropertyKindMaps, isAllowedPropertyKind } = require('./propertyKindJoin');
const {
  bookingRevenueCents,
  bookingCashCollectedCents,
  resolveChannel,
  normalizeStayRow
} = require('./normalizedStayRow');
const { FIXTURE_BOOKING_EMAIL_PATTERN } = require('../../../utils/fixtureExclusion');
const {
  validateInsightsEntityFilters,
  buildBookingEntityMatch,
  shouldIncludeLocationBookings,
  parseChannelFilter
} = require('./entityFilterValidation');
const { computeStayNights, overlapStayNightsWithWindow } = require('./stayNights');
const { formatSofiaDateOnly } = require('../../../utils/dateTime');

const CONFIDENCE = Object.freeze({
  VERIFIED: 'verified',
  USABLE: 'usable_with_limitations',
  REVENUE_ONLY: 'revenue_only',
  UNRELIABLE: 'unreliable'
});

function locationBookingRevenueCents(doc) {
  const totalPrice = Number(doc?.totalPrice);
  if (!Number.isFinite(totalPrice)) return 0;
  return Math.max(0, Math.round(totalPrice * 100));
}

function locationBookingChannel(doc) {
  return String(doc?.source || '').trim() === 'website' ? 'website' : 'other';
}

function statusIsCancelled(status) {
  return String(status || '') === 'cancelled';
}

function classifyStayConfidence({ issues, occupancyDenominatorAvailable }) {
  const hard = issues.some((i) =>
    [
      'missing_property_kind',
      'missing_inventory_ref',
      'both_cabin_and_cabin_type',
      'invalid_date_range',
      'same_day_or_inverted'
    ].includes(i)
  );
  if (hard) return CONFIDENCE.UNRELIABLE;

  if (!occupancyDenominatorAvailable) {
    return CONFIDENCE.REVENUE_ONLY;
  }

  const soft = issues.some((i) =>
    [
      'missing_unit',
      'ambiguous_cancellation',
      'zero_value_commercial_stay',
      'incomplete_operational_blocks'
    ].includes(i)
  );
  if (soft) return CONFIDENCE.USABLE;

  return CONFIDENCE.VERIFIED;
}

function confidencePassesFilter(confidence, filter) {
  if (!filter || filter === 'all') return true;
  if (filter === 'verified') return confidence === CONFIDENCE.VERIFIED;
  if (filter === 'usable') {
    return confidence === CONFIDENCE.VERIFIED || confidence === CONFIDENCE.USABLE;
  }
  return true;
}

/**
 * Build one normalized historical stay fact (direct bookings only).
 */
function buildBookingStayFact(booking, maps, { fromDateOnly, toDateOnly, occupancyDenominatorAvailable }) {
  const base = normalizeStayRow(booking, maps);
  const issues = [];
  if (base.propertyKindIssue) issues.push(base.propertyKindIssue);
  if (base.isMissingUnitOnValley) issues.push('missing_unit');
  if (base.isZeroPriceManual || base.bookedRevenueCents === 0) {
    issues.push('zero_value_commercial_stay');
  }

  const stay = computeStayNights(booking.checkIn, booking.checkOut);
  if (stay.invalid) {
    issues.push(stay.reason === 'same_day_or_inverted' ? 'same_day_or_inverted' : 'invalid_date_range');
  }

  const cancelled = statusIsCancelled(booking.status);
  if (cancelled) {
    const snap = booking.cancellationSettlement?.financialSnapshot;
    if (!snap?.capturedAt) issues.push('ambiguous_cancellation');
  }

  const windowNights = overlapStayNightsWithWindow({
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    fromDateOnly,
    toDateOnly
  });

  const soldNights = stay.invalid ? 0 : stay.nights;
  const occupiedNights = cancelled || stay.invalid ? 0 : stay.nights;
  const occupiedNightsInWindow = cancelled || stay.invalid ? 0 : windowNights.nights;
  const soldNightsInWindow = stay.invalid ? 0 : windowNights.nights;

  let occupancyAttribution = 'unknown';
  if (base.unitId) occupancyAttribution = 'unit';
  else if (base.cabinTypeId) occupancyAttribution = 'cabin_type';
  else if (base.cabinId) occupancyAttribution = 'cabin_type';

  const revenueCents = base.bookedRevenueCents;
  const dataConfidence = classifyStayConfidence({
    issues,
    occupancyDenominatorAvailable
  });

  return {
    stayKind: 'booking',
    bookingId: String(booking._id),
    locationBookingId: booking.locationBookingId ? String(booking.locationBookingId) : null,
    propertyKind: base.propertyKind,
    cabinId: base.cabinId,
    cabinTypeId: base.cabinTypeId,
    unitId: base.unitId,
    locationKey: null,
    channel: base.channel,
    bookedAt: booking.createdAt || null,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    checkInDateOnly: stay.checkInDateOnly,
    checkOutDateOnly: stay.checkOutDateOnly,
    status: booking.status,
    soldNights,
    occupiedNights,
    soldNightsInWindow,
    occupiedNightsInWindow,
    bookedRevenueCents: cancelled ? 0 : revenueCents,
    cancelledRevenueCents: cancelled ? revenueCents : 0,
    paymentSnapshotAtBookingCents: bookingCashCollectedCents(booking),
    isLocationBuyout: false,
    representedChildBookingIds: [],
    occupancyAttribution,
    dataConfidence,
    dataQualityIssues: issues,
    excludeFromRevenueReporting: Boolean(booking.excludeFromRevenueReporting)
  };
}

function buildLocationStayFact(doc, { fromDateOnly, toDateOnly, occupancyDenominatorAvailable }) {
  const issues = [];
  const propertyKind = doc.locationKey === 'valley' ? 'valley' : null;
  if (!propertyKind) issues.push('missing_property_kind');

  const stay = computeStayNights(doc.checkIn, doc.checkOut);
  if (stay.invalid) {
    issues.push(stay.reason === 'same_day_or_inverted' ? 'same_day_or_inverted' : 'invalid_date_range');
  }

  const cancelled = statusIsCancelled(doc.status);
  const revenueCents = locationBookingRevenueCents(doc);
  if (revenueCents === 0) issues.push('zero_value_commercial_stay');

  const windowNights = overlapStayNightsWithWindow({
    checkIn: doc.checkIn,
    checkOut: doc.checkOut,
    fromDateOnly,
    toDateOnly
  });

  const soldNights = stay.invalid ? 0 : stay.nights;
  const occupiedNights = cancelled || stay.invalid ? 0 : stay.nights;

  const dataConfidence = classifyStayConfidence({
    issues,
    occupancyDenominatorAvailable
  });

  return {
    stayKind: 'location_booking',
    bookingId: null,
    locationBookingId: String(doc._id),
    propertyKind,
    cabinId: null,
    cabinTypeId: null,
    unitId: null,
    locationKey: doc.locationKey || null,
    channel: locationBookingChannel(doc),
    bookedAt: doc.createdAt || null,
    checkIn: doc.checkIn,
    checkOut: doc.checkOut,
    checkInDateOnly: stay.checkInDateOnly,
    checkOutDateOnly: stay.checkOutDateOnly,
    status: doc.status,
    soldNights,
    occupiedNights,
    soldNightsInWindow: stay.invalid ? 0 : windowNights.nights,
    occupiedNightsInWindow: cancelled || stay.invalid ? 0 : windowNights.nights,
    bookedRevenueCents: cancelled ? 0 : revenueCents,
    cancelledRevenueCents: cancelled ? revenueCents : 0,
    paymentSnapshotAtBookingCents:
      doc.stripePaymentIntentId && !cancelled ? revenueCents : 0,
    isLocationBuyout: true,
    representedChildBookingIds: (doc.childBookingIds || []).map(String),
    occupancyAttribution: 'location',
    dataConfidence,
    dataQualityIssues: issues,
    excludeFromRevenueReporting: false
  };
}

/**
 * Load normalized direct-stay facts for a reporting window.
 * Location buyouts counted once; revenue children omitted.
 */
async function loadHistoricalStayFacts({
  propertyKind,
  from,
  to,
  revenueBasis = 'checkIn',
  cabinId = null,
  cabinTypeId = null,
  unitId = null,
  channel = null,
  confidence = 'all',
  occupancyDenominatorAvailable = false
} = {}) {
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
  const maps = entity.maps || (await loadPropertyKindMaps());
  const fromDateOnly = String(from).slice(0, 10);
  const toDateOnly = String(to).slice(0, 10);

  const bookingMatch = {
    ...baseBookingFilter(),
    ...dateFilterResult.filter,
    excludeFromRevenueReporting: { $ne: true },
    ...buildBookingEntityMatch(propertyKind, entity, maps)
  };

  const bookings = await Booking.find(bookingMatch)
    .select(
      [
        '_id',
        'status',
        'checkIn',
        'checkOut',
        'createdAt',
        'totalPrice',
        'totalValueCents',
        'stripePaidAmountCents',
        'provenance',
        'cabinId',
        'cabinTypeId',
        'unitId',
        'locationBookingId',
        'excludeFromRevenueReporting',
        'cancellationSettlement'
      ].join(' ')
    )
    .lean();

  const facts = [];
  for (const booking of bookings) {
    const row = normalizeStayRow(booking, maps);
    if (row.propertyKind !== propertyKind && row.propertyKindIssue == null) continue;
    // Include unresolved propertyKind rows as unreliable for quality; exclude from zone metrics
    // when they resolve to the other zone.
    if (row.propertyKind && row.propertyKind !== propertyKind) continue;
    if (row.propertyKind == null && propertyKind) {
      // Still include for quality when no entity filter — tagged unreliable
    } else if (row.propertyKind == null) {
      continue;
    }

    const fact = buildBookingStayFact(booking, maps, {
      fromDateOnly,
      toDateOnly,
      occupancyDenominatorAvailable
    });
    if (fact.propertyKind && fact.propertyKind !== propertyKind) continue;
    if (!channelMatches(fact.channel, channelFilter)) continue;
    if (!confidencePassesFilter(fact.dataConfidence, confidence)) continue;
    // Entity filter already applied in query; skip null-propertyKind unless confidence=all quality path
    if (!fact.propertyKind) continue;
    facts.push(fact);
  }

  if (shouldIncludeLocationBookings(propertyKind, entity)) {
    const locMatch = {
      locationKey: 'valley',
      'guestInfo.email': { $not: FIXTURE_BOOKING_EMAIL_PATTERN },
      ...dateFilterResult.filter
    };
    const locs = await LocationBooking.find(locMatch)
      .select(
        '_id status checkIn checkOut createdAt totalPrice source stripePaymentIntentId childBookingIds locationKey guestInfo'
      )
      .lean();
    for (const doc of locs) {
      const fact = buildLocationStayFact(doc, {
        fromDateOnly,
        toDateOnly,
        occupancyDenominatorAvailable
      });
      if (!channelMatches(fact.channel, channelFilter)) continue;
      if (!confidencePassesFilter(fact.dataConfidence, confidence)) continue;
      facts.push(fact);
    }
  }

  return {
    facts,
    range: dateFilterResult.range,
    fromDateOnly,
    toDateOnly,
    revenueBasis: basis,
    maps
  };
}

function channelMatches(rowChannel, channelFilter) {
  if (!channelFilter) return true;
  return rowChannel === channelFilter;
}

module.exports = {
  CONFIDENCE,
  loadHistoricalStayFacts,
  buildBookingStayFact,
  buildLocationStayFact,
  classifyStayConfidence,
  confidencePassesFilter,
  computeStayNights,
  formatSofiaDateOnly
};
