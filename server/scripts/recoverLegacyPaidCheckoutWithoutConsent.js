#!/usr/bin/env node
'use strict';

require('dotenv').config();
const crypto = require('crypto');
const mongoose = require('mongoose');
const Stripe = require('stripe');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const { STRIPE_API_VERSION } = require('../config/stripeApiVersion');
const Booking = require('../models/Booking');
const CheckoutFinalizationJob = require('../models/CheckoutFinalizationJob');
const CheckoutSession = require('../models/CheckoutSession');
const Payment = require('../models/Payment');
const AssignmentEngine = require('../services/assignmentEngine');
const { hashQuoteSnapshot } = require('../services/checkout/checkoutSessionSnapshot');
const {
  LEGACY_PAID_RECOVERY_CUTOFF,
  LEGACY_PAID_RECOVERY_FIX_COMMIT,
  LEGAL_CONSENT_EVIDENCE_MISSING,
  getAuthorizedLegacyPaidRecovery,
  isCompleteGuestIdentity,
  normalizeEmail
} = require('../services/checkout/legacyPaidCheckoutRecoveryEvidence');
const {
  reconcilePaidCheckoutSubject,
  isReconcileEnqueueEnabled
} = require('../services/checkout/reconcilePaidCheckoutFinalization');

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const index = arg.indexOf('=');
    return index > 0 ? [arg.slice(0, index), arg.slice(index + 1)] : [arg, true];
  })
);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function normalizeDateOnly(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function guestIdentityFromCharge(charge, expectedEmail) {
  const billing = charge?.billing_details || {};
  const nameParts = String(billing.name || '').trim().split(/\s+/).filter(Boolean);
  const guestInfo = {
    firstName: nameParts.shift() || '',
    lastName: nameParts.join(' '),
    email: normalizeEmail(billing.email),
    phone: String(billing.phone || '').trim()
  };
  if (
    guestInfo.email !== normalizeEmail(expectedEmail) ||
    !isCompleteGuestIdentity(guestInfo)
  ) {
    fail(
      'GUEST_IDENTITY_EVIDENCE_INCOMPLETE',
      'Captured Stripe billing details do not authoritatively match the checkout guest'
    );
  }
  return guestInfo;
}

async function loadVerifiedEvidence({ checkoutId, paymentIntentId, stripe }) {
  const session = await CheckoutSession.findOne({ checkoutId }).lean();
  if (!session || session.flowVersion !== 'v2') {
    fail('CHECKOUT_NOT_FOUND', 'Canonical V2 CheckoutSession was not found');
  }
  if (
    session.paymentStatus === 'paid' ||
    session.finalizeStatus !== 'open' ||
    session.finalizeIntent ||
    session.finalizeIntentHash ||
    session.resourceLease ||
    !session.createdAt ||
    new Date(session.createdAt) >= LEGACY_PAID_RECOVERY_CUTOFF ||
    String(session.canonicalPaymentIntentId || '') !== paymentIntentId ||
    (session.supersededPaymentIntentIds || []).length > 0
  ) {
    fail('CHECKOUT_NOT_LEGACY_ELIGIBLE', 'CheckoutSession is not an eligible pre-fix paid orphan');
  }

  const snapshot = session.quoteSnapshot || {};
  const snapshotHash = String(session.quoteSnapshotHash || '');
  const checkIn = normalizeDateOnly(snapshot.checkInDateOnly || snapshot.checkInISO);
  const checkOut = normalizeDateOnly(snapshot.checkOutDateOnly || snapshot.checkOutISO);
  const expectedCents = Number(snapshot.totalValueCents);
  if (
    !snapshotHash ||
    hashQuoteSnapshot(snapshot) !== snapshotHash ||
    !checkIn ||
    !checkOut ||
    checkOut <= checkIn ||
    (!snapshot.cabinTypeId && !snapshot.cabinId) ||
    !Number.isInteger(expectedCents) ||
    expectedCents <= 0 ||
    Number(session.stripeAmountCents) !== expectedCents
  ) {
    fail('QUOTE_EVIDENCE_INVALID', 'Immutable quote evidence is missing or inconsistent');
  }

  const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ['latest_charge']
  });
  if (
    pi.status !== 'succeeded' ||
    Number(pi.created) * 1000 >= LEGACY_PAID_RECOVERY_CUTOFF.getTime() ||
    Number(pi.amount) !== expectedCents ||
    Number(pi.amount_received) !== expectedCents ||
    String(pi.currency || '').toLowerCase() !==
      String(snapshot.currency || 'eur').toLowerCase() ||
    pi.metadata?.checkoutId !== checkoutId ||
    pi.metadata?.quoteSnapshotHash !== snapshotHash ||
    pi.metadata?.finalizeIntentHash
  ) {
    fail('STRIPE_PAYMENT_EVIDENCE_INVALID', 'Succeeded Stripe payment does not match pre-fix quote');
  }

  const charge =
    typeof pi.latest_charge === 'object'
      ? pi.latest_charge
      : pi.latest_charge
        ? await stripe.charges.retrieve(String(pi.latest_charge))
        : null;
  if (
    !charge ||
    charge.paid !== true ||
    charge.captured !== true ||
    Number(charge.amount) !== expectedCents ||
    Number(charge.amount_refunded || 0) !== 0 ||
    charge.refunded === true
  ) {
    fail('STRIPE_CHARGE_EVIDENCE_INVALID', 'Existing charge is not a captured, unrefunded exact payment');
  }

  const payments = await Payment.find({
    provider: 'stripe',
    providerReference: paymentIntentId
  }).lean();
  if (
    payments.length !== 1 ||
    payments[0].status !== 'paid' ||
    payments[0].reservationId ||
    Math.round(Number(payments[0].amount) * 100) !== expectedCents ||
    String(payments[0].currency || '').toLowerCase() !==
      String(pi.currency || '').toLowerCase()
  ) {
    fail('PAYMENT_LEDGER_EVIDENCE_INVALID', 'Exactly one matching paid, unlinked Payment is required');
  }

  const [bookings, overlappingGuestBookings, jobs] = await Promise.all([
    Booking.find({
      $or: [
        { checkoutId },
        { stripePaymentIntentId: paymentIntentId },
        ...(session.bookingId ? [{ _id: session.bookingId }] : [])
      ]
    }).select('_id').lean(),
    Booking.find({
      cabinTypeId: snapshot.cabinTypeId,
      checkIn: { $lt: new Date(`${checkOut}T00:00:00.000Z`) },
      checkOut: { $gt: new Date(`${checkIn}T00:00:00.000Z`) },
      'guestInfo.email': normalizeEmail(session.guestEmail),
      status: { $nin: ['cancelled'] }
    }).select('_id').lean(),
    CheckoutFinalizationJob.find({ checkoutId }).select('_id').lean()
  ]);
  if (bookings.length || overlappingGuestBookings.length || jobs.length) {
    fail('RECOVERY_HAS_EXISTING_RECORDS', 'Booking or finalization job already exists');
  }

  const guestIdentitySnapshot = guestIdentityFromCharge(charge, session.guestEmail);
  const availability = snapshot.cabinTypeId
    ? await AssignmentEngine.getAvailabilitySummary(
        snapshot.cabinTypeId,
        new Date(`${checkIn}T00:00:00.000Z`),
        new Date(`${checkOut}T00:00:00.000Z`)
      )
    : null;
  if (snapshot.cabinTypeId && !availability?.availableUnits?.length) {
    fail('INVENTORY_UNAVAILABLE', 'No active unit is currently available for the paid stay');
  }

  return {
    session,
    pi,
    charge,
    payment: payments[0],
    snapshotHash,
    expectedCents,
    checkIn,
    checkOut,
    guestIdentitySnapshot,
    availability
  };
}

