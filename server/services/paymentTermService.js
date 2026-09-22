/**
 * Payment term template service (SP3).
 *
 * Pure configuration: normalize, validate structure, resolve by (code, version).
 * Does not calculate amounts or due dates, does not call Stripe, and does not
 * touch CheckoutSession or Booking.
 */
'use strict';

const PaymentTermTemplateModel = require('../models/PaymentTermTemplate');
const {
  PAYMENT_TERM_STATUSES,
  PAYMENT_TERM_CURRENCIES,
  PAYMENT_TERM_SCHEDULE_KINDS,
  PAYMENT_TERM_AMOUNT_TYPES,
  PAYMENT_TERM_DUE_RULES
} = PaymentTermTemplateModel;

const CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

class PaymentTermError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'PaymentTermError';
    this.code = code;
    this.details = details;
  }
}

function normalizeCode(raw, errors, fieldName = 'code') {
  if (raw == null || String(raw).trim() === '') {
    errors.push(`${fieldName} is required`);
    return '';
  }
  const code = String(raw).trim().toLowerCase();
  if (code.length < 2 || code.length > 80) {
    errors.push(`${fieldName} must be 2–80 characters`);
  }
  if (!CODE_PATTERN.test(code)) {
    errors.push(`${fieldName} must be lowercase kebab-case`);
  }
  return code;
}

function normalizeLeg(raw, index, errors) {
  const prefix = `legs[${index}]`;
  if (!raw || typeof raw !== 'object') {
    errors.push(`${prefix} must be an object`);
    return null;
  }

  const sequence = raw.sequence;
  if (!Number.isInteger(sequence) || sequence < 1) {
    errors.push(`${prefix}.sequence must be a positive integer`);
  }

  const amountType = raw.amountType == null ? '' : String(raw.amountType);
  if (!PAYMENT_TERM_AMOUNT_TYPES.includes(amountType)) {
    errors.push(`${prefix}.amountType is unsupported`);
  }

  let amountValue = raw.amountValue;
  if (amountType === 'remainder') {
    if (amountValue != null) {
      errors.push(`${prefix}.amountValue must be null for remainder`);
    }
    amountValue = null;
  } else if (amountType === 'percent_bps') {
    if (!Number.isInteger(amountValue) || amountValue < 1 || amountValue > 10000) {
      errors.push(`${prefix}.amountValue must be an integer from 1 to 10000 for percent_bps`);
    }
  } else if (amountType === 'fixed_cents') {
    if (!Number.isInteger(amountValue) || amountValue < 1) {
      errors.push(`${prefix}.amountValue must be an integer >= 1 for fixed_cents`);
    }
  }

  const dueRule = raw.dueRule == null ? '' : String(raw.dueRule);
  if (!PAYMENT_TERM_DUE_RULES.includes(dueRule)) {
    errors.push(`${prefix}.dueRule is unsupported`);
  }

  let dueOffsetDays = raw.dueOffsetDays;
  if (dueOffsetDays == null && dueRule === 'checkout') {
    dueOffsetDays = 0;
  }
  if (!Number.isInteger(dueOffsetDays) || dueOffsetDays < 0) {
    errors.push(`${prefix}.dueOffsetDays must be an integer >= 0`);
  } else if (dueRule === 'checkout' && dueOffsetDays !== 0) {
    errors.push(`${prefix}.dueOffsetDays must be 0 when dueRule is checkout`);
  }

  const nonRefundable = raw.nonRefundable === true;

  return {
    sequence: Number.isInteger(sequence) ? sequence : index + 1,
    amountType,
    amountValue: amountValue == null ? null : amountValue,
    dueRule,
    dueOffsetDays: Number.isInteger(dueOffsetDays) ? dueOffsetDays : 0,
    nonRefundable
  };
}

