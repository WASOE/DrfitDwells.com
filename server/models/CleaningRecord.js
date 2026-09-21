const mongoose = require('mongoose');

/**
 * CleaningRecord — per-turnover cleaning row for the cleaning portal.
 *
 * Source-neutral identity:
 * - sourceKind 'booking' + sourceId = Booking._id (legacy bookingId also set)
 * - sourceKind 'external_hold' + sourceId = AvailabilityBlock._id
 *   (sourceReference stored for sync-stable lookup)
 *
 * cleaningDate is the Sofia day-start (UTC) of the unit's checkout day.
 * Cleaning status and payment status are independent.
 */
const cleaningRecordSchema = new mongoose.Schema(
  {
    sourceKind: {
      type: String,
      enum: ['booking', 'external_hold'],
      default: 'booking',
      required: true,
      index: true
    },
    /** Booking._id or AvailabilityBlock._id as string — stable primary task key with cleaningDate. */
    sourceId: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    /** Legacy booking linkage (required when sourceKind=booking). */
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
      index: true
    },
    availabilityBlockId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AvailabilityBlock',
      default: null,
      index: true
    },
    /** Sync-stable external key (e.g. airbnb_ical:uid:...). */
    sourceReference: {
      type: String,
      trim: true,
      default: null,
      index: true
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
    cleaningDate: {
      type: Date,
      required: true
    },
    markedCleanedAt: {
      type: Date,
      default: null
    },
    markedCleanedBy: {
      type: String,
      default: null
    },
    status: {
      type: String,
      enum: ['pending', 'cleaned'],
      default: 'pending'
    },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid'],
      default: 'unpaid'
    },
    markedPaidAt: {
      type: Date,
      default: null
    },
    markedPaidBy: {
      type: String,
      default: null
    }
  },
  { timestamps: true }
);

cleaningRecordSchema.index({ sourceKind: 1, sourceId: 1, cleaningDate: 1 }, { unique: true });
cleaningRecordSchema.index(
  { bookingId: 1, cleaningDate: 1 },
  {
    unique: true,
    partialFilterExpression: { bookingId: { $type: 'objectId' } }
  }
);
cleaningRecordSchema.index({ cleaningDate: 1 });
cleaningRecordSchema.index({ status: 1 });
cleaningRecordSchema.index({ paymentStatus: 1 });

cleaningRecordSchema.pre('validate', function (next) {
  if (this.cabinId && this.cabinTypeId) {
    return next(new Error('CleaningRecord cannot have both cabinId and cabinTypeId'));
  }
  if (!this.cabinId && !this.cabinTypeId) {
    return next(new Error('CleaningRecord must have either cabinId or cabinTypeId'));
  }
  if (!this.sourceId) {
    return next(new Error('CleaningRecord requires sourceId'));
  }
  if (this.sourceKind === 'booking') {
    if (!this.bookingId) {
      return next(new Error('booking CleaningRecord requires bookingId'));
    }
    this.sourceId = String(this.bookingId);
  }
  if (this.sourceKind === 'external_hold') {
    if (!this.availabilityBlockId) {
      return next(new Error('external_hold CleaningRecord requires availabilityBlockId'));
    }
    this.sourceId = String(this.availabilityBlockId);
    this.bookingId = null;
  }
  next();
});

module.exports = mongoose.model('CleaningRecord', cleaningRecordSchema);
