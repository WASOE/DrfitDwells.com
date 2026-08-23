'use strict';

/**
 * REBOOK-S1.2 shadow CabinNightClaim sync after canonical Booking mutation.
 * Ensures expected own claims; releases deterministic stale own claims.
 */

const CabinNightClaim = require('../../models/CabinNightClaim');
const {
  claimCabinNights,
  releaseCabinNights,
  ERR: CLAIM_ERR,
  ACQUISITION_MODES
} = require('./cabinNightClaimService');
const { expandOccupiedSofiaNightDateOnlys } = require('../ops/reporting/stayNights');
const { formatSofiaDateOnly } = require('../../utils/dateTime');
const { isCabinNightClaimShadowEnabled } = require('./cabinNightClaimMode');
const {
  shouldBookingOwnCabinNightClaims,
  describeBookingClaimShape
} = require('./cabinNightClaimQualification');
const {
  SHADOW_EVENTS,
  emitCabinNightClaimShadowEvent
} = require('./cabinNightClaimObservability');
const { ensureCabinNightClaimsReleasedShadow } = require('./ensureCabinNightClaimsReleasedShadow');

const SYNC_OUTCOMES = Object.freeze({
  SYNCED: 'synced',
  SKIPPED_OFF: 'skipped_off',
  SKIPPED_NOT_QUALIFIED: 'skipped_not_qualified',
  RELEASED_NONBLOCKING: 'released_nonblocking',
  PARTIAL_FOREIGN: 'partial_foreign',
  WRITE_FAILURE: 'write_failure',
  INVALID_RANGE: 'invalid_range'
});

function outcomeBase(partial) {
  return {
    ok: false,
    outcome: SYNC_OUTCOMES.WRITE_FAILURE,
    bookingId: null,
    cabinId: null,
    source: null,
    requiredNights: [],
    insertedCount: 0,
    alreadyOwnedCount: 0,
    releasedCount: 0,
    surplusNights: [],
    errorCode: null,
    errorMessage: null,
    ...partial
  };
}

function dateOnlyFromNight(night) {
  return formatSofiaDateOnly(night);
}

