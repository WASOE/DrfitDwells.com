const mongoose = require('mongoose');
const {
  AUTOMATION_RULE_TRIGGER_TYPES,
  AUTOMATION_RULE_PROPERTY_SCOPES,
  AUTOMATION_RULE_CHANNEL_STRATEGIES,
  AUTOMATION_RULE_REQUIRES_CONSENT,
  AUTOMATION_RULE_MODES,
  AUTOMATION_RULE_AUDIENCES
} = require('../services/messaging/messagingEnums');

/**
 * MessageAutomationRule
 *
 * Declarative trigger → template mapping. New rows are inert by default
 * (`enabled: false`, `mode: 'shadow'`) so that Batch 5 seeding does not
 * dispatch anything. Per-batch rollout is the OPS-side decision in
 * Batches 13/14.
 *
 * See docs/guest-message-automation/02_V1_SPEC.md §12.
 */
const messageAutomationRuleSchema = new mongoose.Schema(
  {
    ruleKey: {
      type: String,
      required: true,
      trim: true,
      unique: true
    },
    description: { type: String, default: '' },
    triggerType: {
      type: String,
      enum: AUTOMATION_RULE_TRIGGER_TYPES,
      required: true
    },
    triggerConfig: { type: Object, required: true, default: {} },
    propertyScope: {
      type: String,
      enum: AUTOMATION_RULE_PROPERTY_SCOPES,
      required: true
    },
    channelStrategy: {
      type: String,
      enum: AUTOMATION_RULE_CHANNEL_STRATEGIES,
      required: true
    },
    templateKeyByChannel: { type: Object, required: true, default: {} },
    requiresConsent: {
      type: String,
      enum: AUTOMATION_RULE_REQUIRES_CONSENT,
      required: true,
      default: 'transactional'
    },
    enabled: { type: Boolean, required: true, default: false },
    mode: {
      type: String,
      enum: AUTOMATION_RULE_MODES,
      required: true,
      default: 'shadow'
    },
    audience: {
      type: String,
      enum: AUTOMATION_RULE_AUDIENCES,
      required: true
    },
    requiredBookingStatus: { type: [String], default: [] },
    requirePaidIfStripe: { type: Boolean, required: true, default: false }
  },
  { timestamps: true }
);

messageAutomationRuleSchema.index({ triggerType: 1, enabled: 1, propertyScope: 1 });

module.exports = mongoose.model('MessageAutomationRule', messageAutomationRuleSchema);
