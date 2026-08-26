'use strict';

/**
 * REBOOK-S3 first mutation — cross-commercial-product stay change.
 * Binding: docs/stay-change-implementation-plan.md §25
 *
 * Target-first inventory. Source release last. No Payment/Stripe mutation.
 * Standalone Mongo — no multi-document transactions.
 */

const crypto = require('crypto');
const mongoose = require('mongoose');
const StayChange = require('../../models/StayChange');
const Booking = require('../../models/Booking');
const Cabin = require('../../models/Cabin');
const CabinType = require('../../models/CabinType');
const Unit = require('../../models/Unit');
const Payment = require('../../models/Payment');
const AvailabilityBlock = require('../../models/AvailabilityBlock');
const {
  claimCabinNights,
  releaseCabinNights,
  assertBookingOwnsCabinNights,
  compensateCabinClaimAttempt
} = require('../inventory/cabinNightClaimService');
const {
  claimUnitNights,
  releaseUnitNights,
  assertBookingOwnsNights,
  compensateClaimAttempt
} = require('../inventory/unitNightClaimService');
const { evaluateTargetConflicts } = require('../ops/domain/conflictService');
const { findParentCabinForCabinType } = require('../publicAvailabilityService');
const { createDomainError } = require('../ops/domain/errors');
const { requirePermission, ACTIONS } = require('../permissionService');
const { appendAuditEvent } = require('../auditWriter');
const { openManualReviewItem } = require('../ops/ingestion/manualReviewService');
const { computeQuoteFromEntity } = require('../bookingQuoteService');
const { formatSofiaDateOnly, normalizeDateToSofiaDayStart } = require('../../utils/dateTime');
const { assertStayChangeIdempotencyIndex } = require('./stayChangeIndexes');
const {
  commercialProductKeyFromBooking,
  validateCommercialShape,
  classifyStayChangeRoute
} = require('./commercialProductIdentity');
const {
  resolveSourceContractualTotalCents,
  resolveRecognizedNetSettledCoverageCents,
  computeTransferredValueCents,
  computeContractualTargetTotalCents
} = require('./rebookMoneyEvidence');
const {
  REBOOK_KIND,
  buildSourceSnapshot,
  buildTargetSnapshot
} = require('./rebookStayChangeSpine');
const {
  detectPromotionalSourceEconomics,
  PROMO_REASON
} = require('./rebookPromoEligibility');
const KIND = REBOOK_KIND;
const ELIGIBLE_STATUSES = Object.freeze(['pending', 'confirmed']);
const MRI_CATEGORY = 'stay_change_rebook_reconciliation';
const MRI_SOURCE = 'stay_change_rebook';
const AUDIT_ACTION = 'reservation_rebook';

const FINGERPRINT_KEYS = Object.freeze([
  'kind',
  'bookingId',
  'targetCommercialProductKey',
  'targetCabinId',
  'targetCabinTypeId',
  'targetUnitId',
  'checkIn',
  'checkOut',
  'adults',
  'children',
  'canonicalTargetQuoteCents',
  'waiveUpgradeCents',
  'acceptExternalHoldWarnings',
  'reason'
]);

function auditDedupeKeyFor(stayChangeId) {
  return `reservation_rebook:${String(stayChangeId)}`;
}

function canonicalStayDateOnly(input) {
  if (input == null || input === '') {
    throw createDomainError('validation', 'Stay date is required for payload fingerprint', {
      code: 'FINGERPRINT_DATE_REQUIRED'
    });
  }
  const dayStart = normalizeDateToSofiaDayStart(input);
  const dateOnly = formatSofiaDateOnly(dayStart);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
    throw createDomainError('validation', 'Stay date could not be canonicalized', {
      code: 'FINGERPRINT_DATE_INVALID'
    });
  }
  return dateOnly;
}

function normalizeReasonForFingerprint(reason) {
  if (reason == null || reason === '') return '';
  return String(reason).trim().slice(0, 500);
}

function normalizeIdempotencyKey(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim();
}

function isValidIdempotencyKey(key) {
  return typeof key === 'string' && key.length >= 8 && key.length <= 128;
}

function idStr(v) {
  if (v == null || v === '') return null;
  return String(v);
}

