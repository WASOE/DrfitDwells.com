/**
 * Cancellation policy evaluation (B7).
 *
 * Pure helpers with injectable loaders. No Stripe, booking mutations, or
 * inventory moves. Correction window uses exact timestamps; refund tiers use
 * Sofia calendar days before arrival.
 */
'use strict';

const moment = require('moment-timezone');
const {
  POLICY_STATUSES,
  POLICY_TYPES,
  LEGAL_REVIEW_STATUSES
} = require('../models/CancellationPolicy');
const { PROPERTY_TIMEZONE, formatSofiaDateOnly } = require('../utils/dateTime');

const EVENT_TYPES = [
  'customer_cancellation',
  'no_show',
  'early_departure',
  'organizer_cancellation'
];

class CancellationPolicyError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'CancellationPolicyError';
    this.code = code;
    this.details = details;
  }
}

function roundEuro(value) {
  return Math.round(Number(value) * 100) / 100;
}

function freezeDeep(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    value.forEach(freezeDeep);
    return Object.freeze(value);
  }
  Object.keys(value).forEach((k) => freezeDeep(value[k]));
  return Object.freeze(value);
}

function toInstant(input) {
  if (input == null) return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Sofia calendar days from cancellation (or as-of) civil day to arrival civil day.
 */
function sofiaDaysBeforeArrival(asOfInput, arrivalInput) {
  const asOf = formatSofiaDateOnly(asOfInput);
  const arrival = formatSofiaDateOnly(arrivalInput);
  if (!asOf || !arrival) {
    throw new CancellationPolicyError(
      'INVALID_DATES',
      'Cancellation and arrival dates must be valid Sofia calendar dates'
    );
  }
  const a = moment.tz(asOf, 'YYYY-MM-DD', PROPERTY_TIMEZONE).startOf('day');
  const b = moment.tz(arrival, 'YYYY-MM-DD', PROPERTY_TIMEZONE).startOf('day');
  return b.diff(a, 'days');
}

function assertRefundPercent(value, label, errors) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    errors.push(`${label} must be a number`);
    return;
  }
  if (n < 0) errors.push(`${label} cannot be below 0`);
  if (n > 100) errors.push(`${label} cannot exceed 100`);
}

/**
 * Validate ordered refund tiers: no overlaps, no ambiguous/gapped boundaries from 0 up.
 */
function validateRefundTiers(tiers, errors) {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    errors.push('At least one refund tier is required');
    return;
  }

  const normalized = [];
  for (let i = 0; i < tiers.length; i += 1) {
    const t = tiers[i];
    if (!t || typeof t !== 'object') {
      errors.push(`refundTiers[${i}] is invalid`);
      continue;
    }
    const min = Number(t.minDaysBeforeArrival);
    const max =
      t.maxDaysBeforeArrival == null || t.maxDaysBeforeArrival === ''
        ? null
        : Number(t.maxDaysBeforeArrival);
    assertRefundPercent(t.refundPercent, `refundTiers[${i}].refundPercent`, errors);
    if (!Number.isInteger(min) || min < 0) {
      errors.push(`refundTiers[${i}].minDaysBeforeArrival must be a non-negative integer`);
      continue;
    }
    if (max != null && (!Number.isInteger(max) || max < 0)) {
      errors.push(`refundTiers[${i}].maxDaysBeforeArrival must be a non-negative integer or null`);
      continue;
    }
    if (max != null && max < min) {
      errors.push(`refundTiers[${i}] maxDaysBeforeArrival cannot be less than min`);
      continue;
    }
    normalized.push({
      minDaysBeforeArrival: min,
      maxDaysBeforeArrival: max,
      refundPercent: Number(t.refundPercent)
    });
  }

  if (errors.length) return;

  normalized.sort((a, b) => a.minDaysBeforeArrival - b.minDaysBeforeArrival);

  // Must start at 0.
  if (normalized[0].minDaysBeforeArrival !== 0) {
    errors.push('Refund tiers must cover day 0 without gaps');
  }

  for (let i = 0; i < normalized.length; i += 1) {
    const cur = normalized[i];
    const isLast = i === normalized.length - 1;
    if (isLast) {
      if (cur.maxDaysBeforeArrival != null) {
        errors.push('Top refund tier must have an open upper bound (maxDaysBeforeArrival null)');
      }
    } else {
      if (cur.maxDaysBeforeArrival == null) {
        errors.push('Only the top refund tier may have an open upper bound');
        continue;
      }
      const next = normalized[i + 1];
      // Adjacent: next.min === cur.max + 1 (no gap, no overlap).
      if (next.minDaysBeforeArrival === cur.maxDaysBeforeArrival) {
        errors.push('Ambiguous tier boundaries: adjacent tiers share the same day');
      } else if (next.minDaysBeforeArrival < cur.maxDaysBeforeArrival) {
        errors.push('Overlapping refund tiers are not allowed');
      } else if (next.minDaysBeforeArrival > cur.maxDaysBeforeArrival + 1) {
        errors.push('Refund tiers leave uncovered days before arrival');
      }
    }
  }
}

