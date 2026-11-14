'use strict';

const mongoose = require('mongoose');

const deliverySchema = new mongoose.Schema({
  status: { type: String, enum: ['pending', 'sending', 'sent', 'failed'], default: 'pending' },
  attempts: { type: Number, default: 0 },
  claimedAt: Date,
  lastError: { type: String, maxlength: 500 },
  sentAt: Date
}, { _id: false });

const schema = new mongoose.Schema({
  type: { type: String, enum: ['nomination', 'hr'], required: true },
  company: { type: String, required: true, maxlength: 200 },
  nominationKey: { type: String },
  requestKeys: { type: [String], required: true },
  requestDigests: { type: [String], required: true },
  companyWebsites: [String],
  hrContacts: [String],
  hrEmails: [String],
  contactName: String,
  contactEmail: String,
  employeeCount: String,
  budget: String,
  message: String,
  consent: { type: Boolean, required: true },
  attribution: {
    source: String, medium: String, campaign: String, utmSource: String,
    utmMedium: String, utmCampaign: String, referrer: String, landingPath: String
  },
  status: { type: String, enum: ['new', 'researching', 'contacted', 'negotiating', 'won', 'lost'], default: 'new' },
  notes: { type: String, default: '', maxlength: 10000 },
  email: { type: deliverySchema, default: () => ({}) },
  notification: { type: deliverySchema, default: () => ({}) }
}, { timestamps: true });

schema.index({ requestKeys: 1 }, { unique: true });
schema.index({ nominationKey: 1 }, { unique: true, partialFilterExpression: { nominationKey: { $type: 'string' } } });
schema.index({ status: 1, createdAt: -1 });
schema.index({ 'email.status': 1, 'email.claimedAt': 1 });
schema.index({ 'notification.status': 1, 'notification.claimedAt': 1 });

module.exports = mongoose.model('CorporateGiftLead', schema);