function buildPayloadFingerprint(values) {
  const normalized = {
    kind: String(values.kind),
    bookingId: String(values.bookingId),
    targetCommercialProductKey: String(values.targetCommercialProductKey),
    targetCabinId: idStr(values.targetCabinId) || '',
    targetCabinTypeId: idStr(values.targetCabinTypeId) || '',
    targetUnitId: idStr(values.targetUnitId) || '',
    checkIn: canonicalStayDateOnly(values.checkIn),
    checkOut: canonicalStayDateOnly(values.checkOut),
    adults: Number(values.adults),
    children: Number(values.children || 0),
    canonicalTargetQuoteCents: Number(values.canonicalTargetQuoteCents),
    waiveUpgradeCents: Number(values.waiveUpgradeCents || 0),
    acceptExternalHoldWarnings: Boolean(values.acceptExternalHoldWarnings),
    reason: normalizeReasonForFingerprint(values.reason)
  };
  const canonical = `{${FINGERPRINT_KEYS.map((k) => `${JSON.stringify(k)}:${JSON.stringify(normalized[k])}`).join(',')}}`;
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function sameIntent(sc, fingerprint) {
  return String(sc.payloadFingerprint) === String(fingerprint);
}

function toResult(sc, extra = {}) {
  return {
    stayChangeId: sc ? String(sc._id) : null,
    sourceBookingId: sc ? String(sc.bookingId) : null,
    targetBookingId: sc?.targetBookingId ? String(sc.targetBookingId) : null,
    kind: KIND,
    status: sc?.status || null,
    settlementType: sc?.money?.settlementType || null,
    money: sc?.money
      ? {
          sourceContractualTotalCents: sc.money.sourceContractualTotalCents,
          transferredValueCents: sc.money.transferredValueCents,
          canonicalTargetQuoteCents: sc.money.canonicalTargetQuoteCents,
          waivedUpgradeCents: sc.money.waivedUpgradeCents,
          contractualTargetTotalCents: sc.money.contractualTargetTotalCents,
          currency: sc.money.currency
        }
      : null,
    ...extra
  };
}

function err(code, message, status = 409, details = {}) {
  return createDomainError('conflict', message, { code, ...details }, status);
}

function experienceKeysFromBooking(booking) {
  const extras = booking?.craft?.extras;
  if (extras && Array.isArray(extras.experienceKeys)) return extras.experienceKeys;
  if (Array.isArray(booking?.experienceKeys)) return booking.experienceKeys;
  return [];
}

async function loadPaymentTrail(sourceBookingId) {
  return Payment.find({ reservationId: sourceBookingId }).lean();
}

async function markFailed(sc, { code, message, phase, retryable = false }) {
  sc.status = retryable ? 'pending' : 'failed';
  sc.failure = {
    code: code || null,
    message: message || null,
    phase: phase || null,
    at: new Date()
  };
  await sc.save();
  return sc;
}

function requireRebookPermission(ctx) {
  try {
    requirePermission({
      role: ctx.user?.role,
      action: ACTIONS.OPS_RESERVATION_REASSIGN
    });
  } catch (e) {
    if (e?.code === 'PERMISSION_DENIED') {
      const denied = createDomainError('permission', e.message, { code: 'FORBIDDEN' }, 403);
      denied.code = 'PERMISSION_DENIED';
      denied.permission = e.permission;
      throw denied;
    }
    throw e;
  }
}

function mapClaimFailure(e) {
  return err('HARD_CONFLICTS', e?.message || 'Target inventory conflict', 409, {
    cause: e?.code || null,
    claimDetails: e?.details || null
  });
}

async function markNeedsReconciliation(sc, { category, detail, phase }) {
  let mriId = null;
  try {
    const mri = await openManualReviewItem({
      category: MRI_CATEGORY,
      severity: 'critical',
      entityType: 'StayChange',
      entityId: String(sc._id),
      title: `StayChange REBOOK needs reconciliation (${category})`,
      details: detail || category,
      provenance: {
        source: MRI_SOURCE,
        sourceReference: `${String(sc._id)}:${phase || 'recon'}`
      },
      evidence: {
        stayChangeId: String(sc._id),
        bookingId: String(sc.bookingId),
        targetBookingId: sc.targetBookingId ? String(sc.targetBookingId) : null,
        phase: phase || null,
        category
      }
    });
    mriId = mri?._id ? String(mri._id) : null;
  } catch {
    /* ignore MRI failure */
  }
  sc.status = 'needs_reconciliation';
  sc.reconciliation = {
    category: category || null,
    detail: detail || null,
    mriId,
    at: new Date()
  };
  await sc.save();
  return sc;
}

async function projectAuditOnce(sc, ctx) {
  if (sc.auditProjectedAt) return { ok: true, already: true };
  const dedupeKey = sc.auditDedupeKey || auditDedupeKeyFor(sc._id);
  try {
    await appendAuditEvent(
      {
        actorType: sc.actor?.actorType || 'user',
        actorId: sc.actor?.actorId || ctx.user?.id || 'admin',
        actorRole: sc.actor?.actorRole || ctx.user?.role || null,
        entityType: 'Reservation',
        entityId: String(sc.bookingId),
        action: AUDIT_ACTION,
        beforeSnapshot: {
          commercialProductKey: sc.sourceCommercialProductKey
        },
        afterSnapshot: {
          commercialProductKey: sc.targetCommercialProductKey,
          targetBookingId: sc.targetBookingId ? String(sc.targetBookingId) : null
        },
        metadata: {
          stayChangeId: String(sc._id),
          settlementType: sc.money?.settlementType || null,
          transferredValueCents: sc.money?.transferredValueCents ?? null,
          waivedUpgradeCents: sc.money?.waivedUpgradeCents ?? null
        },
        dedupeKey,
        reason: sc.reason || null,
        sourceContext: { route: ctx.route || null, namespace: 'ops' }
      },
      { req: ctx.req }
    );
  } catch (e) {
    if (e?.code === 11000 || String(e?.message || '').includes('E11000')) {
      /* durable dedupe */
    } else {
      try {
        await openManualReviewItem({
          category: MRI_CATEGORY,
          severity: 'high',
          entityType: 'StayChange',
          entityId: String(sc._id),
          title: 'StayChange REBOOK audit projection failed',
          details: e?.message || 'Audit projection failed',
          provenance: { source: MRI_SOURCE, sourceReference: `${String(sc._id)}:audit` },
          evidence: { stayChangeId: String(sc._id), phase: 'audit' }
        });
      } catch {
        /* ignore */
      }
      return { ok: false, error: e };
    }
  }
  sc.auditDedupeKey = dedupeKey;
  sc.auditProjectedAt = new Date();
  await sc.save();
  return { ok: true };
}

async function compensateInsertedTargetClaims(sc, claimAttempt) {
  const insertedIds = normalizeInsertedClaimIds(claimAttempt);
  const insertedNights = Array.isArray(claimAttempt?.insertedNightsThisAttempt)
    ? claimAttempt.insertedNightsThisAttempt
    : [];

  if (sc.targetCabinId) {
    if (insertedIds.length === 0) {
      return { ok: true, deletedCount: 0, scope: 'inserted_this_attempt_empty' };
    }
    return compensateCabinClaimAttempt({
      insertedClaimIdsThisAttempt: insertedIds
    });
  }

  if (sc.targetUnitId) {
    if (insertedNights.length === 0 && insertedIds.length === 0) {
      return { ok: true, deletedCount: 0, scope: 'inserted_this_attempt_empty' };
    }
    // Prefer night-scoped attempt compensation (existing unit primitive).
    return compensateClaimAttempt({
      bookingId: sc.targetBookingId,
      unitId: sc.targetUnitId,
      insertedNightsThisAttempt: insertedNights.length
        ? insertedNights
        : undefined
    });
  }

  return { ok: true, deletedCount: 0 };
}

function normalizeInsertedClaimIds(claimAttempt) {
  if (!claimAttempt || typeof claimAttempt !== 'object') return [];
  if (Array.isArray(claimAttempt.insertedClaimIdsThisAttempt)) {
    return claimAttempt.insertedClaimIdsThisAttempt.map(String).filter(Boolean);
  }
  const nights = new Set(
    (claimAttempt.insertedNightsThisAttempt || []).map((n) => String(n))
  );
  if (nights.size === 0 || !Array.isArray(claimAttempt.claims)) return [];
  return claimAttempt.claims
    .filter((c) => nights.has(String(c.night)))
    .map((c) => String(c.id))
    .filter(Boolean);
}

function sameSofiaDay(a, b) {
  if (a == null || b == null) return false;
  try {
    return canonicalStayDateOnly(a) === canonicalStayDateOnly(b);
  } catch {
    return false;
  }
}

function nullableStringMatchFilter(field, value) {
  if (value == null || value === '') {
    return {
      $or: [{ [field]: null }, { [field]: { $exists: false } }, { [field]: '' }]
    };
  }
  return { [field]: value };
}

async function acquireTargetClaims(sc) {
  if (sc.targetCabinId) {
    return claimCabinNights({
      cabinId: sc.targetCabinId,
      bookingId: sc.targetBookingId,
      checkIn: sc.checkIn,
      checkOut: sc.checkOut,
      stayChangeId: sc._id,
      source: 'rebook'
    });
  }
  return claimUnitNights({
    bookingId: sc.targetBookingId,
    unitId: sc.targetUnitId,
    checkIn: sc.checkIn,
    checkOut: sc.checkOut,
    stayChangeId: sc._id,
    source: 'rebook',
    requireExactStayChangeOwnership: true
  });
}

async function verifyTargetOwnership(sc) {
  if (sc.targetCabinId) {
    return assertBookingOwnsCabinNights({
      cabinId: sc.targetCabinId,
      bookingId: sc.targetBookingId,
      checkIn: sc.checkIn,
      checkOut: sc.checkOut,
      stayChangeId: sc._id,
      mode: 'exact'
    });
  }
  return assertBookingOwnsNights({
    bookingId: sc.targetBookingId,
    unitId: sc.targetUnitId,
    checkIn: sc.checkIn,
    checkOut: sc.checkOut,
    stayChangeId: sc._id,
    mode: 'exact'
  });
}

async function assertSourceOwnsClaims(booking) {
  if (booking.cabinId && !booking.cabinTypeId) {
    return assertBookingOwnsCabinNights({
      cabinId: booking.cabinId,
      bookingId: booking._id,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      mode: 'exact'
    });
  }
  return assertBookingOwnsNights({
    bookingId: booking._id,
    unitId: booking.unitId,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    mode: 'exact'
  });
}

async function releaseSourceClaims(sc, sourceBooking) {
  if (sc.sourceCabinId) {
    return releaseCabinNights({
      bookingId: sc.bookingId,
      cabinId: sc.sourceCabinId,
      checkIn: sc.checkIn,
      checkOut: sc.checkOut
    });
  }
  return releaseUnitNights({
    bookingId: sc.bookingId,
    unitId: sc.sourceUnitId || sourceBooking?.unitId,
    checkIn: sc.checkIn,
    checkOut: sc.checkOut
  });
}

async function tombstoneSourceReservationBlocks(sourceBookingId) {
  await AvailabilityBlock.updateMany(
    {
      reservationId: sourceBookingId,
      blockType: 'reservation',
      status: 'active'
    },
    {
      $set: {
        status: 'tombstoned',
        tombstonedAt: new Date(),
        tombstoneReason: 'reservation_rebooked_or_moved'
      }
    }
  );
}

function buildReplacementDoc(sc, source, contractualTargetTotalCents, status) {
  const totalPrice = contractualTargetTotalCents / 100;
  const doc = {
    _id: sc.targetBookingId,
    guestInfo: {
      firstName: source.guestInfo.firstName,
      lastName: source.guestInfo.lastName,
      email: source.guestInfo.email,
      phone: source.guestInfo.phone
    },
    checkIn: source.checkIn,
    checkOut: source.checkOut,
    adults: source.adults,
    children: source.children || 0,
    specialRequests: source.specialRequests || null,
    cleaningNotes: source.cleaningNotes || null,
    tripType: source.tripType || null,
    transportMethod: source.transportMethod || null,
    romanticSetup: Boolean(source.romanticSetup),
    craft: source.craft || undefined,
    legalAcceptance: source.legalAcceptance,
    totalPrice,
    totalValueCents: contractualTargetTotalCents,
    status,
    settledByStayChangeId: sc._id,
    provenance: {
      source: 'stay_change_rebook',
      channel: source.provenance?.channel || null,
      createdByRoute: 'POST /api/ops/reservations/:id/actions/rebook',
      lastTransition: 'rebook_create',
      lastTransitionAt: new Date()
    },
    isTest: false,
    stripePaymentIntentId: null,
    checkoutId: null,
    checkoutSessionId: null,
    stripePaidAmountCents: null,
    giftVoucherAppliedCents: 0,
    confirmationEmailSentAt: null,
    metaPurchaseSentAt: null,
    suppressGuestEmail: true,
    sendGuestConfirmationEmail: false,
    cancellationSettlement: undefined,
    locationBookingId: undefined,
    attribution: undefined
  };
  if (sc.targetCabinId) {
    doc.cabinId = sc.targetCabinId;
  } else {
    doc.cabinTypeId = sc.targetCabinTypeId;
    doc.unitId = sc.targetUnitId;
  }
  return doc;
}

async function createReplacementBooking(sc, source) {
  const contractual = sc.money.contractualTargetTotalCents;
  const transferred = sc.money.transferredValueCents;
  const status = transferred >= contractual ? 'confirmed' : 'pending';
  const doc = buildReplacementDoc(sc, source, contractual, status);
  try {
    const created = await Booking.create(doc);
    return { ok: true, booking: created, adopted: false };
  } catch (e) {
    if (e?.code === 11000) {
      const existing = await Booking.findById(sc.targetBookingId);
      if (
        existing &&
        String(existing.settledByStayChangeId) === String(sc._id) &&
        String(existing.provenance?.source) === 'stay_change_rebook'
      ) {
        return { ok: true, booking: existing, adopted: true };
      }
      return { ok: false, code: 'REPLACEMENT_PERSISTENCE_FAILED', error: e };
    }
    return { ok: false, code: 'REPLACEMENT_PERSISTENCE_FAILED', error: e };
  }
}

async function casSourceToRebooked(sc, sourceBooking) {
  const snap = sc.sourceSnapshot || {};
  const adults =
    snap.adults != null && Number.isFinite(Number(snap.adults))
      ? Number(snap.adults)
      : sourceBooking?.adults;
  const children =
    snap.children != null && Number.isFinite(Number(snap.children))
      ? Number(snap.children)
      : sourceBooking?.children || 0;
  const romanticSetup =
    snap.romanticSetup != null
      ? Boolean(snap.romanticSetup)
      : Boolean(sourceBooking?.romanticSetup);
  const transportMethod =
    snap.transportMethod !== undefined
      ? snap.transportMethod
      : sourceBooking?.transportMethod == null || sourceBooking?.transportMethod === ''
        ? null
        : String(sourceBooking.transportMethod);

  const and = [
    { _id: sc.bookingId },
    { status: { $in: ELIGIBLE_STATUSES } },
    { checkIn: sc.checkIn },
    { checkOut: sc.checkOut },
    { adults },
    { children },
    { romanticSetup },
    { isTest: { $ne: true } },
    {
      $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }]
    },
    {
      $or: [
        { locationBookingId: null },
        { locationBookingId: { $exists: false } }
      ]
    },
    {
      $or: [
        { cancellationSettlement: { $exists: false } },
        { cancellationSettlement: null },
        {
          'cancellationSettlement.outcome': {
            $nin: ['rebooked_or_moved']
          }
        }
      ]
    },
    {
      $or: [
        { 'cancellationSettlement.replacementBookingId': { $exists: false } },
        { 'cancellationSettlement.replacementBookingId': null }
      ]
    },
    nullableStringMatchFilter('transportMethod', transportMethod)
  ];

  if (sc.sourceCabinId) {
    and.push({ cabinId: sc.sourceCabinId });
  } else {
    and.push({ cabinTypeId: sc.sourceCabinTypeId });
    and.push({ unitId: sc.sourceUnitId });
  }

  const financialSnapshot = {
    bookingTotalCents:
      sc.money?.sourceContractualTotalCents ??
      snap.sourceContractualTotalCents ??
      null,
    stripePaidAmountCents: Number.isFinite(sourceBooking?.stripePaidAmountCents)
      ? sourceBooking.stripePaidAmountCents
      : null,
    voucherAppliedCents: Number.isFinite(sourceBooking?.giftVoucherAppliedCents)
      ? sourceBooking.giftVoucherAppliedCents
      : null,
    netCashPaidCents: null,
    currency: 'EUR',
    capturedAt: new Date()
  };

  const result = await Booking.updateOne(
    { $and: and },
    {
      $set: {
        status: 'cancelled',
        cancellationSettlement: {
          outcome: 'rebooked_or_moved',
          replacementBookingId: sc.targetBookingId,
          settlementRecordedAt: new Date(),
          financialSnapshot
        },
        'provenance.lastTransition': 'rebook_source_projected',
        'provenance.lastTransitionAt': new Date()
      }
    }
  );
  return {
    matched: (result.matchedCount ?? result.n) > 0,
    modified: (result.modifiedCount ?? result.nModified) > 0
  };
}

