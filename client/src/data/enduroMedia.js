/** Festival /enduro landing media under client/public/media/enduro/ */

const HERO_WIDTHS = [480, 720, 960, 1200, 1920];
const GALLERY_WIDTHS = [720, 1200];

function buildSrcSet(id, ext, widths) {
  return widths.map((w) => `/media/enduro/${id}-${w}w.${ext} ${w}w`).join(', ');
}

function galleryItem(id, role, ratio) {
  return {
    id,
    role,
    ratio,
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
 * Editorial gallery story for /enduro.
 * Order: place → after the ride → overlooks → cabin details.
 * Captions live in i18n `enduro.gallery.items.*`.
 */
export const ENDURO_GALLERY = Object.freeze([
  galleryItem('aframes-sunset', 'feature', '16/10'),
  galleryItem('swing-couple', 'emotion', '3/4'),
  galleryItem('firepit-night', 'emotion', '3/4'),
  galleryItem('swing-solo', 'moment', '3/4'),
  galleryItem('firepit-sunset', 'moment', '3/4'),
  galleryItem('wildflowers-meadow', 'moment', '3/4'),
  galleryItem('bathroom-mirror', 'detail', '3/4'),
  galleryItem('morning-flowers', 'detail', '3/4')
]);
