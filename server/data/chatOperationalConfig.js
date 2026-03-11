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
};