async function verifyCompletionInvariant(sc) {
  const target = await Booking.findById(sc.targetBookingId).lean();
  if (!target) return { ok: false, reason: 'target_booking_missing' };
  if (String(target._id) !== String(sc.targetBookingId)) {
    return { ok: false, reason: 'target_id_mismatch' };
  }
  if (String(target.settledByStayChangeId) !== String(sc._id)) {
    return { ok: false, reason: 'settledByStayChangeId_mismatch' };
  }
  if (String(target.provenance?.source) !== 'stay_change_rebook') {
    return { ok: false, reason: 'provenance_mismatch' };
  }
  const key = commercialProductKeyFromBooking(target);
  if (key !== sc.targetCommercialProductKey) {
    return { ok: false, reason: 'target_product_mismatch' };
  }
  if (sc.targetCabinId && String(target.cabinId) !== String(sc.targetCabinId)) {
    return { ok: false, reason: 'target_cabin_mismatch' };
  }
  if (sc.targetCabinTypeId && String(target.cabinTypeId) !== String(sc.targetCabinTypeId)) {
    return { ok: false, reason: 'target_cabinType_mismatch' };
  }
  if (sc.targetUnitId && String(target.unitId) !== String(sc.targetUnitId)) {
    return { ok: false, reason: 'target_unit_mismatch' };
  }

  const snap = sc.targetSnapshot || {};
  if (!sameSofiaDay(target.checkIn, snap.checkIn || sc.checkIn)) {
    return { ok: false, reason: 'target_checkIn_mismatch' };
  }
  if (!sameSofiaDay(target.checkOut, snap.checkOut || sc.checkOut)) {
    return { ok: false, reason: 'target_checkOut_mismatch' };
  }
  if (Number(target.adults) !== Number(snap.adults)) {
    return { ok: false, reason: 'target_adults_mismatch' };
  }
  if (Number(target.children || 0) !== Number(snap.children || 0)) {
    return { ok: false, reason: 'target_children_mismatch' };
  }

  const own = await verifyTargetOwnership(sc);
  if (!own.ok) return { ok: false, reason: 'target_claims_inexact', detail: own };

  const source = await Booking.findById(sc.bookingId).lean();
  if (!source || source.status !== 'cancelled') {
    return { ok: false, reason: 'source_not_cancelled' };
  }
  if (source.cancellationSettlement?.outcome !== 'rebooked_or_moved') {
    return { ok: false, reason: 'source_outcome_mismatch' };
  }
  if (String(source.cancellationSettlement?.replacementBookingId) !== String(sc.targetBookingId)) {
    return { ok: false, reason: 'replacement_link_mismatch' };
  }

  if (sc.sourceCabinId) {
    const left = await assertBookingOwnsCabinNights({
      cabinId: sc.sourceCabinId,
      bookingId: sc.bookingId,
      checkIn: sc.checkIn,
      checkOut: sc.checkOut,
      mode: 'exact'
    });
    if (left.ok) return { ok: false, reason: 'source_claims_remain' };
  } else if (sc.sourceUnitId) {
    const left = await assertBookingOwnsNights({
      bookingId: sc.bookingId,
      unitId: sc.sourceUnitId,
      checkIn: sc.checkIn,
      checkOut: sc.checkOut,
      mode: 'exact'
    });
    if (left.ok) return { ok: false, reason: 'source_claims_remain' };
  }

  const payments = await Payment.find({ reservationId: sc.bookingId }).select('reservationId').lean();
  for (const p of payments) {
    if (String(p.reservationId) !== String(sc.bookingId)) {
      return { ok: false, reason: 'payment_moved' };
    }
  }
  const dupTargets = await Booking.countDocuments({
    'provenance.source': 'stay_change_rebook',
    settledByStayChangeId: sc._id,
    _id: { $ne: sc.targetBookingId }
  });
  if (dupTargets > 0) {
    return { ok: false, reason: 'duplicate_replacement' };
  }
  return { ok: true };
}

