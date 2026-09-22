/**
 * SP6 — grace period + cancellationReview after Stripe retries are exhausted.
 * NEVER cancels booking or releases inventory.
 *
 * Retry exhaustion is NEVER inferred from invoice.payment_failed alone.
 * Only the worker-side authoritative reconcile (fresh Stripe retrieve +
 * RETRY_STATE_STABILIZATION_MS) may mark retry_exhausted and start grace.
 */
'use strict';

const Stripe = require('stripe');
const { STRIPE_API_VERSION } = require('../config/stripeApiVersion');
const Booking = require('../models/Booking');
const BookingInstallment = require('../models/BookingInstallment');
const {
  RETRY_EXHAUSTED_GRACE_DAYS,
  RETRY_STATE_STABILIZATION_MS
} = require('../config/splitPaymentCollectionConfig');

function getStripe(stripeOverride) {
  if (stripeOverride) return stripeOverride;
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION });
}

function stripeId(value) {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim()) return String(value).trim();
  if (typeof value === 'object' && value.id) return String(value.id).trim();
  return null;
}

function nextAttemptDateFromInvoice(invoice) {
  if (invoice?.next_payment_attempt == null) return null;
  const n = Number(invoice.next_payment_attempt);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000);
}

function invoiceMatchesInstallmentForRetry(invoice, installment, booking) {
  const mismatches = [];
  if (!invoice?.id || String(invoice.id) !== String(installment.stripeInvoiceId || '')) {
    mismatches.push({ field: 'invoice.id' });
  }
  const meta = invoice.metadata || {};
  if (meta.bookingId && String(meta.bookingId) !== String(booking._id)) {
    mismatches.push({ field: 'metadata.bookingId' });
  }
  if (
    meta.installmentSequence &&
    String(meta.installmentSequence) !== String(installment.sequence)
  ) {
    mismatches.push({ field: 'metadata.installmentSequence' });
  }
  if (meta.installmentId && String(meta.installmentId) !== String(installment._id)) {
    mismatches.push({ field: 'metadata.installmentId' });
  }
  const expectedCurrency = String(installment.currency || 'EUR').toLowerCase();
  if (String(invoice.currency || '').toLowerCase() !== expectedCurrency) {
    mismatches.push({ field: 'currency' });
  }
  const invCustomer = stripeId(invoice.customer);
  if (!invCustomer || invCustomer !== String(booking.stripeCustomerId || '')) {
    mismatches.push({ field: 'customer' });
  }
  const expectedAmount = Math.trunc(Number(installment.amountCents));
  const actualAmount = Math.trunc(
    Number(
      invoice.amount_due != null
        ? invoice.amount_due
        : invoice.amount_remaining != null
          ? invoice.amount_remaining
          : invoice.total != null
            ? invoice.total
            : NaN
    )
  );
  if (!Number.isFinite(actualAmount) || actualAmount !== expectedAmount) {
    // Paid invoices may show amount_due=0 — allow amount_paid match when unpaid check fails.
    const paidAmt = Math.trunc(Number(invoice.amount_paid != null ? invoice.amount_paid : NaN));
    if (!(Number.isFinite(paidAmt) && paidAmt === expectedAmount && String(invoice.status) === 'paid')) {
      mismatches.push({ field: 'amount', actual: actualAmount, expected: expectedAmount });
    }
  }
  return mismatches;
}

/**
 * Persist retry metadata from a correlated invoice object.
 * Never starts grace. Never regresses paid/voided/terminal.
 */
