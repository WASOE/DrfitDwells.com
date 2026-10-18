const http = require('node:http');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { ROUTES, artifactPath, getExpectedHeading, getExpectedVisibleHeadings, getSeoValidationContext, inspectDocument, inspectVisibleHeading, validateHtml, validateArtifacts } = require('./prerender-contract.cjs');

const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const PORT = Number(process.env.PRERENDER_PORT || 0);
const HOST = '127.0.0.1';

const SHOULD_SKIP =
  process.env.PRERENDER_SKIP === '1' ||
  process.env.PRERENDER_SKIP === 'true' ||
  process.env.PRERENDER_ENABLED === '0' ||
  process.env.PRERENDER_ENABLED === 'false';

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

  if (envCandidates.length) {
    const configured = envCandidates.find(fileExists);
    if (!configured) throw new Error('[prerender] Configured browser executable is unavailable.');
    return configured;
  }

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

function resolveRequestPath(requestPathname, distDir) {
  const safePath = decodeURIComponent(requestPathname);
  const resolved = path.resolve(distDir, `.${safePath}`);
  if (resolved !== distDir && !resolved.startsWith(`${distDir}${path.sep}`)) {
    return null;
  }
  return resolved;
}

async function readServedFile(requestPathname, distDir, shell) {
  const resolved = resolveRequestPath(requestPathname, distDir);
  if (!resolved) return null;

  // Never feed a previous capture (especially the home head) into another route.
  if (shell && !path.extname(requestPathname)) {
    return { filePath: 'index.html', body: shell };
  }
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
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    if (path.extname(requestPathname)) return null;

    const fallbackPath = path.join(distDir, 'index.html');
    return {
      filePath: fallbackPath,
      body: await fs.readFile(fallbackPath)
    };
  }
}

function createStaticServer(distDir = DIST_DIR, shell = null) {
  return http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url || '/', `http://${HOST}`).pathname;
      if (pathname.startsWith('/api/')) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Live data unavailable during static rendering' }));
        return;
      }
      const file = await readServedFile(pathname, distDir, shell);

      if (!file) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }

      res.writeHead(200, { 'Content-Type': getContentType(file.filePath) });
      res.end(file.body);
    } catch (error) {
      console.error('[prerender] Static server error:', error);
      res.writeHead(500);
      res.end('Prerender server error');
    }
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

async function waitForApp(page, route) {
  await page.waitForFunction(
    (expectedRoute) => {
      const main = document.querySelector('#root main');
      const canonical = document.querySelector('link[rel="canonical"]')?.href;
      return main?.querySelector('h1')?.textContent?.trim() &&
        (main.textContent || '').trim().length >= 180 &&
        canonical && new URL(canonical).pathname.replace(/\/$/, '') === expectedRoute.replace(/\/$/, '');
    },
    { timeout: 15000 },
    route
  );

  await new Promise((resolve) => setTimeout(resolve, 250));
}

async function writePrerenderedRoute(route, html, distDir = DIST_DIR) {
  validateHtml(html, route);
  const outputPath = artifactPath(distDir, route);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, html, 'utf8');
}

/** Festival QR landings: drop competing homepage preload + hydrated modulepreload weight. */
function finalizeEnduroHtml(route, html) {
  if (route !== '/enduro' && route !== '/bg/enduro') return html;
  let next = html.replace(
    /<link\b[^>]*href="\/uploads\/Videos\/The-cabin-header\.summer-poster\.jpg"[^>]*>\s*/gi,
    ''
  );
  // Hydrated capture injects every lazy chunk as modulepreload — lethal on 3G. Keep entry discovery.
  next = next.replace(/<link\b[^>]*rel="modulepreload"[^>]*>\s*/gi, '');
  next = next.replace(
    /<link\b[^>]*href="\/assets\/daypicker-theme-[^"]+\.css"[^>]*>\s*/gi,
    ''
  );
  // Consent mounts deferred on paid traffic — strip hydrated banner from static first paint.
  next = next.replace(
    /<div[^>]*role="dialog"[^>]*aria-label="Cookie and privacy choices"[^>]*>[\s\S]*?<\/div><\/div><\/div>/i,
    ''
  );
  return next;
}