async function advanceToCompleted(sc, ctx) {
  const inv = await verifyCompletionInvariant(sc);
  if (!inv.ok) {
    await markNeedsReconciliation(sc, {
      category: 'COMPLETION_INVARIANT_FAILED',
      detail: inv.reason,
      phase: 'complete'
    });
    return sc;
  }
  sc.status = 'completed';
  sc.completedAt = new Date();
  await sc.save();
  await projectAuditOnce(sc, ctx);
  return sc;
}

async function createPendingStayChange(doc) {
  try {
    const sc = await StayChange.create(doc);
    sc.auditDedupeKey = auditDedupeKeyFor(sc._id);
    await sc.save();
    return sc;
  } catch (e) {
    if (e?.code === 11000) {
      const existing = await StayChange.findOne({
        kind: KIND,
        bookingId: doc.bookingId,
        idempotencyKey: doc.idempotencyKey
      });
      if (!existing) throw e;
      if (!sameIntent(existing, doc.payloadFingerprint)) {
        throw err(
          'IDEMPOTENCY_KEY_CONFLICT',
          'Idempotency key already used with a different REBOOK payload',
          409,
          { stayChangeId: String(existing._id) }
        );
      }
      return existing;
    }
    throw e;
  }
}

/**
 * Resume forward from durable StayChange facts.
 */
