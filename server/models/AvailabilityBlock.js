const mongoose = require('mongoose');

const BLOCK_TYPES = ['reservation', 'manual_block', 'maintenance', 'external_hold'];
const BLOCK_STATUS = ['active', 'tombstoned'];

const availabilityBlockSchema = new mongoose.Schema(
  {
    cabinId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cabin',
      required: true,
      index: true
    },
    unitId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Unit',
      default: null,
      index: true
    },
    reservationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
      index: true
    },
    blockType: {
      type: String,
      enum: BLOCK_TYPES,
      required: true,
      index: true
    },
    startDate: {
      type: Date,
      required: true,
      index: true
    },
    endDate: {
      type: Date,
      required: true,
      index: true
    },
    status: {
      type: String,
      enum: BLOCK_STATUS,
      default: 'active',
      index: true
    },
    tombstonedAt: {
      type: Date,
      default: null
    },
    tombstoneReason: {
      type: String,
      trim: true,
      default: null
    },
    source: {
      type: String,
      trim: true,
      required: true,
      default: 'internal'
    },
    sourceReference: {
      type: String,
      trim: true,
      default: null
    },
    importedAt: {
      type: Date,
      default: null
    },
    confidence: {
      type: String,
      trim: true,
      default: null
    },
    metadata: {
      type: Object,
      default: {}
    }
  },
  { timestamps: true }
);

availabilityBlockSchema.index({ cabinId: 1, startDate: 1, endDate: 1, status: 1 });
availabilityBlockSchema.index({ source: 1, sourceReference: 1 }, { sparse: true });

availabilityBlockSchema.pre('validate', function validateExclusiveEnd(next) {
  if (!this.startDate || !this.endDate) {
    return next();
  }
  if (this.startDate >= this.endDate) {
    return next(new Error('AvailabilityBlock requires exclusive end range [startDate, endDate)'));
  }
  if (this.blockType === 'external_hold' && this.status === 'tombstoned' && !this.tombstonedAt) {
    this.tombstonedAt = new Date();
  }
  return next();
});

module.exports = mongoose.model('AvailabilityBlock', availabilityBlockSchema);
module.exports.BLOCK_TYPES = BLOCK_TYPES;
module.exports.BLOCK_STATUS = BLOCK_STATUS;
