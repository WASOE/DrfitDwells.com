'use strict';

/**
 * StayChange — durable Move / Modify stay aggregate.
 *
 * Binding: docs/stay-change-implementation-plan.md §21 (R1 REALLOCATE).
 *
 * R1 runtime creates only kind=reallocate and uses the R1 status subset.
 * Safety-critical idempotency unique index is created ONLY by
 * stayChangeR1Cutover.js --create-indexes (autoIndex false).
 */

const mongoose = require('mongoose');

const STAY_CHANGE_KINDS = Object.freeze(['reallocate', 'amend', 'rebook']);

const STAY_CHANGE_STATUSES = Object.freeze([
  'pending',
  'inventory_secured',
  'awaiting_payment',
  'ready_to_commit',
  'committed',
  'settling',
  'completed',
  'failed',
  'needs_reconciliation'
]);

const R1_STATUSES = Object.freeze([
  'pending',
  'inventory_secured',
  'committed',
  'completed',
  'failed',
  'needs_reconciliation'
]);

/** Single canonical R1 idempotency unique-index specification. */
const IDEMPOTENCY_UNIQUE_INDEX_SPEC = Object.freeze({
  keys: Object.freeze({ kind: 1, bookingId: 1, idempotencyKey: 1 }),
  options: Object.freeze({
    unique: true,
    name: 'stayChange_kind_booking_idempotency_unique'
  }),
  cutoverBatch: 'R1',
  note: 'Created only by stayChangeR1Cutover.js --create-indexes'
});

/** Re-export AuditEvent R1 dedupe spec for cutover tooling (not schema-registered there). */
const { AUDIT_DEDUPE_INDEX_SPEC } = require('./AuditEvent');

const stayChangeSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: STAY_CHANGE_KINDS,
      required: true,
      index: true
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      index: true
    },
    sourceCommercialProductKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    targetCommercialProductKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    sourceCabinTypeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CabinType',
      required: true
    },
    targetCabinTypeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CabinType',
      required: true
    },
    sourceUnitId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Unit',
      required: true
    },
    targetUnitId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Unit',
      required: true
    },
    checkIn: {
      type: Date,
      required: true
    },
    checkOut: {
      type: Date,
      required: true
    },
    status: {
      type: String,
      enum: STAY_CHANGE_STATUSES,
      required: true,
      default: 'pending',
      index: true
    },
    idempotencyKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128
    },
    payloadFingerprint: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128
    },
    actor: {
      actorType: { type: String, default: 'user' },
      actorId: { type: String, default: null },
      actorRole: { type: String, default: null }
    },
    reason: {
      type: String,
      default: null,
      trim: true,
      maxlength: 500
    },
    externalHoldWarningsAccepted: {
      type: Boolean,
      default: false
    },
    failure: {
      code: { type: String, default: null },
      message: { type: String, default: null },
      phase: { type: String, default: null },
      at: { type: Date, default: null }
    },
    reconciliation: {
      category: { type: String, default: null },
      detail: { type: String, default: null },
      mriId: { type: String, default: null },
      at: { type: Date, default: null }
    },
    /** Set once OPS AuditEvent projection succeeds (or dedupe finds existing). */
    auditProjectedAt: {
      type: Date,
      default: null
    },
    auditDedupeKey: {
      type: String,
      default: null,
      trim: true,
      maxlength: 160
    },
    completedAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

stayChangeSchema.index({ bookingId: 1, status: 1 });
stayChangeSchema.index({ kind: 1, status: 1 });

// Document safety-critical unique index; autoIndex OFF so ordinary startup never builds it.
stayChangeSchema.index(IDEMPOTENCY_UNIQUE_INDEX_SPEC.keys, {
  ...IDEMPOTENCY_UNIQUE_INDEX_SPEC.options
});

stayChangeSchema.set('autoIndex', false);

stayChangeSchema.statics.STAY_CHANGE_KINDS = STAY_CHANGE_KINDS;
stayChangeSchema.statics.STAY_CHANGE_STATUSES = STAY_CHANGE_STATUSES;
stayChangeSchema.statics.R1_STATUSES = R1_STATUSES;
stayChangeSchema.statics.IDEMPOTENCY_UNIQUE_INDEX_SPEC = IDEMPOTENCY_UNIQUE_INDEX_SPEC;
stayChangeSchema.statics.AUDIT_DEDUPE_INDEX_SPEC = AUDIT_DEDUPE_INDEX_SPEC;

module.exports = mongoose.model('StayChange', stayChangeSchema);
module.exports.STAY_CHANGE_KINDS = STAY_CHANGE_KINDS;
module.exports.STAY_CHANGE_STATUSES = STAY_CHANGE_STATUSES;
module.exports.R1_STATUSES = R1_STATUSES;
module.exports.IDEMPOTENCY_UNIQUE_INDEX_SPEC = IDEMPOTENCY_UNIQUE_INDEX_SPEC;
module.exports.AUDIT_DEDUPE_INDEX_SPEC = AUDIT_DEDUPE_INDEX_SPEC;