async function reconcileRebookStayChange(stayChangeId, ctx = {}) {
  const sc = await StayChange.findById(stayChangeId);
  if (!sc) {
    throw createDomainError('validation', 'StayChange not found', { stayChangeId }, 404);
  }
  if (sc.kind !== KIND) {
    throw createDomainError('validation', 'StayChange is not a rebook operation', { kind: sc.kind });
  }
  if (sc.status === 'completed') {
    return toResult(sc, { changed: false, resumed: true });
  }
  if (sc.status === 'needs_reconciliation') {
    throw err(
      'NEEDS_RECONCILIATION',
      'REBOOK StayChange needs reconciliation; refuse blind restart',
      409,
      { stayChangeId: String(sc._id) }
    );
  }
  if (sc.status === 'failed') {
    // Retryable only when no irreversible target Booking exists and claims are clean.
    const targetExists = sc.targetBookingId
      ? await Booking.findById(sc.targetBookingId).select('_id').lean()
      : null;
    if (targetExists) {
      await markNeedsReconciliation(sc, {
        category: 'FAILED_WITH_TARGET',
        detail: 'failed StayChange has target Booking; refuse blind restart',
        phase: 'resume'
      });
      throw err('NEEDS_RECONCILIATION', 'Failed REBOOK with target Booking needs reconciliation', 409, {
        stayChangeId: String(sc._id)
      });
    }
    sc.status = 'pending';
    await sc.save();
  }
  if (
    sc.status === 'awaiting_payment' ||
    sc.status === 'ready_to_commit' ||
    sc.status === 'settling'
  ) {
    await markNeedsReconciliation(sc, {
      category: 'UNEXPECTED_S3_STATUS',
      detail: sc.status,
      phase: 'resume'
    });
    throw err('NEEDS_RECONCILIATION', 'Unexpected REBOOK status for S3 resume', 409, {
      stayChangeId: String(sc._id),
      status: sc.status
    });
  }

  const source = await Booking.findById(sc.bookingId);
  if (!source && sc.status !== 'committed') {
    await markNeedsReconciliation(sc, {
      category: 'SOURCE_MISSING',
      detail: 'Source Booking missing',
      phase: 'resume'
    });
    throw err('NEEDS_RECONCILIATION', 'Source Booking missing during resume', 409);
  }

  if (sc.status === 'pending') {
    return runForwardFromPending(sc, source, ctx);
  }
  if (sc.status === 'inventory_secured') {
    return runForwardFromInventorySecured(sc, source, ctx);
  }
  if (sc.status === 'committed') {
    return runForwardFromCommitted(sc, source, ctx);
  }
  return toResult(sc, { changed: false });
}

async function runForwardFromPending(sc, source, ctx) {
  let claimAttempt = { insertedClaimIdsThisAttempt: [], insertedNightsThisAttempt: [] };
  try {
    claimAttempt = await acquireTargetClaims(sc);
    const own = await verifyTargetOwnership(sc);
    if (!own.ok) {
      try {
        await compensateInsertedTargetClaims(sc, claimAttempt);
      } catch {
        await markNeedsReconciliation(sc, {
          category: 'TARGET_COMPENSATE_FAILED',
          detail: 'Target claim ownership incomplete; compensate failed',
          phase: 'claim'
        });
        throw err('NEEDS_RECONCILIATION', 'Target claim verify failed and compensation failed', 409);
      }
      await markFailed(sc, {
        code: 'TARGET_CLAIM_VERIFY_FAILED',
        message: 'Target claim ownership incomplete',
        phase: 'claim',
        retryable: true
      });
      throw err('HARD_CONFLICTS', 'Target inventory ownership incomplete after claim', 409);
    }
    sc.status = 'inventory_secured';
    sc.failure = undefined;
    await sc.save();
  } catch (e) {
    if (e?.details?.code === 'HARD_CONFLICTS' || e?.details?.code === 'NEEDS_RECONCILIATION') {
      throw e;
    }
    if (e?.details?.code && e?.type) throw e;
    try {
      await compensateInsertedTargetClaims(sc, claimAttempt);
    } catch {
      await markNeedsReconciliation(sc, {
        category: 'TARGET_COMPENSATE_FAILED',
        detail: e?.message || 'claim failed',
        phase: 'claim'
      });
      throw err('NEEDS_RECONCILIATION', 'Target claim failed and compensation failed', 409);
    }
    await markFailed(sc, {
      code: e?.code || 'TARGET_CLAIM_FAILED',
      message: e?.message || 'Target claim failed',
      phase: 'claim',
      retryable: true
    });
    throw mapClaimFailure(e);
  }
  return runForwardFromInventorySecured(sc, source, ctx, claimAttempt);
}

