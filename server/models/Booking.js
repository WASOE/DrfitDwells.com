const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  // Legacy single-cabin bookings (Stone House, Lux Cabin, Bachevo)
  cabinId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Cabin',
    required: function() {
      // Required only if this is NOT an A-frame booking (no cabinTypeId)
      return !this.cabinTypeId;
    }
  },
  // A-frame multi-unit bookings
  cabinTypeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CabinType',
    required: function() {
      // Required only if this is an A-frame booking (no cabinId)
      return !this.cabinId;
    }
  },
  unitId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Unit',
    // Optional - can be assigned later by assignment engine
    default: null
  },
  checkIn: {
    type: Date,
    required: [true, 'Check-in date is required'],
    validate: {
      validator: function(v) {
        return v > new Date();
      },
      message: 'Check-in date must be in the future'
    }
  },
  checkOut: {
    type: Date,
    required: [true, 'Check-out date is required'],
    validate: {
      validator: function(v) {
        return v > this.checkIn;
      },
      message: 'Check-out date must be after check-in date'
    }
  },
  adults: {
    type: Number,
    required: [true, 'Number of adults is required'],
    min: [1, 'At least 1 adult is required'],
    max: [10, 'Maximum 10 adults allowed']
  },
  children: {
    type: Number,
    default: 0,
    min: [0, 'Children count cannot be negative'],
    max: [10, 'Maximum 10 children allowed']
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'in_house', 'completed', 'cancelled'],
    default: 'pending'
  },
  /** Explicit gate for public outbound ICS; null/absent uses resolveBookingExportSafety() rules. */
  isProductionSafe: {
    type: Boolean,
    required: false
  },
  /** Demo / lab / fixture bookings — never exported on public ICS when true. */
  isTest: {
    type: Boolean,
    default: false
  },
  /** Soft-archive (maintenance); hidden from default OPS/admin/public lists. */
  archivedAt: {
    type: Date,
    default: null,
    index: true
  },
  archivedReason: {
    type: String,
    trim: true,
    maxlength: [500, 'Archive reason cannot exceed 500 characters'],
    default: null
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
      validate: {
        validator: function(v) {
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
        },
        message: 'Please provide a valid email address'
      }
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true
    }
  },
  totalPrice: {
    type: Number,
    required: true,
    min: [0, 'Total price cannot be negative']
  },
  specialRequests: {
    type: String,
    maxlength: [500, 'Special requests cannot exceed 500 characters']
  },
  tripType: {
    type: String,
    trim: true
  },
  transportMethod: {
    type: String,
    trim: true
  },
  romanticSetup: {
    type: Boolean,
    default: false
  },
  // Future-proof craft object
  craft: {
    version: {
      type: Number,
      default: 1
    },
    tripType: {
      type: String,
      trim: true
    },
    transportMethod: {
      type: String,
      trim: true
    },
    extras: {
      type: Object,
      default: {}
    }
  },
  /** Intake and lifecycle provenance (optional; do not use for authorization). */
  provenance: {
    type: new mongoose.Schema(
      {
        source: { type: String, trim: true },
        channel: { type: String, trim: true, default: null },
        intakeRevision: { type: Number, default: 1 },
        lastTransitionAt: { type: Date, default: null },
        lastTransition: { type: String, trim: true, default: null },
        createdByRoute: { type: String, trim: true, default: null }
      },
      { _id: false }
    ),
    default: undefined
  },
  /** Set when Stripe PaymentIntent was verified at booking creation (paid flow). */
  stripePaymentIntentId: {
    type: String,
    trim: true,
    default: null
  },
  /** First-touch marketing params captured on the client (attribution / ads). */
  attribution: {
    type: new mongoose.Schema(
      {
        utmSource: { type: String, trim: true, default: null },
        utmMedium: { type: String, trim: true, default: null },
        utmCampaign: { type: String, trim: true, default: null },
        utmTerm: { type: String, trim: true, default: null },
        utmContent: { type: String, trim: true, default: null },
        gclid: { type: String, trim: true, default: null },
        gbraid: { type: String, trim: true, default: null },
        wbraid: { type: String, trim: true, default: null },
        fbclid: { type: String, trim: true, default: null },
        msclkid: { type: String, trim: true, default: null },
        referrer: { type: String, trim: true, default: null },
        landingPath: { type: String, trim: true, default: null }
      },
      { _id: false }
    ),
    default: undefined
  },
  /** Meta CAPI Purchase succeeded at least once (set only on Graph API success, not when CAPI is skipped). */
  metaPurchaseSentAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Index for better query performance
bookingSchema.index({ cabinId: 1, checkIn: 1, checkOut: 1 });
bookingSchema.index({ cabinTypeId: 1, checkIn: 1, checkOut: 1 });
bookingSchema.index({ unitId: 1, checkIn: 1, checkOut: 1 });
bookingSchema.index({ status: 1 });
bookingSchema.index({ 'guestInfo.email': 1 });

// Validation: Must have either cabinId OR cabinTypeId, not both
bookingSchema.pre('validate', function(next) {
  if (this.cabinId && this.cabinTypeId) {
    return next(new Error('Booking cannot have both cabinId and cabinTypeId'));
  }
  if (!this.cabinId && !this.cabinTypeId) {
    return next(new Error('Booking must have either cabinId or cabinTypeId'));
  }
  next();
});

// Virtual for total nights
bookingSchema.virtual('totalNights').get(function() {
  const timeDiff = this.checkOut.getTime() - this.checkIn.getTime();
  return Math.ceil(timeDiff / (1000 * 3600 * 24));
});

// Ensure virtual fields are serialized
bookingSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Booking', bookingSchema);
