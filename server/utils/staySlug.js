/** Public stay slugs for bookable listings (single cabins + multi-unit types). */
const STAY_SLUGS = Object.freeze({
  THE_CABIN: 'the-cabin',
  A_FRAME: 'a-frame',
  LUX_CABIN: 'lux-cabin',
  STONE_HOUSE: 'stone-house'
});

const STAY_SLUG_SET = new Set(Object.values(STAY_SLUGS));

/** Known production cabin IDs → slug (permanent redirects). */
const KNOWN_CABIN_ID_TO_SLUG = Object.freeze({
  '69b2ff933a7fff6621e785cc': STAY_SLUGS.THE_CABIN,
  '69b2ff947f141a71ffa7c492': STAY_SLUGS.LUX_CABIN
});

const CABIN_NAME_TO_SLUG = Object.freeze({
  'the cabin': STAY_SLUGS.THE_CABIN,
  bucephalus: STAY_SLUGS.THE_CABIN,
  'the cabin (bucephalus)': STAY_SLUGS.THE_CABIN,
  'lux cabin': STAY_SLUGS.LUX_CABIN,
  'stone house': STAY_SLUGS.STONE_HOUSE
});

function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveCabinSlugFromDoc(cabin) {
  if (!cabin) return null;

  const explicit = normalizeSlug(cabin.slug);
  if (explicit) return explicit;

  const id = String(cabin._id || cabin.id || '');
  if (KNOWN_CABIN_ID_TO_SLUG[id]) return KNOWN_CABIN_ID_TO_SLUG[id];

  const tags = Array.isArray(cabin.cleaningTags) ? cabin.cleaningTags : [];
  for (const raw of tags) {
    const tag = normalizeSlug(raw);
    if (STAY_SLUG_SET.has(tag)) return tag;
  }

  const name = String(cabin.name || '').trim().toLowerCase();
  if (CABIN_NAME_TO_SLUG[name]) return CABIN_NAME_TO_SLUG[name];

  return null;
}

function slugForCabinName(name) {
  return CABIN_NAME_TO_SLUG[String(name || '').trim().toLowerCase()] || null;
}

module.exports = {
  STAY_SLUGS,
  STAY_SLUG_SET,
  KNOWN_CABIN_ID_TO_SLUG,
  CABIN_NAME_TO_SLUG,
  normalizeSlug,
  resolveCabinSlugFromDoc,
  slugForCabinName
};
