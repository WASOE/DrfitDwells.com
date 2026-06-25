const mongoose = require('mongoose');

const EmailDeliveryStateSchema = new mongoose.Schema(
  {
    correlationKey: { type: String, required: true, unique: true, index: true },
    domain: { type: String, enum: ['booking_lifecycle', 'gift_voucher'], required: true, index: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', index: true },
    giftVoucherId: { type: mongoose.Schema.Types.ObjectId, ref: 'GiftVoucher', index: true },
    templateKey: { type: String, index: true },
    templateKind: { type: String, index: true },
    recipient: { type: String, required: true, index: true },
    latestStatus: { type: String, enum: ['success', 'failed', 'skipped'], required: true, index: true },
    latestEventAt: { type: Date, required: true, index: true },
    latestEmailEventId: { type: mongoose.Schema.Types.ObjectId, ref: 'EmailEvent' },
    latestLifecycleSource: { type: String, enum: ['automatic', 'manual_resend'], index: true },
    latestErrorMessage: { type: String },
    resolvedAt: { type: Date },
    resolvedBy: { type: String },
    resolutionNote: { type: String }
  },
  { timestamps: true }
);

EmailDeliveryStateSchema.index({ latestStatus: 1, latestEventAt: -1 });

module.exports = mongoose.model('EmailDeliveryState', EmailDeliveryStateSchema);
