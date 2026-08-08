/**
 * Valley access facts — smoke contract for shared/valley/accessFacts.js
 * Run: node --test scripts/valleyAccessFacts.test.cjs (from server/)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  VALLEY_LOCATION,
  DEFAULT_ACCESS_VILLAGE,
  AVOID_ROUTE_VILLAGE,
  KRAISHTE_WARNING,
  ROUTE_CHECKPOINTS,
  CHERESHOVO_PARKING,
  VALLEY_ORIENTATION_PIN,
  FINAL_APPROACH,
  NORMAL_CAR,
  ORTSEVO_STATUS,
  CANONICAL_GUIDE_PATH,
  HOW_TO_ARRIVE_PDF_PATH,
  GUEST_GUIDE_PDF_PATH,
  guestNavigateUrl,
  formatRouteArrowLine,
  formatFinalApproachSummary,
  buildParkingNavigateUrl
} = require('../../shared/valley/accessFacts.js');

test('locked location and default arrival village', () => {
  assert.equal(VALLEY_LOCATION.mountains, 'Rhodope Mountains');
  assert.deepEqual([...VALLEY_LOCATION.betweenVillages], ['Chereshovo', 'Ortsevo']);
  assert.equal(VALLEY_LOCATION.approxKmFromBansko, 30);
  assert.equal(DEFAULT_ACCESS_VILLAGE, 'Chereshovo');
  assert.equal(AVOID_ROUTE_VILLAGE, 'Kraishte');
  assert.match(KRAISHTE_WARNING, /Kraishte/);
  assert.match(KRAISHTE_WARNING, /Eleshnitsa/);
});

test('route checkpoints are Eleshnitsa → Palatik → Chereshovo', () => {
  assert.deepEqual(
    ROUTE_CHECKPOINTS.map((c) => c.name),
    ['Eleshnitsa', 'Palatik', 'Chereshovo']
  );
  assert.equal(ROUTE_CHECKPOINTS[0].lat, 41.86743);
  assert.equal(ROUTE_CHECKPOINTS[0].lng, 23.62081);
  assert.equal(ROUTE_CHECKPOINTS[1].lat, 41.91045);
  assert.equal(ROUTE_CHECKPOINTS[1].lng, 23.66801);
  assert.equal(formatRouteArrowLine(), 'Eleshnitsa → Palatik → Chereshovo');
});

test('parking is guest driving end; Valley pin is orientation only', () => {
  assert.equal(CHERESHOVO_PARKING.lat, 41.949939);
  assert.equal(CHERESHOVO_PARKING.lng, 23.715978);
  assert.equal(VALLEY_ORIENTATION_PIN.lat, 41.9551759);
  assert.equal(VALLEY_ORIENTATION_PIN.lng, 23.738895);
  assert.notEqual(
    `${CHERESHOVO_PARKING.lat},${CHERESHOVO_PARKING.lng}`,
    `${VALLEY_ORIENTATION_PIN.lat},${VALLEY_ORIENTATION_PIN.lng}`
  );
});

test('final approach distance/time and modes phrase', () => {
  assert.equal(FINAL_APPROACH.distanceKmApprox, 2.5);
  assert.equal(FINAL_APPROACH.walkMinutesApprox, 45);
  assert.equal(FINAL_APPROACH.modesPhrase, 'walk or arranged suitable transfer');
  assert.match(formatFinalApproachSummary(), /2\.5 km/);
  assert.match(formatFinalApproachSummary(), /45 minutes/);
  assert.doesNotMatch(formatFinalApproachSummary(), /\b1 km\b|\b1km\b|15-25|15–25/i);
});

test('normal-car and Ortsevo rules', () => {
  assert.equal(NORMAL_CAR.canReachParkingInNormalConditions, true);
  assert.equal(NORMAL_CAR.mayContinueBeyondParking, false);
  assert.equal(ORTSEVO_STATUS, 'optional_adventure_hike');
  assert.equal(CANONICAL_GUIDE_PATH, '/guides/the-valley');
  assert.equal(HOW_TO_ARRIVE_PDF_PATH, '/guides/the-valley/how-to-arrive.pdf');
  assert.equal(GUEST_GUIDE_PDF_PATH, '/guides/the-valley/guest-guide.pdf');
});

test('proven navigate URL ends at parking with Eleshnitsa then Palatik coords', () => {
  assert.ok(guestNavigateUrl);
  assert.equal(buildParkingNavigateUrl(), guestNavigateUrl);
  assert.match(guestNavigateUrl, /^https:\/\/www\.google\.com\/maps\/dir\/\?/);
  assert.match(guestNavigateUrl, /origin=Current\+Location/);
  assert.match(guestNavigateUrl, /destination=41\.949939,23\.715978/);
  assert.match(guestNavigateUrl, /waypoints=41\.86743,23\.62081\|41\.91045,23\.66801/);
  assert.match(guestNavigateUrl, /travelmode=driving/);
  assert.match(guestNavigateUrl, /dir_action=navigate/);
  assert.doesNotMatch(guestNavigateUrl, /41\.9020,23\.6520/);
  assert.doesNotMatch(guestNavigateUrl, /41\.9278,23\.6953/);
  assert.doesNotMatch(guestNavigateUrl, /41\.9551759/);
  assert.doesNotMatch(guestNavigateUrl, /optimize/);

  const fromBansko = buildParkingNavigateUrl({ origin: 'Bansko, Bulgaria' });
  assert.match(fromBansko, /origin=Bansko/);
  assert.match(fromBansko, /destination=41\.949939(,|%2C)23\.715978/);
  assert.match(fromBansko, /waypoints=41\.86743(,|%2C)23\.62081(\||%7C)41\.91045(,|%2C)23\.66801/);
  assert.match(fromBansko, /travelmode=driving/);
  assert.match(fromBansko, /dir_action=navigate/);
  assert.doesNotMatch(fromBansko, /41\.9020(,|%2C)23\.6520/);
  assert.doesNotMatch(fromBansko, /41\.9278(,|%2C)23\.6953/);
  assert.doesNotMatch(fromBansko, /41\.9551759/);
  assert.doesNotMatch(fromBansko, /optimize/);
});
