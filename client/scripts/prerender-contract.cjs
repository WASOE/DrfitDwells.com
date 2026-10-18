const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const registry = require('../src/data/publicSeoRoutes.json');

const ROUTES = registry.flatMap(({ path: route, locales }) =>
  locales.map((locale) => locale === 'en' ? route : `/bg${route === '/' ? '' : route}`)
);
const DEFAULT_TITLE = 'Drift & Dwells - Book Your Eco-Retreat';
const VERIFICATION_MARKER = 'seo-verification-only';

function assertProductionArtifacts(distDir) {
  if (fs.existsSync(path.join(distDir, `${VERIFICATION_MARKER}.json`)) ||
      ROUTES.some((route) => {
        const file = artifactPath(distDir, route);
        return fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(VERIFICATION_MARKER);
      })) {
    throw new Error('SEO verification-only artifacts must never be published. Run the authorized production build.');
  }
}

function routeDefinition(route) {
  if (!ROUTES.includes(route)) throw new Error(`Ineligible prerender route: ${route}`);
  const locale = route === '/bg' || route.startsWith('/bg/') ? 'bg' : 'en';
  const basePath = locale === 'bg' ? route.slice(3) || '/' : route;
  return { entry: registry.find((entry) => entry.path === basePath), locale };
}

function getExpectedHeading(route) {
  const { entry, locale } = routeDefinition(route);
  return entry.headings[locale];
}

function getExpectedVisibleHeadings(route) {
  const { entry, locale } = routeDefinition(route);
  return [entry.headings[locale], ...(entry.visibleHeadings?.[locale] || [])];
}

function publicCanonicalPath(route) {
  return route === '/' ? '/' : `${route.replace(/\/+$/, '')}/`;
}

function localizedRoutePath(routePath, locale) {
  const localized = locale === 'bg'
    ? `/bg${routePath === '/' ? '' : routePath}`
    : routePath;
  return publicCanonicalPath(localized);
}

function getSeoValidationContext(route) {
  const { entry, locale } = routeDefinition(route);
  const requiredSchemaTypes = entry.path === '/'
    ? ['WebSite', 'Organization']
    : entry.path === '/cabin' || entry.path === '/valley' || entry.path === '/retreats/the-valley'
      ? ['LodgingBusiness', 'BreadcrumbList']
      : entry.path === '/cabin/faq'
        ? ['FAQPage']
        : entry.stayId
          ? ['LodgingBusiness', 'Accommodation', 'BreadcrumbList']
          : ['/off-grid-stays-bulgaria', '/digital-detox-bulgaria', '/retreat-venue-bulgaria'].includes(entry.path)
            ? ['WebPage', 'BreadcrumbList']
            : [];

  return {
    entry,
    locale,
    canonicalPath: publicCanonicalPath(route),
    alternatePaths: [
      ...entry.locales.map((alternateLocale) => ({
        hreflang: alternateLocale,
        path: localizedRoutePath(entry.path, alternateLocale)
      })),
      { hreflang: 'x-default', path: localizedRoutePath(entry.path, 'en') }
    ],
    requiredSchemaTypes
  };
}

function artifactPath(distDir, route) {
  if (!ROUTES.includes(route)) throw new Error(`Ineligible prerender route: ${route}`);
  return path.join(distDir, route.slice(1), 'index.html');
}

