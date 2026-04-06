const mongoose = require('mongoose');

const promoCodeSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      minlength: [2, 'Code must be at least 2 characters'],
      maxlength: [40, 'Code cannot exceed 40 characters']
    },
    internalName: {
      type: String,
      required: true,
      trim: true,
      maxlength: [120, 'Internal name cannot exceed 120 characters']
    },
    discountType: {
      type: String,
      required: true,
      enum: ['fixed', 'percent']
    },
    discountValue: {
      type: Number,
      required: true,
      min: [0, 'Discount value cannot be negative']
    },
    isActive: {
      type: Boolean,
      default: true
    },
    validFrom: {
      type: Date,
      default: null
    },
    validUntil: {
      type: Date,
      default: null
    },
    startsAt: {
      type: Date,
      default: null
    },
    endsAt: {
      type: Date,
      default: null
    },
    usageLimit: {
      type: Number,
      default: null,
      min: [0, 'Usage limit cannot be negative']
    },
    minSubtotal: {
      type: Number,
      default: null,
      min: [0, 'Minimum subtotal cannot be negative']
    },
    usageCount: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  { timestamps: true }
);

promoCodeSchema.index({ code: 1 }, { unique: true });

module.exports = mongoose.model('PromoCode', promoCodeSchema);