async function syncCabinNightClaimsShadow({
  booking,
  source = 'date_edit',
  claimCabinNightsFn = claimCabinNights,
  releaseCabinNightsFn = releaseCabinNights,
  findClaimsFn = null,
  mode = null
} = {}) {
  const claimSource = String(source || 'date_edit').trim() || 'date_edit';
  const bookingId = booking?._id ? String(booking._id) : null;
  const cabinId = booking?.cabinId ? String(booking.cabinId) : null;

  if (!isCabinNightClaimShadowEnabled(mode)) {
    return outcomeBase({
      ok: true,
      outcome: SYNC_OUTCOMES.SKIPPED_OFF,
      bookingId,
      cabinId,
      source: claimSource
    });
  }

  if (!shouldBookingOwnCabinNightClaims(booking)) {
    if (bookingId) {
      await ensureCabinNightClaimsReleasedShadow({
        bookingId,
        lifecycleSource: 'status_release',
        mode
      });
    }
    return outcomeBase({
      ok: true,
      outcome: SYNC_OUTCOMES.SKIPPED_NOT_QUALIFIED,
      bookingId,
      cabinId,
      source: claimSource,
      errorMessage: describeBookingClaimShape(booking)
    });
  }

  if (!booking.checkIn || !booking.checkOut) {
    emitCabinNightClaimShadowEvent(SHADOW_EVENTS.SHADOW_MIRROR_MISMATCH, {
      bookingId,
      cabinId,
      writer: claimSource,
      errorCode: CLAIM_ERR.VALIDATION,
      message: 'Missing checkIn/checkOut for shadow sync'
    });
    return outcomeBase({
      outcome: SYNC_OUTCOMES.INVALID_RANGE,
      bookingId,
      cabinId,
      source: claimSource,
      errorCode: CLAIM_ERR.VALIDATION,
      errorMessage: 'Missing checkIn/checkOut'
    });
  }

  const expanded = expandOccupiedSofiaNightDateOnlys(booking.checkIn, booking.checkOut);
  if (!expanded.ok) {
    emitCabinNightClaimShadowEvent(SHADOW_EVENTS.SHADOW_MIRROR_MISMATCH, {
      bookingId,
      cabinId,
      writer: claimSource,
      errorCode: CLAIM_ERR.VALIDATION,
      message: expanded.reason
    });
    return outcomeBase({
      outcome: SYNC_OUTCOMES.INVALID_RANGE,
      bookingId,
      cabinId,
      source: claimSource,
      errorCode: CLAIM_ERR.VALIDATION,
      errorMessage: expanded.reason
    });
  }

  const requiredNights = expanded.dateOnlys;
  const requiredSet = new Set(requiredNights);

  let insertedCount = 0;
  let alreadyOwnedCount = 0;
  let fillError = null;

  try {
    const claimed = await claimCabinNightsFn({
      cabinId,
      bookingId,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      source: claimSource,
      acquisitionMode: ACQUISITION_MODES.SHADOW
    });
    insertedCount = Number(claimed.insertedCount || 0);
    alreadyOwnedCount = Number(claimed.alreadyOwnedCount || 0);
  } catch (err) {
    fillError = err;
    const code = err?.code || 'CABIN_NIGHT_CLAIM_SHADOW_FAILURE';
    const event =
      code === CLAIM_ERR.FOREIGN_OWNER
        ? SHADOW_EVENTS.SHADOW_FOREIGN_OWNER
        : code === CLAIM_ERR.STAY_CHANGE_OWNERSHIP_CONFLICT
          ? SHADOW_EVENTS.SHADOW_STAYCHANGE_CONFLICT
          : SHADOW_EVENTS.SHADOW_MIRROR_MISMATCH;
    emitCabinNightClaimShadowEvent(event, {
      bookingId,
      cabinId,
      writer: claimSource,
      errorCode: code,
      message: err?.message || String(err)
    });
  }

  let releasedCount = 0;
  let surplusNights = [];
  let releaseError = null;

  try {
    const loadClaims =
      findClaimsFn ||
      (async () =>
        CabinNightClaim.find({ bookingId: booking._id }).select('cabinId night').lean());
    const owned = await loadClaims();
    const surplusByCabin = new Map();

    for (const row of owned || []) {
      const nightKey = dateOnlyFromNight(row.night);
      const rowCabinId = String(row.cabinId);
      const inRequired =
        rowCabinId === String(cabinId) && nightKey && requiredSet.has(nightKey);
      if (!inRequired) {
        if (!surplusByCabin.has(rowCabinId)) surplusByCabin.set(rowCabinId, []);
        surplusByCabin.get(rowCabinId).push(nightKey);
        surplusNights.push({ cabinId: rowCabinId, night: nightKey });
      }
    }

    for (const [surplusCabinId, nights] of surplusByCabin.entries()) {
      if (!nights.length) continue;
      // eslint-disable-next-line no-await-in-loop
      const released = await releaseCabinNightsFn({
        bookingId,
        cabinId: surplusCabinId,
        nights
      });
      releasedCount += Number(released.deletedCount || 0);
    }
  } catch (err) {
    releaseError = err;
    emitCabinNightClaimShadowEvent(SHADOW_EVENTS.SHADOW_RELEASE_FAILED, {
      bookingId,
      cabinId,
      writer: claimSource,
      errorCode: err?.code || null,
      message: err?.message || String(err)
    });
  }

  if (fillError || releaseError) {
    const primary = fillError || releaseError;
    const code = primary?.code || 'CABIN_NIGHT_CLAIM_SHADOW_FAILURE';
    const outcome =
      code === CLAIM_ERR.FOREIGN_OWNER ? SYNC_OUTCOMES.PARTIAL_FOREIGN : SYNC_OUTCOMES.WRITE_FAILURE;
    return outcomeBase({
      ok: false,
      outcome,
      bookingId,
      cabinId,
      source: claimSource,
      requiredNights,
      insertedCount,
      alreadyOwnedCount,
      releasedCount,
      surplusNights,
      errorCode: code,
      errorMessage: primary?.message || String(primary)
    });
  }

  return outcomeBase({
    ok: true,
    outcome: SYNC_OUTCOMES.SYNCED,
    bookingId,
    cabinId,
    source: claimSource,
    requiredNights,
    insertedCount,
    alreadyOwnedCount,
    releasedCount,
    surplusNights
  });
}

module.exports = {
  syncCabinNightClaimsShadow,
  SYNC_OUTCOMES
};
