/**
 * SP7 — deterministic split-booking cancellation settlement.
 * Allocates per paid installment: stay_credit | standard_policy | forfeit.
 * Voids unpaid future installments and neutralizes Stripe invoices.
 * Payment-failure path remains cancellationReview-only (unchanged).
 */
'use strict';

const Stripe = require('stripe');
const { STRIPE_API_VERSION } = require('../config/stripeApiVersion');
const Booking = require('../models/Booking');
const BookingInstallment = require('../models/BookingInstallment');
const {
  calculateCancellationOutcome
} = require('./cancellationPolicyService');
const {
  issueStayCreditForPaidInstallment
} = require('./stayCreditService');
const {
  recomputeBookingSettlementFromInstallments
} = require('./bookingInstallmentSettlementService');

class SplitCancellationSettlementError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'SplitCancellationSettlementError';
    this.code = code;
    this.details = details;
  }
}

function getStripe(stripeOverride) {
  if (stripeOverride) return stripeOverride;
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION });
}

function resolveFrozenCancellationPolicy(booking) {
  return (
    booking?.resourceFinalizationSnapshot?.cancellationPolicy ||
    booking?.cancellationPolicySnapshot ||
    booking?.chosenPaymentScheduleSnapshot?.cancellationPolicy ||
    null
  );
}

function eurosToCents(euros) {
  return Math.round(Number(euros) * 100);
}

/**
 * Within-window = frozen policy grants any refund percent > 0 for customer_cancellation.
 */
function isWithinCancellationWindow({ booking, now = new Date() }) {
  const policySnapshot = resolveFrozenCancellationPolicy(booking);
  if (!policySnapshot) {
    return { withinWindow: false, quote: null, reason: 'no_frozen_policy' };
  }
  const paidEuros =
    (Number(booking.stripePaidAmountCents) || 0) / 100 || Number(booking.totalPrice) || 0;
  try {
    const quote = calculateCancellationOutcome({
      policySnapshot,
      arrivalDate: booking.checkIn,
      bookingTimestamp: booking.createdAt || booking.provenance?.confirmedAt || now,
      cancellationTimestamp: now,
      cancellableAmount: paidEuros,
      eventType: 'customer_cancellation'
    });
    return {
      withinWindow: Number(quote.refundPercent) > 0,
      quote,
      reason: quote.decisionReasonCode
    };
  } catch (err) {
    return { withinWindow: false, quote: null, reason: err.code || 'policy_eval_failed' };
  }
}

async function neutralizeStripeInvoice({
  installment,
  stripe,
  BookingInstallmentModel = BookingInstallment
}) {
  const invoiceId = installment.stripeInvoiceId ? String(installment.stripeInvoiceId) : null;
  if (!invoiceId || !stripe?.invoices) {
    return { neutralized: false, reason: 'no_invoice' };
  }

  let invoice;
  try {
    invoice = await stripe.invoices.retrieve(invoiceId);
  } catch (err) {
    return { neutralized: false, reason: 'retrieve_failed', error: err.message };
  }

  const status = String(invoice.status || '');
  if (status === 'paid') {
    return { neutralized: false, reason: 'paid_untouched' };
  }
  if (status === 'void') {
    await BookingInstallmentModel.updateOne(
      { _id: installment._id },
      { $set: { stripeInvoiceStatus: 'void', status: 'voided' } }
    );
    return { neutralized: true, reason: 'already_void', idempotent: true };
  }

  const idemKey = `dd:split-cancel-void:${installment._id}:${invoiceId}`;

  try {
    if (status === 'draft') {
      // Prefer delete for unused drafts; fall back to void if delete unsupported.
      if (typeof stripe.invoices.del === 'function') {
        await stripe.invoices.del(invoiceId, {}, { idempotencyKey: idemKey });
      } else if (typeof stripe.invoices.voidInvoice === 'function') {
        await stripe.invoices.voidInvoice(invoiceId, {}, { idempotencyKey: idemKey });
      } else {
        await stripe.invoices.update(
          invoiceId,
          { auto_advance: false, automatically_finalizes_at: null },
          { idempotencyKey: `${idemKey}:unschedule` }
        );
      }
      await BookingInstallmentModel.updateOne(
        { _id: installment._id },
        {
          $set: {
            stripeInvoiceStatus: 'void',
            status: 'voided',
            automaticallyFinalizesAt: null,
            nextPaymentAttemptAt: null,
            graceEndsAt: null
          }
        }
      );
      return { neutralized: true, reason: 'draft_neutralized' };
    }

    if (status === 'open' || status === 'uncollectible') {
      if (typeof stripe.invoices.voidInvoice === 'function') {
        await stripe.invoices.voidInvoice(invoiceId, {}, { idempotencyKey: idemKey });
      } else {
        throw new SplitCancellationSettlementError(
          'VOID_UNSUPPORTED',
          'Stripe invoice void is required for open unpaid invoices'
        );
      }
      await BookingInstallmentModel.updateOne(
        { _id: installment._id },
        {
          $set: {
            stripeInvoiceStatus: 'void',
            status: 'voided',
            nextPaymentAttemptAt: null,
            graceEndsAt: null
          }
        }
      );
      return { neutralized: true, reason: 'open_voided' };
    }

    return { neutralized: false, reason: `unsupported_status:${status}` };
  } catch (err) {
    // Idempotent converge on already-voided
    try {
      const again = await stripe.invoices.retrieve(invoiceId);
      if (String(again.status) === 'void' || String(again.status) === 'deleted') {
        await BookingInstallmentModel.updateOne(
          { _id: installment._id },
          { $set: { stripeInvoiceStatus: 'void', status: 'voided' } }
        );
        return { neutralized: true, reason: 'converged_void', idempotent: true };
      }
    } catch {
      /* fall through */
    }
    throw err;
  }
}

