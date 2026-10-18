const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROUTES, artifactPath, getExpectedHeading, getExpectedVisibleHeadings, validateHtml, validateArtifacts } = require('./prerender-contract.cjs');
const { createStaticServer, writePrerenderedRoute, prerenderRoute } = require('./prerender-routes.cjs');
const registry = require('../src/data/publicSeoRoutes.json');

function fixture(route) {
  const locale = route.startsWith('/bg') ? 'bg' : 'en';
  const basePath = route === '/bg' ? '/' : route.startsWith('/bg/') ? route.slice(3) : route;
  const routeEntry = registry.find((entry) => entry.path === basePath);
  const canonicalPath = route === '/' ? '/' : `${route.replace(/\/+$/, '')}/`;
  const origin = 'https://driftdwells.com';
  const canonical = `${origin}${canonicalPath}`;
  const title = `Stay at ${route} | Drift &amp; Dwells`;
  const description = 'A specific public mountain retreat with useful information about your stay.';
  const alternates = [
    ...routeEntry.locales.map((alternateLocale) => {
      const localizedPath = alternateLocale === 'bg'
        ? `/bg${basePath === '/' ? '' : basePath}`
        : basePath;
      return `<link rel="alternate" hreflang="${alternateLocale}" href="${origin}${localizedPath === '/' ? '/' : `${localizedPath}/`}">`;
    }),
    `<link rel="alternate" hreflang="x-default" href="${origin}${basePath === '/' ? '/' : `${basePath}/`}">`
  ].join('');
  const isStay = Boolean(routeEntry.stayId);
  const schemas = basePath === '/'
    ? [{ '@type': 'WebSite' }, { '@type': 'Organization' }]
    : isStay
      ? [
        { '@type': ['LodgingBusiness', 'Accommodation'], url: canonical },
        { '@type': 'BreadcrumbList' }
      ]
      : route === '/cabin/faq'
        ? [{
          '@type': 'FAQPage',
          mainEntity: [{
            '@type': 'Question',
            name: 'Is this a public FAQ?',
            acceptedAnswer: { '@type': 'Answer', text: 'This answer is visible in the public FAQ.' }
          }]
        }]
        : ['/cabin', '/valley', '/retreats/the-valley'].includes(basePath)
          ? [{ '@type': 'LodgingBusiness' }, { '@type': 'BreadcrumbList' }]
          : ['/off-grid-cabins-bulgaria', '/digital-detox-bulgaria', '/retreat-venue-bulgaria'].includes(basePath)
            ? [{ '@type': 'WebPage' }, { '@type': 'BreadcrumbList' }]
            : [];
  const faqCopy = route === '/cabin/faq'
    ? '<p>Is this a public FAQ? This answer is visible in the public FAQ.</p>'
    : '';
  return `<!doctype html><html lang="${locale}"><head><title>${title}</title>
    <meta name="description" content="${description}">
    <link rel="canonical" href="${canonical}">
    ${alternates}
    <meta property="og:title" content="${title.replace(/&amp;/g, '&')}">
    <meta property="og:description" content="${description}">
    <meta property="og:url" content="${canonical}">
    <meta property="og:image" content="${origin}/media/hero/cabin-winter-1200w.webp">
    <meta property="og:image:alt" content="${title.replace(/&amp;/g, '&')}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${title.replace(/&amp;/g, '&')}">
    <meta name="twitter:description" content="${description}">
    <meta name="twitter:image" content="${origin}/media/hero/cabin-winter-1200w.webp">
    ${schemas.map((schema) => `<script type="application/ld+json">${JSON.stringify(schema)}</script>`).join('')}
    </head><body><div id="root" data-prerender-route="${route}"><main><h1>${getExpectedHeading(route)}</h1>
    ${faqCopy}<p>${'Useful public accommodation information. '.repeat(8)}</p></main></div></body></html>`;
}

test('finite registry includes eligible localized public routes, not private/transaction/noindex routes', () => {
  assert.equal(ROUTES.length, 34);
  assert.ok(!ROUTES.includes('/off-grid-stays-bulgaria'));
  assert.ok(!ROUTES.includes('/bg/off-grid-stays-bulgaria'));
  assert.equal(new Set(ROUTES).size, ROUTES.length);
  for (const route of ['/build', '/bg/build', '/bg/about', '/bg/cabin/faq', '/search', '/terms', '/privacy',
    '/career', '/press', '/cancellation-policy', '/guides/the-valley', '/guides/the-cabin',
    '/gift-vouchers/success', '/gift-vouchers/redeem', '/stays/the-cabin/confirm',
    '/booking-success/id', '/my-trip/id/valley-guide', '/ops', '/creator', '/login']) {
    assert.ok(!ROUTES.includes(route), route);
  }
  const app = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8');
  for (const route of ROUTES) {
    const appPath = route.includes('/stays/') ? route.replace(/\/stays\/[^/]+$/, '/stays/:slug') : route;
    assert.ok(app.includes(`path="${appPath}"`), `App has ${route}`);
  }
  assert.equal(registry.filter((entry) => entry.stayId).length, 4);
});

