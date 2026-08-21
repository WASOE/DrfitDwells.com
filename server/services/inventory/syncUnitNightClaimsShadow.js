'use strict';

/**
 * I3 shadow UnitNightClaim date-sync helper.
 *
 * Binding: docs/stay-change-implementation-plan.md — I3 date-edit integrity.
 * Claims remain SHADOW / non-authoritative. Failure never rolls back a
 * successful canonical date edit.
 *
 * Order: fill required NEW nights, then release booking-owned surplus.
 * Surplus release still runs if NEW fill fails (canonical occupancy is SoT).
 */

const UnitNightClaim = require('../../models/UnitNightClaim');
const {
  claimUnitNights,
  releaseUnitNights,
  ERR: CLAIM_ERR
} = require('./unitNightClaimService');
const { expandOccupiedSofiaNightDateOnlys } = require('../ops/reporting/stayNights');
const { formatSofiaDateOnly } = require('../../utils/dateTime');
const { openManualReviewItem } = require('../ops/ingestion/manualReviewService');
const { BLOCKING_BOOKING_STATUSES } = require('../calendar/blockingStatusConstants');
const {
  MRI_CATEGORY,
  MRI_SOURCE
} = require('./ensureUnitNightClaimsShadow');

const DATE_EDIT_SOURCE = 'date_edit';

const SYNC_OUTCOMES = Object.freeze({
  SYNCED: 'synced',
  SKIPPED_NOT_MULTI_UNIT: 'skipped_not_multi_unit',
  SKIPPED_UNALLOCATED: 'skipped_unallocated',
  SKIPPED_NON_BLOCKING: 'skipped_non_blocking',
  PARTIAL_FOREIGN: 'partial_foreign',
  WRITE_FAILURE: 'write_failure',
  INVALID_RANGE: 'invalid_range'
});

function outcomeBase(partial) {
  return {
    ok: false,
    outcome: SYNC_OUTCOMES.WRITE_FAILURE,
    bookingId: null,
    unitId: null,
    cabinTypeId: null,
    source: DATE_EDIT_SOURCE,
    requiredNights: [],
    insertedCount: 0,
    alreadyOwnedCount: 0,
    releasedCount: 0,
    surplusNights: [],
    errorCode: null,
    errorMessage: null,
    manualReviewItemId: null,
    ...partial
  };
}

function dateOnlyFromNight(night) {
  return formatSofiaDateOnly(night);
}

async function recordDateEditShadowFailure({
  booking,
  errorCode,
  errorSummary,
  details = {},
  openManualReviewItemFn
}) {
  const bookingId = booking?._id ? String(booking._id) : null;
  const sourceReference = bookingId ? `${bookingId}:sync` : null;
  try {
    const mri = await openManualReviewItemFn({
      category: MRI_CATEGORY,
      severity: 'high',
      entityType: 'Booking',
      entityId: bookingId,
      title: 'UnitNightClaim shadow date-edit sync failed',
      details: errorSummary || 'Shadow UnitNightClaim sync failed after canonical date edit',
      provenance: {
        source: MRI_SOURCE,
        sourceReference
      },
      evidence: {
        operation: 'sync',
        errorCode: errorCode || null,
        unitId: booking?.unitId ? String(booking.unitId) : null,
        cabinTypeId: booking?.cabinTypeId ? String(booking.cabinTypeId) : null,
        checkIn: booking?.checkIn || null,
        checkOut: booking?.checkOut || null,
        claimSource: DATE_EDIT_SOURCE,
        ...details
      }
    });
    return mri?._id ? String(mri._id) : null;
  } catch {
    return null;
  }
}

/**
 * Synchronize shadow UnitNightClaims to the Booking's canonical occupied nights.
 * Never throws for claim/MRI failures — returns a structured outcome.
 */
