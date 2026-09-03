'use strict';

/**
 * Creator-portal self-service referral-code rename (Batch B1).
 * Reuses B0 renameCreatorReferralCode with atomic status + owned-cardinality constraints.
 * Does not expose ownedCodes.
 */

const { normalizeReferralCode } = require('../../models/CreatorPartner');
const { renameCreatorReferralCode } = require('../creators/creatorReferralCodeService');

/** Creator self-service may introduce at most one new code beyond the original (2 total). */
const CREATOR_MAX_OWNED_REFERRAL_CODES = 2;

const CREATOR_RENAME_CONSTRAINTS = Object.freeze({
  requiredStatus: 'active',
  maxOwnedCodesForNewCode: CREATOR_MAX_OWNED_REFERRAL_CODES
});

function buildCreatorRenameActor(partnerId) {
  return `creator:${String(partnerId)}`;
}

/**
 * @param {object} args
 * @param {string|object} args.partnerId must come from authenticated session only
 * @param {string} args.desiredRawCode
 * @param {string} args.expectedCurrentCode required optimistic lock from server snapshot
 */
async function renameOwnCreatorReferralCode({
  partnerId,
  desiredRawCode,
  expectedCurrentCode
} = {}) {
  if (!partnerId) {
    return { ok: false, code: 'NOT_FOUND', message: 'Creator partner not found' };
  }

  if (expectedCurrentCode == null || typeof expectedCurrentCode !== 'string') {
    return {
      ok: false,
      code: 'INVALID_EXPECTED_CURRENT',
      message: 'expectedCurrentCode is required'
    };
  }
  if (expectedCurrentCode.length > 120) {
    return {
      ok: false,
      code: 'INVALID_EXPECTED_CURRENT',
      message: 'expectedCurrentCode is invalid'
    };
  }
  const expectedNormalized = normalizeReferralCode(expectedCurrentCode);
  if (!expectedNormalized) {
    return {
      ok: false,
      code: 'INVALID_EXPECTED_CURRENT',
      message: 'expectedCurrentCode is invalid'
    };
  }

  const out = await renameCreatorReferralCode({
    partnerId,
    desiredRawCode,
    actor: buildCreatorRenameActor(partnerId),
    expectedCurrentCode: expectedNormalized,
    constraints: CREATOR_RENAME_CONSTRAINTS
  });

  if (!out.ok) return out;

  return {
    ok: true,
    changed: !!out.changed,
    referralCode: out.referralCode,
    previousReferralCode: out.previousReferralCode || null
  };
}

module.exports = {
  CREATOR_MAX_OWNED_REFERRAL_CODES,
  CREATOR_RENAME_CONSTRAINTS,
  buildCreatorRenameActor,
  renameOwnCreatorReferralCode,
  normalizeReferralCode
};
