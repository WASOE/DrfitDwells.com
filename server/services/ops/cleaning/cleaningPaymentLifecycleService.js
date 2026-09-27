const CleaningPayment = require('../../../models/CleaningPayment');
const { normalizeDateToSofiaDayStart } = require('../../../utils/dateTime');
const {
  calculateForMarkPaid,
  calculateCleaningPaymentSummary,
  combineWithManualLineItems
} = require('./cleaningPricingService');

const DEEP_CLEAN_RULE_KEY = 'deep_clean';
const DEEP_CLEAN_LABEL = 'Deep/Main cleaning';
const DEEP_CLEAN_AMOUNT_EUR = 150;

class CleaningPaymentLockedError extends Error {
  constructor(message = 'Cleaning payment is already paid; its snapshot cannot be changed.') {
    super(message);
    this.name = 'CleaningPaymentLockedError';
    this.code = 'CLEANING_PAYMENT_LOCKED';
    this.status = 409;
  }
}

class CleaningPaymentConflictError extends Error {
  constructor(message = 'Cleaning payment changed concurrently. Reload and try again.') {
    super(message);
    this.name = 'CleaningPaymentConflictError';
    this.code = 'CLEANING_PAYMENT_CONFLICT';
    this.status = 409;
  }
}

function bucketFilter(date, propertyKind) {
  return { date: normalizeDateToSofiaDayStart(date), propertyKind };
}

function buildDeepCleanLineItem(propertyKind, actorId) {
  return {
    ruleKey: DEEP_CLEAN_RULE_KEY,
    label: DEEP_CLEAN_LABEL,
    category: 'manual',
    quantity: 1,
    unitAmountEUR: DEEP_CLEAN_AMOUNT_EUR,
    amountEUR: DEEP_CLEAN_AMOUNT_EUR,
    amountType: 'cleaner_payout',
    source: 'manual',
    propertyKind,
    addedAt: new Date(),
    addedBy: actorId
  };
}

function isDuplicateKeyError(error) {
  return error?.code === 11000;
}

function expectedRevision(payment) {
  return { revision: payment.revision == null ? { $in: [null, 0] } : payment.revision };
}

