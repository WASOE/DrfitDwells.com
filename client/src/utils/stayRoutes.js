import { localizePath } from './localizedRoutes';

export const STAY_SLUG = Object.freeze({
  THE_CABIN: 'the-cabin',
  A_FRAME: 'a-frame',
  LUX_CABIN: 'lux-cabin',
  STONE_HOUSE: 'stone-house'
});

/** Known production cabin IDs → slug (instant client redirects). */
export const KNOWN_CABIN_ID_TO_SLUG = Object.freeze({
  '69b2ff933a7fff6621e785cc': STAY_SLUG.THE_CABIN,
  '69b2ff947f141a71ffa7c492': STAY_SLUG.LUX_CABIN
});

const STAY_SLUG_SET = new Set(Object.values(STAY_SLUG));

const CABIN_NAME_TO_SLUG = Object.freeze({
  'the cabin': STAY_SLUG.THE_CABIN,
  bucephalus: STAY_SLUG.THE_CABIN,
  'the cabin (bucephalus)': STAY_SLUG.THE_CABIN,
  'lux cabin': STAY_SLUG.LUX_CABIN,
  'luxury cabin': STAY_SLUG.LUX_CABIN,
  'stone house': STAY_SLUG.STONE_HOUSE,
  'a-frame': STAY_SLUG.A_FRAME,
  'a frame': STAY_SLUG.A_FRAME,
  'a-frames': STAY_SLUG.A_FRAME
});

export function stayPathForSlug(slug, language = 'en') {
  if (!slug) return null;
  return localizePath(`/stays/${slug}`, language);
}

export function resolveCabinStaySlug(cabin) {
  if (!cabin) return null;

  const explicit = String(cabin.slug || '').trim().toLowerCase();
  if (explicit) return explicit;

  const id = String(cabin._id || cabin.id || '');
  if (KNOWN_CABIN_ID_TO_SLUG[id]) return KNOWN_CABIN_ID_TO_SLUG[id];

  const tags = Array.isArray(cabin.cleaningTags) ? cabin.cleaningTags : [];
  for (const raw of tags) {
    const tag = String(raw || '').trim().toLowerCase();
    if (STAY_SLUG_SET.has(tag)) return tag;
  }

  const name = String(cabin.name || '').trim().toLowerCase();
  if (CABIN_NAME_TO_SLUG[name]) return CABIN_NAME_TO_SLUG[name];

  return null;
}

export function isMultiUnitListing(cabin) {
  return cabin?.inventoryMode === 'multi' || cabin?.inventoryType === 'multi';
}

export function resolveListingStayPathBase(cabin) {
  if (!cabin) return null;

  if (isMultiUnitListing(cabin)) {
    const typeSlug = cabin?.slug || cabin?.cabinTypeSlug;
    return typeSlug ? `/stays/${typeSlug}` : null;
  }

  const slug = resolveCabinStaySlug(cabin);
  return slug ? `/stays/${slug}` : null;
}

/** Public listing slug for policy / stay links (multi uses type slug). */
export function resolveListingStaySlug(cabin) {
  if (!cabin) return null;
  if (isMultiUnitListing(cabin)) {
    const typeSlug = String(cabin?.slug || cabin?.cabinTypeSlug || '').trim().toLowerCase();
    return typeSlug || null;
  }
  return resolveCabinStaySlug(cabin);
}

export function resolveListingStayPath(cabin, language = 'en') {
  const base = resolveListingStayPathBase(cabin);
  return base ? localizePath(base, language) : null;
}

/** Append query string only when non-empty. Accepts raw query or leading `?`. */
export function appendQueryString(path, queryStringOrSearch = '') {
  let q = String(queryStringOrSearch || '').trim();
  if (q.startsWith('?')) q = q.slice(1);
  if (!q) return path;
  return `${path}?${q}`;
}
