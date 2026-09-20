/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'sage': '#81887A',
        'sage-light': '#9BA68F',
        'sage-dark': '#6B6B6B',
        // Legacy colors for backward compatibility
        'drift-primary': '#81887A',
        'drift-bg': '#FAFAF9',
        'drift-text': '#1A1A1A',
        'drift-muted': '#6B7280',
        'drift-highlight': '#E8E8E6',
        'drift-green': '#81887A',
        'drift-light-green': '#9BA68F',
        // Ops semantic tokens — CSS variables are the source of truth (ops.css).
        ops: {
          canvas: 'var(--ops-canvas)',
          surface: 'var(--ops-surface)',
          'surface-subtle': 'var(--ops-surface-subtle)',
          'surface-elevated': 'var(--ops-surface-elevated)',
          border: 'var(--ops-border)',
          'border-strong': 'var(--ops-border-strong)',
          'border-control': 'var(--ops-border-control)',
          text: 'var(--ops-text)',
          'text-secondary': 'var(--ops-text-secondary)',
          'text-muted': 'var(--ops-text-muted)',
          'text-disabled': 'var(--ops-text-disabled)',
          focus: 'var(--ops-focus)',
          accent: 'var(--ops-accent)',
          'accent-hover': 'var(--ops-accent-hover)',
          'accent-soft': 'var(--ops-accent-soft)',
          'accent-border': 'var(--ops-accent-border)',
          'accent-fg': 'var(--ops-accent-fg)',
          success: 'var(--ops-success)',
          'success-soft': 'var(--ops-success-soft)',
          warning: 'var(--ops-warning)',
          'warning-soft': 'var(--ops-warning-soft)',
          danger: 'var(--ops-danger)',
          'danger-soft': 'var(--ops-danger-soft)',
          info: 'var(--ops-info)',
          'info-soft': 'var(--ops-info-soft)',
          scrim: 'var(--ops-scrim)',
        },
      },
      spacing: {
        'ops-4': 'var(--ops-space-4)',
        'ops-8': 'var(--ops-space-8)',
        'ops-12': 'var(--ops-space-12)',
        'ops-16': 'var(--ops-space-16)',
        'ops-24': 'var(--ops-space-24)',
        'ops-32': 'var(--ops-space-32)',
        'ops-48': 'var(--ops-space-48)',
      },
      borderRadius: {
        'ops-control': 'var(--ops-radius-control)',
        'ops-surface': 'var(--ops-radius-surface)',
      },
      boxShadow: {
        'ops-overlay': 'var(--ops-shadow-overlay)',
        'ops-modal': 'var(--ops-shadow-modal)',
      },
      height: {
        'ops-control-compact': 'var(--ops-control-h-compact)',
        'ops-control': 'var(--ops-control-h)',
        'ops-control-touch': 'var(--ops-control-h-touch)',
        'ops-row': 'var(--ops-row-h)',
        'ops-row-compact': 'var(--ops-row-h-compact)',
        'ops-row-min-mobile': 'var(--ops-row-min-mobile)',
        'ops-topbar': 'var(--ops-topbar-h)',
        'ops-bottomnav': 'var(--ops-bottomnav-h)',
      },
      minHeight: {
        'ops-row-min-mobile': 'var(--ops-row-min-mobile)',
      },
      width: {
        'ops-sidebar': 'var(--ops-sidebar-w)',
        'ops-sidebar-collapsed': 'var(--ops-sidebar-w-collapsed)',
      },
      zIndex: {
        'ops-sticky': 'var(--ops-z-sticky)',
        'ops-nav': 'var(--ops-z-nav)',
        'ops-dropdown': 'var(--ops-z-dropdown)',
        'ops-overlay': 'var(--ops-z-overlay)',
        'ops-modal': 'var(--ops-z-modal)',
        'ops-toast': 'var(--ops-z-toast)',
      },
      fontFamily: {
        'sans': ['Inter', 'system-ui', 'sans-serif'],
        'serif': ['Playfair Display', 'Georgia', 'serif'],
        'heading': ['Playfair Display', 'Georgia', 'serif'],
        'script': ['Caveat', 'cursive'],
      },
      fontSize: {
        'editorial-xl': ['5rem', { lineHeight: '1.1', letterSpacing: '0.02em' }],
        'editorial-lg': ['4rem', { lineHeight: '1.1', letterSpacing: '0.02em' }],
        'editorial-md': ['3rem', { lineHeight: '1.2', letterSpacing: '0.02em' }],
        'editorial-sm': ['2.5rem', { lineHeight: '1.2', letterSpacing: '0.02em' }],
      },
      letterSpacing: {
        'editorial': '0.05em',
        'wide': '0.1em',
        'wider': '0.15em',
      },
      keyframes: {
        headerVeil: {
          from: { opacity: '0' },
          to: { opacity: '1' }
        },
        headerNavIn: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        }
      },
      animation: {
        'header-veil': 'headerVeil 0.28s ease-out both',
        'header-nav-in': 'headerNavIn 0.4s ease-out both'
      }
    },
  },
  plugins: [],
}
