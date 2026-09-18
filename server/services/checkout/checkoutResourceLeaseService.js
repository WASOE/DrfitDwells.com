/**
 * B8F3 — Durable CheckoutSession resource lease + default-off payment gate helpers.
 *
 * Gate default is OFF. Missing/empty/unknown configuration means OFF.
 * Tests enable the gate via injected `resourceLeaseGateEnabled: true`.
 * Does not bootstrap production indexes; tests create indexes explicitly.
 */
'use strict';

const mongoose = require('mongoose');
const CheckoutSession = require('../../models/CheckoutSession');
const { CheckoutSessionError } = require('./checkoutSessionErrors');
const {
  getActiveAccommodationCheckoutHold,
  releaseAccommodationCheckoutHold,
  assertAccommodationCheckoutHoldActive
} = require('./accommodationCheckoutHoldService');
const facilityBookingService = require('../facilityBookingService');
const giftVoucherLedgerService = require('../giftVouchers/giftVoucherLedgerService');
const GiftVoucherRedemption = require('../../models/GiftVoucherRedemption');
const GiftVoucher = require('../../models/GiftVoucher');
const FacilityReservation = require('../../models/FacilityReservation');

const DEFAULT_RESOURCE_LEASE_MINIMUM_REMAINING_MS = 60_000;

const RESOURCE_LEASE_STATUSES = Object.freeze([
  'active',
  'cancel_pending',
  'expired',
  'paid',
  'released',
  'needs_review'
]);

const SNAPSHOT_PROTECTED_LEASE_STATUSES = Object.freeze([
  'active',
  'cancel_pending',
  'paid',
  'needs_review'
]);

const RESOURCE_LEASE_ERROR_CODES = Object.freeze({
  CHECKOUT_RESOURCE_LEASE_ACTIVE: 'CHECKOUT_RESOURCE_LEASE_ACTIVE',
  CHECKOUT_RESOURCE_LEASE_REQUIRED: 'CHECKOUT_RESOURCE_LEASE_REQUIRED',
  CHECKOUT_RESOURCE_LEASE_EXPIRED: 'CHECKOUT_RESOURCE_LEASE_EXPIRED',
  CHECKOUT_RESOURCE_LEASE_MISMATCH: 'CHECKOUT_RESOURCE_LEASE_MISMATCH',
  CHECKOUT_RESOURCE_LEASE_CANCELLATION_PENDING:
    'CHECKOUT_RESOURCE_LEASE_CANCELLATION_PENDING',
  RESOURCE_LEASE_SESSION_CAS_CONFLICT: 'RESOURCE_LEASE_SESSION_CAS_CONFLICT',
  RESOURCE_LEASE_VERIFICATION_FAILED: 'RESOURCE_LEASE_VERIFICATION_FAILED',
  RESOURCE_LEASE_RELEASE_INCOMPLETE: 'RESOURCE_LEASE_RELEASE_INCOMPLETE',
  RESOURCE_LEASE_INTEGRITY: 'RESOURCE_LEASE_INTEGRITY',
  PAYMENT_INTENT_OUTCOME_AMBIGUOUS: 'PAYMENT_INTENT_OUTCOME_AMBIGUOUS'
});

class CheckoutResourceLeaseError extends Error {
  constructor(code, message, details = null) {
    super(message || code);
    this.name = 'CheckoutResourceLeaseError';
    this.code = code;
    this.details = details;
  }
}

function resolveClock(deps = {}) {
  if (typeof deps.clock === 'function') {
    const value = deps.clock();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new CheckoutResourceLeaseError(
        RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_INTEGRITY,
        'Injected clock must return a valid Date'
      );
    }
    return () => new Date(value.getTime());
  }
  if (deps.now instanceof Date && !Number.isNaN(deps.now.getTime())) {
    const fixed = new Date(deps.now.getTime());
    return () => new Date(fixed.getTime());
  }
  return () => new Date();
}

/**
 * Explicit default-off gate.
 * - Injected boolean wins when typeof boolean.
 * - Else env CHECKOUT_RESOURCE_LEASE_ENABLED via on/off tokens; unset/unknown → OFF.
 */
function isCheckoutResourceLeaseGateEnabled(deps = {}) {
  if (typeof deps.resourceLeaseGateEnabled === 'boolean') {
    return deps.resourceLeaseGateEnabled;
  }
  if (typeof deps.isResourceLeaseGateEnabled === 'function') {
    return Boolean(deps.isResourceLeaseGateEnabled());
  }
  const raw = process.env.CHECKOUT_RESOURCE_LEASE_ENABLED;
  if (raw == null || raw === '') return false;
  if (typeof raw !== 'string') return false;
  const normalized = raw.trim().toLowerCase();
  if (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'on' ||
    normalized === 'yes'
  ) {
    return true;
  }
  // Explicit off or any unknown value → OFF
  return false;
}

function leaseStatusOf(session) {
  const status = session?.resourceLease?.status;
  return status == null || status === '' ? null : String(status);
}

function isSnapshotProtectedLeaseStatus(status) {
  return SNAPSHOT_PROTECTED_LEASE_STATUSES.includes(String(status || ''));
}

function sessionHasSnapshotProtectedLease(session) {
  return isSnapshotProtectedLeaseStatus(leaseStatusOf(session));
}

/**
 * Mongo predicate fragment: snapshot commercial identity must not change
 * while a protected lease exists. Expiry alone does NOT unlock the snapshot.
 */
function snapshotWriteAllowedWithoutProtectedLeasePredicate() {
  return {
    $or: [
      { resourceLease: null },
      { resourceLease: { $exists: false } },
      { 'resourceLease.status': { $exists: false } },
      { 'resourceLease.status': null },
      {
        'resourceLease.status': {
          $nin: [...SNAPSHOT_PROTECTED_LEASE_STATUSES]
        }
      }
    ]
  };
}