async function persistRecoveryEvidence(evidence, { operatorActorId, execute }) {
  const { session, pi, charge, guestIdentitySnapshot, snapshotHash } = evidence;
  const existing = session.legacyPaidRecovery;
  if (existing) {
    if (
      existing.status !== 'approved' ||
      existing.checkoutId !== session.checkoutId ||
      existing.paymentIntentId !== pi.id ||
      existing.quoteSnapshotHash !== snapshotHash ||
      JSON.stringify(existing.guestIdentitySnapshot) !==
        JSON.stringify(guestIdentitySnapshot)
    ) {
      fail('RECOVERY_EVIDENCE_CONFLICT', 'Existing legacy recovery evidence conflicts');
    }
    return { persisted: false, idempotentReplay: true, recovery: existing };
  }

  const recovery = {
    status: 'approved',
    legalConsentEvidenceStatus: LEGAL_CONSENT_EVIDENCE_MISSING,
    provenance: 'paid_checkout_incident_recovery',
    reason: 'pre_fix_checkout_allowed_payment_before_finalize_intent',
    checkoutId: session.checkoutId,
    paymentIntentId: pi.id,
    quoteSnapshotHash: snapshotHash,
    recoveryExecutionId: crypto.randomUUID(),
    operatorActorId,
    approvedAt: new Date(),
    defectFixCommit: LEGACY_PAID_RECOVERY_FIX_COMMIT,
    guestIdentityEvidenceSource: 'stripe_charge_billing_details',
    stripeChargeId: String(charge.id),
    paymentIntentCreatedAt: Number(pi.created),
    guestIdentitySnapshot
  };

  if (!execute) return { persisted: false, idempotentReplay: false, recovery };

  const result = await CheckoutSession.updateOne(
    {
      _id: session._id,
      checkoutId: session.checkoutId,
      canonicalPaymentIntentId: pi.id,
      quoteSnapshotHash: snapshotHash,
      sessionVersion: session.sessionVersion,
      paymentStatus: { $ne: 'paid' },
      finalizeStatus: 'open',
      finalizeIntent: null,
      finalizeIntentHash: null,
      resourceLease: null,
      legacyPaidRecovery: null
    },
    {
      $set: { legacyPaidRecovery: recovery },
      $inc: { sessionVersion: 1 }
    }
  );
  if (result.modifiedCount !== 1) {
    fail('RECOVERY_SESSION_CAS_CONFLICT', 'CheckoutSession changed before recovery evidence persisted');
  }
  return { persisted: true, idempotentReplay: false, recovery };
}

