const mongoose = require('mongoose');

/** Canonical bed types for inventory display and whole-location quotes. */
const BED_TYPES = Object.freeze([
  'single',
  'twin',
  'double',
  'queen',
  'king',
  'sofa_bed',
  'bunk'
]);

const bedConfigEntrySchema = new mongoose.Schema(
  {
    bedType: {
      type: String,
      required: true,
      enum: BED_TYPES,
      trim: true
    },
    count: {
      type: Number,
      required: true,
      min: [1, 'Bed count must be at least 1'],
      max: [20, 'Bed count cannot exceed 20']
    }
  },
  { _id: false }
);

/** Repeatable bed configuration subdocument array for Cabin / CabinType. */
const bedConfigField = {
  type: [bedConfigEntrySchema],
  default: []
};

module.exports = {
  BED_TYPES,
  bedConfigEntrySchema,
  bedConfigField
};
