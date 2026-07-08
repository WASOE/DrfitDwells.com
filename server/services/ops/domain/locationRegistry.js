const { PROPERTY_KINDS } = require('../../messaging/propertyKindResolver');
const { createDomainError } = require('./errors');

/** v1 location keys map to persisted `propertyKind` on Cabin / CabinType. */
const LOCATION_REGISTRY = Object.freeze({
  valley: Object.freeze({ propertyKind: 'valley', label: 'The Valley' }),
  cabin: Object.freeze({ propertyKind: 'cabin', label: 'The Cabin' })
});

const LOCATION_KEYS = Object.freeze(Object.keys(LOCATION_REGISTRY));

function assertAllowedLocationKey(locationKey) {
  const key = String(locationKey || '').trim();
  if (!LOCATION_REGISTRY[key]) {
    throw createDomainError(
      'validation',
      `locationKey must be one of: ${LOCATION_KEYS.join(', ')}`,
      { locationKey: key || null },
      400
    );
  }
  return key;
}

function getLocationEntry(locationKey) {
  const key = assertAllowedLocationKey(locationKey);
  return { locationKey: key, ...LOCATION_REGISTRY[key] };
}

function isAllowedLocationKey(locationKey) {
  return typeof locationKey === 'string' && Object.prototype.hasOwnProperty.call(LOCATION_REGISTRY, locationKey);
}

module.exports = {
  LOCATION_REGISTRY,
  LOCATION_KEYS,
  PROPERTY_KINDS,
  assertAllowedLocationKey,
  getLocationEntry,
  isAllowedLocationKey
};
