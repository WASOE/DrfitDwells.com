'use strict';

/**
 * Read-only CreatorPartner referral ownership / unique-index safety audit.
 * Uses the same normalization as production (`normalizeReferralCode`).
 * Never writes, never creates/syncs indexes.
 */

const CreatorPartner = require('../../models/CreatorPartner');
const { normalizeReferralCode } = require('../../models/CreatorPartner');

/**
 * Simulate post-backfill ownedCodes for one partner (normalized, deduped, includes current).
 * @returns {{
 *   partnerId: string,
 *   name: string|null,
 *   currentRaw: *,
 *   currentNormalized: string|null,
 *   ownedRaw: *[],
 *   simulatedOwnedCodes: string[],
 *   needsBackfill: boolean,
 *   skipReason: string|null
 * }}
 */
function buildPartnerOwnershipProjection(partner) {
  const partnerId = String(partner?._id || '');
  const name = partner?.name != null ? String(partner.name) : null;
  const currentRaw = partner?.referral?.code;
  const currentNormalized = normalizeReferralCode(currentRaw);
  const ownedRaw = Array.isArray(partner?.referral?.ownedCodes)
    ? partner.referral.ownedCodes.slice()
    : [];

  if (!currentNormalized) {
    return {
      partnerId,
      name,
      currentRaw,
      currentNormalized: null,
      ownedRaw,
      simulatedOwnedCodes: [],
      needsBackfill: false,
      skipReason: 'missing_or_invalid_current_code'
    };
  }

  const simulatedOwnedCodes = [];
  const seen = new Set();
  for (const item of ownedRaw) {
    const n = normalizeReferralCode(item);
    if (n && !seen.has(n)) {
      seen.add(n);
      simulatedOwnedCodes.push(n);
    }
  }
  const needsCurrent = !seen.has(currentNormalized);
  if (needsCurrent) {
    simulatedOwnedCodes.push(currentNormalized);
    seen.add(currentNormalized);
  }

  const needsWrite =
    needsCurrent ||
    !Array.isArray(partner?.referral?.ownedCodes) ||
    ownedRaw.length !== simulatedOwnedCodes.length ||
    ownedRaw.some((item, i) => normalizeReferralCode(item) !== simulatedOwnedCodes[i]);

  return {
    partnerId,
    name,
    currentRaw,
    currentNormalized,
    ownedRaw,
    simulatedOwnedCodes,
    needsBackfill: needsWrite,
    skipReason: null
  };
}

/**
 * Classify how a partner contributes a normalized code in the simulated ownership set.
 */
function classifyCodeSource(projection, normalizedCode) {
  const isCurrent = projection.currentNormalized === normalizedCode;
  const inRawOwned = (projection.ownedRaw || []).some(
    (item) => normalizeReferralCode(item) === normalizedCode
  );
  if (isCurrent && inRawOwned) return 'current_and_alias';
  if (isCurrent) return 'current_code';
  if (inRawOwned) return 'historical_alias';
  // Only present because simulated backfill would add the current code.
  return 'simulated_backfill';
}

/**
 * @param {object[]} [partners] optional preloaded lean partners; loads from DB when omitted
 * @returns {Promise<object>} audit report
 */
async function auditCreatorPartnerOwnedCodesConflicts(partners = null) {
  const rows =
    partners == null
      ? await CreatorPartner.find({})
          .select('_id name referral.code referral.ownedCodes')
          .lean()
      : partners;

  const projections = (rows || []).map(buildPartnerOwnershipProjection);
  const partnersScanned = projections.length;
  const partnersNeedingBackfill = projections.filter((p) => p.needsBackfill).length;

  /** @type {Map<string, object[]>} */
  const byCode = new Map();
  for (const projection of projections) {
    for (const code of projection.simulatedOwnedCodes) {
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code).push(projection);
    }
  }

  const normalizedCodesScanned = byCode.size;
  const conflicts = [];

  for (const [normalizedCode, holders] of byCode.entries()) {
    // Unique by partnerId — same partner listed once even if duplicates in array
    const uniqueHolders = [];
    const seenIds = new Set();
    for (const h of holders) {
      if (seenIds.has(h.partnerId)) continue;
      seenIds.add(h.partnerId);
      uniqueHolders.push(h);
    }
    if (uniqueHolders.length < 2) continue;

    // Report every unordered pair (usually 2; support N-way)
    for (let i = 0; i < uniqueHolders.length; i += 1) {
      for (let j = i + 1; j < uniqueHolders.length; j += 1) {
        const a = uniqueHolders[i];
        const b = uniqueHolders[j];
        conflicts.push({
          normalizedCode,
          partnerA: {
            id: a.partnerId,
            name: a.name,
            currentCode: a.currentNormalized,
            currentRaw: a.currentRaw,
            ownedRaw: a.ownedRaw,
            simulatedOwnedCodes: a.simulatedOwnedCodes,
            source: classifyCodeSource(a, normalizedCode)
          },
          partnerB: {
            id: b.partnerId,
            name: b.name,
            currentCode: b.currentNormalized,
            currentRaw: b.currentRaw,
            ownedRaw: b.ownedRaw,
            simulatedOwnedCodes: b.simulatedOwnedCodes,
            source: classifyCodeSource(b, normalizedCode)
          }
        });
      }
    }
  }

  const hasConflicts = conflicts.length > 0;
  return {
    ok: !hasConflicts,
    partnersScanned,
    partnersNeedingBackfill,
    normalizedCodesScanned,
    conflictsFound: conflicts.length,
    conflicts,
    safeForUniqueIndex: !hasConflicts,
    safeForBackfillWrite: !hasConflicts,
    projections
  };
}

module.exports = {
  buildPartnerOwnershipProjection,
  auditCreatorPartnerOwnedCodesConflicts,
  classifyCodeSource
};
