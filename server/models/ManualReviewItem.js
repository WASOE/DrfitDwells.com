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
    }
  },
  { timestamps: true }
);

manualReviewItemSchema.index({ category: 1, status: 1, severity: 1 });

module.exports = mongoose.model('ManualReviewItem', manualReviewItemSchema);
module.exports.MANUAL_REVIEW_STATUSES = STATUSES;
module.exports.MANUAL_REVIEW_SEVERITIES = SEVERITIES;
