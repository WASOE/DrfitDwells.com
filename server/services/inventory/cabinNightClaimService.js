'use strict';

/**
 * Permanent CabinNightClaim domain service (REBOOK-S1 foundation).
 * Binding: docs/stay-change-implementation-plan.md — §24.
 *
 * S1.1: foundation only — not authoritative in production until S1.6/S1.7.
 * Production correctness path is standalone compensation (no multi-document txn required).
 */

const mongoose = require('mongoose');
const CabinNightClaim = require('../../models/CabinNightClaim');
const { AUTHORITATIVE_UNIQUE_INDEX_SPEC, CLAIM_SOURCES } = require('../../models/CabinNightClaim');
const { expandOccupiedSofiaNightDateOnlys } = require('../ops/reporting/stayNights');
const { normalizeDateToSofiaDayStart, formatSofiaDateOnly } = require('../../utils/dateTime');

const ERR = Object.freeze({
  VALIDATION: 'CABIN_NIGHT_CLAIM_VALIDATION',
  INVALID_SOURCE: 'CABIN_NIGHT_CLAIM_INVALID_SOURCE',
  FOREIGN_OWNER: 'CABIN_NIGHT_CLAIM_FOREIGN_OWNER',
  OWNERSHIP_MISMATCH: 'CABIN_NIGHT_CLAIM_OWNERSHIP_MISMATCH',
  STAY_CHANGE_OWNERSHIP_CONFLICT: 'CABIN_NIGHT_CLAIM_STAY_CHANGE_OWNERSHIP_CONFLICT',
  INDEX_MISSING: 'CABIN_NIGHT_CLAIM_AUTHORITATIVE_INDEX_MISSING',
  INDEX_WRONG: 'CABIN_NIGHT_CLAIM_AUTHORITATIVE_INDEX_WRONG',
  COMPENSATION_FAILED: 'CABIN_NIGHT_CLAIM_COMPENSATION_FAILED',
  PARTIAL_ACQUISITION: 'CABIN_NIGHT_CLAIM_PARTIAL_ACQUISITION',
  INTEGRITY: 'CABIN_NIGHT_CLAIM_INTEGRITY'
});

const SOURCE_ALLOWLIST = new Set(CLAIM_SOURCES);

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

function normalizeSource(source) {
  const raw = String(source == null ? '' : source).trim();
  if (!raw) {
    throw createClaimError(ERR.INVALID_SOURCE, 'source is required', { field: 'source' });
  }
  if (!SOURCE_ALLOWLIST.has(raw)) {
    throw createClaimError(ERR.INVALID_SOURCE, `source is not allowed: ${raw}`, {
      field: 'source',
      value: raw,
      allowed: [...CLAIM_SOURCES]
    });
  }
  return raw;
}

function nightDateFromDateOnly(dateOnly) {
  return normalizeDateToSofiaDayStart(`${dateOnly}T12:00:00.000Z`);
}

