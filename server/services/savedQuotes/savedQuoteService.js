'use strict';

const mongoose = require('mongoose');
const SavedBookingQuote = require('../../models/SavedBookingQuote');
const { QUOTE_TTL_MS } = require('./savedQuoteConstants');
const { buildQuoteFingerprint, resolveIdentitySegment } = require('./savedQuoteFingerprint');
const {
  buildSavedQuoteSnapshotFromQuoteResult,
  buildSavedQuoteSnapshotFromLocationQuote
} = require('./savedQuoteSnapshot');
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

function toObjectId(value) {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  const raw = String(value);
  return mongoose.Types.ObjectId.isValid(raw) ? new mongoose.Types.ObjectId(raw) : null;
}

async function persistUpsertFromSnapshot({ snapshot, reqBody = {}, sessionKey, visitorKey }) {
  if (!snapshot?.propertyKind) {
    return { skipped: true, reason: 'missing_property_kind' };
  }

  const identity = resolveIdentitySegment({ sessionKey, visitorKey });
  const analyticsConsent = Boolean(sessionKey || visitorKey);
  const fingerprint = buildQuoteFingerprint({
    propertyKind: snapshot.propertyKind,
    entityType: snapshot.entityType,
    entityId: snapshot.entityId,
    checkInDateOnly: snapshot.checkInDateOnly,
    checkOutDateOnly: snapshot.checkOutDateOnly,
    adults: snapshot.adults,
    children: snapshot.children,
    quotedTotalCents: snapshot.quotedTotalCents,
    promoCode: snapshot.pricingSnapshot?.promoCode,
    voucherCode: snapshot.pricingSnapshot?.voucherCode,
    sessionKey,
    visitorKey
  });

  const entityObjectId = toObjectId(snapshot.entityId);
  if (!entityObjectId) {
    return { skipped: true, reason: 'invalid_entity_id' };
  }

  const quotedAt = new Date();
  const expiresAt = computeExpiresAt(quotedAt);
  const attribution = sanitizeAttribution(reqBody.attribution || {});

  const baseDoc = {
    propertyKind: snapshot.propertyKind,
    entityType: snapshot.entityType,
    entityId: entityObjectId,
    locationKey: snapshot.locationKey || null,
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
    quoteDeliveryRequested: false,
    bookingReminderConsent: false,
    transactionalContinuationEligible: false,
    quotedAt,
    expiresAt,
    attribution,
    isTest: false,
    status: 'quoted',
    schemaVersion: snapshot.schemaVersion
  };

  if (identity.hasBrowserIdentity) {
    const existing = await SavedBookingQuote.findOne({ quoteFingerprint: fingerprint }).lean();
    if (existing?.status === 'converted' || existing?.bookingId || existing?.locationBookingId) {
      return { skipped: true, reason: 'already_converted', savedQuoteId: String(existing._id) };
    }

    const eligibility = await evaluateRecoveryEligibility({
      ...existing,
      ...baseDoc,
      status: existing?.checkoutId ? 'checkout_started' : 'quoted'
    });

    const updated = await SavedBookingQuote.findOneAndUpdate(
      { quoteFingerprint: fingerprint },
      {
        $set: {
          ...baseDoc,
          recoveryEligibility: eligibility,
          ...(existing?.checkoutId
            ? {
                checkoutId: existing.checkoutId,
                checkoutSessionId: existing.checkoutSessionId,
                checkoutStartedAt: existing.checkoutStartedAt,
                checkoutExpiresAt: existing.checkoutExpiresAt,
                status: 'checkout_started'
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

  const eligibility = await evaluateRecoveryEligibility(baseDoc);
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

async function upsertSavedQuoteFromSuccessfulQuote({ req, result }) {
  if (!result?.ok || !result.entity) {
    return { skipped: true, reason: 'invalid_quote_result' };
  }
  const body = req?.body || {};
  const snapshot = buildSavedQuoteSnapshotFromQuoteResult(result, body);
  return persistUpsertFromSnapshot({
    snapshot,
    reqBody: body,
    sessionKey: sanitizeKey(body.funnelSessionKey),
    visitorKey: sanitizeKey(body.funnelVisitorKey)
  });
}

async function upsertSavedQuoteFromLocationQuote({ req, quote }) {
  if (!quote?.available) {
    return { skipped: true, reason: 'location_unavailable' };
  }
  const body = req?.body || {};
  const snapshot = buildSavedQuoteSnapshotFromLocationQuote(quote, body);
  if (!snapshot) return { skipped: true, reason: 'invalid_location_quote' };
  return persistUpsertFromSnapshot({
    snapshot,
    reqBody: body,
    sessionKey: sanitizeKey(body.funnelSessionKey),
    visitorKey: sanitizeKey(body.funnelVisitorKey)
  });
}

async function linkSavedQuoteToCheckout({
  checkoutId,
  checkoutSessionId = null,
  checkoutExpiresAt = null,
  sessionKey = null,
  visitorKey = null,
  cabinId = null,
  cabinTypeId = null,
  locationKey = null,
  checkInDateOnly = null,
  checkOutDateOnly = null,
  adults = null,
  children = null,
  quotedTotalCents = null,
  guestEmail = null
}) {
  if (!checkoutId) return { skipped: true, reason: 'missing_checkout_id' };

  const emailNormalized = normalizeEmail(guestEmail);
  const query = {
    status: { $in: ['quoted', 'checkout_started'] },
    bookingId: null,
    locationBookingId: null
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
  if (locationKey && checkInDateOnly && checkOutDateOnly) {
    or.push({
      locationKey: String(locationKey),
      entityType: 'location',
      checkInDateOnly,
      checkOutDateOnly,
      ...(adults != null ? { adults: Number(adults) } : {}),
      ...(children != null ? { children: Number(children) } : {}),
      ...(quotedTotalCents != null ? { quotedTotalCents: Number(quotedTotalCents) } : {})
    });
  }
  if (!or.length) return { skipped: true, reason: 'insufficient_link_keys' };
  query.$or = or;

  // Prefer the most recent open quote; repeated checkout reuses rather than duplicating.
  const doc = await SavedBookingQuote.findOne(query).sort({ quotedAt: -1 });
  if (!doc) return { skipped: true, reason: 'no_matching_saved_quote' };

  // If another open quote already owns this checkoutId, keep the newer commercial link
  // and supersede older siblings for the same stay+identity (audit retained).
  if (doc.checkoutId && doc.checkoutId !== String(checkoutId)) {
    // Multiple checkout attempts: keep history on this record; update to latest checkout.
  }

  doc.checkoutId = String(checkoutId);
  if (checkoutSessionId && mongoose.Types.ObjectId.isValid(String(checkoutSessionId))) {
    doc.checkoutSessionId = checkoutSessionId;
  }
  if (checkoutExpiresAt) doc.checkoutExpiresAt = new Date(checkoutExpiresAt);
  doc.checkoutStartedAt = doc.checkoutStartedAt || new Date();
  if (doc.status !== 'converted') doc.status = 'checkout_started';
  if (emailNormalized) {
    doc.email = emailNormalized;
    doc.emailNormalized = emailNormalized;
    doc.isTest = doc.isTest || isFixtureEmail(emailNormalized);
  }
  doc.recoveryEligibility = await evaluateRecoveryEligibility(doc);
  await doc.save();

  // Supersede older open quotes for same identity + stay (retain audit rows).
  if (doc.sessionKey || doc.visitorKey || doc.emailNormalized || doc.locationKey) {
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
    if (doc.locationKey) {
      supersedeQuery.$or.push({ locationKey: doc.locationKey, entityType: 'location' });
    }
    if (supersedeQuery.$or.length) {
      await SavedBookingQuote.updateMany(supersedeQuery, {
        $set: {
          status: 'superseded',
          supersededAt: new Date(),
          'recoveryEligibility.eligible': false,
          'recoveryEligibility.reason': 'already_converted',
          'recoveryEligibility.evaluatedAt': new Date()
        }
      });
    }
  }

  return { skipped: false, savedQuoteId: String(doc._id) };
}

async function markSavedQuoteConverted({
  bookingId = null,
  locationBookingId = null,
  checkoutId = null,
  sessionKey = null,
  visitorKey = null,
  guestEmail = null,
  cabinId = null,
  cabinTypeId = null,
  locationKey = null,
  checkInDateOnly = null,
  checkOutDateOnly = null
}) {
  if (!bookingId && !locationBookingId) {
    return { skipped: true, reason: 'missing_booking_id' };
  }

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
  if (locationKey && checkInDateOnly && checkOutDateOnly) {
    or.push({ locationKey: String(locationKey), entityType: 'location', checkInDateOnly, checkOutDateOnly });
  }
  if (!or.length) return { skipped: true, reason: 'insufficient_link_keys' };
  query.$or = or;

  const doc = await SavedBookingQuote.findOne(query).sort({ quotedAt: -1 });
  if (!doc) return { skipped: true, reason: 'no_matching_saved_quote' };

  if (bookingId) doc.bookingId = bookingId;
  if (locationBookingId) doc.locationBookingId = locationBookingId;
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
  doc.recoveryEligibility = await evaluateRecoveryEligibility(doc);
  await doc.save();

  try {
    const {
      cancelUnsentDeliveriesForQuote
    } = require('./recoveryPreparationService');
    await cancelUnsentDeliveriesForQuote(doc._id, 'converted');
  } catch (err) {
    console.error('[saved-quote] cancel unsent deliveries failed', {
      message: err?.message || String(err)
    });
  }

  // One converted booking suppresses all related abandoned quotes for the journey.
  const suppressRelated = {
    _id: { $ne: doc._id },
    status: { $in: ['quoted', 'checkout_started', 'expired', 'superseded'] },
    propertyKind: doc.propertyKind,
    checkInDateOnly: doc.checkInDateOnly,
    checkOutDateOnly: doc.checkOutDateOnly,
    $or: []
  };
  if (doc.sessionKey) suppressRelated.$or.push({ sessionKey: doc.sessionKey });
  if (doc.visitorKey) suppressRelated.$or.push({ visitorKey: doc.visitorKey });
  if (doc.emailNormalized) suppressRelated.$or.push({ emailNormalized: doc.emailNormalized });
  if (doc.locationKey) {
    suppressRelated.$or.push({ locationKey: doc.locationKey, entityType: 'location' });
  }
  if (doc.cabinId) suppressRelated.$or.push({ cabinId: doc.cabinId });
  if (doc.cabinTypeId) suppressRelated.$or.push({ cabinTypeId: doc.cabinTypeId });

  if (suppressRelated.$or.length) {
    await SavedBookingQuote.updateMany(suppressRelated, {
      $set: {
        status: 'superseded',
        supersededAt: new Date(),
        'recoveryState.suppressedAt': new Date(),
        'recoveryState.suppressionReason': 'converted',
        'recoveryEligibility.eligible': false,
        'recoveryEligibility.reason': 'already_converted',
        'recoveryEligibility.evaluatedAt': new Date()
      }
    });
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
  upsertSavedQuoteFromLocationQuote,
  linkSavedQuoteToCheckout,
  markSavedQuoteConverted,
  scheduleSavedQuoteTask,
  computeExpiresAt,
  resolveDisplayStatus,
  evaluateRecoveryEligibility,
  normalizeEmail
};
