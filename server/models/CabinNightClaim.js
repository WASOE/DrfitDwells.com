'use strict';

const mongoose = require('mongoose');

/**
 * CabinNightClaim — exclusive guest ownership of one single-cabin occupied night.
 *
 * Binding: docs/stay-change-implementation-plan.md — §24 REBOOK-S1.
 *
 * Delete-on-release: releasing deletes the row. No active/released status.
 *
 * Authoritative unique index is created ONLY by explicit S1 cutover CLI (S1.6).
 * Schema autoIndex is disabled so ordinary deploy/startup cannot mutate it.
 */

const CLAIM_SOURCES = Object.freeze([
  'finalize',
  'legacy_create',
  'manual_reservation',
  'location_child',
  'date_edit',
  'reassign',
  'rebook',
  'bootstrap',
  'recovery',
  'test',
  'other'
]);

/** Single canonical S1 unique-index specification (S1.6 cutover only). */
const AUTHORITATIVE_UNIQUE_INDEX_SPEC = Object.freeze({
  keys: Object.freeze({ cabinId: 1, night: 1 }),
  options: Object.freeze({
    unique: true,
    name: 'cabinNightClaim_cabinId_night_unique'
  }),
  cutoverBatch: 'S1',
  legacyNonUniqueName: 'cabinId_1_night_1',
  note: 'Created only by cabinNightClaimS1Cutover.js --create-unique-index'
});

const cabinNightClaimSchema = new mongoose.Schema(
  {
    cabinId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cabin',
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

// Lookup helpers only — exclusivity is the named unique index (S1 CLI).
cabinNightClaimSchema.index({ cabinId: 1 });
cabinNightClaimSchema.index({ night: 1 });
cabinNightClaimSchema.index({ bookingId: 1 });
cabinNightClaimSchema.index({ stayChangeId: 1 });
cabinNightClaimSchema.index({ bookingId: 1, cabinId: 1 });

// Authoritative unique index is NOT declared on schema — S1.6 cutover CLI only.
// See AUTHORITATIVE_UNIQUE_INDEX_SPEC (tooling / assertAuthoritativeCabinNightIndex).

cabinNightClaimSchema.set('autoIndex', false);

cabinNightClaimSchema.statics.AUTHORITATIVE_UNIQUE_INDEX_SPEC = AUTHORITATIVE_UNIQUE_INDEX_SPEC;
cabinNightClaimSchema.statics.CLAIM_SOURCES = CLAIM_SOURCES;

module.exports = mongoose.model('CabinNightClaim', cabinNightClaimSchema);
module.exports.CLAIM_SOURCES = CLAIM_SOURCES;
module.exports.AUTHORITATIVE_UNIQUE_INDEX_SPEC = AUTHORITATIVE_UNIQUE_INDEX_SPEC;
