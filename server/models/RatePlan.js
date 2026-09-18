/**
 * RatePlan — versioned, server-owned commercial rate definition.
 *
 * Foundation only (B1): not wired to live pricing, quotes, availability, or checkout.
 * Money: euro Number values (two-decimal convention), not integer cents.
 * Accommodation keys use stable public slugs (e.g. a-frame, lux-cabin, stone-house).
 */
'use strict';

const mongoose = require('mongoose');

const RATE_PLAN_STATUSES = ['draft', 'active', 'retired'];
const RATE_PLAN_TYPES = ['seasonal_stay', 'fixed_package'];
const RATE_PLAN_CURRENCIES = ['EUR'];
const INVENTORY_MODES = ['shared', 'exclusive'];
const PRICING_METHODS = [
  'nightly_per_unit',
  'nightly_base_plus_extra_guest',
  'fixed_per_unit',
  'fixed_per_participant'
];
const ENTITY_TYPES = ['cabin', 'cabinType'];

const accommodationPricingSchema = new mongoose.Schema(
  {
    /** Stable public identifier (Cabin.slug / CabinType.slug). */
    accommodationKey: {
      type: String,
      required: [true, 'accommodationKey is required'],
      trim: true,
      lowercase: true,
      maxlength: [80, 'accommodationKey cannot exceed 80 characters']
    },
    entityType: {
      type: String,
      required: [true, 'entityType is required'],
      enum: {
        values: ENTITY_TYPES,
        message: 'entityType must be cabin or cabinType'
      }
    },
    /**
     * Pricing method for this accommodation under the plan.
     * Per-row because one commercial plan may mix unit and participant methods
     * (e.g. seasonal nightly flat + base_plus_extra; fixed unit + participant).
     */
    pricingMethod: {
      type: String,
      required: [true, 'pricingMethod is required'],
      enum: {
        values: PRICING_METHODS,
        message: 'Unsupported pricingMethod'
      }
    },
    nightlyPerUnitAmount: { type: Number, min: [0, 'Price cannot be negative'], default: null },
    includedGuests: { type: Number, min: [0, 'includedGuests cannot be negative'], default: null },
    additionalGuestNightlyAmount: {
      type: Number,
      min: [0, 'Price cannot be negative'],
      default: null
    },
    fixedPerUnitAmount: { type: Number, min: [0, 'Price cannot be negative'], default: null },
    adultPackageAmount: { type: Number, min: [0, 'Price cannot be negative'], default: null },
    childPackageAmount: { type: Number, min: [0, 'Price cannot be negative'], default: null },
    infantPackageAmount: { type: Number, min: [0, 'Price cannot be negative'], default: null }
  },
  { _id: false }
);

const ratePlanSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, 'Rate plan code is required'],
      trim: true,
      lowercase: true,
      minlength: [2, 'Code must be at least 2 characters'],
      maxlength: [80, 'Code cannot exceed 80 characters'],
      match: [/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Code must be lowercase kebab-case']
    },
    internalName: {
      type: String,
      required: [true, 'Internal name is required'],
      trim: true,
      maxlength: [160, 'Internal name cannot exceed 160 characters']
    },
    version: {
      type: Number,
      required: [true, 'Version is required'],
      min: [1, 'Version must be a positive integer'],
      validate: {
        validator(v) {
          return Number.isInteger(v);
        },
        message: 'Version must be a positive integer'
      }
    },
    status: {
      type: String,
      required: true,
      enum: {
        values: RATE_PLAN_STATUSES,
        message: 'Status must be draft, active, or retired'
      },
      default: 'draft'
    },
    type: {
      type: String,
      required: [true, 'Rate plan type is required'],
      enum: {
        values: RATE_PLAN_TYPES,
        message: 'Type must be seasonal_stay or fixed_package'
      }
    },
    currency: {
      type: String,
      required: true,
      enum: {
        values: RATE_PLAN_CURRENCIES,
        message: 'Unsupported currency'
      },
      default: 'EUR'
    },
    /** Inclusive calendar arrival window start (YYYY-MM-DD semantics via Date UTC day). */
    arrivalWindowStart: { type: Date, default: null },
    /** Inclusive calendar last night / last arrival day end bound (see service date rules). */
    arrivalWindowEnd: { type: Date, default: null },
    bookingWindowStart: { type: Date, default: null },
    bookingWindowEnd: { type: Date, default: null },
    minNights: {
      type: Number,
      required: true,
      min: [1, 'Minimum nights must be at least 1'],
      default: 1,
      validate: {
        validator(v) {
          return Number.isInteger(v);
        },
        message: 'minNights must be an integer'
      }
    },
    /** Exact package arrival (fixed_package). */
    packageArrivalDate: { type: Date, default: null },
    /** Exact package departure (fixed_package). */
    packageDepartureDate: { type: Date, default: null },
    inventoryMode: {
      type: String,
      required: true,
      enum: {
        values: INVENTORY_MODES,
        message: 'inventoryMode must be shared or exclusive'
      }
    },
    requiresFullPayment: {
      type: Boolean,
      required: true,
      default: true
    },
    cancellationPolicyCode: {
      type: String,
      required: [true, 'cancellationPolicyCode is required'],
      trim: true,
      lowercase: true,
      maxlength: [80, 'cancellationPolicyCode cannot exceed 80 characters']
    },
    cancellationPolicyVersion: {
      type: Number,
      required: [true, 'cancellationPolicyVersion is required'],
      min: [1, 'cancellationPolicyVersion must be a positive integer'],
      validate: {
        validator(v) {
          return Number.isInteger(v);
        },
        message: 'cancellationPolicyVersion must be a positive integer'
      }
    },
    inclusions: {
      type: [{ type: String, trim: true, maxlength: 200 }],
      default: []
    },
    accommodations: {
      type: [accommodationPricingSchema],
      required: true,
      validate: {
        validator(v) {
          return Array.isArray(v) && v.length > 0;
        },
        message: 'At least one accommodation pricing entry is required'
      }
    }
  },
  { timestamps: true }
);

ratePlanSchema.index({ code: 1, version: 1 }, { unique: true });
ratePlanSchema.index({ status: 1, type: 1, arrivalWindowStart: 1, arrivalWindowEnd: 1 });

module.exports = mongoose.model('RatePlan', ratePlanSchema);
module.exports.RATE_PLAN_STATUSES = RATE_PLAN_STATUSES;
module.exports.RATE_PLAN_TYPES = RATE_PLAN_TYPES;
module.exports.RATE_PLAN_CURRENCIES = RATE_PLAN_CURRENCIES;
module.exports.INVENTORY_MODES = INVENTORY_MODES;
module.exports.PRICING_METHODS = PRICING_METHODS;
module.exports.ENTITY_TYPES = ENTITY_TYPES;
