/**
 * Split-payment OFFER snapshot service (SP4).
 *
 * Builds an immutable optional split-payment offer for a checkout quote.
 * Does NOT record a customer choice, does NOT change Stripe charge amounts,
 * and does NOT write Bookings / Customers / PaymentMethods / invoices.
 */
'use strict';

const crypto = require('crypto');
const moment = require('moment-timezone');

const RatePlan = require('../models/RatePlan');
const featureFlags = require('../utils/featureFlags');
const { PROPERTY_TIMEZONE, formatSofiaDateOnly } = require('../utils/dateTime');
const {
  PaymentTermError,
  validateAndNormalizePaymentTermTemplate,
  resolvePaymentTermTemplate
} = require('./paymentTermService');
const { stableStringify } = require('./checkout/checkoutSessionSnapshot');

const SPLIT_OFFER_SCHEMA_VERSION = 1;

const SPLIT_SCHEDULE_KINDS = new Set(['percent_split', 'fixed_deposit', 'installment_plan']);

const INELIGIBILITY_REASONS = Object.freeze({
  SPLIT_PAYMENT_DISABLED: 'SPLIT_PAYMENT_DISABLED',
  NO_RATE_PLAN: 'NO_RATE_PLAN',
  NO_PAYMENT_TERM: 'NO_PAYMENT_TERM',
  FULL_PAYMENT_TERM: 'FULL_PAYMENT_TERM',
  ACCOMMODATION_VOUCHER_APPLIED: 'ACCOMMODATION_VOUCHER_APPLIED',
  FUTURE_INSTALLMENT_ALREADY_DUE: 'FUTURE_INSTALLMENT_ALREADY_DUE',
  INSTALLMENT_DUE_ON_OR_AFTER_ARRIVAL: 'INSTALLMENT_DUE_ON_OR_AFTER_ARRIVAL',
  ZERO_CARD_OBLIGATION: 'ZERO_CARD_OBLIGATION'
});

class PaymentScheduleError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'PaymentScheduleError';
    this.code = code;
    this.details = details;
  }
}

function assertDateOnly(value, fieldName) {
  const s = value == null ? '' : String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new PaymentScheduleError(
      'INVALID_DATE_ONLY',
      `${fieldName} must be YYYY-MM-DD`,
      { [fieldName]: value }
    );
  }
  const m = moment.tz(s, 'YYYY-MM-DD', true, PROPERTY_TIMEZONE);
  if (!m.isValid()) {
    throw new PaymentScheduleError(
      'INVALID_DATE_ONLY',
      `${fieldName} is not a valid Europe/Sofia civil date`,
      { [fieldName]: value }
    );
  }
  return s;
}

function addDaysToDateOnly(dateOnly, days) {
  return moment
    .tz(dateOnly, 'YYYY-MM-DD', true, PROPERTY_TIMEZONE)
    .startOf('day')
    .add(Number(days), 'days')
    .format('YYYY-MM-DD');
}

function computeDueAtDateOnly(leg, bookingDateOnly, arrivalDateOnly) {
  if (leg.dueRule === 'checkout') {
    return bookingDateOnly;
  }
  if (leg.dueRule === 'days_after_booking') {
    return addDaysToDateOnly(bookingDateOnly, leg.dueOffsetDays);
  }
  if (leg.dueRule === 'days_before_arrival') {
    return addDaysToDateOnly(arrivalDateOnly, -leg.dueOffsetDays);
  }
  throw new PaymentScheduleError(
    'UNSUPPORTED_DUE_RULE',
    `Unsupported dueRule: ${leg.dueRule}`,
    { dueRule: leg.dueRule }
  );
}

/**
 * Integer-cent installment amounts. Final remainder absorbs leftover cents.
 * @throws {PaymentScheduleError} on over-allocation or fixed checkout >= total
 */
