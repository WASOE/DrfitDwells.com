'use strict';

/**
 * B8F1A shared checkout night-lease claim engine.
 * Parameterized over UnitNightClaim vs CabinNightClaim adapters.
 * Exclusivity remains the unique {resourceId, night} index on the claim model.
 */

const mongoose = require('mongoose');
const AccommodationCheckoutLease = require('../../models/AccommodationCheckoutLease');
const { normalizeDateToSofiaDayStart, formatSofiaDateOnly } = require('../../utils/dateTime');

function createEngineError(code, message, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.details = details;
  return err;
}

function isDuplicateKeyError(err) {
  if (!err) return false;
  if (err.code === 11000 || err.code === 11001) return true;
  return /E11000|duplicate key/i.test(String(err.message || ''));
}

function sessionOpts(session) {
  return session ? { session } : {};
}

function nightDateFromDateOnly(dateOnly) {
  return normalizeDateToSofiaDayStart(`${dateOnly}T12:00:00.000Z`);
}

function dateOnlyFromNightDate(nightDate) {
  return formatSofiaDateOnly(nightDate);
}

function isValidExpiresAt(value) {
  if (value == null) return false;
  const d = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(d.getTime());
}

function isBookingOwnedClaim(row) {
  return !row || row.ownerType !== 'checkout';
}

function isLiveCheckoutClaim(row, now) {
  if (!row || row.ownerType !== 'checkout') return false;
  if (!isValidExpiresAt(row.expiresAt)) return false;
  return new Date(row.expiresAt).getTime() > now.getTime();
}

function isExpiredCheckoutClaim(row, now) {
  if (!row || row.ownerType !== 'checkout') return false;
  if (!isValidExpiresAt(row.expiresAt)) return false;
  return new Date(row.expiresAt).getTime() <= now.getTime();
}

function hasInvalidCheckoutExpiry(row) {
  return row && row.ownerType === 'checkout' && !isValidExpiresAt(row.expiresAt);
}

/**
 * @param {object} adapter
 * @param {import('mongoose').Model} adapter.ClaimModel
 * @param {'unitId'|'cabinId'} adapter.resourceField
 * @param {() => Promise<unknown>} adapter.assertAuthoritativeIndex
 * @param {string} adapter.errorPrefix e.g. UNIT_CHECKOUT_CLAIM / CABIN_CHECKOUT_CLAIM
 * @param {function} adapter.resolveOccupiedNightDates
 */