async function runForwardFromInventorySecured(sc, source, ctx, claimAttempt = null) {
  const attempt = claimAttempt || {
    insertedClaimIdsThisAttempt: [],
    insertedNightsThisAttempt: []
  };
  const created = await createReplacementBooking(sc, source);
  if (!created.ok) {
    const hasInserted =
      normalizeInsertedClaimIds(attempt).length > 0 ||
      (Array.isArray(attempt.insertedNightsThisAttempt) &&
        attempt.insertedNightsThisAttempt.length > 0);
    try {
      if (hasInserted) {
        await compensateInsertedTargetClaims(sc, attempt);
        await markFailed(sc, {
          code: 'REPLACEMENT_PERSISTENCE_FAILED',
          message: created.error?.message || 'Booking create failed',
          phase: 'replacement',
          retryable: true
        });
      }
      // No inserted-this-attempt claims: leave inventory_secured + prior claims intact.
    } catch {
      await markNeedsReconciliation(sc, {
        category: 'REPLACEMENT_FAIL_COMPENSATE_FAIL',
        detail: created.error?.message || 'Booking create failed',
        phase: 'replacement'
      });
    }
    throw err(
      'REPLACEMENT_PERSISTENCE_FAILED',
      'Replacement Booking persistence failed',
      500
    );
  }

  sc.status = 'committed';
  await sc.save();
  return runForwardFromCommitted(sc, source, ctx);
}

async function runForwardFromCommitted(sc, source, ctx) {
  // Ensure source projected
  const freshSource = source || (await Booking.findById(sc.bookingId));
  if (!freshSource || freshSource.cancellationSettlement?.outcome !== 'rebooked_or_moved') {
    const cas = await casSourceToRebooked(sc, freshSource);
    if (!cas.matched) {
      await markNeedsReconciliation(sc, {
        category: 'SOURCE_CAS_FAILED',
        detail: 'Source CAS matchedCount=0 after target committed',
        phase: 'source_cas'
      });
      throw err('SOURCE_CHANGED', 'Source Booking changed during REBOOK commit', 409, {
        stayChangeId: String(sc._id)
      });
    }
  }

  try {
    await tombstoneSourceReservationBlocks(sc.bookingId);
  } catch {
    /* projection non-fatal; continue toward release */
  }

  try {
    await releaseSourceClaims(sc, freshSource);
  } catch (e) {
    await markNeedsReconciliation(sc, {
      category: 'SOURCE_RELEASE_FAILED',
      detail: e?.message || 'source release failed',
      phase: 'source_release'
    });
    throw err('NEEDS_RECONCILIATION', 'Source inventory release failed', 409, {
      stayChangeId: String(sc._id)
    });
  }

  await advanceToCompleted(sc, ctx);
  return toResult(await StayChange.findById(sc._id), { changed: true, resumed: true });
}

async function resolveTargetEntity({ targetCabinId, targetCabinTypeId, targetUnitId }) {
  if (targetCabinId && (targetCabinTypeId || targetUnitId)) {
    throw err('INVALID_TARGET', 'Mixed target identity', 400);
  }
  if (targetCabinId) {
    const cabin = await Cabin.findById(targetCabinId);
    if (!cabin || cabin.isActive === false) {
      throw err('INVALID_TARGET', 'Target cabin not found or inactive', 409);
    }
    if (cabin.archivedAt) {
      throw err('INVALID_TARGET', 'Target cabin is archived', 409);
    }
    return {
      shape: 'single',
      entity: cabin,
      cabinId: cabin._id,
      cabinTypeId: null,
      unitId: null,
      commercialProductKey: `cabin:${cabin._id}`
    };
  }
  if (targetCabinTypeId && targetUnitId) {
    const cabinType = await CabinType.findById(targetCabinTypeId);
    if (!cabinType || cabinType.isActive === false) {
      throw err('INVALID_TARGET', 'Target cabin type not found or inactive', 409);
    }
    const unit = await Unit.findById(targetUnitId);
    if (!unit || !unit.isActive) {
      throw err('INVALID_TARGET', 'Target unit not found or inactive', 409);
    }
    if (String(unit.cabinTypeId) !== String(targetCabinTypeId)) {
      throw err('INVALID_TARGET', 'Target unit does not belong to cabin type', 409);
    }
    return {
      shape: 'allocated_multi',
      entity: cabinType,
      cabinId: null,
      cabinTypeId: cabinType._id,
      unitId: unit._id,
      commercialProductKey: `cabinType:${cabinType._id}`
    };
  }
  throw err('INVALID_TARGET', 'Target must be cabinId XOR (cabinTypeId+unitId)', 400);
}

async function evaluateExternalAndHardConflicts(booking, target) {
  let cabinIdForConflict = target.cabinId;
  if (!cabinIdForConflict && target.cabinTypeId) {
    const parent = await findParentCabinForCabinType(target.cabinTypeId);
    cabinIdForConflict = parent?._id;
  }
  if (!cabinIdForConflict) {
    throw err('INVALID_TARGET', 'Cannot resolve parent cabin for conflict evaluation', 409);
  }
  const conflicts = await evaluateTargetConflicts({
    cabinId: cabinIdForConflict,
    unitId: target.unitId || null,
    cabinTypeId: target.cabinTypeId || null,
    startDate: booking.checkIn,
    endDate: booking.checkOut,
    treatExternalHoldAsHard: false,
    excludeReservationId: booking._id
  });
  return conflicts;
}

/**
 * Entry: REBOOK mutation.
 */
