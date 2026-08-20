'use strict';

/**
 * Permanent UnitNightClaim domain service (Inventory Integrity).
 * Binding: docs/stay-change-implementation-plan.md §10.3
 *
 * I1: service exists; writers are NOT wired yet. Authoritative unique index is I6.
 */

const mongoose = require('mongoose');
const UnitNightClaim = require('../../models/UnitNightClaim');
const { expandOccupiedSofiaNightDateOnlys } = require('../ops/reporting/stayNights');
const { normalizeDateToSofiaDayStart } = require('../../utils/dateTime');

const ERR = Object.freeze({
  VALIDATION: 'UNIT_NIGHT_CLAIM_VALIDATION',
  FOREIGN_OWNER: 'UNIT_NIGHT_CLAIM_FOREIGN_OWNER',
  TRANSFER_TARGET_FAILED: 'UNIT_NIGHT_CLAIM_TRANSFER_TARGET_FAILED',
  OWNERSHIP_MISMATCH: 'UNIT_NIGHT_CLAIM_OWNERSHIP_MISMATCH'
});

function toObjectId(value, fieldName) {
  if (value == null || value === '') {
    throw createClaimError(ERR.VALIDATION, `${fieldName} is required`, { field: fieldName });
  }
  const s = String(value);
  if (!mongoose.Types.ObjectId.isValid(s)) {
    throw createClaimError(ERR.VALIDATION, `${fieldName} is invalid`, { field: fieldName, value: s });
  }
  return new mongoose.Types.ObjectId(s);
}

function createClaimError(code, message, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.details = details;
  return err;
}

function nightDateFromDateOnly(dateOnly) {
  return normalizeDateToSofiaDayStart(`${dateOnly}T12:00:00.000Z`);
}

function dateOnlyFromNightDate(nightDate) {
  const { formatSofiaDateOnly } = require('../../utils/dateTime');
  return formatSofiaDateOnly(nightDate);
}

/**
 * Expand stay into Sofia occupied night Date instances (day-start).
 */
function resolveOccupiedNightDates({ checkIn, checkOut, nights } = {}) {
  if (Array.isArray(nights) && nights.length > 0) {
    return nights.map((n) => {
      if (n instanceof Date) return normalizeDateToSofiaDayStart(n);
      const raw = String(n).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return nightDateFromDateOnly(raw);
      return normalizeDateToSofiaDayStart(n);
    });
  }
  if (checkIn == null || checkOut == null) {
    throw createClaimError(ERR.VALIDATION, 'checkIn/checkOut or nights is required');
  }
  const expanded = expandOccupiedSofiaNightDateOnlys(checkIn, checkOut);
  if (!expanded.ok) {
    throw createClaimError(ERR.VALIDATION, `Invalid stay range for claims: ${expanded.reason}`, {
      reason: expanded.reason,
      checkInDateOnly: expanded.checkInDateOnly,
      checkOutDateOnly: expanded.checkOutDateOnly
    });
  }
  return expanded.dateOnlys.map(nightDateFromDateOnly);
}

function sessionOpts(session) {
  return session ? { session } : {};
}

/**
 * @returns {Promise<{ bookingId, unitId, nights: string[], insertedCount, alreadyOwnedCount, claims }>}
 */
async function claimUnitNights({
  bookingId,
  unitId,
  checkIn = null,
  checkOut = null,
  nights = null,
  stayChangeId = null,
  source = 'other',
  session = null
} = {}) {
  const bookingOid = toObjectId(bookingId, 'bookingId');
  const unitOid = toObjectId(unitId, 'unitId');
  const stayChangeOid =
    stayChangeId == null || stayChangeId === ''
      ? null
      : toObjectId(stayChangeId, 'stayChangeId');
  const nightDates = resolveOccupiedNightDates({ checkIn, checkOut, nights });
  if (nightDates.length === 0) {
    throw createClaimError(ERR.VALIDATION, 'No occupied nights to claim');
  }

  const existing = await UnitNightClaim.find({
    unitId: unitOid,
    night: { $in: nightDates }
  })
    .session(session || null)
    .lean();

  const foreign = [];
  const ownedNightKeys = new Set();
  for (const row of existing) {
    const key = dateOnlyFromNightDate(row.night);
    if (String(row.bookingId) === String(bookingOid)) {
      ownedNightKeys.add(key);
    } else {
      foreign.push({
        night: key,
        holderBookingId: String(row.bookingId),
        claimId: String(row._id)
      });
    }
  }

  if (foreign.length > 0) {
    throw createClaimError(ERR.FOREIGN_OWNER, 'One or more unit-nights are owned by another booking', {
      unitId: String(unitOid),
      bookingId: String(bookingOid),
      conflicts: foreign
    });
  }

  const toInsert = [];
  for (const nightDate of nightDates) {
    const key = dateOnlyFromNightDate(nightDate);
    if (ownedNightKeys.has(key)) continue;
    toInsert.push({
      unitId: unitOid,
      night: nightDate,
      bookingId: bookingOid,
      stayChangeId: stayChangeOid,
      source: String(source || 'other').trim() || 'other'
    });
  }

  if (toInsert.length > 0) {
    await UnitNightClaim.insertMany(toInsert, { ...sessionOpts(session), ordered: true });
  }

  const claims = await UnitNightClaim.find({
    bookingId: bookingOid,
    unitId: unitOid,
    night: { $in: nightDates }
  })
    .session(session || null)
    .lean();

  return {
    ok: true,
    bookingId: String(bookingOid),
    unitId: String(unitOid),
    nights: nightDates.map(dateOnlyFromNightDate),
    insertedCount: toInsert.length,
    alreadyOwnedCount: ownedNightKeys.size,
    claims: claims.map((c) => ({
      id: String(c._id),
      night: dateOnlyFromNightDate(c.night),
      source: c.source
    }))
  };
}

