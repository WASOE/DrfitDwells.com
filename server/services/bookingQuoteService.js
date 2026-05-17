/**
 * Combines pricingService breakdown + promoService (lodging-only promo in v1).
 * Used by POST /bookings/quote, create-payment-intent, and POST /bookings.
 */
const moment = require('moment');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const AssignmentEngine = require('./assignmentEngine');
const featureFlags = require('../utils/featureFlags');
const pricingService = require('./pricingService');
const promoService = require('./promoService');
const {
  normalizeGuestStayRange,
  assertSingleCabinGuestStayAvailableOrThrow
} = require('./publicAvailabilityService');
const { normalizeDateToSofiaDayStart } = require('../utils/dateTime');
const { previewVoucherApplication } = require('./bookings/bookingVoucherRedemptionService');

/**
 * After entity + dates are resolved (same inputs as pricingService).
 */
async function computeQuoteFromEntity(
  entity,
  checkInDate,
  checkOutDate,
  adults,
  children,
  experienceKeys,
  transportMethod,
  romanticSetup,
  promoCodeRaw
) {
  const breakdown = pricingService.calculateCabinPriceBreakdown(
    entity,
    checkInDate,
    checkOutDate,
    adults,
    children,
    experienceKeys,
    { transportMethod, romanticSetup }
  );
  return promoService.applyPromoToBreakdown(breakdown, promoCodeRaw);
}

/**
 * Full public quote / payment-intent pricing pipeline (mirrors create-payment-intent entity resolution).
 * @param {object} body - req.body
 * @returns {Promise<{ ok: true, ... } | { ok: false, status: number, message: string, errors?: array }>}
 */
async function buildPublicBookingQuote(body) {
  const {
    cabinId,
    cabinTypeId,
    checkIn,
    checkOut,
    adults,
    children = 0,
    experienceKeys = [],
    transportMethod,
    romanticSetup,
    promoCode
  } = body;

  if (!cabinId && !cabinTypeId) {
    return { ok: false, status: 400, message: 'Either cabinId or cabinTypeId is required' };
  }
  if (cabinId && cabinTypeId) {
    return { ok: false, status: 400, message: 'Cannot specify both cabinId and cabinTypeId' };
  }

  let checkInDate;
  let checkOutDate;
  try {
    const n = normalizeGuestStayRange(checkIn, checkOut);
    checkInDate = n.startDate;
    checkOutDate = n.endDate;
  } catch {
    return { ok: false, status: 400, message: 'Please provide a valid stay range (check-out must be after check-in)' };
  }

  const todayStart = normalizeDateToSofiaDayStart(new Date());
  if (checkInDate < todayStart) {
    return { ok: false, status: 400, message: 'Check-in date cannot be in the past' };
  }

  const totalGuests = parseInt(adults, 10) + parseInt(children, 10);
  let entity = null;
  let entityType = 'cabin';

  if (cabinId) {
    entity = await Cabin.findById(cabinId);
    if (!entity || !entity.isActive) {
      return { ok: false, status: 404, message: 'Cabin not found or not available' };
    }
    try {
      await assertSingleCabinGuestStayAvailableOrThrow(entity, checkIn, checkOut);
    } catch (e) {
      if (e.code === 'NOT_AVAILABLE') {
        return { ok: false, status: 409, message: 'This cabin is not available for the selected dates' };
      }
      throw e;
    }
  } else {
    entityType = 'cabinType';
    entity = await CabinType.findById(cabinTypeId);
    if (!entity || !entity.isActive) {
      return { ok: false, status: 404, message: 'Stay type not found or not available' };
    }
    if (!featureFlags.isMultiUnitGloballyEnabled() || !featureFlags.isMultiUnitType(entity.slug)) {
      return { ok: false, status: 400, message: 'This stay type is not configured for unified booking' };
    }
    const availableUnit = await AssignmentEngine.assignUnit(cabinTypeId, checkInDate, checkOutDate);
    if (!availableUnit) {
      return { ok: false, status: 409, message: 'No units available for the selected dates' };
    }
  }

  if (totalGuests > entity.capacity) {
    return { ok: false, status: 400, message: `This stay can only accommodate ${entity.capacity} guests` };
  }
  if (totalGuests < (entity.minGuests || 1)) {
    return {
      ok: false,
      status: 400,
      message: `This stay requires at least ${entity.minGuests || 1} guests`
    };
  }

  const errKeys = pricingService.validateExperienceKeys(entity, experienceKeys);
  if (errKeys) {
    return { ok: false, status: 400, message: errKeys };
  }

  const totalNights = moment(checkOutDate).diff(moment(checkInDate), 'days');
  const minNights = entity.minNights || 1;
  if (totalNights < minNights) {
    return {
      ok: false,
      status: 400,
      message: `This stay requires a minimum stay of ${minNights} night${minNights !== 1 ? 's' : ''}`
    };
  }

  const quote = await computeQuoteFromEntity(
    entity,
    checkInDate,
    checkOutDate,
    parseInt(adults, 10),
    parseInt(children, 10),
    experienceKeys,
    transportMethod,
    romanticSetup,
    promoCode
  );

  let voucherAppliedCents = 0;
  let remainingDueCents = Math.round(quote.totalPrice * 100);
  let fullVoucherCoverage = false;
  let voucherPreviewError = null;
  if (typeof body.voucherCode === 'string' && body.voucherCode.trim()) {
    const voucherPreview = await previewVoucherApplication({
      voucherCode: body.voucherCode,
      totalValueCents: Math.round(quote.totalPrice * 100)
    });
    voucherAppliedCents = Number(voucherPreview.voucherAppliedCents || 0);
    remainingDueCents = Number(voucherPreview.remainingDueCents || remainingDueCents);
    fullVoucherCoverage = Boolean(voucherPreview.fullVoucherCoverage);
    if (voucherPreview.success === false) {
      voucherPreviewError = voucherPreview.message || 'This voucher cannot be used.';
    }
  }

  return {
    ok: true,
    entityType,
    entity,
    checkInDate,
    checkOutDate,
    ...quote,
    promo: {
      applied: !!quote.promoSnapshot,
      invalidReason: quote.promoInvalidReason,
      snapshot: quote.promoSnapshot,
      label: quote.promoSnapshot ? 'Promo applied' : null
    },
    voucherAppliedCents,
    remainingDueCents,
    fullVoucherCoverage,
    voucherPreviewError
  };
}

