/** Festival /enduro landing media under client/public/media/enduro/ */

const HERO_WIDTHS = [480, 720, 960, 1200, 1920];
const GALLERY_WIDTHS = [720, 1200];

function buildSrcSet(id, ext, widths) {
  return widths.map((w) => `/media/enduro/${id}-${w}w.${ext} ${w}w`).join(', ');
}

function galleryItem(id, width = 1200, height = 1600) {
  return {
    id,
    width,
    height,
    avifSrcSet: buildSrcSet(id, 'avif', GALLERY_WIDTHS),
    webpSrcSet: buildSrcSet(id, 'webp', GALLERY_WIDTHS),
    fallbackSrc: `/media/enduro/${id}.jpg`
  };
}

export const ENDURO_HERO_LCP_PRELOAD = '/media/enduro/hero-aerial-960w.avif';

export function getEnduroHeroResponsive() {
  return {
    slug: 'hero-aerial',
    avifSrcSet: buildSrcSet('hero-aerial', 'avif', HERO_WIDTHS),
    webpSrcSet: buildSrcSet('hero-aerial', 'webp', HERO_WIDTHS),
    fallbackSrc: '/media/enduro/hero-aerial.jpg',
    width: 1920,
    height: 1080
  };
}

/**
 * Hospitality mosaic sequence for /enduro.
 * Order: place → people → fire → units → land → cabin details.
 * Captions / alts in i18n `enduro.gallery.items.*`.
 */
export const ENDURO_GALLERY = Object.freeze([
  galleryItem('aframes-sunset'),
  galleryItem('swing-couple'),
  galleryItem('firepit-night', 1200, 1500),
  galleryItem('lux-cabin', 1200, 1500),
  galleryItem('stone-house', 1200, 1500),
  galleryItem('firepit-sunset'),
  galleryItem('swing-solo'),
  galleryItem('wildflowers-meadow'),
  galleryItem('bathroom-mirror'),
  galleryItem('morning-flowers'),
  galleryItem('lux-cabin-sunset', 1200, 1500),
  galleryItem('stone-house-deck', 1200, 1500)
]);

/** First 5 = Airbnb-style cover mosaic (1 lead + 4 tiles). */
export const ENDURO_MOSAIC_COUNT = 5;

/** Next 4 = dense secondary strip on-page. Remainder lightbox-only. */
export const ENDURO_STRIP_COUNT = 4;
