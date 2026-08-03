/**
 * Shared helpers for S0 paid-orphan recovery acceptance / proof tests.
 * Synthetic identifiers only. No production IDs.
 */
'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');

const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const Booking = require('../models/Booking');
const CheckoutSession = require('../models/CheckoutSession');
const CheckoutFinalizationJob = require('../models/CheckoutFinalizationJob');
const Payment = require('../models/Payment');
const ManualReviewItem = require('../models/ManualReviewItem');
const EmailDeliveryState = require('../models/EmailDeliveryState');
const SavedBookingQuote = require('../models/SavedBookingQuote');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const AuditEvent = require('../models/AuditEvent');

const {
  INTENT_PHRASE,
  recoverAllowlistedMultiUnitPaidOrphanCheckout,
  dryRunMultiUnitPaidOrphanRecovery,
  __setRecoveryFaultInjectorForTesting,
  __resetRecoveryFaultInjectorForTesting
} = require('../services/checkout/multiUnitPaidOrphanRecoveryService');
const {
  __setReviewFaultInjectorForTesting,
  __resetReviewFaultInjectorForTesting
} = require('../services/checkout/multiUnitPaidOrphanRecoveryReviewService');
const { hashQuoteSnapshot } = require('../services/checkout/checkoutSessionSnapshot');
const {
  buildValidatedFinalizeIntent,
  hashFinalizeIntent
} = require('../services/checkout/finalizeIntentService');
const { buildStayFingerprint } = require('../services/checkout/checkoutSessionFingerprints');
const { formatSofiaDateOnly, normalizeDateToSofiaDayStart } = require('../utils/dateTime');
const {
  LEGAL_ACCEPTANCE_TERMS_VERSION,
  LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
  LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
} = require('../config/legalAcceptance');
const {
  __setSendOpsPushSafelyForTesting,
  __resetSendOpsPushSafelyForTesting
} = require('../services/ops/push/opsPushEventNotifications');
const bookingConfirmationDeliveryService = require('../services/email/bookingConfirmationDeliveryService');
const checkoutFinalizeSideEffects = require('../services/checkout/checkoutFinalizeSideEffects');

const GUEST_EMAIL = 'guest-acc-orphan-proof@example.com';
const FAULT_CODE = 'RECOVERY_FAULT_INJECTED';

function fakeObjectId(seed) {
  const hex = crypto.createHash('md5').update(String(seed)).digest('hex').slice(0, 24);
  return new mongoose.Types.ObjectId(hex);
}

function buildValidIntentOverlay(overrides = {}) {
  return {
    confirmationPhrase: INTENT_PHRASE,
    operatorActorId: 'ops:test-operator',
    operatorIntentConfirmedAt: new Date().toISOString(),
    recoveryReason: 'Synthetic acceptance proof: guest confirmed second physical unit purchase',
    ...overrides
  };
}

function enableOrdinarySideEffectFlags() {
  process.env.MULTI_UNIT_PAID_ORPHAN_RECOVERY = '1';
  process.env.MULTI_UNIT_CAPACITY_STAY_GUARD = '0';
  process.env.FINALIZE_SIDE_EFFECTS = '1';
  process.env.FINALIZE_DOMAIN_SERVICE = '1';
  process.env.FINALIZE_JOB_EXECUTE = '1';
  process.env.FINALIZE_WORKER_SEND_CONFIRMATION = '1';
  process.env.BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED = '0';
}

function createSideEffectSpies() {
  const counts = {
    opsPush: 0,
    smtpSend: 0,
    processBookingConfirmationDelivery: 0,
    enqueuePostFinalizeSideEffects: 0,
    stripeCreate: 0,
    stripeCharge: 0,
    stripeRefund: 0
  };

  __setSendOpsPushSafelyForTesting(async () => {
    counts.opsPush += 1;
    return { ok: true, skipped: true };
  });

  const originalProcess = bookingConfirmationDeliveryService.processBookingConfirmationDelivery;
  bookingConfirmationDeliveryService.processBookingConfirmationDelivery = async (...args) => {
    counts.processBookingConfirmationDelivery += 1;
    return originalProcess(...args);
  };

  const originalEnqueue = checkoutFinalizeSideEffects.enqueuePostFinalizeSideEffects;
  checkoutFinalizeSideEffects.enqueuePostFinalizeSideEffects = async (...args) => {
    counts.enqueuePostFinalizeSideEffects += 1;
    return originalEnqueue(...args);
  };

  function reset() {
    __resetSendOpsPushSafelyForTesting();
    bookingConfirmationDeliveryService.processBookingConfirmationDelivery = originalProcess;
    checkoutFinalizeSideEffects.enqueuePostFinalizeSideEffects = originalEnqueue;
  }

  return { counts, reset };
}

