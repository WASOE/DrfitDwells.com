'use strict';

const mongoose = require('mongoose');
const SavedBookingQuote = require('../../models/SavedBookingQuote');
const { QUOTE_TTL_MS } = require('./savedQuoteConstants');
const { buildQuoteFingerprint, resolveIdentitySegment } = require('./savedQuoteFingerprint');
const { buildSavedQuoteSnapshotFromQuoteResult } = require('./savedQuoteSnapshot');
const {
  evaluateRecoveryEligibility,
  normalizeEmail,
  resolveDisplayStatus
} = require('./recoveryEligibilityService');

function sanitizeKey(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw || raw.length > 128) return null;
  return raw;
}

function sanitizeAttribution(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const pick = (key) => {
    const value = raw[key];
    if (value == null) return null;
    const text = String(value).trim().slice(0, 120);
    return text || null;
  };
  return {
    source: pick('utmSource') || pick('source'),
    medium: pick('utmMedium') || pick('medium'),
    campaign: pick('utmCampaign') || pick('campaign')
  };
}

function computeExpiresAt(quotedAt = new Date()) {
  return new Date(quotedAt.getTime() + QUOTE_TTL_MS);
}

function isFixtureEmail(email) {
  const value = normalizeEmail(email);
  if (!value) return false;
  return value.endsWith('@example.com') || value.includes('+fixture') || value.includes('test+');
}

/**
 * Fire-and-forget safe: never throws to caller of booking flow.
 */