function validateLegStructure(legs, scheduleKind, errors) {
  if (!Array.isArray(legs) || legs.length === 0) {
    errors.push('At least one payment term leg is required');
    return;
  }

  const n = legs.length;
  for (let i = 0; i < n; i += 1) {
    if (legs[i].sequence !== i + 1) {
      errors.push('leg sequences must be contiguous starting at 1');
      break;
    }
  }

  const checkoutLegs = legs.filter((l) => l.dueRule === 'checkout');
  if (checkoutLegs.length === 0) {
    errors.push('exactly one checkout leg is required');
  } else if (checkoutLegs.length > 1) {
    errors.push('only one checkout leg is allowed');
  } else if (legs[0].dueRule !== 'checkout' || legs[0].sequence !== 1) {
    errors.push('checkout leg must be sequence 1');
  }

  const remainderLegs = legs.filter((l) => l.amountType === 'remainder');
  if (remainderLegs.length === 0) {
    errors.push('exactly one remainder leg is required');
  } else if (remainderLegs.length > 1) {
    errors.push('only one remainder leg is allowed');
  } else if (legs[n - 1].amountType !== 'remainder') {
    errors.push('remainder leg must be the final sequence');
  }

  for (let i = 0; i < n - 1; i += 1) {
    if (legs[i].amountType === 'remainder') {
      errors.push('non-final legs cannot be remainder');
      break;
    }
  }

  const nonFinal = legs.slice(0, -1);
  const percentBpsSum = nonFinal
    .filter((l) => l.amountType === 'percent_bps')
    .reduce((sum, l) => sum + (Number.isInteger(l.amountValue) ? l.amountValue : 0), 0);
  if (percentBpsSum >= 10000) {
    errors.push('non-final percent_bps legs must sum to less than 10000 (remainder balances cents)');
  }

  if (scheduleKind === 'full') {
    if (n !== 1) {
      errors.push('full scheduleKind requires exactly one leg');
    } else {
      if (legs[0].dueRule !== 'checkout') {
        errors.push('full scheduleKind leg must be due at checkout');
      }
      if (legs[0].amountType !== 'remainder') {
        errors.push('full scheduleKind leg must be remainder');
      }
    }
  } else if (scheduleKind === 'fixed_deposit') {
    if (n < 2) {
      errors.push('fixed_deposit requires at least two legs');
    } else {
      if (legs[0].amountType !== 'fixed_cents' || legs[0].dueRule !== 'checkout') {
        errors.push('fixed_deposit first leg must be checkout fixed_cents');
      }
      if (legs[n - 1].amountType !== 'remainder') {
        errors.push('fixed_deposit final leg must be remainder');
      }
    }
  } else if (scheduleKind === 'percent_split') {
    if (n < 2) {
      errors.push('percent_split requires at least two legs');
    } else {
      if (legs[0].dueRule !== 'checkout') {
        errors.push('percent_split first leg must be checkout');
      }
      const hasNonFinalPercent = nonFinal.some((l) => l.amountType === 'percent_bps');
      if (!hasNonFinalPercent) {
        errors.push('percent_split requires at least one non-final percent_bps leg');
      }
      if (legs[n - 1].amountType !== 'remainder') {
        errors.push('percent_split final leg must be remainder');
      }
    }
  } else if (scheduleKind === 'installment_plan') {
    if (n < 2) {
      errors.push('installment_plan requires at least two legs');
    } else {
      if (legs[0].dueRule !== 'checkout') {
        errors.push('installment_plan first leg must be checkout');
      }
      for (let i = 0; i < n - 1; i += 1) {
        if (legs[i].amountType !== 'percent_bps' && legs[i].amountType !== 'fixed_cents') {
          errors.push('installment_plan non-final legs must be percent_bps or fixed_cents');
          break;
        }
      }
      if (legs[n - 1].amountType !== 'remainder') {
        errors.push('installment_plan final leg must be remainder');
      }
    }
  }
}

/**
 * @param {object} input
 * @returns {{ ok: true, value: object } | { ok: false, errors: string[] }}
 */
function validateAndNormalizePaymentTermTemplate(input) {
  const errors = [];
  if (!input || typeof input !== 'object') {
    return { ok: false, errors: ['input must be an object'] };
  }

  const code = normalizeCode(input.code, errors);
  const internalName =
    input.internalName == null ? '' : String(input.internalName).trim();
  if (!internalName) {
    errors.push('internalName is required');
  } else if (internalName.length > 160) {
    errors.push('internalName cannot exceed 160 characters');
  }

  const version = input.version;
  if (!Number.isInteger(version) || version < 1) {
    errors.push('version must be a positive integer');
  }

  let status = input.status == null ? 'draft' : String(input.status);
  if (!PAYMENT_TERM_STATUSES.includes(status)) {
    errors.push('status must be draft, active, or retired');
    status = 'draft';
  }

  const currency =
    input.currency == null ? 'EUR' : String(input.currency).toUpperCase();
  if (!PAYMENT_TERM_CURRENCIES.includes(currency)) {
    errors.push('Unsupported currency');
  }

  const scheduleKind = input.scheduleKind == null ? '' : String(input.scheduleKind);
  if (!PAYMENT_TERM_SCHEDULE_KINDS.includes(scheduleKind)) {
    errors.push('scheduleKind is unsupported');
  }

  const allowDateTransfer = input.allowDateTransfer === true;

  const rawLegs = Array.isArray(input.legs) ? input.legs : [];
  const legs = [];
  rawLegs.forEach((row, index) => {
    const leg = normalizeLeg(row, index, errors);
    if (leg) legs.push(leg);
  });

  if (PAYMENT_TERM_SCHEDULE_KINDS.includes(scheduleKind)) {
    validateLegStructure(legs, scheduleKind, errors);
  }

  if (errors.length) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      code,
      internalName,
      version,
      status,
      currency,
      scheduleKind,
      legs,
      allowDateTransfer
    }
  };
}

