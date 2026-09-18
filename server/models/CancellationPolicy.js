/**
 * CancellationPolicy — versioned, server-owned cancellation / transfer rules.
 *
 * B7 foundation: evaluate voluntary refunds and transfer eligibility.
 * Does not execute Stripe refunds, booking mutations, or inventory moves.
 * Money: euro Number (two-decimal). Days-before-arrival use Sofia date-only.
 */
'use strict';

const mongoose = require('mongoose');

const POLICY_STATUSES = ['draft', 'active', 'retired'];
const POLICY_TYPES = ['normal_stay', 'hosted_package'];
const LEGAL_REVIEW_STATUSES = ['pending', 'approved', 'rejected'];

const refundTierSchema = new mongoose.Schema(
  {
    /** Inclusive lower bound of calendar days before arrival (Sofia). */
    minDaysBeforeArrival: {
      type: Number,
      required: true,
      min: [0, 'minDaysBeforeArrival cannot be negative']
    },
    /**
     * Inclusive upper bound. null = no upper bound (open-ended top tier).
     */
    maxDaysBeforeArrival: {
      type: Number,
      default: null,
      min: [0, 'maxDaysBeforeArrival cannot be negative']
    },
    refundPercent: {
      type: Number,
      required: true,
      min: [0, 'Refund percentage cannot be below 0'],
      max: [100, 'Refund percentage cannot exceed 100']
    }
  },
  { _id: false }
);

const dateTransferRulesSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    maxTransfers: { type: Number, min: 0, default: 0 },
    minDaysBeforeArrival: { type: Number, min: 0, default: null },
    /** Compatible RatePlan code(s); empty when date transfer disabled. */
    compatibleRatePlanCodes: {
      type: [{ type: String, trim: true, lowercase: true }],
      default: []
    },
    subjectToAvailability: { type: Boolean, default: true },
    higherPriceDifferencePayable: { type: Boolean, default: true },
    replacementBecomesNonRefundable: { type: Boolean, default: true }
  },
  { _id: false }
);

const nameTransferRulesSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    maxTransfers: { type: Number, min: 0, default: 0 },
    minDaysBeforeArrival: { type: Number, min: 0, default: null },
    free: { type: Boolean, default: true },
    /** Identity-only; dates/accommodation/total unchanged. */
    identityOnly: { type: Boolean, default: true }
  },
  { _id: false }
);

const organizerCancellationRuleSchema = new mongoose.Schema(
  {
    allowFullRefundOrReplacement: { type: Boolean, default: true },
    requiresManualExecution: { type: Boolean, default: true },
    ordinaryWeatherNotAutomatic: { type: Boolean, default: true },
    statutoryExceptionManualReview: { type: Boolean, default: true }
  },
  { _id: false }
);

const legalApprovalMetadataSchema = new mongoose.Schema(
  {
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: String, trim: true, default: null },
    notes: { type: String, trim: true, maxlength: 2000, default: null }
  },
  { _id: false }
);

const cancellationPolicySchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, 'Policy code is required'],
      trim: true,
      lowercase: true,
      minlength: [2, 'Code must be at least 2 characters'],
      maxlength: [80, 'Code cannot exceed 80 characters'],
      match: [/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Code must be lowercase kebab-case']
    },
    internalName: {
      type: String,
      required: [true, 'Internal name is required'],
      trim: true,
      maxlength: [160, 'Internal name cannot exceed 160 characters']
    },
    version: {
      type: Number,
      required: [true, 'Version is required'],
      min: [1, 'Version must be a positive integer'],
      validate: {
        validator(v) {
          return Number.isInteger(v);
        },
        message: 'Version must be a positive integer'
      }
    },
    status: {
      type: String,
      required: true,
      enum: {
        values: POLICY_STATUSES,
        message: 'Status must be draft, active, or retired'
      },
      default: 'draft'
    },
    policyType: {
      type: String,
      required: [true, 'policyType is required'],
      enum: {
        values: POLICY_TYPES,
        message: 'policyType must be normal_stay or hosted_package'
      }
    },
    correctionWindowHours: {
      type: Number,
      required: true,
      min: [0, 'correctionWindowHours cannot be negative'],
      default: 48
    },
    /**
     * Correction window applies only when Sofia calendar days before arrival
     * are strictly greater than this threshold.
     */
    correctionWindowMinDaysBeforeArrival: {
      type: Number,
      required: true,
      min: [0, 'correctionWindowMinDaysBeforeArrival cannot be negative']
    },
    refundTiers: {
      type: [refundTierSchema],
      required: true,
      validate: {
        validator(v) {
          return Array.isArray(v) && v.length > 0;
        },
        message: 'At least one refund tier is required'
      }
    },
    noShowRefundPercent: {
      type: Number,
      required: true,
      min: [0, 'Refund percentage cannot be below 0'],
      max: [100, 'Refund percentage cannot exceed 100'],
      default: 0
    },
    earlyDepartureRefundPercent: {
      type: Number,
      required: true,
      min: [0, 'Refund percentage cannot be below 0'],
      max: [100, 'Refund percentage cannot exceed 100'],
      default: 0
    },
    dateTransferRules: {
      type: dateTransferRulesSchema,
      required: true,
      default: () => ({})
    },
    nameTransferRules: {
      type: nameTransferRulesSchema,
      required: true,
      default: () => ({})
    },
    organizerCancellationRule: {
      type: organizerCancellationRuleSchema,
      required: true,
      default: () => ({})
    },
    nonQualifyingCancellationReasons: {
      type: [{ type: String, trim: true, maxlength: 200 }],
      default: []
    },
    travelInsuranceRecommendation: {
      type: String,
      trim: true,
      maxlength: [2000, 'travelInsuranceRecommendation cannot exceed 2000 characters'],
      default: ''
    },
    legalReviewStatus: {
      type: String,
      required: true,
      enum: {
        values: LEGAL_REVIEW_STATUSES,
        message: 'legalReviewStatus must be pending, approved, or rejected'
      },
      default: 'pending'
    },
    legalApprovalMetadata: {
      type: legalApprovalMetadataSchema,
      default: () => ({})
    }
  },
  { timestamps: true }
);

cancellationPolicySchema.index({ code: 1, version: 1 }, { unique: true });
cancellationPolicySchema.index({ status: 1, policyType: 1 });

module.exports = mongoose.model('CancellationPolicy', cancellationPolicySchema);
module.exports.POLICY_STATUSES = POLICY_STATUSES;
module.exports.POLICY_TYPES = POLICY_TYPES;
module.exports.LEGAL_REVIEW_STATUSES = LEGAL_REVIEW_STATUSES;
