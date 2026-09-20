/**
 * Canonical Ops token names from DND_OPS_DESIGN_LANGUAGE_GUIDE_V1_2_LOCKED.md.
 * Values live in client/src/ops/ops.css. This module is the name list for tests
 * and Tailwind mapping — not a second color palette.
 */

export const OPS_COLOR_TOKEN_NAMES = [
  '--ops-canvas',
  '--ops-surface',
  '--ops-surface-subtle',
  '--ops-surface-elevated',
  '--ops-border',
  '--ops-border-strong',
  '--ops-text',
  '--ops-text-secondary',
  '--ops-text-muted',
  '--ops-text-disabled',
  '--ops-border-control',
  '--ops-focus',
  '--ops-accent',
  '--ops-accent-hover',
  '--ops-accent-soft',
  '--ops-accent-border',
  '--ops-accent-fg',
  '--ops-success',
  '--ops-success-soft',
  '--ops-warning',
  '--ops-warning-soft',
  '--ops-danger',
  '--ops-danger-soft',
  '--ops-info',
  '--ops-info-soft',
  '--ops-scrim'
];

/** Locked light values (guide §4.1, §4.5). */
export const OPS_LIGHT_COLOR_VALUES = {
  '--ops-canvas': '#F7F8F6',
  '--ops-surface': '#FFFFFF',
  '--ops-surface-subtle': '#F2F4F1',
  '--ops-surface-elevated': '#FFFFFF',
  '--ops-border': '#E1E5DF',
  '--ops-border-strong': '#CDD3CB',
  '--ops-text': '#171A17',
  '--ops-text-secondary': '#59615A',
  '--ops-text-muted': '#666D67',
  '--ops-text-disabled': '#9AA198',
  '--ops-border-control': '#858C82',
  '--ops-focus': '#3F4A3A',
  '--ops-accent': '#62695C',
  '--ops-accent-hover': '#52584D',
  '--ops-accent-soft': '#EEF1EB',
  '--ops-accent-border': '#BFC6B9',
  '--ops-accent-fg': '#FFFFFF',
  '--ops-success': '#1F7A4D',
  '--ops-success-soft': '#EDF8F1',
  '--ops-warning': '#9A5B00',
  '--ops-warning-soft': '#FFF7E8',
  '--ops-danger': '#B42318',
  '--ops-danger-soft': '#FEF3F2',
  '--ops-info': '#175CD3',
  '--ops-info-soft': '#EFF6FF',
  '--ops-scrim': 'rgba(23, 26, 23, 0.32)'
};

/** Locked dark values (guide §4.9). Scrim is defined once in §4.5 and is shared. */
export const OPS_DARK_COLOR_VALUES = {
  '--ops-canvas': '#0F1110',
  '--ops-surface': '#151815',
  '--ops-surface-subtle': '#1B1F1B',
  '--ops-surface-elevated': '#202420',
  '--ops-border': '#2C322C',
  '--ops-border-strong': '#3A423A',
  '--ops-text': '#F3F5F2',
  '--ops-text-secondary': '#C7CDC6',
  '--ops-text-muted': '#AAB2A9',
  '--ops-text-disabled': '#6F776F',
  '--ops-border-control': '#7E897D',
  '--ops-focus': '#D2DBC8',
  '--ops-accent': '#A4AE99',
  '--ops-accent-hover': '#B2BBA8',
  '--ops-accent-soft': '#252B23',
  '--ops-accent-border': '#6F7B68',
  '--ops-accent-fg': '#171A17',
  '--ops-success': '#5AC58A',
  '--ops-success-soft': '#173223',
  '--ops-warning': '#E5A94F',
  '--ops-warning-soft': '#332817',
  '--ops-danger': '#F27A72',
  '--ops-danger-soft': '#381B1B',
  '--ops-info': '#6FA9FF',
  '--ops-info-soft': '#172A42',
  '--ops-scrim': 'rgba(23, 26, 23, 0.32)'
};

/** Non-color tokens shared by both appearances (guide §4.3–4.8). */
export const OPS_SHARED_TOKEN_VALUES = {
  '--ops-space-4': '4px',
  '--ops-space-8': '8px',
  '--ops-space-12': '12px',
  '--ops-space-16': '16px',
  '--ops-space-24': '24px',
  '--ops-space-32': '32px',
  '--ops-space-48': '48px',
  '--ops-radius-control': '6px',
  '--ops-radius-surface': '8px',
  '--ops-shadow-overlay': '0 4px 12px rgba(23, 26, 23, 0.08), 0 1px 3px rgba(23, 26, 23, 0.06)',
  '--ops-shadow-modal': '0 12px 32px rgba(23, 26, 23, 0.12), 0 2px 6px rgba(23, 26, 23, 0.08)',
  '--ops-control-h-compact': '32px',
  '--ops-control-h': '36px',
  '--ops-control-h-touch': '44px',
  '--ops-row-h': '40px',
  '--ops-row-h-compact': '32px',
  '--ops-row-min-mobile': '56px',
  '--ops-topbar-h': '48px',
  '--ops-bottomnav-h': '56px',
  '--ops-sidebar-w': '240px',
  '--ops-sidebar-w-collapsed': '56px',
  '--ops-z-sticky': '10',
  '--ops-z-nav': '20',
  '--ops-z-dropdown': '30',
  '--ops-z-overlay': '40',
  '--ops-z-modal': '50',
  '--ops-z-toast': '60',
  '--ops-bp-md': '768px',
  '--ops-bp-lg': '1024px',
  '--ops-page-w-narrow': '720px',
  '--ops-page-w-default': '1040px',
  '--ops-page-w-wide': '1360px'
};

export const OPS_SHARED_TOKEN_NAMES = Object.keys(OPS_SHARED_TOKEN_VALUES);
