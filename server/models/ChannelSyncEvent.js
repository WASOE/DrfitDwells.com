const mongoose = require('mongoose');

const SYNC_OUTCOMES = ['success', 'warning', 'failed'];
const CHANNELS = ['airbnb_ical'];

const channelSyncEventSchema = new mongoose.Schema(
  {
    cabinId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cabin',
      required: true,
      immutable: true,
      index: true
    },
    channel: {
      type: String,
      enum: CHANNELS,
      required: true,
      immutable: true,
      index: true
    },
    runAt: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true,
      index: true
    },
    outcome: {
      type: String,
      enum: SYNC_OUTCOMES,
      required: true,
      immutable: true,
      index: true
    },
    sourceReference: {
      type: String,
      default: null,
      immutable: true
    },
    message: {
      type: String,
      default: '',
      immutable: true
    },
    stats: {
      type: Object,
      default: {},
      immutable: true
    },
    anomalyType: {
      type: String,
      default: null,
      immutable: true
    },
    metadata: {
      type: Object,
      default: {},
      immutable: true
    }
  },
  { timestamps: true, versionKey: false }
);

channelSyncEventSchema.index({ cabinId: 1, channel: 1, runAt: -1 });

channelSyncEventSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'], function rejectUpdates(next) {
  next(new Error('ChannelSyncEvent history is append-only and immutable'));
});
channelSyncEventSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete', 'findByIdAndDelete'], function rejectDeletes(next) {
  next(new Error('ChannelSyncEvent history is append-only and immutable'));
});

module.exports = mongoose.model('ChannelSyncEvent', channelSyncEventSchema);
module.exports.SYNC_OUTCOMES = SYNC_OUTCOMES;
module.exports.SYNC_CHANNELS = CHANNELS;
