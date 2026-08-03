const mongoose = require('mongoose');

const STATUSES = ['open', 'resolved', 'ignored'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];

const manualReviewItemSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      required: true,
      index: true
    },
    severity: {
      type: String,
      enum: SEVERITIES,
      required: true,
      default: 'medium',
      index: true
    },
    status: {
      type: String,
      enum: STATUSES,
      required: true,
      default: 'open',
      index: true
    },
    entityType: {
      type: String,
      default: null,
      index: true
    },
    entityId: {
      type: String,
      default: null,
      index: true
    },
    title: {
      type: String,
      required: true
    },
    details: {
      type: String,
      default: ''
    },
    provenance: {
      source: { type: String, default: 'internal' },
      sourceReference: { type: String, default: null },
      detectedAt: { type: Date, default: Date.now }
    },
    evidence: {
      type: Object,
      default: {}
    },
    resolution: {
      resolvedAt: { type: Date, default: null },
      resolvedBy: { type: String, default: null },
      note: { type: String, default: null }
    },
    // S0 multi-unit paid-orphan recovery resolution hold
    resolutionHold: {
      kind: { type: String, default: null },
      recoveryExecutionId: { type: String, default: null },
      finalizationJobId: { type: String, default: null },
      checkoutId: { type: String, default: null },
      paymentIntentId: { type: String, default: null },
      heldAt: { type: Date, default: null },
      status: { type: String, default: null },
      releasedAt: { type: Date, default: null },
      transferredToManualReviewItemId: { type: String, default: null },
      transferredAt: { type: Date, default: null }
    },
    // Completion MRI unique identity (immutable once set)
    recoveryDedupeKey: {
      type: String,
      default: null,
      immutable: true
    },
    replacedManualReviewItemId: {
      type: String,
      default: null
    }
  },
  { timestamps: true }
);

manualReviewItemSchema.index({ category: 1, status: 1, severity: 1 });
manualReviewItemSchema.index({
  'resolutionHold.status': 1,
  'resolutionHold.paymentIntentId': 1
});
manualReviewItemSchema.index(
  { recoveryDedupeKey: 1 },
  {
    unique: true,
    partialFilterExpression: { recoveryDedupeKey: { $type: 'string' } }
  }
);

module.exports = mongoose.model('ManualReviewItem', manualReviewItemSchema);
module.exports.MANUAL_REVIEW_STATUSES = STATUSES;
module.exports.MANUAL_REVIEW_SEVERITIES = SEVERITIES;