function createInstrumentedStripeStub(paymentIntentId, piBase) {
  const counts = {
    retrieve: 0,
    create: 0,
    update: 0,
    refundsCreate: 0,
    chargesCreate: 0
  };
  const pi = {
    id: paymentIntentId,
    object: 'payment_intent',
    status: 'succeeded',
    amount: piBase.amount,
    amount_received: piBase.amount,
    currency: 'eur',
    metadata: { ...(piBase.metadata || {}) }
  };
  const client = {
    paymentIntents: {
      retrieve: async (id) => {
        counts.retrieve += 1;
        if (String(id) !== String(paymentIntentId)) {
          const err = new Error('No such payment_intent');
          err.code = 'resource_missing';
          throw err;
        }
        return { ...pi, metadata: { ...pi.metadata } };
      },
      create: async () => {
        counts.create += 1;
        throw new Error('stripe.paymentIntents.create must not be called during S0 recovery');
      },
      update: async (id, patch) => {
        counts.update += 1;
        pi.metadata = { ...pi.metadata, ...(patch?.metadata || {}) };
        return { ...pi };
      }
    },
    refunds: {
      create: async () => {
        counts.refundsCreate += 1;
        throw new Error('stripe.refunds.create must not be called during S0 recovery');
      }
    },
    charges: {
      create: async () => {
        counts.chargesCreate += 1;
        throw new Error('stripe.charges.create must not be called during S0 recovery');
      }
    }
  };
  return { client, counts, pi };
}

class RecoveryFaultInjectedError extends Error {
  constructor(boundary) {
    super(`Injected recovery fault after boundary: ${boundary}`);
    this.name = 'RecoveryFaultInjectedError';
    this.code = FAULT_CODE;
    this.boundary = boundary;
  }
}

function installFaultInjector(boundary) {
  const thrower = async (hit) => {
    if (String(hit) === String(boundary)) {
      throw new RecoveryFaultInjectedError(boundary);
    }
  };
  __setRecoveryFaultInjectorForTesting(thrower);
  __setReviewFaultInjectorForTesting(thrower);
  return () => {
    __resetRecoveryFaultInjectorForTesting();
    __resetReviewFaultInjectorForTesting();
  };
}

function clearFaultInjectors() {
  __resetRecoveryFaultInjectorForTesting();
  __resetReviewFaultInjectorForTesting();
}

/**
 * Seed a complete synthetic paid-orphan incident suitable for real execute.
 */
