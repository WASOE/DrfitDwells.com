/**
 * Combines pricingService breakdown + promoService (lodging-only promo in v1).
 * Used by POST /bookings/quote, create-payment-intent, and POST /bookings.
 *
 * B3: automatic seasonal RatePlan selection for normal accommodation quotes.
 * Fixed packages are never selected on this live path.
 * Client ratePlan / package / price fields are never authoritative.
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
const { normalizeDateToSofiaDayStart, formatSofiaDateOnly } = require('../utils/dateTime');
const { previewVoucherApplication } = require('./bookings/bookingVoucherRedemptionService');
const {
  validateAndNormalizeRatePlan,
  selectSeasonalRatePlan,
  resolveFixedPackage,
  confirmAccommodationApplicability,
  seasonalStayFullyEligible,
  freezeDeep,
  RatePlanError
} = require('./ratePlanService');
const {
  classifyPackageParticipants,
  assertPackageEligibility,
  assertCapacity,
  PackageParticipantError
} = require('./packageParticipantService');
const {
  listEligiblePackageInventory,
  RatePlanAvailabilityError,
  defaultLoadExclusiveFixedPackages
} = require('./ratePlanAvailabilityService');
const {
  applyFacilitySelectionsToQuote
} = require('./facilityBookingService');
const {
  applyCancellationPolicyToQuote
} = require('./cancellationPolicyService');

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

/**
 * Detect an explicit fixed-package request on the public quote path.
 */
function isFixedPackagePublicRequest(body) {
  if (!body || typeof body !== 'object') return false;
  if (body.fixedPackage === true) return true;
  if (body.packageType === 'fixed_package') return true;
  if (body.ratePlanType === 'fixed_package') return true;
  if (typeof body.packageCode === 'string' && body.packageCode.trim()) return true;
  if (typeof body.fixedPackageCode === 'string' && body.fixedPackageCode.trim()) return true;
  if (body.ratePlan && typeof body.ratePlan === 'object') {
    if (body.ratePlan.type === 'fixed_package') return true;
    if (
      body.ratePlan.version != null &&
      Array.isArray(body.participants) &&
      body.participants.length > 0
    ) {
      return true;
    }
  }
  if (
    Array.isArray(body.participants) &&
    body.participants.length > 0 &&
    (body.ratePlanCode || body.packageCode || body.fixedPackageCode)
  ) {
    return true;
  }
  return false;
}

async function defaultLoadRatePlanByCodeVersion(code, version) {
  const RatePlan = require('../models/RatePlan');
  const wanted = String(code).trim().toLowerCase();
  return RatePlan.findOne({ code: wanted, version }).lean();
}

async function defaultListInventoryResourcesForPackage({ accommodationKey, entity }) {
  const key = String(accommodationKey || '')
    .trim()
    .toLowerCase();
  // Multi-unit A-frames: physical Unit rows under CabinType.
  if (key === 'a-frame' || entity.inventoryType === 'multi' || entity.inventoryMode === 'multi') {
    const Unit = require('../models/Unit');
    const typeId = entity._id;
    return Unit.find({ cabinTypeId: typeId }).lean();
  }
  // Single-unit Lux / Stone: the Cabin document is the inventory resource.
  return [entity];
}

/**
 * Default DB loader for active seasonal plans. Overridable in tests (no Mongo).
 */
async function defaultLoadActiveSeasonalRatePlans() {
  // Lazy require so pure unit tests that stub this never need the model connected.
  const RatePlan = require('../models/RatePlan');
  return RatePlan.find({ status: 'active', type: 'seasonal_stay' }).lean();
}

/**
 * Normalize RatePlan / cabin pricing into the existing quote breakdown shape
 * expected by promoService and downstream consumers.
 */
