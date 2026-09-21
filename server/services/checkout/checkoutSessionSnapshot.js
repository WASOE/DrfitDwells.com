const crypto = require('crypto');
const { toDateOnly } = require('./checkoutSessionFingerprints');

const SNAPSHOT_SCHEMA_VERSION = 1;

function eurosToCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 100));
}

function toIntegerCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

function stableSortKeys(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(stableSortKeys);
  }
  const sorted = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = stableSortKeys(value[key]);
  }
  return sorted;
}

function stableStringify(value) {
  return JSON.stringify(stableSortKeys(value));
}

/**
 * Sanitized RatePlan identity for durable checkout snapshots (B8A).
 * Returns null when absent — never write ratePlan: null onto normal snapshots.
 */
function sanitizeRatePlanForSnapshot(ratePlan) {
  if (!ratePlan || typeof ratePlan !== 'object') return null;
  const code = ratePlan.code != null ? String(ratePlan.code).trim() : '';
  const version = Number(ratePlan.version);
  const type = ratePlan.type != null ? String(ratePlan.type).trim() : '';
  const currency = ratePlan.currency != null ? String(ratePlan.currency).trim() : '';
  if (!code || !Number.isInteger(version) || version < 1 || !type || !currency) {
    return null;
  }
  return { code, version, type, currency };
}

/**
 * Sanitized RatePlan pricing breakdown (B2/B3 field names only).
 */
function sanitizeRatePlanPricingBreakdownForSnapshot(breakdown) {
  if (!breakdown || typeof breakdown !== 'object') return null;
  const g = breakdown.guests;
  if (!g || typeof g !== 'object') return null;
  return {
    accommodationKey: String(breakdown.accommodationKey || ''),
    pricingMethod: String(breakdown.pricingMethod || ''),
    numberOfNights: Number(breakdown.numberOfNights) || 0,
    guests: {
      adults: Number(g.adults) || 0,
      children: Number(g.children) || 0,
      infants: Number(g.infants) || 0,
      lodgingGuests: Number(g.lodgingGuests) || 0,
      totalParticipants: Number(g.totalParticipants) || 0
    },
    baseLodgingAmount: Number(breakdown.baseLodgingAmount) || 0,
    additionalGuestAmount: Number(breakdown.additionalGuestAmount) || 0,
    preDiscountTotal: Number(breakdown.preDiscountTotal) || 0,
    finalTotalBeforeExternalDiscounts: Number(breakdown.finalTotalBeforeExternalDiscounts) || 0,
    totalPrice: Number(breakdown.totalPrice) || 0
  };
}

/**
 * B8B: participants from package classifier only (ignore client category/price).
 */
function sanitizePackageParticipantsForSnapshot(participants) {
  if (!Array.isArray(participants)) return [];
  return participants.map((p) => ({
    fullName: p && p.fullName != null ? String(p.fullName) : '',
    dateOfBirth: p && p.dateOfBirth != null ? String(p.dateOfBirth) : '',
    ageOnArrival: p && p.ageOnArrival != null ? Number(p.ageOnArrival) : null,
    category: p && p.category != null ? String(p.category) : ''
  }));
}

/**
 * B8B: durable package snapshot from buildFixedPackageQuote.packageSnapshot.
 * Excludes transient availability / hold fields. Uses B4 field names (counts, not invented aliases).
 */
