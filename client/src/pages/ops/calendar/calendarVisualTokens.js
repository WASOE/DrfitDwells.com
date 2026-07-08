/**
 * Shared visual grammar: index preview + month grid (operational, not decorative).
 * Maps backend blockTypeToken / conflictToken to Tailwind classes.
 */

export const BLOCK_BAR = {
  reservation: 'bg-blue-600/90 text-white border-blue-800',
  manual_block: 'bg-amber-500/95 text-white border-amber-700',
  maintenance: 'bg-gray-800 text-white border-gray-950',
  external_hold: 'bg-violet-500/90 text-white border-violet-800'
};

export const BLOCK_DOT = {
  reservation: 'bg-blue-600',
  manual_block: 'bg-amber-500',
  maintenance: 'bg-gray-800',
  external_hold: 'bg-violet-500'
};

/** Index preview strip: empty day, conflict overrides */
export const PREVIEW_DOT_EMPTY = 'bg-gray-100';
export const PREVIEW_DOT_CONFLICT = 'bg-red-500';
export const PREVIEW_DOT_WARNING = 'bg-amber-400';
export const PREVIEW_DOT_SIZE = 'h-1.5 w-1.5';

/** Compact legend entries for OpsCalendarIndex (dot + label, no boxed pills). */
export const INDEX_LEGEND_ITEMS = [
  { key: 'reservation', label: 'Reservation', dot: BLOCK_DOT.reservation },
  { key: 'manual_block', label: 'Manual block', dot: BLOCK_DOT.manual_block },
  { key: 'maintenance', label: 'Maintenance', dot: BLOCK_DOT.maintenance },
  { key: 'external_hold', label: 'External hold', dot: BLOCK_DOT.external_hold },
  { key: 'conflict', label: 'Conflict', dot: PREVIEW_DOT_CONFLICT },
  { key: 'warning', label: 'Warning', dot: PREVIEW_DOT_WARNING }
];

export const CONFLICT_RING = {
  hard: 'ring-2 ring-red-500 ring-offset-1',
  warning: 'ring-2 ring-amber-400 ring-offset-1'
};

export const SYNC_BADGE = {
  healthy: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  warning: 'bg-amber-50 text-amber-900 border-amber-200',
  failed: 'bg-red-50 text-red-800 border-red-200',
  stale: 'bg-gray-100 text-gray-600 border-gray-200'
};

export function legendItems() {
  return [
    { key: 'reservation', label: 'Reservation', className: BLOCK_BAR.reservation },
    { key: 'manual_block', label: 'Manual block', className: BLOCK_BAR.manual_block },
    { key: 'maintenance', label: 'Maintenance', className: BLOCK_BAR.maintenance },
    { key: 'external_hold', label: 'External hold', className: BLOCK_BAR.external_hold },
    { key: 'conflict', label: 'Conflict / warning', className: 'border border-red-300 bg-red-50 text-red-800' }
  ];
}
