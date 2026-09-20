/**
 * Shared visual grammar: index preview + month grid (operational, not decorative).
 * Maps backend blockTypeToken / conflictToken to OpsCalendar.css class names.
 */

export const BLOCK_BAR = {
  reservation: 'ops-cal-bar ops-cal-bar--reservation',
  manual_block: 'ops-cal-bar ops-cal-bar--manual',
  maintenance: 'ops-cal-bar ops-cal-bar--maintenance',
  external_hold: 'ops-cal-bar ops-cal-bar--external'
};

export const BLOCK_DOT = {
  reservation: 'ops-cal-dot ops-cal-dot--reservation',
  manual_block: 'ops-cal-dot ops-cal-dot--manual',
  maintenance: 'ops-cal-dot ops-cal-dot--maintenance',
  external_hold: 'ops-cal-dot ops-cal-dot--external'
};

/** Index preview strip: empty day, conflict overrides */
export const PREVIEW_DOT_EMPTY = 'ops-cal-dot ops-cal-dot--empty';
export const PREVIEW_DOT_CONFLICT = 'ops-cal-dot ops-cal-dot--conflict';
export const PREVIEW_DOT_WARNING = 'ops-cal-dot ops-cal-dot--warning';
export const PREVIEW_DOT_SIZE = 'ops-cal-dot';

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
  hard: 'ops-cal-ring ops-cal-ring--conflict',
  warning: 'ops-cal-ring ops-cal-ring--warning'
};

export const SYNC_BADGE = {
  healthy: 'ops-cal-sync ops-cal-sync--healthy',
  warning: 'ops-cal-sync ops-cal-sync--warning',
  failed: 'ops-cal-sync ops-cal-sync--failed',
  stale: 'ops-cal-sync ops-cal-sync--stale'
};

export function legendItems() {
  return [
    { key: 'reservation', label: 'Reservation', className: BLOCK_BAR.reservation },
    { key: 'manual_block', label: 'Manual block', className: BLOCK_BAR.manual_block },
    { key: 'maintenance', label: 'Maintenance', className: BLOCK_BAR.maintenance },
    { key: 'external_hold', label: 'External hold', className: BLOCK_BAR.external_hold },
    {
      key: 'conflict',
      label: 'Conflict / warning',
      className: 'ops-cal-legend-pill ops-cal-legend-pill--conflict'
    }
  ];
}
