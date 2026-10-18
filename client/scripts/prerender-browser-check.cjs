const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { ROUTES, artifactPath, getExpectedHeading, getExpectedVisibleHeadings, getSeoValidationContext, validateArtifacts, inspectDocument, inspectVisibleHeading } = require('./prerender-contract.cjs');
const { createStaticServer, prerenderRoute, findBrowserExecutablePath } = require('./prerender-routes.cjs');

async function waitForClientRoot(page) {
  await page.waitForFunction(() => {
    const root = document.getElementById('root');
    return root && !root.hasAttribute('data-prerender-route') && root.querySelector('main h1') &&
      !document.querySelector('[data-prerender-snapshot]') && root.style.display !== 'none';
  });
}

async function check() {
  const verification = process.argv.includes('--seo-verification');
  const devOrigin = process.env.PRERENDER_TEST_ORIGIN;
  if (devOrigin && !/^http:\/\/127\.0\.0\.1:\d+$/.test(devOrigin)) {
    throw new Error('PRERENDER_TEST_ORIGIN must be an isolated loopback server');
  }
  const tmp = devOrigin ? fs.mkdtempSync(path.join(__dirname, '.browser-check-')) : null;
  const distDir = tmp || path.resolve(__dirname, verification ? '../.seo-verification/dist' : '../dist');
  if (verification && devOrigin) throw new Error('Choose compiled SEO verification or development capture, not both');
  if (verification) {
    assert.ok(fs.existsSync(path.join(distDir, 'seo-verification-only.json')));
    console.log('[browser-check] Compiled SEO verification artifacts; NOT publishable production artifacts.');
  }
  const server = createStaticServer(distDir);
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: findBrowserExecutablePath(), headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const artifactOrigin = `http://127.0.0.1:${server.address().port}`;
    const origin = devOrigin || artifactOrigin;
    if (devOrigin) {
      console.log('[browser-check] DEV capture: verifies rendering, NOT a production build.');
      for (const route of ROUTES) await prerenderRoute(browser, route, null, { origin, distDir });
    }
    const artifacts = validateArtifacts(distDir);
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844, isMobile: true }]) {
      const context = await browser.createBrowserContext();
      try {
        const page = await context.newPage();
        await page.setViewport(viewport);
        await page.setBypassServiceWorker(true);
        await page.setJavaScriptEnabled(false);
        for (const route of ROUTES) {
          const response = await page.goto(`${artifactOrigin}${route}`, { waitUntil: 'domcontentloaded' });
          assert.equal(response.status(), 200);
          const doc = await page.evaluateHandle(() => document);
          await page.evaluate(inspectDocument, doc, route, getExpectedHeading(route), getSeoValidationContext(route));
          await page.evaluate(inspectVisibleHeading, doc, getExpectedVisibleHeadings(route));
          await doc.dispose();
        }
        await page.close();
        const live = await context.newPage();
        await live.setViewport(viewport);
        await live.setBypassServiceWorker(true);
        await live.setCacheEnabled(false);
        await live.evaluateOnNewDocument(() => {
          window.__handoffFrames = { started: false, blank: 0, ready: false };
          const sample = () => {
            const state = window.__handoffFrames;
            const visibleHeading = [...document.querySelectorAll('main h1')]
              .some((heading) => {
                if (!heading.getClientRects().length) return false;
                for (let node = heading; node; node = node.parentElement) {
                  const style = getComputedStyle(node);
                  if (Number(style.opacity) < 0.05 || style.visibility === 'hidden' || style.display === 'none') return false;
                }
                return true;
              });
            if (visibleHeading) state.started = true;
            if (state.started && !visibleHeading) state.blank += 1;
            if (!state.ready) requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
        const errors = [];
        const transactionRequests = [];
        let fixtureStay = false;
        live.on('pageerror', (error) => errors.push(error.message));
        live.on('console', (message) => {
          if (message.type() === 'error' && /hydration|react error|did not match|validateDOMNesting/i.test(message.text())) {
            errors.push(message.text());
          }
        });
        await live.setRequestInterception(true);
        live.on('request', (request) => {
          const url = new URL(request.url());
          if (request.isNavigationRequest() && request.frame() === live.mainFrame() && ROUTES.includes(url.pathname)) {
            return request.respond({ status: 200, contentType: 'text/html', body: fs.readFileSync(artifactPath(distDir, url.pathname)) });
          }
          if (url.pathname.startsWith('/api/') && url.origin === origin) {
            if (request.method() !== 'GET' && /\/(bookings|gift-vouchers)\b/.test(url.pathname)) {
              transactionRequests.push(`${request.method()} ${url.pathname}`);
            }
            let data;
            if (fixtureStay && request.method() === 'GET') {
              if (url.pathname === '/api/stays/the-cabin') data = { kind: 'cabin', cabinId: 'prerender-fixture' };
              if (url.pathname === '/api/stays/a-frame') data = { kind: 'cabinType' };
              const copy = require('../src/i18n/locales/en/seo.json').paidStaysBulgaria.stays;
              if (url.pathname === '/api/cabins/prerender-fixture') {
                data = { cabin: { _id: 'prerender-fixture', name: copy['the-cabin'].title, description: copy['the-cabin'].fitLine, slug: 'the-cabin', images: [], maxGuests: 2 } };
              }
              if (url.pathname === '/api/cabin-types/a-frame') {
                data = { cabinType: { _id: 'prerender-fixture-type', name: copy['valley-a-frame'].title, description: copy['valley-a-frame'].fitLine, slug: 'a-frame', images: [], maxGuests: 2, meta: { isMultiUnit: true } } };
              }
              if (url.pathname === '/api/units/by-type/prerender-fixture-type') {
                data = { units: [{ _id: 'fixture-unit', isActive: true }] };
              }
            }
            if (data) return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
            return request.respond({ status: 503, contentType: 'application/json', body: '{"success":false}' });
          }
          if ((url.protocol === 'http:' || url.protocol === 'https:') &&
              (url.origin !== origin || request.method() !== 'GET')) return request.abort();
          return request.continue();
        });
        for (const route of ROUTES) {
          console.log(`[browser-check] ${viewport.width}px client handoff: ${route}`);
          await live.goto(`${origin}${route}`, { waitUntil: 'networkidle2' });
          await waitForClientRoot(live);
          await live.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const frames = await live.evaluate(() => {
            window.__handoffFrames.ready = true;
            return window.__handoffFrames;
          });
          assert.equal(frames.started, true, `${route}: visible content was sampled`);
          assert.equal(frames.blank, 0, `${route}: no blank rendered frames during client replacement`);
          const doc = await live.evaluateHandle(() => document);
          await live.evaluate(inspectDocument, doc, route, getExpectedHeading(route), getSeoValidationContext(route));
          await doc.dispose();
          assert.deepEqual(errors, [], `${route} has no React/browser errors`);
        }
        // Use an in-app link, not a new document, to prove the router remains interactive.
        await live.goto(`${origin}/`, { waitUntil: 'networkidle2' });
        await waitForClientRoot(live);
        if (viewport.isMobile) {
          await live.click('#root header button[aria-label="Toggle menu"]');
          await live.waitForFunction(() => document.querySelector('#root header button[aria-label="Toggle menu"]')?.getAttribute('aria-expanded') === 'true');
        }
        const navigationSelector = viewport.isMobile
          ? '[role="dialog"][aria-label="Site navigation"] a[href="/cabin"]'
          : '#root header a[href="/cabin"]';
        await live.waitForSelector(navigationSelector, { visible: true });
        await live.evaluate(() => { window.__spaNavigationCheck = true; });
        const navigated = await live.$$eval(navigationSelector, (links) => {
          const link = links.find((element) => element.getClientRects().length > 0);
          link?.click();
          return Boolean(link);
        });
        assert.ok(navigated, 'live header has a visible Cabin router link');
        await live.waitForFunction(() => window.location.pathname === '/cabin' &&
          [...document.querySelectorAll('#root main h1')].some((heading) => heading.textContent.includes('The Cabin')));
        assert.equal(await live.evaluate(() => window.__spaNavigationCheck), true, 'navigation stays in the same document');
        await live.goto(`${origin}/gift-vouchers`, { waitUntil: 'networkidle2' });
        await waitForClientRoot(live);
        await live.waitForSelector('.amount-btn');
        await live.$$eval('.amount-btn:not(.custom)', (buttons) => buttons[2].click());
        await live.waitForFunction(() => document.querySelectorAll('.amount-btn:not(.custom)')[2]?.getAttribute('aria-pressed') === 'true');
        await live.$$eval('.variant-btn', (buttons) => buttons[1].click());
        await live.waitForFunction(() => document.querySelectorAll('.variant-btn')[1]?.getAttribute('aria-pressed') === 'true');
        fixtureStay = true;
        for (const slug of ['the-cabin', 'a-frame']) {
          await live.goto(`${origin}/stays/${slug}`, { waitUntil: 'networkidle2' });
          await waitForClientRoot(live);
          await live.waitForSelector('[data-booking-anchor]');
          const label = require('../src/i18n/locales/en/booking.json').modal.footerSelectDates;
          const clicked = await live.$$eval('main button', (buttons, text) => {
            const button = buttons.find((element) => element.textContent.trim() === text && !element.disabled);
            button?.click();
            return Boolean(button);
          }, label);
          assert.ok(clicked, `${slug}: existing select-dates control is available`);
          await live.waitForSelector('[data-testid="booking-modal-submit-search"]');
        }
        fixtureStay = false;
        for (const route of ['/search', '/login', '/gift-vouchers/success']) {
          await live.goto(`${origin}${route}`, { waitUntil: 'networkidle2' });
          await live.waitForFunction(() => {
            const root = document.getElementById('root');
            return root?.children.length && !root.hasAttribute('data-prerender-route') &&
              !document.querySelector('[data-prerender-snapshot]');
          });
          assert.equal(await live.$eval('#root', (root) => root.textContent.includes('Dwell in the Silence.')), false,
            `${route}: homepage fallback does not mask the client flow`);
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(transactionRequests, [], 'no booking/payment mutation is attempted');
        console.log(`[browser-check] ${viewport.width}px: ${ROUTES.length} raw HTML + ${ROUTES.length} client replacements; SPA navigation, voucher controls and both stay date modals passed.`);
      } finally {
        await context.close();
      }
    }
    console.log(JSON.stringify({ mode: devOrigin ? 'development-capture' : verification ? 'compiled-seo-verification' : 'production-artifacts', artifacts }, null, 2));
  } finally {
    if (browser) await browser.close();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    if (tmp) fs.rmSync(tmp, { recursive: true });
  }
}

check().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
