/**
 * Pure helpers for OPS calendar month conflict detection and unit labels.
 * Conflict comparison is unit-aware for pooled inventory; exclusive-end date
 * overlap semantics match normalizeExclusiveDateRange / Booking checkIn/checkOut.
 */

function normalizeUnitId(unitId) {
  if (unitId == null) return null;
  const s = String(unitId).trim();
  return s || null;
}

/**
 * Exclusive-end range overlap: [aStart, aEnd) overlaps [bStart, bEnd).
 * Same-day checkout + arrival (aEnd === bStart) does not overlap.
 */
function rangesOverlapExclusive(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

/**
 * Whether two calendar blocks share an inventory target for conflict comparison.
 *
 * - Both unit-scoped: only the same unitId can conflict.
 * - Either missing unitId (non-pooled cabin or parent-wide block): cabinId-level
 *   comparison (legacy behaviour).
 */
function calendarBlocksShareConflictTarget(a, b) {
  if (!a || !b) return false;
  if (String(a.cabinId) !== String(b.cabinId)) return false;
  const aUnit = normalizeUnitId(a.unitId);
  const bUnit = normalizeUnitId(b.unitId);
  if (aUnit && bUnit) return aUnit === bUnit;
  return true;
}

/**
 * @param {Array<object>} blocks
 * @returns {{ hardConflicts: object[], warnings: object[] }}
 */
function collectCalendarConflictMarkers(blocks) {
  const hardConflicts = [];
  const warnings = [];
  const list = Array.isArray(blocks) ? blocks : [];

  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      if (a.status === 'tombstoned' || b.status === 'tombstoned') continue;
      if (!calendarBlocksShareConflictTarget(a, b)) continue;

      const isOverlap = rangesOverlapExclusive(
        new Date(a.startDate),
        new Date(a.endDate),
        new Date(b.startDate),
        new Date(b.endDate)
      );
      if (!isOverlap) continue;

      const aUnit = normalizeUnitId(a.unitId);
      const bUnit = normalizeUnitId(b.unitId);
      const sharedUnitId = aUnit && bUnit && aUnit === bUnit ? aUnit : null;

      const isExternalWarning = a.blockType === 'external_hold' || b.blockType === 'external_hold';
      const marker = {
        cabinId: a.cabinId,
        unitId: sharedUnitId,
        blockA: a.id,
        blockB: b.id,
        type: isExternalWarning ? 'warning' : 'hard_conflict'
      };
      if (isExternalWarning) warnings.push(marker);
      else hardConflicts.push(marker);
    }
  }

  return { hardConflicts, warnings };
}

/**
 * Prefer Unit.displayName; fall back to unitNumber (same rules as dashboard mapper).
 * @param {{ displayName?: string, unitNumber?: string }|null|undefined} unit
 * @returns {string|null}
 */
function formatCalendarUnitLabel(unit) {
  if (!unit) return null;
  const displayName = typeof unit.displayName === 'string' ? unit.displayName.trim() : '';
  if (displayName) return displayName;
  const unitNumber = typeof unit.unitNumber === 'string' ? unit.unitNumber.trim() : '';
  if (!unitNumber) return null;
  if (/^unit\b/i.test(unitNumber)) return unitNumber;
  return `Unit ${unitNumber}`;
}

module.exports = {
  rangesOverlapExclusive,
  calendarBlocksShareConflictTarget,
  collectCalendarConflictMarkers,
  formatCalendarUnitLabel,
  normalizeUnitId
};
