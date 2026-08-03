'use strict';

const mongoose = require('mongoose');
const Booking = require('../../models/Booking');
const CheckoutSession = require('../../models/CheckoutSession');
const {
  CHECKOUT_SESSION_ERROR_CODES,
  CheckoutSessionError
} = require('./checkoutSessionErrors');
const {
  getMultiUnitPaidOrphanRecoveryContext,
  assertMultiUnitPaidOrphanRecoveryContext
} = require('./multiUnitPaidOrphanRecoveryCapability');

const BLOCKING_COMMERCIAL_STAY_BOOKING_STATUSES = ['pending', 'confirmed', 'in_house'];

const BLOCKING_COMMERCIAL_STAY_SESSION_FINALIZE_STATUSES = ['in_progress', 'finalized'];

function normalizeFingerprint(commercialStayFingerprint) {
  return String(commercialStayFingerprint || '').trim();
}

function requireCommercialStayFingerprint(commercialStayFingerprint) {
  const fp = normalizeFingerprint(commercialStayFingerprint);
  if (!fp) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.COMMERCIAL_STAY_FINGERPRINT_REQUIRED,
      'commercialStayFingerprint is required'
    );
  }
  return fp;
}

function toObjectId(value) {
  if (value == null || value === '') {
    return null;
  }
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }
  return new mongoose.Types.ObjectId(String(value));
}

/**
 * Mongo filter for blocking Booking rows with the same commercial stay fingerprint.
 */
function buildCommercialStayConflictQuery({
  commercialStayFingerprint,
  excludeCheckoutId,
  excludeBookingId
}) {
  const fp = requireCommercialStayFingerprint(commercialStayFingerprint);

  const query = {
    commercialStayFingerprint: fp,
    status: { $in: BLOCKING_COMMERCIAL_STAY_BOOKING_STATUSES },
    $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }]
  };

  const exclusions = [];
  if (excludeCheckoutId) {
    exclusions.push({ checkoutId: { $ne: String(excludeCheckoutId).trim() } });
  }
  const excludeBookingObjectId = toObjectId(excludeBookingId);
  if (excludeBookingObjectId) {
    exclusions.push({ _id: { $ne: excludeBookingObjectId } });
  }

  if (exclusions.length === 0) {
    return query;
  }
  return { $and: [query, ...exclusions] };
}

function buildSessionConflictQuery(commercialStayFingerprint, excludeCheckoutId) {
  const fp = requireCommercialStayFingerprint(commercialStayFingerprint);
  const query = {
    stayFingerprint: fp,
    finalizeStatus: { $in: BLOCKING_COMMERCIAL_STAY_SESSION_FINALIZE_STATUSES }
  };
  if (excludeCheckoutId) {
    query.checkoutId = { $ne: String(excludeCheckoutId).trim() };
  }
  return query;
}

function mapBookingConflict(doc) {
  return {
    bookingId: String(doc._id),
    checkoutId: doc.checkoutId || null,
    status: doc.status,
    createdAt: doc.createdAt,
    commercialStayFingerprint: doc.commercialStayFingerprint
  };
}

function mapSessionConflict(doc) {
  return {
    checkoutId: doc.checkoutId,
    bookingId: doc.bookingId ? String(doc.bookingId) : null,
    finalizeStatus: doc.finalizeStatus,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

function buildConflictDetails(bookingConflicts, sessionConflicts) {
  return {
    bookingConflictCount: bookingConflicts.length,
    sessionConflictCount: sessionConflicts.length,
    bookingConflicts,
    sessionConflicts
  };
}

/**
 * Read-only lookup for blocking commercial stay conflicts (bookings + checkout sessions).
 */
async function findCommercialStayConflicts({
  commercialStayFingerprint,
  checkoutId,
  bookingId
}) {
  requireCommercialStayFingerprint(commercialStayFingerprint);

  const bookingQuery = buildCommercialStayConflictQuery({
    commercialStayFingerprint,
    excludeCheckoutId: checkoutId,
    excludeBookingId: bookingId
  });
  const sessionQuery = buildSessionConflictQuery(commercialStayFingerprint, checkoutId);

  const [bookingDocs, sessionDocs] = await Promise.all([
    Booking.find(bookingQuery)
      .select('_id checkoutId status createdAt commercialStayFingerprint')
      .lean(),
    CheckoutSession.find(sessionQuery)
      .select('checkoutId bookingId finalizeStatus createdAt updatedAt')
      .lean()
  ]);

  const bookingConflicts = bookingDocs.map(mapBookingConflict);
  const sessionConflicts = sessionDocs.map(mapSessionConflict);
  const hasConflict = bookingConflicts.length > 0 || sessionConflicts.length > 0;

  return {
    hasConflict,
    bookingConflicts,
    sessionConflicts
  };
}

/**
 * Throws when a blocking commercial stay conflict exists; otherwise returns { ok: true }.
 *
 * S0 recovery exclusivity bypass requires branded ALS + independently derived identities
 * from finalization data (NOT copied from the ALS store).
 */
async function assertNoCommercialStayConflict({
  commercialStayFingerprint,
  checkoutId,
  bookingId,
  checkoutSessionId = null,
  paymentIntentId = null,
  cabinTypeId = null,
  evidenceDigest = null
}) {
  requireCommercialStayFingerprint(commercialStayFingerprint);

  const store = getMultiUnitPaidOrphanRecoveryContext();
  if (store) {
    // Independently supplied identities only — never echo store fields into expectedScope.
    assertMultiUnitPaidOrphanRecoveryContext(
      {
        checkoutId: String(checkoutId || ''),
        checkoutSessionId,
        paymentIntentId,
        cabinTypeId,
        evidenceDigest
      },
      { operation: 'commercial_stay_bypass' }
    );
    return { ok: true, recoveryBypass: true };
  }

  const conflicts = await findCommercialStayConflicts({
    commercialStayFingerprint,
    checkoutId,
    bookingId
  });

  if (!conflicts.hasConflict) {
    return { ok: true };
  }

  const details = buildConflictDetails(conflicts.bookingConflicts, conflicts.sessionConflicts);

  const inProgressSession = conflicts.sessionConflicts.find(
    (row) => row.finalizeStatus === 'in_progress'
  );
  if (inProgressSession) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.FINALIZE_IN_PROGRESS,
      'Checkout finalization is already in progress for this commercial stay',
      details
    );
  }

  throw new CheckoutSessionError(
    CHECKOUT_SESSION_ERROR_CODES.DUPLICATE_STAY_CONFLICT,
    'A booking or checkout session already exists for this commercial stay',
    details
  );
}

module.exports = {
  BLOCKING_COMMERCIAL_STAY_BOOKING_STATUSES,
  BLOCKING_COMMERCIAL_STAY_SESSION_FINALIZE_STATUSES,
  buildCommercialStayConflictQuery,
  findCommercialStayConflicts,
  assertNoCommercialStayConflict
};
