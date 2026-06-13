const mongoose = require('mongoose');

const pushSubscriptionKeysSchema = new mongoose.Schema(
  {
    p256dh: { type: String, required: true },
    auth: { type: String, required: true }
  },
  { _id: false }
);

const opsPushSubscriptionSchema = new mongoose.Schema(
  {
    opsUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OpsUser',
      required: true,
      index: true
    },
    endpoint: {
      type: String,
      required: true,
      trim: true
    },
    keys: {
      type: pushSubscriptionKeysSchema,
      required: true
    },
    userAgent: {
      type: String,
      default: null,
      maxlength: 512
    },
    lastSuccessAt: {
      type: Date,
      default: null
    },
    invalidatedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: true }
  }
);

opsPushSubscriptionSchema.index({ endpoint: 1 }, { unique: true, sparse: true });
opsPushSubscriptionSchema.index({ opsUserId: 1, invalidatedAt: 1 });

module.exports = mongoose.model('OpsPushSubscription', opsPushSubscriptionSchema);
