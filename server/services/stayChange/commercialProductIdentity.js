'use strict';

/**
 * Canonical commercial product identity for StayChange / REBOOK.
 * Binding: docs/stay-change-implementation-plan.md §23.7
 *
 * Commercial key = cabinType XOR cabin. unitId is allocation-only.
 */

function idStr(value) {
  if (value == null || value === '') return null;
  return String(value);
}

/**
 * @returns {string|null} "cabinType:<id>" | "cabin:<id>" | null if invalid
 */
function commercialProductKeyFromShape({ cabinId = null, cabinTypeId = null } = {}) {
  const typeId = idStr(cabinTypeId);
  const cabin = idStr(cabinId);
  if (typeId && cabin) return null;
  if (typeId) return `cabinType:${typeId}`;
  if (cabin) return `cabin:${cabin}`;
  return null;
}

function commercialProductKeyFromBooking(booking) {
  if (!booking || typeof booking !== 'object') return null;
  return commercialProductKeyFromShape({
    cabinId: booking.cabinId,
    cabinTypeId: booking.cabinTypeId
  });
}

/**
 * Parse a canonical commercial product key.
 * @returns {{ kind: 'cabinType'|'cabin', id: string }|null}
 */
function parseCommercialProductKey(key) {
  if (typeof key !== 'string') return null;
  const trimmed = key.trim();
  if (trimmed.startsWith('cabinType:')) {
    const id = trimmed.slice('cabinType:'.length);
    return id ? { kind: 'cabinType', id } : null;
  }
  if (trimmed.startsWith('cabin:')) {
    const id = trimmed.slice('cabin:'.length);
    return id ? { kind: 'cabin', id } : null;
  }
  return null;
}

/**
 * Validate inventory commercial shape (REBOOK v1).
 * @returns {{ ok: true, shape: 'single'|'allocated_multi', commercialProductKey: string }
 *   | { ok: false, code: string, message: string }}
 */
function validateCommercialShape({
  cabinId = null,
  cabinTypeId = null,
  unitId = null,
  locationBookingId = null,
  allowUnallocatedMulti = false
} = {}) {
  if (locationBookingId) {
    return {
      ok: false,
      code: 'LOCATION_BOOKING_UNSUPPORTED',
      message: 'REBOOK v1 rejects LocationBooking-linked inventory'
    };
  }
  const typeId = idStr(cabinTypeId);
  const cabin = idStr(cabinId);
  const unit = idStr(unitId);

  if (typeId && cabin) {
    return {
      ok: false,
      code: 'MIXED_COMMERCIAL_IDENTITY',
      message: 'cabinId and cabinTypeId cannot both be set'
    };
  }
  if (!typeId && !cabin) {
    return {
      ok: false,
      code: 'MISSING_COMMERCIAL_IDENTITY',
      message: 'Exactly one of cabinId or cabinTypeId is required'
    };
  }
  if (cabin && unit) {
    return {
      ok: false,
      code: 'UNIT_WITH_SINGLE_CABIN',
      message: 'unitId is not allowed with cabinId commercial identity'
    };
  }
  if (typeId && !unit && !allowUnallocatedMulti) {
    return {
      ok: false,
      code: 'UNALLOCATED_MULTI_UNSUPPORTED',
      message: 'REBOOK v1 rejects unallocated multi-inventory (cabinType without unitId)'
    };
  }

  const commercialProductKey = commercialProductKeyFromShape({ cabinId: cabin, cabinTypeId: typeId });
  if (!commercialProductKey) {
    return {
      ok: false,
      code: 'INVALID_COMMERCIAL_IDENTITY',
      message: 'Could not derive commercial product key'
    };
  }

  return {
    ok: true,
    shape: typeId ? 'allocated_multi' : 'single',
    commercialProductKey
  };
}

/**
 * Commercial comparison ignores unit allocation.
 * @returns {'same'|'different'|'invalid'}
 */
function compareCommercialProducts(a, b) {
  const keyA =
    typeof a === 'string'
      ? a
      : commercialProductKeyFromShape(a || {});
  const keyB =
    typeof b === 'string'
      ? b
      : commercialProductKeyFromShape(b || {});
  if (!keyA || !keyB) return 'invalid';
  return keyA === keyB ? 'same' : 'different';
}

/**
 * Future routing hint (S3/S4). Pure; does not mutate.
 * @returns {'rebook'|'reallocate'|'amend'|'noop'|'invalid'}
 */
function classifyStayChangeRoute({
  source = {},
  target = {},
  datesOrGuestsOrQuoteChanged = false
} = {}) {
  const src = validateCommercialShape({ ...source, allowUnallocatedMulti: true });
  const tgt = validateCommercialShape({ ...target, allowUnallocatedMulti: true });
  if (!src.ok || !tgt.ok) return 'invalid';

  if (src.commercialProductKey !== tgt.commercialProductKey) {
    return 'rebook';
  }

  // Same commercial key
  const srcCabin = idStr(source.cabinId);
  const tgtCabin = idStr(target.cabinId);
  if (srcCabin && tgtCabin && srcCabin !== tgtCabin) {
    // Defensive: same key should imply same cabinId, but any cabinId change is REBOOK
    return 'rebook';
  }

  const srcUnit = idStr(source.unitId);
  const tgtUnit = idStr(target.unitId);
  const sameType = idStr(source.cabinTypeId) && idStr(source.cabinTypeId) === idStr(target.cabinTypeId);

  if (sameType && srcUnit && tgtUnit && srcUnit !== tgtUnit && !datesOrGuestsOrQuoteChanged) {
    return 'reallocate';
  }

  if (datesOrGuestsOrQuoteChanged) {
    return 'amend';
  }

  if (sameType && srcUnit === tgtUnit) {
    return 'noop';
  }
  if (srcCabin && tgtCabin && srcCabin === tgtCabin) {
    return 'noop';
  }

  return 'noop';
}

module.exports = {
  commercialProductKeyFromShape,
  commercialProductKeyFromBooking,
  parseCommercialProductKey,
  validateCommercialShape,
  compareCommercialProducts,
  classifyStayChangeRoute
};
