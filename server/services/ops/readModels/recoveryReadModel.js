'use strict';

const mongoose = require('mongoose');
const SavedBookingQuote = require('../../../models/SavedBookingQuote');
const CheckoutSession = require('../../../models/CheckoutSession');
const QuoteContactConsentEvent = require('../../../models/QuoteContactConsentEvent');
const RecoveryMessageDelivery = require('../../../models/RecoveryMessageDelivery');
const { buildInclusiveDateRange } = require('../reporting/reportingFilters');
const { isAllowedPropertyKind } = require('../reporting/propertyKindJoin');
const { validateConversionEntityFilters } = require('../reporting/entityFilterValidation');
const {
  evaluateRecoveryEligibility,
  resolveDisplayStatus,
  isCheckoutExpired
} = require('../../savedQuotes/recoveryEligibilityService');
const { resolveGuestContactStatus } = require('../../savedQuotes/contactPreferenceResolutionService');

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function maskEmail(email) {
  if (!email) return null;
  const value = String(email).trim().toLowerCase();
  const at = value.indexOf('@');
  if (at <= 0) return '***';
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

function parsePagination({ page, limit }) {
  const parsedPage = page == null || page === '' ? 1 : Number.parseInt(String(page), 10);
  const parsedLimit = limit == null || limit === '' ? 50 : Number.parseInt(String(limit), 10);
  if (!Number.isFinite(parsedPage) || parsedPage < 1) throw badRequest('page must be a positive integer');
  if (!Number.isFinite(parsedLimit) || parsedLimit < 1) throw badRequest('limit must be a positive integer');
  if (parsedLimit > 100) throw badRequest('limit cannot exceed 100');
  return { page: parsedPage, limit: parsedLimit };
}

function parseBoolFilter(value) {
  if (value == null || value === '') return null;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  throw badRequest('Boolean filter must be true or false');
}

function consentBasisLabel(doc, effective) {
  if (effective?.globallySuppressed) return 'globally_suppressed';
  if (effective?.bookingReminderAllowed || doc.bookingReminderConsent) return 'booking_reminder';
  if (effective?.quoteDeliveryAllowed || doc.quoteDeliveryRequested) return 'quote_delivery';
  if (effective?.marketingAllowed || doc.marketingConsent) return 'marketing';
  if (doc.emailNormalized || doc.email) return 'email_present_no_send_basis';
  return 'none';
}

async function mapRecoveryListRow(doc, now = new Date()) {
  const contactStatus = doc.emailNormalized
    ? await resolveGuestContactStatus(doc.emailNormalized, { now })
    : null;
  const eligibility = await evaluateRecoveryEligibility(doc, { now, contactStatus });
  const status = resolveDisplayStatus(doc, now);
  return {
    savedQuoteId: String(doc._id),
    propertyKind: doc.propertyKind,
    entityType: doc.entityType,
    entityId: String(doc.entityId),
    locationKey: doc.locationKey || null,
    cabinId: doc.cabinId ? String(doc.cabinId) : null,
    cabinTypeId: doc.cabinTypeId ? String(doc.cabinTypeId) : null,
    checkIn: doc.checkInDateOnly,
    checkOut: doc.checkOutDateOnly,
    adults: doc.adults,
    children: doc.children,
    quotedTotalCents: doc.quotedTotalCents,
    currency: doc.currency || 'EUR',
    status,
    quotedAt: doc.quotedAt,
    expiresAt: doc.expiresAt,
    checkoutStartedAt: doc.checkoutStartedAt || null,
    checkoutExpiresAt: doc.checkoutExpiresAt || null,
    checkoutExpired: isCheckoutExpired(doc, now),
    quoteExpired: status === 'expired',
    convertedAt: doc.convertedAt || null,
    hasEmail: Boolean(doc.emailNormalized || doc.email),
    emailMasked: maskEmail(doc.emailNormalized || doc.email),
    consentBasis: consentBasisLabel(doc, contactStatus),
    consentSnapshot: {
      quoteDeliveryRequested: Boolean(doc.quoteDeliveryRequested || doc.consentSnapshot?.quoteDeliveryRequested),
      bookingReminderConsent: Boolean(
        doc.bookingReminderConsent || doc.consentSnapshot?.bookingReminderConsent
      ),
      marketingConsent: Boolean(doc.marketingConsent || doc.consentSnapshot?.marketingConsent),
      consentCapturedAt: doc.consentSnapshot?.consentCapturedAt || null,
      consentTextVersion: doc.consentSnapshot?.consentTextVersion || null
    },
    effectiveContactPreference: contactStatus
      ? {
          quoteDeliveryAllowed: contactStatus.quoteDeliveryAllowed,
          bookingReminderAllowed: contactStatus.bookingReminderAllowed,
          marketingAllowed: contactStatus.marketingAllowed,
          globallySuppressed: contactStatus.globallySuppressed
        }
      : {
          quoteDeliveryAllowed: false,
          bookingReminderAllowed: false,
          marketingAllowed: false,
          globallySuppressed: false
        },
    recoveryEligible: eligibility.eligible,
    recoveryEligibilityReason: eligibility.reason,
    eligibilityReason: eligibility.reason,
    recoverySendCount: Number(doc.recoveryState?.sendCount || 0),
    suppressed: Boolean(doc.recoveryState?.suppressedAt || contactStatus?.globallySuppressed),
    anonymized: Boolean(doc.anonymizedAt),
    bookingId: doc.bookingId ? String(doc.bookingId) : null,
    locationBookingId: doc.locationBookingId ? String(doc.locationBookingId) : null,
    detailHref: `/ops/conversion/recovery/${doc._id}`,
    deliveryDisabled: true
  };
}

async function listRecoveryQuotes({
  propertyKind,
  from,
  to,
  status = null,
  eligibility = null,
  consentBasis = null,
  suppressed = null,
  hasEmail = null,
  entityType = null,
  cabinId = null,
  cabinTypeId = null,
  page = 1,
  limit = 50
}) {
  if (!isAllowedPropertyKind(propertyKind)) {
    throw badRequest('propertyKind must be cabin or valley');
  }
  const range = buildInclusiveDateRange(from, to);
  if (!range) throw badRequest('Invalid from/to date range');

  const entity = await validateConversionEntityFilters({
    propertyKind,
    cabinId,
    cabinTypeId,
    unitId: null
  });
  const pagination = parsePagination({ page, limit });
  const now = new Date();
  const suppressedFilter = parseBoolFilter(suppressed);
  const hasEmailFilter = parseBoolFilter(hasEmail);

  const match = {
    propertyKind,
    isTest: { $ne: true },
    quotedAt: { $gte: range.start, $lt: range.endExclusive }
  };
  if (entity.cabinId) match.cabinId = entity.cabinId;
  if (entity.cabinTypeId) match.cabinTypeId = entity.cabinTypeId;
  if (entityType) {
    const allowed = ['cabin', 'cabin_type', 'location'];
    if (!allowed.includes(String(entityType))) {
      throw badRequest('entityType must be cabin, cabin_type, or location');
    }
    match.entityType = String(entityType);
  }

  // Persisted lifecycle status filter (exact stored status).
  // Derived display statuses expired/checkout_started may still differ; documented below.
  if (status && ['quoted', 'checkout_started', 'converted', 'superseded', 'ineligible'].includes(status)) {
    match.status = status;
  } else if (status === 'expired') {
    match.expiresAt = { $lte: now };
    match.status = { $nin: ['converted', 'superseded'] };
  }

  if (hasEmailFilter === true) {
    match.emailNormalized = { $type: 'string', $ne: '' };
  } else if (hasEmailFilter === false) {
    match.$and = (match.$and || []).concat([
      {
        $or: [{ emailNormalized: null }, { emailNormalized: { $exists: false } }, { emailNormalized: '' }]
      }
    ]);
  }

  if (suppressedFilter === true) {
    match['recoveryState.suppressedAt'] = { $ne: null };
  } else if (suppressedFilter === false) {
    match.$and = (match.$and || []).concat([
      {
        $or: [
          { 'recoveryState.suppressedAt': null },
          { 'recoveryState.suppressedAt': { $exists: false } }
        ]
      }
    ]);
  }

  if (consentBasis === 'quote_delivery') {
    match.quoteDeliveryRequested = true;
  } else if (consentBasis === 'booking_reminder') {
    match.bookingReminderConsent = true;
  } else if (consentBasis === 'marketing') {
    match.marketingConsent = true;
  } else if (consentBasis === 'none') {
    match.quoteDeliveryRequested = { $ne: true };
    match.bookingReminderConsent = { $ne: true };
    match.marketingConsent = { $ne: true };
  } else if (consentBasis) {
    throw badRequest('consentBasis must be quote_delivery, booking_reminder, marketing, or none');
  }

  const needsDerivedFill =
    Boolean(eligibility) ||
    (status === 'expired' && !match.status) ||
    (status && !['quoted', 'checkout_started', 'converted', 'superseded', 'ineligible', 'expired'].includes(status));

  const BATCH = Math.min(100, Math.max(pagination.limit * 2, 40));
  const MAX_SCAN = 2000;
  let scanned = 0;
  let matchedBeforePage = 0;
  const targetSkip = (pagination.page - 1) * pagination.limit;
  const rows = [];
  let cursorQuotedAt = null;
  let cursorId = null;
  let exhausted = false;
  let scanTruncated = false;

  const passesDerived = (row) => {
    if (eligibility && row.eligibilityReason !== eligibility) return false;
    if (status === 'expired' && row.status !== 'expired') return false;
    if (
      status &&
      status !== 'expired' &&
      !match.status &&
      row.status !== status
    ) {
      return false;
    }
    return true;
  };

  if (!needsDerivedFill && !eligibility && !(status === 'expired')) {
    // Pure persisted pagination — totals are exact for persisted filters.
    const total = await SavedBookingQuote.countDocuments(match);
    const skip = (pagination.page - 1) * pagination.limit;
    const docs = await SavedBookingQuote.find(match)
      .sort({ quotedAt: -1, _id: -1 })
      .skip(skip)
      .limit(pagination.limit)
      .lean();
    for (const doc of docs) {
      rows.push(await mapRecoveryListRow(doc, now));
    }
    return {
      propertyKind,
      period: { from: String(from).slice(0, 10), to: String(to).slice(0, 10) },
      filters: {
        status: status || null,
        eligibility: eligibility || null,
        consentBasis: consentBasis || null,
        suppressed: suppressedFilter,
        hasEmail: hasEmailFilter,
        entityType: entityType || null,
        cabinId: entity.cabinId ? String(entity.cabinId) : null,
        cabinTypeId: entity.cabinTypeId ? String(entity.cabinTypeId) : null
      },
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        returned: rows.length,
        total,
        totalBasis: 'persisted_filters',
        hasMore: skip + docs.length < total
      },
      rows,
      provenance: {
        computedAt: now.toISOString(),
        notice:
          'Recovery delivery is disabled. Previews do not send messages. Recovery eligibility does not guarantee that a message may legally be sent.',
        noSend: true,
        listOmitsRawEmail: true,
        listOmitsSessionKeys: true,
        paginationBeforeDerivedEligibility: false,
        derivedFilters: ['effective contact preference on each row'],
        persistedFilters: [
          'propertyKind',
          'quotedAt range',
          'status (stored)',
          'cabinId',
          'cabinTypeId',
          'entityType',
          'hasEmail',
          'suppressed (recoveryState)',
          'consentBasis (snapshot flags)'
        ]
      }
    };
  }

  // Derived eligibility (and similar): fill batches until page is complete or scan exhausted.
  while (rows.length < pagination.limit && scanned < MAX_SCAN) {
    const batchMatch = { ...match };
    if (cursorQuotedAt && cursorId) {
      batchMatch.$and = (batchMatch.$and || []).concat([
        {
          $or: [
            { quotedAt: { $lt: cursorQuotedAt } },
            { quotedAt: cursorQuotedAt, _id: { $lt: cursorId } }
          ]
        }
      ]);
    }
    const batch = await SavedBookingQuote.find(batchMatch)
      .sort({ quotedAt: -1, _id: -1 })
      .limit(BATCH)
      .lean();
    if (!batch.length) {
      exhausted = true;
      break;
    }
    scanned += batch.length;
    for (const doc of batch) {
      cursorQuotedAt = doc.quotedAt;
      cursorId = doc._id;
      const row = await mapRecoveryListRow(doc, now);
      if (!passesDerived(row)) continue;
      if (matchedBeforePage < targetSkip) {
        matchedBeforePage += 1;
        continue;
      }
      rows.push(row);
      if (rows.length >= pagination.limit) break;
    }
    if (batch.length < BATCH) {
      exhausted = true;
      break;
    }
  }
  if (!exhausted && scanned >= MAX_SCAN) scanTruncated = true;

  const hasMore = rows.length >= pagination.limit && (!exhausted || scanTruncated);

  return {
    propertyKind,
    period: { from: String(from).slice(0, 10), to: String(to).slice(0, 10) },
    filters: {
      status: status || null,
      eligibility: eligibility || null,
      consentBasis: consentBasis || null,
      suppressed: suppressedFilter,
      hasEmail: hasEmailFilter,
      entityType: entityType || null,
      cabinId: entity.cabinId ? String(entity.cabinId) : null,
      cabinTypeId: entity.cabinTypeId ? String(entity.cabinTypeId) : null
    },
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      returned: rows.length,
      total: null,
      totalBasis: 'derived_filters',
      hasMore,
      scanned,
      scanTruncated
    },
    rows,
    provenance: {
      computedAt: now.toISOString(),
      notice:
        'Recovery delivery is disabled. Previews do not send messages. Derived eligibility uses fill-batch pagination; total is omitted because it is not a persisted count.',
      noSend: true,
      listOmitsRawEmail: true,
      listOmitsSessionKeys: true,
      paginationBeforeDerivedEligibility: false,
      fillBatchPagination: true,
      derivedFilters: ['eligibility', 'display status nuances', 'effective contact preference'],
      persistedFilters: [
        'propertyKind',
        'quotedAt range',
        'status (stored)',
        'cabinId',
        'cabinTypeId',
        'entityType',
        'hasEmail',
        'suppressed (recoveryState)',
        'consentBasis (snapshot flags)'
      ]
    }
  };
}