function toCanonicalLodgingBreakdown({
  authoritative,
  extrasBreakdown,
  resolvedRatePlan
}) {
  if (!resolvedRatePlan) {
    return {
      baseLodgingPrice: extrasBreakdown.baseLodgingPrice,
      extraGuestLodgingPrice: 0,
      extrasTotal: extrasBreakdown.extrasTotal,
      totalPrice: extrasBreakdown.totalPrice,
      totalNights: extrasBreakdown.totalNights,
      experienceKeysUsed: extrasBreakdown.experienceKeysUsed,
      ratePlanPricingBreakdown: null
    };
  }

  const lodgingTotal = roundMoney(
    Number(authoritative.preDiscountTotal != null
      ? authoritative.preDiscountTotal
      : authoritative.totalPrice) || 0
  );
  const extrasTotal = roundMoney(Number(extrasBreakdown.extrasTotal) || 0);
  return {
    baseLodgingPrice: lodgingTotal,
    extraGuestLodgingPrice: roundMoney(Number(authoritative.additionalGuestAmount) || 0),
    extrasTotal,
    totalPrice: roundMoney(lodgingTotal + extrasTotal),
    totalNights: authoritative.numberOfNights,
    experienceKeysUsed: extrasBreakdown.experienceKeysUsed,
    ratePlanPricingBreakdown: authoritative
  };
}

/**
 * Resolve an automatic seasonal RatePlan for a normal accommodation quote.
 * Fixed packages are never selected.
 *
 * @returns {Promise<
 *   | { ok: true, resolved: object|null }
 *   | { ok: false, status: number, message: string, code?: string, details?: any }
 * >}
 */
async function resolveSeasonalRatePlanForQuote({
  checkInDate,
  checkOutDate,
  accommodationKey,
  loadActiveSeasonalRatePlans
}) {
  const checkIn = formatSofiaDateOnly(checkInDate);
  const checkOut = formatSofiaDateOnly(checkOutDate);
  if (!checkIn || !checkOut) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_STAY_DATES',
      message: 'Please provide a valid stay range (check-out must be after check-in)'
    };
  }

  let rawPlans;
  try {
    rawPlans = await loadActiveSeasonalRatePlans();
  } catch (err) {
    return {
      ok: false,
      status: 503,
      code: 'RATE_PLAN_LOOKUP_FAILED',
      message: 'Unable to load seasonal rate plans for this quote'
    };
  }

  if (!Array.isArray(rawPlans)) {
    return {
      ok: false,
      status: 503,
      code: 'RATE_PLAN_LOOKUP_FAILED',
      message: 'Unable to load seasonal rate plans for this quote'
    };
  }

  const normalized = [];
  for (const raw of rawPlans) {
    const result = validateAndNormalizeRatePlan(raw);
    if (!result.ok) {
      return {
        ok: false,
        status: 500,
        code: 'MALFORMED_SEASONAL_RATE_PLAN',
        message: 'Active seasonal rate plan data is invalid',
        details: result.errors
      };
    }
    // Live quote path: seasonal only. Ignore any fixed_package rows that leaked into the loader.
    if (result.value.type !== 'seasonal_stay') continue;
    if (result.value.status !== 'active') continue;
    normalized.push(result.value);
  }

  const selection = selectSeasonalRatePlan({
    plans: normalized,
    checkIn,
    checkOut,
    accommodationKey
  });

  if (selection.ok) {
    return { ok: true, resolved: selection.resolved };
  }

  if (selection.code === 'AMBIGUOUS_SEASONAL_RATE_PLAN') {
    return {
      ok: false,
      status: 500,
      code: selection.code,
      message: selection.message || 'Multiple seasonal rate plans match this stay',
      details: selection.details
    };
  }

  // Stay fully inside a seasonal window but below that plan's min nights → fail clearly
  // (do not silently undercharge with normal rates).
  const nights = moment(checkOutDate).diff(moment(checkInDate), 'days');
  const dateCoveredPlans = normalized
    .filter((plan) => confirmAccommodationApplicability(plan, accommodationKey).ok)
    .filter((plan) => seasonalStayFullyEligible({ ...plan, minNights: 1 }, checkIn, checkOut))
    .filter((plan) => nights < plan.minNights)
    .sort((a, b) => {
      const c = a.code.localeCompare(b.code);
      return c !== 0 ? c : a.version - b.version;
    });

  if (dateCoveredPlans.length > 0) {
    const plan = dateCoveredPlans[0];
    const minNights = plan.minNights;
    return {
      ok: false,
      status: 400,
      code: 'SEASONAL_MIN_NIGHTS',
      message: `This seasonal rate requires a minimum stay of ${minNights} night${minNights !== 1 ? 's' : ''}`
    };
  }

  return { ok: true, resolved: null };
}