function toIso(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function nullSafeId(value) {
  if (value == null || value === '') return null;
  return String(value);
}

function payableStateFromSnapshot(snapshot) {
  const stripeAmountCents = Math.max(0, Number(snapshot?.stripeAmountCents || 0));
  const voucherAppliedCents = Math.max(0, Number(snapshot?.voucherAppliedCents || 0));
  const fullVoucher =
    Boolean(snapshot?.fullVoucherCoverage) &&
    stripeAmountCents === 0 &&
    voucherAppliedCents > 0;
  if (fullVoucher) {
    return { status: 'voucher_only_reserved', paymentStatus: 'not_required' };
  }
  if (stripeAmountCents > 0) {
    return { status: 'payment_required', paymentStatus: 'unpaid' };
  }
  return { status: 'payment_not_required', paymentStatus: 'not_required' };
}

function assertAccommodationGenerationMatches(lease, holdDto) {
  const expected =
    lease?.accommodation?.generation != null ? Number(lease.accommodation.generation) : null;
  const actual = holdDto?.generation != null ? Number(holdDto.generation) : null;
  if (!Number.isInteger(expected) || expected < 1) {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_INTEGRITY,
      'Resource lease is missing accommodation generation'
    );
  }
  if (!Number.isInteger(actual) || actual !== expected) {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_VERIFICATION_FAILED,
      'Accommodation generation does not match the durable resource lease',
      { expectedGeneration: expected, actualGeneration: actual }
    );
  }
}

function buildResourceLeaseDocumentFromBundle(bundle, now) {
  const accommodation = bundle.accommodation || {};
  const facilities = Array.isArray(bundle.facilities) ? bundle.facilities : [];
  const facilityHoldIds = facilities
    .map((f) => nullSafeId(f.holdId || f._id || f.id))
    .filter(Boolean);
  const voucher = bundle.voucher || null;

  return {
    status: 'active',
    generation: Number(bundle.generation),
    attemptId: String(bundle.attemptId),
    quoteSnapshotHash: String(bundle.quoteSnapshotHash || bundle.H0),
    validUntil: new Date(bundle.bundleValidUntil),
    activatedAt: new Date(now),
    updatedAt: new Date(now),
    accommodation: {
      holdId: nullSafeId(accommodation.holdId),
      leaseId: nullSafeId(accommodation.leaseId),
      generation:
        accommodation.generation != null ? Number(accommodation.generation) : null,
      cabinId: nullSafeId(accommodation.cabinId),
      unitId: nullSafeId(accommodation.unitId),
      entityType: nullSafeId(accommodation.entityType)
    },
    facilityHoldIds,
    voucherRedemptionId: voucher ? nullSafeId(voucher.redemptionId) : null,
    voucherOperationId: voucher ? nullSafeId(voucher.operationId) : null,
    paymentIntentId: null,
    cancellationStatus: null,
    cancellationAttemptedAt: null,
    releasedAt: null,
    failureCode: null
  };
}

/**
 * Atomic attach of durable resourceLease while orchestrator fence is still owned.
 * Idempotent for same checkout + generation + attempt + hash.
 */
async function attachResourceLeaseFromBundle(
  {
    checkoutId,
    expectedSessionVersion,
    quoteSnapshotHash,
    bundle
  },
  deps = {}
) {
  const clock = resolveClock(deps);
  const now = clock();
  const Model = deps.CheckoutSession || CheckoutSession;
  const id = String(checkoutId || '').trim();
  const hash = String(quoteSnapshotHash || bundle.quoteSnapshotHash || bundle.H0 || '');
  const generation = Number(bundle.generation);
  const attemptId = String(bundle.attemptId || '');

  if (!id || !hash || !Number.isInteger(generation) || generation < 1 || !attemptId) {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_INTEGRITY,
      'attachResourceLeaseFromBundle requires checkoutId, hash, generation, attemptId'
    );
  }

  const expectedVersion = Number(expectedSessionVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_SESSION_CAS_CONFLICT,
      'expectedSessionVersion is required for lease attachment'
    );
  }

  const leaseDoc = buildResourceLeaseDocumentFromBundle(
    { ...bundle, quoteSnapshotHash: hash, generation, attemptId },
    now
  );

  // Idempotent same-generation attach (crash after attach, before fence release).
  const existing = await Model.findOne({ checkoutId: id }).lean();
  if (
    existing?.resourceLease &&
    existing.resourceLease.status === 'active' &&
    Number(existing.resourceLease.generation) === generation &&
    String(existing.resourceLease.attemptId) === attemptId &&
    String(existing.resourceLease.quoteSnapshotHash) === hash
  ) {
    return {
      ok: true,
      outcome: 'reused',
      session: existing,
      resourceLease: existing.resourceLease
    };
  }

  const filter = {
    checkoutId: id,
    sessionVersion: expectedVersion,
    quoteSnapshotHash: hash,
    finalizeStatus: 'open',
    paymentStatus: { $in: ['unpaid', 'not_required'] },
    status: {
      $in: [
        'draft',
        'quoted',
        'payment_required',
        'payment_not_required',
        'voucher_only_reserved'
      ]
    },
    $and: [snapshotWriteAllowedWithoutProtectedLeasePredicate()]
  };

  const updated = await Model.findOneAndUpdate(
    filter,
    {
      $set: {
        resourceLease: leaseDoc,
        updatedAt: now
      },
      $inc: { sessionVersion: 1 }
    },
    { new: true }
  );

  if (!updated) {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_SESSION_CAS_CONFLICT,
      'Failed to attach durable resource lease (session CAS conflict)',
      { checkoutId: id, expectedSessionVersion: expectedVersion, quoteSnapshotHash: hash }
    );
  }

  return {
    ok: true,
    outcome: 'attached',
    session: updated,
    resourceLease: updated.resourceLease
  };
}

