/**
 * Build configurator media — cabin assets from Lux Cabin library;
 * A-Frame assets from the same /uploads/The Valley/A frames/ paths used by AFrameDetails (via cabin type seed).
 */

const LUX_BASE = '/uploads/The Valley/Lux Cabin/optimized';

const cabinMediaEntry = (id, label, view, filename) => ({
  id,
  label,
  view,
  image: `${LUX_BASE}/${filename}`,
  images: {
    desktop: `${LUX_BASE}/${filename}`,
    mobile: `${LUX_BASE}/${filename.replace('-desktop', '-mobile')}`,
    thumbnail: `${LUX_BASE}/${filename.replace('-desktop', '-thumbnail')}`,
  },
});

/** Cabin (6×3 / 7×3) — existing Build.jsx MEDIA_LIBRARY paths */
export const BUILD_CABIN_MEDIA = {
  'exterior-hero': cabinMediaEntry('exterior-hero', 'Exterior hero', 'exterior', 'exterior-hero-desktop.webp'),
  'exterior-roof': cabinMediaEntry('exterior-roof', 'Roof detail', 'exterior', 'exterior-roof-desktop.webp'),
  'interior-main': cabinMediaEntry('interior-main', 'Interior overview', 'interior', 'interior-main-desktop.webp'),
  'interior-planks': cabinMediaEntry('interior-planks', 'Interior finish', 'interior', 'interior-planks-desktop.webp'),
  'exterior-angle': cabinMediaEntry('exterior-angle', 'Exterior angle', 'exterior', 'exterior-angle-desktop.webp'),
};

const aframePath = (...segments) =>
  `/${segments.map((part) => encodeURIComponent(part)).join('/')}`;

/** A-Frame — /uploads/The Valley/A frames/ (same source as upsertAFrameOnly / AFrameDetails gallery) */
export const BUILD_AFRAME_MEDIA = {
  'aframe-hero': {
    id: 'aframe-hero',
    label: 'A-Frame exterior',
    view: 'exterior',
    image: aframePath('uploads', 'The Valley', 'A frames', '005fb069-3f90-4af6-9552-1332198f7e48.jpeg'),
    images: {
      desktop: aframePath('uploads', 'The Valley', 'A frames', '005fb069-3f90-4af6-9552-1332198f7e48.jpeg'),
      mobile: aframePath('uploads', 'The Valley', 'A frames', '005fb069-3f90-4af6-9552-1332198f7e48.jpeg'),
      thumbnail: aframePath('uploads', 'The Valley', 'A frames', '005fb069-3f90-4af6-9552-1332198f7e48.jpeg'),
    },
  },
  'aframe-exterior': {
    id: 'aframe-exterior',
    label: 'A-Frame exterior',
    view: 'exterior',
    image: aframePath(
      'uploads',
      'The Valley',
      'WhatsApp Image 2025-10-17 at 10.20.24 AM (4).jpeg'
    ),
    images: {
      desktop: aframePath(
        'uploads',
        'The Valley',
        'WhatsApp Image 2025-10-17 at 10.20.24 AM (4).jpeg'
      ),
      mobile: aframePath(
        'uploads',
        'The Valley',
        'WhatsApp Image 2025-10-17 at 10.20.24 AM (4).jpeg'
      ),
      thumbnail: aframePath(
        'uploads',
        'The Valley',
        'WhatsApp Image 2025-10-17 at 10.20.24 AM (4).jpeg'
      ),
    },
  },
  'aframe-interior': {
    id: 'aframe-interior',
    label: 'A-Frame interior',
    view: 'interior',
    image: aframePath('uploads', 'The Valley', 'A frames', '0c78060b-bdd0-40a4-aaad-89869283051d.jpeg'),
    images: {
      desktop: aframePath('uploads', 'The Valley', 'A frames', '0c78060b-bdd0-40a4-aaad-89869283051d.jpeg'),
      mobile: aframePath('uploads', 'The Valley', 'A frames', '0c78060b-bdd0-40a4-aaad-89869283051d.jpeg'),
      thumbnail: aframePath('uploads', 'The Valley', 'A frames', '0c78060b-bdd0-40a4-aaad-89869283051d.jpeg'),
    },
  },
};

const CABIN_MEDIA_ALIASES = {
  'exterior-hero': 'exterior-hero',
  'exterior-roof': 'exterior-roof',
  'interior-main': 'interior-main',
  'interior-planks': 'interior-planks',
  'exterior-angle': 'exterior-angle',
};

const AFRAME_MEDIA_ALIASES = {
  'exterior-hero': 'aframe-hero',
  'exterior-roof': 'aframe-exterior',
  'exterior-angle': 'aframe-hero',
  'interior-main': 'aframe-interior',
  'interior-planks': 'aframe-interior',
};

export function getBuildModelType(modelId) {
  return modelId === 'aframe' ? 'aframe' : 'cabin';
}

export function resolveBuildMediaId(mediaId, modelId) {
  const type = getBuildModelType(modelId);
  if (type === 'aframe') {
    return AFRAME_MEDIA_ALIASES[mediaId] ?? 'aframe-hero';
  }
  return CABIN_MEDIA_ALIASES[mediaId] ?? 'exterior-hero';
}

export function getBuildMediaEntry(mediaId, modelId) {
  const resolvedId = resolveBuildMediaId(mediaId, modelId);
  if (getBuildModelType(modelId) === 'aframe') {
    return BUILD_AFRAME_MEDIA[resolvedId] ?? BUILD_AFRAME_MEDIA['aframe-hero'];
  }
  return BUILD_CABIN_MEDIA[resolvedId] ?? BUILD_CABIN_MEDIA['exterior-hero'];
}

export function getBuildHeroMedia(modelId) {
  if (modelId === 'aframe') {
    return BUILD_AFRAME_MEDIA['aframe-hero'];
  }
  return BUILD_CABIN_MEDIA['exterior-hero'];
}

export function getBuildHeroImageUrl(modelId, isMobile = false) {
  const entry = getBuildHeroMedia(modelId);
  if (isMobile && entry.images?.mobile) return entry.images.mobile;
  return entry.images?.desktop ?? entry.image;
}
