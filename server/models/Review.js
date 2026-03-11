const mongoose = require('mongoose');
const { sanitizeName } = require('../utils/nameUtils');

const OwnerResponseSchema = new mongoose.Schema({
  text: { type: String, trim: true },
  respondedBy: { type: String, trim: true },
  respondedAt: { type: Date, default: Date.now }
}, { _id: false });

const ReviewSchema = new mongoose.Schema({
  cabinId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Cabin', 
    index: true, 
    required: true 
  },
  externalId: { 
    type: String, 
    unique: true, 
    sparse: true,
    index: true
  },
  source: { 
    type: String, 
    enum: ['airbnb', 'manual', 'import'], 
    default: 'manual',
    index: true
  },
  rating: { 
    type: Number, 
    min: 1, 
    max: 5, 
    required: true,
    index: true
  },
  text: { 
    type: String, 
    required: true,
    trim: true
  },
  reviewerName: { 
    type: String, 
    default: null,
    trim: true,
    maxlength: [60, 'Reviewer name cannot exceed 60 characters'],
    validate: {
      validator: function(v) {
        // Allow null/undefined (will be set to 'Guest' in pre-save)
        if (!v || v === null || v === undefined) return true;
        // If provided, must be a non-empty string after trim
        return typeof v === 'string' && v.trim().length > 0;
      },
      message: 'Reviewer name must be a non-empty string or null'
    }
  },
  reviewerId: {
    type: String,
    trim: true,
    index: true
  },
  reviewHighlight: {
    type: String,
    trim: true,
    maxlength: [100, 'Review highlight cannot exceed 100 characters']
  },
  highlightType: {
    type: String,
    enum: ['LENGTH_OF_STAY', 'TYPE_OF_TRIP', null],
    default: null
  },
  language: { 
    type: String, 
    default: 'en',
    trim: true
  },
  createdAtSource: { 
    type: Date,
    default: Date.now,
    index: true
  },
  localizedDate: { 
    type: String 
  },

  status: { 
    type: String, 
    enum: ['approved', 'pending', 'hidden'], 
    default: 'approved', 
    index: true 
  },
  pinned: { 
    type: Boolean, 
    default: false, 
    index: true 
  },
  locked: { 
    type: Boolean, 
    default: false 
  },

  ownerResponse: { 
    type: OwnerResponseSchema, 
    default: undefined 
  },
  moderationNotes: { 
    type: String,
    trim: true
  },

  editedAt: { 
    type: Date 
  },
  editedBy: { 
    type: String,
    trim: true
  },
  deletedAt: { 
    type: Date,
    default: null
  },

  raw: { type: Object, select: false } // provenance; never expose publicly
}, { 
  timestamps: true 
});

// Compound indexes
ReviewSchema.index({ cabinId: 1, createdAtSource: -1 });
ReviewSchema.index({ status: 1, rating: -1 });
ReviewSchema.index({ text: 'text', reviewerName: 'text' });

// Pre-save hook: sanitize reviewerName and set createdAtSource
ReviewSchema.pre('save', function(next) {
  // Set createdAtSource if not provided
  if (!this.createdAtSource && this.isNew) {
    this.createdAtSource = this.createdAt || new Date();
  }
  
  // Sanitize reviewerName: if provided, sanitize it; if empty/null, set to null (will display as "Guest" in UI)
  if (this.reviewerName !== undefined && this.reviewerName !== null) {
    const sanitized = sanitizeName(this.reviewerName);
    this.reviewerName = sanitized || null; // Store null instead of empty string
  } else {
    // If explicitly null or undefined, keep it null
    this.reviewerName = null;
  }
  
  next();
});

module.exports = mongoose.model('Review', ReviewSchema);

