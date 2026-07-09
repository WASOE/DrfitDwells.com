const BED_LABELS = {
  double: 'double',
  single: 'single',
  bunk: 'bunk',
  sofa: 'sofa',
  queen: 'queen',
  king: 'king'
};

function normalizeBedRows(bedConfig) {
  if (!Array.isArray(bedConfig)) return [];
  return bedConfig
    .map((row) => ({
      bedType: row?.bedType || null,
      count: Number.isFinite(row?.count) ? row.count : null
    }))
    .filter((row) => row.bedType && row.count > 0);
}

/**
 * Human-readable beds line; falls back to capacity when bedConfig is empty.
 */
export function formatBedConfigSummary(bedConfig, capacity) {
  const beds = normalizeBedRows(bedConfig);
  if (beds.length === 0) {
    if (capacity > 0) {
      return `Up to ${capacity} guests`;
    }
    return null;
  }
  return beds
    .map((row) => {
      const label = BED_LABELS[row.bedType] || row.bedType;
      return `${row.count}× ${label}`;
    })
    .join(' · ');
}

export function resolveTargetSleeps(target) {
  if (!target) return 0;
  if (Number.isFinite(target.sleeps) && target.sleeps > 0) return target.sleeps;
  const capacity = Number(target.capacity) || 0;
  const unitCount = Number(target.unitCount) || 1;
  return capacity * unitCount;
}
