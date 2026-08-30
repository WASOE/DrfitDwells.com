'use strict';

const STONE_HOUSE_SLUG = 'stone-house';

const LEGACY_STATE = Object.freeze({
  pricePerNight: 25,
  pricingModel: 'per_person',
  minGuests: 3,
  capacity: 6,
  includedGuests: null,
  extraGuestPricePerNight: null
});

const DESIRED_STATE = Object.freeze({
  pricePerNight: 75,
  pricingModel: 'base_plus_extra',
  minGuests: 1,
  capacity: 6,
  includedGuests: 3,
  extraGuestPricePerNight: 25
});

/** Fields written on apply — pricing only; slug/metadata untouched. */
const APPLY_SET_FIELDS = Object.freeze({
  pricePerNight: DESIRED_STATE.pricePerNight,
  pricingModel: DESIRED_STATE.pricingModel,
  minGuests: DESIRED_STATE.minGuests,
  includedGuests: DESIRED_STATE.includedGuests,
  extraGuestPricePerNight: DESIRED_STATE.extraGuestPricePerNight
});

const PRICING_SELECT =
  '_id slug name pricePerNight pricingModel minGuests capacity includedGuests extraGuestPricePerNight';

const EXIT = Object.freeze({
  OK: 0,
  ERROR: 1,
  REFUSED: 2
});

function isProductionEnv(nodeEnv = process.env.NODE_ENV) {
  return String(nodeEnv || '').toLowerCase() === 'production';
}

function parseArgs(argv = []) {
  const apply = argv.includes('--apply');
  const explicitDryRun = argv.includes('--dry-run');
  if (apply && explicitDryRun) {
    return { error: 'Cannot combine --apply with --dry-run' };
  }
  return { apply };
}

function extractPricingState(doc) {
  if (!doc) return null;
  return {
    pricePerNight: doc.pricePerNight,
    pricingModel: doc.pricingModel,
    minGuests: doc.minGuests,
    capacity: doc.capacity,
    includedGuests: doc.includedGuests ?? null,
    extraGuestPricePerNight: doc.extraGuestPricePerNight ?? null
  };
}

function statesEqual(a, b) {
  if (!a || !b) return false;
  return (
    a.pricePerNight === b.pricePerNight
    && a.pricingModel === b.pricingModel
    && a.minGuests === b.minGuests
    && a.capacity === b.capacity
    && (a.includedGuests ?? null) === (b.includedGuests ?? null)
    && (a.extraGuestPricePerNight ?? null) === (b.extraGuestPricePerNight ?? null)
  );
}

function classifyStoneHousePricingState(state) {
  if (statesEqual(state, DESIRED_STATE)) {
    return 'ALREADY_DESIRED';
  }
  if (statesEqual(state, LEGACY_STATE)) {
    return 'LEGACY_EXACT';
  }
  return 'UNEXPECTED_STATE';
}

function buildLegacyCasFilter(targetId) {
  return {
    _id: targetId,
    pricePerNight: LEGACY_STATE.pricePerNight,
    pricingModel: LEGACY_STATE.pricingModel,
    minGuests: LEGACY_STATE.minGuests,
    capacity: LEGACY_STATE.capacity,
    includedGuests: null,
    extraGuestPricePerNight: null
  };
}

function verifyStoneHouseIdentity(doc, matchStrategy) {
  const slug = normalizeSlug(doc.slug);
  if (slug === STONE_HOUSE_SLUG) {
    return { ok: true };
  }
  if (matchStrategy === 'name' && /^stone house$/i.test(String(doc.name || '').trim())) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: 'identity_mismatch',
    actualSlug: doc.slug ?? null
  };
}

function verifyDesiredState(doc, matchStrategy = 'slug') {
  const state = extractPricingState(doc);
  if (!statesEqual(state, DESIRED_STATE)) {
    return {
      ok: false,
      reason: 'post_write_verification_failed',
      actual: state,
      expected: { ...DESIRED_STATE }
    };
  }
  const identity = verifyStoneHouseIdentity(doc, matchStrategy);
  if (!identity.ok) {
    return identity;
  }
  return { ok: true, state };
}

function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase();
}

async function findStoneHouseCandidates(Cabin) {
  const bySlug = await Cabin.find({ slug: STONE_HOUSE_SLUG }).select(PRICING_SELECT).lean();
  if (bySlug.length > 0) {
    return { candidates: bySlug, matchStrategy: 'slug' };
  }
  const byName = await Cabin.find({ name: /^stone house$/i }).select(PRICING_SELECT).lean();
  return { candidates: byName, matchStrategy: 'name' };
}

