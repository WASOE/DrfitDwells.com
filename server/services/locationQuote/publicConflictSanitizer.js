const REASON_PRIORITY = Object.freeze({
  externally_reserved: 4,
  already_booked: 3,
  maintenance: 2,
  blocked: 1
});

function mapConflictReason(hardConflict) {
  if (!hardConflict) return 'blocked';
  if (hardConflict.kind === 'reservation') return 'already_booked';
  if (hardConflict.kind === 'legacy_blocked_date') return 'blocked';
  if (hardConflict.kind === 'availability_block') {
    if (hardConflict.blockType === 'external_hold') return 'externally_reserved';
    if (hardConflict.blockType === 'maintenance') return 'maintenance';
    return 'blocked';
  }
  return 'blocked';
}

function isAFrameLabel(label) {
  const lower = String(label || '').toLowerCase();
  return lower.includes('a-frame') || lower.includes('a frame');
}

function buildPublicMessage(reason, accommodationLabel) {
  const label = accommodationLabel || 'An accommodation';
  switch (reason) {
    case 'already_booked':
      return `${label} is not available for your dates.`;
    case 'externally_reserved':
      if (isAFrameLabel(label)) {
        return 'One of the A-frame cabins is not available for your dates.';
      }
      return `${label} is not available for your dates.`;
    case 'maintenance':
      return `${label} is unavailable due to maintenance.`;
    case 'blocked':
    default:
      return `${label} is not available for your dates.`;
  }
}

function resolvePublicAccommodationLabel(targetRow, inventoryTargets) {
  if (targetRow.kind === 'unit') {
    const invTarget = inventoryTargets.find((t) => t.targetKey === targetRow.targetKey);
    const fullLabel = invTarget?.label || targetRow.label || '';
    const typeName = fullLabel.split(' — ')[0]?.trim();
    return typeName || 'A-Frames';
  }
  return targetRow.label || 'Accommodation';
}

/**
 * Map OPS conflict evaluation to safe public DTOs (no IDs, guest names, or internal notes).
 */
function sanitizeLocationConflicts(evaluation, inventory) {
  const groups = new Map();

  for (const targetRow of evaluation.conflicts || []) {
    const accommodationLabel = resolvePublicAccommodationLabel(targetRow, inventory.targets);
    const primaryConflict = (targetRow.hardConflicts || [])[0];
    const reason = mapConflictReason(primaryConflict);
    const publicMessage = buildPublicMessage(reason, accommodationLabel);
    const key = accommodationLabel.toLowerCase();

    const existing = groups.get(key);
    if (!existing || (REASON_PRIORITY[reason] || 0) > (REASON_PRIORITY[existing.reason] || 0)) {
      groups.set(key, { accommodationLabel, reason, publicMessage });
    }
  }

  return Array.from(groups.values());
}

module.exports = {
  mapConflictReason,
  buildPublicMessage,
  sanitizeLocationConflicts
};
