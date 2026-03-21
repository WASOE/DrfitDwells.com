const mongoose = require('mongoose');

const reservationNoteSchema = new mongoose.Schema(
  {
    reservationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      index: true
    },
    author: {
      actorType: {
        type: String,
        enum: ['user', 'system'],
        required: true,
        default: 'user'
      },
      actorId: {
        type: String,
        required: true
      },
      role: {
        type: String,
        default: 'admin'
      }
    },
    content: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 5000
    },
    tombstone: {
      isTombstoned: { type: Boolean, default: false, index: true },
      tombstonedAt: { type: Date, default: null },
      tombstonedBy: { type: String, default: null },
      reason: { type: String, default: null }
    },
    editedAt: {
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

reservationNoteSchema.index({ reservationId: 1, createdAt: -1 });

reservationNoteSchema.pre('deleteOne', { document: false, query: true }, function preventDelete(next) {
  next(new Error('ReservationNote is tombstone-safe and cannot be hard deleted'));
});

reservationNoteSchema.pre('findOneAndDelete', function preventFindOneAndDelete(next) {
  next(new Error('ReservationNote is tombstone-safe and cannot be hard deleted'));
});

module.exports = mongoose.model('ReservationNote', reservationNoteSchema);
