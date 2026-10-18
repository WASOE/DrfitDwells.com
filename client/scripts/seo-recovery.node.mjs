import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createSitemap, getPublicRouteUrls } from './generate-sitemap.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.resolve(SCRIPT_DIR, '..');
const DIST_DIR = path.join(CLIENT_DIR, 'dist');
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const { findBrowserExecutablePath } = require('./prerender-routes.cjs');
const routes = require('../src/data/publicSeoRoutes.json');
const expectedRoutes = routes.flatMap(({ path: route, locales }) => (
  locales.map((locale) => ({
    locale,
    path: locale === 'bg' ? `/bg${route === '/' ? '' : route}` : route
  }))
));

function trailingSlash(pathname) {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return normalized === '/' ? '/' : `${normalized}/`;
}

function parseDocument(route) {
  const filename = path.join(DIST_DIR, route.path.slice(1), 'index.html');
  assert.ok(fs.existsSync(filename), `Missing built HTML artifact: ${route.path}`);
  return new JSDOM(fs.readFileSync(filename, 'utf8')).window.document;
}

function readJsonLd(document, routePath) {
  return [...document.querySelectorAll('script[type="application/ld+json"]')].map((script) => {
    try {
      return JSON.parse(script.textContent);
    } catch (error) {
      throw new Error(`${routePath} contains malformed JSON-LD: ${error.message}`);
    }
  });
}

function assertImagePayload(filename, routePath) {
  const bytes = fs.readFileSync(filename);
  const extension = path.extname(filename).toLowerCase();
  const valid = extension === '.webp'
    ? bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      bytes.subarray(8, 12).toString('ascii') === 'WEBP'
    : extension === '.jpg' || extension === '.jpeg'
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : extension === '.png'
        ? bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        : false;
  assert.ok(valid, `${routePath} OG image is not a valid supported image payload: ${filename}`);
}

function collectTypes(value, types = new Set()) {
  if (!value || typeof value !== 'object') return types;
  if (Array.isArray(value)) {
    value.forEach((item) => collectTypes(item, types));
    return types;
  }
  const schemaType = value['@type'];
  if (Array.isArray(schemaType)) schemaType.forEach((type) => types.add(type));
  else if (schemaType) types.add(schemaType);
  Object.values(value).forEach((item) => collectTypes(item, types));
  return types;
}