async function syncUnitNightClaimsShadow({
  booking,
  source = DATE_EDIT_SOURCE,
  claimUnitNightsFn = claimUnitNights,
  releaseUnitNightsFn = releaseUnitNights,
  openManualReviewItemFn = openManualReviewItem,
  findClaimsFn = null
} = {}) {
  const claimSource = String(source || DATE_EDIT_SOURCE).trim() || DATE_EDIT_SOURCE;
  const bookingId = booking?._id ? String(booking._id) : null;
  const cabinTypeId = booking?.cabinTypeId ? String(booking.cabinTypeId) : null;
  const unitId = booking?.unitId ? String(booking.unitId) : null;
  const status = String(booking?.status || '');

  if (!cabinTypeId) {
    return outcomeBase({
      ok: true,
      outcome: SYNC_OUTCOMES.SKIPPED_NOT_MULTI_UNIT,
      bookingId,
      unitId: unitId || null,
      cabinTypeId: null,
      source: claimSource
    });
  }

  if (!unitId) {
    return outcomeBase({
      ok: true,
      outcome: SYNC_OUTCOMES.SKIPPED_UNALLOCATED,
      bookingId,
      unitId: null,
      cabinTypeId,
      source: claimSource
    });
  }

  if (!BLOCKING_BOOKING_STATUSES.includes(status)) {
    return outcomeBase({
      ok: true,
      outcome: SYNC_OUTCOMES.SKIPPED_NON_BLOCKING,
      bookingId,
      unitId,
      cabinTypeId,
      source: claimSource
    });
  }

  if (!booking.checkIn || !booking.checkOut) {
    const manualReviewItemId = await recordDateEditShadowFailure({
      booking,
      errorCode: CLAIM_ERR.VALIDATION,
      errorSummary: 'Allocated multi-unit Booking missing checkIn/checkOut for shadow date sync',
      openManualReviewItemFn
    });
    return outcomeBase({
      outcome: SYNC_OUTCOMES.INVALID_RANGE,
      bookingId,
      unitId,
      cabinTypeId,
      source: claimSource,
      errorCode: CLAIM_ERR.VALIDATION,
      errorMessage: 'Missing checkIn/checkOut',
      manualReviewItemId
    });
  }

  const expanded = expandOccupiedSofiaNightDateOnlys(booking.checkIn, booking.checkOut);
  if (!expanded.ok) {
    const manualReviewItemId = await recordDateEditShadowFailure({
      booking,
      errorCode: CLAIM_ERR.VALIDATION,
      errorSummary: `Invalid stay range for shadow date sync: ${expanded.reason}`,
      details: { reason: expanded.reason },
      openManualReviewItemFn
    });
    return outcomeBase({
      outcome: SYNC_OUTCOMES.INVALID_RANGE,
      bookingId,
      unitId,
      cabinTypeId,
      source: claimSource,
      errorCode: CLAIM_ERR.VALIDATION,
      errorMessage: expanded.reason,
      manualReviewItemId
    });
  }

  const requiredNights = expanded.dateOnlys;
  const requiredSet = new Set(requiredNights);

  let insertedCount = 0;
  let alreadyOwnedCount = 0;
  let fillError = null;

  try {
    const claimed = await claimUnitNightsFn({
      bookingId,
      unitId,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      source: claimSource
    });
    insertedCount = Number(claimed.insertedCount || 0);
    alreadyOwnedCount = Number(claimed.alreadyOwnedCount || 0);
  } catch (err) {
    fillError = err;
  }

  let releasedCount = 0;
  let surplusNights = [];
  let releaseError = null;

  try {
    const loadClaims =
      findClaimsFn ||
      (async () =>
        UnitNightClaim.find({ bookingId: booking._id, unitId: booking.unitId })
          .select('night')
          .lean());
    const owned = await loadClaims();
    surplusNights = (owned || [])
      .map((row) => dateOnlyFromNight(row.night))
      .filter((d) => d && !requiredSet.has(d));

    if (surplusNights.length > 0) {
      const released = await releaseUnitNightsFn({
        bookingId,
        unitId,
        nights: surplusNights
      });
      releasedCount = Number(released.deletedCount || 0);
    }
  } catch (err) {
    releaseError = err;
  }

  if (fillError || releaseError) {
    const primary = fillError || releaseError;
    const code = primary?.code || 'UNIT_NIGHT_CLAIM_SHADOW_FAILURE';
    const outcome =
      code === CLAIM_ERR.FOREIGN_OWNER ? SYNC_OUTCOMES.PARTIAL_FOREIGN : SYNC_OUTCOMES.WRITE_FAILURE;
    const manualReviewItemId = await recordDateEditShadowFailure({
      booking,
      errorCode: code,
      errorSummary: primary?.message || 'Shadow UnitNightClaim date-edit sync failed',
      details: {
        conflicts: primary?.details?.conflicts || null,
        fillFailed: Boolean(fillError),
        releaseFailed: Boolean(releaseError),
        requiredNights,
        surplusNights,
        releasedCount
      },
      openManualReviewItemFn
    });
    return outcomeBase({
      // Surplus may have released even when fill failed — still not fully ok.
      ok: false,
      outcome,
      bookingId,
      unitId,
      cabinTypeId,
      source: claimSource,
      requiredNights,
      insertedCount,
      alreadyOwnedCount,
      releasedCount,
      surplusNights,
      errorCode: code,
      errorMessage: primary?.message || String(primary),
      manualReviewItemId
    });
  }

  return outcomeBase({
    ok: true,
    outcome: SYNC_OUTCOMES.SYNCED,
    bookingId,
    unitId,
    cabinTypeId,
    source: claimSource,
    requiredNights,
    insertedCount,
    alreadyOwnedCount,
    releasedCount,
    surplusNights
  });
}

module.exports = {
  syncUnitNightClaimsShadow,
  SYNC_OUTCOMES,
  DATE_EDIT_SOURCE,
  MRI_CATEGORY,
  MRI_SOURCE
};
