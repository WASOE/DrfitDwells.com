'use strict';

const mongoose = require('mongoose');
const Unit = require('../../../models/Unit');
const { loadPropertyKindMaps, isAllowedPropertyKind } = require('./propertyKindJoin');

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function parseObjectId(value, fieldName) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (!mongoose.Types.ObjectId.isValid(raw)) {
    throw badRequest(`${fieldName} must be a valid ObjectId`);
  }
  return new mongoose.Types.ObjectId(raw);
}

function cabinTypeAbsentClause() {
  return { $nor: [{ cabinTypeId: { $type: 'objectId' } }] };
}

function cabinAbsentClause() {
  return { $nor: [{ cabinId: { $type: 'objectId' } }] };
}

/**
 * Validate insights entity filters against persisted propertyKind.
 * cabinId and cabinTypeId are mutually exclusive.
 * unitId may accompany cabinTypeId, or stand alone (validated via Unit → CabinType).
 */
async function validateInsightsEntityFilters({
  propertyKind,
  cabinId,
  cabinTypeId,
  unitId,
  maps: mapsInput = null
}) {
  if (!isAllowedPropertyKind(propertyKind)) {
    throw badRequest('propertyKind must be cabin or valley');
  }

  const parsedCabinId = parseObjectId(cabinId, 'cabinId');
  const parsedCabinTypeId = parseObjectId(cabinTypeId, 'cabinTypeId');
  const parsedUnitId = parseObjectId(unitId, 'unitId');

  if (parsedCabinId && parsedCabinTypeId) {
    throw badRequest('cabinId and cabinTypeId cannot be combined');
  }
  if (parsedCabinId && parsedUnitId) {
    throw badRequest('unitId cannot be combined with cabinId');
  }

  const maps = mapsInput || (await loadPropertyKindMaps());

  if (parsedCabinId) {
    const kind = maps.cabinKindById.get(String(parsedCabinId));
    if (!kind) {
      throw badRequest('cabinId not found in inventory');
    }
    if (kind !== propertyKind) {
      throw badRequest('cabinId does not belong to the requested propertyKind');
    }
    return {
      cabinId: parsedCabinId,
      cabinTypeId: null,
      unitId: null,
      maps
    };
  }

  if (parsedCabinTypeId) {
    const kind = maps.cabinTypeKindById.get(String(parsedCabinTypeId));
    if (!kind) {
      throw badRequest('cabinTypeId not found in inventory');
    }
    if (kind !== propertyKind) {
      throw badRequest('cabinTypeId does not belong to the requested propertyKind');
    }

    if (parsedUnitId) {
      const unit = await Unit.findById(parsedUnitId).select('_id cabinTypeId').lean();
      if (!unit) {
        throw badRequest('unitId not found in inventory');
      }
      if (String(unit.cabinTypeId) !== String(parsedCabinTypeId)) {
        throw badRequest('unitId does not belong to the requested cabinTypeId');
      }
    }

    return {
      cabinId: null,
      cabinTypeId: parsedCabinTypeId,
      unitId: parsedUnitId,
      maps
    };
  }

  if (parsedUnitId) {
    const unit = await Unit.findById(parsedUnitId).select('_id cabinTypeId').lean();
    if (!unit?.cabinTypeId) {
      throw badRequest('unitId not found in inventory');
    }
    const kind = maps.cabinTypeKindById.get(String(unit.cabinTypeId));
    if (!kind) {
      throw badRequest('unitId cabinType is missing propertyKind');
    }
    if (kind !== propertyKind) {
      throw badRequest('unitId does not belong to the requested propertyKind');
    }
    return {
      cabinId: null,
      cabinTypeId: null,
      unitId: parsedUnitId,
      maps
    };
  }

  return {
    cabinId: null,
    cabinTypeId: null,
    unitId: null,
    maps
  };
}

/**
 * Conversion supports cabinId / cabinTypeId only (no unitId).
 */
