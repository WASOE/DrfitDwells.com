function srcSet(folder, name, widths, ext) {
  return widths.map((width) => `/media/${folder}/${name}-${width}w.${ext} ${width}w`).join(', ');
}

/**
 * Authentic Drift & Dwells photographs, mapped by section purpose.
 * Subjects verified against the files on disk (A-frames, cabin, people, build, voucher product).
 */
export const HOME_IMAGES = {
  /** The Cabin lead — recognizable forest cabin exterior near Bachevo. */
  cabinExterior: {
    avifSrcSet: '',
    webpSrcSet: srcSet('ai-search', 'cabin-exterior', [720, 1200], 'webp'),
    src: '/media/ai-search/cabin-exterior-1200w.webp',
    width: 1200,
    height: 540,
  },
  /** Cabin experience — wood stove interior. */
  cabinInterior: {
    avifSrcSet: srcSet('winter', 'cabin-fire-interior', [480, 720, 960, 1200, 1920], 'avif'),
    webpSrcSet: srcSet('winter', 'cabin-fire-interior', [480, 720, 960, 1200, 1920], 'webp'),
    src: '/media/winter/cabin-fire-interior-1200w.webp',
    width: 1600,
    height: 900,
  },
  /** Valley lead — clear A-frame row + Stone House, not landscape filler. */
  valleyAframes: {
    avifSrcSet: '',
    webpSrcSet: '',
    src: '/media/seo/aframe-row-sunset.png',
    width: 1152,
    height: 1536,
  },
  /** Summer A-frames on the meadow (secondary / moments). */
  valleyAframesSummer: {
    avifSrcSet: srcSet('enduro', 'aframes-sunset', [720, 1200], 'avif'),
    webpSrcSet: srcSet('enduro', 'aframes-sunset', [720, 1200], 'webp'),
    src: '/media/enduro/aframes-sunset-1200w.webp',
    width: 1200,
    height: 1600,
  },
  /** Whole-Valley buyout — village + fire pit atmosphere. */
  valleyBuyout: {
    avifSrcSet: srcSet('winter', 'winter-village-campfire-sunset', [480, 720, 960], 'avif'),
    webpSrcSet: srcSet('winter', 'winter-village-campfire-sunset', [480, 720, 960], 'webp'),
    src: '/media/winter/winter-village-campfire-sunset-960w.webp',
    width: 960,
    height: 1280,
  },
  /** Stone House + A-frames morning (group supporting). */
  valleyVillage: {
    avifSrcSet: srcSet('winter', 'stone-house-aframes-winter-morning', [480, 720, 960, 1200], 'avif'),
    webpSrcSet: srcSet('winter', 'stone-house-aframes-winter-morning', [480, 720, 960, 1200], 'webp'),
    src: '/media/winter/stone-house-aframes-winter-morning-1200w.webp',
    width: 1447,
    height: 1087,
  },
  /** Romantic occasion — couple on the Valley swing. */
  couple: {
    avifSrcSet: srcSet('enduro', 'swing-couple', [720, 1200], 'avif'),
    webpSrcSet: srcSet('enduro', 'swing-couple', [720, 1200], 'webp'),
    src: '/media/enduro/swing-couple-1200w.webp',
    width: 1200,
    height: 1600,
  },
  /** Group occasion — guests with the A-frames (authentic build-originals). */
  together: {
    avifSrcSet: '',
    webpSrcSet: '',
    src: '/media/build-originals/1775292060909-z9e6zesu9d-WhatsApp-Image-2025-12-03-at-4.36.15-PM-(1).jpeg',
    width: 1600,
    height: 1073,
  },
  /** Digital detox — stove, journal, forest window; no screens. */
  quiet: {
    avifSrcSet: '',
    webpSrcSet: '',
    src: '/media/build-originals/1776454278977-jqgp4hfx5q-WhatsApp-Image-2026-04-17-at-9.28.21-PM-(2).jpeg',
    width: 2048,
    height: 1534,
  },
  /** Founder / hands-on story — Jose at The Valley (served via uploads). */
  founder: {
    avifSrcSet: '',
    webpSrcSet: '',
    src: '/uploads/Content%20website/Picture-jose-valley.png',
    width: 1600,
    height: 2000,
  },
  /** Build process — early construction of The Cabin. */
  buildSite: {
    avifSrcSet: '',
    webpSrcSet: '',
    src: '/uploads/Bucephalus%20building%20stage/IMG_20210513_124853_586-scaled.jpg.bv.webp',
    width: 1600,
    height: 1067,
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
};