async function prerenderRoute(browser, route, port, { distDir = DIST_DIR, origin = `http://${HOST}:${port}` } = {}) {
  const page = await browser.newPage();
  const targetUrl = `${origin}${route}`;
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /hydration|react error|did not match|validateDOMNesting/i.test(message.text())) {
      errors.push(message.text());
    }
  });

  try {
    await page.setBypassServiceWorker(true);
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/') && url.origin === origin) {
        return request.respond({
          status: 503, contentType: 'application/json',
          body: JSON.stringify({ success: false, message: 'Live data unavailable during static rendering' })
        });
      }
      // Build capture must never send analytics, payment, private or mutation requests.
      if ((url.protocol === 'http:' || url.protocol === 'https:') &&
          (url.origin !== origin || request.method() !== 'GET')) return request.abort();
      return request.continue();
    });
    // Mobile-first HTML for home + enduro so hero LCP matches festival phones.
    if (route === '/' || route === '/bg' || route === '/enduro' || route === '/bg/enduro') {
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
    } else {
      await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    }
    await page.goto(targetUrl, { waitUntil: 'networkidle2' });
    await waitForApp(page, route);
    await page.evaluate(async () => {
      const animations = document.getElementById('root').getAnimations({ subtree: true });
      for (const animation of animations) {
        if (Number.isFinite(animation.effect?.getComputedTiming().endTime) && animation.playbackRate !== 0) {
          animation.finish();
          const target = animation.effect?.target;
          if (target instanceof Element && target.getClientRects().length && typeof animation.commitStyles === 'function') {
            animation.commitStyles();
          }
        }
      }
      // Allow animation libraries to commit their completion styles to the DOM.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    if (new URL(page.url()).pathname !== route) throw new Error(`[prerender] Unexpected redirect for ${route}`);
    if (errors.length) throw new Error(`[prerender] ${route}: ${errors.join('; ')}`);
    const documentHandle = await page.evaluateHandle(() => document);
    await page.evaluate(inspectVisibleHeading, documentHandle, getExpectedVisibleHeadings(route), true);
    await page.evaluate(
      inspectDocument,
      documentHandle,
      route,
      getExpectedHeading(route),
      getSeoValidationContext(route)
    );
    await documentHandle.dispose();
    await page.evaluate((currentRoute) => {
      document.querySelector('#root').setAttribute('data-prerender-route', currentRoute);
    }, route);

    let html = await page.evaluate(() => `<!DOCTYPE html>${document.documentElement.outerHTML}`);
    html = revertDeferredGoogleFontMedia(html);
    html = finalizeEnduroHtml(route, html);
    // Validate serialized styles, not merely the live animation's painted state.
    const rawPage = await browser.newPage();
    try {
      await rawPage.setViewport(page.viewport());
      await rawPage.setJavaScriptEnabled(false);
      await rawPage.setBypassServiceWorker(true);
      await rawPage.setRequestInterception(true);
      rawPage.on('request', (request) => {
        const url = new URL(request.url());
        if (request.isNavigationRequest() && request.frame() === rawPage.mainFrame() && request.url() === targetUrl) {
          return request.respond({ status: 200, contentType: 'text/html', body: html });
        }
        if ((url.protocol === 'http:' || url.protocol === 'https:') &&
            (url.origin !== origin || request.method() !== 'GET')) return request.abort();
        return request.continue();
      });
      const rawResponse = await rawPage.goto(targetUrl, { waitUntil: 'networkidle2' });
      if (!rawResponse || rawResponse.status() !== 200) throw new Error(`[prerender] ${route}: serialized HTML navigation did not return HTTP 200`);
      if (rawResponse.fromServiceWorker()) throw new Error(`[prerender] ${route}: service worker intercepted serialized HTML validation`);
      const rawDocument = await rawPage.evaluateHandle(() => document);
      await rawPage.evaluate(inspectVisibleHeading, rawDocument, getExpectedVisibleHeadings(route));
      await rawDocument.dispose();
    } finally {
      await rawPage.close();
    }
    if (errors.length) throw new Error(`[prerender] ${route}: ${errors.join('; ')}`);
    await writePrerenderedRoute(route, html, distDir);

    const title = await page.title();
    console.log(`[prerender] ${route} -> ${title}`);
  } finally {
    await page.close();
  }
}

async function run({ distDir = DIST_DIR } = {}) {
  if (SHOULD_SKIP) {
    throw new Error('[prerender] Skipping required public SEO output is not allowed.');
  }

  const executablePath = findBrowserExecutablePath();
  if (!executablePath) {
    const message =
      '[prerender] No Chrome/Chromium executable found. ' +
      'Set PRERENDER_BROWSER_PATH (or PUPPETEER_EXECUTABLE_PATH/CHROME_BIN) to an installed browser path, ' +
      'Prerender is required; install/configure a browser before building.';
    throw new Error(message);
  }

  const shell = await fs.readFile(path.join(distDir, 'index.html'));
  const server = createStaticServer(distDir, shell);
  const port = await startServer(server);

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    for (const route of ROUTES) {
      await prerenderRoute(browser, route, port, { distDir });
    }
    const results = validateArtifacts(distDir);
    console.log(`[prerender] Validated ${results.length} required public SEO artifacts.`);
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      await stopServer(server);
    }
  }
}

module.exports = { createStaticServer, prerenderRoute, run, findBrowserExecutablePath, writePrerenderedRoute };

if (require.main === module) run().catch((error) => {
  console.error('[prerender] Failed to generate prerendered routes.');
  console.error(error);
  process.exit(1);
});
