'use strict';

/**
 * REBOOK money evidence resolvers (S2 spine).
 * Binding: docs/stay-change-implementation-plan.md §23.9–§23.11, §23.35
 *
 * Read-only. Does not write Payment / Booking / Stripe.
 */

const { bookingRevenueCents } = require('../ops/reporting/normalizedStayRow');

const COVERAGE_FAIL_CODES = Object.freeze({
  DISPUTED: 'COVERAGE_DISPUTED',
  TRAIL_STRIPE_DISAGREE: 'COVERAGE_TRAIL_STRIPE_DISAGREE',
  MANUAL_AMBIGUOUS: 'COVERAGE_MANUAL_AMBIGUOUS',
  INVALID_CONTRACTUAL: 'COVERAGE_INVALID_CONTRACTUAL'
});

function isNonNegInt(n) {
  return Number.isInteger(n) && n >= 0;
}

function toNonNegIntOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded !== n && !Number.isInteger(n)) {
    // allow float euros via round path only when caller uses major units elsewhere
  }
  if (!Number.isFinite(rounded) || rounded < 0) return null;
  return rounded;
}

/**
 * Canonical source contractual total (integer cents).
 * Prefer totalValueCents; else round(totalPrice * 100). Same as bookingRevenueCents.
 */
function resolveSourceContractualTotalCents(booking) {
  if (!booking || typeof booking !== 'object') {
    return { ok: false, code: COVERAGE_FAIL_CODES.INVALID_CONTRACTUAL, cents: null };
  }
  if (Number.isFinite(booking.totalValueCents) && booking.totalValueCents != null) {
    const cents = Math.round(booking.totalValueCents);
    if (!isNonNegInt(cents) || cents !== booking.totalValueCents) {
      // allow float-ish stored values if they round cleanly to same meaning
      if (!isNonNegInt(cents) || cents < 0) {
        return { ok: false, code: COVERAGE_FAIL_CODES.INVALID_CONTRACTUAL, cents: null };
      }
    }
    if (cents < 0) {
      return { ok: false, code: COVERAGE_FAIL_CODES.INVALID_CONTRACTUAL, cents: null };
    }
    return { ok: true, cents, source: 'totalValueCents' };
  }
  const totalPrice = Number(booking.totalPrice);
  if (!Number.isFinite(totalPrice) || totalPrice < 0) {
    return { ok: false, code: COVERAGE_FAIL_CODES.INVALID_CONTRACTUAL, cents: null };
  }
  const cents = Math.round(totalPrice * 100);
  if (!isNonNegInt(cents)) {
    return { ok: false, code: COVERAGE_FAIL_CODES.INVALID_CONTRACTUAL, cents: null };
  }
  return { ok: true, cents, source: 'totalPrice' };
}