function sanitizePackageSnapshotForCheckout(packageSnapshot) {
  if (!packageSnapshot || typeof packageSnapshot !== 'object') return null;

  void packageSnapshot.availableUnitCount;
  void packageSnapshot.eligibleUnits;
  void packageSnapshot.assignedUnitId;
  void packageSnapshot.holdCreated;
  void packageSnapshot.candidateUnits;
  void packageSnapshot.unitIds;

  const counts =
    packageSnapshot.counts && typeof packageSnapshot.counts === 'object'
      ? {
          adults: Number(packageSnapshot.counts.adults) || 0,
          children: Number(packageSnapshot.counts.children) || 0,
          infants: Number(packageSnapshot.counts.infants) || 0,
          total: Number(packageSnapshot.counts.total) || 0
        }
      : null;
  if (!counts) return null;

  const pricingBreakdown = sanitizeRatePlanPricingBreakdownForSnapshot(
    packageSnapshot.pricingBreakdown
  );
  // Fixed-per-participant packages need adult/child/infant line amounts in the durable snapshot.
  let durablePricing = pricingBreakdown;
  if (pricingBreakdown && packageSnapshot.pricingBreakdown) {
    const src = packageSnapshot.pricingBreakdown;
    durablePricing = {
      ...pricingBreakdown,
      adultAmount: Number(src.adultAmount) || 0,
      childAmount: Number(src.childAmount) || 0,
      infantAmount: Number(src.infantAmount) || 0
    };
  }

  return {
    ratePlanCode: String(packageSnapshot.ratePlanCode || ''),
    ratePlanVersion: Number(packageSnapshot.ratePlanVersion) || 0,
    ratePlanType: String(packageSnapshot.ratePlanType || ''),
    currency: String(packageSnapshot.currency || 'EUR'),
    arrivalDate: String(packageSnapshot.arrivalDate || ''),
    departureDate: String(packageSnapshot.departureDate || ''),
    accommodationKey: String(packageSnapshot.accommodationKey || ''),
    pricingMethod: String(packageSnapshot.pricingMethod || ''),
    inventoryMode: String(packageSnapshot.inventoryMode || ''),
    requiresFullPayment: packageSnapshot.requiresFullPayment === true,
    cancellationPolicyCode: String(packageSnapshot.cancellationPolicyCode || ''),
    cancellationPolicyVersion: Number(packageSnapshot.cancellationPolicyVersion) || 0,
    inclusions: Array.isArray(packageSnapshot.inclusions)
      ? packageSnapshot.inclusions.map((s) => String(s))
      : [],
    participants: sanitizePackageParticipantsForSnapshot(packageSnapshot.participants),
    counts,
    capacityUsed: Number(packageSnapshot.capacityUsed) || 0,
    capacityMaximum: Number(packageSnapshot.capacityMaximum) || 0,
    pricingBreakdown: durablePricing,
    totalBeforePaymentCredits: Number(packageSnapshot.totalBeforePaymentCredits) || 0
  };
}

function isFixedPackageQuote(quote) {
  if (!quote || typeof quote !== 'object') return false;
  if (quote.fixedPackage === true) return true;
  if (quote.packageSnapshot && typeof quote.packageSnapshot === 'object') {
    if (quote.ratePlan && quote.ratePlan.type === 'fixed_package') return true;
    if (quote.packageSnapshot.ratePlanType === 'fixed_package') return true;
  }
  return false;
}

/**
 * B8C: sanitized B7 cancellationPolicySnapshot for durable checkout (no Mongoose / fns).
 * Uses exact B7 field names from validateAndNormalizeCancellationPolicy / buildCancellationPolicySnapshot.
 */
