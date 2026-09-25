'use strict';

const mongoose = require('mongoose');

const nightlyRateOverrideSchema = new mongoose.Schema(
  {
    ratePlanCode: { type: String, required: true, trim: true, lowercase: true },
    ratePlanVersion: { type: Number, required: true, min: 1 },
    entityType: { type: String, required: true, enum: ['cabin', 'cabinType'] },
    accommodationKey: { type: String, required: true, trim: true, lowercase: true },
    dateKey: {
      type: String,
      required: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, 'dateKey must be YYYY-MM-DD in Europe/Sofia']
    },
    baseNightlyAmountCents: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: Number.isInteger, message: 'baseNightlyAmountCents must be an integer' }
    },
    source: {
      type: String,
      enum: ['manual', 'system_recommendation'],
      default: 'manual'
    },
    reason: { type: String, trim: true, maxlength: 500, default: null },
    recommendation: { type: String, trim: true, maxlength: 500, default: null },
    recommendationId: { type: String, trim: true, maxlength: 160, default: null },
    acceptedAt: { type: Date, default: null },
    acceptedBy: { type: String, trim: true, maxlength: 160, default: null },
    createdBy: { type: String, trim: true, maxlength: 160, default: null },
    updatedBy: { type: String, trim: true, maxlength: 160, default: null }
  },
  { timestamps: true }
);

nightlyRateOverrideSchema.index(
  { ratePlanCode: 1, ratePlanVersion: 1, entityType: 1, accommodationKey: 1, dateKey: 1 },
  { unique: true }
);

module.exports = mongoose.model('NightlyRateOverride', nightlyRateOverrideSchema);
