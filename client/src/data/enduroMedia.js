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
 * Valley gallery sequence for /enduro.
 * Lux Cabin + Stone House use the listing cover images.
 * Captions live in i18n `enduro.gallery.items.*`.
 */
export const ENDURO_GALLERY = Object.freeze([
  galleryItem('aframes-sunset'),
  galleryItem('swing-couple'),
  galleryItem('firepit-night', 1200, 1500),
  galleryItem('lux-cabin', 1200, 1500),
  galleryItem('stone-house', 1200, 1500),
  galleryItem('swing-solo'),
  galleryItem('firepit-sunset'),
  galleryItem('wildflowers-meadow'),
  galleryItem('bathroom-mirror'),
  galleryItem('morning-flowers')
]);
