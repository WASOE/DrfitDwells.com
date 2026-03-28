import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [],
      manifest: {
        name: 'Drift & Dwells',
        short_name: 'Drift & Dwells',
        theme_color: '#1a1a1a',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        lang: 'en'
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,json,geojson,gpx,kml,webmanifest}'],
        globIgnores: [
          '**/assets/jspdf*.js',
          '**/assets/html2canvas*.js',
          '**/assets/Ops*.js',
          '**/assets/Maintenance*.js',
          '**/assets/AdminLogin*.js',
          '**/assets/CabinEdit*.js',
          '**/assets/ReviewEdit*.js',
          '**/assets/BookingsList*.js',
          '**/assets/BookingDetail*.js',
          '**/assets/CabinTypesList*.js',
          '**/assets/CabinTypeEdit*.js',
          '**/assets/ReviewsList*.js'
        ],
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/guides/the-cabin/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'cabin-arrival-assets',
              expiration: { maxEntries: 48, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          }
        ]
      }
    })
  ],
  // react-helmet-async ships ESM that default-imports `invariant` (pure CJS).
  // Without pre-bundling, the browser loads invariant/browser.js and throws
  // "does not provide an export named 'default'".
  optimizeDeps: {
    include: ['react-helmet-async', 'invariant', 'shallowequal', 'prop-types', 'react-fast-compare']
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true
      },
      '/uploads': {
        target: 'http://localhost:5000',
        changeOrigin: true
      }
    }
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    modulePreload: {
      resolveDependencies: (filename, deps) =>
        deps.filter(
          (d) =>
            !d.includes('datepicker') &&
            !d.includes('DayPicker') &&
            !d.includes('jspdf') &&
            !d.includes('html2canvas') &&
            !d.includes('/motion-') &&
            !d.includes('framer-motion')
        )
    },
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom']
          // Avoid forcing framer-motion / react-datepicker into named chunks that Rollup
          // can incorrectly associate with the entry preface (keeps main thread parse smaller).
        }
      }
    }
  }
});
