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

function artifactPath(distDir, route) {
  if (!ROUTES.includes(route)) throw new Error(`Ineligible prerender route: ${route}`);
  return path.join(distDir, route.slice(1), 'index.html');
}

function inspectDocument(document, route, expectedHeading) {
  const fail = (reason) => { throw new Error(`[prerender] ${route}: ${reason}`); };
  const title = document.title.trim();
  const description = document.querySelector('meta[name="description"]')?.content?.trim();
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
  const locale = route === '/bg' || route.startsWith('/bg/') ? 'bg' : 'en';
  const main = document.querySelector('#root main')?.cloneNode(true);
  main?.querySelectorAll('script, style, noscript, template').forEach((node) => node.remove());
  const heading = main?.querySelector('h1')?.textContent?.trim();
  const text = main?.textContent?.replace(/\s+/g, ' ').trim() || '';
  if (!title || title === 'Drift & Dwells - Book Your Eco-Retreat' || title === 'Drift & Dwells') fail('generic or missing title');
  if (!description || description.length < 40) fail('missing meaningful description');
  if (!canonical || new URL(canonical).pathname.replace(/\/$/, '') !== route.replace(/\/$/, '')) {
    fail('head does not identify this route');
  }
  if (document.documentElement.lang !== locale) fail('incorrect document locale');
  if (document.querySelector('meta[name="robots"]')?.content?.includes('noindex')) fail('noindex route');
  if (!heading || heading.length < 3 || text.length < 180) fail('empty, generic or loading-only main content');
  if ([...main.querySelectorAll('h1')].every((node) => node.style.opacity !== '' && Number(node.style.opacity) === 0)) {
    fail('heading hidden in serialized HTML');
  }
  if (!expectedHeading || !heading.replace(/\s+/g, ' ').includes(expectedHeading)) fail('main content does not identify this route');
  if (/page not found|something went wrong/i.test(text)) fail('error page');
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
    const result = inspectDocument(dom.window.document, route, getExpectedHeading(route));
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

module.exports = { ROUTES, DEFAULT_TITLE, VERIFICATION_MARKER, assertProductionArtifacts, artifactPath, getExpectedHeading, getExpectedVisibleHeadings, inspectDocument, inspectVisibleHeading, validateHtml, validateArtifacts };
