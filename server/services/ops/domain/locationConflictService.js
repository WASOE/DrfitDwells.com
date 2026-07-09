const { normalizeExclusiveDateRange } = require('../../../utils/dateTime');
const { evaluateTargetConflicts } = require('./conflictService');
const { resolveLocationTargets } = require('./locationInventoryService');
const { createDomainError } = require('./errors');

/**
 * Evaluate conflicts for every inventory target in a location.
 *
 * @param {string} locationKey
 * @param {string|Date} startDate
 * @param {string|Date} endDate
 */
async function evaluateLocationConflicts(locationKey, startDate, endDate, options = {}) {
  const { excludeCheckoutSessionId = null } = options || {};
  const normalized = normalizeExclusiveDateRange(startDate, endDate);
  const inventory = await resolveLocationTargets(locationKey);

  if (inventory.inventoryGaps.length > 0) {
    throw createDomainError(
      'validation',
      'Location inventory is incomplete; cannot evaluate location-wide block',
      { inventoryGaps: inventory.inventoryGaps },
      422
    );
  }

  const targetResults = await Promise.all(
    inventory.targets.map(async (target) => {
      const conflict = await evaluateTargetConflicts({
        cabinId: target.cabinId,
        unitId: target.unitId,
        cabinTypeId: target.cabinTypeId,
        startDate: normalized.startDate,
        endDate: normalized.endDate,
        treatExternalHoldAsHard: true,
        excludeCheckoutSessionId
      });
      return {
        targetKey: target.targetKey,
        kind: target.kind,
        label: target.label,
        cabinId: String(target.cabinId),
        unitId: target.unitId ? String(target.unitId) : null,
        cabinTypeId: target.cabinTypeId ? String(target.cabinTypeId) : null,
        hardConflicts: conflict.hardConflicts,
        warnings: conflict.warnings,
        hasHardConflicts: conflict.hasHardConflicts
      };
    })
  );

  const conflicts = targetResults.filter((row) => row.hasHardConflicts);
  const conflictedTargetCount = conflicts.length;

  return {
    locationKey: inventory.locationKey,
    locationLabel: inventory.locationLabel,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    targetCount: inventory.targets.length,
    canBlock: conflictedTargetCount === 0,
    conflictedTargetCount,
    inventoryGaps: inventory.inventoryGaps,
    conflicts,
    targets: targetResults
  };
}

module.exports = {
  evaluateLocationConflicts
};
