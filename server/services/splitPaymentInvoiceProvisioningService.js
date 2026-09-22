/**
 * SP6 — idempotent Stripe one-off invoice provisioning for future installments.
 * Does not charge. Stripe charges after scheduled finalization.
 * Independent of SPLIT_PAYMENT_ENABLED (existing obligations continue).
 */
'use strict';

const Stripe = require('stripe');
const { STRIPE_API_VERSION } = require('../config/stripeApiVersion');
const {
  INVOICE_PROVISIONING_OPERATION_VERSION
} = require('../config/splitPaymentCollectionConfig');
const Booking = require('../models/Booking');
const BookingInstallment = require('../models/BookingInstallment');
const {
  dueDateFinalizeAtSofia,
  dueDateFinalizeUnixSeconds,
  isFinalizeTimestampInPast
} = require('./splitPaymentInvoiceTime');
const { openManualReviewItem } = require('./ops/ingestion/manualReviewService');
const {
  recordPaidBookingResolutionIssueSafe,
  PAID_BOOKING_FINALIZATION_STAGES,
  safeErrorSummary
} = require('./payments/paidBookingFinalizationObservability');

class SplitInvoiceProvisioningError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'SplitInvoiceProvisioningError';
    this.code = code;
    this.details = details;
  }
}

const PROVISION_CODES = Object.freeze({
  BOOKING_REQUIRED: 'SPLIT_INVOICE_BOOKING_REQUIRED',
  INSTALLMENT_REQUIRED: 'SPLIT_INVOICE_INSTALLMENT_REQUIRED',
  NOT_FUTURE: 'SPLIT_INVOICE_NOT_FUTURE',
  ALREADY_TERMINAL: 'SPLIT_INVOICE_ALREADY_TERMINAL',
  CUSTOMER_MISSING: 'SPLIT_INVOICE_CUSTOMER_MISSING',
  PM_MISSING: 'SPLIT_INVOICE_PM_MISSING',
  PAST_DUE: 'SPLIT_INVOICE_PAST_DUE_NEEDS_REVIEW',
  CONFLICT: 'SPLIT_INVOICE_CONFLICT',
  VERIFY_FAILED: 'SPLIT_INVOICE_VERIFY_FAILED',
  STRIPE_REQUIRED: 'SPLIT_INVOICE_STRIPE_REQUIRED'
});

function getStripeClient(stripeOverride = null) {
  if (stripeOverride) return stripeOverride;
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION });
}

function buildInvoiceIdempotencyKey(bookingId, sequence, op) {
  return `dd:split-inv:v${INVOICE_PROVISIONING_OPERATION_VERSION}:${bookingId}:${sequence}:${op}`;
}

function buildStableInvoiceMetadata({ booking, installment }) {
  return {
    purpose: 'split_installment_collection',
    bookingId: String(booking._id),
    checkoutSessionId: installment.checkoutSessionId
      ? String(installment.checkoutSessionId)
      : booking.checkoutId
        ? String(booking.checkoutId)
        : '',
    installmentSequence: String(installment.sequence),
    installmentId: String(installment._id),
    scheduleHash: booking.chosenPaymentScheduleSnapshotHash
      ? String(booking.chosenPaymentScheduleSnapshotHash)
      : '',
    expectedAmountCents: String(installment.amountCents),
    expectedCurrency: String(installment.currency || 'EUR').toLowerCase(),
    dueAtDateOnly: String(installment.dueAtDateOnly)
  };
}

function customerIdOf(booking) {
  return booking.stripeCustomerId ? String(booking.stripeCustomerId).trim() : null;
}

function paymentMethodIdOf(booking) {
  return booking.stripeReusablePaymentMethodId
    ? String(booking.stripeReusablePaymentMethodId).trim()
    : null;
}

function invoiceMatchesInstallment(invoice, { booking, installment }) {
  const meta = invoice.metadata || {};
  const mismatches = [];
  if (String(meta.bookingId || '') !== String(booking._id)) {
    mismatches.push({ field: 'metadata.bookingId', actual: meta.bookingId, expected: String(booking._id) });
  }
  if (String(meta.installmentSequence || '') !== String(installment.sequence)) {
    mismatches.push({
      field: 'metadata.installmentSequence',
      actual: meta.installmentSequence,
      expected: String(installment.sequence)
    });
  }
  const expectedAmount = Math.trunc(Number(installment.amountCents));
  const actualAmount = Math.trunc(
    Number(
      invoice.amount_due != null
        ? invoice.amount_due
        : invoice.total != null
          ? invoice.total
          : NaN
    )
  );
  if (!Number.isFinite(actualAmount) || actualAmount !== expectedAmount) {
    mismatches.push({
      field: 'amount',
      actual: actualAmount,
      expected: expectedAmount
    });
  }
  const expectedCurrency = String(installment.currency || 'EUR').toLowerCase();
  if (String(invoice.currency || '').toLowerCase() !== expectedCurrency) {
    mismatches.push({
      field: 'currency',
      actual: invoice.currency,
      expected: expectedCurrency
    });
  }
  const expectedCustomer = customerIdOf(booking);
  const invCustomer =
    typeof invoice.customer === 'object' && invoice.customer?.id
      ? String(invoice.customer.id)
      : invoice.customer
        ? String(invoice.customer)
        : null;
  if (!invCustomer || invCustomer !== expectedCustomer) {
    mismatches.push({
      field: 'customer',
      actual: invCustomer,
      expected: expectedCustomer
    });
  }
  return mismatches;
}