async function addDeepCleaning({ date, propertyKind, actorId }) {
  const filter = bucketFilter(date, propertyKind);
  const item = buildDeepCleanLineItem(propertyKind, actorId);
  let changed = true;

  try {
    const updated = await CleaningPayment.findOneAndUpdate(
      {
        ...filter,
        status: { $ne: 'paid' },
        'manualLineItems.ruleKey': { $ne: DEEP_CLEAN_RULE_KEY }
      },
      {
        $push: { manualLineItems: item },
        $inc: { revision: 1 },
        $setOnInsert: { totalAmount: 0, currency: 'EUR' }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (!updated) changed = false;
  } catch (error) {
    // Upsert collides with the unique (date, propertyKind) row when it is paid or already has the item.
    if (!isDuplicateKeyError(error)) throw error;
    const existing = await CleaningPayment.findOne(filter).lean();
    if (existing?.status === 'paid') throw new CleaningPaymentLockedError();
    const alreadyPresent = (existing?.manualLineItems || []).some(
      (li) => li.ruleKey === DEEP_CLEAN_RULE_KEY
    );
    if (!alreadyPresent) throw new CleaningPaymentConflictError();
    changed = false;
  }

  const summary = await calculateCleaningPaymentSummary({ date, propertyKind });
  return { changed, summary };
}

async function removeDeepCleaning({ date, propertyKind }) {
  const filter = bucketFilter(date, propertyKind);
  const updated = await CleaningPayment.findOneAndUpdate(
    { ...filter, status: { $ne: 'paid' }, 'manualLineItems.ruleKey': DEEP_CLEAN_RULE_KEY },
    {
      $pull: { manualLineItems: { ruleKey: DEEP_CLEAN_RULE_KEY } },
      $inc: { revision: 1 }
    },
    { new: true }
  );

  if (!updated) {
    const existing = await CleaningPayment.findOne(filter).lean();
    if (existing?.status === 'paid') throw new CleaningPaymentLockedError();
  }

  const summary = await calculateCleaningPaymentSummary({ date, propertyKind });
  return { changed: Boolean(updated), summary };
}

function paymentResponse(payment, alreadyPaid) {
  return {
    cleaningPaymentId: String(payment._id),
    status: payment.status,
    totalAmount: payment.totalAmount,
    currency: payment.currency,
    lineItems: payment.lineItems,
    alreadyPaid
  };
}

/**
 * Freeze generated + manual line items. An existing paid snapshot is never recalculated.
 */
async function markCleaningPaymentPaid({ date, propertyKind, actorId }) {
  const filter = bucketFilter(date, propertyKind);
  const existing = await CleaningPayment.findOne(filter).lean();
  if (existing?.status === 'paid') return paymentResponse(existing, true);

  const calc = await calculateForMarkPaid({ date, propertyKind });
  const combined = combineWithManualLineItems(
    calc.lineItems,
    existing?.manualLineItems,
    propertyKind
  );

  const snapshot = {
    currency: calc.currency || 'EUR',
    totalAmount: combined.totalAmountEUR,
    paidAmount: combined.totalAmountEUR,
    status: 'paid',
    lineItems: combined.lineItems,
    pricingPolicyId: calc.pricingPolicyId || null,
    pricingVersion: calc.pricingVersion || null,
    calculatedAt: calc.calculatedAt,
    markedPaidAt: new Date(),
    markedPaidBy: actorId
  };

  let saved;
  try {
    if (existing) {
      saved = await CleaningPayment.findOneAndUpdate(
        { _id: existing._id, status: { $ne: 'paid' }, ...expectedRevision(existing) },
        { $set: snapshot, $inc: { revision: 1 } },
        { new: true }
      ).lean();
    } else {
      saved = (await CleaningPayment.create({ ...filter, ...snapshot, revision: 1 })).toObject();
    }
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    saved = null;
  }

  if (!saved) {
    const current = await CleaningPayment.findOne(filter).lean();
    if (current?.status === 'paid') return paymentResponse(current, true);
    throw new CleaningPaymentConflictError();
  }
  return paymentResponse(saved, false);
}

/**
 * Reopen a paid day for correction. The paid snapshot is archived, not erased;
 * manual line items are kept so a later mark-paid includes them again.
 */
async function unmarkCleaningPaymentPaid({ date, propertyKind, actorId }) {
  const filter = bucketFilter(date, propertyKind);
  const existing = await CleaningPayment.findOne(filter).lean();
  if (!existing || existing.status !== 'paid') {
    return {
      cleaningPaymentId: existing ? String(existing._id) : null,
      status: existing?.status || 'pending',
      changed: false
    };
  }

  const archived = {
    currency: existing.currency || 'EUR',
    totalAmount: existing.totalAmount,
    paidAmount: existing.paidAmount || 0,
    lineItems: existing.lineItems || [],
    pricingPolicyId: existing.pricingPolicyId || null,
    pricingVersion: existing.pricingVersion || null,
    calculatedAt: existing.calculatedAt || null,
    markedPaidAt: existing.markedPaidAt || null,
    markedPaidBy: existing.markedPaidBy || null,
    unmarkedAt: new Date(),
    unmarkedBy: actorId
  };

  const updated = await CleaningPayment.findOneAndUpdate(
    { _id: existing._id, status: 'paid', ...expectedRevision(existing) },
    {
      $push: { paidSnapshotHistory: archived },
      $inc: { revision: 1 },
      $set: {
        status: 'pending',
        paidAmount: 0,
        lineItems: [],
        pricingPolicyId: null,
        pricingVersion: null,
        calculatedAt: null,
        markedPaidAt: null,
        markedPaidBy: null
      }
    },
    { new: true }
  ).lean();

  if (!updated) throw new CleaningPaymentConflictError();
  return { cleaningPaymentId: String(updated._id), status: updated.status, changed: true };
}

module.exports = {
  DEEP_CLEAN_RULE_KEY,
  DEEP_CLEAN_LABEL,
  DEEP_CLEAN_AMOUNT_EUR,
  CleaningPaymentLockedError,
  CleaningPaymentConflictError,
  addDeepCleaning,
  removeDeepCleaning,
  markCleaningPaymentPaid,
  unmarkCleaningPaymentPaid
};