function sanitizeCancellationPolicySnapshotForCheckout(policySnapshot) {
  if (!policySnapshot || typeof policySnapshot !== 'object') return null;
  const code = policySnapshot.code != null ? String(policySnapshot.code).trim() : '';
  const version = Number(policySnapshot.version);
  const policyType =
    policySnapshot.policyType != null ? String(policySnapshot.policyType).trim() : '';
  if (!code || !Number.isInteger(version) || version < 1 || !policyType) {
    return null;
  }

  const refundTiers = Array.isArray(policySnapshot.refundTiers)
    ? policySnapshot.refundTiers.map((t) => ({
        minDaysBeforeArrival: Number(t.minDaysBeforeArrival),
        maxDaysBeforeArrival:
          t.maxDaysBeforeArrival == null || t.maxDaysBeforeArrival === ''
            ? null
            : Number(t.maxDaysBeforeArrival),
        refundPercent: Number(t.refundPercent)
      }))
    : [];

  const dateTransferRules = policySnapshot.dateTransferRules || {};
  const nameTransferRules = policySnapshot.nameTransferRules || {};
  const organizerCancellationRule = policySnapshot.organizerCancellationRule || {};
  const legalApprovalMetadata = policySnapshot.legalApprovalMetadata || {};

  return {
    code,
    version,
    policyType,
    correctionWindowHours: Number(policySnapshot.correctionWindowHours),
    correctionWindowMinDaysBeforeArrival: Number(
      policySnapshot.correctionWindowMinDaysBeforeArrival
    ),
    refundTiers,
    noShowRefundPercent: Number(policySnapshot.noShowRefundPercent),
    earlyDepartureRefundPercent: Number(policySnapshot.earlyDepartureRefundPercent),
    dateTransferRules: {
      enabled: dateTransferRules.enabled === true,
      maxTransfers: Number(dateTransferRules.maxTransfers || 0),
      minDaysBeforeArrival:
        dateTransferRules.minDaysBeforeArrival == null
          ? null
          : Number(dateTransferRules.minDaysBeforeArrival),
      compatibleRatePlanCodes: Array.isArray(dateTransferRules.compatibleRatePlanCodes)
        ? dateTransferRules.compatibleRatePlanCodes.map((c) => String(c))
        : [],
      subjectToAvailability: dateTransferRules.subjectToAvailability !== false,
      higherPriceDifferencePayable: dateTransferRules.higherPriceDifferencePayable !== false,
      replacementBecomesNonRefundable:
        dateTransferRules.replacementBecomesNonRefundable !== false
    },
    nameTransferRules: {
      enabled: nameTransferRules.enabled === true,
      maxTransfers: Number(nameTransferRules.maxTransfers || 0),
      minDaysBeforeArrival:
        nameTransferRules.minDaysBeforeArrival == null
          ? null
          : Number(nameTransferRules.minDaysBeforeArrival),
      free: nameTransferRules.free !== false,
      identityOnly: nameTransferRules.identityOnly !== false
    },
    organizerCancellationRule: {
      allowFullRefundOrReplacement:
        organizerCancellationRule.allowFullRefundOrReplacement !== false,
      requiresManualExecution: organizerCancellationRule.requiresManualExecution !== false,
      ordinaryWeatherNotAutomatic:
        organizerCancellationRule.ordinaryWeatherNotAutomatic !== false,
      statutoryExceptionManualReview:
        organizerCancellationRule.statutoryExceptionManualReview !== false
    },
    nonQualifyingCancellationReasons: Array.isArray(
      policySnapshot.nonQualifyingCancellationReasons
    )
      ? policySnapshot.nonQualifyingCancellationReasons.map((s) => String(s))
      : [],
    travelInsuranceRecommendation:
      policySnapshot.travelInsuranceRecommendation != null
        ? String(policySnapshot.travelInsuranceRecommendation)
        : '',
    legalReviewStatus:
      policySnapshot.legalReviewStatus != null
        ? String(policySnapshot.legalReviewStatus)
        : '',
    legalApprovalMetadata: {
      reviewedAt: legalApprovalMetadata.reviewedAt || null,
      reviewedBy: legalApprovalMetadata.reviewedBy || null,
      notes: legalApprovalMetadata.notes || null
    }
  };
}

/**
 * B8E: sanitized facility selections for durable checkout (no holds/lanes/IDs).
 */
