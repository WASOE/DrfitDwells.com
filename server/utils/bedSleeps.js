'use strict';

/**
 * Bed-type → guest sleeps for whole-location quotes and inventory display.
 * Falls back to capacity only when bedConfig is empty.
 */

const SLEEPS_PER_BED_TYPE = Object.freeze({
  single: 1,
  twin: 1,
  double: 2,
  queen: 2,
  king: 2,
  sofa_bed: 1,
  bunk: 2
});

function normalizeBedConfig(bedConfig) {
  const rows = Array.isArray(bedConfig) ? bedConfig : [];
  return rows
    .map((row) => ({
      bedType: row?.bedType || null,
      count: Number.isFinite(row?.count) ? row.count : null
    }))
    .filter((row) => row.bedType && row.count > 0);
}

function sleepsPerBedType(bedType) {
  const key = String(bedType || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (key === 'sofa') return 1;
  return SLEEPS_PER_BED_TYPE[key] ?? 1;
}

function resolveSleepsFromBedConfig(bedConfig, fallbackCapacity = 0) {
  const beds = normalizeBedConfig(bedConfig);
  if (beds.length > 0) {
    return beds.reduce((sum, row) => sum + row.count * sleepsPerBedType(row.bedType), 0);
  }
  return Math.max(0, Number(fallbackCapacity) || 0);
}

module.exports = {
  SLEEPS_PER_BED_TYPE,
  normalizeBedConfig,
  sleepsPerBedType,
  resolveSleepsFromBedConfig
};