function validateAndNormalizeCancellationPolicy(input) {
  const errors = [];
  if (!input || typeof input !== 'object') {
    return { ok: false, errors: ['Cancellation policy input is required'] };
  }

  // Ignore client-supplied override bags if present on the same object.
  void input.clientRefundPercent;
  void input.clientRefundTiers;
  void input.refundPercentOverride;

  const code =
    typeof input.code === 'string' ? input.code.trim().toLowerCase() : '';
  if (!code || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code)) {
    errors.push('code must be lowercase kebab-case');
  }

  const internalName =
    typeof input.internalName === 'string' ? input.internalName.trim() : '';
  if (!internalName) errors.push('internalName is required');

  const version = Number(input.version);
  if (!Number.isInteger(version) || version < 1) {
    errors.push('version must be a positive integer');
  }

  const status = input.status != null ? String(input.status) : 'draft';
  if (!POLICY_STATUSES.includes(status)) {
    errors.push('status must be draft, active, or retired');
  }

  const policyType = input.policyType != null ? String(input.policyType) : '';
  if (!POLICY_TYPES.includes(policyType)) {
    errors.push('policyType must be normal_stay or hosted_package');
  }

  const correctionWindowHours = Number(
    input.correctionWindowHours == null ? 48 : input.correctionWindowHours
  );
  if (!Number.isFinite(correctionWindowHours) || correctionWindowHours < 0) {
    errors.push('correctionWindowHours must be a non-negative number');
  }

  const correctionWindowMinDaysBeforeArrival = Number(
    input.correctionWindowMinDaysBeforeArrival
  );
  if (
    !Number.isInteger(correctionWindowMinDaysBeforeArrival) ||
    correctionWindowMinDaysBeforeArrival < 0
  ) {
    errors.push('correctionWindowMinDaysBeforeArrival must be a non-negative integer');
  }

  validateRefundTiers(input.refundTiers, errors);
  assertRefundPercent(input.noShowRefundPercent, 'noShowRefundPercent', errors);
  assertRefundPercent(
    input.earlyDepartureRefundPercent,
    'earlyDepartureRefundPercent',
    errors
  );

  const legalReviewStatus =
    input.legalReviewStatus != null ? String(input.legalReviewStatus) : 'pending';
  if (!LEGAL_REVIEW_STATUSES.includes(legalReviewStatus)) {
    errors.push('legalReviewStatus must be pending, approved, or rejected');
  }

  if (errors.length) return { ok: false, errors };

  const tiers = [...input.refundTiers]
    .map((t) => ({
      minDaysBeforeArrival: Number(t.minDaysBeforeArrival),
      maxDaysBeforeArrival:
        t.maxDaysBeforeArrival == null || t.maxDaysBeforeArrival === ''
          ? null
          : Number(t.maxDaysBeforeArrival),
      refundPercent: Number(t.refundPercent)
    }))
    .sort((a, b) => a.minDaysBeforeArrival - b.minDaysBeforeArrival);

  return {
    ok: true,
    value: {
      code,
      internalName,
      version,
      status,
      policyType,
      correctionWindowHours,
      correctionWindowMinDaysBeforeArrival,
      refundTiers: tiers,
      noShowRefundPercent: Number(input.noShowRefundPercent),
      earlyDepartureRefundPercent: Number(input.earlyDepartureRefundPercent),
      dateTransferRules: {
        enabled: input.dateTransferRules?.enabled === true,
        maxTransfers: Number(input.dateTransferRules?.maxTransfers || 0),
        minDaysBeforeArrival:
          input.dateTransferRules?.minDaysBeforeArrival == null
            ? null
            : Number(input.dateTransferRules.minDaysBeforeArrival),
        compatibleRatePlanCodes: Array.isArray(
          input.dateTransferRules?.compatibleRatePlanCodes
        )
          ? input.dateTransferRules.compatibleRatePlanCodes.map((c) =>
              String(c).trim().toLowerCase()
            )
          : [],
        subjectToAvailability: input.dateTransferRules?.subjectToAvailability !== false,
        higherPriceDifferencePayable:
          input.dateTransferRules?.higherPriceDifferencePayable !== false,
        replacementBecomesNonRefundable:
          input.dateTransferRules?.replacementBecomesNonRefundable !== false
      },
      nameTransferRules: {
        enabled: input.nameTransferRules?.enabled === true,
        maxTransfers: Number(input.nameTransferRules?.maxTransfers || 0),
        minDaysBeforeArrival:
          input.nameTransferRules?.minDaysBeforeArrival == null
            ? null
            : Number(input.nameTransferRules.minDaysBeforeArrival),
        free: input.nameTransferRules?.free !== false,
        identityOnly: input.nameTransferRules?.identityOnly !== false
      },
      organizerCancellationRule: {
        allowFullRefundOrReplacement:
          input.organizerCancellationRule?.allowFullRefundOrReplacement !== false,
        requiresManualExecution:
          input.organizerCancellationRule?.requiresManualExecution !== false,
        ordinaryWeatherNotAutomatic:
          input.organizerCancellationRule?.ordinaryWeatherNotAutomatic !== false,
        statutoryExceptionManualReview:
          input.organizerCancellationRule?.statutoryExceptionManualReview !== false
      },
      nonQualifyingCancellationReasons: Array.isArray(
        input.nonQualifyingCancellationReasons
      )
        ? input.nonQualifyingCancellationReasons.map((s) => String(s))
        : [],
      travelInsuranceRecommendation:
        input.travelInsuranceRecommendation != null
          ? String(input.travelInsuranceRecommendation)
          : '',
      legalReviewStatus,
      legalApprovalMetadata: {
        reviewedAt: input.legalApprovalMetadata?.reviewedAt || null,
        reviewedBy: input.legalApprovalMetadata?.reviewedBy || null,
        notes: input.legalApprovalMetadata?.notes || null
      }
    }
  };
}

