'use strict';

const mongoose = require('mongoose');

const ENTITY_TYPES = Object.freeze(['cabin', 'cabin_type', 'unit', 'location']);
const REASONS = Object.freeze([
  'opened',
  'seasonal',
  'maintenance',
  'owner_block',
  'closed',
  'manual_correction'
]);

/**
 * Read-only reporting metadata: when inventory was sellable.
 * Does not affect public booking behaviour in Batch 5A.
 * Never auto-derived from Mongo createdAt without explicit review.
 */
const inventoryOperatingPeriodSchema = new mongoose.Schema(
  {
    propertyKind: {
      type: String,
      enum: ['cabin', 'valley'],
      required: true,
      index: true
    },
    entityType: {
      type: String,
      enum: ENTITY_TYPES,
      required: true,
      index: true
    },
    entityId: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      index: true
    },
    operatingFrom: { type: Date, required: true, index: true },
    operatingTo: { type: Date, default: null, index: true },
    sellableWeekdays: {
      type: [Number],
      default: () => [0, 1, 2, 3, 4, 5, 6],
      validate: {
        validator(v) {
          return Array.isArray(v) && v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);
        }
      }
    },
    defaultSellable: { type: Boolean, default: true },
    reason: {
      type: String,
      enum: REASONS,
      required: true,
      default: 'opened'
    },
    source: { type: String, trim: true, default: 'ops_manual' },
    notes: { type: String, trim: true, default: '' },
    schemaVersion: { type: Number, default: 1 }
  },
  { timestamps: true }
);

inventoryOperatingPeriodSchema.index({
  propertyKind: 1,
  entityType: 1,
  entityId: 1,
  operatingFrom: 1
});

module.exports = mongoose.model('InventoryOperatingPeriod', inventoryOperatingPeriodSchema);
module.exports.ENTITY_TYPES = ENTITY_TYPES;
module.exports.REASONS = REASONS;