/**
 * Resolve exact (code, version) regardless of status (historical pin support).
 * @param {string} code
 * @param {number} version
 * @param {{ PaymentTermTemplate?: typeof PaymentTermTemplateModel, session?: object }} [deps]
 */
async function resolvePaymentTermTemplate(code, version, deps = {}) {
  const Model = deps.PaymentTermTemplate || PaymentTermTemplateModel;
  const wantedCode = String(code || '')
    .trim()
    .toLowerCase();
  const wantedVersion = Number(version);
  if (!wantedCode || !Number.isInteger(wantedVersion) || wantedVersion < 1) {
    throw new PaymentTermError(
      'INVALID_PAYMENT_TERM_REFERENCE',
      'paymentTermCode and paymentTermVersion are required to resolve a template',
      { paymentTermCode: wantedCode || null, paymentTermVersion: wantedVersion }
    );
  }
  const opts = deps.session ? { session: deps.session } : {};
  const doc = await Model.findOne(
    { code: wantedCode, version: wantedVersion },
    null,
    opts
  ).lean();
  if (!doc) {
    throw new PaymentTermError(
      'PAYMENT_TERM_NOT_FOUND',
      `Payment term ${wantedCode}@v${wantedVersion} was not found`,
      { paymentTermCode: wantedCode, paymentTermVersion: wantedVersion }
    );
  }
  return doc;
}

/**
 * For NEW RatePlan activation attachments: template must exist and be active.
 */
async function assertActivePaymentTermTemplate(code, version, deps = {}) {
  const doc = await resolvePaymentTermTemplate(code, version, deps);
  if (doc.status !== 'active') {
    throw new PaymentTermError(
      'PAYMENT_TERM_NOT_ACTIVE',
      `Payment term ${doc.code}@v${doc.version} must be active to attach on activation (status=${doc.status})`,
      {
        paymentTermCode: doc.code,
        paymentTermVersion: doc.version,
        status: doc.status
      }
    );
  }
  return doc;
}

/**
 * Normalize optional RatePlan payment-term reference.
 * Both present or both absent. Does not touch requiresFullPayment.
 *
 * @returns {{ paymentTermCode: string|null, paymentTermVersion: number|null, errors: string[] }}
 */
function normalizeOptionalPaymentTermReference(input) {
  const errors = [];
  const hasCode =
    input != null &&
    Object.prototype.hasOwnProperty.call(input, 'paymentTermCode') &&
    input.paymentTermCode != null &&
    String(input.paymentTermCode).trim() !== '';
  const hasVersion =
    input != null &&
    Object.prototype.hasOwnProperty.call(input, 'paymentTermVersion') &&
    input.paymentTermVersion != null &&
    input.paymentTermVersion !== '';

  // Treat explicit nulls / missing as absent when both are empty-ish.
  const codeRaw = input && input.paymentTermCode;
  const versionRaw = input && input.paymentTermVersion;
  const codeEmpty = codeRaw == null || String(codeRaw).trim() === '';
  const versionEmpty =
    versionRaw == null || versionRaw === '' || (typeof versionRaw === 'number' && Number.isNaN(versionRaw));

  if (codeEmpty && versionEmpty) {
    return { paymentTermCode: null, paymentTermVersion: null, errors };
  }

  if (codeEmpty !== versionEmpty) {
    errors.push('paymentTermCode and paymentTermVersion must both be set or both be absent');
    return { paymentTermCode: null, paymentTermVersion: null, errors };
  }

  const paymentTermCode = normalizeCode(codeRaw, errors, 'paymentTermCode');
  const paymentTermVersion = Number(versionRaw);
  if (!Number.isInteger(paymentTermVersion) || paymentTermVersion < 1) {
    errors.push('paymentTermVersion must be a positive integer');
  }

  return {
    paymentTermCode: errors.length ? null : paymentTermCode,
    paymentTermVersion: errors.length ? null : paymentTermVersion,
    errors
  };
}

module.exports = {
  PaymentTermError,
  validateAndNormalizePaymentTermTemplate,
  resolvePaymentTermTemplate,
  assertActivePaymentTermTemplate,
  normalizeOptionalPaymentTermReference,
  PAYMENT_TERM_STATUSES,
  PAYMENT_TERM_CURRENCIES,
  PAYMENT_TERM_SCHEDULE_KINDS,
  PAYMENT_TERM_AMOUNT_TYPES,
  PAYMENT_TERM_DUE_RULES
};