async function assertFacilityHoldsMatchLease(lease, checkoutId, deps, now) {
  const holdIds = Array.isArray(lease.facilityHoldIds) ? lease.facilityHoldIds.map(String) : [];
  if (holdIds.length === 0) return { ok: true, holds: [] };

  const ReservationModel = deps.FacilityReservation || FacilityReservation;

  const holds = await ReservationModel.find({
    _id: { $in: holdIds },
    checkoutSessionId: String(checkoutId),
    status: { $in: ['hold', 'confirmed'] }
  }).lean();

  if (holds.length !== holdIds.length) {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_VERIFICATION_FAILED,
      'Lease facility holds do not match active reservations',
      { expected: holdIds, found: holds.map((h) => String(h._id)) }
    );
  }

  for (const hold of holds) {
    const exp = hold.holdExpiresAt || hold.expiresAt;
    if (exp && new Date(exp).getTime() <= now.getTime()) {
      throw new CheckoutResourceLeaseError(
        RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_EXPIRED,
        'Facility hold backing the resource lease has expired',
        { holdId: String(hold._id) }
      );
    }
    if (hold.acquisitionAttemptId != null && hold.acquisitionAttemptId !== '') {
      throw new CheckoutResourceLeaseError(
        RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_VERIFICATION_FAILED,
        'Facility hold still carries an acquisition marker',
        { holdId: String(hold._id) }
      );
    }
  }

  return { ok: true, holds };
}

async function assertVoucherMatchesLease(lease, checkoutId, deps, now) {
  const redemptionId = nullSafeId(lease.voucherRedemptionId);
  if (!redemptionId) return { ok: true, redemption: null };

  const Redemption = deps.GiftVoucherRedemption || GiftVoucherRedemption;
  const redemption = await Redemption.findById(redemptionId).lean();
  if (!redemption) {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_VERIFICATION_FAILED,
      'Lease voucher redemption is missing'
    );
  }
  if (String(redemption.checkoutId || '') !== String(checkoutId)) {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_VERIFICATION_FAILED,
      'Voucher redemption checkout mismatch'
    );
  }
  if (String(redemption.quoteSnapshotHash || '') !== String(lease.quoteSnapshotHash)) {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_MISMATCH,
      'Voucher redemption hash mismatch vs lease'
    );
  }
  if (redemption.status !== 'reserved') {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_VERIFICATION_FAILED,
      'Voucher redemption is not reserved',
      { status: redemption.status }
    );
  }
  if (redemption.expiresAt && new Date(redemption.expiresAt).getTime() < new Date(lease.validUntil).getTime()) {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_EXPIRED,
      'Voucher reservation expires before lease validUntil'
    );
  }
  if (
    redemption.acquisitionAttemptId != null &&
    redemption.acquisitionAttemptId !== ''
  ) {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_VERIFICATION_FAILED,
      'Voucher redemption still marked (not sealed)'
    );
  }

  const Voucher = deps.GiftVoucher || GiftVoucher;
  const voucher = await Voucher.findById(redemption.giftVoucherId).lean();
  const op = (voucher?.reservationLedgerOperations || []).find(
    (row) => String(row.operationId) === String(redemption.operationId)
  );
  if (!op || op.state !== 'debited') {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_VERIFICATION_FAILED,
      'Voucher operation is not in sealed debited state'
    );
  }
  if (op.acquisitionAttemptId != null && op.acquisitionAttemptId !== '') {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_VERIFICATION_FAILED,
      'Voucher operation still marked (not sealed)'
    );
  }
  if (
    lease.voucherOperationId &&
    String(lease.voucherOperationId) !== String(redemption.operationId)
  ) {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_MISMATCH,
      'Lease voucherOperationId mismatch'
    );
  }

  void now;
  return { ok: true, redemption, operation: op };
}

/**
 * Verify durable lease + backing resource records before any Stripe create/reuse return.
 */
async function verifyActiveResourceLeaseForPayment(
  { session, requireMinRemainingMs = DEFAULT_RESOURCE_LEASE_MINIMUM_REMAINING_MS },
  deps = {}
) {
  const clock = resolveClock(deps);
  const now = clock();
  const lease = session?.resourceLease;
  if (!lease || lease.status !== 'active') {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_REQUIRED,
      'Active resource lease is required before payment intent work'
    );
  }

  if (String(lease.quoteSnapshotHash || '') !== String(session.quoteSnapshotHash || '')) {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_MISMATCH,
      'Resource lease quoteSnapshotHash does not match session'
    );
  }

  const validUntil = new Date(lease.validUntil);
  if (Number.isNaN(validUntil.getTime())) {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_INTEGRITY,
      'Resource lease validUntil is invalid'
    );
  }
  const remainingMs = validUntil.getTime() - now.getTime();
  if (remainingMs <= 0) {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_EXPIRED,
      'Resource lease has expired'
    );
  }
  if (remainingMs < Number(requireMinRemainingMs)) {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_EXPIRED,
      'Resource lease has less than the required remaining lifetime',
      { remainingMs, requireMinRemainingMs }
    );
  }

  const activeHold = await getActiveAccommodationCheckoutHold(session.checkoutId, {
    ...deps,
    now
  });
  if (!activeHold) {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_VERIFICATION_FAILED,
      'Active accommodation hold backing the resource lease is missing'
    );
  }
  if (
    lease.accommodation?.leaseId &&
    String(activeHold.leaseId) !== String(lease.accommodation.leaseId)
  ) {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_MISMATCH,
      'Accommodation leaseId does not match resource lease'
    );
  }
  assertAccommodationGenerationMatches(lease, activeHold);

  try {
    await assertAccommodationCheckoutHoldActive(
      {
        checkoutId: session.checkoutId,
        checkIn: session.quoteSnapshot?.checkInDateOnly || session.quoteSnapshot?.checkIn,
        checkOut: session.quoteSnapshot?.checkOutDateOnly || session.quoteSnapshot?.checkOut,
        cabinId: lease.accommodation?.cabinId || undefined,
        unitId: lease.accommodation?.unitId || undefined,
        entityType: lease.accommodation?.entityType || undefined
      },
      { ...deps, now }
    );
  } catch (err) {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_VERIFICATION_FAILED,
      err?.message || 'Accommodation hold verification failed',
      { cause: err?.code || null }
    );
  }

  await assertFacilityHoldsMatchLease(lease, session.checkoutId, deps, now);
  await assertVoucherMatchesLease(lease, session.checkoutId, deps, now);

  return {
    ok: true,
    remainingMs,
    validUntil,
    generation: Number(lease.generation),
    attemptId: String(lease.attemptId),
    quoteSnapshotHash: String(lease.quoteSnapshotHash),
    resourceLease: lease
  };
}

