const mongoose = require('mongoose');
const { roomAllocationField } = require('./schemas/roomAllocationSchema');

const LOCATION_BOOKING_STATUSES = Object.freeze([
  'pending',
  'confirmed',
  'in_house',
  'completed',
  'cancelled',
  'needs_review'
]);

const LOCATION_BOOKING_SOURCES = Object.freeze(['website']);

const locationBookingSchema = new mongoose.Schema(
  {
    locationKey: {
      type: String,
      required: [true, 'locationKey is required'],
      trim: true,
      index: true
    },
    checkIn: {
      type: Date,
      required: [true, 'Check-in date is required']
    },
    checkOut: {
      type: Date,
      required: [true, 'Check-out date is required']
    },
    adults: {
      type: Number,
      required: true,
      min: [1, 'At least 1 adult is required'],
      max: [100, 'Maximum 100 adults allowed']
    },
    children: {
      type: Number,
      default: 0,
      min: [0, 'Children count cannot be negative'],
      max: [100, 'Maximum 100 children allowed']
    },
    guestInfo: {
      firstName: {
        type: String,
        required: [true, 'First name is required'],
        trim: true,
        maxlength: [50, 'First name cannot exceed 50 characters']
      },
      lastName: {
        type: String,
        required: [true, 'Last name is required'],
        trim: true,
        maxlength: [50, 'Last name cannot exceed 50 characters']
      },
      email: {
        type: String,
        required: [true, 'Email is required'],
        trim: true,
        lowercase: true,
        maxlength: [100, 'Email cannot exceed 100 characters']
      },
      phone: {
        type: String,
        trim: true,
        maxlength: [30, 'Phone cannot exceed 30 characters'],
        default: null
      }
    },
    totalPrice: {
      type: Number,
      required: true,
      min: [0, 'Total price cannot be negative']
    },
    currency: {
      type: String,
      trim: true,
      uppercase: true,
      default: 'EUR'
    },
    stripePaymentIntentId: {
      type: String,
      trim: true,
      default: null
    },
    status: {
      type: String,
      enum: LOCATION_BOOKING_STATUSES,
      required: true,
      default: 'pending',
      index: true
    },
    childBookingIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Booking' }],
      default: []
    },
    /** Snapshot of resolveLocationTargets rows at quote/finalize time. */
    includedTargetSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    quoteSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    source: {
      type: String,
      enum: LOCATION_BOOKING_SOURCES,
      required: true,
      default: 'website'
    },
    /** Groups pre-payment holds and ties to location checkout session. */
    checkoutSessionId: {
      type: String,
      trim: true,
      default: null
    },
    confirmationEmailSentAt: {
      type: Date,
      default: null
    },
    /** Optional guest room distribution — OPS / cleaning prep only; never affects price. */
    roomAllocation: roomAllocationField
  },
  { timestamps: true }
);

locationBookingSchema.index(
  { checkoutSessionId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      checkoutSessionId: { $exists: true, $type: 'string', $gt: '' }
    }
  }
);

locationBookingSchema.index(
  { stripePaymentIntentId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      stripePaymentIntentId: { $exists: true, $type: 'string', $gt: '' }
    }
  }
);

locationBookingSchema.pre('validate', function validateDates(next) {
  if (this.checkIn && this.checkOut && this.checkOut <= this.checkIn) {
    return next(new Error('Check-out date must be after check-in date'));
  }
  return next();
});

module.exports = mongoose.model('LocationBooking', locationBookingSchema);
module.exports.LOCATION_BOOKING_STATUSES = LOCATION_BOOKING_STATUSES;
module.exports.LOCATION_BOOKING_SOURCES = LOCATION_BOOKING_SOURCES;
