const mongoose = require('mongoose');

const FLOW_VERSIONS = ['v2', 'legacy'];

const CHECKOUT_SESSION_STATUSES = [
  'draft',
  'quoted',
  'payment_required',
  'payment_not_required',
  'pi_active',
  'voucher_only_reserved',
  'paid',
  'abandoned',
  'expired',
  'needs_review',
  'superseded'
];

const PAYMENT_STATUSES = ['unpaid', 'processing', 'paid', 'failed', 'not_required'];

const FINALIZE_STATUSES = ['open', 'in_progress', 'finalized', 'needs_review'];

const RESOURCE_LEASE_STATUSES = [
  'active',
  'cancel_pending',
  'expired',
  'paid',
  'released',
  'needs_review'
];

const SPLIT_OFFER_SCHEDULE_KINDS = [
  'percent_split',
  'fixed_deposit',
  'installment_plan'
];
const SPLIT_OFFER_AMOUNT_TYPES = ['percent_bps', 'fixed_cents', 'remainder'];
const SPLIT_OFFER_DUE_RULES = [
  'checkout',
  'days_before_arrival',
  'days_after_booking'
];
const SPLIT_OFFER_CANCELLATION_TREATMENTS = [
  'standard_policy',
  'stay_credit',
  'forfeit'
];

function integerNonNegativeValidator(value) {
  return Number.isInteger(value) && value >= 0;
}

function integerPositiveValidator(value) {
  return Number.isInteger(value) && value >= 1;
}

const splitPaymentOfferInstallmentSchema = new mongoose.Schema(
  {
    sequence: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: integerPositiveValidator, message: 'sequence must be a positive integer' }
    },
    amountCents: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: integerNonNegativeValidator,
        message: 'amountCents must be a non-negative integer'
      }
    },
    amountType: {
      type: String,
      required: true,
      enum: { values: SPLIT_OFFER_AMOUNT_TYPES, message: 'Unsupported amountType' }
    },
    dueRule: {
      type: String,
      required: true,
      enum: { values: SPLIT_OFFER_DUE_RULES, message: 'Unsupported dueRule' }
    },
    dueOffsetDays: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: integerNonNegativeValidator,
        message: 'dueOffsetDays must be a non-negative integer'
      }
    },
    dueAtDateOnly: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, 'dueAtDateOnly must be YYYY-MM-DD']
    },
    cancellationTreatment: {
      type: String,
      required: true,
      enum: {
        values: SPLIT_OFFER_CANCELLATION_TREATMENTS,
        message: 'Unsupported cancellationTreatment'
      }
    }
  },
  { _id: false }
);

/**
 * SP4: immutable optional split-payment OFFER for this quote/session.
 * Presence means the option was available — not that the guest selected it.
 */
const splitPaymentOfferSnapshotSchema = new mongoose.Schema(
  {
    schemaVersion: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: integerPositiveValidator, message: 'schemaVersion must be a positive integer' }
    },
    templateCode: { type: String, required: true, trim: true, lowercase: true },
    templateVersion: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: integerPositiveValidator, message: 'templateVersion must be a positive integer' }
    },
    scheduleKind: {
      type: String,
      required: true,
      enum: { values: SPLIT_OFFER_SCHEDULE_KINDS, message: 'Unsupported scheduleKind' }
    },
    currency: { type: String, required: true, trim: true, uppercase: true },
    totalCents: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: integerPositiveValidator, message: 'totalCents must be a positive integer' }
    },
    bookingDateOnly: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, 'bookingDateOnly must be YYYY-MM-DD']
    },
    arrivalDateOnly: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, 'arrivalDateOnly must be YYYY-MM-DD']
    },
    allowDateTransfer: { type: Boolean, required: true, default: false },
    installments: {
      type: [splitPaymentOfferInstallmentSchema],
      required: true,
      validate: {
        validator(v) {
          return Array.isArray(v) && v.length >= 2;
        },
        message: 'split offer requires at least two installments'
      }
    }
  },
  { _id: false }
);

const resourceLeaseAccommodationSchema = new mongoose.Schema(
  {
    holdId: { type: String, trim: true, default: null },
    leaseId: { type: String, trim: true, default: null },
    generation: { type: Number, default: null },
    cabinId: { type: String, trim: true, default: null },
    unitId: { type: String, trim: true, default: null },
    entityType: { type: String, trim: true, default: null }
  },
  { _id: false }
);

const resourceLeaseSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: RESOURCE_LEASE_STATUSES,
      default: null
    },
    generation: { type: Number, default: null, min: 1 },
    attemptId: { type: String, trim: true, default: null },
    quoteSnapshotHash: { type: String, trim: true, default: null },
    validUntil: { type: Date, default: null },
    activatedAt: { type: Date, default: null },
    updatedAt: { type: Date, default: null },
    accommodation: { type: resourceLeaseAccommodationSchema, default: null },
    facilityHoldIds: { type: [String], default: [] },
    voucherRedemptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GiftVoucherRedemption',
      default: null
    },
    voucherOperationId: { type: String, trim: true, default: null },
    paymentIntentId: { type: String, trim: true, default: null },
    cancellationStatus: { type: String, trim: true, default: null },
    cancellationAttemptedAt: { type: Date, default: null },
    releasedAt: { type: Date, default: null },
    failureCode: { type: String, trim: true, default: null }
  },
  { _id: false }
);

const checkoutSessionSchema = new mongoose.Schema(
  {
    checkoutId: {
      type: String,
      required: [true, 'checkoutId is required'],
      trim: true,
      immutable: true
    },
    flowVersion: {
      type: String,
      enum: FLOW_VERSIONS,
      required: true,
      default: 'v2'
    },
    status: {
      type: String,
      enum: CHECKOUT_SESSION_STATUSES,
      required: true,
      default: 'draft',
      index: true
    },
    stayFingerprint: {
      type: String,
      trim: true,
      default: null
    },
    replayFingerprint: {
      type: String,
      trim: true,
      default: null
    },
    guestEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: null
    },
    quoteSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    quoteSnapshotHash: {
      type: String,
      trim: true,
      default: null
    },
    canonicalPaymentIntentId: {
      type: String,
      trim: true,
      default: null
    },
    supersededPaymentIntentIds: {
      type: [String],
      default: []
    },
    voucherRedemptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GiftVoucherRedemption',
      default: null
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null
    },
    paymentStatus: {
      type: String,
      enum: PAYMENT_STATUSES,
      required: true,
      default: 'unpaid'
    },
    finalizeStatus: {
      type: String,
      enum: FINALIZE_STATUSES,
      required: true,
      default: 'open'
    },
    confirmationEmailSentAt: {
      type: Date,
      default: null
    },
    finalizeStartedAt: {
      type: Date,
      default: null
    },
    finalizedAt: {
      type: Date,
      default: null
    },
    stripeAmountCents: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: integerNonNegativeValidator,
        message: 'stripeAmountCents must be a non-negative integer'
      }
    },
    giftVoucherAppliedCents: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: integerNonNegativeValidator,
        message: 'giftVoucherAppliedCents must be a non-negative integer'
      }
    },
    /** SP7: stay credit applied at checkout — disables split; reduces card obligation. */
    stayCreditAppliedCents: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: integerNonNegativeValidator,
        message: 'stayCreditAppliedCents must be a non-negative integer'
      }
    },
    stayCreditCode: {
      type: String,
      trim: true,
      uppercase: true,
      default: null
    },
    stayCreditId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StayCredit',
      default: null
    },
    /** SP7B: durable StayCreditReservation for this checkout (authoritative reserved cents). */
    stayCreditReservationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StayCreditReservation',
      default: null,
      index: true
    },
    expiresAt: {
      type: Date,
      default: null,
      index: true
    },
    sessionVersion: {
      type: Number,
      default: 1,
      min: 1
    },
    /**
     * Batch 2: versioned guest/legal finalize payload (server-owned capture).
     * See docs/checkout-payment-architecture/02_PAID_BOOKING_FINALIZATION_IMPLEMENTATION_SPEC.md §B
     */
    finalizeIntent: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    finalizeIntentHash: {
      type: String,
      trim: true,
      default: null
    },
    finalizeIntentCapturedAt: {
      type: Date,
      default: null
    },
    finalizeIntentImmutableAt: {
      type: Date,
      default: null
    },
    /**
     * Batch 3: verified accommodation PaymentIntent success evidence (webhook).
     * Safe IDs/hashes only — never full Stripe objects or guest PII.
     */
    paymentSucceededAt: {
      type: Date,
      default: null
    },
    paymentEvidence: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    /**
     * B8F3: durable resource lease attached under the orchestrator fence before PI work.
     * Default-off payment gate verifies this before any Stripe create/reuse return.
     */
    resourceLease: {
      type: resourceLeaseSchema,
      default: null
    },
    /**
     * SP4: optional split-payment OFFER frozen for this quote/session.
     * Not a chosen obligation. Null when flag off / ineligible / no term.
     */
    splitPaymentOfferSnapshot: {
      type: splitPaymentOfferSnapshotSchema,
      default: null
    },
    splitPaymentOfferSnapshotHash: {
      type: String,
      trim: true,
      default: null
    },
    /**
     * SP5: explicit customer payment choice. Default/absent = full.
     * Offer presence alone must never imply split was selected.
     */
    paymentChoice: {
      type: new mongoose.Schema(
        {
          choice: {
            type: String,
            required: true,
            enum: { values: ['full', 'split'], message: 'Unsupported payment choice' },
            default: 'full'
          },
          splitOfferSnapshotHash: { type: String, trim: true, default: null },
          selectedAt: { type: Date, default: null },
          sessionVersionAtSelection: { type: Number, default: null, min: 1 }
        },
        { _id: false }
      ),
      default: null
    },
    /**
     * SP5: future off-session charge consent evidence (split only).
     * Protocol identity = consentVersion + consentHash (not displayedText).
     */
    futureChargeConsent: {
      type: new mongoose.Schema(
        {
          consentVersion: {
            type: Number,
            required: true,
            min: 1,
            validate: { validator: integerPositiveValidator, message: 'consentVersion must be a positive integer' }
          },
          consentHash: { type: String, required: true, trim: true },
          acceptedAt: { type: Date, required: true },
          acceptedLocale: { type: String, trim: true, maxlength: 32, default: 'en' },
          displayedText: { type: String, required: true, trim: true, maxlength: 4000 }
        },
        { _id: false }
      ),
      default: null
    },
    /** SP5: Stripe Customer for selected split (internal; not public). */
    stripeCustomerId: {
      type: String,
      trim: true,
      default: null
    },
    /** SP5: reusable PaymentMethod captured after successful split initial payment. */
    stripeReusablePaymentMethodId: {
      type: String,
      trim: true,
      default: null
    }
  },
  { timestamps: true }
);

