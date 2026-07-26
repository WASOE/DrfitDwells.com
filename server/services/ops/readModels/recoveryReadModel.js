'use strict';

const mongoose = require('mongoose');
const SavedBookingQuote = require('../../../models/SavedBookingQuote');
const CheckoutSession = require('../../../models/CheckoutSession');
const { buildInclusiveDateRange } = require('../reporting/reportingFilters');
const { isAllowedPropertyKind } = require('../reporting/propertyKindJoin');
const { validateConversionEntityFilters } = require('../reporting/entityFilterValidation');
const {
  evaluateRecoveryEligibility,
  resolveDisplayStatus
} = require('../../savedQuotes/recoveryEligibilityService');

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

function consentBasisLabel(doc) {
  if (doc.marketingConsent) return 'marketing';
  if (doc.transactionalContinuationEligible) return 'transactional_continuation';
  if (doc.emailNormalized || doc.email) return 'email_present_no_send_basis';
  return 'none';
}

function mapRecoveryListRow(doc, now = new Date()) {
  const eligibility = evaluateRecoveryEligibility(doc, { now });
  const status = resolveDisplayStatus(doc, now);
  return {
    savedQuoteId: String(doc._id),
    propertyKind: doc.propertyKind,
    entityType: doc.entityType,
    entityId: String(doc.entityId),
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
    convertedAt: doc.convertedAt || null,
    hasEmail: Boolean(doc.emailNormalized || doc.email),
    emailMasked: maskEmail(doc.emailNormalized || doc.email),
    consentBasis: consentBasisLabel(doc),
    recoveryEligible: eligibility.eligible,
    recoveryEligibilityReason: eligibility.reason,
    recoverySendCount: Number(doc.recoveryState?.sendCount || 0),
    bookingId: doc.bookingId ? String(doc.bookingId) : null,
    detailHref: `/ops/conversion/recovery/${doc._id}`
  };
}

async function listRecoveryQuotes({
  propertyKind,
  from,
  to,
  status = null,
  eligibility = null,
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

  const match = {
    propertyKind,
    isTest: { $ne: true },
    quotedAt: { $gte: range.start, $lt: range.endExclusive }
  };
  if (entity.cabinId) match.cabinId = entity.cabinId;
  if (entity.cabinTypeId) match.cabinTypeId = entity.cabinTypeId;

  // Load a bounded window then filter derived status/eligibility in memory.
  // Cap scan to pagination depth * 20 to avoid unbounded loads.
  const scanLimit = Math.min(2000, pagination.page * pagination.limit * 20);
  const docs = await SavedBookingQuote.find(match)
    .sort({ quotedAt: -1 })
    .limit(scanLimit)
    .lean();

  const filtered = [];
  for (const doc of docs) {
    const row = mapRecoveryListRow(doc, now);
    if (status && row.status !== status) continue;
    if (eligibility && row.recoveryEligibilityReason !== eligibility) continue;
    filtered.push(row);
  }

  const total = filtered.length;
  const skip = (pagination.page - 1) * pagination.limit;
  const rows = filtered.slice(skip, skip + pagination.limit);

  return {
    propertyKind,
    period: { from: String(from).slice(0, 10), to: String(to).slice(0, 10) },
    filters: {
      status: status || null,
      eligibility: eligibility || null,
      cabinId: entity.cabinId ? String(entity.cabinId) : null,
      cabinTypeId: entity.cabinTypeId ? String(entity.cabinTypeId) : null
    },
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      hasMore: skip + rows.length < total
    },
    rows,
    provenance: {
      computedAt: now.toISOString(),
      notice:
        'Recovery eligibility does not guarantee that a message may legally be sent. Automated sending is not enabled in this batch.',
      noSend: true,
      listOmitsRawEmail: true,
      listOmitsSessionKeys: true
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
  const eligibility = evaluateRecoveryEligibility(doc, { now });
  let checkoutExpiresAt = null;
  if (doc.checkoutSessionId) {
    const session = await CheckoutSession.findById(doc.checkoutSessionId).select('expiresAt').lean();
    checkoutExpiresAt = session?.expiresAt || null;
  }

  return {
    savedQuoteId: String(doc._id),
    propertyKind: doc.propertyKind,
    entityType: doc.entityType,
    entityId: String(doc.entityId),
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
    convertedAt: doc.convertedAt,
    checkoutId: doc.checkoutId,
    checkoutExpiresAt,
    bookingId: doc.bookingId ? String(doc.bookingId) : null,
    email: doc.emailNormalized || doc.email || null,
    hasEmail: Boolean(doc.emailNormalized || doc.email),
    analyticsConsent: doc.analyticsConsent,
    marketingConsent: doc.marketingConsent,
    transactionalContinuationEligible: doc.transactionalContinuationEligible,
    consentBasis: consentBasisLabel(doc),
    recoveryEligible: eligibility.eligible,
    recoveryEligibilityReason: eligibility.reason,
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
        'Recovery eligibility does not guarantee that a message may legally be sent. Automated sending is not enabled in this batch.',
      noSend: true,
      sessionKeyOmitted: true,
      visitorKeyOmitted: true
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
      'status bookingId checkoutId expiresAt email emailNormalized marketingConsent transactionalContinuationEligible recoveryState quotedTotalCents isTest'
    )
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
    const eligibility = evaluateRecoveryEligibility(doc, { now });
    if (eligibility.eligible) recoveryEligible += 1;
  }

  return {
    savedValidQuotes,
    checkoutStartedSavedQuotes: checkoutStarted,
    convertedSavedQuotes: converted,
    abandonedSavedQuotes: abandoned,
    recoveryEligibleJourneys: recoveryEligible,
    note: 'Supplementary saved-quote counts. Not part of session-sequential funnel drop-off. Batch 4A does not send recovery messages.'
  };
}

module.exports = {
  listRecoveryQuotes,
  getRecoveryQuoteDetail,
  aggregateRecoverySupplementaryCounts,
  mapRecoveryListRow,
  maskEmail
};
