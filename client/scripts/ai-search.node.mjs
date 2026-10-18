import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import puppeteer from 'puppeteer-core';
import prerender from './prerender-routes.cjs';

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(clientDir, 'dist');
const require = createRequire(import.meta.url);
const registry = require('../src/data/publicSeoRoutes.json');
const cases = [
  ['01_off_grid_weekends', '/off-grid-stays-bulgaria'],
  ['02_digital_detox', '/digital-detox-bulgaria'],
  ['03_corporate_retreat', '/retreat-venue-bulgaria']
].flatMap(([file, route]) => ['en', 'bg'].map((locale) => ({
  file: `${file}_${locale}.md`,
  route: locale === 'bg' ? `/bg${route}` : route,
  base: route,
  locale
})));
const normalize = (text) => text.replace(/\s+/g, ' ').trim();
const plain = (text) => text
  .replace(/\[(?:Internal link|Вътрешна връзка): (.+?), \/[^\]]+\]/g, '$1')
  .replace(/\[([^\]]+)\]\(https:\/\/[^)]+\)/g, '$1')
  .replace(/\*\*?([^*]+)\*\*?/g, '$1');

test('all six raw HTML pages preserve approved editorial copy, metadata, links, citations and schemas', () => {
  for (const entry of cases) {
    const source = fs.readFileSync(path.join(clientDir, 'src/content/ai-search', entry.file), 'utf8');
    const body = source.slice(source.indexOf('\n# ') + 1);
    const html = fs.readFileSync(path.join(dist, entry.route.slice(1), 'index.html'), 'utf8');
    const document = new JSDOM(html).window.document;
    const article = document.querySelector('article.ai-search');
    assert.ok(article, `${entry.route}: missing editorial article`);
    assert.equal(document.querySelectorAll('main h1').length, 1, `${entry.route}: multiple H1s`);
    const text = normalize(article.textContent);
    for (const line of body.split('\n').map((item) => item.trim()).filter(Boolean)) {
      if (/^(?:CTA:|Secondary|Второ CTA:|Второстепенно CTA:)/.test(line)) continue;
      const expected = normalize(plain(line.replace(/^#{1,3} |^- /, '')));
      assert.ok(text.includes(expected), `${entry.route}: missing approved copy: ${expected}`);
    }
    assert.doesNotMatch(text, /CONTENT SOURCE|Internal link:|Вътрешна връзка:|съществуващата форма|CTA:/);
    const title = source.match(/^SEO title: (.+)$/m)[1];
    const description = source.match(/^Meta description: (.+)$/m)[1];
    assert.equal(document.title, title);
    assert.equal(document.querySelector('meta[name="description"]').content, description);
    assert.equal(document.querySelector('meta[property="og:title"]').content, source.match(/^Social title: (.+)$/m)[1]);
    const schemas = [...article.querySelectorAll('script[type="application/ld+json"]')].map((node) => JSON.parse(node.textContent));
    assert.deepEqual(schemas.map((node) => node['@type']), ['WebPage', 'BreadcrumbList']);
    assert.equal(schemas[0].inLanguage, entry.locale);
    assert.equal(schemas[0]['@id'], `https://driftdwells.com${entry.route}/#webpage`);
    assert.doesNotMatch(JSON.stringify(schemas), /"Event"|"Product"|"offers"|"aggregateRating"/);
    const images = article.querySelectorAll('.ai-search-photos img');
    assert.ok(images.length >= 2 && images.length <= 4);
    for (const image of images) {
      assert.ok(image.alt.length > 10);
      assert.ok(image.closest('figure').querySelector('figcaption').textContent.trim());
      for (const src of [image.getAttribute('src'), ...image.getAttribute('srcset').split(',').map((item) => item.trim().split(' ')[0])]) {
        assert.ok(fs.existsSync(path.join(dist, src)), `${entry.route}: missing real photo ${src}`);
      }
    }
    for (const link of article.querySelectorAll('a[href^="/"]')) {
      const href = link.getAttribute('href').split(/[?#]/)[0];
      assert.equal(href.startsWith('/bg/'), entry.locale === 'bg', `${entry.route}: unlocalized link`);
      assert.ok(fs.existsSync(path.join(dist, href, 'index.html')), `${entry.route}: target not prerendered: ${href}`);
    }
    if (entry.base === '/digital-detox-bulgaria') {
      for (const href of ['https://www.nature.com/articles/s41598-025-90984-3', 'https://doi.org/10.1016/j.ssaho.2025.101812']) {
        assert.ok(article.querySelector(`a[href="${href}"]`), `${entry.route}: missing citation`);
      }
    }
    if (entry.base === '/off-grid-stays-bulgaria') {
      assert.ok(article.querySelector('a[href*="/stays/the-cabin"]'), 'existing stay selector must remain');
      assert.ok(article.querySelector('a[href*="/stays/lux-cabin"]'), 'existing Luxury Cabin selector must remain');
    }
  }
  assert.equal(registry.flatMap((entry) => entry.locales).length, 36);
});

test('desktop/mobile editorial pages, inquiry controls, photos and crawler requests work without mutations', { timeout: 240000 }, async () => {
  const server = prerender.createStaticServer(dist);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const mutations = [];
  try {
    browser = await puppeteer.launch({ executablePath: prerender.findBrowserExecutablePath(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    for (const agent of ['Googlebot', 'bingbot', 'OAI-SearchBot']) {
      for (const entry of cases) {
        const response = await fetch(`${origin}${entry.route}/`, { headers: { 'User-Agent': agent } });
        assert.equal(response.status, 200);
        assert.ok((await response.text()).includes('article class="ai-search"'));
      }
    }
    const robots = await (await fetch(`${origin}/robots.txt`)).text();
    assert.match(robots, /User-agent: \*/);
    assert.match(robots, /Disallow: \/admin\//);
    assert.doesNotMatch(robots, /Disallow: \/(?:digital-detox|off-grid-stays|retreat-venue)/);
    for (const width of [1280, 390]) {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.setViewport({ width, height: 900, isMobile: width === 390 });
      await page.evaluateOnNewDocument(() => {
        localStorage.setItem('dd_consent_v1', JSON.stringify({ essential: true, analytics: false, marketing: false }));
      });
      await page.setBypassServiceWorker(true);
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.pathname.startsWith('/api/')) {
          if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) mutations.push(`${request.method()} ${url.pathname}`);
          return request.respond({ status: 503, contentType: 'application/json', body: '{"success":false}' });
        }
        if (url.origin !== origin && /^https?:/.test(url.protocol)) return request.abort();
        return request.continue();
      });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      for (const entry of cases) {
        await page.goto(`${origin}${entry.route}/`, { waitUntil: 'networkidle0' });
        await page.waitForFunction(() => !document.querySelector('#root[data-prerender-route]') && document.querySelector('article.ai-search h1'));
        const result = await page.evaluate(async () => {
          const article = document.querySelector('article.ai-search');
          const images = [...article.querySelectorAll('.ai-search-photos img')];
          await Promise.all(images.map((image) => { image.loading = 'eager'; return image.decode(); }));
          return {
            headings: document.querySelectorAll('main h1').length,
            overflow: document.documentElement.scrollWidth > innerWidth + 1,
            images: images.map((image) => ({ width: image.naturalWidth, height: image.naturalHeight })),
            editorialInstructions: /Internal link:|Вътрешна връзка:/.test(article.textContent),
            language: document.documentElement.lang
          };
        });
        assert.equal(result.headings, 1);
        assert.equal(result.overflow, false, `${entry.route} overflows at ${width}px`);
        assert.equal(result.language, entry.locale);
        assert.equal(result.editorialInstructions, false);
        assert.ok(result.images.every((image) => image.width > 0 && image.height > 0));
        if (entry.base === '/retreat-venue-bulgaria') {
          await page.evaluate(() => document.querySelector('.ai-search-actions button').click());
          await page.waitForSelector('[role="dialog"][aria-modal="true"]', { visible: true });
          await page.keyboard.press('Escape');
        }
      }
      assert.deepEqual(errors, [], `browser errors at ${width}px`);
      await context.close();
    }
    assert.deepEqual(mutations, [], 'editorial browsing must not call transaction APIs');
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
