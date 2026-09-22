/**
 * SP6 — authoritative Stripe invoice.* webhook handling for split installments.
 * Webhooks remain source of truth. Duplicates / out-of-order must converge.
 *
 * invoice.payment_failed may record failure evidence but NEVER starts grace
 * solely because next_payment_attempt is absent. Exhaustion is worker-authoritative.
 */
'use strict';

const Payment = require('../models/Payment');
const Booking = require('../models/Booking');
const BookingInstallment = require('../models/BookingInstallment');
const {
  recomputeBookingSettlementFromInstallments
} = require('./bookingInstallmentSettlementService');
const {
  applyReplacementCardFromPaidInvoice,
  resolveInvoicePaymentProvenance
} = require('./splitPaymentReplacementCardService');
const {
  sendSplitInstallmentFailureEmail
} = require('./splitPaymentCollectionEmailService');
const {
  persistRetryMetadataFromInvoice,
  clearGraceOnPaid,
  nextAttemptDateFromInvoice
} = require('./splitPaymentGraceService');
const { openManualReviewItem } = require('./ops/ingestion/manualReviewService');
const {
  recordPaidBookingResolutionIssueSafe,
  PAID_BOOKING_FINALIZATION_STAGES,
  safeErrorSummary
} = require('./payments/paidBookingFinalizationObservability');

const SPLIT_INVOICE_EVENT_TYPES = new Set([
  'invoice.finalized',
  'invoice.updated',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.payment_action_required',
  'invoice.finalization_failed',
  'invoice.voided',
  'invoice.marked_uncollectible'
]);

function isSplitInstallmentInvoiceEvent(event) {
  if (!event || !SPLIT_INVOICE_EVENT_TYPES.has(String(event.type || ''))) return false;
  const obj = event.data?.object || {};
  if (obj.object !== 'invoice') return false;
  const meta = obj.metadata || {};
  return (
    meta.purpose === 'split_installment_collection' ||
    Boolean(meta.installmentSequence) ||
    Boolean(meta.bookingId)
  );
}

function invoiceProviderReference(invoiceId) {
  return `invoice:${String(invoiceId)}`;
}

async function findInstallmentForInvoice(invoice, BookingInstallmentModel = BookingInstallment) {
  const invoiceId = invoice?.id ? String(invoice.id) : null;
  if (invoiceId) {
    const byId = await BookingInstallmentModel.findOne({ stripeInvoiceId: invoiceId });
    if (byId) return byId;
  }
  const meta = invoice?.metadata || {};
  if (meta.installmentId) {
    const byMeta = await BookingInstallmentModel.findById(String(meta.installmentId));
    if (byMeta) return byMeta;
  }
  if (meta.bookingId && meta.installmentSequence) {
    return BookingInstallmentModel.findOne({
      bookingId: String(meta.bookingId),
      sequence: Number(meta.installmentSequence)
    });
  }
  return null;
}

function assertInvoiceMatchesInstallment(invoice, installment, booking) {
  const mismatches = [];
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
  const expectedAmount = Math.trunc(Number(installment.amountCents));
  const paidOrDue = Math.trunc(
    Number(
      invoice.amount_paid != null && Number(invoice.amount_paid) > 0
        ? invoice.amount_paid
        : invoice.amount_due != null
          ? invoice.amount_due
          : invoice.total
    )
  );
  if (!Number.isFinite(paidOrDue) || paidOrDue !== expectedAmount) {
    mismatches.push({
      field: 'amount',
      actual: paidOrDue,
      expected: expectedAmount
    });
  }
  const expectedCurrency = String(installment.currency || 'EUR').toLowerCase();
  if (String(invoice.currency || '').toLowerCase() !== expectedCurrency) {
    mismatches.push({ field: 'currency' });
  }
  const invCustomer =
    typeof invoice.customer === 'object' && invoice.customer?.id
      ? String(invoice.customer.id)
      : invoice.customer
        ? String(invoice.customer)
        : null;
  if (!invCustomer || invCustomer !== String(booking.stripeCustomerId || '')) {
    mismatches.push({ field: 'customer' });
  }
  return mismatches;
}

/**
 * Ledger upsert distinguishes invoice obligation settlement from verified card PI.
 * Never fabricates a PaymentIntent id.
 */
