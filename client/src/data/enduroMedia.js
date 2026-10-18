/** Festival /enduro landing media. The hero uses an uploaded site-context photograph. */

function uploadedGalleryItem(id, src, width, height) {
  return { id, width, height, avifSrcSet: '', webpSrcSet: '', fallbackSrc: src };
}

export const ENDURO_HERO_LCP_PRELOAD = '/media/seo/aframe-row-sunset.png';

export function getEnduroHeroResponsive() {
  return {
    slug: 'aframe-row-sunset',
    avifSrcSet: '',
    webpSrcSet: '',
    fallbackSrc: '/media/seo/aframe-row-sunset.png',
    width: 1536,
    height: 1154
  };
}

/**
 * Valley gallery sequence for /enduro, using only the uploaded photographs.
 * Captions live in i18n `enduro.gallery.items.*`.
 */
export const ENDURO_GALLERY = Object.freeze([
  uploadedGalleryItem('aframes-sunset', '/media/seo/aframe-site-wide.jpeg', 2000, 1493),
  uploadedGalleryItem('swing-couple', '/media/seo/aframe-row-sunset.png', 1536, 1154),
  uploadedGalleryItem('firepit-night', '/media/seo/aframe-winter-site.jpeg', 941, 1672),
  uploadedGalleryItem('lux-cabin-cover', '/media/seo/aframe-field-sunset.jpeg', 1334, 2000),
  uploadedGalleryItem('stone-house-cover', '/media/seo/stone-house-sunset-site.jpeg', 1334, 2000),
  uploadedGalleryItem('swing-solo', '/media/seo/aframe-bedroom-winter.jpeg', 948, 1660),
  uploadedGalleryItem('firepit-sunset', '/media/seo/stone-house-winter-wide.jpeg', 2000, 1500),
  uploadedGalleryItem('wildflowers-meadow', '/media/seo/aframe-site-wide.jpeg', 2000, 1493),
  uploadedGalleryItem('bathroom-mirror', '/media/seo/aframe-bedroom-winter.jpeg', 948, 1660),
  uploadedGalleryItem('morning-flowers', '/media/seo/aframe-row-sunset.png', 1536, 1154)
]);