async function persistRetryMetadataFromInvoice({
  installment,
  invoice,
  BookingInstallmentModel = BookingInstallment,
  now = new Date()
}) {
  if (!installment?._id) return null;
  if (['paid', 'voided', 'cancelled', 'waived'].includes(String(installment.status))) {
    return installment;
  }

  const nextAttempt = nextAttemptDateFromInvoice(invoice);
  const set = {
    stripeInvoiceStatus: invoice.status || installment.stripeInvoiceStatus || null,
    hostedInvoiceUrl: invoice.hosted_invoice_url || installment.hostedInvoiceUrl || null,
    attemptCount: Number(invoice.attempt_count) || installment.attemptCount || 0,
    nextPaymentAttemptAt: nextAttempt
  };

  if (nextAttempt) {
    set.retryExhaustionCandidateObservedAt = null;
    // Do not clear graceEndsAt here if already retry_exhausted — paid path clears.
    // If we still have a next attempt, cancel any premature exhaustion.
    if (String(installment.status) === 'retry_exhausted') {
      set.status = 'failed';
      set.graceEndsAt = null;
    }
  } else if (
    !installment.retryExhaustionCandidateObservedAt &&
    installment.lastPaymentFailedAt
  ) {
    set.retryExhaustionCandidateObservedAt = now;
  }

  return BookingInstallmentModel.findOneAndUpdate(
    {
      _id: installment._id,
      status: { $nin: ['paid', 'voided', 'cancelled', 'waived'] }
    },
    { $set: set },
    { new: true }
  );
}

/**
 * Authoritatively decide retry_exhausted + 7-day grace for one installment.
 * Idempotent. Paid always wins.
 */
