import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import clientConfig from '../vite.config.js';
import contract from './prerender-contract.cjs';
import prerender from './prerender-routes.cjs';

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(clientDir, '.seo-verification/dist');

// Reuse development-compatible configuration, but compile/minify real bundles.
// The production entry point and its Stripe build guard remain unchanged.
const config = clientConfig({ command: 'serve', mode: 'seo-verification' });
await build({
  ...config,
  configFile: false,
  root: clientDir,
  mode: 'seo-verification',
  envDir: false,
  envPrefix: 'SEO_VERIFICATION_UNUSED_',
  define: { 'import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY': JSON.stringify('') },
  build: { ...config.build, outDir: distDir, emptyOutDir: true },
  plugins: [
    ...config.plugins,
    {
      name: 'non-publishable-seo-verification',
      transformIndexHtml() {
        return [{ tag: 'meta', attrs: { name: contract.VERIFICATION_MARKER, content: 'not-for-publication' }, injectTo: 'head' }];
      },
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: `${contract.VERIFICATION_MARKER}.json`,
          source: JSON.stringify({ purpose: 'SEO verification only; payments unavailable; do not publish' })
        });
      }
    }
  ]
});
await prerender.run({ distDir });
console.log('[seo-verification] Compiled and prerendered 36 routes. NOT a publishable production build.');
