/**
 * Shared listing image ordering + hero pick (aligned with CabinDetails gallery + MosaicGallery hero).
 * Used by paid-traffic cards so cover/first slide matches property pages.
 */

export const LISTING_SPACE_ORDER = [
  'bedroom',
  'living_room',
  'kitchen',
  'dining',
  'bathroom',
  'outdoor',
  'view',
  'hot_tub_sauna',
  'amenities',
  'floorplan',
  'map',
  'other'
];

export function normalizeListingImageSrc(u) {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('/')) return u;
  return `/uploads/cabins/${u}`;
}

export function getPrimaryTag(img) {
  return Array.isArray(img?.tags) && img.tags.length > 0 ? img.tags[0] : null;
}

/** Full gallery sort — same rules as `CabinDetails` `gallery` useMemo. */
export function sortCabinImages(images, imageUrl, name = '') {
  if (Array.isArray(images) && images.length > 0) {
    return images.slice().sort((a, b) => {
      if (Boolean(b.isCover) !== Boolean(a.isCover)) return (b.isCover ? 1 : 0) - (a.isCover ? 1 : 0);
      const aTag = getPrimaryTag(a);
      const bTag = getPrimaryTag(b);
      if (aTag !== bTag) {
        const aIdx = aTag ? LISTING_SPACE_ORDER.indexOf(aTag) : 999;
        const bIdx = bTag ? LISTING_SPACE_ORDER.indexOf(bTag) : 999;
        if (aIdx !== bIdx) return aIdx - bIdx;
      }
      if (aTag === bTag && (a.spaceOrder !== undefined || b.spaceOrder !== undefined)) {
        const aOrder = a.spaceOrder || 0;
        const bOrder = b.spaceOrder || 0;
        if (aOrder !== bOrder) return aOrder - bOrder;
      }
      if ((a.sort || 0) !== (b.sort || 0)) return (a.sort || 0) - (b.sort || 0);
      const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return aCreated - bCreated;
    });
  }
  if (imageUrl) {
    return [{ url: imageUrl, alt: name || '' }];
  }
  return [];
}

/** CabinType / simpler documents: cover first, then sort. */
export function sortCabinTypeImages(images, imageUrl, name = '') {
  if (Array.isArray(images) && images.length > 0) {
    return images.slice().sort((a, b) => {
      if (Boolean(b.isCover) !== Boolean(a.isCover)) return (b.isCover ? 1 : 0) - (a.isCover ? 1 : 0);
      return (a.sort || 0) - (b.sort || 0);
    });
  }
  if (imageUrl) {
    return [{ url: imageUrl, alt: name || '' }];
  }
  return [];
}

/** Same heuristic as `MosaicGallery` `pickHeroImage`. */
export function pickHeroImage(images) {
  if (!images || images.length === 0) return null;

  const cover = images.find((img) => img.isCover) || null;
  const heroPriorityTags = ['outdoor', 'view', 'living_room', 'bedroom'];

  const prioritized = images.find((img) => heroPriorityTags.includes(getPrimaryTag(img)));

  if (!cover) {
    return prioritized || images[0];
  }

  const coverTag = getPrimaryTag(cover);
  if (heroPriorityTags.includes(coverTag)) {
    return cover;
  }

  return prioritized || cover;
}

/**
 * @param {{ images?: any[], imageUrl?: string, name?: string }} entity — cabin or cabinType-shaped
 * @param {'cabin'|'cabinType'} kind
 * @param {number} maxSlides
 * @returns {{ url: string, alt: string }[]}
 */
export function buildPaidTrafficSlides(entity, kind = 'cabin', maxSlides = 5) {
  if (!entity) return [];

  const sorted =
    kind === 'cabinType'
      ? sortCabinTypeImages(entity.images, entity.imageUrl, entity.name)
      : sortCabinImages(entity.images, entity.imageUrl, entity.name);

  if (sorted.length === 0) return [];

  const hero = pickHeroImage(sorted);
  if (!hero) return [];

  const sameImage = (a, b) =>
    normalizeListingImageSrc(a.url || a) === normalizeListingImageSrc(b.url || b);
  const sameId = (a, b) => a._id && b._id && String(a._id) === String(b._id);

  const rest = sorted.filter((img) => !sameId(img, hero) && !sameImage(img, hero));

  const ordered = [hero, ...rest];

  const seen = new Set();
  const out = [];
  for (const img of ordered) {
    const url = normalizeListingImageSrc(img.url || img);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, alt: (img.alt || entity.name || '').trim() || 'Stay photo' });
    if (out.length >= maxSlides) break;
  }

  return out;
}