async function getRecoveryQuoteDetail({ id }) {
  if (!mongoose.Types.ObjectId.isValid(String(id))) {
    const error = new Error('Invalid saved quote id');
    error.statusCode = 400;
    throw error;
  }
  const doc = await SavedBookingQuote.findById(id).lean();
  if (!doc) {
    const error = new Error('Saved quote not found');
    error.statusCode = 404;
    throw error;
  }

  const now = new Date();
  const contactStatus = doc.emailNormalized
    ? await resolveGuestContactStatus(doc.emailNormalized, { now })
    : null;
  const eligibility = await evaluateRecoveryEligibility(doc, { now, contactStatus });

  let checkoutExpiresAt = doc.checkoutExpiresAt || null;
  if (!checkoutExpiresAt && doc.checkoutSessionId) {
    const session = await CheckoutSession.findById(doc.checkoutSessionId).select('expiresAt').lean();
    checkoutExpiresAt = session?.expiresAt || null;
  }

  const consentEvents = doc.emailNormalized
    ? await QuoteContactConsentEvent.find({ emailNormalized: doc.emailNormalized })
        .sort({ capturedAt: -1 })
        .limit(20)
        .select('consentType granted textVersion textSnapshot capturedAt sourceSurface')
        .lean()
    : [];

  const deliveries = await RecoveryMessageDelivery.find({
    savedQuoteId: doc._id,
    isPreview: { $ne: true }
  })
    .sort({ createdAt: -1 })
    .limit(20)
    .select(
      'messagePurpose templateKey templateVersion status eligibilitySnapshot preparedAt scheduledFor sentAt cancelledAt cancelReason sequence idempotencyKey recipientDomain'
    )
    .lean();

  const { evaluateRecoveryDeliveryGate } = require('../../savedQuotes/recoveryDeliveryGateService');
  const quoteDeliveryGate = await evaluateRecoveryDeliveryGate({
    savedQuoteId: doc._id,
    messagePurpose: 'quote_delivery'
  });
  const reminderGate = await evaluateRecoveryDeliveryGate({
    savedQuoteId: doc._id,
    messagePurpose: 'booking_reminder'
  });

  return {
    savedQuoteId: String(doc._id),
    propertyKind: doc.propertyKind,
    entityType: doc.entityType,
    entityId: String(doc.entityId),
    locationKey: doc.locationKey || null,
    cabinId: doc.cabinId ? String(doc.cabinId) : null,
    cabinTypeId: doc.cabinTypeId ? String(doc.cabinTypeId) : null,
    checkIn: doc.checkInDateOnly,
    checkOut: doc.checkOutDateOnly,
    adults: doc.adults,
    children: doc.children,
    quotedTotalCents: doc.quotedTotalCents,
    currency: doc.currency,
    pricingSnapshot: doc.pricingSnapshot,
    status: resolveDisplayStatus(doc, now),
    quotedAt: doc.quotedAt,
    expiresAt: doc.expiresAt,
    checkoutStartedAt: doc.checkoutStartedAt,
    checkoutExpiresAt,
    checkoutExpired: isCheckoutExpired({ ...doc, checkoutExpiresAt }, now),
    convertedAt: doc.convertedAt,
    checkoutId: doc.checkoutId,
    bookingId: doc.bookingId ? String(doc.bookingId) : null,
    locationBookingId: doc.locationBookingId ? String(doc.locationBookingId) : null,
    email: doc.emailNormalized || doc.email || null,
    hasEmail: Boolean(doc.emailNormalized || doc.email),
    anonymized: Boolean(doc.anonymizedAt),
    analyticsConsent: doc.analyticsConsent,
    consentSnapshot: {
      quoteDeliveryRequested: Boolean(doc.quoteDeliveryRequested),
      bookingReminderConsent: Boolean(doc.bookingReminderConsent),
      marketingConsent: Boolean(doc.marketingConsent),
      consentCapturedAt: doc.consentSnapshot?.consentCapturedAt || null,
      consentTextVersion: doc.consentSnapshot?.consentTextVersion || null,
      quoteDeliveryTextVersion: doc.consentSnapshot?.quoteDeliveryTextVersion || null,
      bookingReminderTextVersion: doc.consentSnapshot?.bookingReminderTextVersion || null,
      marketingTextVersion: doc.consentSnapshot?.marketingTextVersion || null
    },
    effectiveContactPreference: contactStatus
      ? {
          quoteDeliveryAllowed: contactStatus.quoteDeliveryAllowed,
          bookingReminderAllowed: contactStatus.bookingReminderAllowed,
          marketingAllowed: contactStatus.marketingAllowed,
          globallySuppressed: contactStatus.globallySuppressed,
          suppressionReason: contactStatus.suppressionReason,
          source: contactStatus.source,
          effectiveAt: contactStatus.effectiveAt
        }
      : null,
    consentEvents,
    consentBasis: consentBasisLabel(doc, contactStatus),
    recoveryEligible: eligibility.eligible,
    recoveryEligibilityReason: eligibility.reason,
    eligibilityReason: eligibility.reason,
    deliveryGates: {
      quote_delivery: {
        allowed: quoteDeliveryGate.allowed,
        reason: quoteDeliveryGate.reason,
        consentBasis: quoteDeliveryGate.consentBasis
      },
      booking_reminder: {
        allowed: reminderGate.allowed,
        reason: reminderGate.reason,
        consentBasis: reminderGate.consentBasis
      }
    },
    deliveries: deliveries.map((d) => ({
      id: String(d._id),
      messagePurpose: d.messagePurpose,
      templateKey: d.templateKey,
      templateVersion: d.templateVersion,
      status: d.status,
      blockedReason: d.eligibilitySnapshot?.reason || d.cancelReason || null,
      consentBasis: d.eligibilitySnapshot?.consentBasis || null,
      preparedAt: d.preparedAt,
      scheduledFor: d.scheduledFor,
      sentAt: d.sentAt,
      cancelledAt: d.cancelledAt,
      sequence: d.sequence,
      recipientDomain: d.recipientDomain || null
    })),
    recoveryState: {
      sendCount: Number(doc.recoveryState?.sendCount || 0),
      lastSentAt: doc.recoveryState?.lastSentAt || null,
      lastMessageType: doc.recoveryState?.lastMessageType || null,
      suppressedAt: doc.recoveryState?.suppressedAt || null,
      suppressionReason: doc.recoveryState?.suppressionReason || null
    },
    attribution: doc.attribution || {},
    provenance: {
      notice:
        'Recovery delivery is disabled. Previews do not send messages. Automated sending is not enabled in this batch.',
      noSend: true,
      sessionKeyOmitted: true,
      visitorKeyOmitted: true,
      featureFlags: {
        RECOVERY_QUOTE_DELIVERY_ENABLED: false,
        RECOVERY_BOOKING_REMINDER_ENABLED: false,
        RECOVERY_EMAIL_PROVIDER_ENABLED: false,
        note: 'Defaults shown; live values read from env at gate evaluation.'
      }
    }
  };
}