function sanitizeFacilitySelectionsForCheckout(facilitySelections) {
  if (!Array.isArray(facilitySelections) || facilitySelections.length === 0) {
    return null;
  }
  const out = [];
  for (const sel of facilitySelections) {
    if (!sel || typeof sel !== 'object') continue;
    const facilityCode = sel.facilityCode != null ? String(sel.facilityCode).trim() : '';
    if (!facilityCode) continue;

    const addOnSrc = sel.addOn && typeof sel.addOn === 'object' ? sel.addOn : {};
    const code =
      addOnSrc.code != null
        ? String(addOnSrc.code).trim()
        : sel.addOnCode != null
          ? String(sel.addOnCode).trim()
          : '';
    const version = Number(
      addOnSrc.version != null ? addOnSrc.version : sel.addOnVersion
    );
    const amount = Number(
      addOnSrc.amount != null
        ? addOnSrc.amount
        : sel.amount != null
          ? sel.amount
          : sel.priceSnapshot && sel.priceSnapshot.amount
    );
    const currency =
      addOnSrc.currency != null
        ? String(addOnSrc.currency)
        : sel.currency != null
          ? String(sel.currency)
          : 'EUR';
    const chargeUnit =
      addOnSrc.chargeUnit != null
        ? String(addOnSrc.chargeUnit)
        : sel.chargeUnit != null
          ? String(sel.chargeUnit)
          : '';
    const publicName =
      addOnSrc.publicName != null
        ? String(addOnSrc.publicName)
        : sel.addOnPublicName != null
          ? String(sel.addOnPublicName)
          : '';
    const includedItems = Array.isArray(addOnSrc.includedItems)
      ? addOnSrc.includedItems.map((s) => String(s))
      : Array.isArray(sel.includedItems)
        ? sel.includedItems.map((s) => String(s))
        : [];

    const startTime =
      sel.startTime != null
        ? String(sel.startTime)
        : sel.slotStart != null
          ? String(sel.slotStart)
          : '';
    const endTime = sel.endTime != null ? String(sel.endTime) : '';
    const slotStart = sel.slotStart != null ? String(sel.slotStart) : startTime;

    // Ignore client/hold authority bags if present on the same object.
    void sel.reservationId;
    void sel.holdId;
    void sel.capacityLane;
    void sel.checkoutSessionId;
    void sel.availableCapacity;
    void sel.price;
    void sel.clientPrice;
    void sel.staffPrepared;
    void sel.preparedSession;

    out.push({
      facilityCode,
      facilityName: sel.facilityName != null ? String(sel.facilityName) : '',
      selfLed: sel.selfLed === true,
      startTime,
      endTime,
      slotStart,
      addOn: {
        code,
        version: Number.isInteger(version) ? version : 0,
        publicName,
        currency,
        amount: Number.isFinite(amount) ? amount : 0,
        chargeUnit,
        includedItems
      }
    });
  }
  return out.length ? out : null;
}

/**
 * Pricing-relevant subset for hash (order-independent via stable stringify).
 */
function buildQuoteSnapshotHashPayload(snapshot) {
  return {
    schemaVersion: snapshot.schemaVersion,
    entityType: snapshot.entityType,
    cabinId: snapshot.cabinId || null,
    cabinTypeId: snapshot.cabinTypeId || null,
    checkInDateOnly: snapshot.checkInDateOnly,
    checkOutDateOnly: snapshot.checkOutDateOnly,
    adults: snapshot.adults,
    children: snapshot.children,
    experienceKeys: snapshot.experienceKeys,
    transportMethod: snapshot.transportMethod || '',
    romanticSetup: Boolean(snapshot.romanticSetup),
    promoCode: snapshot.promoCode || '',
    voucherCode: snapshot.voucherCode || '',
    subtotalCents: snapshot.subtotalCents,
    discountAmountCents: snapshot.discountAmountCents,
    totalValueCents: snapshot.totalValueCents,
    voucherAppliedCents: snapshot.voucherAppliedCents,
    stripeAmountCents: snapshot.stripeAmountCents,
    fullVoucherCoverage: Boolean(snapshot.fullVoucherCoverage),
    ...(snapshot.ratePlan
      ? {
          ratePlanCode: snapshot.ratePlan.code || null,
          ratePlanVersion:
            snapshot.ratePlan.version != null ? Number(snapshot.ratePlan.version) : null,
          ratePlanType: snapshot.ratePlan.type || null,
          ratePlanCurrency: snapshot.ratePlan.currency || null,
          ratePlanPricingBreakdown: snapshot.ratePlanPricingBreakdown
            ? stableSortKeys(snapshot.ratePlanPricingBreakdown)
            : null
        }
      : {}),
    ...(snapshot.bookingType === 'fixed_package' || snapshot.packageSnapshot
      ? {
          bookingType: snapshot.bookingType || null,
          packageSnapshot: snapshot.packageSnapshot
            ? stableSortKeys(snapshot.packageSnapshot)
            : null
        }
      : {}),
    ...(snapshot.cancellationPolicySnapshot
      ? {
          cancellationPolicySnapshot: stableSortKeys(snapshot.cancellationPolicySnapshot)
        }
      : {}),
    ...(snapshot.facilitySelections
      ? {
          facilitySelections: stableSortKeys(snapshot.facilitySelections),
          facilityTotalCents:
            snapshot.facilityTotalCents != null
              ? Number(snapshot.facilityTotalCents)
              : eurosToCents(snapshot.facilityTotal)
        }
      : {})
  };
}