function createCheckoutNightLeaseClaimEngine(adapter) {
  const {
    ClaimModel,
    resourceField,
    assertAuthoritativeIndex,
    errorPrefix,
    resolveOccupiedNightDates
  } = adapter;

  // Authority source is fixed at construction. Per-call model injection is forbidden.
  // Ignore any adapter.LeaseModel / AccommodationCheckoutLease binding attempts.
  const LeaseModel = AccommodationCheckoutLease;
  const expectedEntityType = resourceField === 'unitId' ? 'unit' : 'cabin';

  const ERR = Object.freeze({
    VALIDATION: `${errorPrefix}_VALIDATION`,
    FOREIGN_OWNER: `${errorPrefix}_FOREIGN_OWNER`,
    COMPENSATION_FAILED: `${errorPrefix}_COMPENSATION_FAILED`,
    EXPIRY_UNAUTHORIZED: `${errorPrefix}_EXPIRY_UNAUTHORIZED`,
    RELEASE_UNAUTHORIZED: `${errorPrefix}_RELEASE_UNAUTHORIZED`,
    INTEGRITY: 'CHECKOUT_NIGHT_CLAIM_INTEGRITY'
  });

  const FORBIDDEN_AUTHORITY_KEYS = Object.freeze([
    'AccommodationCheckoutLease',
    'LeaseModel',
    'HeaderModel',
    'leaseRepository',
    'header',
    'leaseHeader',
    'headerExpiryAuthorized'
  ]);

  function rejectCallerAuthorityInjection(opts, unauthorizedCode) {
    if (!opts || typeof opts !== 'object') return;
    for (const key of FORBIDDEN_AUTHORITY_KEYS) {
      if (Object.prototype.hasOwnProperty.call(opts, key) && opts[key] != null) {
        throw createEngineError(
          unauthorizedCode,
          `Caller-supplied ${key} cannot authorize checkout claim deletion`,
          { field: key }
        );
      }
    }
  }

  function toObjectId(value, fieldName) {
    if (value == null || value === '') {
      throw createEngineError(ERR.VALIDATION, `${fieldName} is required`, { field: fieldName });
    }
    const s = String(value);
    if (!mongoose.Types.ObjectId.isValid(s)) {
      throw createEngineError(ERR.VALIDATION, `${fieldName} is invalid`, { field: fieldName, value: s });
    }
    return new mongoose.Types.ObjectId(s);
  }

  function mapClaimDto(row) {
    return {
      id: String(row._id),
      [resourceField]: String(row[resourceField]),
      night: dateOnlyFromNightDate(row.night),
      ownerType: row.ownerType || 'booking',
      checkoutId: row.checkoutId != null ? String(row.checkoutId) : null,
      leaseId: row.leaseId != null ? String(row.leaseId) : null,
      acquisitionId: row.acquisitionId != null ? String(row.acquisitionId) : null,
      bookingId: row.bookingId != null ? String(row.bookingId) : null,
      expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
      source: row.source
    };
  }

  function integrityInvalidExpiry(row, resourceOid) {
    return createEngineError(
      ERR.INTEGRITY,
      'Checkout night claim has missing or invalid expiresAt',
      {
        claimId: row && row._id != null ? String(row._id) : null,
        [resourceField]: String(resourceOid),
        night: row && row.night != null ? dateOnlyFromNightDate(row.night) : null,
        checkoutId: row && row.checkoutId != null ? String(row.checkoutId) : null,
        leaseId: row && row.leaseId != null ? String(row.leaseId) : null,
        ownerType: 'checkout'
      }
    );
  }

  /**
   * Header fence required before insert / takeover / expiry-extending reuse.
   */
  async function assertAcquisitionFence({ leaseId, acquisitionId, now, session = null }) {
    const lease = String(leaseId || '').trim();
    const acquisition = String(acquisitionId || '').trim();
    if (!lease || !acquisition) {
      throw createEngineError(ERR.VALIDATION, 'leaseId and acquisitionId are required for fence check');
    }
    const header = await LeaseModel.findOne({
      leaseId: lease,
      isLive: true,
      status: 'open',
      activeAcquisitionId: acquisition,
      expiresAt: { $gt: now }
    })
      .session(session || null)
      .lean();
    if (!header) {
      throw createEngineError(
        ERR.INTEGRITY,
        'Lease acquisition fence is no longer valid',
        { leaseId: lease, acquisitionId: acquisition }
      );
    }
    return header;
  }

  async function classifyNight({
    resourceOid,
    nightDate,
    checkoutId,
    leaseId,
    now,
    session = null
  }) {
    const row = await ClaimModel.findOne({ [resourceField]: resourceOid, night: nightDate })
      .session(session || null)
      .lean();
    if (!row) return { kind: 'absent' };
    if (hasInvalidCheckoutExpiry(row)) {
      throw integrityInvalidExpiry(row, resourceOid);
    }
    if (isBookingOwnedClaim(row)) {
      return {
        kind: 'booking',
        claim: row,
        conflict: {
          night: dateOnlyFromNightDate(row.night),
          claimId: String(row._id),
          holderBookingId: row.bookingId != null ? String(row.bookingId) : null,
          ownerType: row.ownerType || 'booking'
        }
      };
    }
    if (isLiveCheckoutClaim(row, now)) {
      if (String(row.checkoutId) === String(checkoutId) && String(row.leaseId) === String(leaseId)) {
        return { kind: 'same_lease', claim: row };
      }
      return {
        kind: 'foreign_checkout',
        claim: row,
        conflict: {
          night: dateOnlyFromNightDate(row.night),
          claimId: String(row._id),
          holderCheckoutId: String(row.checkoutId),
          holderLeaseId: String(row.leaseId)
        }
      };
    }
    if (isExpiredCheckoutClaim(row, now)) {
      return { kind: 'expired_checkout', claim: row };
    }
    return {
      kind: 'foreign_checkout',
      claim: row,
      conflict: {
        night: dateOnlyFromNightDate(row.night),
        claimId: String(row._id),
        holderCheckoutId: row.checkoutId != null ? String(row.checkoutId) : null,
        holderLeaseId: row.leaseId != null ? String(row.leaseId) : null
      }
    };
  }

  async function takeoverExpired({
    resourceOid,
    nightDate,
    checkoutId,
    leaseId,
    acquisitionId,
    expiresAt,
    now,
    session = null
  }) {
    await assertAcquisitionFence({ leaseId, acquisitionId, now, session });
    if (!isValidExpiresAt(expiresAt)) {
      throw createEngineError(ERR.VALIDATION, 'expiresAt must be a valid Date for takeover');
    }
    const nextCheckout = String(checkoutId);
    const nextLease = String(leaseId);
    const nextAcq = String(acquisitionId);
    // Explicit cross-field contract (Mongoose runValidators on partial $set
    // cannot see ownerType and wrongly requires bookingId).
    if (!nextCheckout || !nextLease || !nextAcq) {
      throw createEngineError(ERR.VALIDATION, 'checkoutId, leaseId and acquisitionId required for takeover');
    }
    return ClaimModel.findOneAndUpdate(
      {
        [resourceField]: resourceOid,
        night: nightDate,
        ownerType: 'checkout',
        expiresAt: { $lte: now }
      },
      {
        $set: {
          checkoutId: nextCheckout,
          leaseId: nextLease,
          acquisitionId: nextAcq,
          expiresAt,
          source: 'checkout_lease',
          bookingId: null,
          ownerType: 'checkout'
        }
      },
      { new: true, ...sessionOpts(session) }
    );
  }

  async function compensateAcquisition({
    leaseId,
    acquisitionId,
    claimIds = null,
    resourceId = null,
    nights = null,
    session = null
  }) {
    const lease = String(leaseId || '').trim();
    const acquisition = String(acquisitionId || '').trim();
    if (!lease || !acquisition) {
      throw createEngineError(ERR.VALIDATION, 'leaseId and acquisitionId are required for compensation');
    }
    const filter = {
      ownerType: 'checkout',
      leaseId: lease,
      acquisitionId: acquisition
    };
    if (Array.isArray(claimIds) && claimIds.length > 0) {
      filter._id = { $in: claimIds.map((id) => toObjectId(id, 'claimId')) };
    } else if (resourceId != null && Array.isArray(nights) && nights.length > 0) {
      filter[resourceField] = toObjectId(resourceId, resourceField);
      filter.night = {
        $in: nights.map((n) =>
          n instanceof Date ? normalizeDateToSofiaDayStart(n) : nightDateFromDateOnly(String(n))
        )
      };
    }

    try {
      const result = await ClaimModel.deleteMany(filter, sessionOpts(session));
      const remaining = await ClaimModel.countDocuments({
        ownerType: 'checkout',
        leaseId: lease,
        acquisitionId: acquisition
      }).session(session || null);
      if (remaining > 0) {
        throw createEngineError(
          ERR.COMPENSATION_FAILED,
          'Compensation left acquisition-tagged checkout claims',
          { leaseId: lease, acquisitionId: acquisition, remaining }
        );
      }
      return { ok: true, deletedCount: result.deletedCount || 0, remaining: 0 };
    } catch (err) {
      if (err && err.code === ERR.COMPENSATION_FAILED) throw err;
      throw createEngineError(
        ERR.COMPENSATION_FAILED,
        'Failed to compensate checkout night-claim acquisition',
        {
          leaseId: lease,
          acquisitionId: acquisition,
          cause: err?.message || String(err)
        }
      );
    }
  }

  async function clearAcquisitionMarkers({
    leaseId,
    acquisitionId,
    claimIds = [],
    session = null
  }) {
    const lease = String(leaseId || '').trim();
    const acquisition = String(acquisitionId || '').trim();
    if (!lease || !acquisition) {
      throw createEngineError(ERR.VALIDATION, 'leaseId and acquisitionId required');
    }
    if (!Array.isArray(claimIds) || claimIds.length === 0) {
      return { ok: true, modifiedCount: 0 };
    }
    const result = await ClaimModel.updateMany(
      {
        _id: { $in: claimIds.map((id) => toObjectId(id, 'claimId')) },
        ownerType: 'checkout',
        leaseId: lease,
        acquisitionId: acquisition
      },
      { $set: { acquisitionId: null } },
      sessionOpts(session)
    );
    return { ok: true, modifiedCount: result.modifiedCount || result.nModified || 0 };
  }

  /**
   * Clear leftover markers on a verified sealed lease (renew / repair path).
   */
  async function clearLeftoverMarkersForSealedLease({
    checkoutId,
    leaseId,
    session = null
  }) {
    const checkout = String(checkoutId || '').trim();
    const lease = String(leaseId || '').trim();
    const header = await LeaseModel.findOne({
      checkoutId: checkout,
      leaseId: lease,
      status: 'sealed',
      isLive: true
    })
      .session(session || null)
      .lean();
    if (!header) {
      return { ok: false, modifiedCount: 0 };
    }
    const result = await ClaimModel.updateMany(
      {
        ownerType: 'checkout',
        checkoutId: checkout,
        leaseId: lease,
        acquisitionId: { $ne: null }
      },
      { $set: { acquisitionId: null } },
      sessionOpts(session)
    );
    return { ok: true, modifiedCount: result.modifiedCount || result.nModified || 0 };
  }

  async function verifyLeaseNights({
    resourceId,
    checkoutId,
    leaseId,
    checkIn = null,
    checkOut = null,
    nights = null,
    now = null,
    session = null,
    skipIndexAssert = false
  }) {
    if (!skipIndexAssert) {
      await assertAuthoritativeIndex();
    }
    const resourceOid = toObjectId(resourceId, resourceField);
    const checkout = String(checkoutId || '').trim();
    const lease = String(leaseId || '').trim();
    const clock = now instanceof Date ? now : new Date(now || Date.now());
    const nightDates = resolveOccupiedNightDates({ checkIn, checkOut, nights });
    const rows = await ClaimModel.find({
      [resourceField]: resourceOid,
      night: { $in: nightDates },
      ownerType: 'checkout',
      checkoutId: checkout,
      leaseId: lease
    })
      .session(session || null)
      .lean();

    const byNight = new Map(rows.map((r) => [dateOnlyFromNightDate(r.night), r]));
    const missing = [];
    const expired = [];
    const invalidExpiry = [];
    for (const nd of nightDates) {
      const key = dateOnlyFromNightDate(nd);
      const row = byNight.get(key);
      if (!row) {
        missing.push(key);
        continue;
      }
      if (hasInvalidCheckoutExpiry(row)) {
        invalidExpiry.push(key);
        continue;
      }
      if (!isLiveCheckoutClaim(row, clock)) {
        expired.push(key);
      }
    }
    if (invalidExpiry.length > 0) {
      throw createEngineError(
        ERR.INTEGRITY,
        'Checkout lease nights include invalid expiresAt',
        {
          [resourceField]: String(resourceOid),
          checkoutId: checkout,
          leaseId: lease,
          invalidExpiry
        }
      );
    }
    return {
      ok: missing.length === 0 && expired.length === 0 && rows.length === nightDates.length,
      expectedNightCount: nightDates.length,
      foundNightCount: rows.length,
      missing,
      expired,
      claims: rows.map(mapClaimDto)
    };
  }

  /**
   * Independently prove durable released header, then delete exact checkout claims.
   * Uses only the module-bound AccommodationCheckoutLease model.
   */
  async function deleteCheckoutClaimsAfterReleasedHeaderProof({
    checkoutId = null,
    leaseId = null,
    generation = null,
    resourceId = null,
    session = null,
    unauthorizedCode = ERR.EXPIRY_UNAUTHORIZED,
    operationLabel = 'expireCheckoutClaims'
  } = {}) {
    const checkout = String(checkoutId || '').trim();
    const lease = String(leaseId || '').trim();
    const gen = Number(generation);
    if (!checkout || !lease) {
      throw createEngineError(
        ERR.VALIDATION,
        `${operationLabel} requires exact checkoutId and leaseId`
      );
    }
    if (!Number.isInteger(gen) || gen < 1) {
      throw createEngineError(
        ERR.VALIDATION,
        `${operationLabel} requires exact positive generation`
      );
    }
    if (resourceId == null || resourceId === '') {
      throw createEngineError(
        ERR.VALIDATION,
        `${operationLabel} requires exact ${resourceField}`
      );
    }
    const resourceOid = toObjectId(resourceId, resourceField);
    const header = await LeaseModel.findOne({
      checkoutId: checkout,
      leaseId: lease
    })
      .session(session || null)
      .lean();

    if (!header) {
      throw createEngineError(
        unauthorizedCode,
        `${operationLabel} requires a durable lease header`,
        { checkoutId: checkout, leaseId: lease, generation: gen }
      );
    }
    if (header.status !== 'released' || header.isLive !== false) {
      throw createEngineError(
        unauthorizedCode,
        `${operationLabel} requires durable header status released and isLive false`,
        {
          checkoutId: checkout,
          leaseId: lease,
          generation: gen,
          status: header.status,
          isLive: header.isLive
        }
      );
    }
    if (Number(header.generation) !== gen) {
      throw createEngineError(
        unauthorizedCode,
        `${operationLabel} generation does not match durable released header`,
        {
          checkoutId: checkout,
          leaseId: lease,
          requestedGeneration: gen,
          headerGeneration: header.generation
        }
      );
    }
    if (String(header.entityType || '') !== expectedEntityType) {
      throw createEngineError(
        unauthorizedCode,
        `${operationLabel} entityType does not match durable released header`,
        {
          checkoutId: checkout,
          leaseId: lease,
          expectedEntityType,
          headerEntityType: header.entityType
        }
      );
    }
    if (header[resourceField] == null || String(header[resourceField]) !== String(resourceOid)) {
      throw createEngineError(
        unauthorizedCode,
        `${operationLabel} ${resourceField} does not match durable released header`,
        {
          checkoutId: checkout,
          leaseId: lease,
          requestedResourceId: String(resourceOid),
          headerResourceId:
            header[resourceField] != null ? String(header[resourceField]) : null
        }
      );
    }

    const filter = {
      ownerType: 'checkout',
      checkoutId: checkout,
      leaseId: lease,
      [resourceField]: resourceOid
    };
    const result = await ClaimModel.deleteMany(filter, sessionOpts(session));
    const remainingExact = await ClaimModel.countDocuments(filter).session(session || null);
    if (remainingExact > 0) {
      throw createEngineError(
        ERR.INTEGRITY,
        'Checkout claims remain after released-header claim cleanup',
        {
          checkoutId: checkout,
          leaseId: lease,
          [resourceField]: String(resourceOid),
          remaining: remainingExact
        }
      );
    }
    const remainingLease = await ClaimModel.countDocuments({
      ownerType: 'checkout',
      checkoutId: checkout,
      leaseId: lease
    }).session(session || null);
    if (remainingLease > 0) {
      throw createEngineError(
        ERR.INTEGRITY,
        'Unexpected checkout claims remain for released lease after claim cleanup',
        {
          checkoutId: checkout,
          leaseId: lease,
          remaining: remainingLease
        }
      );
    }
    return {
      ok: true,
      deletedCount: result.deletedCount || 0,
      remaining: 0
    };
  }

  /**
   * Intentional release cleanup: delete checkout claims only after proving the
   * durable lease header is already released for the exact identity.
   */
  async function releaseLeaseClaims(opts = {}) {
    rejectCallerAuthorityInjection(opts, ERR.RELEASE_UNAUTHORIZED);
    return deleteCheckoutClaimsAfterReleasedHeaderProof({
      checkoutId: opts.checkoutId,
      leaseId: opts.leaseId,
      generation: opts.generation,
      resourceId: opts.resourceId,
      session: opts.session || null,
      unauthorizedCode: ERR.RELEASE_UNAUTHORIZED,
      operationLabel: 'releaseLeaseClaims'
    });
  }

  /**
   * Expiry cleanup: delete checkout claims only after proving the durable lease
   * header is released for the exact identity. Caller-controlled models,
   * booleans, and header snapshots never authorize deletion.
   */
  async function expireCheckoutClaims(opts = {}) {
    rejectCallerAuthorityInjection(opts, ERR.EXPIRY_UNAUTHORIZED);
    void opts.now;
    return deleteCheckoutClaimsAfterReleasedHeaderProof({
      checkoutId: opts.checkoutId,
      leaseId: opts.leaseId,
      generation: opts.generation,
      resourceId: opts.resourceId,
      session: opts.session || null,
      unauthorizedCode: ERR.EXPIRY_UNAUTHORIZED,
      operationLabel: 'expireCheckoutClaims'
    });
  }

  async function countAcquisitionClaims({ leaseId, acquisitionId, session = null }) {
    return ClaimModel.countDocuments({
      ownerType: 'checkout',
      leaseId: String(leaseId),
      acquisitionId: String(acquisitionId)
    }).session(session || null);
  }

  /**
   * Acquire every occupied night under a checkout lease acquisition.
   * Owns compensation for its own per-night loop on failure.
   */
  async function acquireCheckoutNights({
    resourceId,
    checkoutId,
    leaseId,
    acquisitionId,
    checkIn = null,
    checkOut = null,
    nights = null,
    expiresAt,
    now = null,
    session = null,
    skipIndexAssert = false
  } = {}) {
    if (!skipIndexAssert) {
      await assertAuthoritativeIndex();
    }
    const resourceOid = toObjectId(resourceId, resourceField);
    const checkout = String(checkoutId || '').trim();
    const lease = String(leaseId || '').trim();
    const acquisition = String(acquisitionId || '').trim();
    if (!checkout || !lease || !acquisition) {
      throw createEngineError(ERR.VALIDATION, 'checkoutId, leaseId and acquisitionId are required');
    }
    if (!isValidExpiresAt(expiresAt)) {
      throw createEngineError(ERR.VALIDATION, 'expiresAt must be a valid Date');
    }
    const clock = now instanceof Date ? now : new Date(now || Date.now());
    const nightDates = resolveOccupiedNightDates({ checkIn, checkOut, nights });
    if (nightDates.length === 0) {
      throw createEngineError(ERR.VALIDATION, 'No occupied nights to claim');
    }
    nightDates.sort((a, b) => a.getTime() - b.getTime());

    const newlyAcquired = [];
    const reused = [];

    const failAndCompensate = async (err) => {
      try {
        await compensateAcquisition({
          leaseId: lease,
          acquisitionId: acquisition,
          claimIds: newlyAcquired.map((c) => c.id),
          resourceId,
          nights: newlyAcquired.map((c) => c.night),
          session
        });
      } catch (compErr) {
        const wrapped = createEngineError(
          ERR.COMPENSATION_FAILED,
          'Failed to compensate partial checkout night acquisition',
          {
            leaseId: lease,
            acquisitionId: acquisition,
            cause: compErr?.message || String(compErr),
            originalCode: err?.code || null
          }
        );
        wrapped.cause = err;
        throw wrapped;
      }
      throw err;
    };

    try {
      for (const nightDate of nightDates) {
        let classified = await classifyNight({
          resourceOid,
          nightDate,
          checkoutId: checkout,
          leaseId: lease,
          now: clock,
          session
        });

        if (classified.kind === 'absent') {
          await assertAcquisitionFence({ leaseId: lease, acquisitionId: acquisition, now: clock, session });
          try {
            const created = await ClaimModel.create(
              [
                {
                  [resourceField]: resourceOid,
                  night: nightDate,
                  ownerType: 'checkout',
                  bookingId: null,
                  checkoutId: checkout,
                  leaseId: lease,
                  acquisitionId: acquisition,
                  expiresAt,
                  source: 'checkout_lease'
                }
              ],
              sessionOpts(session)
            );
            const doc = Array.isArray(created) ? created[0] : created;
            newlyAcquired.push(mapClaimDto(doc.toObject ? doc.toObject() : doc));
            continue;
          } catch (err) {
            if (!isDuplicateKeyError(err)) {
              throw createEngineError(ERR.INTEGRITY, 'Unexpected checkout claim insert failure', {
                cause: err?.message || String(err)
              });
            }
            classified = await classifyNight({
              resourceOid,
              nightDate,
              checkoutId: checkout,
              leaseId: lease,
              now: clock,
              session
            });
          }
        }

        if (classified.kind === 'same_lease') {
          await assertAcquisitionFence({ leaseId: lease, acquisitionId: acquisition, now: clock, session });
          await ClaimModel.updateOne(
            {
              _id: classified.claim._id,
              ownerType: 'checkout',
              checkoutId: checkout,
              leaseId: lease
            },
            { $max: { expiresAt } },
            sessionOpts(session)
          );
          const refreshed = await ClaimModel.findById(classified.claim._id)
            .session(session || null)
            .lean();
          reused.push(mapClaimDto(refreshed || classified.claim));
          continue;
        }

        if (classified.kind === 'expired_checkout') {
          const taken = await takeoverExpired({
            resourceOid,
            nightDate,
            checkoutId: checkout,
            leaseId: lease,
            acquisitionId: acquisition,
            expiresAt,
            now: clock,
            session
          });
          if (!taken) {
            classified = await classifyNight({
              resourceOid,
              nightDate,
              checkoutId: checkout,
              leaseId: lease,
              now: clock,
              session
            });
            if (classified.kind === 'same_lease') {
              await assertAcquisitionFence({
                leaseId: lease,
                acquisitionId: acquisition,
                now: clock,
                session
              });
              await ClaimModel.updateOne(
                {
                  _id: classified.claim._id,
                  ownerType: 'checkout',
                  checkoutId: checkout,
                  leaseId: lease
                },
                { $max: { expiresAt } },
                sessionOpts(session)
              );
              const refreshed = await ClaimModel.findById(classified.claim._id)
                .session(session || null)
                .lean();
              reused.push(mapClaimDto(refreshed || classified.claim));
              continue;
            }
            throw createEngineError(ERR.FOREIGN_OWNER, 'Night takeover lost a race', {
              [resourceField]: String(resourceOid),
              night: dateOnlyFromNightDate(nightDate),
              conflicts: [classified.conflict || { night: dateOnlyFromNightDate(nightDate) }]
            });
          }
          newlyAcquired.push(mapClaimDto(taken.toObject ? taken.toObject() : taken));
          continue;
        }

        throw createEngineError(ERR.FOREIGN_OWNER, 'Night is owned by another holder', {
          [resourceField]: String(resourceOid),
          night: dateOnlyFromNightDate(nightDate),
          conflicts: [classified.conflict || { night: dateOnlyFromNightDate(nightDate) }]
        });
      }
    } catch (err) {
      if (newlyAcquired.length > 0) {
        await failAndCompensate(err);
      }
      throw err;
    }

    return {
      ok: true,
      [resourceField]: String(resourceOid),
      checkoutId: checkout,
      leaseId: lease,
      acquisitionId: acquisition,
      newlyAcquired,
      reused,
      claims: [...newlyAcquired, ...reused].sort((a, b) =>
        String(a.night).localeCompare(String(b.night))
      )
    };
  }

  return {
    ERR,
    isBookingOwnedClaim,
    isLiveCheckoutClaim,
    isExpiredCheckoutClaim,
    hasInvalidCheckoutExpiry,
    assertAcquisitionFence,
    acquireCheckoutNights,
    compensateAcquisition,
    clearAcquisitionMarkers,
    clearLeftoverMarkersForSealedLease,
    verifyLeaseNights,
    releaseLeaseClaims,
    expireCheckoutClaims,
    countAcquisitionClaims,
    mapClaimDto,
    nightDateFromDateOnly,
    dateOnlyFromNightDate
  };
}

module.exports = {
  createCheckoutNightLeaseClaimEngine,
  isValidExpiresAt,
  isBookingOwnedClaim,
  isLiveCheckoutClaim,
  isExpiredCheckoutClaim,
  hasInvalidCheckoutExpiry,
  createEngineError,
  isDuplicateKeyError
};