async function upsertInvoicePaymentRecord({
  invoice,
  booking,
  installment,
  event,
  status,
  provenance = null
}) {
  const providerReference = invoiceProviderReference(invoice.id);
  const amountEuros = Math.trunc(Number(installment.amountCents)) / 100;
  const currency = String(invoice.currency || installment.currency || 'eur').toLowerCase();

  const provenanceMeta = {
    type: 'split_installment_invoice',
    invoiceId: String(invoice.id),
    bookingId: String(booking._id),
    installmentSequence: installment.sequence,
    installmentId: String(installment._id),
    settlementKind: provenance?.settlementKind || null,
    invoicePaymentId: provenance?.invoicePaymentId || null,
    // Only when InvoicePayment → PI → card/customer verified.
    paymentIntentId: provenance?.paymentIntentId || null
  };

  const existing = await Payment.findOne({
    provider: 'stripe',
    providerReference
  });
  if (existing) {
    const patch = {
      status,
      amount: amountEuros,
      currency,
      reservationId: booking._id,
      sourceReference: event?.id || existing.sourceReference,
      metadata: {
        ...(existing.metadata || {}),
        ...provenanceMeta,
        // Preserve a previously verified PI; never overwrite with null on later events.
        paymentIntentId:
          provenance?.paymentIntentId ||
          existing.metadata?.paymentIntentId ||
          null,
        settlementKind:
          provenance?.settlementKind ||
          existing.metadata?.settlementKind ||
          null,
        invoicePaymentId:
          provenance?.invoicePaymentId ||
          existing.metadata?.invoicePaymentId ||
          null
      }
    };
    // Never regress paid → unpaid/failed on out-of-order events.
    if (existing.status === 'paid' && status !== 'paid') {
      return existing;
    }
    await Payment.updateOne({ _id: existing._id }, { $set: patch });
    return Payment.findById(existing._id);
  }
  return Payment.create({
    provider: 'stripe',
    providerReference,
    status,
    amount: amountEuros,
    currency,
    reservationId: booking._id,
    source: 'webhook',
    sourceReference: event?.id || null,
    importedAt: new Date(),
    metadata: provenanceMeta
  });
}

async function handleInvoiceFinalized({ invoice, installment, booking }) {
  await BookingInstallment.updateOne(
    { _id: installment._id },
    {
      $set: {
        stripeInvoiceStatus: invoice.status || 'open',
        hostedInvoiceUrl: invoice.hosted_invoice_url || installment.hostedInvoiceUrl || null,
        status:
          installment.status === 'paid'
            ? 'paid'
            : installment.status === 'voided'
              ? 'voided'
              : 'processing'
      }
    }
  );
  return { outcome: 'finalized' };
}

/**
 * invoice.updated — retry metadata only after strict correlation.
 * Never starts grace. Never regresses paid/voided.
 */
async function handleInvoiceUpdated({ invoice, installment, booking }) {
  if (['paid', 'voided', 'cancelled', 'waived'].includes(String(installment.status))) {
    return { outcome: 'ignored_terminal', status: installment.status, idempotent: true };
  }

  const mismatches = assertInvoiceMatchesInstallment(invoice, installment, booking);
  // For updated, amount_due may flip; require customer/currency/meta; allow amount when status=paid handled elsewhere.
  const hard = mismatches.filter((m) => m.field !== 'amount');
  if (hard.length) {
    return { outcome: 'correlation_failed', mismatches: hard };
  }

  const nextAttempt = nextAttemptDateFromInvoice(invoice);
  const updated = await persistRetryMetadataFromInvoice({
    installment,
    invoice,
    now: new Date()
  });

  // If we already had failure evidence and next attempt appeared, keep failed/recovery state.
  if (
    updated &&
    nextAttempt &&
    ['failed', 'requires_action', 'processing', 'retry_exhausted'].includes(String(updated.status))
  ) {
    if (String(updated.status) === 'retry_exhausted') {
      // persistRetryMetadataFromInvoice already demotes retry_exhausted → failed when next appears
    } else if (String(updated.status) !== 'failed' && installment.lastPaymentFailedAt) {
      await BookingInstallment.updateOne(
        { _id: installment._id, status: { $nin: ['paid', 'voided'] } },
        { $set: { status: 'failed' } }
      );
    }
  }

  return {
    outcome: 'updated',
    nextPaymentAttemptAt: nextAttempt,
    graceStarted: false
  };
}

