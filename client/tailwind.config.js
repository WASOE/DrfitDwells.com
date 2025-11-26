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
      },
      fontFamily: {
        'sans': ['Inter', 'system-ui', 'sans-serif'],
        'serif': ['Playfair Display', 'Georgia', 'serif'],
        'heading': ['Playfair Display', 'Georgia', 'serif'],
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
      }
    },
  },
  plugins: [],
}