function buildCancellationPolicySnapshot(policy) {
  const normalized = validateAndNormalizeCancellationPolicy(policy);
  if (!normalized.ok) {
    throw new CancellationPolicyError(
      'MALFORMED_CANCELLATION_POLICY',
      'Cancellation policy data is invalid',
      normalized.errors
    );
  }
  return freezeDeep({ ...normalized.value });
}

function isWithinCorrectionWindow(policy, bookingTimestamp, cancellationTimestamp) {
  const booked = toInstant(bookingTimestamp);
  const cancelled = toInstant(cancellationTimestamp);
  if (!booked || !cancelled) return false;
  const windowMs = Number(policy.correctionWindowHours) * 60 * 60 * 1000;
  const elapsed = cancelled.getTime() - booked.getTime();
  // At exactly window hours, still valid.
  return elapsed >= 0 && elapsed <= windowMs;
}

function findTierRefundPercent(policy, daysBeforeArrival) {
  for (const tier of policy.refundTiers) {
    const min = tier.minDaysBeforeArrival;
    const max = tier.maxDaysBeforeArrival;
    if (daysBeforeArrival < min) continue;
    if (max == null || daysBeforeArrival <= max) {
      return tier.refundPercent;
    }
  }
  throw new CancellationPolicyError(
    'TIER_UNRESOLVED',
    'No refund tier covers the calculated days before arrival',
    { daysBeforeArrival }
  );
}

/**
 * Pure cancellation outcome. Does not call Stripe or mutate bookings.
 */
