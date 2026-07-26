'use strict';

const BookingFunnelEvent = require('../../models/BookingFunnelEvent');
const { buildInclusiveDateRange } = require('../ops/reporting/reportingFilters');
const { isAllowedPropertyKind } = require('../ops/reporting/propertyKindJoin');
const { validateConversionEntityFilters } = require('../ops/reporting/entityFilterValidation');
const { aggregateRecoverySupplementaryCounts } = require('../ops/readModels/recoveryReadModel');

const MAIN_FUNNEL_STEPS = Object.freeze([
  { eventType: 'property_view', label: 'Property view', source: 'client' },
  { eventType: 'confirm_page_view', label: 'Confirm page view', source: 'client' },
  { eventType: 'quote_received', label: 'Quote received', source: 'server' },
  { eventType: 'checkout_started', label: 'Checkout started', source: 'client' },
  { eventType: 'booking_converted', label: 'Booking converted', source: 'server' }
]);

const MAX_RANGE_DAYS = 180;

const SEARCH_RESULTS_NOTE =
  'Search results are site-wide and not included in Cabin/Valley drop-off. Entity filters never apply.';

function daySpan(range) {
  return Math.round((range.endExclusive.getTime() - range.start.getTime()) / (24 * 60 * 60 * 1000));
}

function validateConversionQuery({ propertyKind, from, to }) {
  if (!isAllowedPropertyKind(propertyKind)) {
    const error = new Error('propertyKind must be cabin or valley');
    error.statusCode = 400;
    throw error;
  }

  const range = buildInclusiveDateRange(from, to);
  if (!range) {
    const error = new Error('Invalid from/to date range');
    error.statusCode = 400;
    throw error;
  }

  if (daySpan(range) > MAX_RANGE_DAYS) {
    const error = new Error(`Date range cannot exceed ${MAX_RANGE_DAYS} days`);
    error.statusCode = 400;
    throw error;
  }

  return {
    range,
    from: String(from).trim().slice(0, 10),
    to: String(to).trim().slice(0, 10)
  };
}

function buildZoneMatch({ eventType, propertyKind, range, entity }) {
  const match = {
    eventType,
    propertyKind,
    createdAt: { $gte: range.start, $lt: range.endExclusive }
  };
  if (entity?.cabinId) {
    match.cabinId = entity.cabinId;
  }
  if (entity?.cabinTypeId) {
    match.cabinTypeId = entity.cabinTypeId;
  }
  return match;
}

async function countIdentifiedStep({ eventType, propertyKind, range, entity }) {
  const match = {
    ...buildZoneMatch({ eventType, propertyKind, range, entity }),
    sessionKey: { $type: 'string' }
  };

  const [sessionAgg, eventCount] = await Promise.all([
    BookingFunnelEvent.aggregate([
      { $match: match },
      { $group: { _id: '$sessionKey' } },
      { $count: 'sessionCount' }
    ]),
    BookingFunnelEvent.countDocuments(match)
  ]);

  return {
    sessionCount: sessionAgg[0]?.sessionCount ?? 0,
    eventCount
  };
}

async function countOrphanEvents({ eventType, propertyKind, range, prefix, entity }) {
  const match = {
    ...buildZoneMatch({ eventType, propertyKind, range, entity }),
    dedupeKey: { $regex: `^${prefix}:orphan:` }
  };
  return BookingFunnelEvent.countDocuments(match);
}

async function countSearchResultsSupplementary({ range }) {
  const match = {
    eventType: 'search_results',
    createdAt: { $gte: range.start, $lt: range.endExclusive },
    sessionKey: { $type: 'string' }
  };

  const [sessionAgg, eventCount] = await Promise.all([
    BookingFunnelEvent.aggregate([
      { $match: match },
      { $group: { _id: '$sessionKey' } },
      { $count: 'sessionCount' }
    ]),
    BookingFunnelEvent.countDocuments(match)
  ]);

  return {
    sessionCount: sessionAgg[0]?.sessionCount ?? 0,
    eventCount
  };
}

async function countQuoteFailed({ propertyKind, range, entity }) {
  const events = await BookingFunnelEvent.find(
    buildZoneMatch({ eventType: 'quote_failed', propertyKind, range, entity })
  )
    .select('quoteFailureClass dedupeKey')
    .lean();

  const byClass = {};
  let orphanEventCount = 0;
  for (const event of events) {
    const cls = event.quoteFailureClass || 'unknown';
    byClass[cls] = (byClass[cls] || 0) + 1;
    if (String(event.dedupeKey || '').startsWith('qf:orphan:')) {
      orphanEventCount += 1;
    }
  }

  return {
    eventCount: events.length,
    orphanEventCount,
    byClass
  };
}

function buildSessionTimeline(events) {
  const bySession = new Map();
  for (const event of events) {
    if (!event.sessionKey) continue;
    if (!bySession.has(event.sessionKey)) {
      bySession.set(event.sessionKey, []);
    }
    bySession.get(event.sessionKey).push(event);
  }
  for (const timeline of bySession.values()) {
    timeline.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }
  return bySession;
}

function sessionContinuedSequential(timeline, fromType, toType) {
  const firstFrom = timeline.find((event) => event.eventType === fromType);
  if (!firstFrom) return false;
  const fromTime = new Date(firstFrom.createdAt).getTime();
  return timeline.some(
    (event) =>
      event.eventType === toType && new Date(event.createdAt).getTime() >= fromTime
  );
}