/**
 * Deterministic settlement for a split booking cancellation.
 */
async function settleSplitBookingCancellation({
  booking,
  reason = null,
  actorId = 'system',
  now = new Date(),
  stripe = null,
  BookingModel = Booking,
  BookingInstallmentModel = BookingInstallment
} = {}) {
  if (!booking?._id) {
    throw new SplitCancellationSettlementError('BOOKING_REQUIRED', 'Booking is required');
  }

  const liveBooking = (await BookingModel.findById(booking._id)) || booking;

  // Idempotent replay if allocation already recorded (cash may still be pending).
  if (
    liveBooking.cancellationSettlement &&
    liveBooking.cancellationSettlement.splitSettlement &&
    liveBooking.cancellationSettlement.splitSettlement.allocatedAt
  ) {
    return {
      idempotentReplay: true,
      cancellationSettlement: liveBooking.cancellationSettlement,
      allocations: liveBooking.cancellationSettlement.splitSettlement.allocations || [],
      stayCredits: []
    };
  }

  booking = liveBooking;

  const installments = await BookingInstallmentModel.find({ bookingId: booking._id }).sort({
    sequence: 1
  });
  if (!installments.length) {
    return { skipped: true, reason: 'no_installments' };
  }

  const window = isWithinCancellationWindow({ booking, now });
  const stripeClient = getStripe(stripe);
  const allocations = [];
  const stayCredits = [];
  let cashRefundCents = 0;
  let stayCreditIssuedCents = 0;
  let retainedCents = 0;

  for (const inst of installments) {
    if (String(inst.status) === 'paid') {
      const treatment = String(inst.cancellationTreatment || 'standard_policy');
      const paidCents = Math.trunc(Number(inst.amountCents));

      if (treatment === 'stay_credit' && window.withinWindow) {
        const issued = await issueStayCreditForPaidInstallment({
          booking,
          installment: inst,
          now
        });
        stayCredits.push(issued.stayCredit);
        stayCreditIssuedCents += paidCents;
        allocations.push({
          installmentId: String(inst._id),
          sequence: inst.sequence,
          treatment,
          paidCents,
          cashRefundCents: 0,
          stayCreditIssuedCents: paidCents,
          retainedCents: 0,
          stayCreditId: String(issued.stayCredit._id),
          stayCreditCode: issued.stayCredit.code
        });
      } else if (treatment === 'stay_credit' && !window.withinWindow) {
        retainedCents += paidCents;
        allocations.push({
          installmentId: String(inst._id),
          sequence: inst.sequence,
          treatment,
          paidCents,
          cashRefundCents: 0,
          stayCreditIssuedCents: 0,
          retainedCents: paidCents,
          reason: 'outside_cancellation_window'
        });
      } else if (treatment === 'forfeit') {
        retainedCents += paidCents;
        allocations.push({
          installmentId: String(inst._id),
          sequence: inst.sequence,
          treatment,
          paidCents,
          cashRefundCents: 0,
          stayCreditIssuedCents: 0,
          retainedCents: paidCents
        });
      } else {
        // standard_policy — cash refund per frozen policy percent of THIS installment
        const policySnapshot = resolveFrozenCancellationPolicy(booking);
        let refundPct = 0;
        if (policySnapshot && window.quote) {
          refundPct = Number(window.quote.refundPercent) || 0;
        } else if (policySnapshot) {
          try {
            const q = calculateCancellationOutcome({
              policySnapshot,
              arrivalDate: booking.checkIn,
              bookingTimestamp: booking.createdAt || now,
              cancellationTimestamp: now,
              cancellableAmount: paidCents / 100,
              eventType: 'customer_cancellation'
            });
            refundPct = Number(q.refundPercent) || 0;
          } catch {
            refundPct = 0;
          }
        }
        const refund = Math.min(paidCents, Math.round((paidCents * refundPct) / 100));
        const retained = paidCents - refund;
        cashRefundCents += refund;
        retainedCents += retained;
        allocations.push({
          installmentId: String(inst._id),
          sequence: inst.sequence,
          treatment: 'standard_policy',
          paidCents,
          cashRefundCents: refund,
          stayCreditIssuedCents: 0,
          retainedCents: retained,
          refundPercent: refundPct
        });
      }
      continue;
    }

    // Unpaid / non-terminal → void + neutralize invoice
    if (!['voided', 'cancelled', 'waived', 'paid'].includes(String(inst.status))) {
      const neut = await neutralizeStripeInvoice({
        installment: inst,
        stripe: stripeClient,
        BookingInstallmentModel
      });
      await BookingInstallmentModel.updateOne(
        { _id: inst._id, status: { $nin: ['paid'] } },
        {
          $set: {
            status: 'voided',
            nextPaymentAttemptAt: null,
            graceEndsAt: null,
            retryExhaustionCandidateObservedAt: null
          }
        }
      );
      allocations.push({
        installmentId: String(inst._id),
        sequence: inst.sequence,
        treatment: inst.cancellationTreatment || null,
        paidCents: 0,
        voided: true,
        invoiceNeutralization: neut
      });
    }
  }

  const paidTotal = allocations
    .filter((a) => a.paidCents > 0)
    .reduce((s, a) => s + a.paidCents, 0);
  const sumCheck = cashRefundCents + stayCreditIssuedCents + retainedCents;
  if (paidTotal > 0 && sumCheck !== paidTotal) {
    throw new SplitCancellationSettlementError(
      'SETTLEMENT_INVARIANT',
      'cashRefund + stayCredit + retained must equal paid cents',
      { cashRefundCents, stayCreditIssuedCents, retainedCents, paidTotal }
    );
  }

  let outcome = 'payment_retained';
  if (cashRefundCents > 0) {
    // Cash follow-up must remain actionable even when StayCredit was also issued.
    outcome = 'cash_refund_pending';
  } else if (stayCreditIssuedCents > 0) {
    outcome = 'credits_issued';
  }

  const cashRefundStatus = cashRefundCents > 0 ? 'pending' : 'not_required';
  const creditIssuanceStatus = stayCreditIssuedCents > 0 ? 'issued' : 'not_required';
  const fullySettled = cashRefundCents === 0;

  const cancellationSettlement = {
    outcome,
    reason: reason ? String(reason).trim() : 'split_deterministic_settlement',
    settlementRecordedAt: now,
    settlementRecordedByActorId: actorId,
    creditAmountCents: stayCreditIssuedCents > 0 ? stayCreditIssuedCents : undefined,
    cashRefundAmountCents: cashRefundCents > 0 ? cashRefundCents : undefined,
    splitSettlement: {
      allocatedAt: now,
      // Final settledAt only when all components complete (no pending cash).
      settledAt: fullySettled ? now : null,
      withinCancellationWindow: window.withinWindow,
      windowReason: window.reason || null,
      cashRefundCents,
      stayCreditIssuedCents,
      retainedCents,
      cashRefundStatus,
      creditIssuanceStatus,
      invoiceNeutralizationStatus: 'completed',
      settlementCompletionStatus: fullySettled ? 'complete' : 'cash_refund_pending',
      allocations,
      stayCreditIds: stayCredits.map((c) => String(c._id))
    }
  };

  await BookingModel.updateOne(
    { _id: booking._id },
    { $set: { cancellationSettlement } }
  );

  // Clear open payment-failure review on authorized cancel (does not release inventory here —
  // inventory release remains the existing cancel transition path).
  await BookingModel.updateOne(
    { _id: booking._id, 'cancellationReview.status': 'open' },
    {
      $set: {
        'cancellationReview.status': 'resolved',
        'cancellationReview.resolvedAt': now,
        'cancellationReview.resolvedNote': 'Resolved by authorized booking cancellation'
      }
    }
  );

  await recomputeBookingSettlementFromInstallments({ bookingId: booking._id });

  return {
    idempotentReplay: false,
    cancellationSettlement,
    allocations,
    stayCredits,
    cashRefundCents,
    stayCreditIssuedCents,
    retainedCents
  };
}

module.exports = {
  SplitCancellationSettlementError,
  resolveFrozenCancellationPolicy,
  isWithinCancellationWindow,
  neutralizeStripeInvoice,
  settleSplitBookingCancellation
};