function calculateCancellationOutcome({
  policySnapshot,
  bookingTimestamp,
  arrivalDate,
  cancellationTimestamp,
  cancellableAmount,
  eventType,
  // Non-authoritative client fields — ignored.
  clientRefundPercent,
  clientRefundTiers,
  refundPercentOverride
} = {}) {
  void clientRefundPercent;
  void clientRefundTiers;
  void refundPercentOverride;

  if (!policySnapshot || typeof policySnapshot !== 'object') {
    throw new CancellationPolicyError(
      'POLICY_SNAPSHOT_REQUIRED',
      'An immutable policy snapshot is required'
    );
  }
  if (!EVENT_TYPES.includes(eventType)) {
    throw new CancellationPolicyError(
      'UNSUPPORTED_EVENT_TYPE',
      `Unsupported cancellation event type: ${eventType}`
    );
  }

  const amount = roundEuro(Number(cancellableAmount));
  if (!Number.isFinite(amount) || amount < 0) {
    throw new CancellationPolicyError(
      'INVALID_CANCELLABLE_AMOUNT',
      'cancellableAmount must be a non-negative euro amount'
    );
  }

  const daysBeforeArrival = sofiaDaysBeforeArrival(
    cancellationTimestamp,
    arrivalDate
  );

  let refundPercent = 0;
  let correctionWindowEligible = false;
  let decisionReasonCode = 'TIER_REFUND';
  let requiresManualReview = false;
  let organizerOptions = null;

  if (eventType === 'no_show') {
    refundPercent = Number(policySnapshot.noShowRefundPercent);
    decisionReasonCode = 'NO_SHOW';
  } else if (eventType === 'early_departure') {
    refundPercent = Number(policySnapshot.earlyDepartureRefundPercent);
    decisionReasonCode = 'EARLY_DEPARTURE';
  } else if (eventType === 'organizer_cancellation') {
    refundPercent = 100;
    decisionReasonCode = 'ORGANIZER_FULL_REFUND_OR_REPLACEMENT';
    requiresManualReview = true;
    organizerOptions = {
      fullRefundAllowed:
        policySnapshot.organizerCancellationRule?.allowFullRefundOrReplacement ===
        true,
      replacementDatesAllowed:
        policySnapshot.organizerCancellationRule?.allowFullRefundOrReplacement ===
        true,
      requiresManualExecution:
        policySnapshot.organizerCancellationRule?.requiresManualExecution === true
    };
  } else {
    // customer_cancellation
    correctionWindowEligible =
      isWithinCorrectionWindow(
        policySnapshot,
        bookingTimestamp,
        cancellationTimestamp
      ) &&
      daysBeforeArrival > Number(policySnapshot.correctionWindowMinDaysBeforeArrival);

    if (correctionWindowEligible) {
      refundPercent = 100;
      decisionReasonCode = 'CORRECTION_WINDOW';
    } else {
      refundPercent = findTierRefundPercent(policySnapshot, daysBeforeArrival);
      decisionReasonCode = 'TIER_REFUND';
    }
  }

  const refundAmount = roundEuro((amount * refundPercent) / 100);
  const retainedAmount = roundEuro(amount - refundAmount);

  return {
    policyCode: policySnapshot.code,
    policyVersion: policySnapshot.version,
    eventType,
    daysBeforeArrival,
    correctionWindowEligible,
    refundPercent,
    refundAmount,
    retainedAmount,
    decisionReasonCode,
    requiresManualReview,
    organizerOptions,
    stripeRefundCreated: false,
    bookingMutated: false,
    inventoryChanged: false
  };
}

/**
 * Ordinary winter weather / non-essential programme tweaks are not automatic
 * organizer cancellations when the core stay can still be delivered.
 */
function evaluateOrganizerCancellationClaim({
  policySnapshot,
  reasonCode,
  coreStayDeliverable = true
} = {}) {
  const ordinary = new Set([
    'ordinary_winter_weather',
    'limited_snow',
    'non_essential_programme_adjustment'
  ]);

  if (ordinary.has(reasonCode) && coreStayDeliverable) {
    return {
      automaticOrganizerCancellation: false,
      reasonCode: 'CORE_STAY_DELIVERABLE',
      requiresManualReview: false
    };
  }

  if (reasonCode === 'statutory_exception' || reasonCode === 'eu_consumer_right') {
    return {
      automaticOrganizerCancellation: false,
      reasonCode: 'STATUTORY_EXCEPTION_MANUAL_REVIEW',
      requiresManualReview:
        policySnapshot?.organizerCancellationRule?.statutoryExceptionManualReview !==
        false
    };
  }

  if (
    reasonCode === 'cannot_provide_accommodation' ||
    reasonCode === 'cannot_provide_core_programme'
  ) {
    return {
      automaticOrganizerCancellation: true,
      reasonCode: 'ORGANIZER_SERVICE_FAILURE',
      requiresManualReview: true,
      allowFullRefundOrReplacement:
        policySnapshot?.organizerCancellationRule?.allowFullRefundOrReplacement !==
        false
    };
  }

  return {
    automaticOrganizerCancellation: false,
    reasonCode: 'MANUAL_REVIEW_REQUIRED',
    requiresManualReview: true
  };
}