async function computeDropOff({ propertyKind, range, entity }) {
  const eventTypes = MAIN_FUNNEL_STEPS.map((step) => step.eventType);
  const match = {
    eventType: { $in: eventTypes },
    propertyKind,
    createdAt: { $gte: range.start, $lt: range.endExclusive },
    sessionKey: { $type: 'string' }
  };
  if (entity?.cabinId) match.cabinId = entity.cabinId;
  if (entity?.cabinTypeId) match.cabinTypeId = entity.cabinTypeId;

  const events = await BookingFunnelEvent.find(match)
    .select('sessionKey eventType createdAt')
    .lean();

  const sessionMap = buildSessionTimeline(events);
  const dropOff = [];

  for (let i = 0; i < MAIN_FUNNEL_STEPS.length - 1; i += 1) {
    const fromType = MAIN_FUNNEL_STEPS[i].eventType;
    const toType = MAIN_FUNNEL_STEPS[i + 1].eventType;
    let fromSessionCount = 0;
    let continuedSessionCount = 0;

    for (const timeline of sessionMap.values()) {
      if (!timeline.some((event) => event.eventType === fromType)) continue;
      fromSessionCount += 1;
      if (sessionContinuedSequential(timeline, fromType, toType)) {
        continuedSessionCount += 1;
      }
    }

    const continuationRate =
      fromSessionCount > 0 ? continuedSessionCount / fromSessionCount : null;
    const dropOffRate = continuationRate == null ? null : 1 - continuationRate;

    dropOff.push({
      from: fromType,
      to: toType,
      fromSessionCount,
      continuedSessionCount,
      continuationRate:
        continuationRate == null ? null : Math.round(continuationRate * 1000) / 1000,
      dropOffRate: dropOffRate == null ? null : Math.round(dropOffRate * 1000) / 1000
    });
  }

  return dropOff;
}

async function aggregateConversionSummary({
  propertyKind,
  from,
  to,
  cabinId = null,
  cabinTypeId = null,
  unitId = null
}) {
  const { range, from: fromDate, to: toDate } = validateConversionQuery({ propertyKind, from, to });
  const entity = await validateConversionEntityFilters({
    propertyKind,
    cabinId,
    cabinTypeId,
    unitId
  });

  const steps = [];
  for (const step of MAIN_FUNNEL_STEPS) {
    const counts = await countIdentifiedStep({
      eventType: step.eventType,
      propertyKind,
      range,
      entity
    });
    const entry = {
      ...step,
      sessionCount: counts.sessionCount,
      eventCount: counts.eventCount
    };
    if (step.eventType === 'quote_received') {
      entry.orphanEventCount = await countOrphanEvents({
        eventType: 'quote_received',
        propertyKind,
        range,
        prefix: 'qr',
        entity
      });
    }
    steps.push(entry);
  }

  const searchResults = await countSearchResultsSupplementary({ range });
  const quoteFailed = await countQuoteFailed({ propertyKind, range, entity });
  const dropOff = await computeDropOff({ propertyKind, range, entity });
  const recovery = await aggregateRecoverySupplementaryCounts({ propertyKind, range, entity });

  return {
    propertyKind,
    period: { from: fromDate, to: toDate },
    filters: {
      cabinId: entity.cabinId ? String(entity.cabinId) : null,
      cabinTypeId: entity.cabinTypeId ? String(entity.cabinTypeId) : null
    },
    steps,
    dropOff,
    supplementary: {
      searchResults: {
        sessionCount: searchResults.sessionCount,
        eventCount: searchResults.eventCount,
        note: SEARCH_RESULTS_NOTE,
        siteWide: true,
        entityFiltersApplied: false
      },
      quoteFailed: {
        eventCount: quoteFailed.eventCount,
        orphanEventCount: quoteFailed.orphanEventCount,
        byClass: quoteFailed.byClass
      },
      savedQuotes: recovery
    },
    provenance: {
      computedAt: new Date().toISOString(),
      funnelModel: 'session_sequential',
      funnelModelNote:
        'Zone funnel excludes search_results. Drop-off uses sessions that reached step N and also reached step N+1 in order within the period.',
      propertyKindFilterNote: 'Main funnel steps are filtered by propertyKind.',
      entityFilterNote:
        'Optional cabinId/cabinTypeId scope zone funnel and quote_failed only. unitId is not supported. search_results remain site-wide.',
      consentNote:
        'Client steps require analytics consent. Server quote/conversion events may lack sessionKey when consent declined.',
      checkoutStartedNote: 'checkout_started has no historical data before Batch 2 deployment.',
      searchResultsNote: SEARCH_RESULTS_NOTE,
      savedQuotesNote:
        'Supplementary SavedBookingQuote counts only. Not part of session-sequential funnel drop-off. Batch 4A does not send recovery messages.',
      maxRangeDays: MAX_RANGE_DAYS
    }
  };
}

module.exports = {
  MAIN_FUNNEL_STEPS,
  MAX_RANGE_DAYS,
  SEARCH_RESULTS_NOTE,
  validateConversionQuery,
  aggregateConversionSummary,
  buildSessionTimeline,
  sessionContinuedSequential
};
