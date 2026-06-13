const mongoose = require('mongoose');

const opsNotificationSchema = new mongoose.Schema(
  {
    opsUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OpsUser',
      required: true,
      index: true
    },
    title: {
      type: String,
      required: true,
      maxlength: 200
    },
    body: {
      type: String,
      required: true,
      maxlength: 2000
    },
    url: {
      type: String,
      required: true,
      maxlength: 2048
    },
    source: {
      type: String,
      default: null,
      maxlength: 120
    },
    dedupeKey: {
      type: String,
      default: undefined,
      maxlength: 256
    },
    readAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

opsNotificationSchema.index(
  { opsUserId: 1, dedupeKey: 1 },
  {
    unique: true,
    partialFilterExpression: { dedupeKey: { $exists: true, $type: 'string' } }
  }
);

opsNotificationSchema.index({ opsUserId: 1, createdAt: -1 });

module.exports = mongoose.model('OpsNotification', opsNotificationSchema);