/** Payment.amount is major currency units (EUR); convert to cents. */
function paymentAmountToCents(payment) {
  const amount = Number(payment?.amount);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

/**
 * Derive recognized net settled coverage from source Booking + optional Payment trail.
 * Fail-closed on disputed / trail vs stripe disagreement / ambiguous manual paid.
 *
 * @param {object} sourceBooking
 * @param {object[]} [paymentTrail] Payment docs linked to source (reservationId)
 * @returns {{ ok: true, cents: number, breakdown: object } | { ok: false, code: string, cents: null, detail?: object }}
 */
function resolveRecognizedNetSettledCoverageCents(sourceBooking, paymentTrail = []) {
  const contractual = resolveSourceContractualTotalCents(sourceBooking);
  if (!contractual.ok) {
    return { ok: false, code: contractual.code, cents: null };
  }

  const trail = Array.isArray(paymentTrail) ? paymentTrail : [];
  const disputed = trail.some((p) => String(p?.status) === 'disputed');
  if (disputed) {
    return {
      ok: false,
      code: COVERAGE_FAIL_CODES.DISPUTED,
      cents: null,
      detail: { reason: 'disputed_payment_present' }
    };
  }

  let cashFromTrailCents = 0;
  let trailHasRecognizedCash = false;
  for (const p of trail) {
    const status = String(p?.status || '');
    if (status === 'paid' || status === 'partial') {
      const cents = paymentAmountToCents(p);
      if (cents == null) {
        return {
          ok: false,
          code: COVERAGE_FAIL_CODES.MANUAL_AMBIGUOUS,
          cents: null,
          detail: { reason: 'invalid_payment_amount' }
        };
      }
      cashFromTrailCents += cents;
      trailHasRecognizedCash = true;
    }
    // unpaid, failed, refunded: do not count
  }

  const stripeAggregate =
    Number.isFinite(sourceBooking?.stripePaidAmountCents) && sourceBooking.stripePaidAmountCents != null
      ? Math.max(0, Math.round(sourceBooking.stripePaidAmountCents))
      : null;

  let recognizedNetCashCoverageCents;
  let cashSource;

  if (trailHasRecognizedCash) {
    if (stripeAggregate != null && stripeAggregate !== cashFromTrailCents) {
      return {
        ok: false,
        code: COVERAGE_FAIL_CODES.TRAIL_STRIPE_DISAGREE,
        cents: null,
        detail: {
          cashFromTrailCents,
          stripePaidAmountCents: stripeAggregate
        }
      };
    }
    recognizedNetCashCoverageCents = cashFromTrailCents;
    cashSource = 'payment_trail';
  } else if (stripeAggregate != null && stripeAggregate > 0) {
    recognizedNetCashCoverageCents = stripeAggregate;
    cashSource = 'stripePaidAmountCents_fallback';
  } else {
    recognizedNetCashCoverageCents = 0;
    cashSource = 'none';
  }

  const voucherRaw = sourceBooking?.giftVoucherAppliedCents;
  let recognizedVoucherCoverageCents = 0;
  if (voucherRaw != null && voucherRaw !== '') {
    const vNum = Number(voucherRaw);
    const v = Math.round(vNum);
    if (!Number.isFinite(vNum) || v < 0 || !Number.isInteger(v)) {
      return {
        ok: false,
        code: COVERAGE_FAIL_CODES.MANUAL_AMBIGUOUS,
        cents: null,
        detail: { reason: 'invalid_giftVoucherAppliedCents' }
      };
    }
    recognizedVoucherCoverageCents = v;
  }

  // Manual / operator booking that looks financially settled without durable evidence → fail closed
  const provenance = String(sourceBooking?.provenance?.source || '').trim();
  const isManual = provenance === 'admin_manual' || provenance === 'operator_manual';
  const status = String(sourceBooking?.status || '');

  if (
    isManual &&
    contractual.cents > 0 &&
    recognizedNetCashCoverageCents === 0 &&
    recognizedVoucherCoverageCents === 0 &&
    (status === 'confirmed' || Boolean(sourceBooking?.stripePaymentIntentId))
  ) {
    return {
      ok: false,
      code: COVERAGE_FAIL_CODES.MANUAL_AMBIGUOUS,
      cents: null,
      detail: { reason: 'manual_appears_settled_without_payment_evidence' }
    };
  }

  const recognizedNetSettledCoverageCents =
    recognizedNetCashCoverageCents + recognizedVoucherCoverageCents;

  return {
    ok: true,
    cents: recognizedNetSettledCoverageCents,
    breakdown: {
      recognizedNetCashCoverageCents,
      recognizedVoucherCoverageCents,
      cashSource,
      sourceContractualTotalCents: contractual.cents
    }
  };
}

/**
 * transferredValueCents = min(sourceContractualTotalCents, recognizedNetSettledCoverageCents)
 */
function computeTransferredValueCents(sourceContractualTotalCents, recognizedNetSettledCoverageCents) {
  if (!isNonNegInt(sourceContractualTotalCents) || !isNonNegInt(recognizedNetSettledCoverageCents)) {
    return { ok: false, cents: null, code: 'INVALID_CENTS' };
  }
  return {
    ok: true,
    cents: Math.min(sourceContractualTotalCents, recognizedNetSettledCoverageCents)
  };
}

/**
 * contractualTargetTotalCents = canonicalTargetQuoteCents - waivedUpgradeCents
 */
function computeContractualTargetTotalCents(canonicalTargetQuoteCents, waivedUpgradeCents = 0) {
  if (!isNonNegInt(canonicalTargetQuoteCents) || !isNonNegInt(waivedUpgradeCents)) {
    return { ok: false, cents: null, code: 'INVALID_CENTS' };
  }
  if (waivedUpgradeCents > canonicalTargetQuoteCents) {
    return { ok: false, cents: null, code: 'WAIVER_EXCEEDS_QUOTE' };
  }
  return { ok: true, cents: canonicalTargetQuoteCents - waivedUpgradeCents };
}

/**
 * Validate money evidence subdocument shape (schema spine; no live Stripe).
 */
function validateMoneyEvidence(money) {
  if (money == null) {
    return { ok: true, optional: true };
  }
  if (typeof money !== 'object' || Array.isArray(money)) {
    return { ok: false, code: 'MONEY_NOT_OBJECT', message: 'money must be an object' };
  }

  const intFields = [
    'sourceContractualTotalCents',
    'recognizedNetSettledCoverageCents',
    'transferredValueCents',
    'canonicalTargetQuoteCents',
    'waivedUpgradeCents',
    'additionalChargeCents',
    'refundCents',
    'creditCents',
    'retainedCents',
    'contractualTargetTotalCents'
  ];

  for (const field of intFields) {
    if (money[field] == null) continue;
    if (!isNonNegInt(money[field])) {
      return {
        ok: false,
        code: 'MONEY_NON_INTEGER_CENTS',
        message: `${field} must be a non-negative integer (cents)`
      };
    }
  }

  if (money.currency != null) {
    const c = String(money.currency).trim().toLowerCase();
    if (!/^[a-z]{3}$/.test(c)) {
      return { ok: false, code: 'MONEY_CURRENCY_INVALID', message: 'currency must be a 3-letter code' };
    }
  }

  if (
    isNonNegInt(money.sourceContractualTotalCents) &&
    isNonNegInt(money.recognizedNetSettledCoverageCents) &&
    isNonNegInt(money.transferredValueCents)
  ) {
    const expected = Math.min(
      money.sourceContractualTotalCents,
      money.recognizedNetSettledCoverageCents
    );
    if (money.transferredValueCents !== expected) {
      return {
        ok: false,
        code: 'TRANSFERRED_VALUE_MISMATCH',
        message: 'transferredValueCents must equal min(contractual, recognized coverage)'
      };
    }
  }

  if (
    isNonNegInt(money.canonicalTargetQuoteCents) &&
    isNonNegInt(money.waivedUpgradeCents) &&
    isNonNegInt(money.contractualTargetTotalCents)
  ) {
    if (money.waivedUpgradeCents > money.canonicalTargetQuoteCents) {
      return { ok: false, code: 'WAIVER_EXCEEDS_QUOTE', message: 'waivedUpgradeCents exceeds quote' };
    }
    const expected = money.canonicalTargetQuoteCents - money.waivedUpgradeCents;
    if (money.contractualTargetTotalCents !== expected) {
      return {
        ok: false,
        code: 'CONTRACTUAL_TARGET_MISMATCH',
        message: 'contractualTargetTotalCents must equal quote minus waiver'
      };
    }
  }

  return { ok: true };
}

module.exports = {
  COVERAGE_FAIL_CODES,
  resolveSourceContractualTotalCents,
  resolveRecognizedNetSettledCoverageCents,
  computeTransferredValueCents,
  computeContractualTargetTotalCents,
  validateMoneyEvidence,
  bookingRevenueCentsAlias: bookingRevenueCents,
  toNonNegIntOrNull,
  isNonNegInt
};