async function reconcileRetryExhaustionForInstallment({
  installment,
  booking = null,
  stripe = null,
  now = new Date(),
  graceDays = RETRY_EXHAUSTED_GRACE_DAYS,
  stabilizationMs = RETRY_STATE_STABILIZATION_MS,
  BookingModel = Booking,
  BookingInstallmentModel = BookingInstallment
} = {}) {
  if (!installment?._id) {
    return { outcome: 'missing_installment' };
  }

  const live =
    (await BookingInstallmentModel.findById(installment._id)) || installment;

  if (String(live.status) === 'paid') {
    return { outcome: 'paid', installment: live };
  }
  if (['voided', 'cancelled', 'waived'].includes(String(live.status))) {
    return { outcome: 'terminal', installment: live };
  }
  if (String(live.status) === 'retry_exhausted' && live.graceEndsAt) {
    return { outcome: 'already_exhausted', installment: live, idempotent: true };
  }
  if (!live.stripeInvoiceId) {
    return { outcome: 'no_invoice' };
  }
  if (!live.lastPaymentFailedAt) {
    return { outcome: 'no_authoritative_failure' };
  }

  const bookingDoc = booking || (await BookingModel.findById(live.bookingId));
  if (!bookingDoc) {
    return { outcome: 'booking_missing' };
  }

  const client = getStripe(stripe);
  if (!client?.invoices?.retrieve) {
    return { outcome: 'stripe_required' };
  }

  const invoice = await client.invoices.retrieve(String(live.stripeInvoiceId));
  const mismatches = invoiceMatchesInstallmentForRetry(invoice, live, bookingDoc);
  if (mismatches.length) {
    return { outcome: 'correlation_failed', mismatches };
  }

  if (String(invoice.status) === 'paid') {
    return { outcome: 'invoice_paid_on_stripe', invoice };
  }

  const recoverable = ['open', 'draft', 'uncollectible'].includes(String(invoice.status || ''));
  // open/unpaid is the expected path; uncollectible is still not "retry scheduled"
  if (String(invoice.status) === 'void') {
    return { outcome: 'invoice_void' };
  }

  const nextAttempt = nextAttemptDateFromInvoice(invoice);
  if (nextAttempt) {
    const updated = await persistRetryMetadataFromInvoice({
      installment: live,
      invoice,
      BookingInstallmentModel,
      now
    });
    return {
      outcome: 'retry_scheduled',
      nextPaymentAttemptAt: nextAttempt,
      installment: updated,
      graceStarted: false
    };
  }

  // No next_payment_attempt on fresh retrieve — do not exhaust until stabilization.
  let candidateAt = live.retryExhaustionCandidateObservedAt
    ? new Date(live.retryExhaustionCandidateObservedAt)
    : null;
  if (!candidateAt) {
    const updated = await BookingInstallmentModel.findOneAndUpdate(
      {
        _id: live._id,
        status: { $nin: ['paid', 'voided', 'cancelled', 'waived', 'retry_exhausted'] },
        retryExhaustionCandidateObservedAt: null
      },
      {
        $set: {
          retryExhaustionCandidateObservedAt: now,
          nextPaymentAttemptAt: null,
          stripeInvoiceStatus: invoice.status || live.stripeInvoiceStatus,
          attemptCount: Number(invoice.attempt_count) || live.attemptCount || 0
        }
      },
      { new: true }
    );
    return {
      outcome: 'stabilizing',
      reason: 'candidate_observed',
      installment: updated || live,
      graceStarted: false
    };
  }

  const elapsed = now.getTime() - candidateAt.getTime();
  if (elapsed < stabilizationMs) {
    await persistRetryMetadataFromInvoice({
      installment: live,
      invoice,
      BookingInstallmentModel,
      now
    });
    return {
      outcome: 'stabilizing',
      reason: 'interval_pending',
      remainingMs: stabilizationMs - elapsed,
      graceStarted: false
    };
  }

  // Re-check paid locally before marking exhausted (race with webhook).
  const freshLocal = await BookingInstallmentModel.findById(live._id);
  if (String(freshLocal?.status) === 'paid') {
    return { outcome: 'paid', installment: freshLocal };
  }

  // Fresh retrieve again immediately before mutate (idempotent barrier).
  const invoice2 = await client.invoices.retrieve(String(live.stripeInvoiceId));
  if (String(invoice2.status) === 'paid') {
    return { outcome: 'invoice_paid_on_stripe', invoice: invoice2 };
  }
  if (nextAttemptDateFromInvoice(invoice2)) {
    const updated = await persistRetryMetadataFromInvoice({
      installment: freshLocal || live,
      invoice: invoice2,
      BookingInstallmentModel,
      now
    });
    return {
      outcome: 'retry_scheduled',
      nextPaymentAttemptAt: nextAttemptDateFromInvoice(invoice2),
      installment: updated,
      graceStarted: false
    };
  }

  const mismatches2 = invoiceMatchesInstallmentForRetry(invoice2, freshLocal || live, bookingDoc);
  if (mismatches2.length) {
    return { outcome: 'correlation_failed', mismatches: mismatches2 };
  }

  const unpaidOk =
    String(invoice2.status) === 'open' ||
    (String(invoice2.status) === 'uncollectible' && recoverable) ||
    String(invoice2.status) === 'open';
  if (String(invoice2.status) !== 'open' && String(invoice2.status) !== 'uncollectible') {
    // draft after failure is unusual — still allow if amount remaining
    if (!(Number(invoice2.amount_remaining) > 0 || Number(invoice2.amount_due) > 0)) {
      return { outcome: 'invoice_not_unpaid', status: invoice2.status };
    }
  }
  void unpaidOk;

  const graceEndsAt = new Date(now.getTime() + graceDays * 24 * 60 * 60 * 1000);
  const updated = await BookingInstallmentModel.findOneAndUpdate(
    {
      _id: live._id,
      status: { $nin: ['paid', 'voided', 'cancelled', 'waived'] },
      nextPaymentAttemptAt: null,
      lastPaymentFailedAt: { $ne: null }
    },
    {
      $set: {
        status: 'retry_exhausted',
        graceEndsAt: freshLocal?.graceEndsAt || graceEndsAt,
        nextPaymentAttemptAt: null,
        stripeInvoiceStatus: invoice2.status || freshLocal?.stripeInvoiceStatus,
        attemptCount: Number(invoice2.attempt_count) || freshLocal?.attemptCount || 0
      }
    },
    { new: true }
  );

  if (!updated) {
    const again = await BookingInstallmentModel.findById(live._id);
    if (String(again?.status) === 'paid') return { outcome: 'paid', installment: again };
    if (String(again?.status) === 'retry_exhausted') {
      return { outcome: 'already_exhausted', installment: again, idempotent: true };
    }
    return { outcome: 'cas_missed', installment: again };
  }

  return {
    outcome: 'retry_exhausted',
    installment: updated,
    graceStarted: true,
    graceEndsAt: updated.graceEndsAt
  };
}

/**
 * Sweep candidates that may be ready for authoritative exhaustion.
 */
