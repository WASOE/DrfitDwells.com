const http = require('node:http');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const puppeteer = require('puppeteer-core');

const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const DEFAULT_TITLE = 'Drift & Dwells - Book Your Eco-Retreat';
const PORT = Number(process.env.PRERENDER_PORT || 0);
const HOST = '127.0.0.1';

const SHOULD_SKIP =
  process.env.PRERENDER_SKIP === '1' ||
  process.env.PRERENDER_SKIP === 'true' ||
  process.env.PRERENDER_ENABLED === '0' ||
  process.env.PRERENDER_ENABLED === 'false';

const REQUIRE_BROWSER =
  process.env.PRERENDER_REQUIRE_BROWSER === '1' ||
  process.env.PRERENDER_REQUIRE_BROWSER === 'true';

function envString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function fileExists(executablePath) {
  if (!executablePath) return false;
  try {
    fsSync.accessSync(executablePath, fsSync.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findBrowserExecutablePath() {
  const envCandidates = [
    envString(process.env.PRERENDER_BROWSER_PATH),
    envString(process.env.PUPPETEER_EXECUTABLE_PATH),
    envString(process.env.CHROME_BIN),
    envString(process.env.CHROMIUM_BIN)
  ].filter(Boolean);

  for (const candidate of envCandidates) {
    if (fileExists(candidate)) return candidate;
  }

  const commonCandidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/opt/google/chrome/chrome'
  ];

  for (const candidate of commonCandidates) {
    if (fileExists(candidate)) return candidate;
  }

  return '';
}

const ROUTES = [
  '/',
  '/bg',
  '/about',
  '/bg/about',
  '/cabin',
  '/bg/cabin',
  '/valley',
  '/bg/valley',
  '/off-grid-cabins-bulgaria',
  '/bg/off-grid-cabins-bulgaria',
  '/rhodopes-cabin-retreat',
  '/bg/rhodopes-cabin-retreat',
  '/bansko-remote-work-retreat',
  '/bg/bansko-remote-work-retreat',
  '/retreat-venue-bulgaria',
  '/bg/retreat-venue-bulgaria',
  '/off-grid-stays-bulgaria',
  '/bg/off-grid-stays-bulgaria'
];

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8'
};

function getContentType(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function resolveRequestPath(requestPathname) {
  const safePath = decodeURIComponent(requestPathname).split('?')[0];
  const resolved = path.resolve(DIST_DIR, `.${safePath}`);
  if (!resolved.startsWith(DIST_DIR)) {
    return null;
  }
  return resolved;
}

async function readServedFile(requestPathname) {
  const resolved = resolveRequestPath(requestPathname);
  if (!resolved) return null;

  try {
    const stats = await fs.stat(resolved);
    if (stats.isDirectory()) {
      const nestedIndex = path.join(resolved, 'index.html');
      return {
        filePath: nestedIndex,
        body: await fs.readFile(nestedIndex)
      };
    }

    return {
      filePath: resolved,
      body: await fs.readFile(resolved)
    };
  } catch {
    if (path.extname(requestPathname)) return null;

    const fallbackPath = path.join(DIST_DIR, 'index.html');
    return {
      filePath: fallbackPath,
      body: await fs.readFile(fallbackPath)
    };
  }
}

function createStaticServer() {
  return http.createServer(async (req, res) => {
    const file = await readServedFile(req.url || '/');

    if (!file) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    res.writeHead(200, { 'Content-Type': getContentType(file.filePath) });
    res.end(file.body);
  });
}

async function startServer(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, HOST, resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Unable to determine prerender server port.');
  }

  return address.port;
}

async function stopServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

/**
 * Puppeteer serializes the live DOM after stylesheets load; the deferred Google
 * Fonts trick (media="print" + onload) has already flipped to media="all",
 * which would make the shipped HTML blocking. Restore print for first paint.
 */
function revertDeferredGoogleFontMedia(html) {
  return html.replace(
    /(<link[^>]+href="https:\/\/fonts\.googleapis\.com[^>]+)media="all" onload="this\.media='all'"/g,
    '$1media="print" onload="this.media=\'all\'"'
  );
}

async function waitForApp(page) {
  await page.waitForFunction(
    (defaultTitle) => {
      const root = document.querySelector('#root');
      if (!root) return false;

      const text = (root.textContent || '').trim();
      if (!text || text === 'Loading...') return false;

      return document.title && document.title !== defaultTitle;
    },
    { timeout: 15000 },
    DEFAULT_TITLE
  );

  await new Promise((resolve) => setTimeout(resolve, 250));
}

async function writePrerenderedRoute(route, html) {
  const outputPath =
    route === '/'
      ? path.join(DIST_DIR, 'index.html')
      : path.join(DIST_DIR, route.replace(/^\//, ''), 'index.html');

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, html, 'utf8');
}

async function prerenderRoute(browser, route, port) {
  const page = await browser.newPage();
  const targetUrl = `http://${HOST}:${port}${route}`;

  try {
    // Mobile-first HTML for home so hero markup matches real phones (split panes + poster LCP, not desktop video).
    if (route === '/' || route === '/bg') {
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
    } else {
      await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    }
    await page.goto(targetUrl, { waitUntil: 'networkidle2' });
    await waitForApp(page);

    let html = await page.evaluate(() => `<!DOCTYPE html>${document.documentElement.outerHTML}`);
    html = revertDeferredGoogleFontMedia(html);
    await writePrerenderedRoute(route, html);

    const title = await page.title();
    console.log(`[prerender] ${route} -> ${title}`);
  } finally {
    await page.close();
  }
}

async function run() {
  if (SHOULD_SKIP) {
    console.log('[prerender] Skipping prerender (PRERENDER_SKIP/PRERENDER_ENABLED).');
    return;
  }

  const executablePath = findBrowserExecutablePath();
  if (!executablePath) {
    const message =
      '[prerender] No Chrome/Chromium executable found. ' +
      'Set PRERENDER_BROWSER_PATH (or PUPPETEER_EXECUTABLE_PATH/CHROME_BIN) to an installed browser path, ' +
      'or set PRERENDER_SKIP=1 to skip prerender on this machine.';
    if (REQUIRE_BROWSER) {
      throw new Error(message);
    }
    console.warn(message);
    console.warn('[prerender] Continuing without prerender (soft skip).');
    return;
  }

  const server = createStaticServer();
  const port = await startServer(server);

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    for (const route of ROUTES) {
      await prerenderRoute(browser, route, port);
    }
  } finally {
    await browser.close();
    await stopServer(server);
  }
}

run().catch((error) => {
  console.error('[prerender] Failed to generate prerendered routes.');
  console.error(error);
  process.exit(1);
});
