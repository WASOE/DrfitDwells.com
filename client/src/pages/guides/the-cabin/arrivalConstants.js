/** Cabin building pin — orientation / walk target only. Never use as driving destination. */
export const CABIN_BUILDING_COORDINATES = '41.930874, 23.401746';

/**
 * Park and walk placemark from repository KML / theCabinGuideRoutes.json primaryParkAndWalk.
 * Canonical driving destination for public Navigate. Live Google Earth visual confirmation
 * remains required before production activation of arrival automation.
 */
export const CABIN_PARK_AND_WALK_COORDINATES = '41.933577, 23.403424';
export const CABIN_PARK_AND_WALK_NAME = 'Park and walk';

/** @deprecated Use CABIN_PARK_AND_WALK_COORDINATES for Navigate; building pin is not a drive target. */
export const CABIN_COORDINATES = CABIN_PARK_AND_WALK_COORDINATES;

export const CABIN_NAVIGATE_URL =
  'https://www.google.com/maps/dir/?api=1&destination=41.93357665629961,23.40342403236582&travelmode=driving&dir_action=navigate';
export const CABIN_HERO_IMAGE = '/uploads/The Cabin/011f4645-32ce-4739-ac8e-16a900612ac7.jpeg';
export const HOST_PHONE_DISPLAY = '+359 876342540';
export const HOST_PHONE_E164 = '+359876342540';
export const GOOGLE_EARTH_URL =
  'https://earth.google.com/earth/d/1RFPJPeRiITrb_9UEYLtQSpqxX8CtNWm7?usp=sharing';

export const ARRIVAL_ASSETS_BASE = `${import.meta.env.BASE_URL}guides/the-cabin`;
export const GPX_URL = `${ARRIVAL_ASSETS_BASE}/arrival-pack.gpx`;
export const KML_URL = `${ARRIVAL_ASSETS_BASE}/arrival-pack.kml`;
/** Filenames shown when saving (friendlier than server asset names). */
export const GPX_FILENAME = 'drift-dwells-the-cabin-arrival.gpx';
export const KML_FILENAME = 'drift-dwells-the-cabin-arrival.kml';
export const PDF_CHECKLIST_URL = `${ARRIVAL_ASSETS_BASE}/arrival-pack-print.html`;

// Optional multi-photo strip — only renders when an entry has a non-empty src (see Visual confirmation).
export const CABIN_APPROACH_PHOTOS = [];

/**
 * Single large trust image: map of final approach, annotated screenshot, or host photo.
 * Leave null until a real asset exists — no empty shell is rendered.
 */
export const CABIN_ROUTE_PROOF_IMAGE = null;
export const CABIN_ROUTE_PROOF_CAPTION =
  'Final approach — stay on the pinned line through this stretch';
