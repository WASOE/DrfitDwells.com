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
  ['01_off_grid_weekends', '/off-grid-cabins-bulgaria'],
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
    const canonical = `https://driftdwells.com${entry.route}/`;
    assert.equal(document.querySelector('link[rel="canonical"]').href, canonical);
    assert.equal(document.querySelector('meta[property="og:url"]').content, canonical);
    assert.equal(document.querySelectorAll('main h1').length, 1, `${entry.route}: multiple H1s`);
    const text = normalize(article.textContent);
    const firstParagraph = body.split(/\n\s*\n/)[1].trim();
    const renderedIntroduction = normalize([...article.querySelectorAll('.ai-search-hero-intro, .ai-search-intro-continuation')].map((node) => node.textContent).join(' '));
    assert.equal(renderedIntroduction, normalize(plain(firstParagraph)), `${entry.route}: hero and introduction must preserve the exact opening paragraph`);
    for (const line of body.split('\n').map((item) => item.trim()).filter(Boolean)) {
      if (/^(?:CTA:|Secondary|Второ CTA:|Второстепенно CTA:)/.test(line)) continue;
      const expected = normalize(plain(line.replace(/^#{1,3} |^- /, '')));
      assert.ok(text.includes(expected) || renderedIntroduction === expected, `${entry.route}: missing approved copy: ${expected}`);
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
    const expectedAbout = entry.base === '/retreat-venue-bulgaria'
      ? ['/valley/#lodging', '/retreats/the-valley/#lodging']
      : entry.base === '/digital-detox-bulgaria'
        ? ['/cabin/#lodging']
        : ['/cabin/#lodging', '/valley/#lodging'];
    assert.deepEqual(schemas[0].about.map(({ '@id': id }) => id), expectedAbout.map((id) => `https://driftdwells.com${id}`));
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
    if (entry.base === '/off-grid-cabins-bulgaria') {
      assert.ok(article.querySelector('a[href*="/stays/the-cabin"]'), 'existing stay selector must remain');
      assert.ok(article.querySelector('a[href*="/stays/lux-cabin"]'), 'existing Luxury Cabin selector must remain');
    }
  }
  const routes = registry.flatMap(({ path, locales }) =>
    locales.map((locale) => locale === 'bg' ? `/bg${path}` : path)
  );
  assert.equal(routes.length, 34);
  assert.ok(routes.includes('/off-grid-cabins-bulgaria'));
  assert.ok(routes.includes('/bg/off-grid-cabins-bulgaria'));
  assert.ok(!routes.includes('/off-grid-stays-bulgaria'));
  assert.ok(!routes.includes('/bg/off-grid-stays-bulgaria'));
});

test('publisher handoff uses only the established off-grid destination and agreed placements', () => {
  const handoff = fs.readFileSync(path.join(clientDir, '../docs/go-guide-publisher-handoff.md'), 'utf8');
  for (const destination of [
    'https://driftdwells.com/off-grid-cabins-bulgaria/',
    'https://driftdwells.com/digital-detox-bulgaria/',
    'https://driftdwells.com/retreat-venue-bulgaria/',
    'https://driftdwells.com/bg/off-grid-cabins-bulgaria/',
    'https://driftdwells.com/bg/digital-detox-bulgaria/',
    'https://driftdwells.com/bg/retreat-venue-bulgaria/'
  ]) assert.ok(handoff.includes(destination), `Missing publisher destination ${destination}`);
  assert.match(handoff, /Q2[\s\S]*burnout/);
  assert.match(handoff, /Q4[\s\S]*off-grid/);
  assert.match(handoff, /Q10[\s\S]*The Valley[\s\S]*team building/);
  assert.doesNotMatch(handoff, /https:\/\/driftdwells\.com\/(?:bg\/)?off-grid-stays-bulgaria/);
});

test('off-grid Luxury Cabin marketing label reflects €110 base rate without hiding seasonal rates', () => {
  for (const [locale, route, expected] of [
    ['en', '/off-grid-cabins-bulgaria', '€110/night base rate; seasonal rates vary'],
    ['bg', '/bg/off-grid-cabins-bulgaria', 'Базова цена €110/нощувка; сезонните цени варират']
  ]) {
    const html = fs.readFileSync(path.join(dist, route.slice(1), 'index.html'), 'utf8');
    const text = normalize(new JSDOM(html).window.document.body.textContent);
    assert.ok(text.includes(expected), `${locale} off-grid route does not show the verified €110 base rate`);
    assert.doesNotMatch(text, /€85/);
  }
});

test('desktop/tablet/mobile editorial pages, inquiry controls, photos and crawler requests work without mutations', { timeout: 360000 }, async () => {
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
    assert.doesNotMatch(robots, /Disallow: \/(?:digital-detox|off-grid-cabins|retreat-venue)/);
    const screenshotDir = process.env.AI_SEARCH_SCREENSHOTS;
    if (screenshotDir) fs.mkdirSync(screenshotDir, { recursive: true });
    for (const width of [390, 768, 1440]) {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.setViewport({ width, height: 900, isMobile: width === 390 });
      await page.evaluateOnNewDocument(() => {
        localStorage.setItem('dd_consent_v1', JSON.stringify({ analytics: false, ads: false }));
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
          const images = [...article.querySelectorAll('img')];
          await Promise.all(images.map((image) => { image.loading = 'eager'; return image.decode(); }));
          await document.fonts.ready;
          return {
            headings: document.querySelectorAll('main h1').length,
            overflow: document.documentElement.scrollWidth > innerWidth + 1,
            images: images.map((image) => ({ width: image.naturalWidth, height: image.naturalHeight })),
            editorialInstructions: /Internal link:|Вътрешна връзка:/.test(article.textContent),
            language: document.documentElement.lang,
            heroCount: article.querySelectorAll('.ai-search-hero img').length,
            cards: article.querySelectorAll('.ai-search-stay').length,
            clippedText: [...article.querySelectorAll('h1, h2, h3, p, .ai-search-cta')].some((node) => node.scrollWidth > node.clientWidth + 1),
            cardImages: [...article.querySelectorAll('.ai-search-stay-image')].map((image) => {
              const rect = image.getBoundingClientRect();
              return { width: rect.width, ratio: rect.width / rect.height };
            }),
            headerOverflow: [...document.querySelectorAll('header a, header button')].filter((node) => node.checkVisibility())
              .some((node) => node.getBoundingClientRect().right > innerWidth + 1 || node.getBoundingClientRect().left < -1)
          };
        });
        assert.equal(result.headings, 1);
        assert.equal(result.overflow, false, `${entry.route} overflows at ${width}px`);
        assert.equal(result.language, entry.locale);
        assert.equal(result.editorialInstructions, false);
        assert.ok(result.images.every((image) => image.width > 0 && image.height > 0));
        assert.equal(result.heroCount, 1, `${entry.route}: exactly one hero photograph`);
        assert.equal(result.clippedText, false, `${entry.route}: clipped text at ${width}px`);
        assert.equal(result.headerOverflow, false, `${entry.route}: navigation overflows at ${width}px`);
        assert.equal(result.cards, entry.base === '/off-grid-cabins-bulgaria' ? 4 : 0);
        assert.ok(result.cardImages.every((image) => image.width >= 290 && Math.abs(image.ratio - 1.5) < 0.01), `${entry.route}: cramped or distorted discovery cards`);
        if (screenshotDir) {
          await page.screenshot({ path: path.join(screenshotDir, `${entry.base.slice(1)}_${entry.locale}_${width}.png`), fullPage: true });
        }
        if (entry.base === '/retreat-venue-bulgaria') {
          await page.evaluate(() => document.querySelector('.ai-search-actions button').click());
          await page.waitForSelector('[role="dialog"][aria-modal="true"]', { visible: true });
          await page.waitForSelector('[data-testid="booking-modal-submit-search"]', { visible: true });
          await page.keyboard.press('Escape');
          await page.waitForSelector('[role="dialog"][aria-modal="true"]', { hidden: true });
        }
        if (width <= 768 && entry.base !== '/off-grid-cabins-bulgaria') {
          await page.click('button[aria-label="Toggle menu"]');
          await page.waitForSelector('#site-mobile-nav', { visible: true });
          await page.click('button[aria-label="Close menu"]');
          await page.waitForFunction(() => !document.querySelector('#site-mobile-nav'));
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
