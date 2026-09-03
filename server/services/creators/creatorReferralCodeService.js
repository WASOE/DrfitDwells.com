const CreatorPartner = require('../../models/CreatorPartner');
const {
  normalizeReferralCode,
  applyReferralCodeNormalization,
  getOwnedReferralCodes,
  buildInitialOwnedCodes
} = require('../../models/CreatorPartner');

/** Bound for referral.lastCodeChangedBy / updatedBy actor strings written by rename paths. */
const LAST_CODE_CHANGED_BY_MAX_LENGTH = 200;

function boundActorMetadata(actor) {
  if (actor == null) return null;
  let value;
  try {
    value = String(actor).trim();
  } catch {
    return null;
  }
  if (!value) return null;
  if (value.length > LAST_CODE_CHANGED_BY_MAX_LENGTH) {
    return value.slice(0, LAST_CODE_CHANGED_BY_MAX_LENGTH);
  }
  return value;
}

/**
 * Find a partner that permanently owns a referral code (current or alias).
 * Includes pre-backfill fallback via referral.code.
 */
async function findPartnerByOwnedReferralCode(rawCode, { statuses = null, select = null } = {}) {
  const code = normalizeReferralCode(rawCode);
  if (!code) return null;

  const filter = {
    $or: [{ 'referral.ownedCodes': code }, { 'referral.code': code }]
  };
  if (Array.isArray(statuses) && statuses.length > 0) {
    filter.status = { $in: statuses };
  }

  let q = CreatorPartner.findOne(filter);
  if (select) q = q.select(select);
  return q.lean();
}

/**
 * Allowlisted $set paths for OPS partner PATCH (explicit; not a generic updater).
 * Nested objects must already be fully merged by the caller.
 */
function buildAllowlistedPartnerSet(fieldUpdates = {}) {
  const $set = {};
  if (!fieldUpdates || typeof fieldUpdates !== 'object') return $set;

  if (fieldUpdates.name !== undefined) $set.name = fieldUpdates.name;
  if (fieldUpdates.slug !== undefined) $set.slug = fieldUpdates.slug;
  if (fieldUpdates.status !== undefined) $set.status = fieldUpdates.status;
  if (fieldUpdates.notes !== undefined) $set.notes = fieldUpdates.notes;
  if (fieldUpdates.updatedBy !== undefined) $set.updatedBy = boundActorMetadata(fieldUpdates.updatedBy);

  if (fieldUpdates.contact !== undefined) $set.contact = fieldUpdates.contact;
  if (fieldUpdates.profiles !== undefined) $set.profiles = fieldUpdates.profiles;
  if (fieldUpdates.promo !== undefined) $set.promo = fieldUpdates.promo;
  if (fieldUpdates.commission !== undefined) $set.commission = fieldUpdates.commission;
  if (fieldUpdates.contentAgreement !== undefined) $set.contentAgreement = fieldUpdates.contentAgreement;

  if (fieldUpdates.referralCookieDays !== undefined) {
    $set['referral.cookieDays'] = fieldUpdates.referralCookieDays;
  }

  return $set;
}

async function assertReferralCodeAvailable(partnerId, newCode, ownedByPartner) {
  if (ownedByPartner.includes(newCode)) return null;
  const taken = await CreatorPartner.findOne({
    _id: { $ne: partnerId },
    $or: [{ 'referral.ownedCodes': newCode }, { 'referral.code': newCode }]
  })
    .select('_id')
    .lean();
  if (taken) {
    return {
      ok: false,
      code: 'CODE_TAKEN',
      message: 'A creator partner with this referral code already exists'
    };
  }
  return null;
}

function classifyMissingAtomicUpdate(partnerId, expectedCurrent) {
  return CreatorPartner.findById(partnerId)
    .select('referral.code')
    .lean()
    .then((again) => {
      if (!again) {
        return { ok: false, code: 'NOT_FOUND', message: 'Creator partner not found' };
      }
      const latest = normalizeReferralCode(again?.referral?.code);
      if (expectedCurrent && latest && latest !== expectedCurrent) {
        return {
          ok: false,
          code: 'CODE_CHANGED',
          message: 'Referral code was changed concurrently; refresh and try again'
        };
      }
      return {
        ok: false,
        code: 'CONFLICT',
        message: 'Unable to update creator partner'
      };
    });
}

