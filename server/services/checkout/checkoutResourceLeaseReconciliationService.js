/**
 * B8F3 — Callable expiry reconciliation for durable CheckoutSession resource leases.
 * No scheduler. Callers invoke explicitly (tests / future ops). Never auto-runs.
 *
 * Cancellation is claimed (active → cancel_pending) BEFORE any Stripe cancel.
 * Only a proven cancelled or missing PI may authorize exact resource release.
 */
'use strict';

const CheckoutSession = require('../../models/CheckoutSession');
const {
  RESOURCE_LEASE_ERROR_CODES,
  CheckoutResourceLeaseError,
  resolveClock,
  markResourceLeaseStatus,
  claimLeaseCancellationPending,
  releaseExactResourceLeaseGeneration
} = require('./checkoutResourceLeaseService');

const CANCELLABLE_PI = new Set([
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'requires_capture'
]);

async function tryRetrievePi(stripe, paymentIntentId) {
  if (!stripe?.paymentIntents?.retrieve || !paymentIntentId) {
    return { ok: false, pi: null, ambiguous: false };
  }
  try {
    const pi = await stripe.paymentIntents.retrieve(String(paymentIntentId));
    return { ok: true, pi, ambiguous: false };
  } catch (err) {
    if (err?.code === 'resource_missing' || /No such payment_intent/i.test(err?.message || '')) {
      return { ok: true, pi: null, ambiguous: false };
    }
    return { ok: false, pi: null, ambiguous: true, error: err };
  }
}

async function tryCancelPi(stripe, paymentIntentId, existingPi = null, deps = {}) {
  if (!stripe?.paymentIntents?.cancel || !paymentIntentId) {
    return { attempted: false, cancelled: false, ambiguous: true, status: null };
  }
  let pi = existingPi;
  if (!pi) {
    const retrieved = await tryRetrievePi(stripe, paymentIntentId);
    if (retrieved.ambiguous) {
      return { attempted: false, cancelled: false, ambiguous: true, status: null };
    }
    pi = retrieved.pi;
  }
  if (!pi) {
    return { attempted: false, cancelled: false, ambiguous: false, status: null };
  }
  if (pi.status === 'canceled' || pi.status === 'cancelled') {
    return { attempted: false, cancelled: true, ambiguous: false, status: 'canceled' };
  }
  if (pi.status === 'succeeded' || pi.status === 'processing') {
    return {
      attempted: false,
      cancelled: false,
      ambiguous: false,
      status: pi.status,
      paymentWins: true
    };
  }
  if (!CANCELLABLE_PI.has(pi.status)) {
    return {
      attempted: false,
      cancelled: false,
      ambiguous: true,
      status: pi.status
    };
  }
  if (typeof deps.beforeStripeCancel === 'function') {
    await deps.beforeStripeCancel({ paymentIntentId, pi });
  }
  try {
    await stripe.paymentIntents.cancel(String(paymentIntentId));
    return { attempted: true, cancelled: true, ambiguous: false, status: 'canceled' };
  } catch (err) {
    const again = await tryRetrievePi(stripe, paymentIntentId);
    if (again.pi?.status === 'succeeded' || again.pi?.status === 'processing') {
      return {
        attempted: true,
        cancelled: false,
        ambiguous: false,
        status: again.pi.status,
        paymentWins: true
      };
    }
    if (again.pi?.status === 'canceled' || again.pi?.status === 'cancelled') {
      return {
        attempted: true,
        cancelled: true,
        ambiguous: false,
        status: 'canceled'
      };
    }
    return {
      attempted: true,
      cancelled: false,
      ambiguous: true,
      status: again.pi?.status || pi.status,
      error: err
    };
  }
}

async function markPaidKeepResources({ checkoutId, expectedGeneration }, deps) {
  await markResourceLeaseStatus(
    {
      checkoutId,
      expectedGeneration,
      fromStatuses: ['active', 'cancel_pending', 'expired'],
      toStatus: 'paid'
    },
    deps
  );
}

/**
 * Reconcile a single due lease document (already loaded).
 */