/**
 * Delete claims owned by bookingId (optional unit / night scope). Idempotent.
 */
async function releaseUnitNights({
  bookingId,
  unitId = null,
  checkIn = null,
  checkOut = null,
  nights = null,
  session = null
} = {}) {
  const bookingOid = toObjectId(bookingId, 'bookingId');
  const filter = { bookingId: bookingOid };

  if (unitId != null && unitId !== '') {
    filter.unitId = toObjectId(unitId, 'unitId');
  }

  if ((checkIn != null && checkOut != null) || (Array.isArray(nights) && nights.length > 0)) {
    const nightDates = resolveOccupiedNightDates({ checkIn, checkOut, nights });
    filter.night = { $in: nightDates };
  }

  const result = await UnitNightClaim.deleteMany(filter, sessionOpts(session));
  return {
    ok: true,
    bookingId: String(bookingOid),
    deletedCount: result.deletedCount || 0
  };
}

/**
 * Secure target nights for booking, then release source nights on fromUnitId.
 * Never releases source if target claim fails.
 */
async function transferUnitNightClaims({
  bookingId,
  fromUnitId,
  toUnitId,
  checkIn,
  checkOut,
  nights = null,
  stayChangeId = null,
  source = 'reallocate',
  session = null
} = {}) {
  const bookingOid = toObjectId(bookingId, 'bookingId');
  const fromOid = toObjectId(fromUnitId, 'fromUnitId');
  const toOid = toObjectId(toUnitId, 'toUnitId');

  if (String(fromOid) === String(toOid)) {
    const nightDates = resolveOccupiedNightDates({ checkIn, checkOut, nights });
    return {
      ok: true,
      changed: false,
      bookingId: String(bookingOid),
      fromUnitId: String(fromOid),
      toUnitId: String(toOid),
      nights: nightDates.map(dateOnlyFromNightDate)
    };
  }

  let claimed;
  try {
    claimed = await claimUnitNights({
      bookingId: bookingOid,
      unitId: toOid,
      checkIn,
      checkOut,
      nights,
      stayChangeId,
      source,
      session
    });
  } catch (err) {
    if (err && err.code === ERR.FOREIGN_OWNER) {
      throw createClaimError(ERR.TRANSFER_TARGET_FAILED, 'Cannot transfer: target unit-nights not fully securable', {
        ...err.details,
        fromUnitId: String(fromOid),
        toUnitId: String(toOid)
      });
    }
    throw err;
  }

  const released = await releaseUnitNights({
    bookingId: bookingOid,
    unitId: fromOid,
    checkIn,
    checkOut,
    nights,
    session
  });

  return {
    ok: true,
    changed: true,
    bookingId: String(bookingOid),
    fromUnitId: String(fromOid),
    toUnitId: String(toOid),
    nights: claimed.nights,
    claimed,
    released
  };
}

/**
 * Prove booking owns the required unit-night set.
 */
async function assertBookingOwnsNights({
  bookingId,
  unitId,
  checkIn = null,
  checkOut = null,
  nights = null,
  mode = 'exact',
  session = null
} = {}) {
  const bookingOid = toObjectId(bookingId, 'bookingId');
  const unitOid = toObjectId(unitId, 'unitId');
  const expectedDates = resolveOccupiedNightDates({ checkIn, checkOut, nights });
  const expectedKeys = expectedDates.map(dateOnlyFromNightDate).sort();

  const owned = await UnitNightClaim.find({
    bookingId: bookingOid,
    unitId: unitOid
  })
    .session(session || null)
    .lean();

  const ownedKeys = owned.map((c) => dateOnlyFromNightDate(c.night)).sort();
  const expectedSet = new Set(expectedKeys);
  const ownedSet = new Set(ownedKeys);

  const missing = expectedKeys.filter((k) => !ownedSet.has(k));
  const unexpected =
    mode === 'exact' ? ownedKeys.filter((k) => !expectedSet.has(k)) : [];

  const ok = missing.length === 0 && (mode !== 'exact' || unexpected.length === 0);

  if (!ok) {
    return {
      ok: false,
      code: ERR.OWNERSHIP_MISMATCH,
      bookingId: String(bookingOid),
      unitId: String(unitOid),
      mode,
      expectedNights: expectedKeys,
      ownedNights: ownedKeys,
      missingNights: missing,
      unexpectedNights: unexpected
    };
  }

  return {
    ok: true,
    bookingId: String(bookingOid),
    unitId: String(unitOid),
    mode,
    expectedNights: expectedKeys,
    ownedNights: ownedKeys,
    missingNights: [],
    unexpectedNights: []
  };
}

module.exports = {
  ERR,
  claimUnitNights,
  releaseUnitNights,
  transferUnitNightClaims,
  assertBookingOwnsNights,
  resolveOccupiedNightDates,
  expandOccupiedSofiaNightDateOnlys,
  nightDateFromDateOnly,
  dateOnlyFromNightDate,
  createClaimError
};
