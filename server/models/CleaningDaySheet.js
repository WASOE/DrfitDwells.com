const mongoose = require('mongoose');

const perCheckoutInputSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true
    },
    inputs: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({})
    }
  },
  { _id: false }
);

/**
 * CleaningDaySheet — manual operational inputs for a cleaning day (laundry count,
 * optional add-ons, transport toggle, etc.). Consumed by the pricing service.
 */
const cleaningDaySheetSchema = new mongoose.Schema(
  {
    // Sofia day start (UTC).
    date: {
      type: Date,
      required: true
    },
    propertyKind: {
      type: String,
      enum: ['cabin', 'valley'],
      required: true
    },
    inputs: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({})
    },
    perCheckoutInputs: {
      type: [perCheckoutInputSchema],
      default: []
    },
    updatedBy: {
      type: String,
      default: null
    }
  },
  { timestamps: true }
);

cleaningDaySheetSchema.index({ date: 1, propertyKind: 1 }, { unique: true });

module.exports = mongoose.model('CleaningDaySheet', cleaningDaySheetSchema);