/**
 * Verify Stripe PaymentIntent metadata against a freshly recomputed quote (after booking entity resolution).
 */
function verifyPaymentIntentPromoMetadata(pi, quote) {
  const meta = pi.metadata || {};
  const expectedFinal = Math.round(quote.totalPrice * 100);
  const voucherAppliedCents = Number(meta.voucherAppliedCents || 0);
  const expectedStripeAmount = Math.max(0, expectedFinal - (Number.isFinite(voucherAppliedCents) ? voucherAppliedCents : 0));
  if (pi.amount !== expectedStripeAmount) {
    return { ok: false, message: 'Payment amount does not match booking total' };
  }

  if (meta.subtotalCents != null && String(meta.subtotalCents) !== '') {
    if (Number(meta.subtotalCents) !== Math.round(quote.subtotalPrice * 100)) {
      return { ok: false, message: 'Payment pricing does not match booking' };
    }
    if (Number(meta.discountAmountCents) !== Math.round(quote.discountAmount * 100)) {
      return { ok: false, message: 'Payment discount does not match booking' };
    }
    if (Number(meta.finalTotalCents) !== expectedFinal) {
      return { ok: false, message: 'Payment total does not match booking' };
    }
  }

  const metaPromo = promoService.normalizePromoCodeInput(meta.promoCode) || '';
  const applied = quote.appliedPromoCode || '';
  if (metaPromo !== applied) {
    return { ok: false, message: 'Payment promo does not match booking' };
  }

  return { ok: true };
}

/**
 * Whether an existing voucher-checkout PaymentIntent can be safely replayed.
 * stripeAmountCents must equal pi.amount in all successful paths.
 */
function paymentIntentMatchesVoucherCheckout(pi, { quote, stripeAmountCents, voucherAppliedCents, redemptionId }) {
  if (!pi) {
    return { ok: false, message: 'missing_payment_intent' };
  }
  const expectedStripe = Number(stripeAmountCents);
  if (!Number.isFinite(expectedStripe) || Number(pi.amount) !== expectedStripe) {
    return { ok: false, message: 'amount_mismatch' };
  }

  const promoVerify = verifyPaymentIntentPromoMetadata(pi, quote);
  if (!promoVerify.ok) {
    return { ok: false, message: promoVerify.message };
  }

  const meta = pi.metadata || {};
  if (Number(meta.voucherAppliedCents || 0) !== Number(voucherAppliedCents || 0)) {
    return { ok: false, message: 'voucher_applied_mismatch' };
  }

  if (redemptionId != null && String(redemptionId) !== '') {
    if (String(meta.redemptionId || '') !== String(redemptionId)) {
      return { ok: false, message: 'redemption_id_mismatch' };
    }
  }

  return { ok: true };
}

module.exports = {
  computeQuoteFromEntity,
  buildPublicBookingQuote,
  verifyPaymentIntentPromoMetadata,
  paymentIntentMatchesVoucherCheckout
};
