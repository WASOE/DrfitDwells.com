'use strict';

const BookingFunnelEvent = require('../../models/BookingFunnelEvent');
const { buildInclusiveDateRange } = require('../ops/reporting/reportingFilters');
const { isAllowedPropertyKind } = require('../ops/reporting/propertyKindJoin');
const { validateConversionEntityFilters } = require('../ops/reporting/entityFilterValidation');
const { aggregateRecoverySupplementaryCounts } = require('../ops/readModels/recoveryReadModel');
const { MAIN_FUNNEL_STAGE_EVENT_TYPES } = require('./funnelEventConstants');

const MAIN_FUNNEL_STEPS = Object.freeze([
  {
    eventType: 'property_view',
    label: 'Property view',
    source: 'client',
    matchEventTypes: MAIN_FUNNEL_STAGE_EVENT_TYPES.property_view
  },
  {
    eventType: 'confirm_page_view',
    label: 'Checkout intent',
    source: 'client',
    matchEventTypes: MAIN_FUNNEL_STAGE_EVENT_TYPES.checkout_intent
  },
  {
    eventType: 'quote_received',
    label: 'Quote',
    source: 'server',
    matchEventTypes: MAIN_FUNNEL_STAGE_EVENT_TYPES.quote
  },
  {
    eventType: 'checkout_started',
    label: 'Checkout',
    source: 'server',
    matchEventTypes: MAIN_FUNNEL_STAGE_EVENT_TYPES.checkout
  },
  {
    eventType: 'booking_converted',
    label: 'Booking confirmed',
    source: 'server',
    matchEventTypes: MAIN_FUNNEL_STAGE_EVENT_TYPES.booking_confirmed
  }
]);

const MAX_RANGE_DAYS = 180;

const SEARCH_RESULTS_NOTE =
  'Search results are site-wide and not included in Cabin/Valley drop-off. Entity filters never apply.';

const PRIMARY_EXCLUSION = {
  isInternalTraffic: { $ne: true },
  isBotTraffic: { $ne: true },
  isTestTraffic: { $ne: true }
};

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

function buildZoneMatch({ eventTypes, propertyKind, range, entity }) {
  const types = Array.isArray(eventTypes) ? eventTypes : [eventTypes];
  const match = {
    eventType: types.length === 1 ? types[0] : { $in: types },
    propertyKind,
    createdAt: { $gte: range.start, $lt: range.endExclusive },
    ...PRIMARY_EXCLUSION
  };
  if (entity?.cabinId) {
    match.cabinId = entity.cabinId;
  }
  if (entity?.cabinTypeId) {
    match.cabinTypeId = entity.cabinTypeId;
  }
  return match;
}

