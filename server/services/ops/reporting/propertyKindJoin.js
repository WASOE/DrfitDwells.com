'use strict';

const Cabin = require('../../../models/Cabin');
const CabinType = require('../../../models/CabinType');

const PROPERTY_KINDS = new Set(['cabin', 'valley']);

function isAllowedPropertyKind(value) {
  return PROPERTY_KINDS.has(value);
}

async function loadPropertyKindMaps() {
  const [cabins, cabinTypes] = await Promise.all([
    Cabin.find({}).select('_id propertyKind').lean(),
    CabinType.find({}).select('_id propertyKind').lean()
  ]);

  const cabinKindById = new Map();
  for (const cabin of cabins) {
    cabinKindById.set(String(cabin._id), cabin.propertyKind || null);
  }

  const cabinTypeKindById = new Map();
  for (const cabinType of cabinTypes) {
    cabinTypeKindById.set(String(cabinType._id), cabinType.propertyKind || null);
  }

  return { cabinKindById, cabinTypeKindById };
}

function resolveBookingPropertyKind(booking, maps) {
  const cabinId = booking?.cabinId;
  const cabinTypeId = booking?.cabinTypeId;

  if (cabinId && cabinTypeId) {
    return { propertyKind: null, issue: 'both_cabin_and_cabin_type' };
  }

  if (cabinId) {
    const id = typeof cabinId === 'object' && cabinId?._id ? String(cabinId._id) : String(cabinId);
    const kind = maps.cabinKindById.get(id) ?? null;
    if (!kind || !PROPERTY_KINDS.has(kind)) {
      return { propertyKind: null, issue: 'missing_property_kind' };
    }
    return { propertyKind: kind, issue: null };
  }

  if (cabinTypeId) {
    const id =
      typeof cabinTypeId === 'object' && cabinTypeId?._id ? String(cabinTypeId._id) : String(cabinTypeId);
    const kind = maps.cabinTypeKindById.get(id) ?? null;
    if (!kind || !PROPERTY_KINDS.has(kind)) {
      return { propertyKind: null, issue: 'missing_property_kind' };
    }
    return { propertyKind: kind, issue: null };
  }

  return { propertyKind: null, issue: 'missing_inventory_ref' };
}

function bookingMatchesPropertyKind(booking, propertyKind, maps) {
  if (!isAllowedPropertyKind(propertyKind)) return false;
  const resolved = resolveBookingPropertyKind(booking, maps);
  return resolved.propertyKind === propertyKind;
}

module.exports = {
  PROPERTY_KINDS,
  isAllowedPropertyKind,
  loadPropertyKindMaps,
  resolveBookingPropertyKind,
  bookingMatchesPropertyKind
};