test('compiled raw HTML contains complete route-specific multilingual metadata', () => {
  assert.ok(fs.existsSync(DIST_DIR), 'Run the normal production build before SEO regression tests.');
  assert.equal(expectedRoutes.length, 34, 'Update route coverage expectations when the public route registry changes.');
  const routePaths = expectedRoutes.map(({ path }) => path);
  for (const expected of [
    '/off-grid-cabins-bulgaria',
    '/bg/off-grid-cabins-bulgaria',
    '/digital-detox-bulgaria',
    '/bg/digital-detox-bulgaria',
    '/retreat-venue-bulgaria',
    '/bg/retreat-venue-bulgaria'
  ]) assert.ok(routePaths.includes(expected), `Missing approved editorial URL ${expected}`);
  assert.ok(!routePaths.includes('/off-grid-stays-bulgaria'));
  assert.ok(!routePaths.includes('/bg/off-grid-stays-bulgaria'));
  const defaultSiteUrl = 'https://driftdwells.com';

  for (const route of expectedRoutes) {
    const document = parseDocument(route);
    const canonicalPath = trailingSlash(route.path);
    const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
    const title = document.title.trim();
    const description = document.querySelector('meta[name="description"]')?.content?.trim();
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content?.trim();
    const ogDescription = document.querySelector('meta[property="og:description"]')?.content?.trim();
    const ogUrl = document.querySelector('meta[property="og:url"]')?.content?.trim();
    const ogImage = document.querySelector('meta[property="og:image"]')?.content?.trim();
    const twitterImage = document.querySelector('meta[name="twitter:image"]')?.content?.trim();
    const marker = document.querySelector('#root')?.getAttribute('data-prerender-route');

    assert.ok(title && title !== 'Drift & Dwells - Book Your Eco-Retreat', `${route.path} has a generic title`);
    assert.ok(description && description.length >= 40, `${route.path} has a missing or thin description`);
    assert.ok(ogTitle, `${route.path} is missing og:title`);
    assert.ok(ogDescription, `${route.path} is missing og:description`);
    assert.equal(ogUrl, canonical, `${route.path} has an inconsistent og:url`);
    assert.equal(canonical, `${defaultSiteUrl}${canonicalPath}`, `${route.path} has a non-canonical URL`);
    assert.ok(ogImage && new URL(ogImage).origin === defaultSiteUrl, `${route.path} needs an absolute same-site OG image`);
    const basePath = route.path === '/bg' ? '/' : route.path.startsWith('/bg/')
      ? route.path.slice(3)
      : route.path;
    const registryEntry = routes.find((entry) => entry.path === basePath);
    assert.ok(registryEntry?.ogImage, `${route.path} has no registry OG image`);
    assert.equal(ogImage, `${defaultSiteUrl}${registryEntry.ogImage}`, `${route.path} does not use its registry OG image`);
    const imagePath = decodeURIComponent(new URL(ogImage).pathname);
    const imageFile = path.resolve(DIST_DIR, `.${imagePath}`);
    assert.ok(imageFile.startsWith(`${DIST_DIR}${path.sep}`), `${route.path} OG image path escapes compiled output`);
    assert.ok(fs.existsSync(imageFile), `${route.path} OG image is missing from compiled output: ${imagePath}`);
    assertImagePayload(imageFile, route.path);
    assert.ok(document.querySelector('meta[property="og:image:alt"]')?.content?.trim(), `${route.path} needs image alt text`);
    assert.equal(document.querySelector('meta[name="twitter:card"]')?.content, 'summary_large_image');
    assert.equal(document.querySelector('meta[name="twitter:title"]')?.content, ogTitle);
    assert.equal(document.querySelector('meta[name="twitter:description"]')?.content, ogDescription);
    assert.equal(twitterImage, ogImage, `${route.path} has inconsistent Twitter and Open Graph images`);
    assert.equal(document.documentElement.lang, route.locale, `${route.path} has an incorrect document language`);
    assert.ok(!/noindex/i.test(document.querySelector('meta[name="robots"]')?.content || ''), `${route.path} is noindex`);
    assert.equal(marker, route.path, `${route.path} is not the matching prerendered document`);

    const expectedAlternates = [
      ...registryEntry.locales.map((locale) => ({
        locale,
        href: `${defaultSiteUrl}${trailingSlash(locale === 'bg'
          ? `/bg${basePath === '/' ? '' : basePath}`
          : basePath)}`
      })),
      {
        locale: 'x-default',
        href: `${defaultSiteUrl}${trailingSlash(basePath)}`
      }
    ];
    const alternates = [...document.querySelectorAll('link[rel="alternate"][hreflang]')]
      .map((link) => ({ locale: link.hreflang, href: link.href }));
    assert.deepEqual(alternates, expectedAlternates, `${route.path} has incomplete or incorrect hreflang alternates`);

    const mainText = document.querySelector('#root main')?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const expectedHeading = registryEntry.headings[route.locale];
    assert.ok(mainText.includes(expectedHeading), `${route.path} has no route-specific main heading`);
    readJsonLd(document, route.path);
  }
});

test('compiled registry social images decode as complete image payloads', async () => {
  const browserPath = findBrowserExecutablePath();
  assert.ok(browserPath, 'A Chromium executable is required to validate compiled social images.');
  const imagePaths = [...new Set(routes.map(({ ogImage }) => ogImage))];
  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    for (const imagePath of imagePaths) {
      const imageFile = path.resolve(DIST_DIR, `.${decodeURIComponent(imagePath)}`);
      assert.ok(imageFile.startsWith(`${DIST_DIR}${path.sep}`), `Social image path escapes compiled output: ${imagePath}`);
      assert.ok(fs.existsSync(imageFile), `Compiled social image is missing: ${imagePath}`);
      const extension = path.extname(imageFile).toLowerCase();
      const contentType = extension === '.webp' ? 'image/webp'
        : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg'
          : extension === '.png' ? 'image/png' : null;
      assert.ok(contentType, `Unsupported compiled social image format: ${imagePath}`);
      const dataUrl = `data:${contentType};base64,${fs.readFileSync(imageFile).toString('base64')}`;
      const dimensions = await page.evaluate(async (source) => {
        const image = new Image();
        image.src = source;
        await image.decode();
        return { width: image.naturalWidth, height: image.naturalHeight };
      }, dataUrl);
      assert.ok(dimensions.width > 0 && dimensions.height > 0, `Social image has invalid dimensions: ${imagePath}`);
    }
    await page.close();
  } finally {
    await browser.close();
  }
});

