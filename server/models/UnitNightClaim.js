'use strict';

const mongoose = require('mongoose');

/**
 * UnitNightClaim — current exclusive guest ownership of one physical unit-night.
 *
 * Inventory Integrity I1: model + service foundation only.
 * Authoritative unique index { unitId, night } is intentionally NOT created here
 * (cutover I6, after bootstrap/conflict cleanup). See:
 * docs/stay-change-implementation-plan.md §10.3
 *
 * Delete-on-release: releasing deletes the row. No active/released status.
 */

const CLAIM_SOURCES = Object.freeze([
  'finalize',
  'legacy_create',
  'location_child',
  'multi_unit_recovery',
  'date_edit',
  'reallocate',
  'bootstrap',
  'test',
  'other'
]);

const unitNightClaimSchema = new mongoose.Schema(
  {
    unitId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Unit',
      required: true,
      index: true
    },
    /**
     * Sofia civil day-start (UTC instant for Europe/Sofia midnight of that night).
     * One occupied night in stay [checkIn, checkOut). Checkout day is never claimed.
     */
    night: {
      type: Date,
      required: true,
      index: true
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      index: true
    },
    stayChangeId: {
      type: mongoose.Schema.Types.ObjectId,
      // StayChange model lands in Batch R; stored as ObjectId until then.
      default: null,
      index: true
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

// Lookup helpers only — NOT the authoritative unique exclusivity index (I6).
unitNightClaimSchema.index({ unitId: 1, night: 1 });
unitNightClaimSchema.index({ bookingId: 1, unitId: 1 });

/**
 * Intended I6 cutover index (do NOT create via schema sync / autoIndex in I1):
 *   { unitId: 1, night: 1 } unique: true
 * Documented for migration tooling; creating it before conflict cleanup is forbidden.
 */
unitNightClaimSchema.statics.AUTHORITATIVE_UNIQUE_INDEX_SPEC = Object.freeze({
  keys: { unitId: 1, night: 1 },
  options: { unique: true, name: 'unitNightClaim_unitId_night_unique' },
  cutoverBatch: 'I6',
  note: 'Must not be created until Inventory Integrity bootstrap conflicts are resolved'
});

unitNightClaimSchema.statics.CLAIM_SOURCES = CLAIM_SOURCES;

module.exports = mongoose.model('UnitNightClaim', unitNightClaimSchema);
module.exports.CLAIM_SOURCES = CLAIM_SOURCES;
