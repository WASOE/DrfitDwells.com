'use strict';

/**
 * Permanent CabinNightClaim domain service (REBOOK-S1 foundation).
 * Binding: docs/stay-change-implementation-plan.md — §24.
 *
 * S1.1: foundation only — not authoritative in production until S1.6/S1.7.
 * S1.2: shadow callers must pass acquisitionMode: 'shadow' explicitly.
 * Production correctness path is standalone compensation (no multi-document txn required).
 */

const mongoose = require('mongoose');
const CabinNightClaim = require('../../models/CabinNightClaim');
const { AUTHORITATIVE_UNIQUE_INDEX_SPEC, CLAIM_SOURCES } = require('../../models/CabinNightClaim');
const { expandOccupiedSofiaNightDateOnlys } = require('../ops/reporting/stayNights');
const { normalizeDateToSofiaDayStart, formatSofiaDateOnly } = require('../../utils/dateTime');

const ACQUISITION_MODES = Object.freeze({
  SHADOW: 'shadow',
  AUTHORITATIVE: 'authoritative'
});

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

function resolveAcquisitionMode(acquisitionMode) {
  const mode = String(acquisitionMode || ACQUISITION_MODES.AUTHORITATIVE).trim();
  if (mode === ACQUISITION_MODES.SHADOW) return ACQUISITION_MODES.SHADOW;
  if (mode === ACQUISITION_MODES.AUTHORITATIVE) return ACQUISITION_MODES.AUTHORITATIVE;
  throw createClaimError(ERR.VALIDATION, `Invalid acquisitionMode: ${mode}`, {
    field: 'acquisitionMode',
    value: mode,
    allowed: Object.values(ACQUISITION_MODES)
  });
}

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
 * S1.2 shadow callers must pass acquisitionMode: 'shadow' explicitly.
 * Default acquisitionMode is 'authoritative' (requires unique index when used).
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
  acquisitionMode = ACQUISITION_MODES.AUTHORITATIVE
} = {}) {
  const mode = resolveAcquisitionMode(acquisitionMode);
  if (mode === ACQUISITION_MODES.AUTHORITATIVE) {
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

// ---------------------------------------------------------------------------
// B8F1A — thin checkout lease wrappers over shared engine
// ---------------------------------------------------------------------------

const { createCheckoutNightLeaseClaimEngine } = require('./checkoutNightLeaseClaimEngine');

const cabinCheckoutLeaseEngine = createCheckoutNightLeaseClaimEngine({
  ClaimModel: CabinNightClaim,
  resourceField: 'cabinId',
  assertAuthoritativeIndex: assertAuthoritativeCabinNightIndex,
  errorPrefix: 'CABIN_CHECKOUT_CLAIM',
  resolveOccupiedNightDates
});

const CHECKOUT_CLAIM_ERR = cabinCheckoutLeaseEngine.ERR;

async function acquireCabinCheckoutNights(opts = {}) {
  return cabinCheckoutLeaseEngine.acquireCheckoutNights({
    ...opts,
    resourceId: opts.cabinId
  });
}

async function compensateCabinCheckoutAcquisition(opts = {}) {
  return cabinCheckoutLeaseEngine.compensateAcquisition({
    ...opts,
    resourceId: opts.cabinId != null ? opts.cabinId : opts.resourceId
  });
}

async function clearCabinCheckoutAcquisitionMarkers(opts = {}) {
  return cabinCheckoutLeaseEngine.clearAcquisitionMarkers(opts);
}

async function verifyCabinCheckoutLeaseNights(opts = {}) {
  return cabinCheckoutLeaseEngine.verifyLeaseNights({
    ...opts,
    resourceId: opts.cabinId
  });
}

async function releaseCabinCheckoutLeaseClaims(opts = {}) {
  return cabinCheckoutLeaseEngine.releaseLeaseClaims({
    checkoutId: opts.checkoutId,
    leaseId: opts.leaseId,
    generation: opts.generation,
    resourceId: opts.cabinId != null ? opts.cabinId : opts.resourceId,
    session: opts.session || null,
    AccommodationCheckoutLease: opts.AccommodationCheckoutLease,
    LeaseModel: opts.LeaseModel,
    HeaderModel: opts.HeaderModel,
    leaseRepository: opts.leaseRepository,
    header: opts.header,
    leaseHeader: opts.leaseHeader,
    headerExpiryAuthorized: opts.headerExpiryAuthorized
  });
}

async function expireCabinCheckoutClaims(opts = {}) {
  return cabinCheckoutLeaseEngine.expireCheckoutClaims({
    checkoutId: opts.checkoutId,
    leaseId: opts.leaseId,
    generation: opts.generation,
    resourceId: opts.cabinId != null ? opts.cabinId : opts.resourceId,
    session: opts.session || null,
    now: opts.now,
    AccommodationCheckoutLease: opts.AccommodationCheckoutLease,
    LeaseModel: opts.LeaseModel,
    HeaderModel: opts.HeaderModel,
    leaseRepository: opts.leaseRepository,
    header: opts.header,
    leaseHeader: opts.leaseHeader,
    headerExpiryAuthorized: opts.headerExpiryAuthorized
  });
}

async function clearCabinSealedLeaseLeftoverMarkers(opts = {}) {
  return cabinCheckoutLeaseEngine.clearLeftoverMarkersForSealedLease(opts);
}

async function countCabinAcquisitionClaims(opts = {}) {
  return cabinCheckoutLeaseEngine.countAcquisitionClaims(opts);
}

// ---------------------------------------------------------------------------
// B8F4A — exact irreversible in-place checkout → booking claim promotion
// ---------------------------------------------------------------------------

const PROMOTION_ERR = Object.freeze({
  VALIDATION: 'CABIN_NIGHT_CLAIM_PROMOTION_VALIDATION',
  IDENTITY: 'CABIN_NIGHT_CLAIM_PROMOTION_IDENTITY',
  FOREIGN: 'CABIN_NIGHT_CLAIM_PROMOTION_FOREIGN',
  INCOMPLETE: 'CABIN_NIGHT_CLAIM_PROMOTION_INCOMPLETE'
});

function mapCabinPromotionClaimDto(row) {
  return {
    id: String(row._id),
    cabinId: String(row.cabinId),
    night: dateOnlyFromNightDate(row.night),
    ownerType: row.ownerType || 'booking',
    bookingId: row.bookingId != null ? String(row.bookingId) : null,
    checkoutId: row.checkoutId != null ? String(row.checkoutId) : null,
    leaseId: row.leaseId != null ? String(row.leaseId) : null,
    acquisitionId: row.acquisitionId != null ? String(row.acquisitionId) : null,
    expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
    source: row.source,
    convertedFromCheckoutId:
      row.convertedFromCheckoutId != null ? String(row.convertedFromCheckoutId) : null,
    convertedFromLeaseId: row.convertedFromLeaseId != null ? String(row.convertedFromLeaseId) : null,
    convertedFromGeneration:
      row.convertedFromGeneration != null ? Number(row.convertedFromGeneration) : null,
    convertedFromAttemptId:
      row.convertedFromAttemptId != null ? String(row.convertedFromAttemptId) : null,
    convertedFromQuoteSnapshotHash:
      row.convertedFromQuoteSnapshotHash != null
        ? String(row.convertedFromQuoteSnapshotHash)
        : null,
    convertedAt: row.convertedAt ? new Date(row.convertedAt).toISOString() : null
  };
}

function normalizeCabinPromotionProvenance(provenance = {}) {
  const checkoutId = String(provenance.checkoutId || '').trim();
  const leaseId = String(provenance.leaseId || '').trim();
  const attemptId = String(provenance.attemptId || '').trim();
  const quoteSnapshotHash = String(provenance.quoteSnapshotHash || '').trim();
  const generation = Number(provenance.generation);
  if (!checkoutId || !leaseId || !attemptId || !quoteSnapshotHash) {
    throw createClaimError(
      PROMOTION_ERR.VALIDATION,
      'checkoutId, leaseId, attemptId, and quoteSnapshotHash are required for promotion provenance'
    );
  }
  if (!Number.isInteger(generation) || generation < 1) {
    throw createClaimError(PROMOTION_ERR.VALIDATION, 'generation must be a positive integer', {
      generation: provenance.generation
    });
  }
  return { checkoutId, leaseId, attemptId, quoteSnapshotHash, generation };
}

function rowMatchesExactCabinConversionProvenance(row, provenance, bookingOid) {
  if (!row || row.ownerType === 'checkout') return false;
  if (String(row.bookingId) !== String(bookingOid)) return false;
  if (String(row.convertedFromCheckoutId || '') !== provenance.checkoutId) return false;
  if (String(row.convertedFromLeaseId || '') !== provenance.leaseId) return false;
  if (Number(row.convertedFromGeneration) !== Number(provenance.generation)) return false;
  if (String(row.convertedFromAttemptId || '') !== provenance.attemptId) return false;
  if (String(row.convertedFromQuoteSnapshotHash || '') !== provenance.quoteSnapshotHash) {
    return false;
  }
  return true;
}

async function preflightCabinPromotionNightSet({
  cabinOid,
  bookingOid,
  nightDates,
  provenance,
  session = null
}) {
  const expectedKeys = nightDates.map(dateOnlyFromNightDate);

  const rangeRows = await CabinNightClaim.find({
    cabinId: cabinOid,
    night: { $in: nightDates }
  })
    .session(session || null)
    .lean();

  const leaseExtra = await CabinNightClaim.find({
    ownerType: 'checkout',
    checkoutId: provenance.checkoutId,
    leaseId: provenance.leaseId,
    cabinId: cabinOid,
    night: { $nin: nightDates }
  })
    .session(session || null)
    .lean();
  if (leaseExtra.length > 0) {
    throw createClaimError(
      PROMOTION_ERR.IDENTITY,
      'Lease owns night(s) outside the expected stay range',
      {
        cabinId: String(cabinOid),
        leaseId: provenance.leaseId,
        extraNights: leaseExtra.map((r) => dateOnlyFromNightDate(r.night))
      }
    );
  }

  if (rangeRows.length !== nightDates.length) {
    throw createClaimError(PROMOTION_ERR.INCOMPLETE, 'Expected cabin-night set is incomplete or duplicated', {
      cabinId: String(cabinOid),
      expectedNightCount: nightDates.length,
      foundNightCount: rangeRows.length
    });
  }

  const byNight = new Map();
  for (const row of rangeRows) {
    const key = dateOnlyFromNightDate(row.night);
    if (byNight.has(key)) {
      throw createClaimError(PROMOTION_ERR.IDENTITY, 'Duplicate cabin-night rows for expected night', {
        cabinId: String(cabinOid),
        night: key
      });
    }
    byNight.set(key, row);
  }

  const classified = [];
  for (const key of expectedKeys) {
    const row = byNight.get(key);
    if (!row) {
      throw createClaimError(PROMOTION_ERR.IDENTITY, 'Expected cabin-night claim is missing', {
        cabinId: String(cabinOid),
        night: key,
        checkoutId: provenance.checkoutId,
        leaseId: provenance.leaseId
      });
    }
    if (row.ownerType === 'checkout') {
      if (
        String(row.checkoutId || '') !== provenance.checkoutId ||
        String(row.leaseId || '') !== provenance.leaseId
      ) {
        throw createClaimError(PROMOTION_ERR.FOREIGN, 'Expected night owned by a foreign checkout lease', {
          cabinId: String(cabinOid),
          night: key,
          claimId: String(row._id),
          holderCheckoutId: row.checkoutId != null ? String(row.checkoutId) : null,
          holderLeaseId: row.leaseId != null ? String(row.leaseId) : null
        });
      }
      if (row.bookingId != null || String(row.source || '') !== 'checkout_lease') {
        throw createClaimError(PROMOTION_ERR.IDENTITY, 'Checkout source row has invalid identity', {
          cabinId: String(cabinOid),
          night: key,
          claimId: String(row._id)
        });
      }
      classified.push({ kind: 'checkout_source', row, nightKey: key });
      continue;
    }
    if (rowMatchesExactCabinConversionProvenance(row, provenance, bookingOid)) {
      classified.push({ kind: 'exact_destination', row, nightKey: key });
      continue;
    }
    throw createClaimError(PROMOTION_ERR.FOREIGN, 'Expected night owned by incompatible booking state', {
      cabinId: String(cabinOid),
      night: key,
      claimId: String(row._id),
      holderBookingId: row.bookingId != null ? String(row.bookingId) : null,
      expectedBookingId: String(bookingOid)
    });
  }

  return { classified, expectedKeys };
}

async function assertExactCabinBookingPromotionDestination({
  cabinOid,
  bookingOid,
  nightDates,
  provenance,
  session = null
}) {
  const rows = await CabinNightClaim.find({
    cabinId: cabinOid,
    night: { $in: nightDates }
  })
    .session(session || null)
    .lean();

  if (rows.length !== nightDates.length) {
    throw createClaimError(PROMOTION_ERR.INCOMPLETE, 'Promoted cabin-night set count mismatch', {
      cabinId: String(cabinOid),
      bookingId: String(bookingOid),
      expectedNightCount: nightDates.length,
      foundNightCount: rows.length
    });
  }

  const byNight = new Map(rows.map((r) => [dateOnlyFromNightDate(r.night), r]));
  for (const nd of nightDates) {
    const key = dateOnlyFromNightDate(nd);
    const row = byNight.get(key);
    if (!row || row.ownerType === 'checkout') {
      throw createClaimError(
        PROMOTION_ERR.INCOMPLETE,
        'Expected cabin-night remains checkout-owned after promotion',
        { cabinId: String(cabinOid), bookingId: String(bookingOid), night: key }
      );
    }
    if (!rowMatchesExactCabinConversionProvenance(row, provenance, bookingOid)) {
      throw createClaimError(
        PROMOTION_ERR.FOREIGN,
        'Promoted cabin-night lacks exact conversion provenance',
        {
          cabinId: String(cabinOid),
          night: key,
          claimId: String(row._id),
          holderBookingId: row.bookingId != null ? String(row.bookingId) : null
        }
      );
    }
    if (
      (row.checkoutId != null && String(row.checkoutId).trim() !== '') ||
      (row.leaseId != null && String(row.leaseId).trim() !== '') ||
      (row.acquisitionId != null && String(row.acquisitionId).trim() !== '') ||
      row.expiresAt != null
    ) {
      throw createClaimError(PROMOTION_ERR.IDENTITY, 'Booking-owned cabin claim retains checkout fields', {
        cabinId: String(cabinOid),
        night: key,
        claimId: String(row._id)
      });
    }
  }

  const leaseExtra = await CabinNightClaim.countDocuments({
    ownerType: 'checkout',
    checkoutId: provenance.checkoutId,
    leaseId: provenance.leaseId,
    cabinId: cabinOid
  }).session(session || null);
  if (leaseExtra > 0) {
    throw createClaimError(
      PROMOTION_ERR.INCOMPLETE,
      'Checkout-owned lease nights remain after promotion',
      { cabinId: String(cabinOid), leaseId: provenance.leaseId, remaining: leaseExtra }
    );
  }

  return rows.map(mapCabinPromotionClaimDto);
}

async function promoteCabinCheckoutClaimsToBooking({
  cabinId,
  checkoutId,
  leaseId,
  bookingId,
  generation,
  attemptId,
  quoteSnapshotHash,
  checkIn = null,
  checkOut = null,
  nights = null,
  skipIndexAssert = false,
  session = null,
  onAfterClaimPromoted = null
} = {}) {
  if (!skipIndexAssert) {
    await assertAuthoritativeCabinNightIndex();
  }

  const cabinOid = toObjectId(cabinId, 'cabinId');
  const bookingOid = toObjectId(bookingId, 'bookingId');
  const provenance = normalizeCabinPromotionProvenance({
    checkoutId,
    leaseId,
    generation,
    attemptId,
    quoteSnapshotHash
  });

  const nightDates = resolveOccupiedNightDates({ checkIn, checkOut, nights });
  if (nightDates.length === 0) {
    throw createClaimError(PROMOTION_ERR.VALIDATION, 'At least one night is required for promotion');
  }

  const { classified } = await preflightCabinPromotionNightSet({
    cabinOid,
    bookingOid,
    nightDates,
    provenance,
    session
  });

  let promotedCount = 0;
  let alreadyOwnedCount = 0;
  const convertedAt = new Date();

  for (const item of classified) {
    if (item.kind === 'exact_destination') {
      alreadyOwnedCount += 1;
      continue;
    }
    const row = item.row;
    const nightDate = row.night;
    const nightKey = item.nightKey;

    const updated = await CabinNightClaim.findOneAndUpdate(
      {
        _id: row._id,
        cabinId: cabinOid,
        night: nightDate,
        ownerType: 'checkout',
        checkoutId: provenance.checkoutId,
        leaseId: provenance.leaseId,
        bookingId: null,
        source: 'checkout_lease'
      },
      {
        $set: {
          ownerType: 'booking',
          bookingId: bookingOid,
          checkoutId: null,
          leaseId: null,
          acquisitionId: null,
          expiresAt: null,
          source: 'checkout_lease',
          convertedFromCheckoutId: provenance.checkoutId,
          convertedFromLeaseId: provenance.leaseId,
          convertedFromGeneration: provenance.generation,
          convertedFromAttemptId: provenance.attemptId,
          convertedFromQuoteSnapshotHash: provenance.quoteSnapshotHash,
          convertedAt
        }
      },
      { new: true, ...sessionOpts(session) }
    );

    if (!updated) {
      const after = await CabinNightClaim.findOne({ cabinId: cabinOid, night: nightDate })
        .session(session || null)
        .lean();
      if (after && rowMatchesExactCabinConversionProvenance(after, provenance, bookingOid)) {
        alreadyOwnedCount += 1;
        continue;
      }
      throw createClaimError(
        PROMOTION_ERR.FOREIGN,
        'Concurrent promotion claimed cabin-night for another owner',
        {
          cabinId: String(cabinOid),
          night: nightKey,
          claimId: after && after._id != null ? String(after._id) : String(row._id),
          holderBookingId: after && after.bookingId != null ? String(after.bookingId) : null,
          expectedBookingId: String(bookingOid)
        }
      );
    }

    promotedCount += 1;
    if (typeof onAfterClaimPromoted === 'function') {
      await onAfterClaimPromoted({
        claimId: String(updated._id),
        night: nightKey,
        promotedCount,
        cabinId: String(cabinOid),
        bookingId: String(bookingOid)
      });
    }
  }

  const claims = await assertExactCabinBookingPromotionDestination({
    cabinOid,
    bookingOid,
    nightDates,
    provenance,
    session
  });

  return {
    ok: true,
    cabinId: String(cabinOid),
    bookingId: String(bookingOid),
    checkoutId: provenance.checkoutId,
    leaseId: provenance.leaseId,
    generation: provenance.generation,
    attemptId: provenance.attemptId,
    quoteSnapshotHash: provenance.quoteSnapshotHash,
    expectedNightCount: nightDates.length,
    promotedCount,
    alreadyOwnedCount,
    claimIds: claims.map((c) => c.id),
    claims
  };
}

module.exports = {
  ERR,
  CHECKOUT_CLAIM_ERR,
  PROMOTION_ERR,
  ACQUISITION_MODES,
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
  isBookingOwnedCabinClaim: cabinCheckoutLeaseEngine.isBookingOwnedClaim,
  isLiveCheckoutCabinClaim: cabinCheckoutLeaseEngine.isLiveCheckoutClaim,
  isExpiredCheckoutCabinClaim: cabinCheckoutLeaseEngine.isExpiredCheckoutClaim,
  acquireCabinCheckoutNights,
  compensateCabinCheckoutAcquisition,
  clearCabinCheckoutAcquisitionMarkers,
  verifyCabinCheckoutLeaseNights,
  releaseCabinCheckoutLeaseClaims,
  expireCabinCheckoutClaims,
  clearCabinSealedLeaseLeftoverMarkers,
  countCabinAcquisitionClaims,
  promoteCabinCheckoutClaimsToBooking,
  preflightCabinCheckoutClaimsForPromotion: async function preflightCabinCheckoutClaimsForPromotion(
    opts = {}
  ) {
    const cabinOid = toObjectId(opts.cabinId, 'cabinId');
    const bookingOid = toObjectId(opts.bookingId, 'bookingId');
    const provenance = normalizeCabinPromotionProvenance(opts);
    const nightDates = resolveOccupiedNightDates({
      checkIn: opts.checkIn,
      checkOut: opts.checkOut,
      nights: opts.nights
    });
    if (nightDates.length === 0) {
      throw createClaimError(PROMOTION_ERR.VALIDATION, 'At least one night is required for promotion');
    }
    return preflightCabinPromotionNightSet({
      cabinOid,
      bookingOid,
      nightDates,
      provenance,
      session: opts.session || null
    });
  },
  /** Test helper: create exact authoritative unique index (isolated test DB only). */
  async ensureAuthoritativeUniqueIndexForTests() {
    await CabinNightClaim.collection.createIndex(
      AUTHORITATIVE_UNIQUE_INDEX_SPEC.keys,
      { ...AUTHORITATIVE_UNIQUE_INDEX_SPEC.options }
    );
  },
  async ensureCheckoutLookupIndexesForTests() {
    await CabinNightClaim.collection.createIndex({ checkoutId: 1, leaseId: 1 });
    await CabinNightClaim.collection.createIndex({ leaseId: 1, acquisitionId: 1 });
    await CabinNightClaim.collection.createIndex({ ownerType: 1, expiresAt: 1 });
    await CabinNightClaim.collection.createIndex({
      convertedFromCheckoutId: 1,
      convertedFromLeaseId: 1
    });
    await CabinNightClaim.collection.createIndex({ bookingId: 1, convertedFromLeaseId: 1 });
  }
};
