'use strict';

/**
 * Canonical guest-facing operational facts for Arrival Communications V2.
 *
 * Standard guest checkout matches system CHECK_OUT_TIME (11:00 Europe/Sofia).
 * Late checkout (e.g. 12:00) is optional and only shown when an already-persisted,
 * explicitly approved override is present on the booking — never invented here.
 */

const { CHECK_OUT_TIME } = require('../../../utils/dateTime');

const APP_ORIGIN = (process.env.APP_URL || 'https://driftdwells.com').replace(/\/+$/, '');

/** Guest-facing stay clock times (Europe/Sofia). */
const GUEST_CHECK_IN_FROM = '15:00';
/** Standard checkout — identical to canonical CHECK_OUT_TIME. */
const GUEST_CHECK_OUT_BY = CHECK_OUT_TIME;

/** Known late-checkout wall clocks that may be honored when explicitly approved. */
const ALLOWED_LATE_CHECKOUT_TIMES = Object.freeze(['12:00']);

const SUPPORT_PHONE_DISPLAY = '+359 87 634 2540';

const VALLEY = Object.freeze({
  guidePath: '/guides/the-valley',
  howToArrivePdfPath: '/guides/the-valley/how-to-arrive.pdf',
  guestGuidePdfPath: '/guides/the-valley/guest-guide.pdf',
  routeLine: 'Bansko → Eleshnitsa → Palatik → Chereshovo',
  parkingLabel: 'Chereshovo parking',
  parkingLat: 41.949939,
  parkingLng: 23.715978,
  parkingCoordinatesDisplay: '41.949939, 23.715978',
  parkingNavigateUrl:
    'https://www.google.com/maps/dir/?api=1&origin=Current+Location&destination=41.949939,23.715978&waypoints=41.86743,23.62081|41.91045,23.66801&travelmode=driving&dir_action=navigate',
  finalApproachPhrase: 'approximately 2–2.5 km',
  transferOneWayEur: 20,
  transferReturnEur: 30,
  transferContactName: 'Anife',
  transferContactPhone: '087 954 7051',
  kraishteWarning:
    'Do not follow Google Maps if it suggests Kraishte or forest shortcuts directly to The Valley.'
});

/**
 * Cabin / Bucephalus — Park and walk from repository KML
 * (theCabinGuideRoutes.json primaryParkAndWalk, sourced from The Cabin_ Bucephalus.kml).
 * Live Google Earth visual confirmation remains required before production activation.
 */
const CABIN = Object.freeze({
  guidePath: '/guides/the-cabin',
  googleEarthUrl:
    'https://earth.google.com/earth/d/1RFPJPeRiITrb_9UEYLtQSpqxX8CtNWm7?usp=sharing',
  parkAndWalkName: 'Park and walk',
  parkAndWalkLat: 41.93357665629961,
  parkAndWalkLng: 23.40342403236582,
  parkAndWalkCoordinatesDisplay: '41.933577, 23.403424',
  /** Driving destination for Maps — Park and walk only, never the cabin building. */
  parkAndWalkNavigateUrl:
    'https://www.google.com/maps/dir/?api=1&destination=41.93357665629961,23.40342403236582&travelmode=driving&dir_action=navigate',
  /** Building pin — orientation / walk target only. Never use as driving destination. */
  cabinBuildingLat: 41.93087373604861,
  cabinBuildingLng: 23.40174619886231,
  gpxPath: '/guides/the-cabin/arrival-pack.gpx',
  kmlPath: '/guides/the-cabin/arrival-pack.kml',
  checklistPath: '/guides/the-cabin/arrival-pack-print.html'
});

function absoluteUrl(path) {
  if (!path) return APP_ORIGIN;
  if (/^https?:\/\//i.test(path)) return path;
  return `${APP_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
}

function valleyGuideUrl() {
  return absoluteUrl(VALLEY.guidePath);
}

function cabinGuideUrl() {
  return absoluteUrl(CABIN.guidePath);
}

function valleyTransferOfferLine() {
  return `EUR ${VALLEY.transferOneWayEur} one-way / EUR ${VALLEY.transferReturnEur} return, per vehicle. Contact ${VALLEY.transferContactName} on ${VALLEY.transferContactPhone}.`;
}

function normalizeHhMm(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  const m = s.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return `${String(m[1]).padStart(2, '0')}:${m[2]}`;
}

/**
 * Read an already-persisted, explicitly approved late-checkout override.
 * Uses craft.extras (existing Mixed bag) — does not invent a new Booking schema field.
 * Free-text specialRequests are never parsed (would invent promises).
 *
 * Required shape:
 *   craft.extras.lateCheckoutApproved === true
 *   craft.extras.approvedLateCheckoutBy === '12:00' (allowed late windows only)
 */
function readApprovedLateCheckoutOverride(booking) {
  const extras = booking?.craft?.extras;
  if (!extras || typeof extras !== 'object' || Array.isArray(extras)) return null;
  if (extras.lateCheckoutApproved !== true) return null;
  const time = normalizeHhMm(extras.approvedLateCheckoutBy);
  if (!time || time === GUEST_CHECK_OUT_BY) return null;
  if (!ALLOWED_LATE_CHECKOUT_TIMES.includes(time)) return null;
  return { time };
}

/**
 * Guest-facing checkout display for arrival/confirmation copy.
 * Standard is 11:00. Late checkout only when explicitly approved on the booking.
 */
function resolveGuestCheckoutDisplay(booking) {
  const override = readApprovedLateCheckoutOverride(booking);
  if (override) {
    return {
      time: override.time,
      source: 'approved_late_checkout',
      isLateCheckout: true,
      line: `Checkout: by ${override.time} on`
    };
  }
  return {
    time: GUEST_CHECK_OUT_BY,
    source: 'standard',
    isLateCheckout: false,
    line: `Checkout: by ${GUEST_CHECK_OUT_BY} on`
  };
}

module.exports = {
  GUEST_CHECK_IN_FROM,
  GUEST_CHECK_OUT_BY,
  ALLOWED_LATE_CHECKOUT_TIMES,
  SUPPORT_PHONE_DISPLAY,
  VALLEY,
  CABIN,
  absoluteUrl,
  valleyGuideUrl,
  cabinGuideUrl,
  valleyTransferOfferLine,
  normalizeHhMm,
  readApprovedLateCheckoutOverride,
  resolveGuestCheckoutDisplay
};