async function countIdentifiedStep({ eventTypes, propertyKind, range, entity }) {
  const match = {
    ...buildZoneMatch({ eventTypes, propertyKind, range, entity }),
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

async function countOrphanEvents({ eventTypes, propertyKind, range, prefixes, entity }) {
  const match = {
    ...buildZoneMatch({ eventTypes, propertyKind, range, entity }),
    dedupeKey: { $regex: `^(${prefixes.join('|')}):orphan:` }
  };
  return BookingFunnelEvent.countDocuments(match);
}

async function countSearchResultsSupplementary({ range }) {
  const match = {
    eventType: { $in: ['search_results', 'search_results_viewed'] },
    createdAt: { $gte: range.start, $lt: range.endExclusive },
    sessionKey: { $type: 'string' },
    ...PRIMARY_EXCLUSION
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
    buildZoneMatch({
      eventTypes: ['quote_failed', 'pricing_error'],
      propertyKind,
      range,
      entity
    })
  )
    .select('quoteFailureClass dedupeKey errorClass')
    .lean();

  const byClass = {};
  let orphanEventCount = 0;
  for (const event of events) {
    const cls = event.quoteFailureClass || event.errorClass || 'unknown';
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

function eventMatchesTypes(event, types) {
  return types.includes(event.eventType) || types.includes(event.canonicalEventName);
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
    timeline.sort((a, b) => {
      const ta = new Date(a.occurredAt || a.receivedAt || a.createdAt).getTime();
      const tb = new Date(b.occurredAt || b.receivedAt || b.createdAt).getTime();
      if (ta !== tb) return ta - tb;
      return String(a._id).localeCompare(String(b._id));
    });
  }
  return bySession;
}

function asTypeList(types) {
  if (Array.isArray(types)) return types;
  return [types];
}

function sessionContinuedSequential(timeline, fromTypes, toTypes) {
  const fromList = asTypeList(fromTypes);
  const toList = asTypeList(toTypes);
  const firstFrom = timeline.find((event) => eventMatchesTypes(event, fromList));
  if (!firstFrom) return false;
  const fromTime = new Date(firstFrom.occurredAt || firstFrom.createdAt).getTime();
  return timeline.some(
    (event) =>
      eventMatchesTypes(event, toList) &&
      new Date(event.occurredAt || event.createdAt).getTime() >= fromTime
  );
}

async function computeDropOff({ propertyKind, range, entity }) {
  const allTypes = MAIN_FUNNEL_STEPS.flatMap((step) => step.matchEventTypes);
  const match = {
    eventType: { $in: allTypes },
    propertyKind,
    createdAt: { $gte: range.start, $lt: range.endExclusive },
    sessionKey: { $type: 'string' },
    ...PRIMARY_EXCLUSION
  };
  if (entity?.cabinId) match.cabinId = entity.cabinId;
  if (entity?.cabinTypeId) match.cabinTypeId = entity.cabinTypeId;

  const events = await BookingFunnelEvent.find(match)
    .select('sessionKey eventType canonicalEventName createdAt occurredAt receivedAt')
    .lean();

  const sessionMap = buildSessionTimeline(events);
  const dropOff = [];

  for (let i = 0; i < MAIN_FUNNEL_STEPS.length - 1; i += 1) {
    const fromTypes = MAIN_FUNNEL_STEPS[i].matchEventTypes;
    const toTypes = MAIN_FUNNEL_STEPS[i + 1].matchEventTypes;
    let fromSessionCount = 0;
    let continuedSessionCount = 0;

    for (const timeline of sessionMap.values()) {
      if (!timeline.some((event) => eventMatchesTypes(event, fromTypes))) continue;
      fromSessionCount += 1;
      if (sessionContinuedSequential(timeline, fromTypes, toTypes)) {
        continuedSessionCount += 1;
      }
    }

    const continuationRate =
      fromSessionCount > 0 ? continuedSessionCount / fromSessionCount : null;
    const dropOffRate = continuationRate == null ? null : 1 - continuationRate;

    dropOff.push({
      from: MAIN_FUNNEL_STEPS[i].eventType,
      to: MAIN_FUNNEL_STEPS[i + 1].eventType,
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
      eventTypes: step.matchEventTypes,
      propertyKind,
      range,
      entity
    });
    const entry = {
      eventType: step.eventType,
      label: step.label,
      source: step.source,
      sessionCount: counts.sessionCount,
      eventCount: counts.eventCount
    };
    if (step.eventType === 'quote_received') {
      entry.orphanEventCount = await countOrphanEvents({
        eventTypes: step.matchEventTypes,
        propertyKind,
        range,
        prefixes: ['qr', 'qc'],
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
        'Zone funnel excludes search_results. Drop-off uses sessions that reached step N and also reached step N+1 in order within the period. Legacy and canonical event names are aggregated together.',
      propertyKindFilterNote: 'Main funnel steps are filtered by propertyKind.',
      entityFilterNote:
        'Optional cabinId/cabinTypeId scope zone funnel and quote_failed only. unitId is not supported. search_results remain site-wide.',
      consentNote:
        'Client steps require analytics consent. Server quote/conversion events may lack sessionKey when consent declined (identitySuppressed).',
      checkoutStartedNote:
        'checkout_started counts server-verified checkout initialization. Client checkout_ui_started / legacy confirm_page_view map to checkout intent.',
      searchResultsNote: SEARCH_RESULTS_NOTE,
      savedQuotesNote:
        'Supplementary SavedBookingQuote counts only. Not part of session-sequential funnel drop-off. Batch 4A does not send recovery messages.',
      exclusionNote:
        'Primary metrics exclude isInternalTraffic, isBotTraffic, and isTestTraffic when marked.',
      maxRangeDays: MAX_RANGE_DAYS,
      schemaVersion: 2
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
