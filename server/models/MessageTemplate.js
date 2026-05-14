const mongoose = require('mongoose');
const {
  MESSAGE_TEMPLATE_CHANNELS,
  MESSAGE_TEMPLATE_LOCALES,
  MESSAGE_TEMPLATE_PROPERTY_KINDS,
  MESSAGE_TEMPLATE_STATUSES
} = require('../services/messaging/messagingEnums');

/**
 * MessageTemplate
 *
 * Versioned, per-channel, per-locale, per-property template definitions.
 * Conditional required-field validation (e.g. whatsappTemplateName required
 * when channel='whatsapp') is enforced by the OPS write service in a later
 * batch; this schema only persists the fields and the enums.
 *
 * See docs/guest-message-automation/02_V1_SPEC.md §11.
 */
const messageTemplateSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    version: {
      type: Number,
      required: true,
      min: 1
    },
    channel: {
      type: String,
      enum: MESSAGE_TEMPLATE_CHANNELS,
      required: true
    },
    locale: {
      type: String,
      enum: MESSAGE_TEMPLATE_LOCALES,
      required: true
    },
    propertyKind: {
      type: String,
      enum: MESSAGE_TEMPLATE_PROPERTY_KINDS,
      required: true
    },
    status: {
      type: String,
      enum: MESSAGE_TEMPLATE_STATUSES,
      required: true,
      default: 'draft'
    },
    whatsappTemplateName: { type: String, trim: true, default: null },
    whatsappLocale: { type: String, trim: true, default: null },
    emailSubject: { type: String, trim: true, default: null },
    emailBodyMarkup: { type: String, default: null },
    variableSchema: { type: Object, default: {} },
    notes: { type: String, default: '' },
    approvedBy: { type: String, default: null },
    approvedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

messageTemplateSchema.index(
  { key: 1, channel: 1, locale: 1, propertyKind: 1, version: 1 },
  { unique: true }
);
messageTemplateSchema.index({ key: 1, channel: 1, locale: 1, propertyKind: 1, status: 1 });

module.exports = mongoose.model('MessageTemplate', messageTemplateSchema);