function evaluateDateTransferEligibility({
  policySnapshot,
  arrivalDate,
  requestTimestamp,
  priorDateTransferCount = 0,
  replacementRatePlanCode = null,
  availabilityConfirmed = false
} = {}) {
  const rules = policySnapshot?.dateTransferRules;
  if (!rules || rules.enabled !== true) {
    return {
      eligible: false,
      reasonCode: 'DATE_TRANSFER_UNAVAILABLE',
      followUpActions: []
    };
  }

  const daysBefore = sofiaDaysBeforeArrival(requestTimestamp, arrivalDate);
  if (
    rules.minDaysBeforeArrival != null &&
    daysBefore < Number(rules.minDaysBeforeArrival)
  ) {
    return {
      eligible: false,
      reasonCode: 'DATE_TRANSFER_TOO_CLOSE_TO_ARRIVAL',
      daysBeforeArrival: daysBefore,
      followUpActions: []
    };
  }

  if (priorDateTransferCount >= Number(rules.maxTransfers || 0)) {
    return {
      eligible: false,
      reasonCode: 'DATE_TRANSFER_LIMIT_REACHED',
      followUpActions: []
    };
  }

  const wanted = String(replacementRatePlanCode || '')
    .trim()
    .toLowerCase();
  const compatible = (rules.compatibleRatePlanCodes || []).map((c) =>
    String(c).trim().toLowerCase()
  );
  if (!wanted || !compatible.includes(wanted)) {
    return {
      eligible: false,
      reasonCode: 'INCOMPATIBLE_REPLACEMENT_RATE_PLAN',
      followUpActions: []
    };
  }

  const followUpActions = [];
  if (rules.subjectToAvailability) {
    followUpActions.push('CONFIRM_AVAILABILITY');
  }
  if (rules.higherPriceDifferencePayable) {
    followUpActions.push('COLLECT_PRICE_DIFFERENCE_IF_HIGHER');
  }
  if (rules.replacementBecomesNonRefundable) {
    followUpActions.push('MARK_REPLACEMENT_NON_REFUNDABLE');
  }
  if (!availabilityConfirmed && rules.subjectToAvailability) {
    // Still eligible pending separate availability confirmation.
    followUpActions.push('AVAILABILITY_PENDING');
  }

  return {
    eligible: true,
    reasonCode: 'DATE_TRANSFER_ELIGIBLE',
    daysBeforeArrival: daysBefore,
    replacementBecomesNonRefundable: rules.replacementBecomesNonRefundable === true,
    higherPriceDifferencePayable: rules.higherPriceDifferencePayable === true,
    subjectToAvailability: rules.subjectToAvailability === true,
    followUpActions,
    bookingDatesChanged: false,
    inventoryMoved: false
  };
}

function evaluateNameTransferEligibility({
  policySnapshot,
  arrivalDate,
  requestTimestamp,
  priorNameTransferCount = 0
} = {}) {
  const rules = policySnapshot?.nameTransferRules;
  if (!rules || rules.enabled !== true) {
    return {
      eligible: false,
      reasonCode: 'NAME_TRANSFER_UNAVAILABLE',
      followUpActions: []
    };
  }

  const daysBefore = sofiaDaysBeforeArrival(requestTimestamp, arrivalDate);
  if (
    rules.minDaysBeforeArrival != null &&
    daysBefore < Number(rules.minDaysBeforeArrival)
  ) {
    return {
      eligible: false,
      reasonCode: 'NAME_TRANSFER_TOO_CLOSE_TO_ARRIVAL',
      daysBeforeArrival: daysBefore,
      followUpActions: []
    };
  }

  if (priorNameTransferCount >= Number(rules.maxTransfers || 0)) {
    return {
      eligible: false,
      reasonCode: 'NAME_TRANSFER_LIMIT_REACHED',
      followUpActions: []
    };
  }

  return {
    eligible: true,
    reasonCode: 'NAME_TRANSFER_ELIGIBLE',
    daysBeforeArrival: daysBefore,
    free: rules.free === true,
    identityOnly: rules.identityOnly === true,
    followUpActions: ['UPDATE_GUEST_IDENTITY_ONLY'],
    participantsMutated: false,
    packageUnchanged: true
  };
}

