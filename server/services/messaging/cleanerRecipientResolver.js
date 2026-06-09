'use strict';

/**
 * Cleaner audience recipient resolution (C4).
 *
 * Fan-out: one checkout job maps to N active cleaners assigned to the booking's
 * propertyKind via OpsUser.propertyKinds. Staff path — no GuestContactPreference.
 */

const OpsUser = require('../../models/OpsUser');

const ASSIGNABLE_PROPERTY_KINDS = Object.freeze(['cabin', 'valley']);

function isValidCleanerEmail(email) {
  const v = String(email || '').trim().toLowerCase();
  return v.includes('@') && v.length > 3;
}

function isValidCleanerPhone(phone) {
  const v = String(phone || '').trim();
  return v.startsWith('+') && v.length >= 8;
}

/**
 * Active cleaners whose propertyKinds includes the booking propertyKind.
 */
async function listAssignedCleanersForPropertyKind(propertyKind) {
  const pk = String(propertyKind || '').trim().toLowerCase();
  if (!ASSIGNABLE_PROPERTY_KINDS.includes(pk)) {
    return [];
  }
  return OpsUser.find({
    role: 'cleaner',
    isActive: { $ne: false },
    propertyKinds: pk
  })
    .select('_id email phone locale name')
    .sort({ email: 1 })
    .lean();
}

/**
 * Per-cleaner channel target for a channelStrategy. Returns one send target or
 * a skip descriptor (no GuestContactPreference).
 */
function resolveCleanerChannelTarget(cleaner, channelStrategy) {
  const phone = cleaner?.phone;
  const email = cleaner?.email;

  switch (channelStrategy) {
    case 'whatsapp_only':
      if (isValidCleanerPhone(phone)) {
        return {
          channel: 'whatsapp',
          recipient: phone,
          recipientType: 'whatsapp_phone'
        };
      }
      return { skip: true, reason: 'no_valid_whatsapp_phone', recordChannel: 'whatsapp' };

    case 'email_only':
      if (isValidCleanerEmail(email)) {
        return {
          channel: 'email',
          recipient: String(email).trim().toLowerCase(),
          recipientType: 'email'
        };
      }
      return { skip: true, reason: 'no_valid_email', recordChannel: 'email' };

    case 'whatsapp_first_email_fallback':
      if (isValidCleanerPhone(phone)) {
        return {
          channel: 'whatsapp',
          recipient: phone,
          recipientType: 'whatsapp_phone'
        };
      }
      if (isValidCleanerEmail(email)) {
        return {
          channel: 'email',
          recipient: String(email).trim().toLowerCase(),
          recipientType: 'email',
          fallbackFrom: 'whatsapp'
        };
      }
      return { skip: true, reason: 'no_valid_contact', recordChannel: 'whatsapp' };

    case 'both': {
      const targets = [];
      if (isValidCleanerPhone(phone)) {
        targets.push({
          channel: 'whatsapp',
          recipient: phone,
          recipientType: 'whatsapp_phone'
        });
      }
      if (isValidCleanerEmail(email)) {
        targets.push({
          channel: 'email',
          recipient: String(email).trim().toLowerCase(),
          recipientType: 'email'
        });
      }
      if (targets.length === 0) {
        return { skip: true, reason: 'no_valid_contact', recordChannel: 'whatsapp' };
      }
      return targets;
    }

    default:
      return { skip: true, reason: 'unsupported_channel_strategy', recordChannel: 'email' };
  }
}

/**
 * Normalize resolveCleanerChannelTarget to an array of targets/skips.
 */
function resolveCleanerChannelTargets(cleaner, channelStrategy) {
  const result = resolveCleanerChannelTarget(cleaner, channelStrategy);
  if (Array.isArray(result)) {
    return result;
  }
  return [result];
}

module.exports = {
  ASSIGNABLE_PROPERTY_KINDS,
  isValidCleanerEmail,
  isValidCleanerPhone,
  listAssignedCleanersForPropertyKind,
  resolveCleanerChannelTarget,
  resolveCleanerChannelTargets
};
