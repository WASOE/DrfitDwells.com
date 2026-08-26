'use strict';

/**
 * REBOOK-S1.3 — READ-ONLY CabinNightClaim production preflight.
 * No inserts/updates/deletes/index mutations. Classification only.
 */

const crypto = require('crypto');
const mongoose = require('mongoose');
const { AUTHORITATIVE_UNIQUE_INDEX_SPEC } = require('../../models/CabinNightClaim');
const { BLOCKING_BOOKING_STATUSES } = require('../calendar/blockingStatusConstants');
const { expandOccupiedSofiaNightDateOnlys } = require('../ops/reporting/stayNights');
const { formatSofiaDateOnly } = require('../../utils/dateTime');
const {
  COMMERCIAL_SHAPES,
  classifyCommercialInventoryShape,
  shouldBookingOwnCabinNightClaims,
  isLocationLinkedBooking
} = require('./cabinNightClaimQualification');
const {
  CABIN_NIGHT_CLAIM_S1_WRITERS,
  listCabinNightClaimS1Writers
} = require('./cabinNightClaimWriterReadiness');

const CUTOVER_BATCH = 'S1';
const SAMPLE_LIMIT = 25;
const KNOWN_SOURCES = Object.freeze([
  'finalize',
  'legacy_create',
  'manual_reservation',
  'location_child',
  'date_edit',
  'reassign',
  'recovery',
  'bootstrap',
  'rebook',
  'test',
  'other'
]);

const BOOKING_SELECT =
  '_id status checkIn checkOut cabinId cabinTypeId unitId isTest archivedAt locationBookingId';

function stableHash(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj), 'utf8').digest('hex').slice(0, 24);
}

function sortIds(ids) {
  return [...(ids || [])].map((id) => String(id)).sort();
}

function idStr(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object' && value._id != null) return String(value._id);
  return String(value);
}

function cabinNightKey(cabinId, night) {
  return `${String(cabinId)}|${String(night)}`;
}

function ownershipKey(cabinId, night, bookingId) {
  return `${String(cabinId)}|${String(night)}|${String(bookingId)}`;
}

function dateOnlyFromNight(night) {
  if (night == null) return null;
  if (typeof night === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(night.trim())) return night.trim();
  return formatSofiaDateOnly(night);
}

function pushSample(arr, item, limit = SAMPLE_LIMIT) {
  if (arr.length < limit) arr.push(item);
}

function emptyCounts() {
  return {
    bookingsScanned: 0,
    blockingBookingsScanned: 0,
    validSingleBlockingBookings: 0,
    validAllocatedMultiBookings: 0,
    unallocatedMultiBookings: 0,
    locationSingleBlockingBookings: 0,
    isTestBlockingExclusions: 0,
    archivedBlockingExclusions: 0,
    expected: 0,
    actual: 0,
    missing: 0,
    stale: 0,
    orphan: 0,
    wrongCabin: 0,
    outsideRange: 0,
    sameOwnerDuplicates: 0,
    foreignOwnerDuplicates: 0,
    canonicalCollisions: 0,
    foreignClaimConflicts: 0,
    claimsForNonblockingBooking: 0,
    claimsForMultiInventoryBooking: 0,
    claimsForExcludedBooking: 0,
    claimsForMalformedBooking: 0,
    malformedBookings: 0,
    malformedClaims: 0,
    invalidCabinReferences: 0,
    invalidDateRanges: 0,
    remainingBlockers: 0,
    remainingBackfillBlockers: 0,
    remainingUniqueBlockers: 0
  };
}

function summarizeIndex(ix) {
  if (!ix) return null;
  return {
    name: ix.name || null,
    key: ix.key || null,
    unique: ix.unique === true,
    sparse: ix.sparse === true,
    partialFilterExpression: ix.partialFilterExpression || null
  };
}

function sameIndexKeys(a, b) {
  return JSON.stringify(a || {}) === JSON.stringify(b || {});
}

function isAuthoritativeUniqueExact(ix) {
  const spec = AUTHORITATIVE_UNIQUE_INDEX_SPEC;
  return (
    Boolean(ix) &&
    ix.name === spec.options.name &&
    sameIndexKeys(ix.key, spec.keys) &&
    ix.unique === true
  );
}

/** Deterministic CabinNightClaim authoritative index classification (S1.6). */
const AUTHORITATIVE_INDEX_STATES = Object.freeze({
  ABSENT: 'ABSENT',
  EXACT: 'EXACT',
  WRONG_NAMED_AUTHORITY: 'WRONG_NAMED_AUTHORITY',
  EQUIVALENT_KEY_CONFLICT: 'EQUIVALENT_KEY_CONFLICT',
  OTHER_SAFE_INDEXES_ONLY: 'OTHER_SAFE_INDEXES_ONLY'
});

