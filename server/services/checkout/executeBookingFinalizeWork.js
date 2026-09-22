const Booking = require('../../models/Booking');
const BookingInstallment = require('../../models/BookingInstallment');
const PromoCode = require('../../models/PromoCode');
const mongoose = require('mongoose');
const { BLOCKING_BOOKING_STATUSES } = require('../calendar/blockingStatusConstants');
const {
  CHECKOUT_SESSION_ERROR_CODES,
  CheckoutSessionError
} = require('./checkoutSessionErrors');
const {
  linkStripePaymentToBooking,
  verifyPaymentLinkedToBooking
} = require('../payments/paymentLinkingService');
const {
  confirmVoucherReservation,
  releaseVoucherReservation
} = require('../bookings/bookingVoucherRedemptionService');
const {
  countBlockingBlocksForSingleCabin,
  countBlockingBlocksForUnit,
  findParentCabinForCabinType
} = require('../publicAvailabilityService');
const AssignmentEngine = require('../assignmentEngine');
const {
  ensureUnitNightClaimsShadow
} = require('../inventory/ensureUnitNightClaimsShadow');
const {
  ensureUnitNightClaimsReleasedShadow,
  LIFECYCLE_SOURCES
} = require('../inventory/ensureUnitNightClaimsReleasedShadow');
const {
  ensureCabinNightClaimsShadow,
  S1_SOURCES: CABIN_S1_SOURCES
} = require('../inventory/ensureCabinNightClaimsShadow');
const {
  ensureCabinNightClaimsReleasedShadow
} = require('../inventory/ensureCabinNightClaimsReleasedShadow');
const {
  preAcquireCabinNightsForCreate,
  compensateCreateAttemptClaims,
  postMirrorCabinNightsAfterCanonical,
  releaseCabinNightsAfterCanonicalNonOwning,
  CLAIM_ERR: CABIN_CLAIM_ERR
} = require('../inventory/cabinNightClaimAuthorityOps');
const { isValidSingleCabinCommercialShape } = require('../inventory/cabinNightClaimQualification');
const {
  claimUnitNights,
  compensateClaimAttempt,
  releaseUnitNights,
  ERR: CLAIM_ERR
} = require('../inventory/unitNightClaimService');
const { openManualReviewItem } = require('../ops/ingestion/manualReviewService');
const {
  recordPaidBookingResolutionIssueSafe
} = require('../payments/paidBookingFinalizationObservability');
const {
  promoteAccommodationCheckoutHoldToBooking,
  tombstonePromotedAccommodationCheckoutHold,
  AccommodationCheckoutHoldError
} = require('./accommodationCheckoutHoldService');
const {
  confirmExactFacilityHoldsForPaidCheckout,
  assertQuoteLeaseFacilityConsistency
} = require('../facilityBookingService');

/** I4/I6 + S1.2: release shadow claims before canonical Booking delete. */
async function shadowReleaseBeforeBookingDelete(deps, bookingId, lifecycleSource) {
  const releaseFn =
    deps.ensureUnitNightClaimsReleasedShadow || ensureUnitNightClaimsReleasedShadow;
  if (typeof releaseFn === 'function' && bookingId) {
    try {
      await releaseFn({
        bookingId,
        lifecycleSource: lifecycleSource || LIFECYCLE_SOURCES.FINALIZE_CLEANUP
      });
    } catch {
      /* never block canonical delete */
    }
  }
}

/**
 * S1.7 §24.44.14: authoritative cabin claims may only be released once the
 * Booking has stopped blocking, so this runs AFTER the canonical delete.
 */
async function releaseCabinClaimsAfterBookingDelete(deps, bookingId, lifecycleSource) {
  const cabinReleaseFn =
    deps.releaseCabinNightsAfterCanonicalNonOwning || releaseCabinNightsAfterCanonicalNonOwning;
  if (typeof cabinReleaseFn !== 'function' || !bookingId) return;
  try {
    await cabinReleaseFn({
      bookingId,
      lifecycleSource: lifecycleSource || LIFECYCLE_SOURCES.FINALIZE_CLEANUP,
      openManualReviewItemFn:
        typeof deps.shadowClaimOpenManualReviewItem === 'function'
          ? deps.shadowClaimOpenManualReviewItem
          : openManualReviewItem
    });
  } catch {
    /* release failure leaves conservative claims for reconciliation */
  }
}

function sameObjectIdish(a, b) {
  if (!a || !b) return false;
  return String(a) === String(b);
}

function sameIsoDateish(a, b) {
  if (!a || !b) return false;
  try {
    return new Date(a).toISOString() === new Date(b).toISOString();
  } catch {
    return false;
  }
}

function validateTransportMethod(value, transportOptions) {
  if (!value || value === 'Not selected') return null;
  const opts = Array.isArray(transportOptions) ? transportOptions : [];
  const match = opts.find((t) => t && t.type === value);
  return match ? value : null;
}

function bookingMatchesCheckoutFingerprint(booking, expected) {
  if (!booking || !expected) return false;
  if (expected.cabinId && !sameObjectIdish(booking.cabinId, expected.cabinId)) return false;
  if (expected.cabinTypeId && !sameObjectIdish(booking.cabinTypeId, expected.cabinTypeId)) return false;
  if (!sameIsoDateish(booking.checkIn, expected.checkInDate)) return false;
  if (!sameIsoDateish(booking.checkOut, expected.checkOutDate)) return false;
  if (Number(booking.adults || 0) !== Number(expected.adults || 0)) return false;
  if (Number(booking.children || 0) !== Number(expected.children || 0)) return false;
  if (expected.paymentIntentId) {
    if (String(booking.stripePaymentIntentId || '') !== String(expected.paymentIntentId)) {
      return false;
    }
  }
  return true;
}

function buildCheckoutFingerprintFromContext({ finalizeContext, paymentIntentId }) {
  const ctx = finalizeContext || {};
  return {
    cabinId: ctx.cabinId || null,
    cabinTypeId: ctx.cabinTypeId || null,
    checkInDate: ctx.checkInDate,
    checkOutDate: ctx.checkOutDate,
    adults: parseInt(ctx.adults, 10),
    children: parseInt(ctx.children ?? 0, 10),
    paymentIntentId: paymentIntentId || ctx.paymentIntentId || null
  };
}

function defaultGuestNeedsReviewPayload(paymentIntentId) {
  return {
    success: false,
    code: 'PAYMENT_RECEIVED_BOOKING_NEEDS_REVIEW',
    message:
      'Your payment was received, but we could not automatically finalize the booking. We have flagged it for manual review and will contact you shortly.',
    paymentIntentId: paymentIntentId ? String(paymentIntentId) : null,
    requiresManualReview: true
  };
}

function createPaidBookingSaveFailedError({
  errorCode,
  errorSummary,
  paymentIntentId,
  guestPayload,
  finalizationStage = null,
  observabilityRecorded = false
}) {
  const err = new Error(errorSummary || 'Paid booking finalization failed');
  err.code = 'PAID_BOOKING_SAVE_FAILED';
  err.needsReview = true;
  err.errorCode = errorCode || null;
  err.guestPayload = guestPayload || defaultGuestNeedsReviewPayload(paymentIntentId);
  err.finalizationStage = finalizationStage || null;
  err.observabilityRecorded = Boolean(observabilityRecorded);
  return err;
}

function createVoucherConfirmFailedError(message) {
  const err = new Error(message || 'Voucher reservation confirmation failed after booking save');
  err.code = 'VOUCHER_CONFIRM_FAILED';
  err.needsReview = true;
  return err;
}