test('browser and skip failures cannot produce a successful build', () => {
  for (const env of [
    { PRERENDER_BROWSER_PATH: '/missing/chrome', PRERENDER_REQUIRE_BROWSER: '1' },
    { PRERENDER_SKIP: '1', PRERENDER_REQUIRE_BROWSER: '1' },
    { PRERENDER_ENABLED: 'false' },
    { PRERENDER_BROWSER_PATH: process.execPath }
  ]) {
    const result = spawnSync(process.execPath, [path.join(__dirname, 'prerender-routes.cjs')], {
      encoding: 'utf8', timeout: 15000,
      env: { ...process.env, PRERENDER_SKIP: '', PRERENDER_ENABLED: '', ...env }
    });

    assert.notEqual(result.status, 0, JSON.stringify(env));
    assert.match(result.stderr, /prerender/);
  }
  const build = require('../package.json').scripts.build;
  assert.match(build, /PRERENDER_REQUIRE_BROWSER=1/);
});

test('responsive visible-heading alternatives match existing locale content without changing route identity', () => {
  for (const locale of ['en', 'bg']) {
    const route = locale === 'en' ? '/valley' : '/bg/valley';
    const copy = require(`../src/i18n/locales/${locale}/valley.json`);
    assert.deepEqual(getExpectedVisibleHeadings(route), [getExpectedHeading(route), copy.hero.browse.headline]);
  }
  assert.deepEqual(getExpectedVisibleHeadings('/cabin'), ['The Cabin']);
  assert.throws(() => getExpectedVisibleHeadings('/build'), /Ineligible/);
});

test('artifact contract rejects missing, wrong-route, generic, loading, noindex and stale captures', () => {
  const valid = fixture('/cabin');
  assert.equal(validateHtml(valid, '/cabin').route, '/cabin');
  for (const html of [
    '<html><head><title>Drift & Dwells - Book Your Eco-Retreat</title></head><div id="root"></div></html>',
    fixture('/valley'),
    valid.replace(/<main>[\s\S]*?<\/main>/, '<main>Loading...</main>'),
    valid.replace('<h1>The Cabin</h1>', ''),
    valid.replace('<h1>The Cabin</h1>', '<h1>Generic marketing page</h1>'),
    valid.replace('<h1>The Cabin</h1>', '<h1 style="opacity:0">The Cabin</h1>'),
    valid.replace('</head>', '<meta name="robots" content="noindex,nofollow"></head>'),
    valid.replace('data-prerender-route="/cabin"', ''),
    valid.replace('lang="en"', 'lang="bg"')
  ]) {
    assert.throws(() => validateHtml(html, '/cabin'));
  }
  const tmp = fs.mkdtempSync(path.join(__dirname, '.contract-test-'));
  try {
    assert.throws(() => validateArtifacts(tmp), /ENOENT/);
    for (const route of ROUTES) {
      const output = artifactPath(tmp, route);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, fixture(route));
    }
    assert.equal(validateArtifacts(tmp).length, 34);
    fs.writeFileSync(artifactPath(tmp, '/'), '<html><div id="root"></div></html>');
    assert.throws(() => validateArtifacts(tmp));
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});

test('invalid output is rejected before writing any route artifact', async () => {
  const tmp = fs.mkdtempSync(path.join(__dirname, '.write-test-'));
  try {
    await assert.rejects(writePrerenderedRoute('/', '<div id="root"></div>', tmp));
    assert.ok(!fs.existsSync(path.join(tmp, 'index.html')));
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});

test('page exceptions propagate and close the page instead of producing a successful capture', async () => {
  let closed = false;
  const page = {
    on() {},
    async setBypassServiceWorker() {},
    async setRequestInterception() {},
    async setViewport() {},
    async goto() { throw new Error('Browser navigation failed'); },
    async close() { closed = true; }
  };
  await assert.rejects(prerenderRoute({ newPage: async () => page }, '/', 1234), /Browser navigation failed/);
  assert.equal(closed, true);
});

test('capture server serves immutable original shell, real assets, and never SPA HTML as API data', async () => {
  const tmp = fs.mkdtempSync(path.join(__dirname, '.server-test-'));
  const server = createStaticServer(tmp, Buffer.from('<div id="root"></div>'));
  try {
    fs.writeFileSync(path.join(tmp, 'index.html'), fixture('/'));
    fs.writeFileSync(path.join(tmp, 'entry.js'), 'export default 1');
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    assert.equal(await (await fetch(`${origin}/cabin?x=1`)).text(), '<div id="root"></div>');
    assert.equal(await (await fetch(`${origin}/entry.js?v=1`)).text(), 'export default 1');
    const api = await fetch(`${origin}/api/stays/a-frame`);
    assert.equal(api.status, 503);
    assert.equal((await api.json()).success, false);
    assert.equal((await fetch(`${origin}/missing.js`)).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmp, { recursive: true });
  }
});
