const mongoose = require('mongoose');

const cabinChannelSyncStateSchema = new mongoose.Schema(
  {
    cabinId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cabin',
      required: true,
      index: true
    },
    channel: {
      type: String,
      required: true,
      enum: ['airbnb_ical'],
      index: true
    },
    feedUrl: {
      type: String,
      default: null
    },
    /** When set, inbound Airbnb iCal is for this physical unit only (required for inventoryType multi parent cabins). */
    unitId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Unit',
      default: null,
      index: true
    },
    lastSyncedAt: {
      type: Date,
      default: null,
      index: true
    },
    lastSyncOutcome: {
      type: String,
      enum: ['success', 'warning', 'failed', null],
      default: null,
      index: true
    },
    lastSyncMessage: {
      type: String,
      default: null
    },
    metadata: {
      type: Object,
      default: {}
    }
  },
  { timestamps: true }
);

cabinChannelSyncStateSchema.index({ cabinId: 1, channel: 1, unitId: 1 }, { unique: true });

module.exports = mongoose.model('CabinChannelSyncState', cabinChannelSyncStateSchema);
