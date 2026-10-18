import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT = path.resolve(SCRIPT_DIR, '../public/sitemap.xml');
const DEFAULT_SITE_URL = 'https://driftdwells.com';
const require = createRequire(import.meta.url);
const routes = require('../src/data/publicSeoRoutes.json');

export function getPublicRouteUrls(routeRegistry = routes, siteUrl = DEFAULT_SITE_URL) {
  const parsedSiteUrl = new URL(siteUrl);
  if (!['http:', 'https:'].includes(parsedSiteUrl.protocol)) {
    throw new Error(`Unsupported sitemap site URL protocol: ${parsedSiteUrl.protocol}`);
  }
  const origin = parsedSiteUrl.origin;
  const seenPaths = new Set();
  const urls = [];

  for (const route of routeRegistry) {
    if (!route || typeof route.path !== 'string' || !route.path.startsWith('/')) {
      throw new Error('Every public SEO route must have an absolute path.');
    }
    if (route.path !== '/' && route.path.endsWith('/')) {
      throw new Error(`Public SEO registry paths must omit trailing slashes: ${route.path}`);
    }
    if (!Array.isArray(route.locales) || route.locales.length === 0) {
      throw new Error(`Public SEO route has no supported locales: ${route.path}`);
    }

    for (const locale of route.locales) {
      if (!['en', 'bg'].includes(locale)) {
        throw new Error(`Unsupported public SEO locale "${locale}" for ${route.path}`);
      }
      const localizedPath = locale === 'bg'
        ? `/bg${route.path === '/' ? '' : route.path}`
        : route.path;
      const canonicalPath = localizedPath === '/'
        ? '/'
        : `${localizedPath.replace(/\/+$/, '')}/`;
      if (seenPaths.has(canonicalPath)) {
        throw new Error(`Duplicate public SEO route in sitemap: ${canonicalPath}`);
      }
      seenPaths.add(canonicalPath);
      urls.push(new URL(canonicalPath, `${origin}/`).href);
    }
  }

  return urls;
}

export function createSitemap(routeRegistry = routes, siteUrl = DEFAULT_SITE_URL) {
  const locations = getPublicRouteUrls(routeRegistry, siteUrl)
    .map((url) => `  <url><loc>${url.replace(/&/g, '&amp;')}</loc></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locations}\n</urlset>\n`;
}

async function main() {
  const outputPath = path.resolve(process.argv[2] || DEFAULT_OUTPUT);
  const xml = createSitemap(routes, process.env.VITE_SITE_URL || DEFAULT_SITE_URL);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, xml, 'utf8');
  console.log(`[sitemap] Wrote ${getPublicRouteUrls(routes, process.env.VITE_SITE_URL || DEFAULT_SITE_URL).length} indexable URLs to ${outputPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error('[sitemap] Failed to generate the public sitemap.');
    console.error(error);
    process.exitCode = 1;
  });
}