async function main() {
  const checkoutId = String(args['--checkoutId'] || '');
  const paymentIntentId = String(args['--paymentIntentId'] || '');
  const execute = args['--execute'] === true;
  const operatorActorId = String(args['--operator'] || '');
  if (!checkoutId || !paymentIntentId) {
    fail(
      'EXPLICIT_SESSION_REQUIRED',
      'Usage: node scripts/recoverLegacyPaidCheckoutWithoutConsent.js --checkoutId=<id> --paymentIntentId=<pi> [--execute --operator=ops:<actor>]'
    );
  }
  if (execute && process.env.LEGACY_PAID_CHECKOUT_INCIDENT_RECOVERY !== '1') {
    fail('RECOVERY_EXECUTION_GATE_REQUIRED', 'Execution requires LEGACY_PAID_CHECKOUT_INCIDENT_RECOVERY=1');
  }
  if (execute && !/^ops:[A-Za-z0-9._-]{1,64}$/.test(operatorActorId)) {
    fail('OPERATOR_ACTOR_REQUIRED', 'Execution requires --operator=ops:<actor>');
  }
  if (execute && !isReconcileEnqueueEnabled()) {
    fail('RECONCILE_EXECUTION_GATE_REQUIRED', 'Execution requires FINALIZE_RECONCILE_ENQUEUE=1');
  }

  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI);
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: STRIPE_API_VERSION
    });
    const existingSession = await CheckoutSession.findOne({ checkoutId }).lean();
    const approvedRecovery = getAuthorizedLegacyPaidRecovery(
      existingSession,
      paymentIntentId
    );
    if (approvedRecovery) {
      let reconciliation = null;
      if (execute) {
        reconciliation = await reconcilePaidCheckoutSubject({
          checkoutId,
          paymentIntentId,
          execute: true,
          mutationFlag: 'enqueue',
          stripe
        });
      }
      console.log(JSON.stringify({
        ok: true,
        execute,
        checkoutId,
        paymentIntentId,
        idempotentReplay: true,
        legalConsentEvidenceStatus: LEGAL_CONSENT_EVIDENCE_MISSING,
        consentFabricated: false,
        reconciliation: reconciliation
          ? {
              classification: reconciliation.classification,
              repairAction: reconciliation.repairAction,
              mutated: reconciliation.repair?.mutated === true,
              refundAttempted: false,
              paymentIntentCreateAttempted: false
            }
          : null
      }, null, 2));
      return;
    }

    const evidence = await loadVerifiedEvidence({ checkoutId, paymentIntentId, stripe });
    const allowlistedPis = await stripe.paymentIntents.search({
      query: `metadata['checkoutId']:'${checkoutId}'`,
      limit: 100
    });
    const matchingPis = (allowlistedPis.data || []).filter(
      (pi) => pi.metadata?.checkoutId === checkoutId
    );
    if (
      allowlistedPis.has_more ||
      matchingPis.length !== 1 ||
      matchingPis[0].id !== paymentIntentId
    ) {
      fail('PAYMENT_INTENT_CARDINALITY_MISMATCH', 'Checkout must have exactly one Stripe PaymentIntent');
    }

    const marker = await persistRecoveryEvidence(evidence, {
      operatorActorId: operatorActorId || 'ops:dry-run',
      execute
    });
    let reconciliation = null;
    if (execute) {
      reconciliation = await reconcilePaidCheckoutSubject({
        checkoutId,
        paymentIntentId,
        execute: true,
        mutationFlag: 'enqueue',
        stripe
      });
      if (
        reconciliation.classification !== 'SESSION_NOT_MARKED_PAID' ||
        reconciliation.repair?.mutated !== true
      ) {
        fail(
          'RECONCILE_DID_NOT_MARK_PAID',
          'Existing exact-session reconciliation did not mark paid and ensure its job'
        );
      }
    }

    console.log(JSON.stringify({
      ok: true,
      execute,
      checkoutId,
      paymentIntentId,
      paymentIntentCount: matchingPis.length,
      paymentStatus: evidence.payment.status,
      amountCents: evidence.expectedCents,
      quoteSnapshotHash: evidence.snapshotHash,
      quoteSnapshotValid: true,
      existingChargeCaptured: evidence.charge.captured === true,
      refundedAmountCents: Number(evidence.charge.amount_refunded || 0),
      guestIdentitySource: 'stripe_charge_billing_details',
      legalConsentEvidenceStatus: LEGAL_CONSENT_EVIDENCE_MISSING,
      consentFabricated: false,
      inventoryAvailableUnits: evidence.availability?.availableUnits?.map((unit) => unit.unitNumber) || [],
      markerPersisted: marker.persisted,
      markerIdempotentReplay: marker.idempotentReplay,
      reconciliation: reconciliation
        ? {
            classification: reconciliation.classification,
            repairAction: reconciliation.repairAction,
            mutated: reconciliation.repair?.mutated === true,
            jobId: reconciliation.repair?.details?.job?.jobId || null,
            refundAttempted: false,
            paymentIntentCreateAttempted: false
          }
        : null
    }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    code: err.code || 'RECOVERY_FAILED',
    error: err.message || String(err),
    refundAttempted: false,
    paymentIntentCreateAttempted: false
  }));
  process.exit(1);
});
