/**
 * Vite plugin: after build, inject modulepreload for Home + SiteLayout chunks
 * and preload for Inter / Playfair latin woff2 used at first paint.
 */
export function homepageCriticalPreloadsPlugin() {
  return {
    name: 'homepage-critical-preloads',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return html;

        const tags = [];

        const findChunk = (prefix) => {
          for (const fileName of Object.keys(bundle)) {
            const base = fileName.split('/').pop() || fileName;
            if (base.startsWith(prefix) && base.endsWith('.js')) {
              return fileName.startsWith('/') ? fileName : `/${fileName}`;
            }
          }
          return null;
        };

        const home = findChunk('Home-');
        const layout = findChunk('SiteLayout-');
        if (home) {
          tags.push({
            tag: 'link',
            attrs: { rel: 'modulepreload', crossorigin: true, href: home },
            injectTo: 'head'
          });
        }
        if (layout) {
          tags.push({
            tag: 'link',
            attrs: { rel: 'modulepreload', crossorigin: true, href: layout },
            injectTo: 'head'
          });
        }

        const findFont = (needle) => {
          for (const fileName of Object.keys(bundle)) {
            const base = fileName.split('/').pop() || fileName;
            if (base.includes(needle) && base.endsWith('.woff2')) {
              return fileName.startsWith('/') ? fileName : `/${fileName}`;
            }
          }
          return null;
        };

        // First-paint faces: body Inter 400 + hero Playfair 600 (semibold headlines).
        const inter = findFont('inter-latin-400-normal');
        const playfair = findFont('playfair-display-latin-600-normal');
        for (const href of [inter, playfair]) {
          if (!href) continue;
          tags.push({
            tag: 'link',
            attrs: {
              rel: 'preload',
              as: 'font',
              type: 'font/woff2',
              href,
              crossorigin: true
            },
            injectTo: 'head'
          });
        }

        return tags.length ? { html, tags } : html;
      }
    }
  };
}