/**
 * Single-document atomic OPS update for CreatorPartner.
 *
 * - When desiredReferralCode is provided and differs from current: optimistic lock on
 *   persisted referral.code, set new current, permanently $addToSet old+new into ownedCodes.
 * - When desiredReferralCode matches current or is omitted: apply allowlisted fields only;
 *   does not record rename metadata.
 * - Preflight ownership checks run before any write. Duplicate-key → CODE_TAKEN with no
 *   partial application (single findOneAndUpdate).
 *
 * @param {object} args
 * @param {string|object} args.partnerId
 * @param {string|undefined} args.desiredReferralCode undefined = code not requested
 * @param {object} args.fieldUpdates allowlisted merged fields from OPS route
 * @param {string|null} args.actor
 */
async function applyCreatorPartnerOpsAtomicUpdate({
  partnerId,
  desiredReferralCode = undefined,
  fieldUpdates = {},
  actor = null
} = {}) {
  if (!partnerId) {
    return { ok: false, code: 'NOT_FOUND', message: 'Creator partner not found' };
  }

  const partner = await CreatorPartner.findById(partnerId).lean();
  if (!partner) {
    return { ok: false, code: 'NOT_FOUND', message: 'Creator partner not found' };
  }

  const current = normalizeReferralCode(partner.referral?.code);
  if (!current) {
    return {
      ok: false,
      code: 'INVALID_CURRENT',
      message: 'Partner is missing a valid current referral code'
    };
  }

  const owned = getOwnedReferralCodes(partner);
  const actorBound = boundActorMetadata(actor);
  const $set = buildAllowlistedPartnerSet(fieldUpdates);
  if (actorBound && $set.updatedBy === undefined) {
    $set.updatedBy = actorBound;
  }

  const codeRequested = desiredReferralCode !== undefined;
  let newCode = null;
  let codeChanges = false;

  if (codeRequested) {
    newCode = normalizeReferralCode(desiredReferralCode);
    if (!newCode) {
      return {
        ok: false,
        code: 'INVALID_CODE',
        message:
          'Referral code must be Instagram-style: a-z, 0-9, ., -, _ (max 80 chars); optional leading @ is removed'
      };
    }
    codeChanges = newCode !== current;
    if (codeChanges) {
      const takenErr = await assertReferralCodeAvailable(partnerId, newCode, owned);
      if (takenErr) return takenErr;
    }
  }

  const hasFieldSets = Object.keys($set).length > 0;
  if (!codeChanges && !hasFieldSets && !codeRequested) {
    return {
      ok: true,
      changed: false,
      referralCodeChanged: false,
      referralCode: current,
      previousReferralCode: null,
      partner
    };
  }

  // Same-code request with no other fields: no-op (no rename metadata).
  if (codeRequested && !codeChanges && !hasFieldSets) {
    return {
      ok: true,
      changed: false,
      referralCodeChanged: false,
      referralCode: current,
      previousReferralCode: null,
      partner
    };
  }

  const filter = { _id: partnerId };
  const update = {};

  if (codeChanges) {
    filter['referral.code'] = current;
    $set['referral.code'] = newCode;
    $set['referral.codeChangedAt'] = new Date();
    $set['referral.lastCodeChangedBy'] = actorBound;
    // Permanently retain old current and add new in one op (also heals missing ownedCodes).
    update.$addToSet = { 'referral.ownedCodes': { $each: [current, newCode] } };
  } else if (!Array.isArray(partner.referral?.ownedCodes) || partner.referral.ownedCodes.length === 0) {
    // Heal ownership without recording a rename when applying other fields.
    update.$addToSet = { 'referral.ownedCodes': current };
  }

  if (Object.keys($set).length > 0) {
    update.$set = $set;
  }

  if (!update.$set && !update.$addToSet) {
    return {
      ok: true,
      changed: false,
      referralCodeChanged: false,
      referralCode: current,
      previousReferralCode: null,
      partner
    };
  }

  let updated;
  try {
    updated = await CreatorPartner.findOneAndUpdate(filter, update, { new: true }).lean();
  } catch (e) {
    if (e?.code === 11000) {
      return {
        ok: false,
        code: 'CODE_TAKEN',
        message: 'A creator partner with this slug or referral code already exists'
      };
    }
    throw e;
  }

  if (!updated) {
    return classifyMissingAtomicUpdate(partnerId, codeChanges ? current : null);
  }

  return {
    ok: true,
    changed: true,
    referralCodeChanged: codeChanges,
    referralCode: codeChanges ? newCode : current,
    previousReferralCode: codeChanges ? current : null,
    partner: updated
  };
}

/**
 * Atomically switch a partner's current referral.code while permanently retaining
 * prior codes in referral.ownedCodes. Allows switching current back to an own alias.
 * Thin wrapper over applyCreatorPartnerOpsAtomicUpdate (no extra partner fields).
 */