async function resolveCancellationPolicySnapshot(
  code,
  version,
  deps = {}
) {
  const load =
    deps.loadCancellationPolicyByCodeVersion ||
    (async () => {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState !== 1) {
        throw new Error('MongoDB not connected for cancellation policy lookup');
      }
      const CancellationPolicy = require('../models/CancellationPolicy');
      return CancellationPolicy.findOne({ code, version }).lean();
    });

  let raw;
  try {
    raw = await load(code, version);
  } catch (err) {
    throw new CancellationPolicyError(
      'CANCELLATION_POLICY_LOOKUP_FAILED',
      'Unable to load cancellation policy'
    );
  }

  if (!raw) {
    throw new CancellationPolicyError(
      'CANCELLATION_POLICY_NOT_FOUND',
      `Cancellation policy ${code}@v${version} was not found`
    );
  }

  const normalized = validateAndNormalizeCancellationPolicy(raw);
  if (!normalized.ok) {
    throw new CancellationPolicyError(
      'MALFORMED_CANCELLATION_POLICY',
      'Loaded cancellation policy is invalid',
      normalized.errors
    );
  }

  if (normalized.value.code !== String(code).trim().toLowerCase()) {
    throw new CancellationPolicyError(
      'CANCELLATION_POLICY_MISMATCH',
      'Loaded policy code does not match the requested code'
    );
  }
  if (normalized.value.version !== Number(version)) {
    throw new CancellationPolicyError(
      'CANCELLATION_POLICY_VERSION_MISMATCH',
      'Loaded policy version does not match the requested version'
    );
  }

  return buildCancellationPolicySnapshot(normalized.value);
}

/**
 * Attach an immutable cancellation policy snapshot to a copied quote.
 * Not wired to public quote routes in B7.
 */
async function applyCancellationPolicyToQuote(quote, deps = {}) {
  if (!quote || typeof quote !== 'object') {
    throw new CancellationPolicyError('QUOTE_REQUIRED', 'A base quote is required');
  }

  void quote.clientRefundPercent;
  void quote.clientRefundTiers;
  void quote.refundPercentOverride;
  void quote.cancellationPolicyOverride;

  const code =
    deps.cancellationPolicyCode ||
    quote.ratePlan?.cancellationPolicyCode ||
    quote.packageSnapshot?.cancellationPolicyCode ||
    quote.cancellationPolicyCode;
  const version =
    deps.cancellationPolicyVersion != null
      ? deps.cancellationPolicyVersion
      : quote.ratePlan?.cancellationPolicyVersion != null
        ? quote.ratePlan.cancellationPolicyVersion
        : quote.packageSnapshot?.cancellationPolicyVersion != null
          ? quote.packageSnapshot.cancellationPolicyVersion
          : quote.cancellationPolicyVersion;

  if (!code || version == null) {
    throw new CancellationPolicyError(
      'CANCELLATION_POLICY_REF_MISSING',
      'Quote is missing cancellationPolicyCode/version'
    );
  }

  const snapshot = await resolveCancellationPolicySnapshot(code, version, deps);

  if (snapshot.status !== 'active') {
    throw new CancellationPolicyError(
      'CANCELLATION_POLICY_INACTIVE',
      'Only an active cancellation policy may attach to a new quote'
    );
  }

  return {
    ...quote,
    ratePlan: quote.ratePlan ? { ...quote.ratePlan } : quote.ratePlan,
    packageSnapshot: quote.packageSnapshot
      ? { ...quote.packageSnapshot }
      : quote.packageSnapshot,
    cancellationPolicySnapshot: snapshot,
    totalPrice: quote.totalPrice,
    stripeRefundCreated: false,
    bookingMutated: false
  };
}

module.exports = {
  CancellationPolicyError,
  EVENT_TYPES,
  roundEuro,
  freezeDeep,
  sofiaDaysBeforeArrival,
  validateAndNormalizeCancellationPolicy,
  validateRefundTiers,
  buildCancellationPolicySnapshot,
  isWithinCorrectionWindow,
  findTierRefundPercent,
  calculateCancellationOutcome,
  evaluateOrganizerCancellationClaim,
  evaluateDateTransferEligibility,
  evaluateNameTransferEligibility,
  resolveCancellationPolicySnapshot,
  applyCancellationPolicyToQuote
};