function createRouteStyleError(code, message, extra = {}) {
  const err = new Error(message || code);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

function resolveInitialStatus({ finalizeContext, paymentIntentId }) {
  const ctx = finalizeContext || {};
  if (ctx.initialStatus) {
    return ctx.initialStatus;
  }
  if (ctx.stripePaymentVerified) {
    return 'confirmed';
  }
  if (
    ctx.voucherReservationContext &&
    Number(ctx.stripePaidAmountCents || 0) === 0 &&
    Number(ctx.giftVoucherAppliedCents || 0) > 0
  ) {
    return 'confirmed';
  }
  if (!paymentIntentId && process.env.BOOKING_CONFIRM_WITHOUT_STRIPE === '1') {
    return 'confirmed';
  }
  return 'pending';
}

function createdByRouteForSource(source) {
  switch (String(source || '').trim()) {
    case 'webhook_worker':
      return 'checkout_finalization_worker';
    case 'reconcile':
      return 'reconcile_paid_checkout';
    case 'manual':
      return 'manual_paid_checkout_finalize';
    case 'frontend':
    default:
      return 'POST /api/bookings';
  }
}

function buildBookingData({
  session,
  checkoutId,
  paymentIntentId,
  bookingPayload,
  finalizeContext,
  source = 'frontend'
}) {
  const ctx = finalizeContext || {};
  const payload = bookingPayload || {};
  const guestInfo = ctx.guestInfo || payload.guestInfo;
  const legalAcceptance = ctx.legalAcceptance || {};
  const requestMeta = ctx.requestMeta || {};
  const transportOptions = ctx.transportOptions || [];
  const tripType =
    typeof ctx.tripType === 'string' ? ctx.tripType.trim().slice(0, 50) : undefined;
  const transportMethod = validateTransportMethod(ctx.transportMethod, transportOptions);
  const romanticSetup = !!ctx.romanticSetup;
  const initialStatus = resolveInitialStatus({ finalizeContext: ctx, paymentIntentId });
  const stripePaymentVerified = Boolean(ctx.stripePaymentVerified);
  const paymentIntentIdForStripe = stripePaymentVerified && paymentIntentId
    ? String(paymentIntentId).trim()
    : null;

  const {
    getPaymentChoice
  } = require('../splitPaymentChoiceService');
  const choice = getPaymentChoice(session);
  let paymentSettlementStatus = 'paid_in_full';
  if (!stripePaymentVerified && Number(ctx.stripePaidAmountCents || 0) === 0) {
    paymentSettlementStatus = 'not_required';
  } else if (choice === 'split') {
    paymentSettlementStatus = 'partially_paid';
  }

  const bookingData = {
    checkIn: ctx.checkInDate || payload.checkIn,
    checkOut: ctx.checkOutDate || payload.checkOut,
    adults: parseInt(ctx.adults, 10),
    children: parseInt(ctx.children ?? 0, 10),
    guestInfo,
    specialRequests: ctx.specialRequests,
    totalPrice: ctx.totalPrice,
    subtotalPrice: ctx.subtotalPrice,
    discountAmount: ctx.discountAmount || 0,
    subtotalCents: ctx.subtotalCents,
    discountAmountCents: ctx.discountAmountCents,
    giftVoucherAppliedCents: ctx.giftVoucherAppliedCents,
    stripePaidAmountCents: ctx.stripePaidAmountCents,
    paymentSettlementStatus,
    totalValueCents: ctx.totalValueCents,
    giftVoucherRedemptionId: ctx.voucherReservationContext?.redemptionId || null,
    paymentMethod: ctx.paymentMethod || 'stripe',
    promoCode: ctx.appliedPromoCode || null,
    promoSnapshot: ctx.promoSnapshot || null,
    tripType,
    transportMethod,
    romanticSetup,
    craft: {
      version: 1,
      tripType: tripType || '',
      transportMethod: transportMethod || '',
      extras: {
        romanticSetup,
        customTripType:
          typeof ctx.customTripType === 'string' ? ctx.customTripType.trim().slice(0, 100) : '',
        specialRequests:
          typeof ctx.specialRequests === 'string' ? ctx.specialRequests.trim().slice(0, 500) : '',
        ...(ctx.winterVillage
          ? {
              winterVillage: {
                productId: ctx.winterVillage.productId,
                productName: ctx.winterVillage.productName,
                accommodationId: ctx.winterVillage.accommodationId,
                dateId: ctx.winterVillage.dateId || null,
                adults: ctx.winterVillage.adults,
                children4to12: ctx.winterVillage.children4to12,
                under4: ctx.winterVillage.under4,
                wellnessSelected: Boolean(ctx.winterVillage.wellnessSelected),
                wellnessIncluded: Boolean(ctx.winterVillage.wellnessIncluded),
                inclusions: Array.isArray(ctx.winterVillage.inclusions)
                  ? ctx.winterVillage.inclusions
                  : [],
                totalCents: ctx.winterVillage.totalCents
              }
            }
          : {})
      }
    },
    status: initialStatus,
    isProductionSafe: true,
    isTest: false,
    stripePaymentIntentId: paymentIntentIdForStripe,
    checkoutId: checkoutId || null,
    commercialStayFingerprint: String(session.stayFingerprint).trim(),
    checkoutSessionId: session._id || null,
    provenance: {
      source: ctx.winterVillage ? 'winter_village' : 'guest_portal',
      intakeRevision: 1,
      createdByRoute: createdByRouteForSource(source)
    },
    legalAcceptance: {
      termsVersion: legalAcceptance.termsVersion,
      activityRiskVersion: legalAcceptance.activityRiskVersion,
      acceptedAt: new Date(),
      firstName: String(guestInfo?.firstName || '').trim(),
      lastName: String(guestInfo?.lastName || '').trim(),
      ip: String(requestMeta.ip || '').trim() || null,
      userAgent: String(requestMeta.userAgent || '').trim() || null,
      locale:
        typeof legalAcceptance.locale === 'string' && legalAcceptance.locale.trim()
          ? legalAcceptance.locale.trim().slice(0, 50)
          : typeof requestMeta.acceptLanguage === 'string' && requestMeta.acceptLanguage.trim()
            ? requestMeta.acceptLanguage.trim().slice(0, 50)
            : null,
      checkbox1TextSnapshot: legalAcceptance.checkbox1TextSnapshot,
      checkbox2TextSnapshot: legalAcceptance.checkbox2TextSnapshot
    }
  };

  if (choice === 'split' && session.splitPaymentOfferSnapshot && session.splitPaymentOfferSnapshotHash) {
    bookingData.chosenPaymentScheduleSnapshot = session.splitPaymentOfferSnapshot;
    bookingData.chosenPaymentScheduleSnapshotHash = session.splitPaymentOfferSnapshotHash;
    if (session.futureChargeConsent) {
      bookingData.futureChargeConsent = {
        consentVersion: session.futureChargeConsent.consentVersion,
        consentHash: session.futureChargeConsent.consentHash,
        acceptedAt: session.futureChargeConsent.acceptedAt,
        acceptedLocale: session.futureChargeConsent.acceptedLocale,
        displayedText: session.futureChargeConsent.displayedText
      };
    }
    if (session.stripeCustomerId) {
      bookingData.stripeCustomerId = String(session.stripeCustomerId);
    }
    if (session.stripeReusablePaymentMethodId) {
      bookingData.stripeReusablePaymentMethodId = String(session.stripeReusablePaymentMethodId);
    }
  }

  if (ctx.attribution) {
    bookingData.attribution = ctx.attribution;
  }
  if (ctx.metaClientContext) {
    bookingData.metaClientContext = ctx.metaClientContext;
  }

  if (ctx.cabinId) {
    bookingData.cabinId = ctx.cabinId;
  } else if (ctx.cabinTypeId) {
    bookingData.cabinTypeId = ctx.cabinTypeId;
    if (ctx.assignedUnitId || ctx.unitId || payload.unitId) {
      bookingData.unitId = ctx.assignedUnitId || ctx.unitId || payload.unitId;
    }
  }

  return { bookingData, initialStatus, stripePaymentVerified };
}

function createDefaultDependencies() {
  return {
    Booking,
    PromoCode,
    linkStripePaymentToBooking,
    verifyPaymentLinkedToBooking,
    confirmVoucherReservation,
    releaseVoucherReservation,
    countBlockingBlocksForSingleCabin,
    countBlockingBlocksForUnit,
    // General finalize MRI/PRI — callers (incl. recovery) may stub these.
    recordPaidBookingResolutionIssue: async () => null,
    openManualReviewItem: async () => null,
    // I2 shadow dual-write observability — independent of general finalize stubs.
    shadowClaimOpenManualReviewItem: openManualReviewItem,
    shadowClaimRecordPaidBookingResolutionIssue: recordPaidBookingResolutionIssueSafe,
    ensureUnitNightClaimsShadow,
    ensureUnitNightClaimsReleasedShadow,
    ensureCabinNightClaimsShadow,
    ensureCabinNightClaimsReleasedShadow,
    preAcquireCabinNightsForCreate,
    compensateCreateAttemptClaims,
    postMirrorCabinNightsAfterCanonical,
    releaseCabinNightsAfterCanonicalNonOwning,
    stripe: null,
    blockingBookingStatuses: BLOCKING_BOOKING_STATUSES
  };
}

let activeDependencies = createDefaultDependencies();

function __setExecuteBookingFinalizeWorkDependenciesForTesting(overrides = {}) {
  activeDependencies = {
    ...createDefaultDependencies(),
    ...overrides
  };
}

function __resetExecuteBookingFinalizeWorkDependenciesForTesting() {
  activeDependencies = createDefaultDependencies();
}

async function resolveCabinTypeUnitForFinalize(deps, ctx, { paymentIntentIdForReview }) {
  if (!ctx.cabinTypeId) {
    return ctx;
  }

  const parentCabinForUnit =
    ctx.parentCabinForUnit !== undefined
      ? ctx.parentCabinForUnit
      : await findParentCabinForCabinType(ctx.cabinTypeId);

  const requestedUnitId = ctx.assignedUnitId || ctx.unitId || null;

  if (requestedUnitId) {
    const validation = await AssignmentEngine.validateUnitForCabinTypeBooking(
      requestedUnitId,
      ctx.cabinTypeId,
      ctx.checkInDate,
      ctx.checkOutDate
    );
    if (!validation.ok) {
      const errorCode = validation.code || 'UNIT_NOT_AVAILABLE';
      const errorSummary =
        errorCode === 'UNIT_CABIN_TYPE_MISMATCH'
          ? 'Requested unit does not belong to this stay type'
          : errorCode === 'UNIT_NOT_FOUND_OR_INACTIVE'
            ? 'Requested unit is not active or does not exist'
            : 'Requested unit is not available for the selected dates';
      if (paymentIntentIdForReview) {
        await deps.recordPaidBookingResolutionIssue({
          issueType: 'paid_booking_conflict',
          errorCode,
          errorSummary,
          paymentIntentId: paymentIntentIdForReview,
          bookingAttempt: ctx.bookingAttemptContext || null,
          finalizationStage: 'unit_assignment',
          checkoutId: ctx.checkoutId || null
        });
        throw createPaidBookingSaveFailedError({
          errorCode,
          errorSummary,
          paymentIntentId: paymentIntentIdForReview,
          finalizationStage: 'unit_assignment',
          observabilityRecorded: true
        });
      }
      throw createRouteStyleError('NOT_AVAILABLE', errorSummary);
    }
    return {
      ...ctx,
      assignedUnitId: requestedUnitId,
      parentCabinForUnit
    };
  }

  const assignedUnit = await AssignmentEngine.assignUnit(
    ctx.cabinTypeId,
    ctx.checkInDate,
    ctx.checkOutDate
  );

  if (!assignedUnit) {
    if (paymentIntentIdForReview) {
        await deps.recordPaidBookingResolutionIssue({
          issueType: 'paid_booking_conflict',
          errorCode: 'NO_UNITS_AVAILABLE',
          errorSummary: 'All units are occupied for the selected dates',
          paymentIntentId: paymentIntentIdForReview,
          bookingAttempt: ctx.bookingAttemptContext || null,
          finalizationStage: 'unit_assignment',
          checkoutId: ctx.checkoutId || null
        });
        throw createPaidBookingSaveFailedError({
          errorCode: 'NO_UNITS_AVAILABLE',
          errorSummary: 'All units are occupied for the selected dates',
          paymentIntentId: paymentIntentIdForReview,
          finalizationStage: 'unit_assignment',
          observabilityRecorded: true
        });
      }
    throw createRouteStyleError(
      'NOT_AVAILABLE',
      'No units available for the selected dates'
    );
  }

  return {
    ...ctx,
    assignedUnitId: assignedUnit._id,
    parentCabinForUnit
  };
}

function assertCabinTypeBookingHasUnitBeforeSave(bookingData, { paymentIntentIdForReview }) {
  if (!bookingData?.cabinTypeId) {
    return;
  }
  if (bookingData.status !== 'confirmed' && bookingData.status !== 'in_house') {
    return;
  }
  if (bookingData.unitId) {
    return;
  }
  if (paymentIntentIdForReview) {
    throw createPaidBookingSaveFailedError({
      errorCode: 'CABIN_TYPE_UNIT_REQUIRED',
      errorSummary: 'Multi-unit booking cannot be confirmed without an assigned unit',
      paymentIntentId: paymentIntentIdForReview
    });
  }
  throw createRouteStyleError(
    'CABIN_TYPE_UNIT_REQUIRED',
    'Multi-unit booking cannot be confirmed without an assigned unit'
  );
}

async function tryReleaseVoucherOnFailure(deps, { voucherReservationContext, reason, note }) {
  if (!voucherReservationContext?.redemptionId || voucherReservationContext?.confirmed) {
    return { attempted: false };
  }
  await deps.releaseVoucherReservation({
    redemptionId: voucherReservationContext.redemptionId,
    reason,
    actor: 'system',
    note
  });
  voucherReservationContext.released = true;
  return { attempted: true, released: true };
}

function toReplayResult(booking) {
  return {
    bookingId: booking._id,
    booking,
    result: { idempotentReplay: true }
  };
}

async function runShadowClaimsAfterCanonicalSurvival(deps, {
  booking,
  source,
  paymentIntentId,
  checkoutId,
  stripePaymentVerified = null
}) {
  if (!booking) return null;

  let unitOutcome = null;
  if (typeof deps.ensureUnitNightClaimsShadow === 'function') {
    try {
      unitOutcome = await deps.ensureUnitNightClaimsShadow({
        booking,
        source,
        paymentIntentId: paymentIntentId || booking.stripePaymentIntentId || null,
        checkoutId: checkoutId || booking.checkoutId || null,
        stripePaymentVerified,
        throwOnFailure: true,
        openManualReviewItemFn:
          typeof deps.shadowClaimOpenManualReviewItem === 'function'
            ? deps.shadowClaimOpenManualReviewItem
            : undefined,
        recordPaidBookingResolutionIssueFn:
          typeof deps.shadowClaimRecordPaidBookingResolutionIssue === 'function'
            ? deps.shadowClaimRecordPaidBookingResolutionIssue
            : undefined
      });
    } catch (err) {
      if (booking.cabinTypeId && booking.unitId) {
        try {
          await demoteAllocatedBookingWithoutClaims(deps, booking, {
            reasonCode: err?.code || 'UNIT_NIGHT_CLAIM_FAILURE',
            reasonSummary: err?.message || 'Claim ensure failed after Booking survival'
          });
        } catch {
          /* demotion failure leaves drift for I5 */
        }
      }
      throw err;
    }
  }

  if (typeof deps.ensureCabinNightClaimsShadow === 'function') {
    try {
      // S1.7: authoritative already preclaimed; postMirror no-ops in that mode.
      if (typeof deps.postMirrorCabinNightsAfterCanonical === 'function') {
        await deps.postMirrorCabinNightsAfterCanonical({
          booking,
          source: source || CABIN_S1_SOURCES.FINALIZE,
          throwOnFailure: false
        });
      } else {
        await deps.ensureCabinNightClaimsShadow({
          booking,
          source: source || CABIN_S1_SOURCES.FINALIZE,
          throwOnFailure: false
        });
      }
    } catch {
      /* cabin shadow must never alter canonical finalize outcome */
    }
  }

  return unitOutcome;
}

function resolveClaimSourceForFinalize(source) {
  const raw = String(source || '').trim();
  if (raw === 'legacy_create') return 'legacy_create';
  if (raw === 'location_child') return 'location_child';
  if (raw === 'multi_unit_recovery' || raw === 'multi_unit_paid_orphan_recovery') {
    return 'multi_unit_recovery';
  }
  return 'finalize';
}

async function findReplayByCheckoutId(deps, { checkoutId, checkoutFingerprint }) {
  if (!checkoutId) {
    return null;
  }
  const existing = await deps.Booking.findOne({ checkoutId });
  if (!existing) {
    return null;
  }
  if (bookingMatchesCheckoutFingerprint(existing, checkoutFingerprint)) {
    return toReplayResult(existing);
  }
  throw createRouteStyleError(
    'CHECKOUT_ID_CONFLICT',
    'This checkout attempt conflicts with an existing booking request'
  );
}

async function findReplayByPaymentIntent(deps, {
  checkoutId,
  checkoutFingerprint,
  stripePaymentVerified,
  paymentIntentId
}) {
  if (!stripePaymentVerified || !paymentIntentId) {
    return null;
  }
  const existing = await deps.Booking.findOne({
    stripePaymentIntentId: String(paymentIntentId).trim()
  });
  if (!existing) {
    return null;
  }
  const checkoutMatches =
    checkoutId &&
    existing.checkoutId &&
    String(existing.checkoutId) === String(checkoutId);
  if (checkoutMatches && bookingMatchesCheckoutFingerprint(existing, checkoutFingerprint)) {
    return toReplayResult(existing);
  }
  throw createRouteStyleError(
    'PAYMENT_INTENT_ALREADY_USED',
    'This payment has already been used to create a booking.',
    { bookingId: existing._id ? String(existing._id) : undefined }
  );
}

async function createBookingInstallmentsForSplit(booking, session, {
  paymentIntentId = null,
  BookingInstallmentModel = BookingInstallment
} = {}) {
  const {
    reconcileBookingInstallmentsForSplit,
    BookingInstallmentReconciliationError,
    sessionNeedsSplitInstallmentReconciliation
  } = require('../bookingInstallmentReconciliationService');
  if (!booking || !session) return { reconciled: false, reason: 'missing_args', count: 0 };
  if (!sessionNeedsSplitInstallmentReconciliation(session)) {
    return { reconciled: false, reason: 'not_needed', count: 0 };
  }
  try {
    return await reconcileBookingInstallmentsForSplit({
      booking,
      session,
      paymentIntentId:
        paymentIntentId ||
        booking.stripePaymentIntentId ||
        session.canonicalPaymentIntentId ||
        null,
      BookingInstallmentModel
    });
  } catch (err) {
    if (
      err instanceof BookingInstallmentReconciliationError ||
      err?.name === 'BookingInstallmentReconciliationError'
    ) {
      const wrapped = createPaidBookingSaveFailedError({
        errorCode: err.code || 'INSTALLMENT_RECONCILE_FAILED',
        errorSummary: err.message || 'BookingInstallment reconciliation failed',
        paymentIntentId:
          paymentIntentId ||
          booking.stripePaymentIntentId ||
          session.canonicalPaymentIntentId ||
          null,
        finalizationStage: 'booking_persist'
      });
      wrapped.installmentReconciliationError = err;
      wrapped.details = err.details || null;
      throw wrapped;
    }
    throw err;
  }
}

/**
 * SP5B — every split finalize/replay path must converge installments.
 */
async function reconcileSplitInstallmentsAfterBookingPersist(deps, {
  booking,
  session,
  paymentIntentId = null,
  leaseAware = false
}) {
  if (!booking || !session) return null;
  const { getPaymentChoice } = require('../splitPaymentChoiceService');
  if (getPaymentChoice(session) !== 'split') return null;

  // Authoritative off-session PM must be proven before creating collectible future installments.
  const {
    verifySplitOffSessionPaymentMethod,
    SplitOffSessionVerificationError
  } = require('../splitPaymentOffSessionVerificationService');
  try {
    if (!session.stripeReusablePaymentMethodId) {
      const verified = await verifySplitOffSessionPaymentMethod({
        stripe: deps.stripe,
        session,
        paymentIntent:
          paymentIntentId ||
          booking.stripePaymentIntentId ||
          session.canonicalPaymentIntentId
      });
      if (verified?.paymentMethodId) {
        session.stripeReusablePaymentMethodId = verified.paymentMethodId;
        if (!booking.stripeReusablePaymentMethodId) {
          booking.stripeReusablePaymentMethodId = verified.paymentMethodId;
          try {
            await deps.Booking.updateOne(
              { _id: booking._id },
              { $set: { stripeReusablePaymentMethodId: verified.paymentMethodId } }
            );
          } catch {
            /* best-effort mirror */
          }
        }
      }
    } else {
      // Re-verify even when an id is already stored — never trust unverified string alone.
      await verifySplitOffSessionPaymentMethod({
        stripe: deps.stripe,
        session,
        paymentIntent:
          paymentIntentId ||
          booking.stripePaymentIntentId ||
          session.canonicalPaymentIntentId
      });
    }
  } catch (verifyErr) {
    if (deps.recordPaidBookingResolutionIssue) {
      try {
        await deps.recordPaidBookingResolutionIssue({
          issueType: 'paid_booking_unknown_failure',
          errorCode: verifyErr.code || 'SPLIT_OFF_SESSION_VERIFICATION_FAILED',
          errorSummary: verifyErr.message || 'Split off-session PM verification failed',
          paymentIntentId:
            paymentIntentId || booking.stripePaymentIntentId || null,
          checkoutId: session.checkoutId || null,
          bookingId: booking._id ? String(booking._id) : null,
          finalizationStage: 'booking_persist',
          failureSource: 'booking_finalize_worker',
          stripePaymentVerified: true,
          extraMetadata: { details: verifyErr.details || null }
        });
      } catch {
        /* observability best-effort */
      }
    }
    if (leaseAware) {
      throw createLeaseWorkNeedsReviewError(
        'LEASE_FINALIZE_NEEDS_REVIEW',
        verifyErr.message || 'Split off-session PaymentMethod verification failed',
        {
          stage: 'booking_persist',
          bookingId: booking._id ? String(booking._id) : null,
          retryable: false,
          failureCode: verifyErr.code || 'SPLIT_OFF_SESSION_VERIFICATION_FAILED',
          details: verifyErr.details || null
        }
      );
    }
    throw createPaidBookingSaveFailedError({
      errorCode: verifyErr.code || 'SPLIT_OFF_SESSION_VERIFICATION_FAILED',
      errorSummary: verifyErr.message || 'Split off-session PaymentMethod verification failed',
      paymentIntentId: paymentIntentId || booking.stripePaymentIntentId || null,
      finalizationStage: 'booking_persist'
    });
  }

  try {
    return await createBookingInstallmentsForSplit(booking, session, {
      paymentIntentId,
      BookingInstallmentModel: deps.BookingInstallment || BookingInstallment
    });
  } catch (err) {
    if (leaseAware && err?.code === 'PAID_BOOKING_SAVE_FAILED') {
      throw createLeaseWorkNeedsReviewError(
        'LEASE_FINALIZE_NEEDS_REVIEW',
        err.errorSummary || err.message || 'BookingInstallment reconciliation failed',
        {
          stage: 'booking_persist',
          bookingId: booking._id ? String(booking._id) : null,
          retryable: false,
          failureCode: err.errorCode || null,
          details: err.details || null
        }
      );
    }
    throw err;
  }
}

async function saveBookingWithReplay(deps, {
  bookingData,
  checkoutId,
  checkoutFingerprint,
  voucherReservationContext,
  paymentIntentIdForReview,
  voucherEvidence,
  session = null
}) {
  try {
    const booking = new deps.Booking(bookingData);
    await booking.save();
    if (session) {
      await reconcileSplitInstallmentsAfterBookingPersist(deps, {
        booking,
        session,
        paymentIntentId: paymentIntentIdForReview || booking.stripePaymentIntentId || null
      });
    }
    return { booking, isReplay: false };
  } catch (saveErr) {
    await tryReleaseVoucherOnFailure(deps, {
      voucherReservationContext,
      reason: 'booking_save_failed',
      note: 'release voucher reservation after booking save failure'
    });
    if (saveErr?.code === 11000 && checkoutId) {
      const existing = await deps.Booking.findOne({ checkoutId });
      if (existing && bookingMatchesCheckoutFingerprint(existing, checkoutFingerprint)) {
        if (session) {
          await reconcileSplitInstallmentsAfterBookingPersist(deps, {
            booking: existing,
            session,
            paymentIntentId:
              paymentIntentIdForReview ||
              existing.stripePaymentIntentId ||
              null
          });
        }
        return { booking: existing, isReplay: true };
      }
      if (existing) {
        throw createRouteStyleError(
          'CHECKOUT_ID_CONFLICT',
          'This checkout attempt conflicts with an existing booking request'
        );
      }
    }
    throw saveErr;
  }
}

function isPaidOverlapPath({ paymentIntentIdForReview, finalizeContext, booking }) {
  if (paymentIntentIdForReview) return true;
  if (booking?.stripePaymentIntentId) return true;
  if (finalizeContext?.stripePaymentVerified) return true;
  if (String(finalizeContext?.sessionPaymentStatus || '').trim() === 'paid') return true;
  return false;
}

/**
 * I6: demote allocated Booking that cannot own claims → unallocated blocking.
 * Preserves paid/Booking evidence; clears unitId; releases any claims.
 */
async function demoteAllocatedBookingWithoutClaims(deps, booking, {
  reasonCode = 'UNIT_NIGHT_CLAIM_DEMOTE',
  reasonSummary = 'Allocated Booking demoted to unallocated after claim failure'
} = {}) {
  if (!booking?._id) return booking;
  const existingMeta =
    booking.metadata && typeof booking.metadata === 'object' && !Array.isArray(booking.metadata)
      ? booking.metadata
      : {};
  await deps.Booking.updateOne(
    { _id: booking._id },
    {
      $set: {
        unitId: null,
        metadata: {
          ...existingMeta,
          unitClaimDemoted: true,
          unitClaimDemotedAt: new Date(),
          unitClaimDemoteCode: reasonCode,
          unitClaimDemoteSummary: reasonSummary
        }
      }
    }
  );
  try {
    await releaseUnitNights({ bookingId: booking._id });
  } catch {
    /* release best-effort; demotion already cleared allocation */
  }
  const refreshed = await deps.Booking.findById(booking._id);
  return refreshed || booking;
}

async function retainPaidBookingOnOverlap(deps, {
  booking,
  finalizeContext,
  paymentIntentIdForReview,
  errorCode,
  errorSummary,
  claimSource = 'frontend',
  stripePaymentVerified = null
}) {
  const ctx = finalizeContext || {};
  const checkoutId = ctx.checkoutId || booking?.checkoutId || null;
  const existingMeta =
    booking.metadata && typeof booking.metadata === 'object' && !Array.isArray(booking.metadata)
      ? booking.metadata
      : {};

  await deps.Booking.updateOne(
    { _id: booking._id },
    {
      $set: {
        metadata: {
          ...existingMeta,
          paidOverlapConflict: true,
          paidOverlapConflictAt: new Date(),
          paidOverlapConflictCode: errorCode,
          paidOverlapConflictSummary: errorSummary
        }
      }
    }
  );

  if (typeof deps.openManualReviewItem === 'function') {
    await deps.openManualReviewItem({
      category: 'paid_booking_overlap_conflict',
      severity: 'critical',
      entityType: 'Booking',
      entityId: String(booking._id),
      title: 'Paid booking overlap conflict after save',
      details: errorSummary,
      provenance: {
        source: 'booking_finalize_worker',
        sourceReference: checkoutId ? String(checkoutId) : null
      },
      evidence: {
        paymentIntentId: paymentIntentIdForReview || booking.stripePaymentIntentId || null,
        checkoutId,
        errorCode,
        errorSummary,
        bookingId: String(booking._id)
      }
    });
  }

  // I6: cannot remain allocated blocking without claims — demote physical unit.
  if (booking.cabinTypeId && booking.unitId) {
    booking = await demoteAllocatedBookingWithoutClaims(deps, booking, {
      reasonCode: errorCode,
      reasonSummary: errorSummary
    });
  }

  if (paymentIntentIdForReview && typeof deps.recordPaidBookingResolutionIssue === 'function') {
    await deps.recordPaidBookingResolutionIssue({
      issueType: 'paid_booking_conflict',
      errorCode,
      errorSummary,
      paymentIntentId: paymentIntentIdForReview,
      bookingAttempt: ctx.bookingAttemptContext || null,
      finalizationStage: 'overlap_check',
      checkoutId,
      bookingId: booking?._id ? String(booking._id) : null
    });
  }

  throw createPaidBookingSaveFailedError({
    errorCode,
    errorSummary,
    paymentIntentId: paymentIntentIdForReview || booking.stripePaymentIntentId || null,
    finalizationStage: 'overlap_check',
    observabilityRecorded: true,
    bookingId: booking?._id ? String(booking._id) : null
  });
}

async function runPostSaveOverlapChecks(deps, {
  booking,
  finalizeContext,
  paymentIntentIdForReview,
  voucherReservationContext,
  voucherEvidence,
  claimSource = 'frontend',
  stripePaymentVerified = null
}) {
  const ctx = finalizeContext || {};
  const { checkInDate, checkOutDate, cabinId, assignedUnitId, parentCabinForUnit } = ctx;
  const blocking = deps.blockingBookingStatuses || BLOCKING_BOOKING_STATUSES;
  const paidPath = isPaidOverlapPath({
    paymentIntentIdForReview,
    finalizeContext: ctx,
    booking
  });

  if (cabinId) {
    const overlaps = await deps.Booking.countDocuments({
      cabinId,
      _id: { $ne: booking._id },
      status: { $in: blocking },
      checkIn: { $lt: checkOutDate },
      checkOut: { $gt: checkInDate }
    });
    const blockRace = await deps.countBlockingBlocksForSingleCabin(
      cabinId,
      checkInDate,
      checkOutDate
    );
    if (overlaps > 0 || blockRace > 0) {
      const errorCode = 'CABIN_OVERLAP_AFTER_SAVE';
      const errorSummary = `overlaps=${overlaps}, blockRace=${blockRace}`;

      if (paidPath) {
        await retainPaidBookingOnOverlap(deps, {
          booking,
          finalizeContext: ctx,
          paymentIntentIdForReview,
          errorCode,
          errorSummary,
          claimSource,
          stripePaymentVerified
        });
      }

      await shadowReleaseBeforeBookingDelete(
        deps,
        booking._id,
        LIFECYCLE_SOURCES.FINALIZE_CLEANUP
      );
      await deps.Booking.deleteOne({ _id: booking._id });
      await releaseCabinClaimsAfterBookingDelete(
        deps,
        booking._id,
        LIFECYCLE_SOURCES.FINALIZE_CLEANUP
      );
      await tryReleaseVoucherOnFailure(deps, {
        voucherReservationContext,
        reason: 'booking_conflict_after_save',
        note: 'release voucher reservation after cabin overlap conflict'
      });
      if (paymentIntentIdForReview) {
        await deps.recordPaidBookingResolutionIssue({
          issueType: 'paid_booking_conflict',
          errorCode,
          errorSummary,
          paymentIntentId: paymentIntentIdForReview,
          bookingAttempt: ctx.bookingAttemptContext || null,
          finalizationStage: 'overlap_check',
          checkoutId: ctx.checkoutId || null,
          bookingId: booking?._id ? String(booking._id) : null
        });
        throw createPaidBookingSaveFailedError({
          errorCode,
          errorSummary,
          paymentIntentId: paymentIntentIdForReview,
          finalizationStage: 'overlap_check',
          observabilityRecorded: true
        });
      }
      throw createRouteStyleError(
        'NOT_AVAILABLE',
        'This cabin was just booked by another guest. Please choose different dates.'
      );
    }
  }

  if (assignedUnitId) {
    const overlapQuery = {
      unitId: assignedUnitId,
      status: { $in: blocking },
      checkIn: { $lt: checkOutDate },
      checkOut: { $gt: checkInDate }
    };
    const overlaps = await deps.Booking.countDocuments({
      ...overlapQuery,
      _id: { $ne: booking._id }
    });
    let blockRace = 0;
    if (parentCabinForUnit?._id) {
      blockRace = await deps.countBlockingBlocksForUnit(
        parentCabinForUnit._id,
        assignedUnitId,
        checkInDate,
        checkOutDate
      );
    }
    if (overlaps > 0 || blockRace > 0) {
      const oldestOverlap = overlaps > 0
        ? await deps.Booking.findOne(overlapQuery).sort({ createdAt: 1, _id: 1 }).select('_id')
        : null;
      const lostUnitRace =
        oldestOverlap && String(oldestOverlap._id) !== String(booking._id);

      if (blockRace > 0 || lostUnitRace) {
        const errorCode = 'UNIT_OVERLAP_AFTER_SAVE';
        const errorSummary = `overlaps=${overlaps}, blockRace=${blockRace}`;

        if (paidPath) {
          await retainPaidBookingOnOverlap(deps, {
            booking,
            finalizeContext: ctx,
            paymentIntentIdForReview,
            errorCode,
            errorSummary,
            claimSource,
            stripePaymentVerified
          });
        }

        await shadowReleaseBeforeBookingDelete(
          deps,
          booking._id,
          LIFECYCLE_SOURCES.FINALIZE_CLEANUP
        );
        await deps.Booking.deleteOne({ _id: booking._id });
        await releaseCabinClaimsAfterBookingDelete(
          deps,
          booking._id,
          LIFECYCLE_SOURCES.FINALIZE_CLEANUP
        );
        await tryReleaseVoucherOnFailure(deps, {
          voucherReservationContext,
          reason: 'booking_conflict_after_save',
          note: 'release voucher reservation after unit overlap conflict'
        });
        if (paymentIntentIdForReview) {
          await deps.recordPaidBookingResolutionIssue({
            issueType: 'paid_booking_conflict',
            errorCode,
            errorSummary,
            paymentIntentId: paymentIntentIdForReview,
            bookingAttempt: ctx.bookingAttemptContext || null,
            finalizationStage: 'overlap_check',
            checkoutId: ctx.checkoutId || null,
            bookingId: booking?._id ? String(booking._id) : null
          });
          throw createPaidBookingSaveFailedError({
            errorCode,
            errorSummary,
            paymentIntentId: paymentIntentIdForReview,
            finalizationStage: 'overlap_check',
            observabilityRecorded: true
          });
        }
        throw createRouteStyleError(
          'NOT_AVAILABLE',
          'This unit was just booked by another guest. Please choose different dates.'
        );
      }
    }
  }
}

async function incrementPromoUsageIfNeeded(deps, {
  booking,
  finalizeContext,
  initialStatus,
  paymentIntentIdForReview,
  voucherReservationContext,
  voucherEvidence
}) {
  const ctx = finalizeContext || {};
  const appliedPromoCode = ctx.appliedPromoCode;
  if (initialStatus !== 'confirmed' || !appliedPromoCode) {
    return;
  }

  const inc = await deps.PromoCode.updateOne(
    {
      code: appliedPromoCode,
      $or: [
        { usageLimit: null },
        { usageLimit: { $exists: false } },
        { $expr: { $lt: [{ $ifNull: ['$usageCount', 0] }, '$usageLimit'] } }
      ]
    },
    { $inc: { usageCount: 1 } }
  );

  if (inc.matchedCount === 0) {
    await shadowReleaseBeforeBookingDelete(
      deps,
      booking._id,
      LIFECYCLE_SOURCES.FINALIZE_CLEANUP
    );
    await deps.Booking.deleteOne({ _id: booking._id });
    await releaseCabinClaimsAfterBookingDelete(
      deps,
      booking._id,
      LIFECYCLE_SOURCES.FINALIZE_CLEANUP
    );
    await tryReleaseVoucherOnFailure(deps, {
      voucherReservationContext,
      reason: 'promo_conflict_after_save',
      note: 'release voucher reservation after promo conflict'
    });
    if (paymentIntentIdForReview) {
      await deps.recordPaidBookingResolutionIssue({
        issueType: 'paid_booking_conflict',
        errorCode: 'PROMO_USAGE_CONFLICT_AFTER_SAVE',
        errorSummary: 'Promo usage limit reached after booking save',
        paymentIntentId: paymentIntentIdForReview,
        bookingAttempt: ctx.bookingAttemptContext || null,
        finalizationStage: 'booking_save',
        checkoutId: ctx.checkoutId || null,
        bookingId: booking?._id ? String(booking._id) : null
      });
      throw createPaidBookingSaveFailedError({
        errorCode: 'PROMO_USAGE_CONFLICT_AFTER_SAVE',
        errorSummary: 'Promo usage limit reached after booking save',
        paymentIntentId: paymentIntentIdForReview,
        finalizationStage: 'booking_save',
        observabilityRecorded: true
      });
    }
    throw createRouteStyleError(
      'PROMO_CONFLICT',
      'This promo code is no longer available for new bookings.'
    );
  }
}

async function confirmVoucherIfNeeded(deps, {
  booking,
  source,
  checkoutId,
  finalizeContext,
  paymentIntentIdForReview,
  voucherEvidence,
  stripePaymentVerified = null
}) {
  const voucherReservationContext = finalizeContext?.voucherReservationContext;
  if (!voucherReservationContext?.redemptionId) {
    return;
  }

  try {
    await deps.confirmVoucherReservation({
      redemptionId: voucherReservationContext.redemptionId,
      actor: 'system',
      note: 'confirm voucher reservation after booking save success'
    });
    voucherReservationContext.confirmed = true;
  } catch (confirmErr) {
    await deps.openManualReviewItem({
      category: paymentIntentIdForReview
        ? 'payment_finalization_failure'
        : 'gift_voucher_redemption_confirm_failed',
      severity: 'high',
      entityType: 'GiftVoucherRedemption',
      entityId: String(voucherReservationContext.redemptionId),
      title: 'Voucher reservation confirmation failed after booking save',
      details: 'Booking was saved but voucher redemption confirmation failed',
      provenance: {
        source: 'booking_finalize_worker',
        sourceReference: finalizeContext.checkoutId || null
      },
      evidence: {
        ...voucherEvidence,
        error: confirmErr.message
      }
    });
    // Booking already survived canonical allocation — shadow-claim before exit.
    await runShadowClaimsAfterCanonicalSurvival(deps, {
      booking,
      source,
      paymentIntentId: paymentIntentIdForReview,
      checkoutId: checkoutId || finalizeContext?.checkoutId || null,
      stripePaymentVerified
    });
    throw createVoucherConfirmFailedError(confirmErr.message);
  }
}


function isLeaseAwareSessionLocal(session) {
  const rl = session && session.resourceLease;
  if (rl == null) return false;
  return typeof rl === 'object';
}

function createLeaseWorkNeedsReviewError(code, message, details = {}) {
  const err = new CheckoutSessionError(
    CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE,
    message,
    details
  );
  err.code = code;
  err.needsReview = true;
  err.requiresManualReview = true;
  return err;
}

function buildResourceFinalizationSnapshot({
  session,
  paymentAuthorityType,
  paymentAuthorityMeta,
  expectedFacilityReservationIds,
  confirmedFacilityReservationIds
}) {
  const rl = session.resourceLease || {};
  const acc = rl.accommodation || {};
  const snap =
    session.quoteSnapshot && typeof session.quoteSnapshot === 'object' ? session.quoteSnapshot : {};
  return {
    quoteSnapshotHash: session.quoteSnapshotHash != null ? String(session.quoteSnapshotHash) : null,
    resourceLeaseGeneration: rl.generation != null ? Number(rl.generation) : null,
    resourceLeaseAttemptId: rl.attemptId != null ? String(rl.attemptId) : null,
    resourceLeaseValidUntil: rl.validUntil ? new Date(rl.validUntil) : null,
    accommodationLeaseId: String(acc.leaseId || acc.holdId || ''),
    accommodationLeaseGeneration:
      acc.generation != null ? Number(acc.generation) : Number(rl.generation),
    accommodationEntityType: acc.entityType != null ? String(acc.entityType) : null,
    accommodationCabinId: acc.cabinId || null,
    accommodationUnitId: acc.unitId || null,
    canonicalPaymentIntentId:
      (paymentAuthorityMeta && paymentAuthorityMeta.canonicalPaymentIntentId) ||
      (session.canonicalPaymentIntentId != null ? String(session.canonicalPaymentIntentId) : null),
    paymentAuthorityType: paymentAuthorityType || null,
    voucherRedemptionId:
      (paymentAuthorityMeta && paymentAuthorityMeta.voucherRedemptionId) ||
      session.voucherRedemptionId ||
      rl.voucherRedemptionId ||
      null,
    voucherOperationId:
      (paymentAuthorityMeta && paymentAuthorityMeta.voucherOperationId) ||
      (rl.voucherOperationId != null ? String(rl.voucherOperationId) : null),
    expectedFacilityReservationIds: Array.isArray(expectedFacilityReservationIds)
      ? expectedFacilityReservationIds.map(String)
      : [],
    confirmedFacilityReservationIds: Array.isArray(confirmedFacilityReservationIds)
      ? confirmedFacilityReservationIds.map(String)
      : [],
    currency: 'EUR',
    totalCents:
      snap.totalCents != null
        ? Number(snap.totalCents)
        : session.stripeAmountCents != null
          ? Number(session.stripeAmountCents) + Number(session.giftVoucherAppliedCents || 0)
          : null,
    giftVoucherAppliedCents:
      session.giftVoucherAppliedCents != null ? Number(session.giftVoucherAppliedCents) : 0,
    remainingDueCents: snap.remainingDueCents != null ? Number(snap.remainingDueCents) : null,
    stripeAmountCents: session.stripeAmountCents != null ? Number(session.stripeAmountCents) : 0,
    bookingType: snap.bookingType != null ? String(snap.bookingType) : null,
    ratePlanCode:
      snap.ratePlanCode != null
        ? String(snap.ratePlanCode)
        : snap.ratePlan && snap.ratePlan.code != null
          ? String(snap.ratePlan.code)
          : null,
    ratePlanVersion:
      snap.ratePlanVersion != null
        ? String(snap.ratePlanVersion)
        : snap.ratePlan && snap.ratePlan.version != null
          ? String(snap.ratePlan.version)
          : null,
    packageDates: snap.packageDates || snap.fixedPackageDates || null,
    packageInclusions: snap.packageInclusions || snap.inclusions || null,
    // Commercial snapshot fields: quoteSnapshot only — never finalizeIntent / client body.
    participants: snap.participants != null ? snap.participants : null,
    facilitySelections: snap.facilitySelections != null ? snap.facilitySelections : null,
    cancellationPolicy: snap.cancellationPolicySnapshot || snap.cancellationPolicy || null
  };
}

/**
 * Fail closed when quoteSnapshot indicates a package/rate-plan commercial shape
 * but required immutable package fields are absent. Never copy from finalizeIntent.
 */
function assertImmutableQuoteCommercialSnapshot(session, { bookingId } = {}) {
  const snap =
    session && session.quoteSnapshot && typeof session.quoteSnapshot === 'object'
      ? session.quoteSnapshot
      : null;
  if (!snap) {
    throw createLeaseWorkNeedsReviewError(
      'LEASE_FINALIZE_NEEDS_REVIEW',
      'Lease-aware Booking requires immutable quoteSnapshot',
      { stage: 'booking_persist', bookingId: bookingId || null, retryable: false }
    );
  }
  const bookingType = snap.bookingType != null ? String(snap.bookingType).toLowerCase() : '';
  const ratePlanType =
    snap.ratePlan && snap.ratePlan.type != null ? String(snap.ratePlan.type).toLowerCase() : '';
  const packageCode =
    (snap.packageCode != null && String(snap.packageCode).trim()) ||
    (snap.fixedPackageCode != null && String(snap.fixedPackageCode).trim()) ||
    '';
  const looksLikePackage =
    bookingType.includes('package') ||
    ratePlanType === 'fixed_package' ||
    Boolean(packageCode) ||
    snap.fixedPackage === true;
  if (!looksLikePackage) return;
  const packageDates = snap.packageDates || snap.fixedPackageDates || null;
  const packageInclusions = snap.packageInclusions || snap.inclusions || null;
  if (packageDates == null || packageInclusions == null) {
    throw createLeaseWorkNeedsReviewError(
      'LEASE_FINALIZE_NEEDS_REVIEW',
      'Package commercial fields missing from immutable quoteSnapshot',
      { stage: 'booking_persist', bookingId: bookingId || null, retryable: false }
    );
  }
}

async function saveLeaseAwareBookingWithoutVoucherRelease(deps, {
  bookingData,
  checkoutId,
  boundBookingId,
  session = null,
  paymentIntentId = null
}) {
  async function returnWithReconcile(booking, isReplay) {
    if (session) {
      await reconcileSplitInstallmentsAfterBookingPersist(deps, {
        booking,
        session,
        paymentIntentId:
          paymentIntentId ||
          booking.stripePaymentIntentId ||
          bookingData.stripePaymentIntentId ||
          null,
        leaseAware: true
      });
    }
    return { booking, isReplay };
  }

  const existingById = await deps.Booking.findById(boundBookingId);
  if (existingById) {
    if (existingById.checkoutId && String(existingById.checkoutId) !== String(checkoutId)) {
      throw createLeaseWorkNeedsReviewError(
        'LEASE_FINALIZE_NEEDS_REVIEW',
        'Bound Booking ID belongs to a different checkout',
        { stage: 'booking_persist', bookingId: String(boundBookingId), retryable: false }
      );
    }
    return returnWithReconcile(existingById, true);
  }
  const existingByCheckout = await deps.Booking.findOne({ checkoutId: String(checkoutId) });
  if (existingByCheckout) {
    if (String(existingByCheckout._id) !== String(boundBookingId)) {
      throw createLeaseWorkNeedsReviewError(
        'LEASE_FINALIZE_NEEDS_REVIEW',
        'Checkout already has a Booking with a different ID',
        {
          stage: 'booking_persist',
          bookingId: String(boundBookingId),
          existingBookingId: String(existingByCheckout._id),
          retryable: false
        }
      );
    }
    return returnWithReconcile(existingByCheckout, true);
  }

  const piId =
    bookingData.stripePaymentIntentId != null
      ? String(bookingData.stripePaymentIntentId).trim()
      : '';
  if (piId) {
    const existingByPi = await deps.Booking.findOne({ stripePaymentIntentId: piId });
    if (existingByPi) {
      if (String(existingByPi._id) === String(boundBookingId)) {
        return returnWithReconcile(existingByPi, true);
      }
      throw createLeaseWorkNeedsReviewError(
        'LEASE_FINALIZE_NEEDS_REVIEW',
        'PaymentIntent already used by a different Booking',
        {
          stage: 'booking_persist',
          bookingId: String(boundBookingId),
          existingBookingId: String(existingByPi._id),
          retryable: false
        }
      );
    }
  }

  try {
    const booking = new deps.Booking(bookingData);
    await booking.save();
    return returnWithReconcile(booking, false);
  } catch (saveErr) {
    if (saveErr && saveErr.code === 11000) {
      const again =
        (await deps.Booking.findById(boundBookingId)) ||
        (await deps.Booking.findOne({ checkoutId: String(checkoutId) }));
      if (again && String(again._id) === String(boundBookingId)) {
        return returnWithReconcile(again, true);
      }
      if (piId) {
        const byPi = await deps.Booking.findOne({ stripePaymentIntentId: piId });
        if (byPi && String(byPi._id) === String(boundBookingId)) {
          return returnWithReconcile(byPi, true);
        }
        if (byPi) {
          throw createLeaseWorkNeedsReviewError(
            'LEASE_FINALIZE_NEEDS_REVIEW',
            'PaymentIntent already used by a different Booking',
            {
              stage: 'booking_persist',
              bookingId: String(boundBookingId),
              existingBookingId: String(byPi._id),
              retryable: false
            }
          );
        }
      }
      throw createLeaseWorkNeedsReviewError(
        'LEASE_FINALIZE_NEEDS_REVIEW',
        'Booking unique conflict during lease-aware persist',
        { stage: 'booking_persist', bookingId: String(boundBookingId), retryable: false }
      );
    }
    // Propagate installment/PM verification needs-review errors as-is.
    if (
      saveErr?.code === 'LEASE_FINALIZE_NEEDS_REVIEW' ||
      saveErr?.code === 'PAID_BOOKING_SAVE_FAILED'
    ) {
      throw saveErr;
    }
    throw createLeaseWorkNeedsReviewError(
      'PAID_BOOKING_SAVE_FAILED',
      saveErr.message || 'Booking save failed after promotion',
      { stage: 'booking_persist', bookingId: String(boundBookingId), retryable: true }
    );
  }
}

async function executeLeaseAwareFinalizeWork({
  session,
  checkoutId,
  paymentIntentId = null,
  bookingPayload = null,
  finalizeContext = {},
  source = 'frontend',
  dependencies = null
}) {
  const deps = dependencies ? { ...activeDependencies, ...dependencies } : activeDependencies;
  const ctx = { ...finalizeContext, checkoutId: checkoutId || finalizeContext.checkoutId };
  const paymentIntentIdForReview = paymentIntentId
    ? String(paymentIntentId).trim()
    : ctx.paymentIntentId
      ? String(ctx.paymentIntentId).trim()
      : null;
  const boundBookingId =
    ctx.boundBookingId || (session.bookingId != null ? String(session.bookingId) : null);
  if (!boundBookingId) {
    throw createLeaseWorkNeedsReviewError(
      'LEASE_FINALIZE_NEEDS_REVIEW',
      'Lease-aware finalization requires durable bound Booking ID',
      { stage: 'promotion', retryable: true }
    );
  }

  const rl = session.resourceLease;
  if (!rl || String(rl.status || '') !== 'paid') {
    throw createLeaseWorkNeedsReviewError(
      'LEASE_FINALIZE_NEEDS_REVIEW',
      'Lease-aware promotion requires resourceLease.status paid',
      {
        stage: 'promotion',
        bookingId: boundBookingId,
        resourceLeaseGeneration: rl && rl.generation,
        retryable: true
      }
    );
  }
  const acc = rl.accommodation || {};
  const leaseId = String(acc.leaseId || acc.holdId || '').trim();
  const generation = Number(acc.generation != null ? acc.generation : rl.generation);
  const attemptId = String(rl.attemptId || '').trim();
  const quoteSnapshotHash = String(rl.quoteSnapshotHash || session.quoteSnapshotHash || '').trim();
  if (!leaseId || !Number.isInteger(generation) || !attemptId || !quoteSnapshotHash) {
    throw createLeaseWorkNeedsReviewError(
      'LEASE_FINALIZE_NEEDS_REVIEW',
      'Lease-aware promotion requires complete resource lease identity',
      { stage: 'promotion', bookingId: boundBookingId, retryable: false }
    );
  }

  const promoteInput = {
    checkoutId: String(checkoutId),
    bookingId: boundBookingId,
    leaseId,
    holdId: leaseId,
    generation,
    attemptId,
    quoteSnapshotHash,
    checkIn: String(
      (session.quoteSnapshot && session.quoteSnapshot.checkInDateOnly) || acc.checkIn || ''
    ),
    checkOut: String(
      (session.quoteSnapshot && session.quoteSnapshot.checkOutDateOnly) || acc.checkOut || ''
    ),
    unitId: acc.unitId || undefined,
    cabinId: acc.cabinId || undefined
  };
  if (ctx.paymentAuthorityType === 'stripe' || paymentIntentIdForReview) {
    promoteInput.canonicalPaymentIntentId =
      session.canonicalPaymentIntentId != null
        ? String(session.canonicalPaymentIntentId)
        : paymentIntentIdForReview;
  }

  let promoteResult;
  try {
    promoteResult = await promoteAccommodationCheckoutHoldToBooking(promoteInput, deps);
  } catch (promoteErr) {
    throw createLeaseWorkNeedsReviewError(
      'ACCOMMODATION_PROMOTION_FAILED',
      promoteErr.message || 'Accommodation promotion failed',
      {
        stage: 'promotion',
        bookingId: boundBookingId,
        resourceLeaseGeneration: generation,
        resourceLeaseAttemptId: attemptId,
        quoteSnapshotHash,
        canonicalPaymentIntentId: promoteInput.canonicalPaymentIntentId || null,
        failureCode: promoteErr.code || null,
        retryable: true
      }
    );
  }
  if (typeof deps.afterAccommodationPromote === 'function') {
    await deps.afterAccommodationPromote({
      checkoutId,
      bookingId: boundBookingId,
      promoteResult
    });
  }

  const { bookingData, stripePaymentVerified } = buildBookingData({
    session,
    checkoutId,
    paymentIntentId: paymentIntentIdForReview,
    bookingPayload,
    finalizeContext: ctx,
    source
  });
  bookingData._id = new mongoose.Types.ObjectId(String(boundBookingId));
  if (acc.entityType === 'unit' || acc.unitId) {
    bookingData.unitId = acc.unitId || bookingData.unitId;
    if (!bookingData.cabinTypeId && session.quoteSnapshot && session.quoteSnapshot.cabinTypeId) {
      bookingData.cabinTypeId = session.quoteSnapshot.cabinTypeId;
    }
  } else if (acc.cabinId) {
    bookingData.cabinId = acc.cabinId;
    bookingData.cabinTypeId = undefined;
    bookingData.unitId = null;
  }

  assertImmutableQuoteCommercialSnapshot(session, { bookingId: boundBookingId });

  let facilityConsistency;
  try {
    const consistencyFn =
      typeof deps.assertQuoteLeaseFacilityConsistency === 'function'
        ? deps.assertQuoteLeaseFacilityConsistency
        : assertQuoteLeaseFacilityConsistency;
    facilityConsistency = await consistencyFn(session, deps);
  } catch (consistencyErr) {
    throw createLeaseWorkNeedsReviewError(
      consistencyErr && consistencyErr.code
        ? String(consistencyErr.code)
        : 'FACILITY_AUTHORITY_FAILED',
      consistencyErr.message || 'Quote-to-lease facility consistency failed',
      {
        stage: 'facility_authority',
        bookingId: boundBookingId,
        expectedFacilityReservationIds: Array.isArray(rl.facilityHoldIds)
          ? rl.facilityHoldIds.map(String)
          : [],
        failureCode: consistencyErr && consistencyErr.code ? String(consistencyErr.code) : null,
        retryable: true
      }
    );
  }

  const expectedFacilityIds = facilityConsistency.skip
    ? []
    : (facilityConsistency.facilityReservationIds || []).map(String);
  bookingData.resourceFinalizationSnapshot = buildResourceFinalizationSnapshot({
    session,
    paymentAuthorityType: ctx.paymentAuthorityType,
    paymentAuthorityMeta: ctx.paymentAuthorityMeta,
    expectedFacilityReservationIds: expectedFacilityIds,
    confirmedFacilityReservationIds: []
  });

  const saved = await saveLeaseAwareBookingWithoutVoucherRelease(deps, {
    bookingData,
    checkoutId,
    boundBookingId,
    session,
    paymentIntentId: paymentIntentIdForReview
  });
  let booking = saved.booking;
  if (typeof deps.afterBookingSave === 'function') {
    await deps.afterBookingSave({ checkoutId, bookingId: boundBookingId, booking });
  }

  let paymentLedgerLinked = false;
  if (paymentIntentIdForReview && stripePaymentVerified) {
    const linkFn =
      typeof deps.linkStripePaymentToBooking === 'function'
        ? deps.linkStripePaymentToBooking
        : linkStripePaymentToBooking;
    let linkResult = null;
    try {
      linkResult = await linkFn({
        booking,
        linkedBy: 'checkout_finalize_lease_aware'
      });
    } catch (linkErr) {
      console.error(
        JSON.stringify({
          source: 'execute-booking-finalize-work',
          phase: 'lease_payment_link',
          bookingId: String(booking._id),
          paymentIntentId: paymentIntentIdForReview,
          error: linkErr?.message || String(linkErr)
        })
      );
      throw createLeaseWorkNeedsReviewError(
        'PAYMENT_LINK_FAILED',
        linkErr?.message || 'Failed to link Stripe payment to booking',
        {
          stage: 'payment_link',
          bookingId: boundBookingId,
          retryable: true
        }
      );
    }

    const linkStatus = linkResult && linkResult.status ? String(linkResult.status) : '';
    if (linkStatus === 'not_found') {
      // Payment row may still be racing in via webhook. Booking finalize continues;
      // paymentLinkedAt / MRI resolve stay gated here. Catch-up is deterministic in
      // stripeIngestionService: later payment_intent.succeeded upsert finds the
      // Booking by stripePaymentIntentId, calls linkStripePaymentToBooking
      // (linkedBy: stripe_webhook_reconciliation), and backfills
      // CheckoutFinalizationJob.paymentLinkedAt when still null.
      console.warn(
        JSON.stringify({
          source: 'execute-booking-finalize-work',
          phase: 'lease_payment_link',
          bookingId: String(booking._id),
          paymentIntentId: paymentIntentIdForReview,
          result: 'not_found'
        })
      );
    } else if (linkStatus === 'invalid_input') {
      throw createLeaseWorkNeedsReviewError(
        'PAYMENT_LINK_INVALID',
        'Payment link rejected invalid booking/payment intent input',
        {
          stage: 'payment_link',
          bookingId: boundBookingId,
          retryable: false
        }
      );
    } else if (linkStatus === 'conflict') {
      throw createLeaseWorkNeedsReviewError(
        'PAYMENT_LINK_CONFLICT',
        'Payment is already linked to a different booking',
        {
          stage: 'payment_link',
          bookingId: boundBookingId,
          existingReservationId: linkResult.existingReservationId || null,
          retryable: false
        }
      );
    } else if (linkStatus === 'linked' || linkStatus === 'already_linked') {
      const verifyFn =
        typeof deps.verifyPaymentLinkedToBooking === 'function'
          ? deps.verifyPaymentLinkedToBooking
          : verifyPaymentLinkedToBooking;
      const verified = await verifyFn({
        booking,
        paymentIntentId: paymentIntentIdForReview
      });
      if (!verified.linked) {
        console.error(
          JSON.stringify({
            source: 'execute-booking-finalize-work',
            phase: 'lease_payment_link_unverified',
            bookingId: String(booking._id),
            paymentIntentId: paymentIntentIdForReview,
            linkStatus,
            verifyReason: verified.reason || null
          })
        );
        throw createLeaseWorkNeedsReviewError(
          'PAYMENT_LINK_UNVERIFIED',
          'Payment ledger reservationId does not match booking after link attempt',
          {
            stage: 'payment_link',
            bookingId: boundBookingId,
            linkStatus,
            verifyReason: verified.reason || null,
            retryable: true
          }
        );
      }
      paymentLedgerLinked = true;
    } else {
      throw createLeaseWorkNeedsReviewError(
        'PAYMENT_LINK_FAILED',
        `Payment linkage failed with status ${linkStatus || 'unknown'}`,
        {
          stage: 'payment_link',
          bookingId: boundBookingId,
          linkStatus: linkStatus || null,
          retryable: true
        }
      );
    }

    if (deps.stripe?.paymentIntents?.update) {
      try {
        const metadataPatch = {
          bookingId: String(booking._id),
          reservationId: String(booking._id)
        };
        if (booking.attribution?.referralCode) {
          metadataPatch.referralCode = booking.attribution.referralCode;
        }
        await deps.stripe.paymentIntents.update(paymentIntentIdForReview, {
          metadata: metadataPatch
        });
      } catch {
        // non-fatal, same as legacy path — ledger link is authoritative
      }
    }
  }

  try {
    await confirmVoucherIfNeeded(deps, {
      booking,
      source,
      checkoutId,
      finalizeContext: ctx,
      paymentIntentIdForReview,
      voucherEvidence: ctx.voucherEvidence || {},
      stripePaymentVerified: Boolean(stripePaymentVerified)
    });
  } catch (voucherErr) {
    throw createLeaseWorkNeedsReviewError(
      'VOUCHER_CONFIRM_FAILED',
      voucherErr.message || 'Voucher confirmation failed',
      {
        stage: 'voucher_confirm',
        bookingId: boundBookingId,
        voucherRedemptionId:
          (ctx.paymentAuthorityMeta && ctx.paymentAuthorityMeta.voucherRedemptionId) ||
          session.voucherRedemptionId ||
          null,
        voucherOperationId:
          (ctx.paymentAuthorityMeta && ctx.paymentAuthorityMeta.voucherOperationId) || null,
        retryable: true
      }
    );
  }
  if (typeof deps.afterVoucherConfirm === 'function') {
    await deps.afterVoucherConfirm({ checkoutId, bookingId: boundBookingId });
  }

  let confirmedIds = [];
  // Skip only when quote selections AND lease facilityHoldIds are both empty
  // (assertQuoteLeaseFacilityConsistency.skip). Never skip solely on empty lease IDs.
  if (!facilityConsistency.skip) {
    try {
      const confirmFn =
        typeof deps.confirmExactFacilityHoldsForPaidCheckout === 'function'
          ? deps.confirmExactFacilityHoldsForPaidCheckout
          : confirmExactFacilityHoldsForPaidCheckout;
      const confirmResult = await confirmFn(
        {
          checkoutId: String(checkoutId),
          bookingId: boundBookingId,
          facilityReservationIds: expectedFacilityIds,
          generation,
          attemptId,
          quoteSnapshotHash
        },
        deps
      );
      confirmedIds = Array.isArray(confirmResult && confirmResult.reservationIds)
        ? confirmResult.reservationIds.map(String)
        : (confirmResult && confirmResult.reservations
            ? confirmResult.reservations.map((r) => String(r._id))
            : []);
      const confirmedSet = new Set(confirmedIds);
      for (const id of expectedFacilityIds) {
        if (!confirmedSet.has(String(id))) {
          throw createLeaseWorkNeedsReviewError(
            'FACILITY_CONFIRM_FAILED',
            'Expected facility reservation was not confirmed for this booking',
            {
              stage: 'facility_confirm',
              bookingId: boundBookingId,
              expectedFacilityReservationIds: expectedFacilityIds,
              retryable: true
            }
          );
        }
      }
      if (confirmedSet.size !== new Set(expectedFacilityIds).size) {
        throw createLeaseWorkNeedsReviewError(
          'FACILITY_CONFIRM_FAILED',
          'Confirmed facility set does not match expected lease facility holds',
          {
            stage: 'facility_confirm',
            bookingId: boundBookingId,
            expectedFacilityReservationIds: expectedFacilityIds,
            retryable: true
          }
        );
      }
    } catch (facilityErr) {
      if (facilityErr && facilityErr.needsReview) throw facilityErr;
      throw createLeaseWorkNeedsReviewError(
        'FACILITY_CONFIRM_FAILED',
        facilityErr.message || 'Facility confirmation failed',
        {
          stage: 'facility_confirm',
          bookingId: boundBookingId,
          expectedFacilityReservationIds: expectedFacilityIds,
          failureCode: facilityErr.code || null,
          retryable: true
        }
      );
    }
  }
  if (typeof deps.afterFacilityConfirm === 'function') {
    await deps.afterFacilityConfirm({ checkoutId, bookingId: boundBookingId, confirmedIds });
  }

  const snapshotUpdate = buildResourceFinalizationSnapshot({
    session,
    paymentAuthorityType: ctx.paymentAuthorityType,
    paymentAuthorityMeta: ctx.paymentAuthorityMeta,
    expectedFacilityReservationIds: expectedFacilityIds,
    confirmedFacilityReservationIds: confirmedIds
  });
  await deps.Booking.updateOne(
    { _id: booking._id },
    { $set: { resourceFinalizationSnapshot: snapshotUpdate } }
  );
  booking = await deps.Booking.findById(booking._id);
  if (typeof deps.afterBookingFacilitySnapshot === 'function') {
    await deps.afterBookingFacilitySnapshot({
      checkoutId,
      bookingId: boundBookingId,
      confirmedIds
    });
  }

  try {
    await tombstonePromotedAccommodationCheckoutHold(promoteInput, deps);
  } catch (tombstoneErr) {
    throw createLeaseWorkNeedsReviewError(
      'ACCOMMODATION_TOMBSTONE_FAILED',
      tombstoneErr.message || 'Accommodation tombstone failed',
      {
        stage: 'tombstone',
        bookingId: boundBookingId,
        resourceLeaseGeneration: generation,
        resourceLeaseAttemptId: attemptId,
        quoteSnapshotHash,
        failureCode: tombstoneErr.code || null,
        retryable: true
      }
    );
  }
  if (typeof deps.afterAccommodationTombstone === 'function') {
    await deps.afterAccommodationTombstone({ checkoutId, bookingId: boundBookingId });
  }
  if (typeof deps.beforeMarkFinalizeSucceeded === 'function') {
    await deps.beforeMarkFinalizeSucceeded({ checkoutId, bookingId: boundBookingId });
  }

  return {
    bookingId: booking._id,
    booking,
    result: {
      idempotentReplay: saved.isReplay === true,
      leaseAware: true,
      paymentLinked: paymentLedgerLinked === true
    }
  };
}

async function executeBookingFinalizeWork({
  session,
  checkoutId,
  paymentIntentId = null,
  bookingPayload = null,
  finalizeContext = {},
  source = 'frontend',
  dependencies = null
}) {
  // Callers may supply a partial override bag (e.g. S0 recovery suppresses MRI opens).
  // Always merge onto the active defaults so Booking/link helpers remain defined.
  const deps = dependencies
    ? { ...activeDependencies, ...dependencies }
    : activeDependencies;

  const stayFingerprint = String(session?.stayFingerprint || '').trim();
  if (!stayFingerprint) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE,
      'Checkout session stayFingerprint is required for booking finalize work',
      { checkoutId: checkoutId || session?.checkoutId || null }
    );
  }

  let ctx = { ...finalizeContext, checkoutId: checkoutId || finalizeContext.checkoutId };
  const paymentIntentIdForReview = paymentIntentId
    ? String(paymentIntentId).trim()
    : ctx.paymentIntentId
      ? String(ctx.paymentIntentId).trim()
      : null;
  const stripePaymentVerifiedFlag = Boolean(ctx.stripePaymentVerified);
  const checkoutFingerprint = buildCheckoutFingerprintFromContext({
    finalizeContext: ctx,
    paymentIntentId: paymentIntentIdForReview
  });

  // B8F4B lease-aware path — never use legacy claimUnitNights / cabin preclaim.
  // Skip early Booking replay: lease work must resume promote/facilities/tombstone
  // even when a Booking already exists for this checkout / PI.
  if (isLeaseAwareSessionLocal(session) || ctx.leaseAwareFinalize === true) {
    return executeLeaseAwareFinalizeWork({
      session,
      checkoutId,
      paymentIntentId,
      bookingPayload,
      finalizeContext: {
        ...ctx,
        boundBookingId:
          ctx.boundBookingId ||
          (session.bookingId != null ? String(session.bookingId) : null)
      },
      source,
      dependencies: deps
    });
  }

  const replayByCheckout = await findReplayByCheckoutId(deps, {
    checkoutId,
    checkoutFingerprint
  });
  if (replayByCheckout) {
    await reconcileSplitInstallmentsAfterBookingPersist(deps, {
      booking: replayByCheckout.booking,
      session,
      paymentIntentId: paymentIntentIdForReview
    });
    await runShadowClaimsAfterCanonicalSurvival(deps, {
      booking: replayByCheckout.booking,
      source,
      paymentIntentId: paymentIntentIdForReview,
      checkoutId,
      stripePaymentVerified: stripePaymentVerifiedFlag
    });
    return replayByCheckout;
  }

  const replayByPi = await findReplayByPaymentIntent(deps, {
    checkoutId,
    checkoutFingerprint,
    stripePaymentVerified: stripePaymentVerifiedFlag,
    paymentIntentId: paymentIntentIdForReview
  });
  if (replayByPi) {
    await reconcileSplitInstallmentsAfterBookingPersist(deps, {
      booking: replayByPi.booking,
      session,
      paymentIntentId: paymentIntentIdForReview
    });
    await runShadowClaimsAfterCanonicalSurvival(deps, {
      booking: replayByPi.booking,
      source,
      paymentIntentId: paymentIntentIdForReview,
      checkoutId,
      stripePaymentVerified: stripePaymentVerifiedFlag
    });
    return replayByPi;
  }

  ctx = await resolveCabinTypeUnitForFinalize(deps, ctx, { paymentIntentIdForReview });

  const { bookingData, initialStatus, stripePaymentVerified } = buildBookingData({
    session,
    checkoutId,
    paymentIntentId: paymentIntentIdForReview,
    bookingPayload,
    finalizeContext: ctx,
    source
  });

  assertCabinTypeBookingHasUnitBeforeSave(bookingData, { paymentIntentIdForReview });

  const voucherReservationContext = ctx.voucherReservationContext || null;
  const voucherEvidence = ctx.voucherEvidence || {};

  // I6: mint Booking _id and acquire unit claims BEFORE durable allocated Booking.
  // S1.7: mint Booking _id and acquire cabin claims BEFORE durable single-cabin Booking (authoritative mode only).
  let preClaimAttempt = null;
  let cabinPreClaimAttempt = null;
  const needsPreClaim = Boolean(bookingData.cabinTypeId && bookingData.unitId);
  const needsCabinPreClaim =
    !needsPreClaim &&
    Boolean(bookingData.cabinId) &&
    isValidSingleCabinCommercialShape(bookingData) &&
    BLOCKING_BOOKING_STATUSES.includes(String(bookingData.status || 'pending'));

  if (needsPreClaim || needsCabinPreClaim) {
    if (!bookingData._id) {
      bookingData._id = session.bookingId
        ? new mongoose.Types.ObjectId(String(session.bookingId))
        : new mongoose.Types.ObjectId();
    }
  } else if (!bookingData._id && session.bookingId) {
    bookingData._id = new mongoose.Types.ObjectId(String(session.bookingId));
  }

  if (needsPreClaim) {
    try {
      preClaimAttempt = await claimUnitNights({
        bookingId: bookingData._id,
        unitId: bookingData.unitId,
        checkIn: bookingData.checkIn,
        checkOut: bookingData.checkOut,
        source: resolveClaimSourceForFinalize(source)
      });
    } catch (claimErr) {
      if (
        claimErr?.code === CLAIM_ERR.FOREIGN_OWNER ||
        claimErr?.code === CLAIM_ERR.INDEX_MISSING
      ) {
        throw createRouteStyleError(
          claimErr.code === CLAIM_ERR.INDEX_MISSING ? 'INVENTORY_INDEX_UNAVAILABLE' : 'NOT_AVAILABLE',
          claimErr.code === CLAIM_ERR.INDEX_MISSING
            ? 'Inventory exclusivity is not available; try again later'
            : 'This unit was just booked by another guest. Please choose different dates.',
          { details: claimErr.details || null }
        );
      }
      throw claimErr;
    }
  }

  if (needsCabinPreClaim) {
    const cabinAcquire =
      typeof deps.preAcquireCabinNightsForCreate === 'function'
        ? deps.preAcquireCabinNightsForCreate
        : preAcquireCabinNightsForCreate;
    try {
      cabinPreClaimAttempt = await cabinAcquire({
        bookingId: bookingData._id,
        cabinId: bookingData.cabinId,
        checkIn: bookingData.checkIn,
        checkOut: bookingData.checkOut,
        source: resolveClaimSourceForFinalize(source) === 'legacy_create'
          ? CABIN_S1_SOURCES.LEGACY_CREATE
          : CABIN_S1_SOURCES.FINALIZE
      });
    } catch (claimErr) {
      if (
        claimErr?.code === CABIN_CLAIM_ERR.FOREIGN_OWNER ||
        claimErr?.code === CABIN_CLAIM_ERR.INDEX_MISSING ||
        claimErr?.code === CABIN_CLAIM_ERR.INDEX_WRONG
      ) {
        // Paid finalize: do not create a second Booking; payment evidence remains on checkout/PI.
        throw createRouteStyleError(
          claimErr.code === CABIN_CLAIM_ERR.FOREIGN_OWNER
            ? 'NOT_AVAILABLE'
            : 'INVENTORY_INDEX_UNAVAILABLE',
          claimErr.code === CABIN_CLAIM_ERR.FOREIGN_OWNER
            ? 'This cabin was just booked by another guest. Please choose different dates.'
            : 'Inventory exclusivity is not available; try again later',
          { details: claimErr.details || null }
        );
      }
      throw claimErr;
    }
  }

  let saveOutcome;
  try {
    saveOutcome = await saveBookingWithReplay(deps, {
      bookingData,
      checkoutId,
      checkoutFingerprint,
      voucherReservationContext,
      paymentIntentIdForReview,
      voucherEvidence,
      session
    });
  } catch (saveErr) {
    if (preClaimAttempt?.insertedNightsThisAttempt?.length) {
      try {
        await compensateClaimAttempt({
          bookingId: bookingData._id,
          unitId: bookingData.unitId,
          insertedNightsThisAttempt: preClaimAttempt.insertedNightsThisAttempt
        });
      } catch {
        /* compensation failure → orphan claims; I5 detects */
      }
    } else if (needsPreClaim && bookingData._id) {
      try {
        await releaseUnitNights({ bookingId: bookingData._id });
      } catch {
        /* ignore */
      }
    }

    if (cabinPreClaimAttempt && !cabinPreClaimAttempt.skipped) {
      const compensate =
        typeof deps.compensateCreateAttemptClaims === 'function'
          ? deps.compensateCreateAttemptClaims
          : compensateCreateAttemptClaims;
      await compensate({
        attempt: cabinPreClaimAttempt,
        writer: CABIN_S1_SOURCES.FINALIZE,
        bookingId: bookingData._id,
        cabinId: bookingData.cabinId,
        openManualReviewItemFn:
          typeof deps.shadowClaimOpenManualReviewItem === 'function'
            ? deps.shadowClaimOpenManualReviewItem
            : openManualReviewItem
      });
    }
    throw saveErr;
  }
  if (saveOutcome.isReplay) {
    await runShadowClaimsAfterCanonicalSurvival(deps, {
      booking: saveOutcome.booking,
      source,
      paymentIntentId: paymentIntentIdForReview,
      checkoutId,
      stripePaymentVerified: Boolean(stripePaymentVerified)
    });
    return toReplayResult(saveOutcome.booking);
  }
  let booking = saveOutcome.booking;

  if (booking.stripePaymentIntentId && deps.linkStripePaymentToBooking) {
    try {
      await deps.linkStripePaymentToBooking({
        booking,
        linkedBy: 'booking_create_reconciliation'
      });
    } catch {
      // non-fatal, same as route
    }
  }

  if (stripePaymentVerified && paymentIntentIdForReview && deps.stripe?.paymentIntents?.update) {
    try {
      const metadataPatch = {
        bookingId: String(booking._id),
        reservationId: String(booking._id)
      };
      if (booking.attribution?.referralCode) {
        metadataPatch.referralCode = booking.attribution.referralCode;
      }
      await deps.stripe.paymentIntents.update(paymentIntentIdForReview, {
        metadata: metadataPatch
      });
    } catch {
      // non-fatal, same as route
    }
  }

  await runPostSaveOverlapChecks(deps, {
    booking,
    finalizeContext: ctx,
    paymentIntentIdForReview,
    voucherReservationContext,
    voucherEvidence,
    claimSource: source,
    stripePaymentVerified: Boolean(stripePaymentVerified)
  });

  await incrementPromoUsageIfNeeded(deps, {
    booking,
    finalizeContext: ctx,
    initialStatus,
    paymentIntentIdForReview,
    voucherReservationContext,
    voucherEvidence
  });

  await confirmVoucherIfNeeded(deps, {
    booking,
    source,
    checkoutId,
    finalizeContext: ctx,
    paymentIntentIdForReview,
    voucherEvidence,
    stripePaymentVerified: Boolean(stripePaymentVerified)
  });

  await runShadowClaimsAfterCanonicalSurvival(deps, {
    booking,
    source,
    paymentIntentId: paymentIntentIdForReview,
    checkoutId,
    stripePaymentVerified: Boolean(stripePaymentVerified)
  });

  return {
    bookingId: booking._id,
    booking,
    result: { idempotentReplay: false }
  };
}

module.exports = {
  executeBookingFinalizeWork,
  bookingMatchesCheckoutFingerprint,
  buildCheckoutFingerprintFromContext,
  buildBookingData,
  resolveCabinTypeUnitForFinalize,
  assertCabinTypeBookingHasUnitBeforeSave,
  createDefaultDependencies,
  __setExecuteBookingFinalizeWorkDependenciesForTesting,
  __resetExecuteBookingFinalizeWorkDependenciesForTesting
};
