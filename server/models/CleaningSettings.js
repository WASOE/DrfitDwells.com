const mongoose = require('mongoose');

/**
 * Per-location cleaning configuration for the cleaning portal.
 * baseFee is the daily base cleaning fee in EUR for a property kind, added on top of
 * individual per-cabin cleaning fees when computing the daily payment summary.
 */
const cleaningSettingsSchema = new mongoose.Schema(
  {
    propertyKind: {
      type: String,
      enum: ['cabin', 'valley'],
      required: true
    },
    baseFee: {
      type: Number,
      min: 0,
      default: 0
    }
  },
  { timestamps: true }
);

cleaningSettingsSchema.index({ propertyKind: 1 }, { unique: true });

module.exports = mongoose.model('CleaningSettings', cleaningSettingsSchema);