async function reconcileRetryExhaustionCandidates({
  limit = 50,
  now = new Date(),
  stripe = null,
  BookingInstallmentModel = BookingInstallment
} = {}) {
  const rows = await BookingInstallmentModel.find({
    sequence: { $gte: 2 },
    status: { $in: ['failed', 'requires_action', 'processing'] },
    stripeInvoiceId: { $ne: null },
    lastPaymentFailedAt: { $ne: null },
    nextPaymentAttemptAt: null,
    graceEndsAt: null
  })
    .sort({ retryExhaustionCandidateObservedAt: 1, lastPaymentFailedAt: 1 })
    .limit(limit);

  const results = [];
  for (const row of rows) {
    results.push(
      await reconcileRetryExhaustionForInstallment({
        installment: row,
        stripe,
        now
      })
    );
  }
  return results;
}

async function clearGraceOnPaid({ booking, installment, BookingModel = Booking }) {
  if (!booking?._id) return;
  if (
    booking.cancellationReview &&
    booking.cancellationReview.status === 'open' &&
    Number(booking.cancellationReview.installmentSequence) === Number(installment.sequence)
  ) {
    await BookingModel.updateOne(
      { _id: booking._id },
      {
        $set: {
          'cancellationReview.status': 'resolved',
          'cancellationReview.resolvedAt': new Date()
        }
      }
    );
  }
}

async function openCancellationReviewIfGraceExpired({
  installment,
  now = new Date(),
  BookingModel = Booking,
  BookingInstallmentModel = BookingInstallment
}) {
  if (!installment?.graceEndsAt) return { opened: false, reason: 'no_grace' };
  if (new Date(installment.graceEndsAt).getTime() > now.getTime()) {
    return { opened: false, reason: 'grace_active' };
  }
  if (String(installment.status) === 'paid') {
    return { opened: false, reason: 'paid' };
  }
  if (!['retry_exhausted', 'failed', 'requires_action'].includes(String(installment.status))) {
    return { opened: false, reason: 'status' };
  }

  const booking = await BookingModel.findById(installment.bookingId);
  if (!booking) return { opened: false, reason: 'booking_missing' };

  if (
    booking.cancellationReview &&
    booking.cancellationReview.status === 'open' &&
    Number(booking.cancellationReview.installmentSequence) === Number(installment.sequence)
  ) {
    return { opened: false, reason: 'already_open', booking };
  }

  await BookingModel.updateOne(
    { _id: booking._id },
    {
      $set: {
        cancellationReview: {
          status: 'open',
          reason: 'unpaid_split_installment',
          installmentSequence: installment.sequence,
          installmentId: installment._id,
          openedAt: now,
          resolvedAt: null
        }
      }
    }
  );

  // Do NOT cancel booking, release inventory, void other installments, or refund.
  return {
    opened: true,
    bookingId: String(booking._id),
    sequence: installment.sequence
  };
}

async function reconcileExpiredGraceInstallments({
  limit = 50,
  now = new Date(),
  BookingInstallmentModel = BookingInstallment
} = {}) {
  const rows = await BookingInstallmentModel.find({
    status: { $in: ['retry_exhausted', 'failed', 'requires_action'] },
    graceEndsAt: { $ne: null, $lte: now },
    sequence: { $gte: 2 }
  })
    .sort({ graceEndsAt: 1 })
    .limit(limit);

  const results = [];
  for (const row of rows) {
    results.push(await openCancellationReviewIfGraceExpired({ installment: row, now }));
  }
  return results;
}

module.exports = {
  persistRetryMetadataFromInvoice,
  reconcileRetryExhaustionForInstallment,
  reconcileRetryExhaustionCandidates,
  clearGraceOnPaid,
  openCancellationReviewIfGraceExpired,
  reconcileExpiredGraceInstallments,
  nextAttemptDateFromInvoice,
  invoiceMatchesInstallmentForRetry,
  /** @deprecated Do not call from webhooks — use reconcileRetryExhaustionForInstallment */
  startGraceIfRetryExhausted: async function startGraceIfRetryExhaustedRemoved() {
    throw new Error(
      'startGraceIfRetryExhausted removed: use reconcileRetryExhaustionForInstallment (authoritative Stripe retrieve + stabilization)'
    );
  }
};