async function markResourceLeaseStatus(
  { checkoutId, expectedGeneration, fromStatuses, toStatus, patch = {} },
  deps = {}
) {
  const clock = resolveClock(deps);
  const now = clock();
  const Model = deps.CheckoutSession || CheckoutSession;
  const filter = {
    checkoutId: String(checkoutId),
    'resourceLease.generation': Number(expectedGeneration),
    'resourceLease.status': { $in: fromStatuses }
  };
  const updated = await Model.findOneAndUpdate(
    filter,
    {
      $set: {
        'resourceLease.status': toStatus,
        'resourceLease.updatedAt': now,
        ...Object.fromEntries(
          Object.entries(patch).map(([k, v]) => [`resourceLease.${k}`, v])
        )
      },
      $inc: { sessionVersion: 1 }
    },
    { new: true }
  );
  return updated;
}

/**
 * Build $in values that match either ObjectId or string storage forms.
 */
function objectIdOrStringVariants(value) {
  if (value == null || value === '') return [];
  const variants = [];
  if (value instanceof mongoose.Types.ObjectId) {
    variants.push(value);
    variants.push(String(value));
    return variants;
  }
  const asString = String(value).trim();
  if (!asString) return [];
  variants.push(asString);
  if (mongoose.Types.ObjectId.isValid(asString)) {
    try {
      const oid = new mongoose.Types.ObjectId(asString);
      if (String(oid) === asString) {
        variants.push(oid);
      }
    } catch (_err) {
      // ignore invalid ObjectId coercion
    }
  }
  return variants;
}

function sessionMatchesExactPaidFinalizeIdentity(session, expected) {
  if (!session || !session.resourceLease) return false;
  const rl = session.resourceLease;
  if (String(session.flowVersion || '') !== 'v2') return false;
  if (String(session.finalizeStatus || '') !== 'in_progress') return false;
  if (String(rl.status || '') !== 'paid') return false;
  if (String(session.bookingId || '') !== String(expected.expectedBookingId)) return false;
  if (Number(rl.generation) !== Number(expected.expectedGeneration)) return false;
  if (String(rl.attemptId || '') !== String(expected.expectedAttemptId)) return false;
  if (String(rl.quoteSnapshotHash || '') !== String(expected.expectedQuoteSnapshotHash)) {
    return false;
  }
  const accLeaseId = String(
    rl.accommodation?.leaseId || rl.accommodation?.holdId || ''
  ).trim();
  if (accLeaseId !== String(expected.expectedAccommodationLeaseId)) return false;

  if (expected.paymentMode === 'stripe') {
    const pi = String(expected.expectedPaymentIntentId || '').trim();
    if (!pi) return false;
    if (String(rl.paymentIntentId || '') !== pi) return false;
    if (String(session.canonicalPaymentIntentId || '') !== pi) return false;
  } else if (expected.paymentMode === 'full_voucher') {
    if (
      String(rl.voucherRedemptionId || '') !==
      String(expected.expectedVoucherRedemptionId || '')
    ) {
      return false;
    }
    if (
      String(rl.voucherOperationId || '') !==
      String(expected.expectedVoucherOperationId || '')
    ) {
      return false;
    }
  } else {
    return false;
  }
  return true;
}

/**
 * Narrow CAS: mark resourceLease.status paid under exact paid-finalization identity.
 * Idempotent when already paid with the same identity. Does not change markResourceLeaseStatus.
 */
