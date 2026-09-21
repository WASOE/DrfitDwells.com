/**
 * BookableAddOn — versioned, server-owned sellable add-on catalog.
 *
 * B6 foundation: firewood packs and future generic add-ons.
 * Money: euro Number (two-decimal), not integer cents.
 * Not wired to public checkout or Stripe in B6.
 */
'use strict';

const mongoose = require('mongoose');

const ADD_ON_STATUSES = ['draft', 'active', 'retired'];
const ADD_ON_CURRENCIES = ['EUR'];
const CHARGE_UNITS = ['per_firing'];

const bookableAddOnSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, 'Add-on code is required'],
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
    publicName: {
      type: String,
      required: [true, 'Public name is required'],
      trim: true,
      maxlength: [160, 'Public name cannot exceed 160 characters']
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
        values: ADD_ON_STATUSES,
        message: 'Status must be draft, active, or retired'
      },
      default: 'draft'
    },
    currency: {
      type: String,
      required: true,
      enum: {
        values: ADD_ON_CURRENCIES,
        message: 'Unsupported currency'
      },
      default: 'EUR'
    },
    /** Euro amount charged per chargeUnit. */
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [0, 'Price cannot be negative']
    },
    chargeUnit: {
      type: String,
      required: [true, 'chargeUnit is required'],
      enum: {
        values: CHARGE_UNITS,
        message: 'Unsupported charge unit'
      }
    },
    description: {
      type: String,
      trim: true,
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
      default: ''
    },
    includedItems: {
      type: [{ type: String, trim: true, maxlength: 200 }],
      default: []
    },
    validFrom: {
      type: Date,
      default: null
    },
    validUntil: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

bookableAddOnSchema.index({ code: 1, version: 1 }, { unique: true });
bookableAddOnSchema.index({ status: 1, code: 1 });

module.exports = mongoose.model('BookableAddOn', bookableAddOnSchema);
module.exports.ADD_ON_STATUSES = ADD_ON_STATUSES;
module.exports.ADD_ON_CURRENCIES = ADD_ON_CURRENCIES;
module.exports.CHARGE_UNITS = CHARGE_UNITS;