async function seedExecutablePaidOrphanIncident(overrides = {}) {
  const rawSuffix = overrides.suffix || `${Date.now()}${crypto.randomBytes(3).toString('hex')}`;
  const suffix = String(rawSuffix)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  const guestEmail = overrides.guestEmail || GUEST_EMAIL;
  const checkInDateOnly = overrides.checkInDateOnly || '2031-07-10';
  const checkOutDateOnly = overrides.checkOutDateOnly || '2031-07-12';
  const checkIn = normalizeDateToSofiaDayStart(checkInDateOnly);
  const checkOut = normalizeDateToSofiaDayStart(checkOutDateOnly);
  const amountCents = overrides.amountCents || 40000;

  const cabinType = await CabinType.create({
    name: `A-Frame Acc ${suffix}`,
    slug: `a-frame-acc-${suffix}`,
    description: 'Synthetic multi-unit cabin type for acceptance proof',
    capacity: 2,
    minGuests: 1,
    pricePerNight: 200,
    minNights: 1,
    imageUrl: '/uploads/cabins/aframe-acc.jpg',
    location: 'The Valley',
    propertyKind: 'valley',
    isActive: true,
    transportOptions: []
  });

  const parentCabin = await Cabin.create({
    name: `A-Frame Parent Acc ${suffix}`,
    description: 'Parent cabin for multi inventory',
    capacity: 2,
    pricePerNight: 200,
    minNights: 1,
    imageUrl: '/uploads/cabins/aframe-acc.jpg',
    location: 'The Valley',
    propertyKind: 'valley',
    inventoryType: 'multi',
    cabinTypeRef: cabinType._id,
    isActive: true,
    transportOptions: []
  });

  const unitA = await Unit.create({
    cabinTypeId: cabinType._id,
    unitNumber: 'AF-A',
    displayName: 'A-Frame A',
    isActive: true
  });
  const unitB = await Unit.create({
    cabinTypeId: cabinType._id,
    unitNumber: 'AF-B',
    displayName: 'A-Frame B',
    isActive: true
  });

  const stayFingerprint = buildStayFingerprint({
    guestEmail,
    entityType: 'cabinType',
    cabinTypeId: String(cabinType._id),
    checkInDateOnly,
    checkOutDateOnly
  });

  const firstBooking = await Booking.create({
    cabinTypeId: cabinType._id,
    unitId: unitA._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    status: 'confirmed',
    totalPrice: amountCents / 100,
    subtotalPrice: amountCents / 100,
    discountAmount: 0,
    totalValueCents: amountCents,
    guestInfo: {
      firstName: 'Proof',
      lastName: 'Guest',
      email: guestEmail,
      phone: '+359800000999'
    },
    commercialStayFingerprint: stayFingerprint,
    paymentMethod: 'stripe',
    legalAcceptance: {
      termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
      activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
      acceptedAt: new Date(),
      firstName: 'Proof',
      lastName: 'Guest',
      checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
      checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
    }
  });

  const checkoutId = overrides.checkoutId || `chk_test_orphan_proof_${suffix}`;
  const paymentIntentId = overrides.paymentIntentId || `pi_test_orphan_proof_${suffix}`;

  const quoteSnapshot = {
    schemaVersion: 1,
    entityType: 'cabinType',
    cabinId: null,
    cabinTypeId: String(cabinType._id),
    checkInDateOnly,
    checkOutDateOnly,
    checkInISO: checkIn.toISOString(),
    checkOutISO: checkOut.toISOString(),
    checkInDate: checkIn,
    checkOutDate: checkOut,
    adults: 2,
    children: 0,
    experienceKeys: [],
    transportMethod: '',
    romanticSetup: false,
    promoCode: '',
    voucherCode: '',
    promoSnapshot: null,
    appliedPromoCode: '',
    subtotalCents: amountCents,
    discountAmountCents: 0,
    totalValueCents: amountCents,
    voucherAppliedCents: 0,
    stripeAmountCents: amountCents,
    fullVoucherCoverage: false,
    totalCents: amountCents,
    currency: 'eur',
    minNights: 1,
    capacity: 2,
    pricingModel: 'per_night'
  };
  const quoteSnapshotHash = hashQuoteSnapshot(quoteSnapshot);

  const intentBody = {
    guestInfo: {
      firstName: 'Proof',
      lastName: 'Guest',
      email: guestEmail,
      phone: '+359800000999'
    },
    specialRequests: '',
    legalAcceptance: {
      acceptedTermsAndCancellation: true,
      acceptedActivityRisk: true,
      termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
      activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
      checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
      checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT,
      locale: 'en'
    },
    consents: {
      quoteDeliveryRequested: false,
      bookingReminderConsent: false,
      marketingConsent: false
    },
    experienceKeys: [],
    romanticSetup: false
  };
  const finalizeIntent = buildValidatedFinalizeIntent({
    body: intentBody,
    requestMeta: { ip: '127.0.0.1', userAgent: 'acceptance-proof', acceptLanguage: 'en' },
    capturedAt: new Date('2031-01-01T00:00:00.000Z'),
    quoteSnapshot
  });
  const finalizeIntentHash = hashFinalizeIntent(finalizeIntent);

  const session = await CheckoutSession.create({
    checkoutId,
    flowVersion: 'v2',
    status: 'needs_review',
    paymentStatus: 'paid',
    finalizeStatus: 'needs_review',
    guestEmail,
    stayFingerprint,
    replayFingerprint: `replay_${checkoutId}`,
    quoteSnapshot,
    quoteSnapshotHash,
    finalizeIntent,
    finalizeIntentHash,
    finalizeIntentCapturedAt: finalizeIntent.capturedAt,
    stripeAmountCents: amountCents,
    giftVoucherAppliedCents: 0,
    canonicalPaymentIntentId: paymentIntentId,
    sessionVersion: 2,
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000)
  });

  const job = await CheckoutFinalizationJob.create({
    checkoutId,
    paymentIntentId,
    status: 'failed_permanent',
    stage: 'save_booking',
    createdReason: 'webhook',
    lastErrorCode: 'DUPLICATE_STAY_CONFLICT',
    lastErrorSummary: 'Synthetic duplicate stay conflict for acceptance proof',
    lastFailedAt: new Date()
  });

  const payment = await Payment.create({
    provider: 'stripe',
    providerReference: paymentIntentId,
    status: 'paid',
    amount: amountCents / 100,
    currency: 'eur',
    source: 'webhook',
    metadata: { checkoutId }
  });

  const review = await ManualReviewItem.create({
    category: 'payment_unlinked',
    severity: 'critical',
    status: 'open',
    entityType: 'Payment',
    entityId: String(payment._id),
    title: 'Synthetic payment_unlinked for paid-orphan acceptance',
    details: 'Paid orphan checkout awaiting controlled recovery',
    evidence: {
      paymentId: String(payment._id),
      paymentIntentId,
      checkoutId
    }
  });

  const allowlist = {
    checkoutId,
    checkoutSessionId: String(session._id),
    paymentIntentId,
    paymentId: String(payment._id),
    finalizationJobId: String(job._id),
    manualReviewItemId: String(review._id),
    cabinTypeId: String(cabinType._id),
    expectedTargetUnitId: String(unitB._id),
    firstBookingId: String(firstBooking._id),
    expectedFailureCode: 'DUPLICATE_STAY_CONFLICT'
  };

  const stripe = createInstrumentedStripeStub(paymentIntentId, {
    amount: amountCents,
    metadata: {
      flowVersion: 'v2',
      checkoutId,
      quoteSnapshotHash,
      finalizeIntentHash,
      cabinTypeId: String(cabinType._id),
      entityType: 'cabinType',
      checkIn: checkIn.toISOString(),
      checkOut: checkOut.toISOString()
    }
  });

  return {
    allowlist,
    cabinType,
    parentCabin,
    unitA,
    unitB,
    firstBooking,
    session,
    job,
    payment,
    review,
    checkIn,
    checkOut,
    checkInDateOnly,
    checkOutDateOnly,
    guestEmail,
    amountCents,
    quoteSnapshotHash,
    finalizeIntentHash,
    stripe,
    stayFingerprint
  };
}