async function rebookReservation({
  bookingId,
  targetCabinId = null,
  targetCabinTypeId = null,
  targetUnitId = null,
  idempotencyKey,
  reason = null,
  acceptExternalHoldWarnings = false,
  waiveUpgradeCents = 0,
  ctx = {}
}) {
  requireRebookPermission(ctx);
  await assertStayChangeIdempotencyIndex();

  const key = normalizeIdempotencyKey(idempotencyKey);
  if (!isValidIdempotencyKey(key)) {
    throw createDomainError('validation', 'idempotencyKey is required (8–128 characters)', {
      code: 'IDEMPOTENCY_KEY_INVALID'
    });
  }

  const waiverCents = Number(waiveUpgradeCents || 0);
  if (!Number.isInteger(waiverCents) || waiverCents < 0) {
    throw createDomainError('validation', 'waiveUpgradeCents must be a non-negative integer', {
      code: 'WAIVER_INVALID'
    });
  }

  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw createDomainError('validation', 'Booking not found', { code: 'UNSUPPORTED_SOURCE' }, 404);
  }

  const existing = await StayChange.findOne({
    kind: KIND,
    bookingId: booking._id,
    idempotencyKey: key
  });

  /**
   * When an idempotent StayChange already exists, resume without re-applying source
   * operational eligibility (source may already be cancelled / rebooked_or_moved).
   */
  if (existing) {
    const target = await resolveTargetEntity({
      targetCabinId,
      targetCabinTypeId,
      targetUnitId
    });
    const canonicalTargetQuoteCents =
      existing.money?.canonicalTargetQuoteCents != null
        ? Number(existing.money.canonicalTargetQuoteCents)
        : (
            await computeQuoteFromEntity(
              target.entity,
              booking.checkIn,
              booking.checkOut,
              booking.adults,
              booking.children || 0,
              experienceKeysFromBooking(booking),
              booking.transportMethod,
              booking.romanticSetup,
              null
            )
          ).totalPrice * 100;
    const roundedQuote = Math.round(Number(canonicalTargetQuoteCents));
    const fingerprint = buildPayloadFingerprint({
      kind: KIND,
      bookingId: booking._id,
      targetCommercialProductKey: target.commercialProductKey,
      targetCabinId: target.cabinId,
      targetCabinTypeId: target.cabinTypeId,
      targetUnitId: target.unitId,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      adults: booking.adults,
      children: booking.children || 0,
      canonicalTargetQuoteCents: roundedQuote,
      waiveUpgradeCents: waiverCents,
      acceptExternalHoldWarnings,
      reason
    });
    if (!sameIntent(existing, fingerprint)) {
      throw err(
        'IDEMPOTENCY_KEY_CONFLICT',
        'Idempotency key already used with a different REBOOK payload',
        409,
        { stayChangeId: String(existing._id) }
      );
    }
    return reconcileRebookStayChange(existing._id, ctx);
  }

  if (booking.isTest) {
    throw err('UNSUPPORTED_SOURCE', 'Test bookings cannot REBOOK', 409);
  }
  if (booking.archivedAt) {
    throw err('UNSUPPORTED_SOURCE', 'Archived bookings cannot REBOOK', 409);
  }
  if (booking.locationBookingId) {
    throw err('UNSUPPORTED_SOURCE', 'LocationBooking cannot REBOOK in v1', 409);
  }
  if (!ELIGIBLE_STATUSES.includes(booking.status)) {
    throw err('UNSUPPORTED_SOURCE', 'Source status is not eligible for REBOOK', 409, {
      status: booking.status
    });
  }
  if (booking.cancellationSettlement?.outcome === 'rebooked_or_moved') {
    throw err('UNSUPPORTED_SOURCE', 'Source already rebooked or moved', 409);
  }

  const promo = detectPromotionalSourceEconomics(booking);
  if (promo.promotional) {
    throw err(
      'UNSUPPORTED_SOURCE',
      'Source promotional or voucher pricing is not supported for REBOOK v1',
      409,
      {
        reason: PROMO_REASON,
        evidenceKeys: promo.evidenceKeys
      }
    );
  }

  const sourceShape = validateCommercialShape({
    cabinId: booking.cabinId,
    cabinTypeId: booking.cabinTypeId,
    unitId: booking.unitId,
    locationBookingId: booking.locationBookingId,
    allowUnallocatedMulti: false
  });
  if (!sourceShape.ok) {
    throw err('UNSUPPORTED_SOURCE', sourceShape.message, 409, { codeDetail: sourceShape.code });
  }

  const sourceOwns = await assertSourceOwnsClaims(booking);
  if (!sourceOwns.ok) {
    throw err('UNSUPPORTED_SOURCE', 'Source does not own expected inventory claims', 409, {
      ownership: sourceOwns
    });
  }

  const target = await resolveTargetEntity({
    targetCabinId,
    targetCabinTypeId,
    targetUnitId
  });

  const route = classifyStayChangeRoute({
    source: {
      cabinId: booking.cabinId,
      cabinTypeId: booking.cabinTypeId,
      unitId: booking.unitId
    },
    target: {
      cabinId: target.cabinId,
      cabinTypeId: target.cabinTypeId,
      unitId: target.unitId
    }
  });
  if (route === 'reallocate') {
    throw err('SAME_COMMERCIAL_PRODUCT', 'Same cabinType unit move belongs to REALLOCATE', 409);
  }
  if (route === 'noop' || route === 'amend') {
    throw err('SAME_COMMERCIAL_PRODUCT', 'Same commercial product is not REBOOK', 409);
  }
  if (route !== 'rebook') {
    throw err('SAME_COMMERCIAL_PRODUCT', 'Request is not a cross-product REBOOK', 409, { route });
  }

  const trail = await loadPaymentTrail(booking._id);
  const contractual = resolveSourceContractualTotalCents(booking);
  if (!contractual.ok) {
    throw err('PAYMENT_EVIDENCE_AMBIGUOUS', 'Invalid source contractual total', 409, {
      coverageCode: contractual.code
    });
  }
  const coverage = resolveRecognizedNetSettledCoverageCents(booking, trail);
  if (!coverage.ok) {
    throw err('PAYMENT_EVIDENCE_AMBIGUOUS', 'Recognized source coverage cannot be determined', 409, {
      coverageCode: coverage.code,
      detail: coverage.detail || null
    });
  }
  const transferred = computeTransferredValueCents(contractual.cents, coverage.cents);
  if (!transferred.ok) {
    throw err('PAYMENT_EVIDENCE_AMBIGUOUS', 'transferredValueCents invalid', 409);
  }

  const quote = await computeQuoteFromEntity(
    target.entity,
    booking.checkIn,
    booking.checkOut,
    booking.adults,
    booking.children || 0,
    experienceKeysFromBooking(booking),
    booking.transportMethod,
    booking.romanticSetup,
    null
  );
  const canonicalTargetQuoteCents = Math.round(Number(quote.totalPrice) * 100);
  if (!Number.isInteger(canonicalTargetQuoteCents) || canonicalTargetQuoteCents < 0) {
    throw err('INVALID_TARGET', 'Target quote could not be computed', 409);
  }

  let settlementType;
  let waivedUpgradeCents = 0;
  if (canonicalTargetQuoteCents < contractual.cents) {
    throw err('DOWNGRADE_UNSUPPORTED', 'Cheaper target is not supported in S3', 409);
  }
  if (canonicalTargetQuoteCents === contractual.cents) {
    if (waiverCents > 0) {
      throw err('WAIVER_NOT_APPLICABLE', 'Waiver not applicable for equal-price REBOOK', 409);
    }
    settlementType = 'equal_price';
    waivedUpgradeCents = 0;
  } else {
    const expectedWaiver = canonicalTargetQuoteCents - contractual.cents;
    if (waiverCents !== expectedWaiver) {
      throw err(
        'UPGRADE_WAIVER_REQUIRED',
        'S3 requires full complimentary waiver of the upgrade delta',
        409,
        { expectedWaiverCents: expectedWaiver, waiveUpgradeCents: waiverCents }
      );
    }
    settlementType = 'complimentary_upgrade';
    waivedUpgradeCents = expectedWaiver;
  }

  const contractualTarget = computeContractualTargetTotalCents(
    canonicalTargetQuoteCents,
    waivedUpgradeCents
  );
  if (!contractualTarget.ok) {
    throw err('UPGRADE_WAIVER_REQUIRED', 'Invalid contractual target total', 409);
  }

  const conflicts = await evaluateExternalAndHardConflicts(booking, target);
  if (conflicts.hasHardConflicts) {
    throw err('HARD_CONFLICTS', 'Target has hard inventory conflicts', 409, {
      hardConflicts: conflicts.hardConflicts
    });
  }
  if (conflicts.warnings.length > 0 && !acceptExternalHoldWarnings) {
    throw err(
      'EXTERNAL_HOLD_ACK_REQUIRED',
      'Target has external hold warnings; acknowledgement required',
      409,
      { warnings: conflicts.warnings }
    );
  }

  const fingerprint = buildPayloadFingerprint({
    kind: KIND,
    bookingId: booking._id,
    targetCommercialProductKey: target.commercialProductKey,
    targetCabinId: target.cabinId,
    targetCabinTypeId: target.cabinTypeId,
    targetUnitId: target.unitId,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    adults: booking.adults,
    children: booking.children || 0,
    canonicalTargetQuoteCents,
    waiveUpgradeCents: waivedUpgradeCents,
    acceptExternalHoldWarnings,
    reason
  });

  const sourceSnap = buildSourceSnapshot({
    booking,
    sourceContractualTotalCents: contractual.cents,
    recognizedNetSettledCoverageCents: coverage.cents,
    currency: 'eur'
  });
  if (!sourceSnap.ok) {
    throw err('UNSUPPORTED_SOURCE', sourceSnap.message || 'Source snapshot failed', 409);
  }
  const targetSnap = buildTargetSnapshot({
    cabinId: target.cabinId,
    cabinTypeId: target.cabinTypeId,
    unitId: target.unitId,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    adults: booking.adults,
    children: booking.children || 0,
    canonicalTargetQuoteCents,
    currency: 'eur'
  });
  if (!targetSnap.ok) {
    throw err('INVALID_TARGET', targetSnap.message || 'Target snapshot failed', 409);
  }

  const targetBookingId = new mongoose.Types.ObjectId();
  if (String(targetBookingId) === String(booking._id)) {
    throw err('INVALID_TARGET', 'targetBookingId must differ from source', 500);
  }

  const sc = await createPendingStayChange({
    kind: KIND,
    bookingId: booking._id,
    targetBookingId,
    sourceCommercialProductKey: sourceShape.commercialProductKey,
    targetCommercialProductKey: target.commercialProductKey,
    sourceCabinId: booking.cabinId || null,
    targetCabinId: target.cabinId || null,
    sourceCabinTypeId: booking.cabinTypeId || null,
    targetCabinTypeId: target.cabinTypeId || null,
    sourceUnitId: booking.unitId || null,
    targetUnitId: target.unitId || null,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    status: 'pending',
    idempotencyKey: key,
    payloadFingerprint: fingerprint,
    actor: {
      actorType: 'user',
      actorId: ctx.user?.id || 'admin',
      actorRole: ctx.user?.role || 'admin'
    },
    reason: reason || null,
    externalHoldWarningsAccepted: Boolean(acceptExternalHoldWarnings),
    sourceSnapshot: sourceSnap.snapshot,
    targetSnapshot: targetSnap.snapshot,
    money: {
      sourceContractualTotalCents: contractual.cents,
      recognizedNetSettledCoverageCents: coverage.cents,
      transferredValueCents: transferred.cents,
      canonicalTargetQuoteCents,
      waivedUpgradeCents,
      additionalChargeCents: 0,
      refundCents: 0,
      creditCents: 0,
      retainedCents: 0,
      contractualTargetTotalCents: contractualTarget.cents,
      settlementType,
      currency: 'eur'
    }
  });

  if (String(sc.payloadFingerprint) !== fingerprint) {
    throw err('IDEMPOTENCY_KEY_CONFLICT', 'Idempotency race with different payload', 409);
  }

  return reconcileRebookStayChange(sc._id, ctx);
}

module.exports = {
  rebookReservation,
  reconcileRebookStayChange,
  buildPayloadFingerprint,
  canonicalStayDateOnly,
  KIND,
  ELIGIBLE_STATUSES,
  MRI_CATEGORY,
  AUDIT_ACTION,
  FINGERPRINT_KEYS,
  auditDedupeKeyFor,
  detectPromotionalSourceEconomics,
  PROMO_REASON,
  normalizeInsertedClaimIds
};