function calculateInstallmentAmounts(totalCents, legs) {
  if (!Number.isInteger(totalCents) || totalCents < 1) {
    throw new PaymentScheduleError(
      'INVALID_TOTAL_CENTS',
      'totalCents must be a positive integer for a split offer',
      { totalCents }
    );
  }
  if (!Array.isArray(legs) || legs.length < 2) {
    throw new PaymentScheduleError(
      'INVALID_SPLIT_LEGS',
      'Split schedule requires at least two legs',
      { legCount: Array.isArray(legs) ? legs.length : 0 }
    );
  }

  const amounts = [];
  let allocated = 0;

  for (let i = 0; i < legs.length - 1; i += 1) {
    const leg = legs[i];
    let amountCents;
    if (leg.amountType === 'percent_bps') {
      amountCents = Math.floor((totalCents * leg.amountValue) / 10000);
    } else if (leg.amountType === 'fixed_cents') {
      amountCents = leg.amountValue;
    } else {
      throw new PaymentScheduleError(
        'INVALID_LEG_AMOUNT_TYPE',
        `Non-final leg amountType must be percent_bps or fixed_cents`,
        { sequence: leg.sequence, amountType: leg.amountType }
      );
    }

    if (!Number.isInteger(amountCents) || amountCents < 0) {
      throw new PaymentScheduleError(
        'INVALID_INSTALLMENT_AMOUNT',
        'Installment amountCents must be a non-negative integer',
        { sequence: leg.sequence, amountCents }
      );
    }

    allocated += amountCents;
    if (allocated >= totalCents) {
      throw new PaymentScheduleError(
        'OVER_ALLOCATION',
        'Non-final installments over-allocate totalCents (remainder would be <= 0)',
        { totalCents, allocated, sequence: leg.sequence }
      );
    }
    amounts.push(amountCents);
  }

  // Reservation / checkout leg protection: fixed (or computed) checkout amount
  // must leave a positive remainder — checkout amount >= total fails closed.
  if (amounts[0] >= totalCents) {
    throw new PaymentScheduleError(
      'RESERVATION_AMOUNT_GE_TOTAL',
      'Checkout reservation installment amount must be less than totalCents',
      { totalCents, reservationAmountCents: amounts[0] }
    );
  }

  const remainderCents = totalCents - allocated;
  if (!Number.isInteger(remainderCents) || remainderCents < 1) {
    throw new PaymentScheduleError(
      'OVER_ALLOCATION',
      'Remainder installment must be a positive integer',
      { totalCents, allocated, remainderCents }
    );
  }
  amounts.push(remainderCents);

  const sum = amounts.reduce((a, b) => a + b, 0);
  if (sum !== totalCents) {
    throw new PaymentScheduleError(
      'AMOUNT_SUM_MISMATCH',
      'Installment amounts must sum exactly to totalCents',
      { totalCents, sum }
    );
  }

  return amounts;
}

function buildCanonicalOfferHashPayload(snapshot) {
  return {
    schemaVersion: snapshot.schemaVersion,
    templateCode: snapshot.templateCode,
    templateVersion: snapshot.templateVersion,
    scheduleKind: snapshot.scheduleKind,
    currency: snapshot.currency,
    totalCents: snapshot.totalCents,
    bookingDateOnly: snapshot.bookingDateOnly,
    arrivalDateOnly: snapshot.arrivalDateOnly,
    allowDateTransfer: snapshot.allowDateTransfer === true,
    installments: snapshot.installments.map((row) => ({
      sequence: row.sequence,
      amountCents: row.amountCents,
      amountType: row.amountType,
      dueRule: row.dueRule,
      dueOffsetDays: row.dueOffsetDays,
      dueAtDateOnly: row.dueAtDateOnly,
      cancellationTreatment: row.cancellationTreatment
    }))
  };
}

function hashSplitPaymentOfferSnapshot(snapshot) {
  const payload = buildCanonicalOfferHashPayload(snapshot);
  return crypto.createHash('sha256').update(stableStringify(payload), 'utf8').digest('hex');
}

function ineligible(reason) {
  return { eligible: false, reason, snapshot: null, hash: null };
}

function eligible(snapshot) {
  const hash = hashSplitPaymentOfferSnapshot(snapshot);
  return { eligible: true, reason: null, snapshot, hash };
}

/**
 * Pure: build split offer from a resolved/normalized template + commercial inputs.
 * Normal commercial ineligibility → { eligible: false, reason }.
 * Config/integrity failures → throw PaymentScheduleError / PaymentTermError.
 */
