const mongoose = require('mongoose');

const guestSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      trim: true,
      required: true,
      maxlength: 80
    },
    lastName: {
      type: String,
      trim: true,
      required: true,
      maxlength: 80
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      required: true,
      index: true
    },
    phone: {
      type: String,
      trim: true,
      default: null
    },
    source: {
      type: String,
      trim: true,
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
    metadata: {
      type: Object,
      default: {}
    }
  },
  { timestamps: true }
);

guestSchema.index({ source: 1, sourceReference: 1 });

module.exports = mongoose.model('Guest', guestSchema);