async function markExactResourceLeasePaidForFinalize(
  {
    checkoutId,
    expectedGeneration,
    expectedAttemptId,
    expectedQuoteSnapshotHash,
    expectedAccommodationLeaseId,
    expectedBookingId,
    paymentMode,
    expectedPaymentIntentId = null,
    expectedVoucherRedemptionId = null,
    expectedVoucherOperationId = null
  },
  deps = {}
) {
  const clock = resolveClock(deps);
  const now = clock();
  const Model = deps.CheckoutSession || CheckoutSession;
  const id = String(checkoutId || '').trim();
  const generation = Number(expectedGeneration);
  const attemptId = String(expectedAttemptId || '').trim();
  const quoteSnapshotHash = String(expectedQuoteSnapshotHash || '').trim();
  const accommodationLeaseId = String(expectedAccommodationLeaseId || '').trim();
  const bookingIdRaw = expectedBookingId;
  const mode = String(paymentMode || '').trim();

  if (
    !id ||
    !Number.isInteger(generation) ||
    generation < 1 ||
    !attemptId ||
    !quoteSnapshotHash ||
    !accommodationLeaseId ||
    bookingIdRaw == null ||
    String(bookingIdRaw).trim() === ''
  ) {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_INTEGRITY,
      'markExactResourceLeasePaidForFinalize requires exact checkout/booking/lease identity'
    );
  }
  if (mode !== 'stripe' && mode !== 'full_voucher') {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_INTEGRITY,
      'paymentMode must be stripe or full_voucher',
      { paymentMode: mode }
    );
  }

  const bookingVariants = objectIdOrStringVariants(bookingIdRaw);
  if (!bookingVariants.length) {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_INTEGRITY,
      'expectedBookingId is invalid'
    );
  }

  const expectedIdentity = {
    expectedGeneration: generation,
    expectedAttemptId: attemptId,
    expectedQuoteSnapshotHash: quoteSnapshotHash,
    expectedAccommodationLeaseId: accommodationLeaseId,
    expectedBookingId: String(bookingIdRaw),
    paymentMode: mode,
    expectedPaymentIntentId,
    expectedVoucherRedemptionId,
    expectedVoucherOperationId
  };

  // Pure replay: already paid with exact identity — return without mutation.
  const existing = await Model.findOne({ checkoutId: id }).lean();
  if (sessionMatchesExactPaidFinalizeIdentity(existing, expectedIdentity)) {
    return existing;
  }
  const existingStatus = existing?.resourceLease?.status;
  if (existingStatus === 'released' || existingStatus === 'needs_review') {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_MISMATCH,
      'Cannot mark released or needs_review resource lease as paid',
      {
        checkoutId: id,
        resourceLeaseStatus: existingStatus
      }
    );
  }

  const filter = {
    checkoutId: id,
    flowVersion: 'v2',
    finalizeStatus: 'in_progress',
    bookingId: { $in: bookingVariants },
    'resourceLease.generation': generation,
    'resourceLease.attemptId': attemptId,
    'resourceLease.quoteSnapshotHash': quoteSnapshotHash,
    'resourceLease.status': {
      $in: ['active', 'cancel_pending', 'expired', 'paid']
    },
    $and: [
      {
        $or: [
          { 'resourceLease.accommodation.leaseId': accommodationLeaseId },
          { 'resourceLease.accommodation.holdId': accommodationLeaseId }
        ]
      }
    ]
  };

  if (mode === 'stripe') {
    const pi = String(expectedPaymentIntentId || '').trim();
    if (!pi) {
      throw new CheckoutResourceLeaseError(
        RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_INTEGRITY,
        'expectedPaymentIntentId is required for stripe paymentMode'
      );
    }
    filter['resourceLease.paymentIntentId'] = pi;
    filter.canonicalPaymentIntentId = pi;
  } else {
    const redemptionId = expectedVoucherRedemptionId;
    const operationId = String(expectedVoucherOperationId || '').trim();
    if (redemptionId == null || String(redemptionId).trim() === '' || !operationId) {
      throw new CheckoutResourceLeaseError(
        RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_INTEGRITY,
        'expectedVoucherRedemptionId and expectedVoucherOperationId are required for full_voucher'
      );
    }
    const redemptionVariants = objectIdOrStringVariants(redemptionId);
    if (!redemptionVariants.length) {
      throw new CheckoutResourceLeaseError(
        RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_INTEGRITY,
        'expectedVoucherRedemptionId is invalid'
      );
    }
    filter['resourceLease.voucherRedemptionId'] = { $in: redemptionVariants };
    filter['resourceLease.voucherOperationId'] = operationId;
  }

  const updated = await Model.findOneAndUpdate(
    filter,
    {
      $set: {
        'resourceLease.status': 'paid',
        'resourceLease.updatedAt': now
      },
      $inc: { sessionVersion: 1 }
    },
    { new: true }
  );

  if (updated) {
    return updated.toObject ? updated.toObject() : updated;
  }

  const latest = await Model.findOne({ checkoutId: id }).lean();
  if (sessionMatchesExactPaidFinalizeIdentity(latest, expectedIdentity)) {
    return latest;
  }

  const liveStatus = latest?.resourceLease?.status;
  if (liveStatus === 'released' || liveStatus === 'needs_review') {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_MISMATCH,
      'Cannot mark released or needs_review resource lease as paid',
      {
        checkoutId: id,
        resourceLeaseStatus: liveStatus
      }
    );
  }

  throw new CheckoutResourceLeaseError(
    RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_MISMATCH,
    'Exact lease-paid CAS did not match paid finalization identity',
    {
      checkoutId: id,
      expectedGeneration: generation,
      expectedAttemptId: attemptId,
      liveStatus,
      liveGeneration: latest?.resourceLease?.generation,
      liveAttemptId: latest?.resourceLease?.attemptId
    }
  );
}