function inspectDocument(document, route, expectedHeading, seoContext) {
  const fail = (reason) => { throw new Error(`[prerender] ${route}: ${reason}`); };
  const { entry, locale, canonicalPath, alternatePaths, requiredSchemaTypes } = seoContext;
  const title = document.title.trim();
  const description = document.querySelector('meta[name="description"]')?.content?.trim();
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
  const main = document.querySelector('#root main')?.cloneNode(true);
  main?.querySelectorAll('script, style, noscript, template').forEach((node) => node.remove());
  const heading = main?.querySelector('h1')?.textContent?.trim();
  const text = main?.textContent?.replace(/\s+/g, ' ').trim() || '';
  if (!title || title === 'Drift & Dwells - Book Your Eco-Retreat' || title === 'Drift & Dwells') fail('generic or missing title');
  if (!description || description.length < 40) fail('missing meaningful description');
  if (!canonical || new URL(canonical).pathname !== canonicalPath) {
    fail('head does not identify this route');
  }
  if (document.documentElement.lang !== locale) fail('incorrect document locale');
  if (document.querySelector('meta[name="robots"]')?.content?.includes('noindex')) fail('noindex route');
  const ogTitle = document.querySelector('meta[property="og:title"]')?.content?.trim();
  const ogDescription = document.querySelector('meta[property="og:description"]')?.content?.trim();
  const ogUrl = document.querySelector('meta[property="og:url"]')?.content?.trim();
  const ogImage = document.querySelector('meta[property="og:image"]')?.content?.trim();
  const twitterCard = document.querySelector('meta[name="twitter:card"]')?.content?.trim();
  if (!ogTitle || !ogDescription || ogUrl !== canonical || !ogImage ||
      document.querySelector('meta[property="og:image:alt"]')?.content?.trim() !== ogTitle) {
    fail('missing or inconsistent Open Graph metadata');
  }
  if (new URL(ogImage).origin !== new URL(canonical).origin) fail('Open Graph image must be an absolute same-site URL');
  if (twitterCard !== 'summary_large_image' ||
      document.querySelector('meta[name="twitter:title"]')?.content?.trim() !== ogTitle ||
      document.querySelector('meta[name="twitter:description"]')?.content?.trim() !== ogDescription ||
      document.querySelector('meta[name="twitter:image"]')?.content?.trim() !== ogImage) {
    fail('missing or inconsistent Twitter metadata');
  }
  const canonicalOrigin = new URL(canonical).origin;
  const expectedAlternates = alternatePaths.map(({ hreflang, path: alternatePath }) => ({
    hreflang,
    href: `${canonicalOrigin}${alternatePath}`
  }));
  const alternates = [...document.querySelectorAll('link[rel="alternate"][hreflang]')]
    .map((link) => ({ hreflang: link.hreflang, href: link.href }));
  if (JSON.stringify(alternates) !== JSON.stringify(expectedAlternates)) {
    fail('missing or incorrect EN/BG hreflang alternates');
  }
  if (!heading || heading.length < 3 || text.length < 180) fail('empty, generic or loading-only main content');
  if ([...main.querySelectorAll('h1')].every((node) => node.style.opacity !== '' && Number(node.style.opacity) === 0)) {
    fail('heading hidden in serialized HTML');
  }
  if (!expectedHeading || !heading.replace(/\s+/g, ' ').includes(expectedHeading)) fail('main content does not identify this route');
  if (/page not found|something went wrong/i.test(text)) fail('error page');
  const schemas = [...document.querySelectorAll('script[type="application/ld+json"]')].map((script) => {
    try {
      return JSON.parse(script.textContent);
    } catch (error) {
      fail(`invalid JSON-LD (${error.message})`);
    }
  });
  const types = new Set();
  const collectTypes = (value) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(collectTypes);
      return;
    }
    if (Array.isArray(value['@type'])) value['@type'].forEach((type) => types.add(type));
    else if (value['@type']) types.add(value['@type']);
    Object.values(value).forEach(collectTypes);
  };
  collectTypes(schemas);
  for (const type of requiredSchemaTypes) {
    if (!types.has(type)) fail(`missing ${type} JSON-LD`);
  }
  if (entry.stayId &&
      /"(?:priceRange|aggregateRating|offers|reviewCount|ratingValue)"\s*:/i.test(JSON.stringify(schemas))) {
    fail('lodging JSON-LD must not assert undated prices or ratings');
  }
  if (entry.path === '/winter-village' && types.has('Event')) {
    fail('preview dates are tentative and must not be marked as scheduled events');
  }
  if (entry.path === '/cabin/faq') {
    const faqSchema = schemas.find((schema) => schema['@type'] === 'FAQPage');
    const visibleText = main?.textContent?.replace(/\s+/g, ' ').trim() || '';
    if (!Array.isArray(faqSchema?.mainEntity) || faqSchema.mainEntity.length === 0 ||
        faqSchema.mainEntity.some((item) => !item.name || !visibleText.includes(item.name) || !item.acceptedAnswer?.text)) {
      fail('FAQ JSON-LD must describe non-empty questions and answers visible on the page');
    }
  }
  return { route, title, heading, contentLength: text.length, locale };
}

async function inspectVisibleHeading(document, expectedHeadings, settle = false) {
  const expected = Array.isArray(expectedHeadings) ? expectedHeadings : [expectedHeadings];
  const isVisible = () => [...document.querySelectorAll('#root main h1')].some((heading) => {
    if (!expected.some((text) => heading.textContent.replace(/\s+/g, ' ').includes(text)) || !heading.getClientRects().length) return false;
    for (let element = heading; element; element = element.parentElement) {
      const style = document.defaultView.getComputedStyle(element);
      if (Number(style.opacity) < 0.95 || style.display === 'none' || style.visibility === 'hidden' ||
          (element.style.opacity !== '' && Number(element.style.opacity) < 0.95)) return false;
    }
    return true;
  });
  if (settle) {
    const deadline = document.defaultView.performance.now() + 15000;
    while (!isVisible() && document.defaultView.performance.now() < deadline) {
      await new Promise((resolve) => document.defaultView.requestAnimationFrame(resolve));
    }
  }
  if (!isVisible()) {
    const details = [...document.querySelectorAll('#root main h1')].map((heading) => {
      const blocked = [];
      for (let element = heading; element; element = element.parentElement) {
        const style = document.defaultView.getComputedStyle(element);
        if (Number(style.opacity) < 0.95 || style.display === 'none' || style.visibility === 'hidden' ||
            (element.style.opacity !== '' && Number(element.style.opacity) < 0.95)) {
          blocked.push({ tag: element.tagName, opacity: style.opacity, inlineOpacity: element.style.opacity, display: style.display, visibility: style.visibility });
        }
      }
      return { text: heading.textContent, geometry: heading.getClientRects().length, blocked };
    });
    throw new Error(`[prerender] ${document.location.pathname}: Expected heading ${JSON.stringify(expected)} is not visible without JavaScript: ${JSON.stringify(details)}`);
  }
}

function validateHtml(html, route) {
  const dom = new JSDOM(html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ''));
  try {
    const result = inspectDocument(dom.window.document, route, getExpectedHeading(route), getSeoValidationContext(route));
    if (dom.window.document.querySelector('#root')?.getAttribute('data-prerender-route') !== route) {
      throw new Error(`[prerender] ${route}: missing route capture marker`);
    }
    return result;
  } finally {
    dom.window.close();
  }
}

function validateArtifacts(distDir) {
  return ROUTES.map((route) => validateHtml(fs.readFileSync(artifactPath(distDir, route), 'utf8'), route));
}

module.exports = { ROUTES, DEFAULT_TITLE, VERIFICATION_MARKER, assertProductionArtifacts, artifactPath, getExpectedHeading, getExpectedVisibleHeadings, getSeoValidationContext, inspectDocument, inspectVisibleHeading, validateHtml, validateArtifacts };
