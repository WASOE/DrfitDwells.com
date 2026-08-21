'use strict';

/**
 * Permanent UnitNightClaim domain service (Inventory Integrity I6).
 * Binding: docs/stay-change-implementation-plan.md — I6 authoritative cutover.
 *
 * Production correctness path is standalone compensation (no multi-document txn required).
 */

const mongoose = require('mongoose');
const UnitNightClaim = require('../../models/UnitNightClaim');
const { AUTHORITATIVE_UNIQUE_INDEX_SPEC } = require('../../models/UnitNightClaim');
const { expandOccupiedSofiaNightDateOnlys } = require('../ops/reporting/stayNights');
const { normalizeDateToSofiaDayStart } = require('../../utils/dateTime');

const ERR = Object.freeze({
  VALIDATION: 'UNIT_NIGHT_CLAIM_VALIDATION',
  FOREIGN_OWNER: 'UNIT_NIGHT_CLAIM_FOREIGN_OWNER',
  TRANSFER_TARGET_FAILED: 'UNIT_NIGHT_CLAIM_TRANSFER_TARGET_FAILED',
  OWNERSHIP_MISMATCH: 'UNIT_NIGHT_CLAIM_OWNERSHIP_MISMATCH',
  INDEX_MISSING: 'UNIT_NIGHT_CLAIM_AUTHORITATIVE_INDEX_MISSING',
  COMPENSATION_FAILED: 'UNIT_NIGHT_CLAIM_COMPENSATION_FAILED',
  STAY_CHANGE_OWNERSHIP_CONFLICT: 'UNIT_NIGHT_CLAIM_STAY_CHANGE_OWNERSHIP_CONFLICT'
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

function indexKeysMatch(indexKey, expectedKeys) {
  const a = Object.keys(indexKey || {});
  const b = Object.keys(expectedKeys || {});
  if (a.length !== b.length) return false;
  for (const k of b) {
    if (Number(indexKey[k]) !== Number(expectedKeys[k])) return false;
  }
  return true;
}

/**
 * Verify exact authoritative unique index metadata.
 * Call once per claim acquisition operation (no process-lifetime positive cache).
 */
async function assertAuthoritativeUnitNightIndex({ collection = null } = {}) {
  const spec = AUTHORITATIVE_UNIQUE_INDEX_SPEC;
  const col = collection || UnitNightClaim.collection;
  let indexes;
  try {
    indexes = await col.indexes();
  } catch (err) {
    throw createClaimError(ERR.INDEX_MISSING, 'Unable to list UnitNightClaim indexes', {
      cause: err?.message || String(err)
    });
  }
  const match = (indexes || []).find(
    (idx) =>
      idx &&
      idx.name === spec.options.name &&
      idx.unique === true &&
      indexKeysMatch(idx.key, spec.keys)
  );
  if (!match) {
    throw createClaimError(
      ERR.INDEX_MISSING,
      'Authoritative UnitNightClaim unique index is missing or incorrect',
      {
        expectedName: spec.options.name,
        expectedKeys: { ...spec.keys },
        expectedUnique: true,
        foundNames: (indexes || []).map((i) => i.name)
      }
    );
  }
  return { ok: true, index: match };
}

function isDuplicateKeyError(err) {
  if (!err) return false;
  if (err.code === 11000 || err.code === 11001) return true;
  const msg = String(err.message || '');
  return /E11000|duplicate key/i.test(msg);
}

async function normalizeForeignOrDuplicateConflict({
  err,
  unitOid,
  bookingOid,
  nightDates,
  session = null
}) {
  const existing = await UnitNightClaim.find({
    unitId: unitOid,
    night: { $in: nightDates }
  })
    .session(session || null)
    .lean();

  const conflicts = [];
  for (const row of existing) {
    if (String(row.bookingId) === String(bookingOid)) continue;
    conflicts.push({
      night: dateOnlyFromNightDate(row.night),
      holderBookingId: String(row.bookingId),
      claimId: String(row._id)
    });
  }

  if (conflicts.length === 0 && isDuplicateKeyError(err)) {
    conflicts.push({
      night: null,
      holderBookingId: null,
      claimId: null
    });
  }

  const primary = conflicts[0] || {};
  return createClaimError(ERR.FOREIGN_OWNER, 'One or more unit-nights are owned by another booking', {
    unitId: String(unitOid),
    night: primary.night || null,
    requestedBookingId: String(bookingOid),
    existingBookingId: primary.holderBookingId || null,
    bookingId: String(bookingOid),
    conflicts
  });
}

async function compensateAttemptInserts({
  bookingOid,
  unitOid,
  insertedNightDates,
  session = null
}) {
  if (!insertedNightDates || insertedNightDates.length === 0) {
    return { deletedCount: 0 };
  }
  try {
    const result = await UnitNightClaim.deleteMany(
      {
        bookingId: bookingOid,
        unitId: unitOid,
        night: { $in: insertedNightDates }
      },
      sessionOpts(session)
    );
    return { deletedCount: result.deletedCount || 0 };
  } catch (compErr) {
    throw createClaimError(
      ERR.COMPENSATION_FAILED,
      'Failed to compensate partial UnitNightClaim acquisition',
      {
        unitId: String(unitOid),
        bookingId: String(bookingOid),
        nights: insertedNightDates.map(dateOnlyFromNightDate),
        cause: compErr?.message || String(compErr)
      }
    );
  }
}

/**
 * Authoritative acquire. All-or-nothing for newly inserted nights (compensation path).
 */
async function claimUnitNights({
  bookingId,
  unitId,
  checkIn = null,
  checkOut = null,
  nights = null,
  stayChangeId = null,
  source = 'other',
  session = null,
  skipIndexAssert = false,
  /**
   * R1: when true, same-booking nights count as owned only if stayChangeId matches.
   * Same booking + different/null stayChangeId on TARGET → STAY_CHANGE_OWNERSHIP_CONFLICT.
   * Ordinary creators leave this false (booking-scoped idempotency unchanged).
   */
  requireExactStayChangeOwnership = false
} = {}) {
  if (!skipIndexAssert) {
    await assertAuthoritativeUnitNightIndex();
  }

  const bookingOid = toObjectId(bookingId, 'bookingId');
  const unitOid = toObjectId(unitId, 'unitId');
  const stayChangeOid =
    stayChangeId == null || stayChangeId === ''
      ? null
      : toObjectId(stayChangeId, 'stayChangeId');

  if (requireExactStayChangeOwnership && !stayChangeOid) {
    throw createClaimError(ERR.VALIDATION, 'stayChangeId is required when requireExactStayChangeOwnership is set', {
      field: 'stayChangeId'
    });
  }

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
  const stayChangeConflicts = [];
  const ownedNightKeys = new Set();
  for (const row of existing) {
    const key = dateOnlyFromNightDate(row.night);
    if (String(row.bookingId) !== String(bookingOid)) {
      foreign.push({
        night: key,
        holderBookingId: String(row.bookingId),
        claimId: String(row._id)
      });
      continue;
    }

    if (requireExactStayChangeOwnership) {
      const rowSc = row.stayChangeId ? String(row.stayChangeId) : null;
      const wantSc = String(stayChangeOid);
      if (rowSc === wantSc) {
        ownedNightKeys.add(key);
      } else {
        stayChangeConflicts.push({
          night: key,
          holderBookingId: String(row.bookingId),
          holderStayChangeId: rowSc,
          requestedStayChangeId: wantSc,
          claimId: String(row._id)
        });
      }
    } else {
      ownedNightKeys.add(key);
    }
  }

  if (foreign.length > 0) {
    const primary = foreign[0];
    throw createClaimError(ERR.FOREIGN_OWNER, 'One or more unit-nights are owned by another booking', {
      unitId: String(unitOid),
      night: primary.night,
      requestedBookingId: String(bookingOid),
      existingBookingId: primary.holderBookingId,
      bookingId: String(bookingOid),
      conflicts: foreign
    });
  }

  if (stayChangeConflicts.length > 0) {
    const primary = stayChangeConflicts[0];
    throw createClaimError(
      ERR.STAY_CHANGE_OWNERSHIP_CONFLICT,
      'One or more unit-nights are owned by the same booking under a different StayChange',
      {
        unitId: String(unitOid),
        night: primary.night,
        bookingId: String(bookingOid),
        requestedStayChangeId: primary.requestedStayChangeId,
        existingStayChangeId: primary.holderStayChangeId,
        conflicts: stayChangeConflicts
      }
    );
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

  const insertedThisAttempt = [];

  if (toInsert.length > 0) {
    try {
      for (const doc of toInsert) {
        // eslint-disable-next-line no-await-in-loop
        if (session) {
          await UnitNightClaim.create([doc], { session });
        } else {
          await UnitNightClaim.create(doc);
        }
        insertedThisAttempt.push(doc.night);
      }
    } catch (err) {
      let compensationError = null;
      try {
        await compensateAttemptInserts({
          bookingOid,
          unitOid,
          insertedNightDates: insertedThisAttempt,
          session
        });
      } catch (compErr) {
        compensationError = compErr;
      }

      if (compensationError) {
        throw compensationError;
      }

      if (isDuplicateKeyError(err) || err?.code === ERR.FOREIGN_OWNER) {
        throw await normalizeForeignOrDuplicateConflict({
          err,
          unitOid,
          bookingOid,
          nightDates,
          session
        });
      }
      throw err;
    }
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
    stayChangeId: stayChangeOid ? String(stayChangeOid) : null,
    nights: nightDates.map(dateOnlyFromNightDate),
    insertedCount: insertedThisAttempt.length,
    alreadyOwnedCount: ownedNightKeys.size,
    insertedNightsThisAttempt: insertedThisAttempt.map(dateOnlyFromNightDate),
    claims: claims.map((c) => ({
      id: String(c._id),
      night: dateOnlyFromNightDate(c.night),
      source: c.source,
      stayChangeId: c.stayChangeId ? String(c.stayChangeId) : null
    }))
  };
}

async function compensateClaimAttempt({
  bookingId,
  unitId,
  nights = null,
  insertedNightsThisAttempt = null,
  session = null
} = {}) {
  const bookingOid = toObjectId(bookingId, 'bookingId');
  const unitOid = toObjectId(unitId, 'unitId');
  const nightList =
    Array.isArray(insertedNightsThisAttempt) && insertedNightsThisAttempt.length > 0
      ? insertedNightsThisAttempt
      : nights;
  if (!nightList || nightList.length === 0) {
    return { ok: true, deletedCount: 0 };
  }
  const nightDates = resolveOccupiedNightDates({ nights: nightList });
  const result = await compensateAttemptInserts({
    bookingOid,
    unitOid,
    insertedNightDates: nightDates,
    session
  });
  return { ok: true, ...result };
}

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

async function deleteSameOwnerDuplicateClaims({
  unitId,
  night,
  bookingId,
  session = null
} = {}) {
  const unitOid = toObjectId(unitId, 'unitId');
  const bookingOid = toObjectId(bookingId, 'bookingId');
  const nightDate =
    night instanceof Date ? normalizeDateToSofiaDayStart(night) : nightDateFromDateOnly(String(night).slice(0, 10));

  const rows = await UnitNightClaim.find({
    unitId: unitOid,
    night: nightDate,
    bookingId: bookingOid
  })
    .session(session || null)
    .sort({ createdAt: 1, _id: 1 })
    .lean();

  if (rows.length <= 1) {
    return {
      ok: true,
      keptClaimId: rows[0] ? String(rows[0]._id) : null,
      deletedCount: 0
    };
  }

  const keepId = rows[0]._id;
  const deleteIds = rows.slice(1).map((r) => r._id);
  const result = await UnitNightClaim.deleteMany(
    { _id: { $in: deleteIds } },
    sessionOpts(session)
  );
  return {
    ok: true,
    keptClaimId: String(keepId),
    deletedCount: result.deletedCount || 0
  };
}

/**
 * R1: delete target claims owned by a specific StayChange only.
 * Never broad bookingId delete. Optional night scope for exact stay nights.
 */
async function releaseStayChangeTargetClaims({
  bookingId,
  stayChangeId,
  unitId,
  checkIn = null,
  checkOut = null,
  nights = null,
  session = null
} = {}) {
  const bookingOid = toObjectId(bookingId, 'bookingId');
  const stayChangeOid = toObjectId(stayChangeId, 'stayChangeId');
  const unitOid = toObjectId(unitId, 'unitId');
  const filter = {
    bookingId: bookingOid,
    stayChangeId: stayChangeOid,
    unitId: unitOid
  };
  if ((checkIn != null && checkOut != null) || (Array.isArray(nights) && nights.length > 0)) {
    const nightDates = resolveOccupiedNightDates({ checkIn, checkOut, nights });
    filter.night = { $in: nightDates };
  }
  const result = await UnitNightClaim.deleteMany(filter, sessionOpts(session));
  return {
    ok: true,
    bookingId: String(bookingOid),
    stayChangeId: String(stayChangeOid),
    unitId: String(unitOid),
    deletedCount: result.deletedCount || 0
  };
}

module.exports = {
  ERR,
  claimUnitNights,
  releaseUnitNights,
  releaseStayChangeTargetClaims,
  transferUnitNightClaims,
  assertBookingOwnsNights,
  deleteSameOwnerDuplicateClaims,
  assertAuthoritativeUnitNightIndex,
  compensateClaimAttempt,
  resolveOccupiedNightDates,
  expandOccupiedSofiaNightDateOnlys,
  nightDateFromDateOnly,
  dateOnlyFromNightDate,
  createClaimError,
  isDuplicateKeyError,
  AUTHORITATIVE_UNIQUE_INDEX_SPEC,
  /** Test/helper: create exact authoritative unique index (idempotent). */
  async ensureAuthoritativeUniqueIndexForTests() {
    await UnitNightClaim.collection.createIndex(
      AUTHORITATIVE_UNIQUE_INDEX_SPEC.keys,
      { ...AUTHORITATIVE_UNIQUE_INDEX_SPEC.options }
    );
  }
};
