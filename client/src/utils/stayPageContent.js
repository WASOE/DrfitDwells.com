const HOT_TUB_PATTERN = /hot\s*tub|hot_tub|джакузи|хот\s*тъб/i;

const KNOWN_STAY_SLUGS = new Set(['the-cabin', 'lux-cabin', 'stone-house', 'a-frame']);

function readLocalizedList(t, key) {
  const items = t(key, { returnObjects: true, defaultValue: [] });
  if (!Array.isArray(items) || items.length === 0) return null;
  if (!items.every((item) => typeof item === 'string' && item.trim())) return null;
  return items.map((item) => item.trim()).slice(0, 12);
}

function stripHotTubMentions(items) {
  return items.filter((item) => !HOT_TUB_PATTERN.test(item));
}

/**
 * Property-specific highlights for public stay pages.
 * Known slugs use i18n bundles; API data is fallback only for unknown listings.
 */
export function resolveStayHighlights({ slug, apiHighlights, t }) {
  if (slug && KNOWN_STAY_SLUGS.has(slug)) {
    const localized = readLocalizedList(t, `stayContent.${slug}.highlights`);
    if (localized?.length) return localized.slice(0, 5);
  }

  if (Array.isArray(apiHighlights) && apiHighlights.length > 0) {
    const items = apiHighlights.slice(0, 5);
    return slug === 'the-cabin' ? items : stripHotTubMentions(items);
  }

  if (slug === 'the-cabin') {
    return readLocalizedList(t, 'stayContent.the-cabin.highlights') || [];
  }

  return [];
}

/**
 * Property-specific amenities for public stay pages.
 */
export function resolveStayAmenities({ slug, apiAmenities, t }) {
  if (slug && KNOWN_STAY_SLUGS.has(slug)) {
    const localized = readLocalizedList(t, `stayContent.${slug}.amenities`);
    if (localized?.length) return localized;
  }

  if (Array.isArray(apiAmenities) && apiAmenities.length > 0) {
    const items = apiAmenities.map((a) => String(a).trim()).filter(Boolean);
    return slug === 'the-cabin' ? items : stripHotTubMentions(items);
  }

  if (slug === 'the-cabin') {
    return readLocalizedList(t, 'stayContent.the-cabin.amenities') || [];
  }

  return [];
}