async function runDryRun(allowlist, now = new Date()) {
  return recoverAllowlistedMultiUnitPaidOrphanCheckout({
    mode: 'dry-run',
    allowlist,
    now
  });
}

async function runInitialExecute({ allowlist, envelope, stripe, now = new Date() }) {
  return recoverAllowlistedMultiUnitPaidOrphanCheckout({
    mode: 'initial',
    allowlist,
    originalEvidence: envelope,
    digest: envelope.digest,
    intentOverlay: buildValidIntentOverlay(),
    execute: true,
    stripe: stripe.client || stripe,
    now
  });
}

async function runResumeExecute({ allowlist, envelope, stripe, now = new Date() }) {
  return recoverAllowlistedMultiUnitPaidOrphanCheckout({
    mode: 'resume',
    allowlist,
    originalEvidence: envelope,
    digest: envelope.digest,
    intentOverlay: buildValidIntentOverlay({ resumedBy: 'ops:test-operator' }),
    execute: true,
    stripe: stripe.client || stripe,
    now
  });
}

async function snapshotRecoveryCollections() {
  const models = [
    ['CheckoutSession', CheckoutSession],
    ['CheckoutFinalizationJob', CheckoutFinalizationJob],
    ['Booking', Booking],
    ['Payment', Payment],
    ['ManualReviewItem', ManualReviewItem],
    ['EmailDeliveryState', EmailDeliveryState],
    ['SavedBookingQuote', SavedBookingQuote],
    ['Unit', Unit],
    ['AvailabilityBlock', AvailabilityBlock],
    ['AuditEvent', AuditEvent]
  ];
  const out = { counts: {}, docs: {} };
  for (const [name, Model] of models) {
    const docs = await Model.find({}).sort({ _id: 1 }).lean();
    out.counts[name] = docs.length;
    out.docs[name] = docs.map((d) => JSON.parse(JSON.stringify(d)));
  }
  return out;
}

module.exports = {
  GUEST_EMAIL,
  FAULT_CODE,
  fakeObjectId,
  buildValidIntentOverlay,
  enableOrdinarySideEffectFlags,
  createSideEffectSpies,
  createInstrumentedStripeStub,
  RecoveryFaultInjectedError,
  installFaultInjector,
  clearFaultInjectors,
  seedExecutablePaidOrphanIncident,
  runDryRun,
  runInitialExecute,
  runResumeExecute,
  snapshotRecoveryCollections,
  dryRunMultiUnitPaidOrphanRecovery,
  formatSofiaDateOnly,
  models: {
    Cabin,
    CabinType,
    Unit,
    Booking,
    CheckoutSession,
    CheckoutFinalizationJob,
    Payment,
    ManualReviewItem,
    EmailDeliveryState,
    SavedBookingQuote,
    AvailabilityBlock,
    AuditEvent
  }
};
