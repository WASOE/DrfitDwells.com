#!/usr/bin/env node
/**
 * Check that the backend is serving /uploads/ correctly.
 * Run with: node scripts/check-uploads-serving.mjs [baseUrl]
 * Default baseUrl: http://localhost:5000
 *
 * Use when: "media not showing" — confirms whether the server is up and files are reachable.
 */

const baseUrl = process.argv[2] || 'http://localhost:5000';

const paths = [
  '/uploads/Videos/The-cabin-header.winter.mp4',
  '/uploads/Videos/The-cabin-header.winter-poster.jpg',
  '/uploads/Content%20website/drift-dwells-bulgaria-cabin-journal.avif',
  '/uploads/The%20Valley/WhatsApp%20Image%202025-12-03%20at%204.36.14%20PM.jpeg',
];

async function check(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return { url, status: res.status, ok: res.ok };
  } catch (err) {
    return { url, status: null, ok: false, error: err.message };
  }
}

async function main() {
  console.log(`Checking uploads at ${baseUrl}...\n`);
  for (const p of paths) {
    const full = `${baseUrl}${p}`;
    const result = await check(full);
    const status = result.status ?? result.error;
    const icon = result.ok ? '✓' : '✗';
    console.log(`${icon} ${result.status} ${p}`);
    if (!result.ok && result.error) console.log(`   ${result.error}`);
  }
  console.log('\nIf you see 404 or connection errors:');
  console.log('  1. Start the backend: from repo root run "npm run dev" (runs both server and client).');
  console.log('  2. Or run server only: "npm run server" then in another terminal "npm run client".');
  console.log('  3. Media is served by the backend; the client (Vite) proxies /uploads to the server.');
}

main();