function buildPreflightReport({
  mode,
  targetCount,
  targetId,
  matchStrategy,
  classification,
  currentState,
  productionGuardRequired
}) {
  const eligibleForApply = classification === 'LEGACY_EXACT';
  return {
    mode,
    targetCount,
    targetId: targetId ? String(targetId) : null,
    matchStrategy,
    classification,
    currentState,
    desiredState: { ...DESIRED_STATE },
    eligibleForApply,
    productionGuardRequired: Boolean(productionGuardRequired),
    writes: 0
  };
}

async function reloadStoneHouseById(Cabin, targetId) {
  return Cabin.findById(targetId).select(PRICING_SELECT).lean();
}

async function runStoneHousePricingPatch({
  Cabin,
  apply = false,
  nodeEnv = process.env.NODE_ENV,
  productionAllowEnv = process.env.ALLOW_PRODUCTION_STONE_HOUSE_PRICING_PATCH
}) {
  const mode = apply ? 'apply' : 'dry-run';
  const production = isProductionEnv(nodeEnv);
  const productionGuardRequired = production && apply;

  const { candidates, matchStrategy } = await findStoneHouseCandidates(Cabin);
  const targetCount = candidates.length;

  if (targetCount === 0) {
    return {
      exitCode: EXIT.REFUSED,
      report: {
        mode,
        targetCount: 0,
        classification: 'NO_TARGET',
        eligibleForApply: false,
        productionGuardRequired,
        writes: 0,
        refusalReason: 'zero_matches'
      }
    };
  }

  if (targetCount > 1) {
    return {
      exitCode: EXIT.REFUSED,
      report: {
        mode,
        targetCount,
        targetIds: candidates.map((c) => String(c._id)),
        matchStrategy,
        classification: 'AMBIGUOUS_TARGET',
        eligibleForApply: false,
        productionGuardRequired,
        writes: 0,
        refusalReason: 'multiple_matches'
      }
    };
  }

  const target = candidates[0];
  const targetId = target._id;
  const currentState = extractPricingState(target);
  const classification = classifyStoneHousePricingState(currentState);

  const preflight = buildPreflightReport({
    mode,
    targetCount: 1,
    targetId,
    matchStrategy,
    classification,
    currentState,
    productionGuardRequired
  });

  if (!apply) {
    return { exitCode: EXIT.OK, report: preflight };
  }

  if (production && productionAllowEnv !== '1') {
    return {
      exitCode: EXIT.REFUSED,
      report: {
        ...preflight,
        refusalReason: 'production_apply_without_allow_env',
        writes: 0
      }
    };
  }

  if (classification === 'ALREADY_DESIRED') {
    return {
      exitCode: EXIT.OK,
      report: {
        ...preflight,
        outcome: 'already_desired_noop',
        writes: 0
      }
    };
  }

  if (classification === 'UNEXPECTED_STATE') {
    return {
      exitCode: EXIT.REFUSED,
      report: {
        ...preflight,
        refusalReason: 'unexpected_state',
        writes: 0
      }
    };
  }

  // LEGACY_EXACT — atomic CAS
  const casResult = await Cabin.updateOne(buildLegacyCasFilter(targetId), { $set: APPLY_SET_FIELDS });

  if (casResult.modifiedCount === 0) {
    const reloaded = await reloadStoneHouseById(Cabin, targetId);
    const reclass = classifyStoneHousePricingState(extractPricingState(reloaded));
    if (reclass === 'ALREADY_DESIRED') {
      return {
        exitCode: EXIT.OK,
        report: {
          ...preflight,
          outcome: 'concurrent_already_desired_noop',
          writes: 0,
          casMatched: casResult.matchedCount
        }
      };
    }
    return {
      exitCode: EXIT.REFUSED,
      report: {
        ...preflight,
        refusalReason: 'cas_mismatch',
        writes: 0,
        casMatched: casResult.matchedCount,
        casModified: casResult.modifiedCount,
        reloadedState: extractPricingState(reloaded)
      }
    };
  }

  const verifiedDoc = await reloadStoneHouseById(Cabin, targetId);
  const verification = verifyDesiredState(verifiedDoc, matchStrategy);
  if (!verification.ok) {
    return {
      exitCode: EXIT.REFUSED,
      report: {
        ...preflight,
        refusalReason: verification.reason,
        writes: casResult.modifiedCount,
        verification
      }
    };
  }

  return {
    exitCode: EXIT.OK,
    report: {
      ...preflight,
      outcome: 'applied',
      writes: casResult.modifiedCount,
      verifiedState: verification.state
    }
  };
}

module.exports = {
  STONE_HOUSE_SLUG,
  LEGACY_STATE,
  DESIRED_STATE,
  APPLY_SET_FIELDS,
  EXIT,
  parseArgs,
  extractPricingState,
  classifyStoneHousePricingState,
  buildLegacyCasFilter,
  verifyStoneHouseIdentity,
  verifyDesiredState,
  findStoneHouseCandidates,
  buildPreflightReport,
  runStoneHousePricingPatch
};