async function claimInstallmentForProvisioning({
  installmentId,
  workerId,
  visibilityMs = 120_000,
  now = new Date(),
  BookingInstallmentModel = BookingInstallment
}) {
  const timeoutAt = new Date(now.getTime() + visibilityMs);
  return BookingInstallmentModel.findOneAndUpdate(
    {
      _id: installmentId,
      sequence: { $gte: 2 },
      status: { $in: ['scheduled', 'processing', 'failed', 'requires_action', 'retry_exhausted'] },
      provisioningState: { $in: ['unprovisioned', 'failed'] },
      $or: [
        { provisioningVisibilityTimeoutAt: null },
        { provisioningVisibilityTimeoutAt: { $lte: now } },
        { provisioningClaimedBy: workerId }
      ]
    },
    {
      $set: {
        provisioningState: 'provisioning',
        provisioningClaimedBy: String(workerId),
        provisioningClaimedAt: now,
        provisioningVisibilityTimeoutAt: timeoutAt
      },
      $inc: { revision: 1 }
    },
    { new: true }
  );
}

async function findDueUnprovisionedInstallments({
  limit = 25,
  BookingInstallmentModel = BookingInstallment
} = {}) {
  // Include rows that crashed mid-provision (invoice id persisted, not yet provisioned).
  return BookingInstallmentModel.find({
    sequence: { $gte: 2 },
    status: { $in: ['scheduled', 'processing', 'failed', 'requires_action', 'retry_exhausted'] },
    provisioningState: { $in: ['unprovisioned', 'failed'] },
    $or: [{ stripeInvoiceId: null }, { automaticallyFinalizesAt: null }]
  })
    .sort({ dueAtDateOnly: 1, createdAt: 1 })
    .limit(limit);
}

/**
 * Provision one future installment invoice (draft → verify → schedule finalize).
 */