function buildSplitPaymentOffer({
  totalCents,
  currency = 'EUR',
  template,
  bookingDateOnly,
  arrivalDateOnly,
  voucherAppliedCents = 0,
  stayCreditAppliedCents = 0
}) {
  const voucherCents = Math.max(0, Number(voucherAppliedCents) || 0);
  const stayCreditCents = Math.max(0, Number(stayCreditAppliedCents) || 0);
  if (voucherCents > 0 || stayCreditCents > 0) {
    return ineligible(INELIGIBILITY_REASONS.ACCOMMODATION_VOUCHER_APPLIED);
  }

  if (!Number.isInteger(totalCents) || totalCents < 1) {
    return ineligible(INELIGIBILITY_REASONS.ZERO_CARD_OBLIGATION);
  }

  const booking = assertDateOnly(bookingDateOnly, 'bookingDateOnly');
  const arrival = assertDateOnly(arrivalDateOnly, 'arrivalDateOnly');

  const normalized = validateAndNormalizePaymentTermTemplate(
    template && typeof template.toObject === 'function' ? template.toObject() : template
  );
  if (!normalized.ok) {
    throw new PaymentScheduleError(
      'MALFORMED_PAYMENT_TERM',
      `Payment term template is malformed: ${normalized.errors.join('; ')}`,
      { errors: normalized.errors }
    );
  }

  const term = normalized.value;
  const wantedCurrency = currency == null ? 'EUR' : String(currency).toUpperCase();
  if (term.currency !== wantedCurrency) {
    throw new PaymentScheduleError(
      'UNSUPPORTED_CURRENCY',
      `Payment term currency ${term.currency} does not match checkout currency ${wantedCurrency}`,
      { templateCurrency: term.currency, checkoutCurrency: wantedCurrency }
    );
  }
  if (wantedCurrency !== 'EUR') {
    throw new PaymentScheduleError(
      'UNSUPPORTED_CURRENCY',
      `Unsupported checkout currency: ${wantedCurrency}`,
      { currency: wantedCurrency }
    );
  }

  if (term.scheduleKind === 'full') {
    return ineligible(INELIGIBILITY_REASONS.FULL_PAYMENT_TERM);
  }

  if (!SPLIT_SCHEDULE_KINDS.has(term.scheduleKind)) {
    throw new PaymentScheduleError(
      'UNSUPPORTED_SCHEDULE_KIND',
      `Unsupported scheduleKind for split offer: ${term.scheduleKind}`,
      { scheduleKind: term.scheduleKind }
    );
  }

  const checkoutLeg = term.legs[0];
  if (!checkoutLeg || checkoutLeg.dueRule !== 'checkout') {
    throw new PaymentScheduleError(
      'INVALID_SPLIT_CHECKOUT_LEG',
      'Split schedule must begin with a checkout leg',
      { sequence: checkoutLeg && checkoutLeg.sequence }
    );
  }
  if (checkoutLeg.cancellationTreatment !== 'stay_credit') {
    throw new PaymentScheduleError(
      'INVALID_SPLIT_CHECKOUT_CANCELLATION_TREATMENT',
      'Split schedule checkout/reservation leg must use cancellationTreatment=stay_credit',
      {
        sequence: checkoutLeg.sequence,
        cancellationTreatment: checkoutLeg.cancellationTreatment
      }
    );
  }

  const amountCentsList = calculateInstallmentAmounts(totalCents, term.legs);

  const installments = term.legs.map((leg, index) => {
    const dueAtDateOnly = computeDueAtDateOnly(leg, booking, arrival);
    return {
      sequence: leg.sequence,
      amountCents: amountCentsList[index],
      amountType: leg.amountType,
      dueRule: leg.dueRule,
      dueOffsetDays: leg.dueOffsetDays,
      dueAtDateOnly,
      cancellationTreatment: leg.cancellationTreatment
    };
  });

  for (const inst of installments) {
    if (inst.dueRule === 'checkout') continue;
    if (inst.dueAtDateOnly <= booking) {
      return ineligible(INELIGIBILITY_REASONS.FUTURE_INSTALLMENT_ALREADY_DUE);
    }
    if (inst.dueAtDateOnly >= arrival) {
      return ineligible(INELIGIBILITY_REASONS.INSTALLMENT_DUE_ON_OR_AFTER_ARRIVAL);
    }
  }

  const snapshot = {
    schemaVersion: SPLIT_OFFER_SCHEMA_VERSION,
    templateCode: term.code,
    templateVersion: term.version,
    scheduleKind: term.scheduleKind,
    currency: term.currency,
    totalCents,
    bookingDateOnly: booking,
    arrivalDateOnly: arrival,
    allowDateTransfer: term.allowDateTransfer === true,
    installments
  };

  return eligible(snapshot);
}

async function loadPinnedPaymentTermRefFromQuote(quote, deps = {}) {
  const rp = quote && quote.ratePlan;
  if (!rp || rp.code == null || rp.version == null) {
    return { paymentTermCode: null, paymentTermVersion: null, reason: INELIGIBILITY_REASONS.NO_RATE_PLAN };
  }
  const code = String(rp.code).trim().toLowerCase();
  const version = Number(rp.version);
  if (!code || !Number.isInteger(version) || version < 1) {
    return { paymentTermCode: null, paymentTermVersion: null, reason: INELIGIBILITY_REASONS.NO_RATE_PLAN };
  }

  const Model = deps.RatePlan || RatePlan;
  const opts = deps.session ? { session: deps.session } : {};
  const plan = await Model.findOne({ code, version }, null, opts).lean();
  if (!plan) {
    return { paymentTermCode: null, paymentTermVersion: null, reason: INELIGIBILITY_REASONS.NO_RATE_PLAN };
  }

  const paymentTermCode =
    plan.paymentTermCode != null && String(plan.paymentTermCode).trim() !== ''
      ? String(plan.paymentTermCode).trim().toLowerCase()
      : null;
  const paymentTermVersion =
    plan.paymentTermVersion != null ? Number(plan.paymentTermVersion) : null;

  if (!paymentTermCode || !Number.isInteger(paymentTermVersion) || paymentTermVersion < 1) {
    return {
      paymentTermCode: null,
      paymentTermVersion: null,
      reason: INELIGIBILITY_REASONS.NO_PAYMENT_TERM
    };
  }

  return { paymentTermCode, paymentTermVersion, reason: null };
}