async function handleInvoicePaid({
  invoice,
  installment,
  booking,
  event,
  stripe = null
}) {
  if (String(installment.status) === 'paid') {
    await recomputeBookingSettlementFromInstallments({ bookingId: booking._id });
    return { outcome: 'already_paid', idempotent: true };
  }

  const mismatches = assertInvoiceMatchesInstallment(invoice, installment, booking);
  if (mismatches.length) {
    await recordPaidBookingResolutionIssueSafe({
      issueType: 'paid_booking_conflict',
      errorCode: 'SPLIT_INVOICE_PAID_MISMATCH',
      errorSummary: safeErrorSummary('invoice.paid does not match installment obligation'),
      paymentIntentId: booking.stripePaymentIntentId || invoiceProviderReference(invoice.id),
      checkoutId: installment.checkoutSessionId || booking.checkoutId || null,
      bookingId: String(booking._id),
      finalizationStage: PAID_BOOKING_FINALIZATION_STAGES.PAYMENT_VERIFIED,
      failureSource: 'stripe_webhook_invoice',
      stripeEventId: event?.id || null,
      extraMetadata: { mismatches, invoiceId: invoice.id }
    });
    throw Object.assign(new Error('invoice.paid mismatch'), {
      code: 'SPLIT_INVOICE_PAID_MISMATCH',
      details: { mismatches }
    });
  }

  const paidAmount = Math.trunc(Number(invoice.amount_paid != null ? invoice.amount_paid : invoice.total));
  if (paidAmount !== Math.trunc(Number(installment.amountCents))) {
    throw Object.assign(new Error('invoice.paid amount does not satisfy installment'), {
      code: 'SPLIT_INVOICE_PAID_AMOUNT_MISMATCH'
    });
  }

  let provenance = {
    settlementKind: 'invoice_settled_other',
    invoicePaymentId: null,
    paymentIntentId: null
  };
  try {
    provenance = await resolveInvoicePaymentProvenance({
      stripe,
      invoice,
      expectedCustomer: booking.stripeCustomerId
    });
  } catch {
    // Settlement can still succeed from invoice.paid correlation; provenance optional.
    provenance = {
      settlementKind: 'invoice_settled_other',
      invoicePaymentId: null,
      paymentIntentId: null
    };
  }

  const installmentSet = {
    status: 'paid',
    paidAt: new Date(),
    stripeInvoiceStatus: invoice.status || 'paid',
    hostedInvoiceUrl: invoice.hosted_invoice_url || installment.hostedInvoiceUrl || null,
    nextPaymentAttemptAt: null,
    lastFailureCode: null,
    lastFailureMessage: null,
    graceEndsAt: null,
    retryExhaustionCandidateObservedAt: null,
    attemptCount: Number(invoice.attempt_count) || installment.attemptCount || 0,
    stripeInvoicePaymentId: provenance.invoicePaymentId || null,
    verifiedSettlementPaymentIntentId: provenance.paymentIntentId || null
  };

  await BookingInstallment.updateOne(
    { _id: installment._id, status: { $ne: 'paid' } },
    { $set: installmentSet }
  );

  await upsertInvoicePaymentRecord({
    invoice,
    booking,
    installment,
    event,
    status: 'paid',
    provenance
  });

  await clearGraceOnPaid({ booking, installment });
  await recomputeBookingSettlementFromInstallments({ bookingId: booking._id });

  try {
    await applyReplacementCardFromPaidInvoice({
      invoice,
      booking,
      stripe
    });
  } catch (pmErr) {
    await openManualReviewItem({
      category: 'split_installment_pm_recovery_failed',
      severity: 'high',
      entityType: 'Booking',
      entityId: String(booking._id),
      title: 'Split invoice paid but replacement PM recovery failed',
      details: pmErr.message || 'PM recovery failed',
      provenance: { source: 'stripe_webhook_invoice', sourceReference: event?.id || null },
      evidence: { invoiceId: invoice.id, error: pmErr.code || null }
    });
  }

  return {
    outcome: 'paid',
    settlementKind: provenance.settlementKind,
    paymentIntentId: provenance.paymentIntentId
  };
}

