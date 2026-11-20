'use strict';

const mongoose = require('mongoose');

const CABIN_PRIORITY_LIST_CABINS = Object.freeze(['the-cabin']);

const cabinPriorityListSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      index: true
    },
    cabinId: {
      type: String,
      required: true,
      enum: CABIN_PRIORITY_LIST_CABINS,
      default: 'the-cabin'
    },
    preferredMonth: {
      type: String,
      default: null,
      maxlength: 20
    },
    checkIn: {
      type: Date,
      default: null
    },
    checkOut: {
      type: Date,
      default: null
    },
    language: {
      type: String,
      enum: ['en', 'bg'],
      default: 'en'
    },
    sourcePath: {
      type: String,
      default: null,
      maxlength: 500
    },
    sourcePage: {
      type: String,
      default: null,
      maxlength: 100
    },
    attribution: {
      utmSource: { type: String, default: null, maxlength: 300 },
      utmMedium: { type: String, default: null, maxlength: 300 },
      utmCampaign: { type: String, default: null, maxlength: 300 },
      referrer: { type: String, default: null, maxlength: 500 },
      landingPath: { type: String, default: null, maxlength: 500 }
    },
    consent: {
      type: Boolean,
      required: true
    },
    consentAt: {
      type: Date,
      required: true
    },
    emailDelivery: {
      status: {
        type: String,
        enum: ['pending', 'sent', 'failed'],
        default: 'pending'
      },
      attemptedAt: Date,
      sentAt: Date,
      lastError: { type: String, maxlength: 500 }
    }
  },
  { timestamps: true }
);

cabinPriorityListSchema.index({ email: 1, cabinId: 1 }, { unique: true });
cabinPriorityListSchema.index({ createdAt: -1 });

module.exports = mongoose.model('CabinPriorityList', cabinPriorityListSchema);
module.exports.CABIN_PRIORITY_LIST_CABINS = CABIN_PRIORITY_LIST_CABINS;