test('compiled JSON-LD uses supported, content-backed public schemas', () => {
  const requireTypes = (routePath, expectedTypes) => {
    const route = expectedRoutes.find((item) => item.path === routePath);
    const document = parseDocument(route);
    const schemas = readJsonLd(document, routePath);
    const types = collectTypes(schemas);
    for (const type of expectedTypes) {
      assert.ok(types.has(type), `${routePath} is missing ${type} JSON-LD`);
    }
    return { document, schemas, types };
  };

  requireTypes('/', ['WebSite', 'Organization']);
  requireTypes('/cabin', ['LodgingBusiness', 'BreadcrumbList']);
  requireTypes('/valley', ['LodgingBusiness', 'BreadcrumbList']);
  requireTypes('/retreats/the-valley', ['LodgingBusiness', 'BreadcrumbList']);

  for (const route of routes.filter((entry) => entry.stayId)) {
    for (const locale of route.locales) {
      const pathForLocale = locale === 'bg' ? `/bg${route.path}` : route.path;
      const { schemas, types } = requireTypes(pathForLocale, [
        'LodgingBusiness',
        'Accommodation',
        'BreadcrumbList'
      ]);
      assert.ok(
        !/(?:priceRange|aggregateRating|offers|reviewCount|ratingValue)/i.test(JSON.stringify(schemas)),
        `${pathForLocale} contains undated price or unsupported rating claims`
      );
      assert.equal(
        schemas.find((schema) => schema['@type']?.includes?.('Accommodation'))?.url,
        `https://driftdwells.com${trailingSlash(pathForLocale)}`
      );
      assert.ok(types.has('Accommodation'));
    }
  }

  const faq = requireTypes('/cabin/faq', ['FAQPage']);
  const faqSchema = faq.schemas.find((schema) => schema['@type'] === 'FAQPage');
  const visibleText = faq.document.querySelector('#root main')?.textContent?.replace(/\s+/g, ' ').trim() || '';
  assert.ok(Array.isArray(faqSchema?.mainEntity) && faqSchema.mainEntity.length > 0);
  for (const question of faqSchema.mainEntity) {
    assert.ok(visibleText.includes(question.name), `FAQ question is not visible: ${question.name}`);
    assert.ok(question.acceptedAnswer?.text?.trim(), `FAQ answer is empty: ${question.name}`);
  }

  const winter = requireTypes('/winter-village', []);
  assert.ok(
    !winter.types.has('Event'),
    'Do not assert tentative Winter Village preview dates as confirmed events; add Event JSON-LD only after confirmation.'
  );
});

test('generated sitemap exactly covers indexable registry routes and excludes noindex surfaces', () => {
  const expectedUrls = getPublicRouteUrls(routes);
  const sourceSitemap = fs.readFileSync(path.join(CLIENT_DIR, 'public/sitemap.xml'), 'utf8');
  const builtSitemap = fs.readFileSync(path.join(DIST_DIR, 'sitemap.xml'), 'utf8');
  assert.equal(sourceSitemap, createSitemap(routes));
  assert.equal(builtSitemap, sourceSitemap, 'Vite output did not preserve the generated sitemap.');
  const listedUrls = [...builtSitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
  assert.deepEqual(listedUrls, expectedUrls);
  assert.equal(new Set(listedUrls).size, expectedUrls.length);
  assert.ok(listedUrls.every((url) => new URL(url).pathname === trailingSlash(new URL(url).pathname)));

  for (const excluded of [
    '/build/',
    '/bg/about/',
    '/bg/cabin/faq/',
    '/terms/',
    '/search/',
    '/login/'
  ]) {
    assert.ok(!listedUrls.some((url) => new URL(url).pathname === excluded), `${excluded} must not be in the sitemap`);
  }

  const robots = fs.readFileSync(path.join(CLIENT_DIR, 'public/robots.txt'), 'utf8');
  assert.equal((robots.match(/^Sitemap:/gm) || []).length, 1, 'robots.txt should advertise one sitemap.');
  assert.match(robots, /^Sitemap: https:\/\/driftdwells\.com\/sitemap\.xml$/m);
});

test('Apache SEO redirects preserve legacy mappings and serve nested prerendered routes', () => {
  const htaccess = fs.readFileSync(path.join(CLIENT_DIR, 'public/.htaccess'), 'utf8');
  for (const [from, to] of [
    ['off-grid-stays-bulgaria', '/off-grid-cabins-bulgaria/'],
    ['bg/off-grid-stays-bulgaria', '/bg/off-grid-cabins-bulgaria/'],
    ['cabin/69b2ff933a7fff6621e785cc', '/stays/the-cabin'],
    ['cabin/69b2ff947f141a71ffa7c492', '/stays/lux-cabin'],
    ['bg/cabin/69b2ff933a7fff6621e785cc', '/bg/stays/the-cabin'],
    ['bg/cabin/69b2ff947f141a71ffa7c492', '/bg/stays/lux-cabin']
  ]) {
    assert.ok(
      htaccess.includes(`RewriteRule ^${from}/?$ ${to} [R=301,L,QSA]`),
      `Missing permanent legacy redirect from ${from}`
    );
  }
  assert.match(htaccess, /RewriteCond %\{REQUEST_FILENAME\} !-f/);
  assert.match(htaccess, /RewriteCond %\{REQUEST_FILENAME\} !-d/);
  assert.ok(htaccess.includes('RewriteCond %{REQUEST_URI} !\\.[a-zA-Z0-9]{2,8}$'));
  assert.match(htaccess, /RewriteCond %\{REQUEST_URI\} !\^\/api\//);
});
