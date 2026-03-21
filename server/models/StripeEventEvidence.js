const mongoose = require('mongoose');

const stripeEventEvidenceSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      required: true,
      immutable: true,
      unique: true,
      index: true
    },
    eventType: {
      type: String,
      required: true,
      immutable: true,
      index: true
    },
    objectType: {
      type: String,
      default: null,
      immutable: true
    },
    objectId: {
      type: String,
      default: null,
      immutable: true,
      index: true
    },
    createdAtProvider: {
      type: Date,
      required: true,
      immutable: true
    },
    livemode: {
      type: Boolean,
      default: false,
      immutable: true
    },
    payloadDigest: {
      type: String,
      required: true,
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

stripeEventEvidenceSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'], function rejectUpdates(next) {
  next(new Error('StripeEventEvidence is append-only and immutable'));
});
stripeEventEvidenceSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete', 'findByIdAndDelete'], function rejectDeletes(next) {
  next(new Error('StripeEventEvidence is append-only and immutable'));
});

module.exports = mongoose.model('StripeEventEvidence', stripeEventEvidenceSchema);
