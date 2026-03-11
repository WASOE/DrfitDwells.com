/**
 * Operational data for chat FAQ answers.
 * Single source of truth for pricing and policy that may change.
 * Update here when prices change—do not bury in FAQ text or training examples.
 */
module.exports = {
  /** Hot tub wood cost (BGN) when host provides wood for heating the tub */
  hotTubWoodBgn: 50,

  /** Cabin heating firewood is included in the booking price */
  cabinFirewoodIncluded: true,

  /** Horse riding at The Cabin (BGN per person per hour, including gear and guide) */
  horseRidingBgnPerHour: 100,

  /** ATV tours at The Valley — per ATV (driver + 1 passenger allowed) */
  atvIntroForestBgn: 140,
  atvIntroForestHours: 1,
  atvRidgeValleyBgn: 190,
  atvRidgeValleyHours: 1.5,
  atvAboveCloudsBgn: '230–250',
  atvAboveCloudsHours: 2,
};
