'use strict';

/**
 * REBOOK money evidence resolvers (S2 spine).
 * Binding: docs/stay-change-implementation-plan.md §23.9–§23.11, §23.35
 *
 * Read-only. Does not write Payment / Booking / Stripe.
 */

const { bookingRevenueCents } = require('../ops/reporting/normalizedStayRow');
const {
  resolveVerifiedGiftVoucherCents,
  resolveVerifiedStayCreditCents
} = require('../ops/payment/reservationPaymentSignals');

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
  const cents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(cents) ||
      Math.abs(amount * 100 - cents) > 0.000001) return null;
  return cents;
}

/**
 * Derive recognized net settled coverage from source Booking + optional Payment trail.
 * Fail-closed on disputed / trail vs stripe disagreement / ambiguous manual paid.
 *
 * @param {object} sourceBooking
 * @param {object[]} [paymentTrail] Payment docs linked to source (reservationId)
 * @returns {{ ok: true, cents: number, breakdown: object } | { ok: false, code: string, cents: null, detail?: object }}
 */
function resolveRecognizedNetSettledCoverageCents(sourceBooking, paymentTrail = [], evidence = {}) {
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
  let grossFromTrailCents = 0;
  let trailHasRecognizedCash = false;
  const seen = new Set();
  for (const p of trail) {
    const status = String(p?.status || '');
    if (['paid', 'partial', 'refunded'].includes(status)) {
      const identity = p.provider && p.providerReference ? `${p.provider}:${p.providerReference}` : null;
      if (!identity || seen.has(identity) ||
          String(p.currency || '').toLowerCase() !== 'eur' ||
          !sourceBooking._id || String(p.reservationId || '') !== String(sourceBooking._id)) {
        return { ok: false, code: COVERAGE_FAIL_CODES.MANUAL_AMBIGUOUS, cents: null,
          detail: { reason: 'ambiguous_payment_identity_currency_or_duplicate' } };
      }
      seen.add(identity);
      let cents = paymentAmountToCents(p);
      if (cents == null) {
        return {
          ok: false,
          code: COVERAGE_FAIL_CODES.MANUAL_AMBIGUOUS,
          cents: null,
          detail: { reason: 'invalid_payment_amount' }
        };
      }
      if (p.provider !== 'stripe' || !/^pi_[A-Za-z0-9_]+$/.test(p.providerReference)) {
        return { ok: false, code: COVERAGE_FAIL_CODES.MANUAL_AMBIGUOUS, cents: null,
          detail: { reason: 'unsupported_cash_provenance' } };
      }
      let grossCents = cents;
      if (status === 'partial' || status === 'refunded') {
        const matches = (evidence.stripePaymentIntents || []).filter(pi => pi.id === p.providerReference);
        const pi = matches[0];
        const charge = pi?.latest_charge;
        const captured = pi?.amount_received;
        const refunded = charge?.amount_refunded;
        const metadata = pi?.metadata || {};
        const identityMismatch =
          (metadata.bookingId && String(metadata.bookingId) !== String(sourceBooking._id)) ||
          (metadata.reservationId && String(metadata.reservationId) !== String(sourceBooking._id)) ||
          (metadata.checkoutId && String(metadata.checkoutId) !== String(sourceBooking.checkoutId || ''));
        if (matches.length !== 1 || identityMismatch || pi?.status !== 'succeeded' ||
            pi?.currency !== 'eur' || charge?.currency !== 'eur' ||
            charge?.payment_intent !== pi?.id || !/^ch_/.test(charge?.id || '') ||
            charge?.paid !== true || charge?.captured !== true || charge?.disputed !== false ||
            !Number.isSafeInteger(captured) || captured <= 0 ||
            charge?.amount !== captured || charge?.amount_captured !== captured ||
            !Number.isSafeInteger(refunded) || refunded <= 0 || refunded > captured) {
          return { ok: false, code: COVERAGE_FAIL_CODES.MANUAL_AMBIGUOUS, cents: null,
            detail: { reason: 'refund_net_coverage_unverified' } };
        }
        const isRefundObject = p.metadata?.stripeObjectType === 'refund' ||
          String(p.metadata?.stripeEventType || '').startsWith('refund.');
        if (isRefundObject) {
          const events = (evidence.stripeRefundEvents || []).filter(event => event.id === p.sourceReference);
          const event = events[0];
          const refund = event?.data?.object;
          if (events.length !== 1 || !String(event.type || '').startsWith('refund.') ||
              refund?.object !== 'refund' || !/^re_/.test(refund?.id || '') ||
              refund?.status !== 'succeeded' || refund?.currency !== 'eur' ||
              refund?.payment_intent !== pi.id || refund?.charge !== charge.id ||
              !Number.isSafeInteger(refund?.amount) || refund.amount <= 0 ||
              refund.amount !== cents || refund.amount > refunded) {
            return { ok: false, code: COVERAGE_FAIL_CODES.MANUAL_AMBIGUOUS, cents: null,
              detail: { reason: 'refund_ledger_amount_unverified' } };
          }
        } else if (cents !== captured) {
          return { ok: false, code: COVERAGE_FAIL_CODES.MANUAL_AMBIGUOUS, cents: null,
            detail: { reason: 'capture_ledger_amount_mismatch' } };
        }
        grossCents = captured;
        cents = captured - refunded;
      }
      grossFromTrailCents += grossCents;
      cashFromTrailCents += cents;
      trailHasRecognizedCash = true;
    }
    // Unpaid/failed rows never supply transferable cash.
  }

  const stripeAggregate =
    Number.isFinite(sourceBooking?.stripePaidAmountCents) && sourceBooking.stripePaidAmountCents != null
      ? Math.max(0, Math.round(sourceBooking.stripePaidAmountCents))
      : null;

  let recognizedNetCashCoverageCents;
  let cashSource;

  if (trailHasRecognizedCash) {
    if (stripeAggregate != null && stripeAggregate !== grossFromTrailCents) {
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
    return { ok: false, code: COVERAGE_FAIL_CODES.MANUAL_AMBIGUOUS, cents: null,
      detail: { reason: 'stripe_aggregate_without_payment_ledger' } };
  } else {
    recognizedNetCashCoverageCents = 0;
    cashSource = 'none';
  }

  const recognizedVoucherCoverageCents = resolveVerifiedGiftVoucherCents(sourceBooking, evidence.giftVoucherRedemption);
  const recognizedStayCreditCoverageCents = resolveVerifiedStayCreditCents(sourceBooking, evidence.stayCreditReservations);
  if ((Number(sourceBooking.giftVoucherAppliedCents || 0) !== recognizedVoucherCoverageCents) ||
      (Number(sourceBooking.stayCreditAppliedCents || 0) !== recognizedStayCreditCoverageCents)) {
    return { ok: false, code: COVERAGE_FAIL_CODES.MANUAL_AMBIGUOUS, cents: null,
      detail: { reason: 'non_card_coverage_unverified' } };
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
    recognizedStayCreditCoverageCents === 0 &&
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
    recognizedNetCashCoverageCents + recognizedVoucherCoverageCents + recognizedStayCreditCoverageCents;
  if (!Number.isSafeInteger(recognizedNetSettledCoverageCents)) {
    return { ok: false, code: COVERAGE_FAIL_CODES.MANUAL_AMBIGUOUS, cents: null,
      detail: { reason: 'coverage_exceeds_safe_integer' } };
  }

  return {
    ok: true,
    cents: recognizedNetSettledCoverageCents,
    breakdown: {
      recognizedNetCashCoverageCents,
      recognizedVoucherCoverageCents,
      recognizedStayCreditCoverageCents,
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
