const Booking = require('../../models/Booking');
const PromoCode = require('../../models/PromoCode');
const { BLOCKING_BOOKING_STATUSES } = require('../calendar/blockingStatusConstants');
const {
  CHECKOUT_SESSION_ERROR_CODES,
  CheckoutSessionError
} = require('./checkoutSessionErrors');
const { linkStripePaymentToBooking } = require('../payments/paymentLinkingService');
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
  guestPayload
}) {
  const err = new Error(errorSummary || 'Paid booking finalization failed');
  err.code = 'PAID_BOOKING_SAVE_FAILED';
  err.needsReview = true;
  err.errorCode = errorCode || null;
  err.guestPayload = guestPayload || defaultGuestNeedsReviewPayload(paymentIntentId);
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

function buildBookingData({
  session,
  checkoutId,
  paymentIntentId,
  bookingPayload,
  finalizeContext
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
          typeof ctx.specialRequests === 'string' ? ctx.specialRequests.trim().slice(0, 500) : ''
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
      source: 'guest_portal',
      intakeRevision: 1,
      createdByRoute: 'POST /api/bookings'
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
    confirmVoucherReservation,
    releaseVoucherReservation,
    countBlockingBlocksForSingleCabin,
    countBlockingBlocksForUnit,
    recordPaidBookingResolutionIssue: async () => null,
    openManualReviewItem: async () => null,
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
    const isAvailable = await AssignmentEngine.isUnitAvailable(
      requestedUnitId,
      ctx.checkInDate,
      ctx.checkOutDate
    );
    if (!isAvailable) {
      if (paymentIntentIdForReview) {
        await deps.recordPaidBookingResolutionIssue({
          issueType: 'paid_booking_conflict',
          errorCode: 'UNIT_NOT_AVAILABLE',
          errorSummary: 'Requested unit is not available for the selected dates',
          paymentIntentId: paymentIntentIdForReview,
          bookingAttempt: ctx.bookingAttemptContext || null
        });
        throw createPaidBookingSaveFailedError({
          errorCode: 'UNIT_NOT_AVAILABLE',
          errorSummary: 'Requested unit is not available for the selected dates',
          paymentIntentId: paymentIntentIdForReview
        });
      }
      throw createRouteStyleError(
        'NOT_AVAILABLE',
        'The requested unit is not available for the selected dates'
      );
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
        bookingAttempt: ctx.bookingAttemptContext || null
      });
      throw createPaidBookingSaveFailedError({
        errorCode: 'NO_UNITS_AVAILABLE',
        errorSummary: 'All units are occupied for the selected dates',
        paymentIntentId: paymentIntentIdForReview
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

async function saveBookingWithReplay(deps, {
  bookingData,
  checkoutId,
  checkoutFingerprint,
  voucherReservationContext,
  paymentIntentIdForReview,
  voucherEvidence
}) {
  try {
    const booking = new deps.Booking(bookingData);
    await booking.save();
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

async function runPostSaveOverlapChecks(deps, {
  booking,
  finalizeContext,
  paymentIntentIdForReview,
  voucherReservationContext,
  voucherEvidence
}) {
  const ctx = finalizeContext || {};
  const { checkInDate, checkOutDate, cabinId, assignedUnitId, parentCabinForUnit } = ctx;
  const blocking = deps.blockingBookingStatuses || BLOCKING_BOOKING_STATUSES;

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
      await deps.Booking.deleteOne({ _id: booking._id });
      await tryReleaseVoucherOnFailure(deps, {
        voucherReservationContext,
        reason: 'booking_conflict_after_save',
        note: 'release voucher reservation after cabin overlap conflict'
      });
      if (paymentIntentIdForReview) {
        await deps.recordPaidBookingResolutionIssue({
          issueType: 'paid_booking_conflict',
          errorCode: 'CABIN_OVERLAP_AFTER_SAVE',
          errorSummary: `overlaps=${overlaps}, blockRace=${blockRace}`,
          paymentIntentId: paymentIntentIdForReview,
          bookingAttempt: ctx.bookingAttemptContext || null
        });
        throw createPaidBookingSaveFailedError({
          errorCode: 'CABIN_OVERLAP_AFTER_SAVE',
          errorSummary: `overlaps=${overlaps}, blockRace=${blockRace}`,
          paymentIntentId: paymentIntentIdForReview
        });
      }
      throw createRouteStyleError(
        'NOT_AVAILABLE',
        'This cabin was just booked by another guest. Please choose different dates.'
      );
    }
  }

  if (assignedUnitId) {
    const overlaps = await deps.Booking.countDocuments({
      unitId: assignedUnitId,
      _id: { $ne: booking._id },
      status: { $in: blocking },
      checkIn: { $lt: checkOutDate },
      checkOut: { $gt: checkInDate }
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
      await deps.Booking.deleteOne({ _id: booking._id });
      await tryReleaseVoucherOnFailure(deps, {
        voucherReservationContext,
        reason: 'booking_conflict_after_save',
        note: 'release voucher reservation after unit overlap conflict'
      });
      if (paymentIntentIdForReview) {
        await deps.recordPaidBookingResolutionIssue({
          issueType: 'paid_booking_conflict',
          errorCode: 'UNIT_OVERLAP_AFTER_SAVE',
          errorSummary: `overlaps=${overlaps}, blockRace=${blockRace}`,
          paymentIntentId: paymentIntentIdForReview,
          bookingAttempt: ctx.bookingAttemptContext || null
        });
        throw createPaidBookingSaveFailedError({
          errorCode: 'UNIT_OVERLAP_AFTER_SAVE',
          errorSummary: `overlaps=${overlaps}, blockRace=${blockRace}`,
          paymentIntentId: paymentIntentIdForReview
        });
      }
      throw createRouteStyleError(
        'NOT_AVAILABLE',
        'This unit was just booked by another guest. Please choose different dates.'
      );
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
    await deps.Booking.deleteOne({ _id: booking._id });
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
        bookingAttempt: ctx.bookingAttemptContext || null
      });
      throw createPaidBookingSaveFailedError({
        errorCode: 'PROMO_USAGE_CONFLICT_AFTER_SAVE',
        errorSummary: 'Promo usage limit reached after booking save',
        paymentIntentId: paymentIntentIdForReview
      });
    }
    throw createRouteStyleError(
      'PROMO_CONFLICT',
      'This promo code is no longer available for new bookings.'
    );
  }
}

async function confirmVoucherIfNeeded(deps, {
  finalizeContext,
  paymentIntentIdForReview,
  voucherEvidence
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
    throw createVoucherConfirmFailedError(confirmErr.message);
  }
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
  const deps = dependencies || activeDependencies;
  void source;

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
  const checkoutFingerprint = buildCheckoutFingerprintFromContext({
    finalizeContext: ctx,
    paymentIntentId: paymentIntentIdForReview
  });

  const replayByCheckout = await findReplayByCheckoutId(deps, {
    checkoutId,
    checkoutFingerprint
  });
  if (replayByCheckout) {
    return replayByCheckout;
  }

  const replayByPi = await findReplayByPaymentIntent(deps, {
    checkoutId,
    checkoutFingerprint,
    stripePaymentVerified: Boolean(ctx.stripePaymentVerified),
    paymentIntentId: paymentIntentIdForReview
  });
  if (replayByPi) {
    return replayByPi;
  }

  ctx = await resolveCabinTypeUnitForFinalize(deps, ctx, { paymentIntentIdForReview });

  const { bookingData, initialStatus, stripePaymentVerified } = buildBookingData({
    session,
    checkoutId,
    paymentIntentId: paymentIntentIdForReview,
    bookingPayload,
    finalizeContext: ctx
  });

  const voucherReservationContext = ctx.voucherReservationContext || null;
  const voucherEvidence = ctx.voucherEvidence || {};

  const saveOutcome = await saveBookingWithReplay(deps, {
    bookingData,
    checkoutId,
    checkoutFingerprint,
    voucherReservationContext,
    paymentIntentIdForReview,
    voucherEvidence
  });
  if (saveOutcome.isReplay) {
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
    voucherEvidence
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
    finalizeContext: ctx,
    paymentIntentIdForReview,
    voucherEvidence
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
  createDefaultDependencies,
  __setExecuteBookingFinalizeWorkDependenciesForTesting,
  __resetExecuteBookingFinalizeWorkDependenciesForTesting
};
