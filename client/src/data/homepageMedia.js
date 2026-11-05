function srcSet(folder, name, widths, ext) {
  return widths.map((width) => `/media/${folder}/${name}-${width}w.${ext} ${width}w`).join(', ');
}

/** Authentic repository photographs. Widths match files in client/public/media. */
export const HOME_IMAGES = {
  cabinInterior: {
    avifSrcSet: srcSet('winter', 'cabin-fire-interior', [480, 720, 960, 1200, 1920], 'avif'),
    webpSrcSet: srcSet('winter', 'cabin-fire-interior', [480, 720, 960, 1200, 1920], 'webp'),
    src: '/media/winter/cabin-fire-interior-1200w.webp',
    width: 1600,
    height: 900,
  },
  valleyAframes: {
    avifSrcSet: srcSet('enduro', 'aframes-sunset', [720, 1200], 'avif'),
    webpSrcSet: srcSet('enduro', 'aframes-sunset', [720, 1200], 'webp'),
    src: '/media/enduro/aframes-sunset-1200w.webp',
    width: 1200,
    height: 1600,
  },
  valleyVillage: {
    avifSrcSet: srcSet('winter', 'stone-house-aframes-winter-morning', [480, 720, 960, 1200], 'avif'),
    webpSrcSet: srcSet('winter', 'stone-house-aframes-winter-morning', [480, 720, 960, 1200], 'webp'),
    src: '/media/winter/stone-house-aframes-winter-morning-1200w.webp',
    width: 1447,
    height: 1087,
  },
  couple: {
    avifSrcSet: srcSet('enduro', 'swing-couple', [720, 1200], 'avif'),
    webpSrcSet: srcSet('enduro', 'swing-couple', [720, 1200], 'webp'),
    src: '/media/enduro/swing-couple-1200w.webp',
    width: 1200,
    height: 1600,
  },
  firepit: {
    avifSrcSet: srcSet('enduro', 'firepit-sunset', [720, 1200], 'avif'),
    webpSrcSet: srcSet('enduro', 'firepit-sunset', [720, 1200], 'webp'),
    src: '/media/enduro/firepit-sunset-1200w.webp',
    width: 1200,
    height: 1600,
  },
  cabinForest: {
    avifSrcSet: '',
    webpSrcSet: srcSet('ai-search', 'cabin-forest', [720, 1200], 'webp'),
    src: '/media/ai-search/cabin-forest-1200w.webp',
    width: 1200,
    height: 675,
  },
  cabinExterior: {
    avifSrcSet: '',
    webpSrcSet: srcSet('ai-search', 'cabin-exterior', [720, 1200], 'webp'),
    src: '/media/ai-search/cabin-exterior-1200w.webp',
    width: 1200,
    height: 540,
  },
  voucher: {
    avifSrcSet: srcSet('gift-vouchers', 'gift-voucher-v2-hero', [480, 800, 1200, 1600, 2400], 'avif'),
    webpSrcSet: srcSet('gift-vouchers', 'gift-voucher-v2-hero', [480, 800, 1200, 1600, 2400], 'webp'),
    src: '/media/gift-vouchers/gift-voucher-v2-hero-1200w.jpg',
    width: 1200,
    height: 1521,
  },
};
