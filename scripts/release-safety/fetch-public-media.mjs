/**
 * Read-only fetch of public cabin originals that the production build checks.
 * These files are gitignored. This does not write to the production server.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const files = [
  'uploads/cabins/69d096b6bd7fb6fc0d3c2a34/original/1775292060909-z9e6zesu9d-WhatsApp-Image-2025-12-03-at-4.36.15-PM-(1).jpeg',
  'uploads/cabins/69b2ff947f141a71ffa7c492/original/1776454430446-v6zze6vlats-WhatsApp-Image-2026-04-17-at-9.28.21-PM-(4).jpeg',
  'uploads/cabins/69b2ff947f141a71ffa7c452/original/1776456739003-888wvfcs4sb-WhatsApp-Image-2026-04-14-at-10.51.06-AM-(1).jpeg'
];

for (const relative of files) {
  const dest = path.join(repoRoot, relative);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
    console.log(`[release-safety] media present ${relative}`);
    continue;
  }
  const response = await fetch(`https://driftdwells.com/${relative}`);
  if (!response.ok) {
    console.error(`[release-safety] BLOCK: public media GET failed ${response.status} ${relative}`);
    process.exit(1);
  }
  const type = response.headers.get('content-type') || '';
  if (!type.includes('image/jpeg')) {
    console.error(`[release-safety] BLOCK: ${relative} is ${type}, not image/jpeg.`);
    process.exit(1);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1000) {
    console.error(`[release-safety] BLOCK: ${relative} is too small (${bytes.length} bytes).`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, bytes);
  console.log(`[release-safety] fetched ${relative} (${bytes.length} bytes)`);
}
