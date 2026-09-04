const LOCATION_KEY_LABELS = {
  valley: 'The Valley',
  cabin: 'The Cabin'
};

export function getLocationBlockGroupId(block) {
  const id = block?.locationBlockGroupId;
  if (!id) return null;
  const trimmed = String(id).trim();
  return trimmed || null;
}

export function isLocationWideManualBlock(block) {
  if (block?.blockType !== 'manual_block') return false;
  if (block.isLocationWideBlock) return true;
  return Boolean(getLocationBlockGroupId(block));
}

function baseBlockLabel(block) {
  if (isLocationWideManualBlock(block)) return 'Location-wide';
  return block?.render?.labelShort || block?.blockType || 'Block';
}

/**
 * Bar label: unit identity first when present so truncated bars still show the unit.
 */
export function blockDisplayLabel(block) {
  const base = baseBlockLabel(block);
  const unit = typeof block?.render?.unitLabel === 'string' ? block.render.unitLabel.trim() : '';
  if (!unit) return base;
  return `${unit} · ${base}`;
}

export function blockRangeTitle(block) {
  const s = String(block?.startDate || '').slice(0, 10);
  const e = String(block?.endDate || '').slice(0, 10);
  return `${s} → ${e} (exclusive end)`;
}

export function blockTooltip(block) {
  const dates = blockRangeTitle(block);
  if (isLocationWideManualBlock(block)) {
    const locLabel = LOCATION_KEY_LABELS[block.locationKey] || block.locationKey;
    const locPart = locLabel ? ` (${locLabel})` : '';
    return `Location-wide block${locPart} — blocks entire location — ${dates}`;
  }
  return `${blockDisplayLabel(block)} — ${dates}`;
}

export { LOCATION_KEY_LABELS };