/**
 * After entity + dates are resolved (same inputs as pricingService).
 * Optional resolvedRatePlan switches lodging to the RatePlan path while extras
 * still come from the entity (experiences / transport / romantic setup).
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
  promoCodeRaw,
  resolvedRatePlan = null,
  deps = {}
) {
  const extrasBreakdown = pricingService.calculateCabinPriceBreakdown(
    entity,
    checkInDate,
    checkOutDate,
    adults,
    children,
    experienceKeys,
    { transportMethod, romanticSetup }
  );

  const authoritative = pricingService.calculateAuthoritativePriceBreakdown({
    entity,
    checkIn: checkInDate,
    checkOut: checkOutDate,
    adults,
    children,
    experienceKeys,
    opts: { transportMethod, romanticSetup },
    resolvedRatePlan
  });

  const canonical = toCanonicalLodgingBreakdown({
    authoritative,
    extrasBreakdown,
    resolvedRatePlan
  });

  const applyPromo = deps.applyPromoToBreakdown || promoService.applyPromoToBreakdown.bind(promoService);
  const withPromo = await applyPromo(canonical, promoCodeRaw);
  return {
    ...withPromo,
    extraGuestLodgingPrice: canonical.extraGuestLodgingPrice,
    ratePlanPricingBreakdown: canonical.ratePlanPricingBreakdown,
    totalNights: canonical.totalNights,
    experienceKeysUsed: canonical.experienceKeysUsed
  };
}

/**
 * Quote pricing for an already-resolved entity (test seam; no Cabin/CabinType queries).
 */