async function aggregateRecoverySupplementaryCounts({ propertyKind, range, entity = null }) {
  const match = {
    propertyKind,
    isTest: { $ne: true },
    quotedAt: { $gte: range.start, $lt: range.endExclusive }
  };
  if (entity?.cabinId) match.cabinId = entity.cabinId;
  if (entity?.cabinTypeId) match.cabinTypeId = entity.cabinTypeId;

  const docs = await SavedBookingQuote.find(match)
    .select(
      'status bookingId locationBookingId checkoutId expiresAt email emailNormalized marketingConsent quoteDeliveryRequested bookingReminderConsent transactionalContinuationEligible recoveryState quotedTotalCents isTest anonymizedAt'
    )
    .sort({ quotedAt: -1 })
    .limit(5000)
    .lean();

  const now = new Date();
  let savedValidQuotes = 0;
  let checkoutStarted = 0;
  let converted = 0;
  let abandoned = 0;
  let recoveryEligible = 0;

  for (const doc of docs) {
    const status = resolveDisplayStatus(doc, now);
    if (status === 'quoted' || status === 'checkout_started' || status === 'converted') {
      savedValidQuotes += 1;
    }
    if (status === 'checkout_started') checkoutStarted += 1;
    if (status === 'converted') converted += 1;
    if (status === 'quoted' || status === 'expired') abandoned += 1;
    const eligibility = await evaluateRecoveryEligibility(doc, { now });
    if (eligibility.eligible) recoveryEligible += 1;
  }

  return {
    savedValidQuotes,
    checkoutStartedSavedQuotes: checkoutStarted,
    convertedSavedQuotes: converted,
    abandonedSavedQuotes: abandoned,
    recoveryEligibleJourneys: recoveryEligible,
    note: 'Supplementary saved-quote counts. Not part of session-sequential funnel drop-off. Batch 4A.1 does not send recovery messages.'
  };
}

module.exports = {
  listRecoveryQuotes,
  getRecoveryQuoteDetail,
  aggregateRecoverySupplementaryCounts,
  mapRecoveryListRow,
  maskEmail
};
