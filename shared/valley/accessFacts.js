/**
 * Stable Valley guest-access facts — single source for guide, companion, chatbot, GMA.
 * Do not put changeable ops (lock codes, Wi-Fi, live pin overrides) here.
 *
 * guestNavigateUrl stays null until a Maps route is manually verified and locked in.
 */

export const VALLEY_LOCATION = Object.freeze({
  mountains: 'Rhodope Mountains',
  betweenVillages: Object.freeze(['Chereshovo', 'Ortsevo']),
  approxKmFromBansko: 30,
  summary:
    'an off-grid hideaway in the Rhodope Mountains, between Chereshovo and Ortsevo, around 30 km from Bansko'
});

export const DEFAULT_ACCESS_VILLAGE = 'Chereshovo';

export const AVOID_ROUTE_VILLAGE = 'Kraishte';

export const KRAISHTE_WARNING =
  'Google Maps sometimes suggests a route through Kraishte. Do not take that route. Always go via Eleshnitsa, then Palatik, then Chereshovo.';

/** Waypoints / checkpoints on the default driving approach (order matters). */
export const ROUTE_CHECKPOINTS = Object.freeze([
  Object.freeze({
    id: 'eleshnitsa',
    name: 'Eleshnitsa',
    lat: 41.902,
    lng: 23.652
  }),
  Object.freeze({
    id: 'palatik',
    name: 'Palatik',
    lat: 41.9278,
    lng: 23.6953
  }),
  Object.freeze({
    id: 'chereshovo',
    name: 'Chereshovo',
    lat: 41.9491075,
    lng: 23.7085613
  })
]);

export const CHERESHOVO_PARKING = Object.freeze({
  label: 'Chereshovo designated parking (final vehicle stop)',
  lat: 41.949939,
  lng: 23.715978,
  coordinatesDisplay: '41.949939, 23.715978'
});

/** Orientation / property pin — never use as guest driving destination. */
export const VALLEY_ORIENTATION_PIN = Object.freeze({
  label: 'The Valley (orientation only — not a driving destination)',
  lat: 41.9551759,
  lng: 23.738895,
  coordinatesDisplay: '41.9551759, 23.738895'
});

export const FINAL_APPROACH = Object.freeze({
  distanceKmApprox: 2.5,
  walkMinutesApprox: 45,
  /** Locked guest language — do not invent jeep/horse/ATV inventory here. */
  modesPhrase: 'walk or arranged suitable transfer',
  distancePhrase: 'approximately 2.5 km',
  walkTimePhrase: 'approximately 45 minutes'
});

export const NORMAL_CAR = Object.freeze({
  canReachParkingInNormalConditions: true,
  mayContinueBeyondParking: false
});

/** Ortsevo is optional adventure/hiking only — never a peer default arrival. */
export const ORTSEVO_STATUS = 'optional_adventure_hike';

export const CANONICAL_GUIDE_PATH = '/guides/the-valley';

/** Locked offline PDFs hosted under the canonical guide path. */
export const HOW_TO_ARRIVE_PDF_PATH = '/guides/the-valley/how-to-arrive.pdf';
export const GUEST_GUIDE_PDF_PATH = '/guides/the-valley/guest-guide.pdf';

/**
 * Proven guest Navigate URL (Batch 2 + mobile deep-link verification, Aug 2026).
 *
 * Method locked after desktop Google Maps checks from Bansko and Razlog,
 * plus mobile UA / Maps deep-link checks of the same API URL:
 * - destination = Chereshovo parking coords only (never Valley cabin pin)
 * - waypoints = Eleshnitsa then Palatik as raw lat,lng (order preserved)
 * - do NOT use optimize:false with place-name waypoints (Maps mis-resolved it)
 * - do NOT use bare place-name "Eleshnitsa, Bulgaria" as first experiments
 *   were less reliable than coordinates for this corridor
 *
 * Observed: ~54 km / ~1h34 from Bansko via road 84 through Eleshnitsa+Palatik,
 * ending at parking; Kraishte left off the forced path. Razlog similar (~51 km).
 */
export const guestNavigateUrl =
  'https://www.google.com/maps/dir/?api=1&origin=Current+Location&destination=41.949939,23.715978&waypoints=41.9020,23.6520|41.9278,23.6953&travelmode=driving&dir_action=navigate';

export function formatRouteArrowLine() {
  return 'Eleshnitsa → Palatik → Chereshovo';
}

export function formatFinalApproachSummary() {
  return `${FINAL_APPROACH.distancePhrase} (${FINAL_APPROACH.walkTimePhrase} walking), completed by ${FINAL_APPROACH.modesPhrase}`;
}

/**
 * Google Maps directions URL ending at Chereshovo parking
 * with Eleshnitsa then Palatik as ordered coordinate waypoints.
 *
 * @param {{ origin?: string }} [opts]
 * @returns {string}
 */
export function buildParkingNavigateUrl(opts = {}) {
  const origin = opts.origin || 'Current Location';
  if (!opts.origin && guestNavigateUrl) return guestNavigateUrl;

  const destination = `${CHERESHOVO_PARKING.lat},${CHERESHOVO_PARKING.lng}`;
  const waypointPipe = `${ROUTE_CHECKPOINTS[0].lat},${ROUTE_CHECKPOINTS[0].lng}|${ROUTE_CHECKPOINTS[1].lat},${ROUTE_CHECKPOINTS[1].lng}`;

  const params = new URLSearchParams();
  params.set('api', '1');
  params.set('origin', origin);
  params.set('destination', destination);
  params.set('waypoints', waypointPipe);
  params.set('travelmode', 'driving');
  params.set('dir_action', 'navigate');

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export const VALLEY_ACCESS_FACTS = Object.freeze({
  location: VALLEY_LOCATION,
  defaultAccessVillage: DEFAULT_ACCESS_VILLAGE,
  avoidRouteVillage: AVOID_ROUTE_VILLAGE,
  kraishteWarning: KRAISHTE_WARNING,
  routeCheckpoints: ROUTE_CHECKPOINTS,
  parking: CHERESHOVO_PARKING,
  valleyOrientationPin: VALLEY_ORIENTATION_PIN,
  finalApproach: FINAL_APPROACH,
  normalCar: NORMAL_CAR,
  ortsevoStatus: ORTSEVO_STATUS,
  canonicalGuidePath: CANONICAL_GUIDE_PATH,
  howToArrivePdfPath: HOW_TO_ARRIVE_PDF_PATH,
  guestGuidePdfPath: GUEST_GUIDE_PDF_PATH,
  guestNavigateUrl,
  formatRouteArrowLine,
  formatFinalApproachSummary,
  buildParkingNavigateUrl
});