async function buildQuoteForResolvedEntity(
  {
    entity,
    entityType = 'cabin',
    checkIn,
    checkOut,
    checkInDate,
    checkOutDate,
    adults,
    children = 0,
    experienceKeys = [],
    transportMethod,
    romanticSetup,
    promoCode,
    voucherCode
  },
  deps = {}
) {
  const loadActiveSeasonalRatePlans =
    deps.loadActiveSeasonalRatePlans || defaultLoadActiveSeasonalRatePlans;

  const accommodationKey =
    entity && entity.slug != null ? String(entity.slug).trim().toLowerCase() : '';
  if (!accommodationKey) {
    return {
      ok: false,
      status: 500,
      message: 'Accommodation is missing a stable slug for rate plan matching'
    };
  }

  const seasonal = await resolveSeasonalRatePlanForQuote({
    checkInDate,
    checkOutDate,
    accommodationKey,
    loadActiveSeasonalRatePlans
  });
  if (!seasonal.ok) {
    return {
      ok: false,
      status: seasonal.status || 500,
      message: seasonal.message,
      code: seasonal.code,
      details: seasonal.details
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
    promoCode,
    seasonal.resolved,
    deps
  );

  let voucherAppliedCents = 0;
  let remainingDueCents = Math.round(quote.totalPrice * 100);
  let fullVoucherCoverage = false;
  let voucherPreviewError = null;
  let voucherPreviewInternalCode = null;
  const codeToPreview =
    typeof voucherCode === 'string' && voucherCode.trim()
      ? voucherCode
      : null;
  if (codeToPreview) {
    const previewVoucher = deps.previewVoucherApplication || previewVoucherApplication;
    const voucherPreview = await previewVoucher({
      voucherCode: codeToPreview,
      totalValueCents: Math.round(quote.totalPrice * 100)
    });
    voucherAppliedCents = Number(voucherPreview.voucherAppliedCents || 0);
    remainingDueCents =
      voucherPreview.remainingDueCents != null && Number.isFinite(Number(voucherPreview.remainingDueCents))
        ? Number(voucherPreview.remainingDueCents)
        : remainingDueCents;
    fullVoucherCoverage = Boolean(voucherPreview.fullVoucherCoverage);
    if (voucherPreview.ok === false || voucherPreview.success === false) {
      voucherPreviewError = voucherPreview.publicMessage || voucherPreview.message || 'This voucher cannot be used.';
      voucherPreviewInternalCode = voucherPreview.internalCode || null;
      console.warn('[booking-quote] voucher preview rejected', {
        internalCode: voucherPreviewInternalCode,
        voucherCode: codeToPreview.trim().toUpperCase()
      });
    }
  }

  const result = {
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

  if (seasonal.resolved) {
    result.ratePlan = {
      code: seasonal.resolved.code,
      version: seasonal.resolved.version,
      type: seasonal.resolved.type,
      currency: seasonal.resolved.currency
    };
  }

  // Keep unused stay inputs referenced for callers that pass original strings.
  void checkIn;
  void checkOut;

  return result;
}

/**
 * Full public quote / payment-intent pricing pipeline (mirrors create-payment-intent entity resolution).
 * @param {object} body - req.body
 * @param {object} [deps] - optional overrides for tests (loaders, clocks)
 * @returns {Promise<{ ok: true, ... } | { ok: false, status: number, message: string, errors?: array }>}
 */
async function buildPublicBookingQuote(body, deps = {}) {
  // Fixed packages are not publicly enabled yet (B4).
  if (isFixedPackagePublicRequest(body)) {
    return {
      ok: false,
      status: 400,
      code: 'FIXED_PACKAGE_NOT_PUBLICLY_ENABLED',
      message: 'Fixed package quotes are not available on the public booking quote path yet'
    };
  }

  // Experimental / client-owned pricing blobs are never authoritative on this path.
  void body.package;
  void body.ratePlan;
  void body.ratePlanSnapshot;
  void body.ratePlanPricing;
  void body.price;
  void body.totalPrice;
  void body.clientPrice;
  void body.pricingOverride;
  void body.participants;

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

  const getTodayStart =
    deps.getTodayStart || (() => normalizeDateToSofiaDayStart(new Date()));
  const todayStart = getTodayStart();
  if (checkInDate < todayStart) {
    return { ok: false, status: 400, message: 'Check-in date cannot be in the past' };
  }

  const totalGuests = parseInt(adults, 10) + parseInt(children, 10);
  let entity = null;
  let entityType = 'cabin';

  const findCabin = deps.findCabin || ((id) => Cabin.findById(id));
  const findCabinType = deps.findCabinType || ((id) => CabinType.findById(id));
  const assertAvailable =
    deps.assertSingleCabinGuestStayAvailableOrThrow || assertSingleCabinGuestStayAvailableOrThrow;
  const assignUnit =
    deps.assignUnit || ((id, ci, co) => AssignmentEngine.assignUnit(id, ci, co));

  if (cabinId) {
    entity = await findCabin(cabinId);
    if (!entity || !entity.isActive) {
      return { ok: false, status: 404, message: 'Cabin not found or not available' };
    }
    try {
      await assertAvailable(entity, checkIn, checkOut);
    } catch (e) {
      if (e.code === 'NOT_AVAILABLE') {
        return { ok: false, status: 409, message: 'This cabin is not available for the selected dates' };
      }
      throw e;
    }
  } else {
    entityType = 'cabinType';
    entity = await findCabinType(cabinTypeId);
    if (!entity || !entity.isActive) {
      return { ok: false, status: 404, message: 'Stay type not found or not available' };
    }
    const multiEnabled =
      deps.isMultiUnitGloballyEnabled || (() => featureFlags.isMultiUnitGloballyEnabled());
    const isMultiType =
      deps.isMultiUnitType || ((slug) => featureFlags.isMultiUnitType(slug));
    if (!multiEnabled() || !isMultiType(entity.slug)) {
      return { ok: false, status: 400, message: 'This stay type is not configured for unified booking' };
    }
    const availableUnit = await assignUnit(cabinTypeId, checkInDate, checkOutDate);
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

  return buildQuoteForResolvedEntity(
    {
      entity,
      entityType,
      checkIn,
      checkOut,
      checkInDate,
      checkOutDate,
      adults,
      children,
      experienceKeys,
      transportMethod,
      romanticSetup,
      promoCode,
      voucherCode: body.voucherCode
    },
    deps
  );
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

/**
 * Internal fixed-package quote (B4). Not exposed on the public quote route.
 *
 * Loads the exact RatePlan version server-side, classifies participants from
 * fullName + dateOfBirth, enforces eligibility/capacity, and prices via
 * calculateAuthoritativePriceBreakdown.
 */
async function buildFixedPackageQuote(input = {}, deps = {}) {
  const {
    code,
    version,
    accommodationKey,
    checkIn,
    checkOut,
    participants,
    entity,
    ratePlan: clientRatePlan,
    ratePlanSnapshot,
    price,
    totalPrice,
    promoCode,
    referralCode,
    creatorCode,
    creatorDiscount,
    referralDiscount
  } = input;

  void clientRatePlan;
  void ratePlanSnapshot;
  void price;
  void totalPrice;
  // Client inventory claims are never authoritative.
  void input.availableUnitCount;
  void input.eligibleUnits;
  void input.inventory;
  void input.unitId;
  void input.assignedUnitId;

  if (
    promoCode ||
    referralCode ||
    creatorCode ||
    creatorDiscount ||
    referralDiscount ||
    input.discountCode
  ) {
    return {
      ok: false,
      status: 400,
      code: 'PACKAGE_DISCOUNT_NOT_CONFIGURED',
      message:
        'Promo, creator and referral discounts are not configured for fixed package quotes yet'
    };
  }

  if (!entity || typeof entity !== 'object') {
    return {
      ok: false,
      status: 400,
      code: 'ENTITY_REQUIRED',
      message: 'Accommodation entity is required for a fixed package quote'
    };
  }

  const slug =
    accommodationKey ||
    (entity.slug != null ? String(entity.slug).trim().toLowerCase() : '');
  if (!slug) {
    return {
      ok: false,
      status: 400,
      code: 'ACCOMMODATION_KEY_REQUIRED',
      message: 'Accommodation key (slug) is required'
    };
  }

  const loadRatePlanByCodeVersion =
    deps.loadRatePlanByCodeVersion || defaultLoadRatePlanByCodeVersion;

  let rawPlan;
  try {
    rawPlan = await loadRatePlanByCodeVersion(code, version);
  } catch (err) {
    return {
      ok: false,
      status: 503,
      code: 'RATE_PLAN_LOOKUP_FAILED',
      message: 'Unable to load the requested rate plan'
    };
  }

  if (!rawPlan) {
    return {
      ok: false,
      status: 404,
      code: 'RATE_PLAN_NOT_FOUND',
      message: `Rate plan ${code}@v${version} was not found`
    };
  }

  const normalized = validateAndNormalizeRatePlan(rawPlan);
  if (!normalized.ok) {
    return {
      ok: false,
      status: 500,
      code: 'MALFORMED_RATE_PLAN',
      message: 'Loaded rate plan data is invalid',
      details: normalized.errors
    };
  }

  const plan = normalized.value;
  if (plan.status !== 'active') {
    return {
      ok: false,
      status: 400,
      code: 'RATE_PLAN_INACTIVE',
      message: `Rate plan ${plan.code}@v${plan.version} is not active`
    };
  }
  if (plan.type !== 'fixed_package') {
    return {
      ok: false,
      status: 400,
      code: 'NOT_FIXED_PACKAGE',
      message: `Rate plan ${plan.code}@v${plan.version} is not a fixed package`
    };
  }

  const checkInStr =
    typeof checkIn === 'string' ? checkIn.slice(0, 10) : formatSofiaDateOnly(checkIn);
  const checkOutStr =
    typeof checkOut === 'string' ? checkOut.slice(0, 10) : formatSofiaDateOnly(checkOut);

  let resolved;
  let resolvedPlan;
  try {
    const result = resolveFixedPackage({
      plans: [plan],
      code: plan.code,
      version: plan.version,
      checkIn: checkInStr,
      checkOut: checkOutStr,
      accommodationKey: slug,
      clientInput: input
    });
    resolved = result.resolved;
    resolvedPlan = result.plan;
  } catch (err) {
    if (err instanceof RatePlanError) {
      return {
        ok: false,
        status: 400,
        code: err.code,
        message: err.message,
        details: err.details
      };
    }
    throw err;
  }

  const todayDateOnly =
    deps.todayDateOnly ||
    formatSofiaDateOnly(deps.getTodayStart ? deps.getTodayStart() : new Date());

  let classified;
  try {
    classified = classifyPackageParticipants(participants, checkInStr, {
      todayDateOnly
    });
    assertPackageEligibility(resolvedPlan.code, classified.counts);
    assertCapacity(classified.counts, entity.capacity);
  } catch (err) {
    if (err instanceof PackageParticipantError) {
      return {
        ok: false,
        status: 400,
        code: err.code,
        message: err.message,
        details: err.details
      };
    }
    throw err;
  }

  let inventory;
  try {
    const mongoose = require('mongoose');
    const mongoReady = mongoose.connection.readyState === 1;

    const listResources =
      deps.listInventoryResources ||
      (mongoReady
        ? defaultListInventoryResourcesForPackage
        : async () => [entity]);
    const resources = await listResources({
      accommodationKey: slug,
      entity,
      plan: resolvedPlan
    });
    const loadExclusive =
      deps.loadExclusiveFixedPackages ||
      (mongoReady
        ? defaultLoadExclusiveFixedPackages
        : async () => [resolvedPlan]);
    inventory = await listEligiblePackageInventory({
      plan: resolvedPlan,
      accommodationKey: slug,
      checkIn: checkInStr,
      checkOut: checkOutStr,
      resources,
      isResourceConflicted: deps.isResourceConflicted || (async () => false),
      loadExclusiveFixedPackages: loadExclusive
    });
  } catch (err) {
    if (err instanceof RatePlanAvailabilityError) {
      return {
        ok: false,
        status: err.code === 'EXCLUSIVE_RATE_PLAN_LOOKUP_FAILED' ? 503 : 400,
        code: err.code,
        message: err.message,
        details: err.details
      };
    }
    throw err;
  }

  if (!inventory.availableUnitCount || inventory.availableUnitCount < 1) {
    return {
      ok: false,
      status: 409,
      code: 'NO_ELIGIBLE_UNIT',
      message: 'No eligible physical unit remains for this package stay'
    };
  }

  const authoritative = pricingService.calculateAuthoritativePriceBreakdown({
    entity,
    checkIn: checkInStr,
    checkOut: checkOutStr,
    adults: classified.counts.adults,
    children: classified.counts.children,
    infants: classified.counts.infants,
    resolvedRatePlan: resolved,
    price: input.price,
    totalPrice: input.totalPrice,
    clientPrice: input.clientPrice
  });

  const totalBeforePaymentCredits = roundMoney(authoritative.preDiscountTotal);

  const packageSnapshot = freezeDeep({
    ratePlanCode: resolved.code,
    ratePlanVersion: resolved.version,
    ratePlanType: resolved.type,
    currency: resolved.currency,
    arrivalDate: resolved.dates.checkIn,
    departureDate: resolved.dates.checkOut,
    accommodationKey: resolved.accommodation.accommodationKey,
    pricingMethod: resolved.pricing.pricingMethod,
    inventoryMode: resolved.inventoryMode,
    requiresFullPayment: resolved.payment.requiresFullPayment === true,
    cancellationPolicyCode: resolved.cancellationPolicy.code,
    cancellationPolicyVersion: resolved.cancellationPolicy.version,
    inclusions: [...(resolved.inclusions || [])],
    participants: classified.participants.map((p) => ({ ...p })),
    counts: { ...classified.counts },
    capacityUsed: classified.counts.total,
    capacityMaximum: Number(entity.capacity),
    availableUnitCount: inventory.availableUnitCount,
    pricingBreakdown: { ...authoritative },
    totalBeforePaymentCredits
  });

  return {
    ok: true,
    entity,
    checkInDate: normalizeDateToSofiaDayStart(checkInStr),
    checkOutDate: normalizeDateToSofiaDayStart(checkOutStr),
    baseLodgingPrice: totalBeforePaymentCredits,
    extraGuestLodgingPrice: roundMoney(Number(authoritative.additionalGuestAmount) || 0),
    extrasTotal: 0,
    discountAmount: 0,
    subtotalPrice: totalBeforePaymentCredits,
    totalPrice: totalBeforePaymentCredits,
    totalNights: authoritative.numberOfNights,
    experienceKeysUsed: [],
    appliedPromoCode: null,
    promoSnapshot: null,
    promoInvalidReason: null,
    promo: {
      applied: false,
      invalidReason: null,
      snapshot: null,
      label: null
    },
    ratePlan: {
      code: resolved.code,
      version: resolved.version,
      type: resolved.type,
      currency: resolved.currency
    },
    ratePlanPricingBreakdown: authoritative,
    packageSnapshot,
    availableUnitCount: inventory.availableUnitCount,
    assignedUnitId: null,
    holdCreated: false,
    fixedPackage: true
  };
}

module.exports = {
  computeQuoteFromEntity,
  buildPublicBookingQuote,
  buildQuoteForResolvedEntity,
  buildFixedPackageQuote,
  applyFacilitySelectionsToQuote,
  applyCancellationPolicyToQuote,
  resolveSeasonalRatePlanForQuote,
  toCanonicalLodgingBreakdown,
  isFixedPackagePublicRequest,
  verifyPaymentIntentPromoMetadata,
  paymentIntentMatchesVoucherCheckout
};
