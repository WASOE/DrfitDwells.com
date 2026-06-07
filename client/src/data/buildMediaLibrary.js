/**
 * Build configurator media — sourced from live booking listings on driftdwells.com
 * (GET /api/availability, Lux Cabin + A-Frame cover + gallery). Verified 2026-06-07.
 */

/** Live search listing covers (isCover / imageUrl from production API). */
export const BUILD_BOOKING_COVER = {
  'lux-cabin':
    '/uploads/cabins/69b2ff947f141a71ffa7c492/original/1776454430446-v6zze6vlats-WhatsApp-Image-2026-04-17-at-9.28.21-PM-(4).jpeg',
  aframe:
    '/uploads/cabins/69d096b6bd7fb6fc0d3c2a34/original/1775292060909-z9e6zesu9d-WhatsApp-Image-2025-12-03-at-4.36.15-PM-(1).jpeg',
};

const urlMediaEntry = (id, label, view, url) => ({
  id,
  label,
  view,
  image: url,
  images: {
    desktop: url,
    mobile: url,
    thumbnail: url,
  },
});

/** Lux Cabin — hero + option-step photos from live listing gallery only. */
export const BUILD_CABIN_MEDIA = {
  'exterior-hero': urlMediaEntry(
    'exterior-hero',
    'The Lux Cabin',
    'exterior',
    BUILD_BOOKING_COVER['lux-cabin']
  ),
  'exterior-roof': urlMediaEntry(
    'exterior-roof',
    'Exterior',
    'exterior',
    '/uploads/cabins/69b2ff947f141a71ffa7c492/original/1776456061533-nviyrjuw9y9-WhatsApp-Image-2026-04-17-at-10.00.43-PM.jpeg'
  ),
  'exterior-angle': urlMediaEntry(
    'exterior-angle',
    'Exterior angle',
    'exterior',
    '/uploads/cabins/69b2ff947f141a71ffa7c492/original/1776455431687-8g8rfzxhh3o-WhatsApp-Image-2026-04-17-at-9.49.48-PM.jpeg'
  ),
  'interior-main': urlMediaEntry(
    'interior-main',
    'Interior overview',
    'interior',
    '/uploads/cabins/69b2ff947f141a71ffa7c492/original/1776454278977-jqgp4hfx5q-WhatsApp-Image-2026-04-17-at-9.28.21-PM-(2).jpeg'
  ),
  'interior-planks': urlMediaEntry(
    'interior-planks',
    'Interior finish',
    'interior',
    '/uploads/cabins/69b2ff947f141a71ffa7c492/original/1776454319344-gfmyvd7x1c-WhatsApp-Image-2026-04-17-at-9.28.20-PM-(1).jpeg'
  ),
};

/** A Frame — hero + option-step photos from live listing gallery only. */
export const BUILD_AFRAME_MEDIA = {
  'aframe-hero': urlMediaEntry(
    'aframe-hero',
    'The A Frame',
    'exterior',
    BUILD_BOOKING_COVER.aframe
  ),
  'aframe-exterior': urlMediaEntry(
    'aframe-exterior',
    'A-Frame exterior',
    'exterior',
    '/uploads/cabins/69d096b6bd7fb6fc0d3c2a34/original/1776456229922-aiq1svhdgre-WhatsApp-Image-2026-04-13-at-5.50.08-PM.jpeg'
  ),
  'aframe-interior': urlMediaEntry(
    'aframe-interior',
    'A-Frame interior',
    'interior',
    '/uploads/The%20Valley/A%20frames/0c78060b-bdd0-40a4-aaad-89869283051d.jpeg'
  ),
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
