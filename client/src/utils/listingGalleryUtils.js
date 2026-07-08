/**
 * Shared listing image helpers — single source of truth for card covers site-wide.
 * Cover resolution: isCover → first image → imageUrl → optional static fallback.
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

/** Pick cover record from a gallery array (no listing wrapper). */
export function pickListingCoverImageRecord(images) {
  if (!Array.isArray(images) || images.length === 0) return null;
  return images.find((img) => img?.isCover) || images[0] || null;
}

/**
 * Resolve the public cover image for a cabin or cabinType-shaped listing.
 * @param {{ images?: any[], imageUrl?: string, name?: string } | null} listing
 * @param {{ fallbackUrl?: string, alt?: string }} [options]
 * @returns {{ url: string, alt: string, image: object | null }}
 */
export function getListingCoverImage(listing, options = {}) {
  const fallbackUrl = options.fallbackUrl || '';

  if (!listing) {
    const url = normalizeListingImageSrc(fallbackUrl);
    return {
      url,
      alt: (options.alt || '').trim() || 'Stay photo',
      image: null
    };
  }

  const images = Array.isArray(listing.images) ? listing.images : [];
  const coverImage = pickListingCoverImageRecord(images);
  const rawUrl = coverImage?.url || listing.imageUrl || fallbackUrl;
  const url = normalizeListingImageSrc(rawUrl);
  const alt = (coverImage?.alt || listing.name || options.alt || '').trim() || 'Stay photo';

  return { url, alt, image: coverImage };
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

/**
 * Build card gallery slides: cover first, then remaining gallery images.
 * @param {{ images?: any[], imageUrl?: string, name?: string } | null} listing
 * @param {{ kind?: 'cabin'|'cabinType', maxSlides?: number, fallbackUrl?: string }} [options]
 * @returns {{ url: string, alt: string }[]}
 */
export function buildListingCardSlides(listing, options = {}) {
  const maxSlides = options.maxSlides ?? 5;
  const fallbackUrl = options.fallbackUrl || '';
  const kind = options.kind || 'cabin';

  if (!listing) {
    const cover = getListingCoverImage(null, { fallbackUrl });
    return cover.url ? [{ url: cover.url, alt: cover.alt }] : [];
  }

  const sorted =
    kind === 'cabinType'
      ? sortCabinTypeImages(listing.images, listing.imageUrl, listing.name)
      : sortCabinImages(listing.images, listing.imageUrl, listing.name);

  const cover = getListingCoverImage(listing, { fallbackUrl });
  if (!cover.url && sorted.length === 0) return [];

  const sameImage = (a, b) =>
    normalizeListingImageSrc(a?.url || a) === normalizeListingImageSrc(b?.url || b);
  const sameId = (a, b) => a?._id && b?._id && String(a._id) === String(b._id);

  const seen = new Set();
  const out = [];

  const pushImg = (img) => {
    const url = normalizeListingImageSrc(img?.url || img);
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({
      url,
      alt: (img?.alt || listing.name || '').trim() || 'Stay photo'
    });
  };

  if (cover.image) {
    pushImg(cover.image);
  } else if (cover.url) {
    pushImg({ url: cover.url, alt: cover.alt });
  }

  for (const img of sorted) {
    if (out.length >= maxSlides) break;
    if (cover.image && (sameId(img, cover.image) || sameImage(img, cover.image))) continue;
    pushImg(img);
  }

  if (out.length === 0 && fallbackUrl) {
    pushImg({ url: fallbackUrl, alt: listing.name || 'Stay photo' });
  }

  return out.slice(0, maxSlides);
}

/** @deprecated Use buildListingCardSlides */
export function buildPaidTrafficSlides(entity, kind = 'cabin', maxSlides = 5, fallbackUrl = '') {
  return buildListingCardSlides(entity, { kind, maxSlides, fallbackUrl });
}