async function bindPaymentIntentToResourceLease(
  {
    checkoutId,
    expectedGeneration,
    paymentIntentId,
    expectedSessionVersion,
    expectedQuoteSnapshotHash,
    expectedAttemptId = null
  },
  deps = {}
) {
  const Model = deps.CheckoutSession || CheckoutSession;
  const id = String(checkoutId || '').trim();
  const piId = String(paymentIntentId || '').trim();
  const expectedHash = String(expectedQuoteSnapshotHash || '').trim();
  const expectedGen = Number(expectedGeneration);
  const expectedVersion = Number(expectedSessionVersion);

  if (typeof deps.beforeBindPaymentIntent === 'function') {
    await deps.beforeBindPaymentIntent({
      checkoutId: id,
      expectedGeneration: expectedGen,
      expectedQuoteSnapshotHash: expectedHash,
      expectedSessionVersion: expectedVersion,
      paymentIntentId: piId
    });
  }

  // Sample the clock after the pause hook so expiry races observe a fresh now.
  const clock = resolveClock(deps);
  const now = clock();

  if (!id || !piId || !expectedHash) {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_INTEGRITY,
      'bindPaymentIntentToResourceLease requires checkoutId, paymentIntentId, and snapshot hash'
    );
  }

  // Exact Mongo bind CAS predicate (must match this filter, nothing weaker):
  // checkoutId
  // resourceLease.status === 'active'
  // resourceLease.generation === expectedGeneration
  // resourceLease.quoteSnapshotHash === expectedQuoteSnapshotHash
  // resourceLease.validUntil > now
  // quoteSnapshotHash === expectedQuoteSnapshotHash
  // sessionVersion === expectedSessionVersion
  // canonicalPaymentIntentId is null / missing OR the exact same PI
  // resourceLease.paymentIntentId is null / missing OR the exact same PI
  // resourceLease.attemptId === expectedAttemptId when attemptId is part of the active identity
  const filter = {
    checkoutId: id,
    sessionVersion: expectedVersion,
    quoteSnapshotHash: expectedHash,
    'resourceLease.status': 'active',
    'resourceLease.generation': expectedGen,
    'resourceLease.quoteSnapshotHash': expectedHash,
    'resourceLease.validUntil': { $gt: now },
    $and: [
      {
        $or: [
          { canonicalPaymentIntentId: null },
          { canonicalPaymentIntentId: { $exists: false } },
          { canonicalPaymentIntentId: piId }
        ]
      },
      {
        $or: [
          { 'resourceLease.paymentIntentId': null },
          { 'resourceLease.paymentIntentId': { $exists: false } },
          { 'resourceLease.paymentIntentId': piId }
        ]
      }
    ]
  };
  if (expectedAttemptId) {
    filter['resourceLease.attemptId'] = String(expectedAttemptId);
  }

  const updated = await Model.findOneAndUpdate(
    filter,
    {
      $set: {
        canonicalPaymentIntentId: piId,
        status: 'pi_active',
        paymentStatus: 'unpaid',
        'resourceLease.paymentIntentId': piId,
        'resourceLease.updatedAt': now
      },
      $inc: { sessionVersion: 1 }
    },
    { new: true }
  );
  if (updated) {
    await verifyActiveResourceLeaseForPayment(
      {
        session: updated.toObject ? updated.toObject() : updated,
        requireMinRemainingMs: DEFAULT_RESOURCE_LEASE_MINIMUM_REMAINING_MS
      },
      deps
    );
    return updated;
  }

  const latest = await Model.findOne({ checkoutId: id }).lean();
  const lease = latest?.resourceLease || null;
  if (
    latest &&
    lease &&
    lease.status === 'active' &&
    Number(lease.generation) === expectedGen &&
    String(lease.quoteSnapshotHash) === expectedHash &&
    String(latest.quoteSnapshotHash) === expectedHash &&
    String(latest.canonicalPaymentIntentId || '') === piId &&
    String(lease.paymentIntentId || '') === piId &&
    lease.validUntil &&
    new Date(lease.validUntil).getTime() > now.getTime() &&
    (!expectedAttemptId || String(lease.attemptId) === String(expectedAttemptId))
  ) {
    await verifyActiveResourceLeaseForPayment(
      {
        session: latest,
        requireMinRemainingMs: DEFAULT_RESOURCE_LEASE_MINIMUM_REMAINING_MS
      },
      deps
    );
    return latest;
  }

  const validUntilMs = lease?.validUntil ? new Date(lease.validUntil).getTime() : 0;
  if (lease && validUntilMs > 0 && validUntilMs <= now.getTime()) {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_EXPIRED,
      'Resource lease expired before PaymentIntent bind',
      { checkoutId: id, paymentIntentId: piId }
    );
  }
  throw new CheckoutResourceLeaseError(
    RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_MISMATCH,
    'PaymentIntent bind CAS did not match the exact active resource lease',
    { checkoutId: id, paymentIntentId: piId, expectedGeneration: expectedGen }
  );
}

/**
 * Atomically claim active → cancel_pending before any Stripe cancel.
 * Same-generation cancel_pending is an idempotent resume (crash-safe).
 */
async function claimLeaseCancellationPending(
  {
    checkoutId,
    expectedGeneration,
    quoteSnapshotHash,
    leaseQuoteSnapshotHash = null,
    paymentIntentId = null,
    expectedSessionVersion = null,
    reason = 'resource_lease_cancel_claimed',
    allowNotDue = false
  },
  deps = {}
) {
  const Model = deps.CheckoutSession || CheckoutSession;
  const id = String(checkoutId || '').trim();
  const expectedSessionHash = String(quoteSnapshotHash || '').trim();
  const expectedLeaseHash = String(
    leaseQuoteSnapshotHash || quoteSnapshotHash || ''
  ).trim();
  const expectedGen = Number(expectedGeneration);
  const piId =
    paymentIntentId != null && String(paymentIntentId).trim() !== ''
      ? String(paymentIntentId)
      : null;

  if (typeof deps.beforeClaimCancellation === 'function') {
    await deps.beforeClaimCancellation({
      checkoutId: id,
      expectedGeneration: expectedGen,
      quoteSnapshotHash: expectedSessionHash,
      leaseQuoteSnapshotHash: expectedLeaseHash,
      paymentIntentId: piId
    });
  }

  const clock = resolveClock(deps);
  const now = clock();

  // Exact Mongo cancel-claim CAS: active → cancel_pending.
  // checkoutId, exact lease generation, exact lease snapshot hash,
  // session quoteSnapshotHash, expected sessionVersion, eligible unpaid state,
  // exact due unless allowNotDue, exact PI id when present,
  // not paid / succeeded / finalized / replaced.
  const filter = {
    checkoutId: id,
    quoteSnapshotHash: expectedSessionHash,
    'resourceLease.status': 'active',
    'resourceLease.generation': expectedGen,
    'resourceLease.quoteSnapshotHash': expectedLeaseHash,
    paymentStatus: { $in: ['unpaid', 'not_required'] },
    finalizeStatus: { $ne: 'finalized' },
    status: { $nin: ['paid'] }
  };
  if (Number.isInteger(Number(expectedSessionVersion)) && Number(expectedSessionVersion) >= 1) {
    filter.sessionVersion = Number(expectedSessionVersion);
  }
  if (!allowNotDue) {
    filter['resourceLease.validUntil'] = { $lte: now };
  }
  if (piId) {
    filter.$and = [
      {
        $or: [
          { canonicalPaymentIntentId: piId },
          { 'resourceLease.paymentIntentId': piId }
        ]
      }
    ];
  } else {
    filter.$and = [
      {
        $or: [
          { canonicalPaymentIntentId: null },
          { canonicalPaymentIntentId: { $exists: false } }
        ]
      }
    ];
  }

  const updated = await Model.findOneAndUpdate(
    filter,
    {
      $set: {
        'resourceLease.status': 'cancel_pending',
        'resourceLease.cancellationAttemptedAt': now,
        'resourceLease.cancellationStatus': String(reason || 'claimed'),
        'resourceLease.updatedAt': now
      },
      $inc: { sessionVersion: 1 }
    },
    { new: true }
  );
  if (updated) {
    if (typeof deps.afterClaimCancellation === 'function') {
      await deps.afterClaimCancellation({
        checkoutId: id,
        session: updated,
        outcome: 'claimed'
      });
    }
    return { outcome: 'claimed', session: updated };
  }

  const latest = await Model.findOne({ checkoutId: id }).lean();
  const lease = latest?.resourceLease || null;
  if (
    latest &&
    lease &&
    lease.status === 'cancel_pending' &&
    Number(lease.generation) === expectedGen &&
    String(lease.quoteSnapshotHash) === expectedLeaseHash &&
    String(latest.quoteSnapshotHash || '') === expectedSessionHash &&
    (!piId ||
      String(latest.canonicalPaymentIntentId || '') === piId ||
      String(lease.paymentIntentId || '') === piId)
  ) {
    if (typeof deps.afterClaimCancellation === 'function') {
      await deps.afterClaimCancellation({
        checkoutId: id,
        session: latest,
        outcome: 'resumed'
      });
    }
    return { outcome: 'resumed', session: latest };
  }

  if (latest?.paymentStatus === 'paid' || latest?.status === 'paid') {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_MISMATCH,
      'Cannot claim cancellation on a paid checkout session'
    );
  }
  throw new CheckoutResourceLeaseError(
    RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_MISMATCH,
    'Cancellation-claim CAS did not match the exact resource lease generation',
    {
      checkoutId: id,
      expectedGeneration: expectedGen,
      liveGeneration: lease?.generation,
      liveStatus: lease?.status
    }
  );
}