async function provisionInstallmentInvoice({
  installment,
  booking = null,
  stripe = null,
  BookingModel = Booking,
  BookingInstallmentModel = BookingInstallment,
  now = new Date(),
  openReviewFn = openManualReviewItem
} = {}) {
  if (!installment?._id) {
    throw new SplitInvoiceProvisioningError(
      PROVISION_CODES.INSTALLMENT_REQUIRED,
      'installment is required'
    );
  }
  const stripeClient = getStripeClient(stripe);
  if (!stripeClient?.invoices?.create) {
    throw new SplitInvoiceProvisioningError(
      PROVISION_CODES.STRIPE_REQUIRED,
      'Stripe client is required for invoice provisioning'
    );
  }

  const live =
    (await BookingInstallmentModel.findById(installment._id)) || installment;
  if (Number(live.sequence) < 2) {
    throw new SplitInvoiceProvisioningError(
      PROVISION_CODES.NOT_FUTURE,
      'Only future installments (sequence >= 2) are provisioned via invoice'
    );
  }
  if (['paid', 'voided', 'cancelled', 'waived'].includes(String(live.status))) {
    return { skipped: true, reason: 'terminal', installment: live };
  }

  const bookingDoc =
    booking || (await BookingModel.findById(live.bookingId));
  if (!bookingDoc) {
    throw new SplitInvoiceProvisioningError(
      PROVISION_CODES.BOOKING_REQUIRED,
      'Booking is required for invoice provisioning'
    );
  }

  const customerId = customerIdOf(bookingDoc);
  const pmId = paymentMethodIdOf(bookingDoc);
  if (!customerId) {
    throw new SplitInvoiceProvisioningError(
      PROVISION_CODES.CUSTOMER_MISSING,
      'Booking.stripeCustomerId is required'
    );
  }
  if (!pmId) {
    throw new SplitInvoiceProvisioningError(
      PROVISION_CODES.PM_MISSING,
      'Booking.stripeReusablePaymentMethodId is required'
    );
  }

  // Fully provisioned — adopt/verify only.
  if (live.stripeInvoiceId && String(live.provisioningState) === 'provisioned') {
    const existing = await stripeClient.invoices.retrieve(String(live.stripeInvoiceId), {
      expand: ['customer', 'default_payment_method']
    });
    const mismatches = invoiceMatchesInstallment(existing, {
      booking: bookingDoc,
      installment: live
    });
    if (mismatches.length) {
      throw new SplitInvoiceProvisioningError(
        PROVISION_CODES.CONFLICT,
        'Existing Stripe invoice conflicts with immutable installment',
        { mismatches, invoiceId: existing.id }
      );
    }
    return { skipped: true, reason: 'already_provisioned', invoice: existing, installment: live };
  }

  if (isFinalizeTimestampInPast(live.dueAtDateOnly, now) && !live.stripeInvoiceId) {
    await BookingInstallmentModel.updateOne(
      { _id: live._id },
      {
        $set: {
          provisioningState: 'past_due_needs_review',
          provisioningClaimedBy: null,
          provisioningVisibilityTimeoutAt: null
        }
      }
    );
    await openReviewFn({
      category: 'split_installment_past_due_unprovisioned',
      severity: 'high',
      entityType: 'BookingInstallment',
      entityId: String(live._id),
      title: 'Past-due split installment has no provisioned invoice',
      details:
        'Installment due finalization time has passed without a Stripe invoice. Do not surprise-charge; ops must resolve.',
      provenance: { source: 'split_invoice_provisioning', sourceReference: String(live._id) },
      evidence: {
        bookingId: String(bookingDoc._id),
        sequence: live.sequence,
        dueAtDateOnly: live.dueAtDateOnly
      }
    });
    await recordPaidBookingResolutionIssueSafe({
      issueType: 'paid_booking_unknown_failure',
      errorCode: PROVISION_CODES.PAST_DUE,
      errorSummary: safeErrorSummary(
        'Past-due split installment unprovisioned — needs ops review, no surprise charge'
      ),
      paymentIntentId: bookingDoc.stripePaymentIntentId || `installment:${live._id}`,
      checkoutId: live.checkoutSessionId || bookingDoc.checkoutId || null,
      bookingId: String(bookingDoc._id),
      finalizationStage: PAID_BOOKING_FINALIZATION_STAGES.UNKNOWN,
      failureSource: 'split_invoice_provisioning',
      extraMetadata: { sequence: live.sequence, dueAtDateOnly: live.dueAtDateOnly }
    });
    throw new SplitInvoiceProvisioningError(
      PROVISION_CODES.PAST_DUE,
      'Past-due unprovisioned installment flagged for review; no automatic charge scheduled',
      { installmentId: String(live._id), dueAtDateOnly: live.dueAtDateOnly }
    );
  }

  const metadata = buildStableInvoiceMetadata({ booking: bookingDoc, installment: live });
  const currency = String(live.currency || 'EUR').toLowerCase();
  const amountCents = Math.trunc(Number(live.amountCents));
  const createKey = buildInvoiceIdempotencyKey(bookingDoc._id, live.sequence, 'create');
  const itemKey = buildInvoiceIdempotencyKey(bookingDoc._id, live.sequence, 'item');
  const scheduleKey = buildInvoiceIdempotencyKey(bookingDoc._id, live.sequence, 'schedule');

  // A. Create DRAFT invoice (or resume after crash using same idempotency key / stored id)
  let invoice;
  if (live.stripeInvoiceId) {
    invoice = await stripeClient.invoices.retrieve(String(live.stripeInvoiceId), {
      expand: ['customer', 'default_payment_method', 'lines']
    });
    const resumeMismatches = invoiceMatchesInstallment(invoice, {
      booking: bookingDoc,
      installment: live
    });
    // amount may be 0 before item attach — only enforce customer/currency/meta on resume-pre-item
    const hard = live.stripeInvoiceItemId
      ? resumeMismatches
      : resumeMismatches.filter((m) => m.field !== 'amount');
    if (hard.length) {
      throw new SplitInvoiceProvisioningError(
        PROVISION_CODES.CONFLICT,
        'Existing Stripe invoice conflicts with immutable installment',
        { mismatches: hard, invoiceId: invoice.id }
      );
    }
  } else {
    invoice = await stripeClient.invoices.create(
      {
        customer: customerId,
        collection_method: 'charge_automatically',
        default_payment_method: pmId,
        auto_advance: false,
        pending_invoice_items_behavior: 'exclude',
        currency,
        metadata,
        payment_settings: {
          payment_method_types: ['card']
        }
      },
      { idempotencyKey: createKey }
    );
    // Persist invoice id immediately so crash-before-item still adopts the same commercial object.
    await BookingInstallmentModel.updateOne(
      { _id: live._id },
      {
        $set: {
          stripeInvoiceId: String(invoice.id),
          stripeInvoiceStatus: invoice.status || 'draft',
          provisioningState: 'provisioning'
        },
        $inc: { revision: 1 }
      }
    );
  }

  // B. Exactly one invoice item attached to this invoice (idempotent resume)
  let item = null;
  if (live.stripeInvoiceItemId) {
    item = { id: String(live.stripeInvoiceItemId) };
  } else {
    item = await stripeClient.invoiceItems.create(
      {
        customer: customerId,
        invoice: invoice.id,
        amount: amountCents,
        currency,
        description: `Balance installment #${live.sequence} — Drift & Dwells booking`,
        metadata
      },
      { idempotencyKey: itemKey }
    );
    await BookingInstallmentModel.updateOne(
      { _id: live._id },
      {
        $set: {
          stripeInvoiceItemId: item?.id ? String(item.id) : null,
          provisioningState: 'provisioning'
        },
        $inc: { revision: 1 }
      }
    );
  }

  // C. Retrieve + verify
  const verified = await stripeClient.invoices.retrieve(invoice.id, {
    expand: ['customer', 'default_payment_method', 'lines']
  });
  const mismatches = invoiceMatchesInstallment(verified, {
    booking: bookingDoc,
    installment: live
  });
  const lineCount = Array.isArray(verified.lines?.data)
    ? verified.lines.data.length
    : verified.lines?.total_count != null
      ? Number(verified.lines.total_count)
      : null;
  if (lineCount != null && lineCount !== 1) {
    mismatches.push({ field: 'lines.count', actual: lineCount, expected: 1 });
  }
  const invPm =
    typeof verified.default_payment_method === 'object' && verified.default_payment_method?.id
      ? String(verified.default_payment_method.id)
      : verified.default_payment_method
        ? String(verified.default_payment_method)
        : null;
  if (!invPm || invPm !== pmId) {
    mismatches.push({ field: 'default_payment_method', actual: invPm, expected: pmId });
  }
  if (mismatches.length) {
    throw new SplitInvoiceProvisioningError(
      PROVISION_CODES.VERIFY_FAILED,
      'Draft invoice failed verification before schedule',
      { mismatches, invoiceId: verified.id }
    );
  }

  // D. Schedule finalization
  const finalizeAt = dueDateFinalizeAtSofia(live.dueAtDateOnly);
  const finalizeUnix = dueDateFinalizeUnixSeconds(live.dueAtDateOnly);
  const scheduled = await stripeClient.invoices.update(
    verified.id,
    {
      auto_advance: true,
      automatically_finalizes_at: finalizeUnix
    },
    { idempotencyKey: scheduleKey }
  );

  const updated = await BookingInstallmentModel.findOneAndUpdate(
    { _id: live._id },
    {
      $set: {
        stripeInvoiceId: String(scheduled.id),
        stripeInvoiceItemId: item?.id ? String(item.id) : live.stripeInvoiceItemId || null,
        stripeInvoiceStatus: scheduled.status || 'draft',
        automaticallyFinalizesAt: finalizeAt,
        provisioningState: 'provisioned',
        provisioningClaimedBy: null,
        provisioningClaimedAt: null,
        provisioningVisibilityTimeoutAt: null,
        status: live.status === 'scheduled' ? 'scheduled' : live.status
      },
      $inc: { revision: 1 }
    },
    { new: true }
  );

  return {
    skipped: false,
    invoice: scheduled,
    invoiceItem: item,
    installment: updated,
    automaticallyFinalizesAt: finalizeAt
  };
}

async function reclaimStaleProvisioningClaims({
  now = new Date(),
  BookingInstallmentModel = BookingInstallment
} = {}) {
  const result = await BookingInstallmentModel.updateMany(
    {
      provisioningState: 'provisioning',
      provisioningVisibilityTimeoutAt: { $lte: now }
    },
    {
      $set: {
        provisioningState: 'unprovisioned',
        provisioningClaimedBy: null,
        provisioningVisibilityTimeoutAt: null
      }
    }
  );
  return { reclaimed: result.modifiedCount || 0 };
}

module.exports = {
  PROVISION_CODES,
  SplitInvoiceProvisioningError,
  getStripeClient,
  buildInvoiceIdempotencyKey,
  buildStableInvoiceMetadata,
  invoiceMatchesInstallment,
  claimInstallmentForProvisioning,
  findDueUnprovisionedInstallments,
  provisionInstallmentInvoice,
  reclaimStaleProvisioningClaims
};