async function upsertSavedQuoteFromSuccessfulQuote({ req, result }) {
  if (!result?.ok || !result.entity) {
    return { skipped: true, reason: 'invalid_quote_result' };
  }

  const body = req?.body || {};
  const snapshot = buildSavedQuoteSnapshotFromQuoteResult(result, body);
  if (!snapshot.propertyKind) {
    return { skipped: true, reason: 'missing_property_kind' };
  }

  const sessionKey = sanitizeKey(body.funnelSessionKey);
  const visitorKey = sanitizeKey(body.funnelVisitorKey);
  const identity = resolveIdentitySegment({ sessionKey, visitorKey });
  const analyticsConsent = Boolean(sessionKey || visitorKey);

  const fingerprint = buildQuoteFingerprint({
    propertyKind: snapshot.propertyKind,
    entityType: snapshot.entityType === 'cabin_type' ? 'cabin_type' : 'cabin',
    entityId: snapshot.entityId,
    checkInDateOnly: snapshot.checkInDateOnly,
    checkOutDateOnly: snapshot.checkOutDateOnly,
    adults: snapshot.adults,
    children: snapshot.children,
    quotedTotalCents: snapshot.quotedTotalCents,
    promoCode: snapshot.pricingSnapshot.promoCode,
    voucherCode: snapshot.pricingSnapshot.voucherCode,
    sessionKey,
    visitorKey
  });

  const toObjectId = (value) => {
    if (!value) return null;
    const raw = String(value);
    return mongoose.Types.ObjectId.isValid(raw) ? new mongoose.Types.ObjectId(raw) : null;
  };

  const entityObjectId = toObjectId(snapshot.entityId);
  if (!entityObjectId) {
    return { skipped: true, reason: 'invalid_entity_id' };
  }

  const quotedAt = new Date();
  const expiresAt = computeExpiresAt(quotedAt);
  const attribution = sanitizeAttribution(body.attribution || {});

  const baseDoc = {
    propertyKind: snapshot.propertyKind,
    entityType: snapshot.entityType,
    entityId: entityObjectId,
    cabinId: toObjectId(snapshot.cabinId),
    cabinTypeId: toObjectId(snapshot.cabinTypeId),
    unitId: toObjectId(snapshot.unitId),
    checkIn: snapshot.checkIn,
    checkOut: snapshot.checkOut,
    checkInDateOnly: snapshot.checkInDateOnly,
    checkOutDateOnly: snapshot.checkOutDateOnly,
    adults: snapshot.adults,
    children: snapshot.children,
    quotedTotalCents: snapshot.quotedTotalCents,
    currency: snapshot.currency,
    pricingSnapshot: snapshot.pricingSnapshot,
    quoteFingerprint: fingerprint,
    sessionKey: sessionKey || null,
    visitorKey: visitorKey || null,
    analyticsConsent,
    marketingConsent: false,
    transactionalContinuationEligible: false,
    quotedAt,
    expiresAt,
    attribution,
    isTest: false,
    status: 'quoted'
  };

  if (identity.hasBrowserIdentity) {
    const existing = await SavedBookingQuote.findOne({ quoteFingerprint: fingerprint }).lean();
    if (existing?.status === 'converted' || existing?.bookingId) {
      return { skipped: true, reason: 'already_converted', savedQuoteId: String(existing._id) };
    }

    const eligibility = evaluateRecoveryEligibility({ ...existing, ...baseDoc, status: 'quoted' });
    const updated = await SavedBookingQuote.findOneAndUpdate(
      { quoteFingerprint: fingerprint },
      {
        $set: {
          ...baseDoc,
          recoveryEligibility: eligibility,
          // Keep prior checkout/booking links if present and not converted.
          ...(existing?.checkoutId
            ? {
                checkoutId: existing.checkoutId,
                checkoutSessionId: existing.checkoutSessionId,
                checkoutStartedAt: existing.checkoutStartedAt,
                status: existing.checkoutId ? 'checkout_started' : 'quoted'
              }
            : {})
        },
        $setOnInsert: {
          recoveryState: { sendCount: 0 }
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return {
      skipped: false,
      upserted: true,
      savedQuoteId: String(updated._id),
      fingerprint
    };
  }

  // Anonymous: insert only (never merge strangers).
  const eligibility = evaluateRecoveryEligibility(baseDoc);
  const created = await SavedBookingQuote.create({
    ...baseDoc,
    recoveryEligibility: eligibility,
    recoveryState: { sendCount: 0 }
  });

  return {
    skipped: false,
    created: true,
    savedQuoteId: String(created._id),
    fingerprint
  };
}

async function linkSavedQuoteToCheckout({
  checkoutId,
  checkoutSessionId,
  sessionKey = null,
  visitorKey = null,
  cabinId = null,
  cabinTypeId = null,
  checkInDateOnly = null,
  checkOutDateOnly = null,
  adults = null,
  children = null,
  quotedTotalCents = null,
  guestEmail = null
}) {
  if (!checkoutId) return { skipped: true, reason: 'missing_checkout_id' };

  const emailNormalized = normalizeEmail(guestEmail);
  const query = { status: { $in: ['quoted', 'checkout_started'] }, bookingId: null };

  const toObjectId = (value) => {
    if (!value) return null;
    const raw = String(value);
    return mongoose.Types.ObjectId.isValid(raw) ? new mongoose.Types.ObjectId(raw) : null;
  };
  const cabinObjectId = toObjectId(cabinId);
  const cabinTypeObjectId = toObjectId(cabinTypeId);

  const or = [];
  if (sessionKey) or.push({ sessionKey: String(sessionKey) });
  if (visitorKey) or.push({ visitorKey: String(visitorKey) });
  if (cabinObjectId && checkInDateOnly && checkOutDateOnly) {
    or.push({
      cabinId: cabinObjectId,
      checkInDateOnly,
      checkOutDateOnly,
      ...(adults != null ? { adults: Number(adults) } : {}),
      ...(children != null ? { children: Number(children) } : {}),
      ...(quotedTotalCents != null ? { quotedTotalCents: Number(quotedTotalCents) } : {})
    });
  }
  if (cabinTypeObjectId && checkInDateOnly && checkOutDateOnly) {
    or.push({
      cabinTypeId: cabinTypeObjectId,
      checkInDateOnly,
      checkOutDateOnly,
      ...(adults != null ? { adults: Number(adults) } : {}),
      ...(children != null ? { children: Number(children) } : {}),
      ...(quotedTotalCents != null ? { quotedTotalCents: Number(quotedTotalCents) } : {})
    });
  }
  if (!or.length) return { skipped: true, reason: 'insufficient_link_keys' };
  query.$or = or;

  const doc = await SavedBookingQuote.findOne(query).sort({ quotedAt: -1 });
  if (!doc) return { skipped: true, reason: 'no_matching_saved_quote' };

  doc.checkoutId = String(checkoutId);
  doc.checkoutSessionId = checkoutSessionId || doc.checkoutSessionId;
  doc.checkoutStartedAt = doc.checkoutStartedAt || new Date();
  if (doc.status !== 'converted') doc.status = 'checkout_started';
  if (emailNormalized) {
    doc.email = emailNormalized;
    doc.emailNormalized = emailNormalized;
    doc.isTest = doc.isTest || isFixtureEmail(emailNormalized);
  }
  doc.recoveryEligibility = evaluateRecoveryEligibility(doc);
  await doc.save();

  return { skipped: false, savedQuoteId: String(doc._id) };
}

async function markSavedQuoteConverted({
  bookingId,
  checkoutId = null,
  sessionKey = null,
  visitorKey = null,
  guestEmail = null,
  cabinId = null,
  cabinTypeId = null,
  checkInDateOnly = null,
  checkOutDateOnly = null
}) {
  if (!bookingId) return { skipped: true, reason: 'missing_booking_id' };

  const emailNormalized = normalizeEmail(guestEmail);
  const query = { status: { $ne: 'converted' } };
  const or = [];
  if (checkoutId) or.push({ checkoutId: String(checkoutId) });
  if (sessionKey) or.push({ sessionKey: String(sessionKey) });
  if (visitorKey) or.push({ visitorKey: String(visitorKey) });
  if (cabinId && checkInDateOnly && checkOutDateOnly) {
    or.push({ cabinId, checkInDateOnly, checkOutDateOnly });
  }
  if (cabinTypeId && checkInDateOnly && checkOutDateOnly) {
    or.push({ cabinTypeId, checkInDateOnly, checkOutDateOnly });
  }
  if (!or.length) return { skipped: true, reason: 'insufficient_link_keys' };
  query.$or = or;

  const doc = await SavedBookingQuote.findOne(query).sort({ quotedAt: -1 });
  if (!doc) return { skipped: true, reason: 'no_matching_saved_quote' };

  doc.bookingId = bookingId;
  doc.status = 'converted';
  doc.convertedAt = new Date();
  if (checkoutId) doc.checkoutId = String(checkoutId);
  if (emailNormalized) {
    doc.email = emailNormalized;
    doc.emailNormalized = emailNormalized;
  }
  doc.recoveryState = {
    ...(doc.recoveryState?.toObject?.() || doc.recoveryState || {}),
    suppressedAt: new Date(),
    suppressionReason: 'converted'
  };
  doc.recoveryEligibility = evaluateRecoveryEligibility(doc);
  await doc.save();

  // Supersede other open quotes for same identity + stay.
  if (doc.sessionKey || doc.visitorKey || doc.emailNormalized) {
    const supersedeQuery = {
      _id: { $ne: doc._id },
      status: { $in: ['quoted', 'checkout_started'] },
      checkInDateOnly: doc.checkInDateOnly,
      checkOutDateOnly: doc.checkOutDateOnly,
      propertyKind: doc.propertyKind,
      $or: []
    };
    if (doc.sessionKey) supersedeQuery.$or.push({ sessionKey: doc.sessionKey });
    if (doc.visitorKey) supersedeQuery.$or.push({ visitorKey: doc.visitorKey });
    if (doc.emailNormalized) supersedeQuery.$or.push({ emailNormalized: doc.emailNormalized });
    if (supersedeQuery.$or.length) {
      await SavedBookingQuote.updateMany(supersedeQuery, {
        $set: {
          status: 'superseded',
          'recoveryEligibility.eligible': false,
          'recoveryEligibility.reason': 'already_converted',
          'recoveryEligibility.evaluatedAt': new Date()
        }
      });
    }
  }

  return { skipped: false, savedQuoteId: String(doc._id) };
}

function scheduleSavedQuoteTask(label, promiseFactory) {
  void Promise.resolve()
    .then(promiseFactory)
    .catch((err) => {
      console.error(`[saved-quote] ${label} failed`, {
        message: err?.message || String(err)
      });
    });
}

module.exports = {
  upsertSavedQuoteFromSuccessfulQuote,
  linkSavedQuoteToCheckout,
  markSavedQuoteConverted,
  scheduleSavedQuoteTask,
  computeExpiresAt,
  resolveDisplayStatus,
  evaluateRecoveryEligibility,
  normalizeEmail
};