async function finalizeReleasedLeaseAndClearCanonical(
  { checkoutId, expectedGeneration, quoteSnapshotHash, paymentIntentId = null },
  deps = {}
) {
  const clock = resolveClock(deps);
  const now = clock();
  const Model = deps.CheckoutSession || CheckoutSession;
  const id = String(checkoutId);
  const expectedHash = String(quoteSnapshotHash || '');
  const expectedGen = Number(expectedGeneration);
  const piId =
    paymentIntentId != null && String(paymentIntentId).trim() !== ''
      ? String(paymentIntentId)
      : null;

  const current = await Model.findOne({ checkoutId: id }).lean();
  if (!current) {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_INTEGRITY,
      'CheckoutSession missing during released-lease finalize'
    );
  }
  const payable = payableStateFromSnapshot(current.quoteSnapshot);
  const filter = {
    checkoutId: id,
    'resourceLease.status': 'cancel_pending',
    'resourceLease.generation': expectedGen,
    'resourceLease.quoteSnapshotHash': expectedHash,
    paymentStatus: { $in: ['unpaid', 'not_required'] },
    status: { $nin: ['paid'] }
  };
  if (piId) {
    filter.$or = [
      { canonicalPaymentIntentId: piId },
      { 'resourceLease.paymentIntentId': piId },
      {
        $and: [
          {
            $or: [
              { canonicalPaymentIntentId: null },
              { canonicalPaymentIntentId: { $exists: false } }
            ]
          },
          {
            $or: [
              { 'resourceLease.paymentIntentId': null },
              { 'resourceLease.paymentIntentId': { $exists: false } }
            ]
          }
        ]
      }
    ];
  } else {
    filter.$and = [
      {
        $or: [
          { canonicalPaymentIntentId: null },
          { canonicalPaymentIntentId: { $exists: false } }
        ]
      }
    ];
  }

  const update = {
    $set: {
      canonicalPaymentIntentId: null,
      status: payable.status,
      paymentStatus: payable.paymentStatus,
      'resourceLease.status': 'released',
      'resourceLease.releasedAt': now,
      'resourceLease.updatedAt': now,
      'resourceLease.failureCode': null
    },
    $inc: { sessionVersion: 1 }
  };
  if (piId) {
    update.$addToSet = { supersededPaymentIntentIds: piId };
  }

  const updated = await Model.findOneAndUpdate(filter, update, { new: true });
  if (!updated) {
    const latest = await Model.findOne({ checkoutId: id }).lean();
    if (latest?.resourceLease?.status === 'released') {
      return latest;
    }
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_MISMATCH,
      'Released-lease session transition CAS did not match',
      { checkoutId: id, expectedGeneration: expectedGen }
    );
  }
  return updated;
}

/**
 * Release exact stored lease resources in reverse order: voucher → facilities → accommodation.
 */