/**
 * Checkout integration entry: resolve + evaluate split offer for a session write.
 * Flag off / normal ineligibility → null snapshot fields (full pay continues).
 * Config failures throw.
 *
 * @returns {{ splitPaymentOfferSnapshot: object|null, splitPaymentOfferSnapshotHash: string|null, eligibility: object }}
 */
async function resolveSplitPaymentOfferForCheckout({
  quote,
  quoteSnapshot,
  stripeAmountCents,
  bookingDateOnly = null,
  deps = {}
} = {}) {
  const nullOffer = {
    splitPaymentOfferSnapshot: null,
    splitPaymentOfferSnapshotHash: null
  };

  const isEnabled =
    typeof deps.isSplitPaymentEnabled === 'function'
      ? deps.isSplitPaymentEnabled()
      : featureFlags.isSplitPaymentEnabled();

  if (!isEnabled) {
    return {
      ...nullOffer,
      eligibility: ineligible(INELIGIBILITY_REASONS.SPLIT_PAYMENT_DISABLED)
    };
  }

  const pin = await loadPinnedPaymentTermRefFromQuote(quote, deps);
  if (!pin.paymentTermCode) {
    return {
      ...nullOffer,
      eligibility: ineligible(pin.reason || INELIGIBILITY_REASONS.NO_PAYMENT_TERM)
    };
  }

  let template;
  try {
    template = await resolvePaymentTermTemplate(pin.paymentTermCode, pin.paymentTermVersion, deps);
  } catch (err) {
    if (err instanceof PaymentTermError && err.code === 'PAYMENT_TERM_NOT_FOUND') {
      throw new PaymentScheduleError(
        'PAYMENT_TERM_NOT_FOUND',
        err.message,
        err.details
      );
    }
    throw err;
  }

  const voucherAppliedCents = Math.max(
    0,
    Number(
      quoteSnapshot && quoteSnapshot.voucherAppliedCents != null
        ? quoteSnapshot.voucherAppliedCents
        : quote && quote.voucherAppliedCents != null
          ? quote.voucherAppliedCents
          : 0
    ) || 0
  );
  const stayCreditAppliedCents = Math.max(
    0,
    Number(
      quoteSnapshot && quoteSnapshot.stayCreditAppliedCents != null
        ? quoteSnapshot.stayCreditAppliedCents
        : quote && quote.stayCreditAppliedCents != null
          ? quote.stayCreditAppliedCents
          : 0
    ) || 0
  );

  const totalCents = Math.max(
    0,
    Number(
      stripeAmountCents != null
        ? stripeAmountCents
        : quoteSnapshot && quoteSnapshot.stripeAmountCents != null
          ? quoteSnapshot.stripeAmountCents
          : 0
    ) || 0
  );

  const booking =
    bookingDateOnly != null && String(bookingDateOnly).trim() !== ''
      ? String(bookingDateOnly).trim()
      : formatSofiaDateOnly(new Date());
  const arrival =
    (quoteSnapshot && quoteSnapshot.checkInDateOnly) ||
    (quote && (quote.checkInDateOnly || null)) ||
    '';

  const eligibility = buildSplitPaymentOffer({
    totalCents,
    currency:
      (quoteSnapshot && quoteSnapshot.currency) ||
      (quote && quote.ratePlan && quote.ratePlan.currency) ||
      'EUR',
    template,
    bookingDateOnly: booking,
    arrivalDateOnly: arrival,
    voucherAppliedCents,
    stayCreditAppliedCents
  });

  if (!eligibility.eligible) {
    return { ...nullOffer, eligibility };
  }

  return {
    splitPaymentOfferSnapshot: eligibility.snapshot,
    splitPaymentOfferSnapshotHash: eligibility.hash,
    eligibility
  };
}

module.exports = {
  SPLIT_OFFER_SCHEMA_VERSION,
  INELIGIBILITY_REASONS,
  PaymentScheduleError,
  addDaysToDateOnly,
  computeDueAtDateOnly,
  calculateInstallmentAmounts,
  hashSplitPaymentOfferSnapshot,
  buildCanonicalOfferHashPayload,
  buildSplitPaymentOffer,
  loadPinnedPaymentTermRefFromQuote,
  resolveSplitPaymentOfferForCheckout
};