async function validateConversionEntityFilters({
  propertyKind,
  cabinId,
  cabinTypeId,
  unitId,
  maps: mapsInput = null
}) {
  if (unitId != null && String(unitId).trim() !== '') {
    throw badRequest('unitId is not supported for conversion filters');
  }
  const validated = await validateInsightsEntityFilters({
    propertyKind,
    cabinId,
    cabinTypeId,
    unitId: null,
    maps: mapsInput
  });
  return {
    cabinId: validated.cabinId,
    cabinTypeId: validated.cabinTypeId,
    maps: validated.maps
  };
}

function objectIdsForPropertyKind(maps, propertyKind, kind = 'cabin') {
  const source = kind === 'cabin' ? maps.cabinKindById : maps.cabinTypeKindById;
  const ids = [];
  for (const [id, value] of source.entries()) {
    if (value === propertyKind) {
      ids.push(new mongoose.Types.ObjectId(id));
    }
  }
  return ids;
}

/**
 * Mongo match fragment so only XOR inventory refs of the requested propertyKind are included.
 * When entity filters are set, scopes further.
 */
function buildBookingEntityMatch(propertyKind, entityFilters, maps) {
  if (entityFilters.cabinId) {
    return {
      cabinId: entityFilters.cabinId,
      ...cabinTypeAbsentClause()
    };
  }

  if (entityFilters.cabinTypeId) {
    const match = {
      cabinTypeId: entityFilters.cabinTypeId,
      ...cabinAbsentClause()
    };
    if (entityFilters.unitId) {
      match.unitId = entityFilters.unitId;
    }
    return match;
  }

  if (entityFilters.unitId) {
    return {
      unitId: entityFilters.unitId,
      ...cabinAbsentClause()
    };
  }

  const cabinIds = objectIdsForPropertyKind(maps, propertyKind, 'cabin');
  const cabinTypeIds = objectIdsForPropertyKind(maps, propertyKind, 'cabinType');

  return {
    $or: [
      {
        cabinId: { $in: cabinIds },
        ...cabinTypeAbsentClause()
      },
      {
        cabinTypeId: { $in: cabinTypeIds },
        ...cabinAbsentClause()
      }
    ]
  };
}

/**
 * LocationBooking masters cannot be scoped by cabin/cabinType/unit IDs.
 * Returns whether they should be included for this filter set.
 */
function shouldIncludeLocationBookings(propertyKind, entityFilters) {
  if (propertyKind !== 'valley') return false;
  if (entityFilters.cabinId || entityFilters.cabinTypeId || entityFilters.unitId) {
    return false;
  }
  return true;
}

function parseChannelFilter(channel) {
  if (channel == null || channel === '') return null;
  const value = String(channel).trim();
  if (!['website', 'staff', 'other'].includes(value)) {
    throw badRequest('channel must be website, staff, or other');
  }
  return value;
}

function parseStatusFilter(status) {
  if (status == null || status === '') return 'active';
  const value = String(status).trim();
  if (!['active', 'cancelled', 'all'].includes(value)) {
    throw badRequest('status must be active, cancelled, or all');
  }
  return value;
}

function parsePagination({ page, limit }) {
  const parsedPage = page == null || page === '' ? 1 : Number.parseInt(String(page), 10);
  const parsedLimit = limit == null || limit === '' ? 50 : Number.parseInt(String(limit), 10);
  if (!Number.isFinite(parsedPage) || parsedPage < 1) {
    throw badRequest('page must be a positive integer');
  }
  if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
    throw badRequest('limit must be a positive integer');
  }
  if (parsedLimit > 100) {
    throw badRequest('limit cannot exceed 100');
  }
  return { page: parsedPage, limit: parsedLimit };
}

module.exports = {
  validateInsightsEntityFilters,
  validateConversionEntityFilters,
  buildBookingEntityMatch,
  shouldIncludeLocationBookings,
  parseChannelFilter,
  parseStatusFilter,
  parsePagination,
  cabinTypeAbsentClause,
  cabinAbsentClause,
  objectIdsForPropertyKind
};
