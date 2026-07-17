/**
 * Serves client/dist + repo uploads/ for local Lighthouse / Playwright proofs.
 * Usage: node .scratch/perf-homepage-proofs/serve-dist.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const dist = path.join(root, 'client/dist');
const uploads = path.join(root, 'uploads');
const PORT = Number(process.env.PROOF_PORT || 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json'
};

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'text/plain', 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  let pathname = decodeURIComponent(url.pathname);

  let filePath;
  if (pathname.startsWith('/uploads/')) {
    filePath = path.join(uploads, pathname.slice('/uploads/'.length));
  } else {
    if (pathname === '/') pathname = '/index.html';
    filePath = path.join(dist, pathname);
    if (!path.extname(filePath) && !fs.existsSync(filePath)) {
      // SPA fallback
      filePath = path.join(dist, 'index.html');
    }
  }

  if (!filePath.startsWith(dist) && !filePath.startsWith(uploads)) {
    return send(res, 403, 'Forbidden');
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    if (!pathname.startsWith('/uploads/')) {
      filePath = path.join(dist, 'index.html');
    } else {
      return send(res, 404, 'Not found');
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = TYPES[ext] || 'application/octet-stream';
  const data = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' });
  res.end(data);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[proof-serve] http://127.0.0.1:${PORT}`);
});