function hashQuoteSnapshot(snapshot) {
  const payload = buildQuoteSnapshotHashPayload(snapshot);
  return crypto.createHash('sha256').update(stableStringify(payload), 'utf8').digest('hex');
}

/**
 * @param {{ normalizedInput: object, quote: object }} params
 * quote shape: buildPublicBookingQuote ok result (entity, dates, prices, voucher fields).
 */
function buildQuoteSnapshot({ normalizedInput, quote }) {
  const entity = quote.entity || {};
  const entityType = quote.entityType === 'cabinType' ? 'cabinType' : 'cabin';
  const checkInDateOnly =
    normalizedInput.checkInDateOnly || toDateOnly(quote.checkInDate || normalizedInput.checkIn);
  const checkOutDateOnly =
    normalizedInput.checkOutDateOnly || toDateOnly(quote.checkOutDate || normalizedInput.checkOut);

  const totalValueCents = eurosToCents(quote.totalPrice);
  const voucherAppliedCents = toIntegerCents(
    quote.voucherAppliedCents != null ? quote.voucherAppliedCents : 0
  );
  const remainingDueCents =
    quote.remainingDueCents != null
      ? toIntegerCents(quote.remainingDueCents)
      : Math.max(0, totalValueCents - voucherAppliedCents);
  const stripeAmountCents = Math.max(0, remainingDueCents);
  const fullVoucherCoverage = Boolean(quote.fullVoucherCoverage);

  const promoSnapshot = quote.promo?.snapshot ?? quote.promoSnapshot ?? null;
  const appliedPromoCode = quote.appliedPromoCode || normalizedInput.promoCode || '';

  const fixedPackage = isFixedPackageQuote(quote);
  const packageSnapshotRaw = fixedPackage
    ? sanitizePackageSnapshotForCheckout(quote.packageSnapshot)
    : null;

  // B8A: only attach when the server quote already carries a RatePlan (e.g. seasonal / package).
  const ratePlan = sanitizeRatePlanForSnapshot(quote.ratePlan);
  const ratePlanPricingBreakdown = ratePlan
    ? sanitizeRatePlanPricingBreakdownForSnapshot(quote.ratePlanPricingBreakdown)
    : null;

  let resolvedEntityType = entityType;
  if (fixedPackage && quote.entityType == null) {
    const slug = String(entity.slug || '')
      .trim()
      .toLowerCase();
    if (slug === 'a-frame' || entity.inventoryType === 'multi') {
      resolvedEntityType = 'cabinType';
    }
  }

  const packageAdults =
    packageSnapshotRaw && packageSnapshotRaw.counts
      ? Number(packageSnapshotRaw.counts.adults) || 0
      : null;
  const packageChildren =
    packageSnapshotRaw && packageSnapshotRaw.counts
      ? Number(packageSnapshotRaw.counts.children) || 0
      : null;

  const snapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    entityType: resolvedEntityType,
    cabinId:
      resolvedEntityType === 'cabin' ? String(entity._id || normalizedInput.cabinId || '') : null,
    cabinTypeId:
      resolvedEntityType === 'cabinType'
        ? String(entity._id || normalizedInput.cabinTypeId || '')
        : null,
    checkInDateOnly,
    checkOutDateOnly,
    checkInISO: quote.checkInDate ? new Date(quote.checkInDate).toISOString() : null,
    checkOutISO: quote.checkOutDate ? new Date(quote.checkOutDate).toISOString() : null,
    adults: packageAdults != null ? packageAdults : normalizedInput.adults,
    children: packageChildren != null ? packageChildren : normalizedInput.children,
    experienceKeys: [...(normalizedInput.experienceKeys || [])],
    transportMethod: normalizedInput.transportMethod || '',
    romanticSetup: Boolean(normalizedInput.romanticSetup),
    promoCode: normalizedInput.promoCode || '',
    voucherCode: normalizedInput.voucherCode || '',
    promoSnapshot: promoSnapshot ? stableSortKeys(promoSnapshot) : null,
    appliedPromoCode,
    subtotalCents: eurosToCents(quote.subtotalPrice),
    discountAmountCents: eurosToCents(quote.discountAmount),
    totalValueCents,
    voucherAppliedCents,
    stripeAmountCents,
    fullVoucherCoverage,
    currency: 'EUR',
    minNights: entity.minNights != null ? Number(entity.minNights) : null,
    capacity: entity.capacity != null ? Number(entity.capacity) : null,
    pricingModel: entity.pricingModel || null
  };

  if (ratePlan) {
    // Deep-clone via stableSortKeys so later quote mutation cannot alter the snapshot.
    snapshot.ratePlan = stableSortKeys(ratePlan);
    if (ratePlanPricingBreakdown) {
      snapshot.ratePlanPricingBreakdown = stableSortKeys(ratePlanPricingBreakdown);
    }
  }

  if (fixedPackage && packageSnapshotRaw) {
    snapshot.bookingType = 'fixed_package';
    snapshot.packageSnapshot = stableSortKeys(packageSnapshotRaw);
  }

  // B8C: only when the prepared quote already carries a server policy snapshot.
  const cancellationPolicySnapshot = sanitizeCancellationPolicySnapshotForCheckout(
    quote.cancellationPolicySnapshot
  );
  if (cancellationPolicySnapshot) {
    // Deep-freeze so later mutation of prepared quote / policy cannot alter checkout.
    const cloned = stableSortKeys(cancellationPolicySnapshot);
    const freezeDeep = (value) => {
      if (value == null || typeof value !== 'object') return value;
      if (Object.isFrozen(value)) return value;
      if (Array.isArray(value)) {
        value.forEach(freezeDeep);
        return Object.freeze(value);
      }
      Object.keys(value).forEach((k) => freezeDeep(value[k]));
      return Object.freeze(value);
    };
    snapshot.cancellationPolicySnapshot = freezeDeep(cloned);
  }

  // B8E: sanitized facility selections (no hold/reservation implication).
  const facilitySelections = sanitizeFacilitySelectionsForCheckout(
    quote.facilitySelections
  );
  if (facilitySelections) {
    const freezeDeep = (value) => {
      if (value == null || typeof value !== 'object') return value;
      if (Object.isFrozen(value)) return value;
      if (Array.isArray(value)) {
        value.forEach(freezeDeep);
        return Object.freeze(value);
      }
      Object.keys(value).forEach((k) => freezeDeep(value[k]));
      return Object.freeze(value);
    };
    snapshot.facilitySelections = freezeDeep(stableSortKeys(facilitySelections));
    const facilityTotal = Number(quote.facilityTotal) || 0;
    snapshot.facilityTotal = facilityTotal;
    snapshot.facilityTotalCents = eurosToCents(facilityTotal);
    snapshot.facilityHoldCreated = false;
  }

  return snapshot;
}

module.exports = {
  SNAPSHOT_SCHEMA_VERSION,
  buildQuoteSnapshot,
  hashQuoteSnapshot,
  buildQuoteSnapshotHashPayload,
  sanitizeRatePlanForSnapshot,
  sanitizeRatePlanPricingBreakdownForSnapshot,
  sanitizePackageSnapshotForCheckout,
  sanitizePackageParticipantsForSnapshot,
  sanitizeCancellationPolicySnapshotForCheckout,
  sanitizeFacilitySelectionsForCheckout,
  isFixedPackageQuote,
  stableStringify,
  eurosToCents,
  toIntegerCents
};
