const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const puppeteer = require('puppeteer-core');

const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const DEFAULT_TITLE = 'Drift & Dwells - Book Your Eco-Retreat';
const PORT = Number(process.env.PRERENDER_PORT || 0);
const HOST = '127.0.0.1';
const EXECUTABLE_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome';

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
  '/bg/retreat-venue-bulgaria'
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
    await page.goto(targetUrl, { waitUntil: 'networkidle2' });
    await waitForApp(page);

    const html = await page.evaluate(() => `<!DOCTYPE html>${document.documentElement.outerHTML}`);
    await writePrerenderedRoute(route, html);

    const title = await page.title();
    console.log(`[prerender] ${route} -> ${title}`);
  } finally {
    await page.close();
  }
}

async function run() {
  const server = createStaticServer();
  const port = await startServer(server);

  const browser = await puppeteer.launch({
    executablePath: EXECUTABLE_PATH,
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
