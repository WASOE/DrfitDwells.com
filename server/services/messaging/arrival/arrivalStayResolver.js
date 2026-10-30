'use strict';

const Cabin = require('../../../models/Cabin');
const CabinType = require('../../../models/CabinType');
const Unit = require('../../../models/Unit');
const {
  resolvePropertyKindFromCabinDoc,
  resolvePropertyKindFromCabinTypeDoc,
  PropertyKindUnresolvedError
} = require('../propertyKindResolver');
const { STAY_SLUGS, resolveCabinSlugFromDoc } = require('../../../utils/staySlug');

function trimmedOrNull(value) {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

function resolveUnitLabel(unit) {
  if (!unit || typeof unit !== 'object') return null;
  const displayName = trimmedOrNull(unit.displayName);
  if (displayName) return displayName;
  const unitNumber = trimmedOrNull(unit.unitNumber);
  if (!unitNumber) return null;
  if (/^unit\b/i.test(unitNumber) || /^a-?\s*frame/i.test(unitNumber)) return unitNumber;
  return `Unit ${unitNumber}`;
}

async function loadUnitDoc(booking) {
  if (!booking?.unitId) return null;
  if (typeof booking.unitId === 'object' && (booking.unitId.displayName || booking.unitId.unitNumber)) {
    return booking.unitId;
  }
  const id = booking.unitId._id || booking.unitId;
  return Unit.findById(id).lean();
}

/**
 * Resolve stay target, propertyKind, display name, and valley stay family.
 */
async function resolveArrivalStayContext(booking) {
  if (!booking) {
    return { ok: false, code: 'booking_missing', message: 'Booking is required' };
  }

  let stayTarget = null;
  let stayKind = null;
  try {
    if (booking.cabinId) {
      const id = booking.cabinId._id || booking.cabinId;
      stayTarget = await Cabin.findById(id).lean();
      stayKind = 'cabin';
    } else if (booking.cabinTypeId) {
      const id = booking.cabinTypeId._id || booking.cabinTypeId;
      stayTarget = await CabinType.findById(id).lean();
      stayKind = 'cabinType';
    }
  } catch (err) {
    return { ok: false, code: 'stay_load_failed', message: err?.message || String(err) };
  }

  if (!stayTarget) {
    return { ok: false, code: 'stay_missing', message: 'Booking has no resolvable cabin or cabin type' };
  }

  let propertyKind;
  try {
    propertyKind =
      stayKind === 'cabin'
        ? resolvePropertyKindFromCabinDoc(stayTarget)
        : resolvePropertyKindFromCabinTypeDoc(stayTarget);
  } catch (err) {
    if (err instanceof PropertyKindUnresolvedError) {
      return {
        ok: false,
        code: 'property_kind_unresolved',
        message: err.message,
        details: err.details || null
      };
    }
    throw err;
  }

  const unit = await loadUnitDoc(booking);
  const unitLabel = resolveUnitLabel(unit);
  const staySlug = resolveCabinSlugFromDoc(stayTarget);
  const baseName = trimmedOrNull(stayTarget.name) || 'your stay';
  const propertyName = unitLabel || baseName;

  let valleyStayFamily = null;
  if (propertyKind === 'valley') {
    if (staySlug === STAY_SLUGS.A_FRAME || stayKind === 'cabinType') {
      valleyStayFamily = 'a_frame';
    } else if (staySlug === STAY_SLUGS.STONE_HOUSE) {
      valleyStayFamily = 'stone_house';
    } else if (staySlug === STAY_SLUGS.LUX_CABIN) {
      valleyStayFamily = 'lux_cabin';
    } else {
      valleyStayFamily = 'valley_generic';
    }
  }

  return {
    ok: true,
    stayTarget,
    stayKind,
    propertyKind,
    propertyName,
    unitLabel,
    staySlug,
    valleyStayFamily
  };
}

module.exports = {
  resolveArrivalStayContext,
  resolveUnitLabel
};
