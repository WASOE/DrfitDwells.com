/**
 * Generates responsive AVIF/WebP hero assets from canonical JPG posters.
 * Run from repo root: node client/scripts/generate-hero-variants.mjs
 * Or via npm run generate:hero-media (client package.json).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../package.json'));
const sharp = require('sharp');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const outDir = path.resolve(__dirname, '../public/media/hero');

const WIDTHS = [480, 720, 960, 1200, 1920];

const SOURCES = [
  {
    slug: 'cabin-summer',
    src: path.join(repoRoot, 'uploads/Videos/The-cabin-header.summer-poster.jpg')
  },
  {
    slug: 'cabin-winter',
    src: path.join(repoRoot, 'uploads/Videos/The-cabin-header.winter-poster.jpg')
  },
  {
    slug: 'valley-summer-night',
    src: path.join(repoRoot, 'uploads/Videos/The-Valley-Night-Stars-poster.jpg')
  },
  {
    slug: 'valley-winter',
    src: path.join(repoRoot, 'uploads/Videos/The-Valley-firaplace-video.winter-poster.jpg')
  }
];

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  for (const { slug, src } of SOURCES) {
    if (!fs.existsSync(src)) {
      console.warn(`[generate-hero-variants] Skip missing source: ${src}`);
      continue;
    }

    const meta = await sharp(src).metadata();
    const origW = meta.width || 1920;
    const origH = meta.height || 1080;
    const aspect = origW / origH;

    for (const w of WIDTHS) {
      const h = Math.round(w / aspect);
      const base = path.join(outDir, `${slug}-${w}w`);

      await sharp(src)
        .resize(w, h, { fit: 'cover', position: slug.startsWith('cabin') ? 'centre' : 'centre' })
        .avif({ quality: 48, effort: 6 })
        .toFile(`${base}.avif`);

      await sharp(src)
        .resize(w, h, { fit: 'cover', position: 'centre' })
        .webp({ quality: 78, effort: 5 })
        .toFile(`${base}.webp`);

      process.stdout.write('.');
    }
    console.log(` ${slug}`);
  }

  console.log('[generate-hero-variants] Done →', outDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
