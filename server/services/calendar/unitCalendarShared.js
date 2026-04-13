const mongoose = require('mongoose');

/**
 * Shared Mongo predicate: AvailabilityBlock rows that apply to a specific physical unit
 * (parent-wide OR explicitly targeted to that unit).
 * Must stay aligned with {@link countBlockingBlocksForUnit} in publicAvailabilityService.js
 * so outbound unit ICS and guest availability do not drift.
 *
 * @param {mongoose.Types.ObjectId} unitObjectId
 * @returns {{ $or: Array<Record<string, unknown>> }}
 */
function availabilityBlockUnitScopeClause(unitObjectId) {
  return {
    $or: [{ unitId: null }, { unitId: { $exists: false } }, { unitId: unitObjectId }]
  };
}

module.exports = {
  availabilityBlockUnitScopeClause
};