async function renameCreatorReferralCode({
  partnerId,
  desiredRawCode,
  actor = null,
  expectedCurrentCode = null
} = {}) {
  if (!partnerId) {
    return { ok: false, code: 'NOT_FOUND', message: 'Creator partner not found' };
  }

  const partner = await CreatorPartner.findById(partnerId).select('_id referral.code').lean();
  if (!partner) {
    return { ok: false, code: 'NOT_FOUND', message: 'Creator partner not found' };
  }

  const current = normalizeReferralCode(partner.referral?.code);
  if (!current) {
    return {
      ok: false,
      code: 'INVALID_CURRENT',
      message: 'Partner is missing a valid current referral code'
    };
  }

  if (expectedCurrentCode != null) {
    const expected = normalizeReferralCode(expectedCurrentCode);
    if (!expected || expected !== current) {
      return {
        ok: false,
        code: 'CODE_CHANGED',
        message: 'Referral code was changed concurrently; refresh and try again'
      };
    }
  }

  const out = await applyCreatorPartnerOpsAtomicUpdate({
    partnerId,
    desiredReferralCode: desiredRawCode,
    fieldUpdates: {},
    actor
  });

  if (!out.ok) return out;
  return {
    ok: true,
    changed: !!out.referralCodeChanged,
    referralCode: out.referralCode,
    previousReferralCode: out.previousReferralCode,
    partner: out.partner
  };
}

/**
 * Idempotent backfill: ensure referral.ownedCodes includes current referral.code.
 * Always runs a full cross-partner ownership audit first.
 * - dryRun: read-only audit + planned writes; zero mutations/index ops.
 * - write: aborts entirely if any conflict; otherwise $set ownedCodes only.
 * Does not create/sync indexes.
 */
async function backfillCreatorPartnerOwnedCodes({ dryRun = true } = {}) {
  const {
    auditCreatorPartnerOwnedCodesConflicts
  } = require('./creatorPartnerOwnedCodesAudit');

  const partners = await CreatorPartner.find({})
    .select('_id name referral.code referral.ownedCodes')
    .lean();

  const audit = await auditCreatorPartnerOwnedCodesConflicts(partners);

  const summary = {
    dryRun: !!dryRun,
    partnersScanned: audit.partnersScanned,
    partnersNeedingBackfill: audit.partnersNeedingBackfill,
    normalizedCodesScanned: audit.normalizedCodesScanned,
    conflictsFound: audit.conflictsFound,
    conflicts: audit.conflicts,
    safeForUniqueIndex: audit.safeForUniqueIndex,
    safeForBackfillWrite: audit.safeForBackfillWrite,
    matched: audit.partnersNeedingBackfill,
    modified: 0,
    skipped: Math.max(0, audit.partnersScanned - audit.partnersNeedingBackfill),
    total: audit.partnersScanned,
    aborted: false,
    wrote: false
  };

  if (!audit.safeForBackfillWrite) {
    return {
      ...summary,
      ok: false,
      aborted: true,
      reason: 'ownership_conflicts'
    };
  }

  if (dryRun) {
    return {
      ...summary,
      ok: true,
      aborted: false,
      wrote: false
    };
  }

  let modified = 0;
  for (const projection of audit.projections) {
    if (!projection.needsBackfill || !projection.currentNormalized) continue;
    try {
      const result = await CreatorPartner.updateOne(
        { _id: projection.partnerId },
        { $set: { 'referral.ownedCodes': projection.simulatedOwnedCodes } }
      );
      if ((result.modifiedCount ?? result.nModified ?? 0) > 0) modified += 1;
    } catch (e) {
      if (e?.code === 11000) {
        throw new Error(
          `ownedCodes unique conflict while backfilling partner ${projection.partnerId} code=${projection.currentNormalized}`
        );
      }
      throw e;
    }
  }

  return {
    ...summary,
    ok: true,
    modified,
    aborted: false,
    wrote: true
  };
}

module.exports = {
  LAST_CODE_CHANGED_BY_MAX_LENGTH,
  boundActorMetadata,
  findPartnerByOwnedReferralCode,
  applyCreatorPartnerOpsAtomicUpdate,
  buildAllowlistedPartnerSet,
  renameCreatorReferralCode,
  backfillCreatorPartnerOwnedCodes,
  getOwnedReferralCodes,
  buildInitialOwnedCodes,
  normalizeReferralCode,
  applyReferralCodeNormalization
};
