const mongoose = require('mongoose');

const locationEnquirySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 320
    },
    phone: {
      type: String,
      trim: true,
      maxlength: 40,
      default: null
    },
    checkIn: {
      type: String,
      required: true,
      trim: true
    },
    checkOut: {
      type: String,
      required: true,
      trim: true
    },
    adults: {
      type: Number,
      required: true,
      min: 0
    },
    children: {
      type: Number,
      default: 0,
      min: 0
    },
    message: {
      type: String,
      trim: true,
      maxlength: 4000,
      default: ''
    },
    locationKey: {
      type: String,
      required: true,
      trim: true
    },
    locationSlug: {
      type: String,
      required: true,
      trim: true
    },
    quoteSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    },
    status: {
      type: String,
      enum: ['new', 'reviewed', 'closed'],
      default: 'new',
      index: true
    },
    notificationSent: {
      type: Boolean,
      default: false
    }
  },
  { timestamps: true }
);

locationEnquirySchema.index({ createdAt: -1 });
locationEnquirySchema.index({ locationKey: 1, createdAt: -1 });

module.exports = mongoose.model('LocationEnquiry', locationEnquirySchema);
