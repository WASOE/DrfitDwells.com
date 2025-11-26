const mongoose = require('mongoose');

/**
 * Unit Model - Individual units within a CabinType (A-frames only)
 * 
 * Each unit represents one physical A-frame (e.g., AF-01, AF-02, ... AF-13).
 * Units share all attributes from their CabinType but can have:
 * - Individual blocked dates
 * - Unit-specific notes (for admin)
 * - Unit number/identifier
 * 
 * Scope: A-frames only. Other cabins remain as single Cabin records.
 */
const unitSchema = new mongoose.Schema({
  cabinTypeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CabinType',
    required: [true, 'Cabin type ID is required'],
    index: true
  },
  unitNumber: {
    type: String,
    required: [true, 'Unit number is required'],
    trim: true,
    maxlength: [20, 'Unit number cannot exceed 20 characters']
  },
  displayName: {
    type: String,
    trim: true,
    maxlength: [100, 'Display name cannot exceed 100 characters']
  },
  // Unit-specific blocked dates (in addition to any type-level blocks)
  blockedDates: [{
    type: Date,
    default: []
  }],
  // Admin notes for this specific unit
  adminNotes: {
    type: String,
    trim: true,
    maxlength: [500, 'Admin notes cannot exceed 500 characters']
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // Optional: Unit-specific location coordinates if they differ from type
  geoLocation: {
    latitude: { type: Number },
    longitude: { type: Number }
  }
}, {
  timestamps: true
});

// Compound index for unique unit numbers per type
unitSchema.index({ cabinTypeId: 1, unitNumber: 1 }, { unique: true });
unitSchema.index({ isActive: 1 });
unitSchema.index({ cabinTypeId: 1, isActive: 1 });

// Virtual for full unit identifier (e.g., "AF-01")
unitSchema.virtual('fullIdentifier').get(function() {
  return this.unitNumber;
});

// Ensure virtual fields are serialized
unitSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Unit', unitSchema);