function classifyAuthoritativeIndexState(indexes) {
  const spec = AUTHORITATIVE_UNIQUE_INDEX_SPEC;
  const list = indexes || [];
  const authIx = list.find((ix) => ix && ix.name === spec.options.name) || null;

  if (authIx) {
    if (isAuthoritativeUniqueExact(authIx)) {
      return {
        authoritativeIndexState: AUTHORITATIVE_INDEX_STATES.EXACT,
        authoritativeUniquePresent: true,
        authoritativeUniqueExact: true,
        unexpectedIndexState: false,
        authIndex: authIx
      };
    }
    return {
      authoritativeIndexState: AUTHORITATIVE_INDEX_STATES.WRONG_NAMED_AUTHORITY,
      authoritativeUniquePresent: authIx.unique === true,
      authoritativeUniqueExact: false,
      unexpectedIndexState: true,
      authIndex: authIx
    };
  }

  const equivalentKeyIndexes = list.filter((ix) => ix && sameIndexKeys(ix.key, spec.keys));
  if (equivalentKeyIndexes.length > 0) {
    return {
      authoritativeIndexState: AUTHORITATIVE_INDEX_STATES.EQUIVALENT_KEY_CONFLICT,
      authoritativeUniquePresent: false,
      authoritativeUniqueExact: false,
      unexpectedIndexState: true,
      authIndex: null,
      equivalentIndexes: equivalentKeyIndexes
    };
  }

  return {
    authoritativeIndexState:
      list.length > 0
        ? AUTHORITATIVE_INDEX_STATES.OTHER_SAFE_INDEXES_ONLY
        : AUTHORITATIVE_INDEX_STATES.ABSENT,
    authoritativeUniquePresent: false,
    authoritativeUniqueExact: false,
    unexpectedIndexState: false,
    authIndex: null
  };
}

async function collectionExists(db, collectionName) {
  if (!db) return false;
  const rows = await db.listCollections({ name: collectionName }, { nameOnly: true }).toArray();
  return rows.length > 0;
}

function resolveClaimCollectionName(CabinNightClaimModel) {
  if (CabinNightClaimModel?.collection?.collectionName) {
    return CabinNightClaimModel.collection.collectionName;
  }
  return 'cabinnightclaims';
}

/**
 * READ-ONLY S1.3 preflight classify.
 * @param {object} [opts]
 * @param {import('mongoose').Model} [opts.BookingModel]
 * @param {import('mongoose').Model} [opts.CabinModel]
 * @param {import('mongoose').Model} [opts.CabinNightClaimModel]
 * @param {string[]} [opts.declaredWriters] test override for writer registry
 */
