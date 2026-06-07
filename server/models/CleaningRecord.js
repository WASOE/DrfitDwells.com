const mongoose = require('mongoose');

/**
 * CleaningRecord — per-booking turnover cleaning row for the cleaning portal.
 *
 * One record represents a cleaning that is due on `cleaningDate` (the booking's
 * checkout day, stored as a Sofia day-start in UTC). Tracks whether the unit has
 * been marked cleaned. Either `cabinId` (single cabin) or `cabinTypeId` (multi-unit)
 * must be set, mirroring the Booking model.
 */
const cleaningRecordSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true
    },
    cabinId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cabin',
      default: null
    },
    cabinTypeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CabinType',
      default: null
    },
    unitId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Unit',
      default: null
    },
    // Sofia day start (UTC) for the day the cleaning is due (booking checkout day).
    cleaningDate: {
      type: Date,
      required: true
    },
    markedCleanedAt: {
      type: Date,
      default: null
    },
    // Authenticated OPS actor id (OpsUser id or legacy admin/operator subject).
    markedCleanedBy: {
      type: String,
      default: null
    },
    status: {
      type: String,
      enum: ['pending', 'cleaned'],
      default: 'pending'
    }
  },
  { timestamps: true }
);

cleaningRecordSchema.index({ bookingId: 1, cleaningDate: 1 }, { unique: true });
cleaningRecordSchema.index({ cleaningDate: 1 });
cleaningRecordSchema.index({ status: 1 });

// Exactly one of cabinId or cabinTypeId must be present (mirror Booking pattern).
cleaningRecordSchema.pre('validate', function (next) {
  if (this.cabinId && this.cabinTypeId) {
    return next(new Error('CleaningRecord cannot have both cabinId and cabinTypeId'));
  }
  if (!this.cabinId && !this.cabinTypeId) {
    return next(new Error('CleaningRecord must have either cabinId or cabinTypeId'));
  }
  next();
});

module.exports = mongoose.model('CleaningRecord', cleaningRecordSchema);
