'use strict';

/**
 * StayChange — durable Move / Modify stay aggregate.
 *
 * Binding: docs/stay-change-implementation-plan.md §21 (R1 REALLOCATE), §23 (REBOOK-S2).
 *
 * R1 runtime creates only kind=reallocate and uses the R1 status subset.
 * S2 expands schema for kind=rebook (snapshots, money evidence, targetBookingId).
 * Safety-critical idempotency unique index is created ONLY by
 * stayChangeR1Cutover.js --create-indexes (autoIndex false).
 * S2 does not add production unique indexes.
 */

const mongoose = require('mongoose');
const {
  validateRebookStayChangeRepresentation,
  assertRebookImmutability,
  REBOOK_KIND
} = require('../services/stayChange/rebookStayChangeSpine');

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

/** Single canonical R1/REBOOK idempotency unique-index specification (source bookingId). */
const IDEMPOTENCY_UNIQUE_INDEX_SPEC = Object.freeze({
  keys: Object.freeze({ kind: 1, bookingId: 1, idempotencyKey: 1 }),
  options: Object.freeze({
    unique: true,
    name: 'stayChange_kind_booking_idempotency_unique'
  }),
  cutoverBatch: 'R1',
  note: 'Created only by stayChangeR1Cutover.js --create-indexes; reused by REBOOK (source bookingId)'
});

/** Re-export AuditEvent R1 dedupe spec for cutover tooling (not schema-registered there). */
const { AUDIT_DEDUPE_INDEX_SPEC } = require('./AuditEvent');

const moneyEvidenceSchema = new mongoose.Schema(
  {
    sourceContractualTotalCents: { type: Number, default: null },
    recognizedNetSettledCoverageCents: { type: Number, default: null },
    transferredValueCents: { type: Number, default: null },
    canonicalTargetQuoteCents: { type: Number, default: null },
    waivedUpgradeCents: { type: Number, default: 0 },
    additionalChargeCents: { type: Number, default: 0 },
    refundCents: { type: Number, default: 0 },
    creditCents: { type: Number, default: 0 },
    retainedCents: { type: Number, default: 0 },
    contractualTargetTotalCents: { type: Number, default: null },
    settlementType: { type: String, default: null, trim: true, maxlength: 64 },
    currency: { type: String, default: 'eur', trim: true, lowercase: true, maxlength: 3 }
  },
  { _id: false }
);

const stayChangeSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: STAY_CHANGE_KINDS,
      required: true,
      index: true
    },
    /** Canonical SOURCE Booking for all kinds (REBOOK: never reinterpret as target). */
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      index: true
    },
    /**
     * REBOOK replacement Booking id only. Null for reallocate/amend.
     * May be pre-generated before Booking persistence (S3 owns create).
     * No production unique index in S2.
     */
    targetBookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null
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
    /** Shape-dependent: required for multi / R1; null for single-cabin REBOOK. */
    sourceCabinTypeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CabinType',
      default: null
    },
    targetCabinTypeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CabinType',
      default: null
    },
    /** Single-cabin commercial identity (REBOOK); null for multi / R1. */
    sourceCabinId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cabin',
      default: null
    },
    targetCabinId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cabin',
      default: null
    },
    /** Allocation-only; required for R1; with cabinType for multi REBOOK. */
    sourceUnitId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Unit',
      default: null
    },
    targetUnitId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Unit',
      default: null
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
    /** Immutable REBOOK evidence (no guest PII). Null for R1. */
    sourceSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    targetSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    /** REBOOK money ledger evidence only — not Payment rows. */
    money: {
      type: moneyEvidenceSchema,
      default: undefined
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

stayChangeSchema.pre('validate', function stayChangeKindValidate(next) {
  if (this.kind === 'reallocate') {
    if (!this.sourceCabinTypeId || !this.targetCabinTypeId || !this.sourceUnitId || !this.targetUnitId) {
      return next(
        new Error('REALLOCATE requires source/target cabinTypeId and unitId (R1 fail-closed)')
      );
    }
    if (this.targetBookingId) {
      return next(new Error('REALLOCATE must not set targetBookingId'));
    }
    return next();
  }

  if (this.kind === REBOOK_KIND) {
    const plain = this.toObject({ depopulate: true });
    const result = validateRebookStayChangeRepresentation(plain);
    if (!result.ok) {
      const err = new Error(result.message || result.code || 'Invalid REBOOK StayChange');
      err.code = result.code;
      return next(err);
    }
  }

  next();
});

stayChangeSchema.pre('save', function stayChangeImmutability(next) {
  if (this.kind !== REBOOK_KIND || this.isNew) return next();
  const modified = this.directModifiedPaths ? this.directModifiedPaths() : this.modifiedPaths();
  if (!modified || modified.length === 0) return next();

  const before = this._rebookImmutabilityBefore;
  if (!before) return next();

  const after = this.toObject({ depopulate: true });
  const result = assertRebookImmutability(before, after);
  if (!result.ok) {
    const err = new Error(result.message || result.code || 'REBOOK immutability violation');
    err.code = result.code;
    return next(err);
  }
  next();
});

stayChangeSchema.post('init', function stayChangeCaptureBefore() {
  if (this.kind === REBOOK_KIND) {
    this._rebookImmutabilityBefore = this.toObject({ depopulate: true });
  }
});

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
