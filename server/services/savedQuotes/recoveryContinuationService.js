'use strict';

const crypto = require('crypto');
const RecoveryContinuationToken = require('../../models/RecoveryContinuationToken');
const SavedBookingQuote = require('../../models/SavedBookingQuote');
const Cabin = require('../../models/Cabin');
const CabinType = require('../../models/CabinType');

const TOKEN_BYTE_LENGTH = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DEFAULT_TTL_DAYS = 30;

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken), 'utf8').digest('hex');
}

function isValidTokenFormat(rawToken) {
  return typeof rawToken === 'string' && TOKEN_PATTERN.test(rawToken);
}

function getPublicAppBaseUrl() {
  const u = process.env.APP_URL || process.env.VITE_APP_URL || 'https://driftdwells.com';
  return String(u).replace(/\/$/, '');
}

function buildContinuationUrl(rawToken) {
  return `${getPublicAppBaseUrl()}/booking-continuation/${encodeURIComponent(rawToken)}`;
}

async function issueContinuationToken({ savedQuoteId, ttlDays = DEFAULT_TTL_DAYS } = {}) {
  const quote = await SavedBookingQuote.findById(savedQuoteId).lean();
  if (!quote) return { skipped: true, reason: 'missing_quote' };

  const rawToken = crypto.randomBytes(TOKEN_BYTE_LENGTH).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + Math.max(1, Number(ttlDays) || DEFAULT_TTL_DAYS) * 86400000);

  await RecoveryContinuationToken.create({
    tokenHash,
    savedQuoteId: quote._id,
    propertyKind: quote.propertyKind,
    expiresAt
  });

  return {
    skipped: false,
    rawToken,
    expiresAt,
    continuationUrl: buildContinuationUrl(rawToken),
    savedQuoteId: String(quote._id)
  };
}

async function resolveContinuationToken(rawToken, { now = new Date() } = {}) {
  if (!isValidTokenFormat(rawToken)) return { ok: false, reason: 'invalid_token' };
  const doc = await RecoveryContinuationToken.findOne({ tokenHash: hashToken(rawToken) }).lean();
  if (!doc) return { ok: false, reason: 'invalid_token' };
  if (doc.revokedAt) return { ok: false, reason: 'revoked_token' };
  if (new Date(doc.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, reason: 'expired_token' };
  }
  return { ok: true, token: doc };
}

/**
 * Resolve continuation destination. Does not create bookings or reserve inventory.
 * Returns original immutable quote snapshot for comparison.
 */
async function resolveContinuationDestination(rawToken) {
  const resolved = await resolveContinuationToken(rawToken);
  if (!resolved.ok) return resolved;

  await RecoveryContinuationToken.updateOne(
    { _id: resolved.token._id },
    { $inc: { openCount: 1 }, $set: { lastOpenedAt: new Date() } }
  );

  const quote = await SavedBookingQuote.findById(resolved.token.savedQuoteId).lean();
  if (!quote) return { ok: false, reason: 'quote_not_found' };

  let destinationPath = '/';
  let stayLabel = 'Drift & Dwells';
  let availabilityNote =
    'Availability and price are revalidated when you continue. The original quote is shown for comparison only.';

  if (quote.entityType === 'location' || quote.locationKey === 'valley') {
    destinationPath = `/retreats/the-valley?checkIn=${quote.checkInDateOnly}&checkOut=${quote.checkOutDateOnly}&adults=${quote.adults}&children=${quote.children}`;
    stayLabel = 'The Valley';
  } else if (quote.cabinId) {
    const cabin = await Cabin.findById(quote.cabinId).select('slug name').lean();
    const slug = cabin?.slug || String(quote.cabinId);
    destinationPath = `/stays/${encodeURIComponent(slug)}/confirm?checkIn=${quote.checkInDateOnly}&checkOut=${quote.checkOutDateOnly}&adults=${quote.adults}&children=${quote.children}`;
    stayLabel = cabin?.name || 'Cabin';
  } else if (quote.cabinTypeId) {
    const cabinType = await CabinType.findById(quote.cabinTypeId).select('slug name').lean();
    const slug = cabinType?.slug || String(quote.cabinTypeId);
    destinationPath = `/stays/${encodeURIComponent(slug)}/confirm?checkIn=${quote.checkInDateOnly}&checkOut=${quote.checkOutDateOnly}&adults=${quote.adults}&children=${quote.children}`;
    stayLabel = cabinType?.name || 'Stay';
  }

  // Soft availability revalidation note only — no booking mutation.
  let availabilityStatus = 'unknown';
  try {
    if (quote.entityType === 'location') {
      const { buildPublicLocationQuote } = require('../locationQuote/locationQuoteService');
      const live = await buildPublicLocationQuote(quote.locationKey || 'valley', {
        checkIn: quote.checkInDateOnly,
        checkOut: quote.checkOutDateOnly,
        adults: quote.adults,
        children: quote.children
      });
      availabilityStatus = live?.available ? 'available' : 'unavailable';
      if (live?.available && Math.round(live.totalPrice * 100) !== quote.quotedTotalCents) {
        availabilityNote =
          'Current price differs from your original quote. The original quoted total is shown for comparison and is not overwritten.';
      } else if (!live?.available) {
        availabilityNote =
          'These dates may no longer be available. Your original quote is unchanged and did not reserve inventory.';
      }
    }
  } catch {
    availabilityStatus = 'revalidation_failed';
  }

  return {
    ok: true,
    propertyKind: quote.propertyKind,
    destinationPath,
    stayLabel,
    availabilityStatus,
    availabilityNote,
    originalQuote: {
      savedQuoteId: String(quote._id),
      checkIn: quote.checkInDateOnly,
      checkOut: quote.checkOutDateOnly,
      adults: quote.adults,
      children: quote.children,
      quotedTotalCents: quote.quotedTotalCents,
      currency: quote.currency,
      expiresAt: quote.expiresAt,
      pricingSnapshot: quote.pricingSnapshot
    },
    // Explicit: never include session/visitor keys
    linkOpenRecorded: true
  };
}

module.exports = {
  issueContinuationToken,
  resolveContinuationToken,
  resolveContinuationDestination,
  buildContinuationUrl,
  hashToken,
  isValidTokenFormat
};
