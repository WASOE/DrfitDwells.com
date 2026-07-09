const { createDomainError } = require('../ops/domain/errors');

/** Public URL slugs → internal OPS locationKey. */
const PUBLIC_SLUG_TO_LOCATION_KEY = Object.freeze({
  'the-valley': 'valley',
  valley: 'valley'
});

/** Internal locationKey → canonical public slug. */
const LOCATION_KEY_TO_PUBLIC_SLUG = Object.freeze({
  valley: 'the-valley'
});

function resolveLocationKeyFromParam(param) {
  const raw = String(param || '').trim().toLowerCase();
  const locationKey = PUBLIC_SLUG_TO_LOCATION_KEY[raw];
  if (!locationKey) {
    throw createDomainError(
      'validation',
      'Unknown location',
      { locationSlug: raw || null },
      404
    );
  }
  return locationKey;
}

function getPublicSlugForLocationKey(locationKey) {
  return LOCATION_KEY_TO_PUBLIC_SLUG[locationKey] || locationKey;
}

module.exports = {
  PUBLIC_SLUG_TO_LOCATION_KEY,
  LOCATION_KEY_TO_PUBLIC_SLUG,
  resolveLocationKeyFromParam,
  getPublicSlugForLocationKey
};