async function handleInvoicePaymentFailed({ invoice, installment, booking, event }) {
  if (String(installment.status) === 'paid') {
    return { outcome: 'ignored_after_paid', idempotent: true };
  }
  if (['voided', 'cancelled', 'waived'].includes(String(installment.status))) {
    return { outcome: 'ignored_terminal', idempotent: true };
  }

  const nextAttempt = nextAttemptDateFromInvoice(invoice);
  const attemptCount = Number(invoice.attempt_count) || 0;
  const failureCode =
    invoice.last_finalization_error?.code ||
    invoice.charge?.failure_code ||
    'payment_failed';
  const failureMessage =
    invoice.last_finalization_error?.message ||
    invoice.charge?.failure_message ||
    'Invoice payment failed';
  const now = new Date();

  const set = {
    status: 'failed',
    stripeInvoiceStatus: invoice.status || 'open',
    hostedInvoiceUrl: invoice.hosted_invoice_url || installment.hostedInvoiceUrl || null,
    attemptCount,
    nextPaymentAttemptAt: nextAttempt,
    lastFailureCode: String(failureCode).slice(0, 120),
    lastFailureMessage: String(failureMessage).slice(0, 500),
    lastPaymentFailedAt: installment.lastPaymentFailedAt || now
  };

  if (nextAttempt) {
    set.retryExhaustionCandidateObservedAt = null;
  } else if (!installment.retryExhaustionCandidateObservedAt) {
    // Record candidate observation for worker stabilization — do NOT start grace here.
    set.retryExhaustionCandidateObservedAt = now;
  }

  await BookingInstallment.updateOne(
    { _id: installment._id, status: { $nin: ['paid', 'voided', 'cancelled', 'waived'] } },
    { $set: set }
  );

  await upsertInvoicePaymentRecord({
    invoice,
    booking,
    installment,
    event,
    status: 'failed',
    provenance: { settlementKind: null, invoicePaymentId: null, paymentIntentId: null }
  });

  try {
    await sendSplitInstallmentFailureEmail({
      booking,
      installment: await BookingInstallment.findById(installment._id),
      reason: 'payment_failed',
      nextPaymentAttemptAt: nextAttempt,
      hostedInvoiceUrl: set.hostedInvoiceUrl
    });
  } catch {
    /* email best-effort; state already persisted */
  }

  return {
    outcome: 'payment_failed',
    nextPaymentAttemptAt: nextAttempt,
    graceStarted: false
  };
}

async function handleInvoicePaymentActionRequired({ invoice, installment, booking }) {
  if (String(installment.status) === 'paid') {
    return { outcome: 'ignored_after_paid', idempotent: true };
  }
  const hosted = invoice.hosted_invoice_url || installment.hostedInvoiceUrl || null;
  await BookingInstallment.updateOne(
    { _id: installment._id },
    {
      $set: {
        status: 'requires_action',
        stripeInvoiceStatus: invoice.status || 'open',
        hostedInvoiceUrl: hosted,
        attemptCount: Number(invoice.attempt_count) || installment.attemptCount || 0,
        nextPaymentAttemptAt:
          invoice.next_payment_attempt != null
            ? new Date(Number(invoice.next_payment_attempt) * 1000)
            : installment.nextPaymentAttemptAt || null,
        lastFailureCode: 'requires_action'
      }
    }
  );
  try {
    await sendSplitInstallmentFailureEmail({
      booking,
      installment: await BookingInstallment.findById(installment._id),
      reason: 'requires_action',
      nextPaymentAttemptAt: null,
      hostedInvoiceUrl: hosted
    });
  } catch {
    /* best-effort */
  }
  return { outcome: 'requires_action' };
}

async function handleInvoiceFinalizationFailed({ invoice, installment, booking, event }) {
  await BookingInstallment.updateOne(
    { _id: installment._id },
    {
      $set: {
        stripeInvoiceStatus: invoice.status || 'draft',
        lastFailureCode: 'finalization_failed',
        lastFailureMessage: String(
          invoice.last_finalization_error?.message || 'Invoice finalization failed'
        ).slice(0, 500),
        provisioningState: 'failed'
      }
    }
  );
  await openManualReviewItem({
    category: 'split_invoice_finalization_failed',
    severity: 'critical',
    entityType: 'BookingInstallment',
    entityId: String(installment._id),
    title: 'Split installment invoice finalization failed',
    details: 'Stripe invoice.finalization_failed — infrastructure failure, not guest cancellation',
    provenance: { source: 'stripe_webhook_invoice', sourceReference: event?.id || null },
    evidence: {
      bookingId: String(booking._id),
      invoiceId: invoice.id,
      sequence: installment.sequence
    }
  });
  await recordPaidBookingResolutionIssueSafe({
    issueType: 'paid_booking_unknown_failure',
    errorCode: 'SPLIT_INVOICE_FINALIZATION_FAILED',
    errorSummary: safeErrorSummary('invoice.finalization_failed'),
    paymentIntentId: booking.stripePaymentIntentId || invoiceProviderReference(invoice.id),
    checkoutId: installment.checkoutSessionId || booking.checkoutId || null,
    bookingId: String(booking._id),
    finalizationStage: PAID_BOOKING_FINALIZATION_STAGES.UNKNOWN,
    failureSource: 'stripe_webhook_invoice',
    stripeEventId: event?.id || null
  });
  return { outcome: 'finalization_failed' };
}