checkoutSessionSchema.index({ checkoutId: 1 }, { unique: true });

checkoutSessionSchema.index(
  { canonicalPaymentIntentId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      canonicalPaymentIntentId: { $exists: true, $type: 'string', $gt: '' }
    }
  }
);

checkoutSessionSchema.index({ stayFingerprint: 1, finalizeStatus: 1 });
checkoutSessionSchema.index(
  { bookingId: 1 },
  {
    partialFilterExpression: {
      bookingId: { $exists: true, $type: 'objectId' }
    }
  }
);
checkoutSessionSchema.index({ guestEmail: 1, createdAt: -1 });
checkoutSessionSchema.index({ status: 1, updatedAt: -1 });

// B8F3 reconciliation lookup. Not bootstrapped against production here; tests create explicitly.
checkoutSessionSchema.index(
  { 'resourceLease.status': 1, 'resourceLease.validUntil': 1 },
  {
    name: 'resource_lease_status_validUntil_v1',
    partialFilterExpression: {
      'resourceLease.status': { $exists: true, $type: 'string' }
    }
  }
);

module.exports = mongoose.model('CheckoutSession', checkoutSessionSchema);
module.exports.FLOW_VERSIONS = FLOW_VERSIONS;
module.exports.CHECKOUT_SESSION_STATUSES = CHECKOUT_SESSION_STATUSES;
module.exports.PAYMENT_STATUSES = PAYMENT_STATUSES;
module.exports.FINALIZE_STATUSES = FINALIZE_STATUSES;
module.exports.RESOURCE_LEASE_STATUSES = RESOURCE_LEASE_STATUSES;
module.exports.SPLIT_OFFER_SCHEDULE_KINDS = SPLIT_OFFER_SCHEDULE_KINDS;
module.exports.SPLIT_OFFER_AMOUNT_TYPES = SPLIT_OFFER_AMOUNT_TYPES;
module.exports.SPLIT_OFFER_DUE_RULES = SPLIT_OFFER_DUE_RULES;
module.exports.SPLIT_OFFER_CANCELLATION_TREATMENTS = SPLIT_OFFER_CANCELLATION_TREATMENTS;
