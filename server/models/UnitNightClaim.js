'use strict';

const mongoose = require('mongoose');

/**
 * UnitNightClaim — exclusive guest ownership of one physical unit-night.
 *
 * Binding: docs/stay-change-implementation-plan.md — I6 authoritative cutover.
 *
 * Delete-on-release: releasing deletes the row. No active/released status.
 *
 * Authoritative unique index is created ONLY by explicit I6 cutover CLI.
 * Schema autoIndex is disabled so ordinary deploy/startup cannot mutate it.
 */

const CLAIM_SOURCES = Object.freeze([
  'finalize',
  'legacy_create',
  'location_child',
  'multi_unit_recovery',
  'date_edit',
  'reallocate',
  'rebook',
  'bootstrap',
  'test',
  'other'
]);

/** Single canonical I6 unique-index specification. */
const AUTHORITATIVE_UNIQUE_INDEX_SPEC = Object.freeze({
  keys: Object.freeze({ unitId: 1, night: 1 }),
  options: Object.freeze({
    unique: true,
    name: 'unitNightClaim_unitId_night_unique'
  }),
  cutoverBatch: 'I6',
  legacyNonUniqueName: 'unitId_1_night_1',
  note: 'Created only by unitNightClaimI6Cutover.js --create-unique-index'
});

const unitNightClaimSchema = new mongoose.Schema(
  {
    unitId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Unit',
      required: true
    },
    /**
     * Sofia civil day-start (UTC instant for Europe/Sofia midnight of that night).
     * One occupied night in stay [checkIn, checkOut). Checkout day is never claimed.
     */
    night: {
      type: Date,
      required: true
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true
    },
    stayChangeId: {
      type: mongoose.Schema.Types.ObjectId,
      // StayChange model lands in Batch R; stored as ObjectId until then.
      default: null
    },
    source: {
      type: String,
      required: true,
      trim: true,
      maxlength: [80, 'source cannot exceed 80 characters'],
      default: 'other'
    }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Lookup helpers only — exclusivity is the named unique index (I6 CLI).
unitNightClaimSchema.index({ unitId: 1 });
unitNightClaimSchema.index({ night: 1 });
unitNightClaimSchema.index({ bookingId: 1 });
unitNightClaimSchema.index({ stayChangeId: 1 });
unitNightClaimSchema.index({ bookingId: 1, unitId: 1 });

// Document authoritative unique index for tooling/docs; autoIndex is OFF so this
// declaration never builds on ordinary connect/startup.
unitNightClaimSchema.index(
  AUTHORITATIVE_UNIQUE_INDEX_SPEC.keys,
  { ...AUTHORITATIVE_UNIQUE_INDEX_SPEC.options }
);

unitNightClaimSchema.set('autoIndex', false);

unitNightClaimSchema.statics.AUTHORITATIVE_UNIQUE_INDEX_SPEC = AUTHORITATIVE_UNIQUE_INDEX_SPEC;
unitNightClaimSchema.statics.CLAIM_SOURCES = CLAIM_SOURCES;

module.exports = mongoose.model('UnitNightClaim', unitNightClaimSchema);
module.exports.CLAIM_SOURCES = CLAIM_SOURCES;
module.exports.AUTHORITATIVE_UNIQUE_INDEX_SPEC = AUTHORITATIVE_UNIQUE_INDEX_SPEC;