async function handleInvoiceVoidedOrUncollectible({ invoice, installment, terminalStatus }) {
  if (String(installment.status) === 'paid') {
    return { outcome: 'ignored_after_paid', idempotent: true };
  }
  await BookingInstallment.updateOne(
    { _id: installment._id },
    {
      $set: {
        status: terminalStatus,
        stripeInvoiceStatus: invoice.status || terminalStatus,
        hostedInvoiceUrl: invoice.hosted_invoice_url || installment.hostedInvoiceUrl || null,
        nextPaymentAttemptAt: null,
        graceEndsAt: null,
        retryExhaustionCandidateObservedAt: null
      }
    }
  );
  return { outcome: terminalStatus };
}

async function processSplitInstallmentInvoiceEvent({ event, stripe = null }) {
  if (!isSplitInstallmentInvoiceEvent(event)) {
    return { ok: true, skipped: true, reason: 'not_split_invoice_event' };
  }
  const invoice = event.data.object;
  const installment = await findInstallmentForInvoice(invoice);
  if (!installment) {
    await openManualReviewItem({
      category: 'split_invoice_orphan',
      severity: 'high',
      entityType: 'StripeInvoice',
      entityId: String(invoice.id),
      title: 'Split invoice event with no BookingInstallment',
      details: `Unhandled ${event.type} for invoice ${invoice.id}`,
      provenance: { source: 'stripe_webhook_invoice', sourceReference: event.id },
      evidence: { metadata: invoice.metadata || {} }
    });
    return { ok: false, skipped: false, reason: 'installment_not_found' };
  }
  const booking = await Booking.findById(installment.bookingId);
  if (!booking) {
    return { ok: false, skipped: false, reason: 'booking_not_found' };
  }

  // Persist invoice id if we found via metadata only.
  if (!installment.stripeInvoiceId && invoice.id) {
    await BookingInstallment.updateOne(
      { _id: installment._id, stripeInvoiceId: null },
      { $set: { stripeInvoiceId: String(invoice.id) } }
    );
  }

  let result;
  switch (String(event.type)) {
    case 'invoice.finalized':
      result = await handleInvoiceFinalized({ invoice, installment, booking });
      break;
    case 'invoice.updated':
      result = await handleInvoiceUpdated({ invoice, installment, booking });
      break;
    case 'invoice.paid':
      result = await handleInvoicePaid({ invoice, installment, booking, event, stripe });
      break;
    case 'invoice.payment_failed':
      result = await handleInvoicePaymentFailed({ invoice, installment, booking, event });
      break;
    case 'invoice.payment_action_required':
      result = await handleInvoicePaymentActionRequired({ invoice, installment, booking });
      break;
    case 'invoice.finalization_failed':
      result = await handleInvoiceFinalizationFailed({ invoice, installment, booking, event });
      break;
    case 'invoice.voided':
      result = await handleInvoiceVoidedOrUncollectible({
        invoice,
        installment,
        terminalStatus: 'voided'
      });
      break;
    case 'invoice.marked_uncollectible':
      result = await handleInvoiceVoidedOrUncollectible({
        invoice,
        installment,
        terminalStatus: 'voided'
      });
      break;
    default:
      result = { outcome: 'unhandled' };
  }

  return {
    ok: true,
    skipped: false,
    installmentId: String(installment._id),
    bookingId: String(booking._id),
    ...result
  };
}

module.exports = {
  SPLIT_INVOICE_EVENT_TYPES,
  isSplitInstallmentInvoiceEvent,
  invoiceProviderReference,
  findInstallmentForInvoice,
  assertInvoiceMatchesInstallment,
  processSplitInstallmentInvoiceEvent,
  handleInvoicePaid,
  handleInvoicePaymentFailed,
  handleInvoicePaymentActionRequired,
  handleInvoiceFinalizationFailed,
  handleInvoiceUpdated
};