async function reconcileOneResourceLease({ sessionDoc, stripe }, deps = {}) {
  const clock = resolveClock(deps);
  const now = clock();
  const Model = deps.CheckoutSession || CheckoutSession;
  const checkoutId = String(sessionDoc.checkoutId);
  const generation = Number(sessionDoc.resourceLease?.generation);

  const session = await Model.findOne({ checkoutId }).lean();
  if (!session?.resourceLease) {
    return { checkoutId, outcome: 'skipped_no_lease' };
  }
  if (Number(session.resourceLease.generation) !== generation) {
    return {
      checkoutId,
      outcome: 'skipped_stale_generation',
      expectedGeneration: generation,
      liveGeneration: session.resourceLease.generation
    };
  }

  const lease = session.resourceLease;
  if (!['active', 'cancel_pending'].includes(String(lease.status))) {
    return { checkoutId, outcome: 'skipped_status', status: lease.status };
  }

  if (session.paymentStatus === 'paid' || session.status === 'paid') {
    await markPaidKeepResources({ checkoutId, expectedGeneration: generation }, deps);
    return { checkoutId, outcome: 'marked_paid_session' };
  }

  const paymentIntentId =
    lease.paymentIntentId || session.canonicalPaymentIntentId || null;

  let retrieved = { ok: true, pi: null, ambiguous: false };
  if (paymentIntentId) {
    retrieved = await tryRetrievePi(stripe, paymentIntentId);
    if (retrieved.ambiguous) {
      if (lease.status === 'active') {
        try {
          await claimLeaseCancellationPending(
            {
              checkoutId,
              expectedGeneration: generation,
              quoteSnapshotHash: String(lease.quoteSnapshotHash),
              paymentIntentId,
              expectedSessionVersion: session.sessionVersion,
              reason: 'ambiguous_retrieve',
              allowNotDue: false
            },
            deps
          );
        } catch (_claimErr) {
          // Paid/replaced/stale — do not cancel or release.
        }
      }
      return { checkoutId, outcome: 'cancel_pending_ambiguous_retrieve' };
    }

    const pi = retrieved.pi;
    if (pi?.status === 'succeeded') {
      await markPaidKeepResources({ checkoutId, expectedGeneration: generation }, deps);
      return { checkoutId, outcome: 'marked_paid_pi_succeeded' };
    }
    if (pi?.status === 'processing') {
      return { checkoutId, outcome: 'kept_processing' };
    }
  }

  const pi = retrieved.pi;
  const needsCancel =
    Boolean(paymentIntentId) && pi && CANCELLABLE_PI.has(pi.status);
  const alreadyCancelled =
    Boolean(pi) && (pi.status === 'canceled' || pi.status === 'cancelled');
  const missingPi = Boolean(paymentIntentId) && !pi;
  const noPi = !paymentIntentId;

  if (pi && !needsCancel && !alreadyCancelled && !missingPi && !noPi) {
    if (lease.status === 'active') {
      try {
        await claimLeaseCancellationPending(
          {
            checkoutId,
            expectedGeneration: generation,
            quoteSnapshotHash: String(lease.quoteSnapshotHash),
            paymentIntentId,
            expectedSessionVersion: session.sessionVersion,
            reason: `unhandled_pi_status:${pi.status}`,
            allowNotDue: false
          },
          deps
        );
      } catch (_e) {
        void _e;
      }
    }
    return { checkoutId, outcome: 'cancel_pending_unhandled_status', status: pi.status };
  }

  // Claim cancellation BEFORE Stripe cancel (or before no-PI release).
  if (lease.status === 'active') {
    try {
      await claimLeaseCancellationPending(
        {
          checkoutId,
          expectedGeneration: generation,
          quoteSnapshotHash: String(lease.quoteSnapshotHash),
          paymentIntentId,
          expectedSessionVersion: session.sessionVersion,
          reason: 'resource_lease_expiry_reconcile',
          allowNotDue: false
        },
        deps
      );
    } catch (claimErr) {
      if (claimErr?.code === RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_MISMATCH) {
        const latest = await Model.findOne({ checkoutId }).lean();
        if (Number(latest?.resourceLease?.generation) !== generation) {
          return {
            checkoutId,
            outcome: 'skipped_stale_generation',
            expectedGeneration: generation,
            liveGeneration: latest?.resourceLease?.generation
          };
        }
        if (latest?.paymentStatus === 'paid' || latest?.status === 'paid') {
          await markPaidKeepResources({ checkoutId, expectedGeneration: generation }, deps);
          return { checkoutId, outcome: 'marked_paid_session' };
        }
        return { checkoutId, outcome: 'cancel_claim_failed', error: claimErr };
      }
      throw claimErr;
    }
  }

  if (needsCancel) {
    const cancel = await tryCancelPi(stripe, paymentIntentId, pi, deps);
    if (cancel.paymentWins) {
      await markPaidKeepResources({ checkoutId, expectedGeneration: generation }, deps);
      return { checkoutId, outcome: 'marked_paid_during_cancel' };
    }
    if (cancel.ambiguous || (cancel.attempted && !cancel.cancelled)) {
      return { checkoutId, outcome: 'cancel_pending' };
    }
  }

  // Authoritative PI state immediately before resource release.
  if (paymentIntentId) {
    const preRelease = await tryRetrievePi(stripe, paymentIntentId);
    if (preRelease.ambiguous) {
      return { checkoutId, outcome: 'cancel_pending' };
    }
    const live = await Model.findOne({ checkoutId }).lean();
    if (live?.paymentStatus === 'paid' || live?.status === 'paid') {
      await markPaidKeepResources({ checkoutId, expectedGeneration: generation }, deps);
      return { checkoutId, outcome: 'marked_paid_session' };
    }
    const prePi = preRelease.pi;
    if (prePi?.status === 'succeeded' || prePi?.status === 'processing') {
      await markPaidKeepResources({ checkoutId, expectedGeneration: generation }, deps);
      return {
        checkoutId,
        outcome:
          prePi.status === 'succeeded' ? 'marked_paid_during_cancel' : 'kept_processing_after_cancel'
      };
    }
    if (prePi && prePi.status !== 'canceled' && prePi.status !== 'cancelled') {
      return { checkoutId, outcome: 'cancel_pending' };
    }
  }

  try {
    await releaseExactResourceLeaseGeneration(
      { checkoutId, expectedGeneration: generation, reason: 'resource_lease_expiry_reconcile' },
      deps
    );
    return { checkoutId, outcome: 'released' };
  } catch (err) {
    if (err?.code === RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_RELEASE_INCOMPLETE) {
      return { checkoutId, outcome: 'needs_review', error: err };
    }
    if (err?.code === RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_MISMATCH) {
      return { checkoutId, outcome: 'skipped_stale_generation', error: err };
    }
    throw err;
  }
}

/**
 * Scan due leases using indexed status + validUntil.
 */
async function reconcileDueResourceLeases(input = {}, deps = {}) {
  const clock = resolveClock(deps);
  const now = clock();
  const Model = deps.CheckoutSession || CheckoutSession;
  const limit = Number.isInteger(input.limit) && input.limit > 0 ? input.limit : 50;
  const stripe = input.stripe || deps.stripe || null;

  const due = await Model.find({
    'resourceLease.status': { $in: ['active', 'cancel_pending'] },
    'resourceLease.validUntil': { $lte: now }
  })
    .sort({ 'resourceLease.validUntil': 1 })
    .limit(limit)
    .lean();

  const results = [];
  for (const doc of due) {
    // eslint-disable-next-line no-await-in-loop
    const result = await reconcileOneResourceLease({ sessionDoc: doc, stripe }, { ...deps });
    results.push(result);
  }
  return { ok: true, scanned: due.length, results, now };
}

module.exports = {
  reconcileDueResourceLeases,
  reconcileOneResourceLease,
  tryRetrievePi,
  tryCancelPi,
  CheckoutResourceLeaseError,
  RESOURCE_LEASE_ERROR_CODES
};
