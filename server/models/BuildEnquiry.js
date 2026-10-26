'use strict';

const mongoose = require('mongoose');
const {
  ENQUIRY_STATUSES,
  EMAIL_LANE_STATUSES,
  LAND_STATUSES,
  BUDGET_BANDS,
  TIMELINE_BANDS,
  BUILD_MODEL_IDS,
  SOURCE
} = require('../services/buildEnquiries/buildEnquiryConstants');

const emailLaneSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: EMAIL_LANE_STATUSES,
      default: 'pending'
    },
    attemptCount: { type: Number, default: 0, min: 0 },
    maxAttempts: { type: Number, default: 10, min: 1 },
    nextAttemptAt: { type: Date, default: null },
    claimedBy: { type: String, default: null },
    claimedAt: { type: Date, default: null },
    visibilityTimeoutAt: { type: Date, default: null },
    lastError: { type: String, default: null, maxlength: 500 },
    providerMessageId: { type: String, default: null, maxlength: 500 }
  },
  { _id: false }
);

const contactSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 320 },
    emailNormalized: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 320,
      index: true
    },
    phone: { type: String, default: null, trim: true, maxlength: 40 }
  },
  { _id: false }
);

const projectSchema = new mongoose.Schema(
  {
    location: { type: String, required: true, trim: true, maxlength: 200 },
    landStatus: { type: String, required: true, enum: LAND_STATUSES },
    budget: { type: String, required: true, enum: BUDGET_BANDS },
    timeline: { type: String, required: true, enum: TIMELINE_BANDS },
    message: { type: String, default: null, trim: true, maxlength: 4000 }
  },
  { _id: false }
);

const configSchema = new mongoose.Schema(
  {
    modelId: { type: String, required: true, enum: BUILD_MODEL_IDS },
    customDimensions: {
      type: new mongoose.Schema(
        {
          length: { type: Number },
          width: { type: Number }
        },
        { _id: false }
      ),
      default: null
    },
    radio: { type: Map, of: String, default: () => ({}) },
    toggles: { type: [String], default: [] }
  },
  { _id: false }
);

const estimateSchema = new mongoose.Schema(
  {
    totalEur: { type: Number, default: null },
    hasConsultationItems: { type: Boolean, default: false },
    currency: { type: String, default: 'EUR', trim: true },
    displayLabel: { type: String, default: null, trim: true, maxlength: 80 },
    summaryRows: {
      type: [
        new mongoose.Schema(
          {
            key: { type: String, maxlength: 80 },
            value: { type: String, maxlength: 200 }
          },
          { _id: false }
        )
      ],
      default: []
    },
    /** Client-reported figure; never treated as authoritative pricing. */
    unverified: { type: Boolean, default: true }
  },
  { _id: false }
);

const configMetaSchema = new mongoose.Schema(
  {
    currentStep: { type: Number, default: null },
    stepsVisited: { type: [Number], default: [] },
    isPartial: { type: Boolean, default: true }
  },
  { _id: false }
);

const attributionSchema = new mongoose.Schema(
  {
    source: { type: String, default: null, trim: true, maxlength: 120 },
    medium: { type: String, default: null, trim: true, maxlength: 120 },
    campaign: { type: String, default: null, trim: true, maxlength: 120 },
    utmSource: { type: String, default: null, trim: true, maxlength: 120 },
    utmMedium: { type: String, default: null, trim: true, maxlength: 120 },
    utmCampaign: { type: String, default: null, trim: true, maxlength: 120 },
    referrer: { type: String, default: null, trim: true, maxlength: 500 }
  },
  { _id: false }
);

const buildEnquirySchema = new mongoose.Schema(
  {
    projectReference: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 32
    },
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 128
    },
    contact: { type: contactSchema, required: true },
    project: { type: projectSchema, required: true },
    config: { type: configSchema, required: true },
    estimate: { type: estimateSchema, default: () => ({ unverified: true }) },
    configMeta: { type: configMetaSchema, default: () => ({ isPartial: true }) },
    attribution: { type: attributionSchema, default: () => ({}) },
    sessionKey: { type: String, default: null, trim: true, maxlength: 120 },
    visitorKey: { type: String, default: null, trim: true, maxlength: 120 },
    source: { type: String, default: SOURCE, trim: true },
    status: {
      type: String,
      enum: ENQUIRY_STATUSES,
      default: 'new',
      index: true
    },
    emails: {
      internal: { type: emailLaneSchema, default: () => ({ status: 'pending' }) },
      customer: { type: emailLaneSchema, default: () => ({ status: 'pending' }) }
    },
    isTest: { type: Boolean, default: false, index: true }
  },
  { timestamps: true }
);

buildEnquirySchema.index({ 'contact.emailNormalized': 1, createdAt: -1 });
buildEnquirySchema.index({ status: 1, createdAt: -1 });
buildEnquirySchema.index({ 'emails.internal.status': 1, 'emails.internal.nextAttemptAt': 1 });
buildEnquirySchema.index({ 'emails.customer.status': 1, 'emails.customer.nextAttemptAt': 1 });

module.exports = mongoose.model('BuildEnquiry', buildEnquirySchema);
