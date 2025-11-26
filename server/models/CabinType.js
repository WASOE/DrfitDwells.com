const mongoose = require('mongoose');

/**
 * CabinType Model - For multi-unit cabin types (e.g., A-frames)
 * 
 * This model represents a type of cabin that has multiple identical units.
 * All shared attributes (description, images, pricing, amenities, etc.) live here.
 * Individual units are represented by the Unit model.
 * 
 * Scope: applies only to cabin types configured as multi-unit via feature flags.
 */
const cabinTypeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Cabin type name is required'],
    trim: true,
    maxlength: [100, 'Cabin type name cannot exceed 100 characters'],
    unique: true
  },
  slug: {
    type: String,
    required: [true, 'Slug is required'],
    trim: true,
    lowercase: true,
    unique: true,
    match: [/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens']
  },
  description: {
    type: String,
    required: [true, 'Cabin type description is required'],
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  capacity: {
    type: Number,
    required: [true, 'Cabin capacity is required'],
    min: [1, 'Capacity must be at least 1'],
    max: [20, 'Capacity cannot exceed 20']
  },
  pricePerNight: {
    type: Number,
    required: [true, 'Price per night is required'],
    min: [0, 'Price cannot be negative']
  },
  minNights: {
    type: Number,
    min: [1, 'Minimum nights must be at least 1'],
    default: 1
  },
  imageUrl: {
    type: String,
    required: [true, 'Image URL is required'],
    validate: {
      validator: function(v) {
        if (!v) return false;
        const isAbsolute = /^https?:\/\/.+\.(jpg|jpeg|png|webp)$/i.test(v);
        const isRelative = /^\/uploads\/.+\.(jpg|jpeg|png|webp)$/i.test(v);
        return isAbsolute || isRelative;
      },
      message: 'Please provide a valid image URL (HTTP/HTTPS or /uploads path)'
    }
  },
  images: [{
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    url: { type: String, required: true },
    alt: { type: String, default: '' },
    sort: { type: Number, default: 0 },
    isCover: { type: Boolean, default: false },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    bytes: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    tags: [{
      type: String,
      enum: ['bedroom', 'living_room', 'kitchen', 'dining', 'bathroom', 'outdoor', 'view', 'hot_tub_sauna', 'amenities', 'floorplan', 'map', 'other'],
      default: []
    }],
    spaceOrder: { type: Number, default: 0 }
  }],
  amenities: [{
    type: String,
    trim: true
  }],
  location: {
    type: String,
    required: [true, 'Location is required'],
    trim: true
  },
  geoLocation: {
    latitude: { type: Number },
    longitude: { type: Number },
    zoom: { type: Number, default: 11 }
  },
  hostName: {
    type: String,
    trim: true,
    default: 'Drift & Dwells'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  transportOptions: [{
    type: {
      type: String,
      required: true,
      enum: ['Horse', 'ATV', 'Jeep', 'Hike', 'Boat', 'Helicopter']
    },
    pricePerPerson: {
      type: Number,
      required: true,
      min: [0, 'Price cannot be negative']
    },
    description: {
      type: String,
      required: true
    },
    duration: {
      type: String,
      required: true
    },
    isAvailable: {
      type: Boolean,
      default: true
    }
  }],
  meetingPoint: {
    label: {
      type: String,
      trim: true,
      maxlength: [200, 'Meeting point label cannot exceed 200 characters']
    },
    googleMapsUrl: {
      type: String,
      validate: {
        validator: function(v) {
          if (!v) return true;
          return /^https?:\/\/maps\.google\./.test(v);
        },
        message: 'Please provide a valid Google Maps URL'
      }
    },
    what3words: {
      type: String,
      trim: true,
      validate: {
        validator: function(v) {
          if (!v) return true;
          return /^[a-z]+\.[a-z]+\.[a-z]+$/i.test(v);
        },
        message: 'Please provide valid what3words format (e.g., "table.chair.lamp")'
      }
    },
    lat: {
      type: Number,
      min: [-90, 'Latitude must be between -90 and 90'],
      max: [90, 'Latitude must be between -90 and 90']
    },
    lng: {
      type: Number,
      min: [-180, 'Longitude must be between -180 and 180'],
      max: [180, 'Longitude must be between -180 and 180']
    }
  },
  packingList: [{
    type: String,
    trim: true,
    maxlength: [100, 'Packing item cannot exceed 100 characters']
  }],
  arrivalGuideUrl: {
    type: String,
    validate: {
      validator: function(v) {
        if (!v) return true;
        return /^https?:\/\/.+\.pdf$/i.test(v);
      },
      message: 'Please provide a valid PDF URL'
    }
  },
  safetyNotes: {
    type: String,
    trim: true,
    maxlength: [1000, 'Safety notes cannot exceed 1000 characters']
  },
  emergencyContact: {
    type: String,
    trim: true,
    maxlength: [200, 'Emergency contact cannot exceed 200 characters']
  },
  arrivalWindowDefault: {
    type: String,
    trim: true,
    maxlength: [50, 'Arrival window cannot exceed 50 characters']
  },
  transportCutoffs: [{
    type: {
      type: String,
      required: true,
      enum: ['Horse', 'ATV', 'Jeep', 'Hike', 'Boat', 'Helicopter']
    },
    lastDeparture: {
      type: String,
      required: true,
      validate: {
        validator: function(v) {
          return /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(v);
        },
        message: 'Please provide time in HH:MM format (e.g., "16:30")'
      }
    }
  }],
  reviewsCount: {
    type: Number,
    default: 0,
    min: 0
  },
  averageRating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  avgResponseTimeHours: {
    type: Number,
    min: 0
  },
  highlights: [{ type: String, maxlength: 100 }],
  experiences: [
    {
      key: { type: String, required: true },
      name: { type: String, required: true },
      price: { type: Number, required: true },
      currency: { type: String, default: 'BGN' },
      unit: { type: String, enum: ['per_guest', 'flat_per_stay'], default: 'flat_per_stay' },
      active: { type: Boolean, default: true },
      sortOrder: { type: Number, default: 0 }
    }
  ],
  badges: {
    superhost: {
      enabled: { type: Boolean, default: false },
      label: { type: String, default: 'Superhost' }
    },
    guestFavorite: {
      enabled: { type: Boolean, default: false },
      label: { type: String, default: 'Guest favorite' }
    }
  }
}, {
  timestamps: true
});

// Indexes
cabinTypeSchema.index({ isActive: 1 });

module.exports = mongoose.model('CabinType', cabinTypeSchema);