async function releaseExactResourceLeaseGeneration(
  {
    checkoutId,
    expectedGeneration,
    reason = 'resource_lease_release',
    canonicalPaymentIntentId = null
  },
  deps = {}
) {
  const clock = resolveClock(deps);
  const now = clock();
  const Model = deps.CheckoutSession || CheckoutSession;
  const session = await Model.findOne({ checkoutId: String(checkoutId) }).lean();
  if (!session?.resourceLease) {
    return { ok: true, outcome: 'no_lease', remaining: {} };
  }
  const lease = session.resourceLease;
  if (Number(lease.generation) !== Number(expectedGeneration)) {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_MISMATCH,
      'Stale reconciler cannot release a different lease generation',
      {
        expectedGeneration,
        liveGeneration: lease.generation
      }
    );
  }
  if (lease.status === 'released') {
    return { ok: true, outcome: 'already_released', remaining: {}, session };
  }
  if (lease.status === 'paid' || session.paymentStatus === 'paid' || session.status === 'paid') {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_MISMATCH,
      'Cannot release resources for a paid resource lease'
    );
  }
  if (lease.status !== 'cancel_pending') {
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_CANCELLATION_PENDING,
      'Resource release requires a durable cancel_pending claim',
      { status: lease.status }
    );
  }

  const remaining = {
    voucher: Boolean(lease.voucherRedemptionId),
    facilities: Array.isArray(lease.facilityHoldIds) ? [...lease.facilityHoldIds] : [],
    accommodation: Boolean(lease.accommodation?.leaseId)
  };

  // 1) Voucher — sealed unmarked release via V1 ledger (attempt-fence release refuses sealed).
  if (lease.voucherRedemptionId) {
    try {
      const releaseFn =
        deps.releaseVoucherRedemptionV1 ||
        giftVoucherLedgerService.releaseVoucherRedemptionV1;
      await releaseFn({
        redemptionId: String(lease.voucherRedemptionId),
        reason: String(reason || 'resource_lease_release'),
        actor: 'system',
        note: 'B8F3 resource lease release',
        now
      });
      remaining.voucher = false;
    } catch (_voucherErr) {
      remaining.voucher = true;
    }
  }

  // 2) Facilities — exact hold ids (unmarked holds only)
  if (remaining.facilities.length > 0) {
    try {
      const releaseFac =
        deps.releaseFacilityHolds || facilityBookingService.releaseFacilityHolds;
      await releaseFac(
        String(checkoutId),
        {
          holdIds: remaining.facilities.map(String),
          acquisitionAttemptId: null
        },
        { ...deps, now }
      );
      const ReservationModel = deps.FacilityReservation || FacilityReservation;
      const still = await ReservationModel.find({
        _id: { $in: remaining.facilities },
        status: { $in: ['hold', 'confirmed'] }
      })
        .select('_id')
        .lean();
      remaining.facilities = still.map((h) => String(h._id));
    } catch (_e) {
      // keep remaining.facilities
    }
  }

  // 3) Accommodation — exact leaseId + stored generation. Never touch a newer hold.
  if (remaining.accommodation) {
    try {
      const stillHold = await getActiveAccommodationCheckoutHold(String(checkoutId), {
        ...deps,
        now
      });
      if (!stillHold) {
        remaining.accommodation = false;
      } else {
        try {
          assertAccommodationGenerationMatches(lease, stillHold);
          const releaseAcc =
            deps.releaseAccommodationCheckoutHold || releaseAccommodationCheckoutHold;
          await releaseAcc(
            String(checkoutId),
            { leaseId: String(lease.accommodation.leaseId) },
            { ...deps, now }
          );
          const after = await getActiveAccommodationCheckoutHold(String(checkoutId), {
            ...deps,
            now
          });
          remaining.accommodation = Boolean(after);
        } catch (genErr) {
          if (
            genErr?.code === RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_VERIFICATION_FAILED ||
            genErr?.code === RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_INTEGRITY
          ) {
            remaining.accommodation = true;
          } else {
            remaining.accommodation = true;
          }
        }
      }
    } catch (_e) {
      remaining.accommodation = true;
    }
  }

  const incomplete =
    remaining.voucher || remaining.facilities.length > 0 || remaining.accommodation;

  if (incomplete) {
    await markResourceLeaseStatus(
      {
        checkoutId,
        expectedGeneration,
        fromStatuses: ['cancel_pending'],
        toStatus: 'needs_review',
        patch: {
          failureCode: RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_RELEASE_INCOMPLETE,
          updatedAt: now
        }
      },
      deps
    );
    throw new CheckoutResourceLeaseError(
      RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_RELEASE_INCOMPLETE,
      'Partial resource lease release; marked needs_review',
      { remaining }
    );
  }

  const released = await finalizeReleasedLeaseAndClearCanonical(
    {
      checkoutId,
      expectedGeneration,
      quoteSnapshotHash: String(lease.quoteSnapshotHash),
      paymentIntentId:
        canonicalPaymentIntentId ||
        lease.paymentIntentId ||
        session.canonicalPaymentIntentId ||
        null
    },
    deps
  );

  return { ok: true, outcome: 'released', session: released, remaining };
}

async function ensureResourceLeaseIndexesForTests(deps = {}) {
  const Model = deps.CheckoutSession || CheckoutSession;
  await Model.collection.createIndex(
    { 'resourceLease.status': 1, 'resourceLease.validUntil': 1 },
    {
      name: 'resource_lease_status_validUntil_v1',
      partialFilterExpression: {
        'resourceLease.status': { $exists: true, $type: 'string' }
      }
    }
  );
  return Model.collection.indexes();
}

function buildGatedPaymentIntentIdempotencyKey(checkoutId, quoteSnapshotHash, generation) {
  return `checkout-session:${checkoutId}:pi:${quoteSnapshotHash}:gen:${generation}`;
}

function leaseFieldsForDto(session) {
  const lease = session?.resourceLease;
  if (!lease) return null;
  return {
    status: lease.status,
    generation: lease.generation,
    attemptId: lease.attemptId,
    quoteSnapshotHash: lease.quoteSnapshotHash,
    validUntil: lease.validUntil,
    paymentIntentId: lease.paymentIntentId || null,
    voucherRedemptionId: lease.voucherRedemptionId
      ? String(lease.voucherRedemptionId)
      : null
  };
}

module.exports = {
  DEFAULT_RESOURCE_LEASE_MINIMUM_REMAINING_MS,
  RESOURCE_LEASE_STATUSES,
  SNAPSHOT_PROTECTED_LEASE_STATUSES,
  RESOURCE_LEASE_ERROR_CODES,
  CheckoutResourceLeaseError,
  isCheckoutResourceLeaseGateEnabled,
  leaseStatusOf,
  isSnapshotProtectedLeaseStatus,
  sessionHasSnapshotProtectedLease,
  snapshotWriteAllowedWithoutProtectedLeasePredicate,
  buildResourceLeaseDocumentFromBundle,
  attachResourceLeaseFromBundle,
  verifyActiveResourceLeaseForPayment,
  markResourceLeaseStatus,
  markExactResourceLeasePaidForFinalize,
  bindPaymentIntentToResourceLease,
  claimLeaseCancellationPending,
  finalizeReleasedLeaseAndClearCanonical,
  releaseExactResourceLeaseGeneration,
  ensureResourceLeaseIndexesForTests,
  buildGatedPaymentIntentIdempotencyKey,
  leaseFieldsForDto,
  resolveClock,
  // Re-export for typed throws from session service without editing errors file.
  toCheckoutSessionLeaseActiveError() {
    return new CheckoutSessionError(
      RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_ACTIVE,
      'Checkout resource lease protects the commercial snapshot; create a new checkout to change it'
    );
  }
};