function dateOnlyFromNightDate(nightDate) {
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

function stayChangeIdString(value) {
  if (value == null || value === '') return null;
  return String(value);
}

/**
 * Fail closed on provenance mutation. Same booking + compatible stayChangeId only.
 */
function classifyExistingClaimOwnership(existingRow, bookingOid, requestedStayChangeOid) {
  const nightKey = dateOnlyFromNightDate(existingRow.night);
  const existingBooking = String(existingRow.bookingId);

  if (existingBooking !== String(bookingOid)) {
    return {
      kind: 'foreign',
      night: nightKey,
      holderBookingId: existingBooking,
      claimId: String(existingRow._id)
    };
  }

  const existingSc = stayChangeIdString(existingRow.stayChangeId);
  const requestedSc = stayChangeIdString(requestedStayChangeOid);

  if (existingSc === requestedSc) {
    return { kind: 'owned', night: nightKey, claimId: String(existingRow._id), row: existingRow };
  }

  return {
    kind: 'stay_change_conflict',
    night: nightKey,
    holderBookingId: existingBooking,
    holderStayChangeId: existingSc,
    requestedStayChangeId: requestedSc,
    claimId: String(existingRow._id)
  };
}

function isDuplicateKeyError(err) {
  if (!err) return false;
  if (err.code === 11000 || err.code === 11001) return true;
  const msg = String(err.message || '');
  return /E11000|duplicate key/i.test(msg);
}

/**
 * Verify exact authoritative unique index metadata (read-only).
 */
async function assertAuthoritativeCabinNightIndex({ collection = null } = {}) {
  const spec = AUTHORITATIVE_UNIQUE_INDEX_SPEC;
  const col = collection || CabinNightClaim.collection;
  let indexes;
  try {
    indexes = await col.indexes();
  } catch (err) {
    throw createClaimError(ERR.INDEX_MISSING, 'Unable to list CabinNightClaim indexes', {
      cause: err?.message || String(err)
    });
  }

  const byName = (indexes || []).find((idx) => idx && idx.name === spec.options.name);
  if (!byName) {
    throw createClaimError(
      ERR.INDEX_MISSING,
      'Authoritative CabinNightClaim unique index is missing',
      {
        expectedName: spec.options.name,
        expectedKeys: { ...spec.keys },
        expectedUnique: true,
        foundNames: (indexes || []).map((i) => i.name)
      }
    );
  }

  if (
    byName.unique !== true ||
    !indexKeysMatch(byName.key, spec.keys)
  ) {
    throw createClaimError(
      ERR.INDEX_WRONG,
      'Authoritative CabinNightClaim unique index exists but metadata is incorrect',
      {
        expectedName: spec.options.name,
        expectedKeys: { ...spec.keys },
        expectedUnique: true,
        foundName: byName.name,
        foundKeys: byName.key,
        foundUnique: byName.unique
      }
    );
  }

  const wrongUniqueSameKeys = (indexes || []).filter(
    (idx) =>
      idx &&
      idx.name !== spec.options.name &&
      indexKeysMatch(idx.key, spec.keys) &&
      idx.unique === true
  );
  if (wrongUniqueSameKeys.length > 0) {
    throw createClaimError(ERR.INDEX_WRONG, 'Conflicting unique index on cabinId+night with wrong name', {
      expectedName: spec.options.name,
      conflictingNames: wrongUniqueSameKeys.map((i) => i.name)
    });
  }

  return { ok: true, index: byName };
}

async function compensateAttemptInsertsByIds({ insertedClaimIds, session = null }) {
  if (!insertedClaimIds || insertedClaimIds.length === 0) {
    return { deletedCount: 0 };
  }
  try {
    const result = await CabinNightClaim.deleteMany(
      { _id: { $in: insertedClaimIds } },
      sessionOpts(session)
    );
    return { deletedCount: result.deletedCount || 0 };
  } catch (compErr) {
    throw createClaimError(
      ERR.COMPENSATION_FAILED,
      'Failed to compensate partial CabinNightClaim acquisition',
      {
        insertedClaimIds: insertedClaimIds.map(String),
        cause: compErr?.message || String(compErr)
      }
    );
  }
}

/**
 * Acquire cabin-night ownership. All-or-nothing for newly inserted nights (compensation path).
 * S1.1 default skipIndexAssert=true — authoritative index not live until S1.6.
 */
async function claimCabinNights({
  cabinId,
  bookingId,
  checkIn = null,
  checkOut = null,
  nights = null,
  stayChangeId = null,
  source = 'other',
  session = null,
  skipIndexAssert = true
} = {}) {
  if (!skipIndexAssert) {
    await assertAuthoritativeCabinNightIndex();
  }

  const cabinOid = toObjectId(cabinId, 'cabinId');
  const bookingOid = toObjectId(bookingId, 'bookingId');
  const stayChangeOid =
    stayChangeId == null || stayChangeId === ''
      ? null
      : toObjectId(stayChangeId, 'stayChangeId');
  const normalizedSource = normalizeSource(source);

  const nightDates = resolveOccupiedNightDates({ checkIn, checkOut, nights });
  if (nightDates.length === 0) {
    throw createClaimError(ERR.VALIDATION, 'No occupied nights to claim');
  }

  const existing = await CabinNightClaim.find({
    cabinId: cabinOid,
    night: { $in: nightDates }
  })
    .session(session || null)
    .lean();

  const foreign = [];
  const stayChangeConflicts = [];
  const ownedNightKeys = new Set();
  const ownedClaimsByNight = new Map();

  for (const row of existing) {
    const classified = classifyExistingClaimOwnership(row, bookingOid, stayChangeOid);
    if (classified.kind === 'foreign') {
      foreign.push(classified);
      continue;
    }
    if (classified.kind === 'stay_change_conflict') {
      stayChangeConflicts.push(classified);
      continue;
    }
    ownedNightKeys.add(classified.night);
    ownedClaimsByNight.set(classified.night, classified.row);
  }

  if (foreign.length > 0) {
    const primary = foreign[0];
    throw createClaimError(ERR.FOREIGN_OWNER, 'One or more cabin-nights are owned by another booking', {
      cabinId: String(cabinOid),
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
      'One or more cabin-nights are owned under a different StayChange scope',
      {
        cabinId: String(cabinOid),
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
      cabinId: cabinOid,
      night: nightDate,
      bookingId: bookingOid,
      stayChangeId: stayChangeOid,
      source: normalizedSource
    });
  }

  const insertedThisAttemptIds = [];
  const insertedThisAttemptNights = [];

  if (toInsert.length > 0) {
    try {
      for (const doc of toInsert) {
        let created;
        // eslint-disable-next-line no-await-in-loop
        if (session) {
          created = await CabinNightClaim.create([doc], { session });
          created = Array.isArray(created) ? created[0] : created;
        } else {
          created = await CabinNightClaim.create(doc);
        }
        insertedThisAttemptIds.push(created._id);
        insertedThisAttemptNights.push(doc.night);
      }
    } catch (err) {
      let compensationError = null;
      try {
        await compensateAttemptInsertsByIds({
          insertedClaimIds: insertedThisAttemptIds,
          session
        });
      } catch (compErr) {
        compensationError = compErr;
      }

      if (compensationError) {
        throw compensationError;
      }

      if (isDuplicateKeyError(err)) {
        const after = await CabinNightClaim.find({
          cabinId: cabinOid,
          night: { $in: nightDates }
        })
          .session(session || null)
          .lean();

        const replayForeign = [];
        const replaySc = [];
        for (const nightDate of nightDates) {
          const key = dateOnlyFromNightDate(nightDate);
          const row = after.find((r) => dateOnlyFromNightDate(r.night) === key);
          if (!row) {
            throw createClaimError(ERR.PARTIAL_ACQUISITION, 'Duplicate key race left unowned cabin-night', {
              cabinId: String(cabinOid),
              night: key,
              bookingId: String(bookingOid)
            });
          }
          const classified = classifyExistingClaimOwnership(row, bookingOid, stayChangeOid);
          if (classified.kind === 'foreign') replayForeign.push(classified);
          else if (classified.kind === 'stay_change_conflict') replaySc.push(classified);
        }
        if (replayForeign.length > 0) {
          const primary = replayForeign[0];
          throw createClaimError(ERR.FOREIGN_OWNER, 'One or more cabin-nights are owned by another booking', {
            cabinId: String(cabinOid),
            night: primary.night,
            requestedBookingId: String(bookingOid),
            existingBookingId: primary.holderBookingId,
            bookingId: String(bookingOid),
            conflicts: replayForeign
          });
        }
        if (replaySc.length > 0) {
          const primary = replaySc[0];
          throw createClaimError(
            ERR.STAY_CHANGE_OWNERSHIP_CONFLICT,
            'One or more cabin-nights are owned under a different StayChange scope',
            {
              cabinId: String(cabinOid),
              night: primary.night,
              bookingId: String(bookingOid),
              requestedStayChangeId: primary.requestedStayChangeId,
              existingStayChangeId: primary.holderStayChangeId,
              conflicts: replaySc
            }
          );
        }
        // Same compatible owner won the race — idempotent replay after compensation.
      } else {
        throw err;
      }
    }
  }

  const claims = await CabinNightClaim.find({
    bookingId: bookingOid,
    cabinId: cabinOid,
    night: { $in: nightDates }
  })
    .session(session || null)
    .lean();

  return {
    ok: true,
    cabinId: String(cabinOid),
    bookingId: String(bookingOid),
    stayChangeId: stayChangeOid ? String(stayChangeOid) : null,
    nights: nightDates.map(dateOnlyFromNightDate),
    insertedCount: insertedThisAttemptIds.length,
    alreadyOwnedCount: ownedNightKeys.size,
    insertedNightsThisAttempt: insertedThisAttemptNights.map(dateOnlyFromNightDate),
    insertedClaimIdsThisAttempt: insertedThisAttemptIds.map(String),
    claims: claims.map((c) => ({
      id: String(c._id),
      night: dateOnlyFromNightDate(c.night),
      source: c.source,
      stayChangeId: c.stayChangeId ? String(c.stayChangeId) : null
    }))
  };
}

async function compensateCabinClaimAttempt({
  insertedClaimIdsThisAttempt = null,
  session = null
} = {}) {
  if (!Array.isArray(insertedClaimIdsThisAttempt) || insertedClaimIdsThisAttempt.length === 0) {
    return { ok: true, deletedCount: 0 };
  }
  const ids = insertedClaimIdsThisAttempt.map((id) => toObjectId(id, 'insertedClaimIdsThisAttempt'));
  const result = await compensateAttemptInsertsByIds({ insertedClaimIds: ids, session });
  return { ok: true, ...result };
}

async function releaseCabinNights({
  bookingId,
  cabinId = null,
  checkIn = null,
  checkOut = null,
  nights = null,
  session = null
} = {}) {
  const bookingOid = toObjectId(bookingId, 'bookingId');
  const filter = { bookingId: bookingOid };

  if (cabinId != null && cabinId !== '') {
    filter.cabinId = toObjectId(cabinId, 'cabinId');
  } else if (
    (checkIn == null || checkOut == null) &&
    (!Array.isArray(nights) || nights.length === 0)
  ) {
    throw createClaimError(
      ERR.VALIDATION,
      'releaseCabinNights requires cabinId and/or an explicit night range',
      { field: 'cabinId' }
    );
  }

  if ((checkIn != null && checkOut != null) || (Array.isArray(nights) && nights.length > 0)) {
    const nightDates = resolveOccupiedNightDates({ checkIn, checkOut, nights });
    filter.night = { $in: nightDates };
  }

  const result = await CabinNightClaim.deleteMany(filter, sessionOpts(session));
  return {
    ok: true,
    bookingId: String(bookingOid),
    cabinId: filter.cabinId ? String(filter.cabinId) : null,
    deletedCount: result.deletedCount || 0
  };
}

async function releaseStayChangeTargetCabinClaims({
  bookingId,
  stayChangeId,
  cabinId = null,
  source = 'rebook',
  checkIn = null,
  checkOut = null,
  nights = null,
  session = null
} = {}) {
  const bookingOid = toObjectId(bookingId, 'bookingId');
  const stayChangeOid = toObjectId(stayChangeId, 'stayChangeId');
  const normalizedSource = normalizeSource(source);
  if (normalizedSource !== 'rebook') {
    throw createClaimError(ERR.VALIDATION, 'releaseStayChangeTargetCabinClaims requires source=rebook', {
      field: 'source',
      value: normalizedSource
    });
  }

  const filter = {
    bookingId: bookingOid,
    stayChangeId: stayChangeOid,
    source: 'rebook'
  };

  if (cabinId != null && cabinId !== '') {
    filter.cabinId = toObjectId(cabinId, 'cabinId');
  }

  if ((checkIn != null && checkOut != null) || (Array.isArray(nights) && nights.length > 0)) {
    const nightDates = resolveOccupiedNightDates({ checkIn, checkOut, nights });
    filter.night = { $in: nightDates };
  }

  const result = await CabinNightClaim.deleteMany(filter, sessionOpts(session));
  return {
    ok: true,
    bookingId: String(bookingOid),
    stayChangeId: String(stayChangeOid),
    cabinId: filter.cabinId ? String(filter.cabinId) : null,
    deletedCount: result.deletedCount || 0
  };
}

async function assertBookingOwnsCabinNights({
  cabinId,
  bookingId,
  checkIn = null,
  checkOut = null,
  nights = null,
  stayChangeId = null,
  mode = 'exact',
  session = null
} = {}) {
  const cabinOid = toObjectId(cabinId, 'cabinId');
  const bookingOid = toObjectId(bookingId, 'bookingId');
  const stayChangeOid =
    stayChangeId == null || stayChangeId === ''
      ? null
      : toObjectId(stayChangeId, 'stayChangeId');

  const expectedDates = resolveOccupiedNightDates({ checkIn, checkOut, nights });
  const expectedKeys = expectedDates.map(dateOnlyFromNightDate).sort();

  const owned = await CabinNightClaim.find({
    bookingId: bookingOid,
    cabinId: cabinOid,
    night: { $in: expectedDates }
  })
    .session(session || null)
    .lean();

  const missing = [];
  const foreignOwner = [];
  const stayChangeMismatch = [];

  for (const key of expectedKeys) {
    const nightDate = nightDateFromDateOnly(key);
    const row = owned.find((c) => dateOnlyFromNightDate(c.night) === key);
    if (!row) {
      missing.push(key);
      continue;
    }
    if (String(row.bookingId) !== String(bookingOid)) {
      foreignOwner.push({ night: key, holderBookingId: String(row.bookingId) });
      continue;
    }
    const existingSc = stayChangeIdString(row.stayChangeId);
    const requestedSc = stayChangeIdString(stayChangeOid);
    if (existingSc !== requestedSc) {
      stayChangeMismatch.push({
        night: key,
        existingStayChangeId: existingSc,
        requestedStayChangeId: requestedSc
      });
    }
  }

  let unexpected = [];
  if (mode === 'exact') {
    const expectedSet = new Set(expectedKeys);
    unexpected = owned
      .map((c) => dateOnlyFromNightDate(c.night))
      .filter((k) => !expectedSet.has(k))
      .sort();
  }

  const ok =
    missing.length === 0 &&
    foreignOwner.length === 0 &&
    stayChangeMismatch.length === 0 &&
    (mode !== 'exact' || unexpected.length === 0);

  if (!ok) {
    return {
      ok: false,
      code:
        foreignOwner.length > 0
          ? ERR.FOREIGN_OWNER
          : stayChangeMismatch.length > 0
            ? ERR.STAY_CHANGE_OWNERSHIP_CONFLICT
            : ERR.OWNERSHIP_MISMATCH,
      cabinId: String(cabinOid),
      bookingId: String(bookingOid),
      mode,
      expectedNights: expectedKeys,
      ownedNights: owned.map((c) => dateOnlyFromNightDate(c.night)).sort(),
      missingNights: missing,
      foreignOwnerNights: foreignOwner,
      stayChangeMismatchNights: stayChangeMismatch,
      unexpectedNights: unexpected
    };
  }

  return {
    ok: true,
    cabinId: String(cabinOid),
    bookingId: String(bookingOid),
    mode,
    expectedNights: expectedKeys,
    ownedNights: expectedKeys,
    missingNights: [],
    unexpectedNights: []
  };
}

async function listCabinNightClaims({
  cabinId = null,
  bookingId = null,
  stayChangeId = null,
  checkIn = null,
  checkOut = null,
  nights = null,
  limit = 500,
  session = null
} = {}) {
  const filter = {};
  if (cabinId != null && cabinId !== '') {
    filter.cabinId = toObjectId(cabinId, 'cabinId');
  }
  if (bookingId != null && bookingId !== '') {
    filter.bookingId = toObjectId(bookingId, 'bookingId');
  }
  if (stayChangeId != null && stayChangeId !== '') {
    filter.stayChangeId = toObjectId(stayChangeId, 'stayChangeId');
  }

  if (Object.keys(filter).length === 0) {
    throw createClaimError(ERR.VALIDATION, 'listCabinNightClaims requires at least one scoped filter', {
      requiredOneOf: ['cabinId', 'bookingId', 'stayChangeId']
    });
  }

  if ((checkIn != null && checkOut != null) || (Array.isArray(nights) && nights.length > 0)) {
    const nightDates = resolveOccupiedNightDates({ checkIn, checkOut, nights });
    filter.night = { $in: nightDates };
  }

  const capped = Math.min(Math.max(1, Number(limit) || 500), 5000);
  const rows = await CabinNightClaim.find(filter)
    .sort({ cabinId: 1, night: 1, _id: 1 })
    .limit(capped)
    .session(session || null)
    .lean();

  return {
    ok: true,
    count: rows.length,
    claims: rows.map((c) => ({
      id: String(c._id),
      cabinId: String(c.cabinId),
      bookingId: String(c.bookingId),
      night: dateOnlyFromNightDate(c.night),
      stayChangeId: c.stayChangeId ? String(c.stayChangeId) : null,
      source: c.source,
      createdAt: c.createdAt
    }))
  };
}

module.exports = {
  ERR,
  CLAIM_SOURCES,
  AUTHORITATIVE_UNIQUE_INDEX_SPEC,
  claimCabinNights,
  releaseCabinNights,
  releaseStayChangeTargetCabinClaims,
  assertBookingOwnsCabinNights,
  listCabinNightClaims,
  assertAuthoritativeCabinNightIndex,
  compensateCabinClaimAttempt,
  resolveOccupiedNightDates,
  expandOccupiedSofiaNightDateOnlys,
  nightDateFromDateOnly,
  dateOnlyFromNightDate,
  createClaimError,
  isDuplicateKeyError,
  normalizeSource,
  /** Test helper: create exact authoritative unique index (isolated test DB only). */
  async ensureAuthoritativeUniqueIndexForTests() {
    await CabinNightClaim.collection.createIndex(
      AUTHORITATIVE_UNIQUE_INDEX_SPEC.keys,
      { ...AUTHORITATIVE_UNIQUE_INDEX_SPEC.options }
    );
  }
};