async function runCabinNightClaimS1Preflight(opts = {}) {
  const BookingModel = opts.BookingModel || require('../../models/Booking');
  const CabinModel = opts.CabinModel || require('../../models/Cabin');
  const CabinNightClaimModel =
    opts.CabinNightClaimModel || require('../../models/CabinNightClaim');

  const counts = emptyCounts();
  const samples = {
    canonicalCollisions: [],
    foreignClaimConflicts: [],
    missing: [],
    stale: [],
    orphan: [],
    wrongCabin: [],
    outsideRange: [],
    sameOwnerDuplicates: [],
    foreignOwnerDuplicates: [],
    invalidCabinReferences: [],
    invalidDateRanges: [],
    malformedBookings: [],
    malformedClaims: [],
    claimsForMultiInventoryBooking: [],
    claimsForExcludedBooking: [],
    claimsForNonblockingBooking: []
  };

  let scanCompleteness = 'partial';
  let toolFailure = false;
  let toolFailureMessage = null;
  let collectionExistsFlag = false;
  let existingIndexes = [];
  let claimDocs = [];

  /** @type {Map<string, object>} bookingId -> booking */
  const bookingsById = new Map();
  /** @type {Map<string, {cabinId,night,bookingId,status,locationLinked}[]>} */
  const expectedByCabinNight = new Map();
  /** @type {Set<string>} ownershipKey */
  const expectedOwnership = new Set();
  /** @type {string[]} sorted expected ownership lines for fingerprint */
  const expectedOwnershipLines = [];
  /** @type {Map<string, Set<string>>} cabinId -> nights for valid owners */
  const expectedNightsByBooking = new Map();
  /** @type {Map<string, string>} bookingId -> cabinId for valid owners */
  const expectedCabinByBooking = new Map();
  /** @type {Set<string>} */
  const locationExpectedOwnership = new Set();

  const cabinIdsNeeded = new Set();

  try {
    const cursor = BookingModel.find({})
      .select(BOOKING_SELECT)
      .lean()
      .cursor({ batchSize: Math.max(1, Number(opts.batchSize) || 200) });

    for await (const booking of cursor) {
      counts.bookingsScanned += 1;
      const bookingId = idStr(booking._id);
      bookingsById.set(bookingId, booking);

      const status = String(booking.status || '');
      const blocking = BLOCKING_BOOKING_STATUSES.includes(status);
      if (blocking) counts.blockingBookingsScanned += 1;

      const shape = classifyCommercialInventoryShape(booking);
      const locationLinked = isLocationLinkedBooking(booking);

      if (blocking && booking.isTest === true) counts.isTestBlockingExclusions += 1;
      if (blocking && booking.archivedAt) counts.archivedBlockingExclusions += 1;

      if (blocking && shape === COMMERCIAL_SHAPES.VALID_ALLOCATED_MULTI) {
        counts.validAllocatedMultiBookings += 1;
      } else if (blocking && shape === COMMERCIAL_SHAPES.UNALLOCATED_MULTI) {
        counts.unallocatedMultiBookings += 1;
      } else if (
        blocking &&
        (shape === COMMERCIAL_SHAPES.MIXED ||
          shape === COMMERCIAL_SHAPES.MISSING_PRODUCT ||
          shape === COMMERCIAL_SHAPES.OTHER_MALFORMED)
      ) {
        counts.malformedBookings += 1;
        pushSample(samples.malformedBookings, {
          bookingId,
          shape,
          status,
          cabinId: idStr(booking.cabinId),
          cabinTypeId: idStr(booking.cabinTypeId),
          unitId: idStr(booking.unitId)
        });
      }

      if (!shouldBookingOwnCabinNightClaims(booking)) continue;

      counts.validSingleBlockingBookings += 1;
      if (locationLinked) counts.locationSingleBlockingBookings += 1;

      const cabinId = idStr(booking.cabinId);
      cabinIdsNeeded.add(cabinId);

      const expanded = expandOccupiedSofiaNightDateOnlys(booking.checkIn, booking.checkOut);
      if (!expanded.ok) {
        counts.invalidDateRanges += 1;
        pushSample(samples.invalidDateRanges, {
          bookingId,
          cabinId,
          reason: expanded.reason || 'invalid_range',
          checkInDateOnly: expanded.checkInDateOnly || null,
          checkOutDateOnly: expanded.checkOutDateOnly || null
        });
        continue;
      }

      const nights = expanded.dateOnlys;
      expectedNightsByBooking.set(bookingId, new Set(nights));
      expectedCabinByBooking.set(bookingId, cabinId);

      for (const night of nights) {
        const oKey = ownershipKey(cabinId, night, bookingId);
        expectedOwnership.add(oKey);
        expectedOwnershipLines.push(oKey);
        if (locationLinked) locationExpectedOwnership.add(oKey);

        const cnKey = cabinNightKey(cabinId, night);
        if (!expectedByCabinNight.has(cnKey)) expectedByCabinNight.set(cnKey, []);
        expectedByCabinNight.get(cnKey).push({
          cabinId,
          night,
          bookingId,
          status,
          locationLinked
        });
      }
    }

    scanCompleteness = 'full';
  } catch (err) {
    toolFailure = true;
    toolFailureMessage = err?.message || String(err);
    scanCompleteness = 'failed';
  }

  // Cabin reference validation (bulk)
  /** @type {Set<string>} */
  const existingCabinIds = new Set();
  if (!toolFailure && cabinIdsNeeded.size > 0) {
    try {
      const cabinRows = await CabinModel.find({ _id: { $in: [...cabinIdsNeeded] } })
        .select('_id')
        .lean();
      for (const c of cabinRows) existingCabinIds.add(String(c._id));
    } catch (err) {
      toolFailure = true;
      toolFailureMessage = err?.message || String(err);
      scanCompleteness = 'failed';
    }
  }

  const bookingsWithInvalidCabin = [];
  for (const [bookingId, cabinId] of expectedCabinByBooking.entries()) {
    if (existingCabinIds.has(cabinId)) continue;
    bookingsWithInvalidCabin.push({ bookingId, cabinId });
  }
  for (const { bookingId, cabinId } of bookingsWithInvalidCabin) {
    counts.invalidCabinReferences += 1;
    pushSample(samples.invalidCabinReferences, { bookingId, cabinId });
    const nights = expectedNightsByBooking.get(bookingId) || new Set();
    for (const night of nights) {
      const oKey = ownershipKey(cabinId, night, bookingId);
      expectedOwnership.delete(oKey);
      locationExpectedOwnership.delete(oKey);
      const cnKey = cabinNightKey(cabinId, night);
      const owners = expectedByCabinNight.get(cnKey) || [];
      expectedByCabinNight.set(
        cnKey,
        owners.filter((o) => o.bookingId !== bookingId)
      );
    }
    expectedNightsByBooking.delete(bookingId);
    expectedCabinByBooking.delete(bookingId);
  }

  // Rebuild expected ownership lines after cabin invalidation
  expectedOwnershipLines.length = 0;
  for (const key of expectedOwnership) expectedOwnershipLines.push(key);
  expectedOwnershipLines.sort();
  counts.expected = expectedOwnership.size;

  // Historical Booking-vs-Booking collisions (independent of claim collection)
  const canonicalCollisions = [];
  for (const [cnKey, owners] of expectedByCabinNight.entries()) {
    const distinct = [...new Map(owners.map((o) => [o.bookingId, o])).values()];
    if (distinct.length < 2) continue;
    counts.canonicalCollisions += 1;
    const [cabinId, night] = cnKey.split('|');
    const entry = {
      cabinId,
      night,
      bookingIds: sortIds(distinct.map((o) => o.bookingId)),
      locationChildInvolved: distinct.some((o) => o.locationLinked)
    };
    canonicalCollisions.push(entry);
    pushSample(samples.canonicalCollisions, entry);
  }
  canonicalCollisions.sort((a, b) => {
    const ka = `${a.cabinId}|${a.night}`;
    const kb = `${b.cabinId}|${b.night}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  // Actual claims — listCollections first to avoid creating empty collection via writes
  const db = mongoose.connection?.db || opts.db || null;
  const claimCollectionName = resolveClaimCollectionName(CabinNightClaimModel);
  try {
    if (db) {
      collectionExistsFlag = await collectionExists(db, claimCollectionName);
    } else if (CabinNightClaimModel?.db?.db) {
      collectionExistsFlag = await collectionExists(CabinNightClaimModel.db.db, claimCollectionName);
    } else {
      // Fallback: try countDocuments; NamespaceNotFound => absent
      try {
        const n = await CabinNightClaimModel.countDocuments({});
        collectionExistsFlag = true;
        void n;
      } catch (err) {
        if (err?.codeName === 'NamespaceNotFound' || /ns does not exist/i.test(err?.message || '')) {
          collectionExistsFlag = false;
        } else {
          throw err;
        }
      }
    }

    if (collectionExistsFlag) {
      claimDocs = await CabinNightClaimModel.find({})
        .select('_id cabinId night bookingId source stayChangeId createdAt')
        .lean();
      try {
        existingIndexes = await CabinNightClaimModel.collection.indexes();
      } catch (idxErr) {
        if (
          idxErr?.codeName === 'NamespaceNotFound' ||
          /ns does not exist/i.test(idxErr?.message || '')
        ) {
          existingIndexes = [];
          collectionExistsFlag = false;
          claimDocs = [];
        } else {
          throw idxErr;
        }
      }
    }
  } catch (err) {
    toolFailure = true;
    toolFailureMessage = err?.message || String(err);
    scanCompleteness = scanCompleteness === 'full' ? 'failed' : scanCompleteness;
  }

  counts.actual = claimDocs.length;

  const indexClass = classifyAuthoritativeIndexState(existingIndexes);
  const authoritativeUniquePresent = indexClass.authoritativeUniquePresent;
  const authoritativeUniqueExact = indexClass.authoritativeUniqueExact;
  const unexpectedIndexState = indexClass.unexpectedIndexState;
  const authoritativeIndexState = indexClass.authoritativeIndexState;

  // Index report
  const existingIndexesSummary = (existingIndexes || []).map(summarizeIndex);

  // Provenance
  const provenanceCounts = {};
  const unknownSources = {};
  for (const src of KNOWN_SOURCES) provenanceCounts[src] = 0;

  /** @type {Map<string, object[]>} ownershipKey -> rows */
  const claimsByOwnership = new Map();
  /** @type {Map<string, object[]>} cabinNightKey -> rows */
  const claimsByCabinNight = new Map();
  /** @type {string[]} */
  const actualOwnershipLines = [];

  for (const row of claimDocs) {
    const cabinId = idStr(row.cabinId);
    const bookingId = idStr(row.bookingId);
    const night = dateOnlyFromNight(row.night);
    const source = row.source != null ? String(row.source).trim() : '';

    if (!cabinId || !bookingId || !night) {
      counts.malformedClaims += 1;
      pushSample(samples.malformedClaims, {
        claimId: idStr(row._id),
        cabinId,
        bookingId,
        night,
        reason: 'malformed_claim_identity'
      });
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(provenanceCounts, source)) {
      provenanceCounts[source] += 1;
    } else {
      unknownSources[source || '(empty)'] = (unknownSources[source || '(empty)'] || 0) + 1;
    }

    const oKey = ownershipKey(cabinId, night, bookingId);
    const cnKey = cabinNightKey(cabinId, night);
    actualOwnershipLines.push(oKey);

    if (!claimsByOwnership.has(oKey)) claimsByOwnership.set(oKey, []);
    claimsByOwnership.get(oKey).push(row);
    if (!claimsByCabinNight.has(cnKey)) claimsByCabinNight.set(cnKey, []);
    claimsByCabinNight.get(cnKey).push(row);
  }
  actualOwnershipLines.sort();

  // Same-owner duplicates
  for (const [oKey, rows] of claimsByOwnership.entries()) {
    if (rows.length < 2) continue;
    counts.sameOwnerDuplicates += rows.length - 1;
    const [cabinId, night, bookingId] = oKey.split('|');
    pushSample(samples.sameOwnerDuplicates, {
      cabinId,
      night,
      bookingId,
      claimIds: sortIds(rows.map((r) => r._id)),
      n: rows.length
    });
  }

  // Foreign-owner duplicates (multiple bookingIds on same cabin+night)
  for (const [cnKey, rows] of claimsByCabinNight.entries()) {
    const bookingIds = [...new Set(rows.map((r) => idStr(r.bookingId)))];
    if (bookingIds.length < 2) continue;
    counts.foreignOwnerDuplicates += 1;
    const [cabinId, night] = cnKey.split('|');
    pushSample(samples.foreignOwnerDuplicates, {
      cabinId,
      night,
      bookingIds: sortIds(bookingIds),
      claimIds: sortIds(rows.map((r) => r._id))
    });
  }

  // Missing expected (full list for S1.4 backfill; samples stay bounded)
  /** @type {{ cabinId: string, night: string, bookingId: string }[]} */
  const missingOwnership = [];
  for (const oKey of expectedOwnership) {
    if (claimsByOwnership.has(oKey)) continue;
    counts.missing += 1;
    const [cabinId, night, bookingId] = oKey.split('|');
    const tuple = { cabinId, night, bookingId };
    missingOwnership.push(tuple);
    pushSample(samples.missing, tuple);
  }
  missingOwnership.sort((a, b) => {
    const ka = `${a.cabinId}|${a.night}|${a.bookingId}`;
    const kb = `${b.cabinId}|${b.night}|${b.bookingId}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  // Drift on actual claims
  for (const [oKey, rows] of claimsByOwnership.entries()) {
    const [cabinId, night, bookingId] = oKey.split('|');
    const booking = bookingsById.get(bookingId);

    if (!booking) {
      counts.orphan += rows.length;
      pushSample(samples.orphan, {
        cabinId,
        night,
        bookingId,
        claimIds: sortIds(rows.map((r) => r._id))
      });
      continue;
    }

    const shape = classifyCommercialInventoryShape(booking);
    const blocking = BLOCKING_BOOKING_STATUSES.includes(String(booking.status || ''));
    const excluded = booking.isTest === true || Boolean(booking.archivedAt);

    if (
      shape === COMMERCIAL_SHAPES.VALID_ALLOCATED_MULTI ||
      shape === COMMERCIAL_SHAPES.UNALLOCATED_MULTI
    ) {
      counts.claimsForMultiInventoryBooking += rows.length;
      pushSample(samples.claimsForMultiInventoryBooking, {
        bookingId,
        cabinId,
        night,
        shape,
        claimIds: sortIds(rows.map((r) => r._id))
      });
      continue;
    }

    if (
      shape === COMMERCIAL_SHAPES.MIXED ||
      shape === COMMERCIAL_SHAPES.OTHER_MALFORMED ||
      shape === COMMERCIAL_SHAPES.MISSING_PRODUCT
    ) {
      counts.claimsForMalformedBooking += rows.length;
      pushSample(samples.malformedClaims, {
        bookingId,
        cabinId,
        night,
        shape,
        claimIds: sortIds(rows.map((r) => r._id)),
        reason: 'claim_for_malformed_booking'
      });
      continue;
    }

    if (excluded) {
      counts.claimsForExcludedBooking += rows.length;
      pushSample(samples.claimsForExcludedBooking, {
        bookingId,
        cabinId,
        night,
        isTest: booking.isTest === true,
        archived: Boolean(booking.archivedAt),
        claimIds: sortIds(rows.map((r) => r._id))
      });
      continue;
    }

    if (!blocking) {
      counts.claimsForNonblockingBooking += rows.length;
      counts.stale += rows.length;
      pushSample(samples.claimsForNonblockingBooking, {
        bookingId,
        status: booking.status,
        cabinId,
        night,
        claimIds: sortIds(rows.map((r) => r._id))
      });
      pushSample(samples.stale, {
        bookingId,
        cabinId,
        night,
        reason: 'nonblocking',
        status: booking.status
      });
      continue;
    }

    // Valid single blocking owner — check cabin/range
    const expectedCabin = idStr(booking.cabinId);
    if (expectedCabin && cabinId !== expectedCabin) {
      counts.wrongCabin += rows.length;
      pushSample(samples.wrongCabin, {
        bookingId,
        claimCabinId: cabinId,
        bookingCabinId: expectedCabin,
        night,
        claimIds: sortIds(rows.map((r) => r._id))
      });
      continue;
    }

    const nightSet =
      expectedNightsByBooking.get(bookingId) ||
      (() => {
        const expanded = expandOccupiedSofiaNightDateOnlys(booking.checkIn, booking.checkOut);
        return expanded.ok ? new Set(expanded.dateOnlys) : new Set();
      })();

    if (!nightSet.has(night)) {
      counts.outsideRange += rows.length;
      pushSample(samples.outsideRange, {
        bookingId,
        cabinId,
        night,
        claimIds: sortIds(rows.map((r) => r._id))
      });
      continue;
    }

    // Foreign claim conflict: expected owner A for cabin/night but claim owns B
    const expectedOwners = expectedByCabinNight.get(cabinNightKey(cabinId, night)) || [];
    const expectedIds = new Set(expectedOwners.map((o) => o.bookingId));
    if (expectedIds.size > 0 && !expectedIds.has(bookingId)) {
      counts.foreignClaimConflicts += 1;
      pushSample(samples.foreignClaimConflicts, {
        cabinId,
        night,
        claimBookingId: bookingId,
        expectedBookingIds: sortIds([...expectedIds]),
        claimIds: sortIds(rows.map((r) => r._id))
      });
    }
  }

  // Also: expected owner exists but claim for that cabin/night belongs only to foreign
  for (const [cnKey, owners] of expectedByCabinNight.entries()) {
    if (owners.length === 0) continue;
    const claimRows = claimsByCabinNight.get(cnKey) || [];
    if (!claimRows.length) continue;
    const expectedIds = new Set(owners.map((o) => o.bookingId));
    const claimOwnerIds = new Set(claimRows.map((r) => idStr(r.bookingId)));
    const onlyForeign = [...claimOwnerIds].every((id) => !expectedIds.has(id));
    if (onlyForeign) {
      // Count once per cabin-night if not already sampled via loop above
      const already =
        samples.foreignClaimConflicts.some(
          (s) => s.cabinId === owners[0].cabinId && s.night === owners[0].night
        ) || false;
      if (!already) {
        counts.foreignClaimConflicts += 1;
        pushSample(samples.foreignClaimConflicts, {
          cabinId: owners[0].cabinId,
          night: owners[0].night,
          claimBookingIds: sortIds([...claimOwnerIds]),
          expectedBookingIds: sortIds([...expectedIds]),
          claimIds: sortIds(claimRows.map((r) => r._id))
        });
      }
    }
  }

  // Location child expected/actual/missing
  let locationExpected = locationExpectedOwnership.size;
  let locationActualMatching = 0;
  let locationMissing = 0;
  for (const oKey of locationExpectedOwnership) {
    if (claimsByOwnership.has(oKey)) locationActualMatching += 1;
    else locationMissing += 1;
  }
  const locationCollisions = canonicalCollisions.filter((c) => c.locationChildInvolved).length;

  // Writer readiness (code capability only)
  const expectedWriters = [...CABIN_NIGHT_CLAIM_S1_WRITERS].sort();
  const declaredWriters = (opts.declaredWriters
    ? [...opts.declaredWriters]
    : listCabinNightClaimS1Writers()
  ).sort();
  const missingWriters = expectedWriters.filter((w) => !declaredWriters.includes(w));
  const unexpectedWriters = declaredWriters.filter((w) => !expectedWriters.includes(w));
  const codeWriterReadiness =
    missingWriters.length === 0 && unexpectedWriters.length === 0;

  // Blocker tallies
  const backfillBlockers =
    (toolFailure ? 1 : 0) +
    (scanCompleteness !== 'full' ? 1 : 0) +
    counts.canonicalCollisions +
    counts.malformedBookings +
    counts.invalidCabinReferences +
    counts.invalidDateRanges +
    (codeWriterReadiness ? 0 : 1) +
    (unexpectedIndexState ? 1 : 0);

  const uniqueOnlyBlockers =
    counts.missing +
    counts.stale +
    counts.orphan +
    counts.wrongCabin +
    counts.outsideRange +
    counts.sameOwnerDuplicates +
    counts.foreignOwnerDuplicates +
    counts.foreignClaimConflicts +
    counts.claimsForNonblockingBooking +
    counts.claimsForMultiInventoryBooking +
    counts.claimsForExcludedBooking +
    counts.claimsForMalformedBooking +
    counts.malformedClaims;

  counts.remainingBackfillBlockers = backfillBlockers;
  counts.remainingUniqueBlockers = backfillBlockers + uniqueOnlyBlockers;
  counts.remainingBlockers = counts.remainingUniqueBlockers;

  const baseInventorySafe =
    !toolFailure &&
    scanCompleteness === 'full' &&
    counts.canonicalCollisions === 0 &&
    counts.malformedBookings === 0 &&
    counts.invalidCabinReferences === 0 &&
    counts.invalidDateRanges === 0 &&
    codeWriterReadiness &&
    !unexpectedIndexState;

  // After EXACT unique authority exists, backfill is not the next cutover step (S1.6+).
  const readyForBackfill = baseInventorySafe && !authoritativeUniqueExact;

  // Parity/stability remains meaningful after exact authority (idempotent re-entry / post-create).
  const readyForStableVerification =
    baseInventorySafe &&
    counts.missing === 0 &&
    counts.stale === 0 &&
    counts.orphan === 0 &&
    counts.wrongCabin === 0 &&
    counts.outsideRange === 0 &&
    counts.sameOwnerDuplicates === 0 &&
    counts.foreignOwnerDuplicates === 0 &&
    counts.foreignClaimConflicts === 0 &&
    counts.claimsForNonblockingBooking === 0 &&
    counts.claimsForMultiInventoryBooking === 0 &&
    counts.claimsForExcludedBooking === 0 &&
    counts.claimsForMalformedBooking === 0 &&
    counts.malformedClaims === 0;

  // Unique index readiness is provisional: requires stable verification + no auth surprise.
  // Live process readiness / prior fingerprint are later gates (S1.5/S1.6).
  // After EXACT authority exists, provisional unique-creation readiness is N/A (already created).
  const readyForUniqueIndexProvisional =
    readyForStableVerification &&
    !authoritativeUniqueExact &&
    !authoritativeUniquePresent;
  const readyForUniqueIndex = false; // writer authority remains S1.7; never claim from preflight alone

  const inventoryFingerprintPayload = {
    cutoverBatch: CUTOVER_BATCH,
    scanCompleteness,
    expected: counts.expected,
    actual: counts.actual,
    expectedOwnership: expectedOwnershipLines,
    canonicalCollisions: canonicalCollisions.map(
      (c) => `${c.cabinId}|${c.night}|${c.bookingIds.join(',')}`
    ),
    actualOwnership: actualOwnershipLines,
    driftCounts: {
      missing: counts.missing,
      stale: counts.stale,
      orphan: counts.orphan,
      wrongCabin: counts.wrongCabin,
      outsideRange: counts.outsideRange,
      sameOwnerDuplicates: counts.sameOwnerDuplicates,
      foreignOwnerDuplicates: counts.foreignOwnerDuplicates,
      foreignClaimConflicts: counts.foreignClaimConflicts,
      claimsForNonblockingBooking: counts.claimsForNonblockingBooking,
      claimsForMultiInventoryBooking: counts.claimsForMultiInventoryBooking,
      claimsForExcludedBooking: counts.claimsForExcludedBooking,
      claimsForMalformedBooking: counts.claimsForMalformedBooking,
      malformedBookings: counts.malformedBookings,
      malformedClaims: counts.malformedClaims,
      invalidCabinReferences: counts.invalidCabinReferences,
      invalidDateRanges: counts.invalidDateRanges,
      canonicalCollisions: counts.canonicalCollisions
    },
    blockerIds: {
      malformedBookings: samples.malformedBookings.map((s) => s.bookingId).sort(),
      invalidCabinReferences: samples.invalidCabinReferences
        .map((s) => `${s.bookingId}:${s.cabinId}`)
        .sort(),
      invalidDateRanges: samples.invalidDateRanges.map((s) => s.bookingId).sort()
    }
  };
  const fingerprint = stableHash(inventoryFingerprintPayload);

  let priorFingerprint = opts.priorFingerprint ? String(opts.priorFingerprint) : null;
  let stableVerification = null;
  if (priorFingerprint) {
    stableVerification = {
      priorFingerprint,
      currentFingerprint: fingerprint,
      satisfied: priorFingerprint === fingerprint
    };
  }

  const remainingBlockers = {
    backfill: {
      toolFailure: toolFailure ? 1 : 0,
      scanIncomplete: scanCompleteness !== 'full' ? 1 : 0,
      canonicalCollisions: counts.canonicalCollisions,
      malformedBookings: counts.malformedBookings,
      invalidCabinReferences: counts.invalidCabinReferences,
      invalidDateRanges: counts.invalidDateRanges,
      writerCapabilityGap: codeWriterReadiness ? 0 : 1,
      unexpectedIndexState: unexpectedIndexState ? 1 : 0,
      total: backfillBlockers
    },
    unique: {
      ...{
        toolFailure: toolFailure ? 1 : 0,
        scanIncomplete: scanCompleteness !== 'full' ? 1 : 0,
        canonicalCollisions: counts.canonicalCollisions,
        malformedBookings: counts.malformedBookings,
        invalidCabinReferences: counts.invalidCabinReferences,
        invalidDateRanges: counts.invalidDateRanges,
        writerCapabilityGap: codeWriterReadiness ? 0 : 1,
        unexpectedIndexState: unexpectedIndexState ? 1 : 0
      },
      missing: counts.missing,
      stale: counts.stale,
      orphan: counts.orphan,
      wrongCabin: counts.wrongCabin,
      outsideRange: counts.outsideRange,
      sameOwnerDuplicates: counts.sameOwnerDuplicates,
      foreignOwnerDuplicates: counts.foreignOwnerDuplicates,
      foreignClaimConflicts: counts.foreignClaimConflicts,
      claimsForNonblockingBooking: counts.claimsForNonblockingBooking,
      claimsForMultiInventoryBooking: counts.claimsForMultiInventoryBooking,
      claimsForExcludedBooking: counts.claimsForExcludedBooking,
      claimsForMalformedBooking: counts.claimsForMalformedBooking,
      malformedClaims: counts.malformedClaims,
      priorFingerprintGate: 'deferred_to_s1_5',
      liveWriterProcessGate: 'deployment_verification_only',
      total: counts.remainingUniqueBlockers
    }
  };

  return {
    mode: 'verify',
    cutoverBatch: CUTOVER_BATCH,
    scanCompleteness,
    collectionExists: collectionExistsFlag,
    collectionName: claimCollectionName,
    documentCount: counts.actual,
    existingIndexes: existingIndexesSummary,
    authoritativeIndexState,
    authoritativeUniquePresent,
    authoritativeUniqueExact,
    unexpectedIndexState,
    counts,
    remainingBlockers,
    provenanceCounts: {
      ...provenanceCounts,
      unknown: unknownSources
    },
    locationChildren: {
      blockingValidSingle: counts.locationSingleBlockingBookings,
      expectedClaims: locationExpected,
      actualMatchingClaims: locationActualMatching,
      missingClaims: locationMissing,
      collisionsInvolving: locationCollisions
    },
    writerReadiness: {
      expected: expectedWriters,
      declared: declaredWriters,
      missing: missingWriters,
      unexpected: unexpectedWriters,
      codeReady: codeWriterReadiness
    },
    fingerprint,
    priorFingerprint,
    stableVerification,
    readyForBackfill,
    readyForStableVerification,
    readyForUniqueIndexProvisional,
    readyForUniqueIndex,
    refused: false,
    refuseReason: null,
    refuseCode: null,
    toolFailure,
    toolFailureMessage,
    samples,
    /** Full sorted missing expected ownership tuples (S1.4 backfill input). */
    missingOwnership
  };
}

module.exports = {
  runCabinNightClaimS1Preflight,
  CUTOVER_BATCH,
  SAMPLE_LIMIT,
  KNOWN_SOURCES,
  AUTHORITATIVE_INDEX_STATES,
  classifyAuthoritativeIndexState,
  stableHash,
  cabinNightKey,
  ownershipKey,
  isAuthoritativeUniqueExact,
  summarizeIndex,
  sameIndexKeys
};
