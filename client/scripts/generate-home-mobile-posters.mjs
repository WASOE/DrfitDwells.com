/**
 * Same-dimension AVIF/WebP for DualityHero mobile posters (no resize).
 * JPEG sources stay byte-identical. Writes sibling .avif/.webp next to each JPG.
 *
 * Usage: node client/scripts/generate-home-mobile-posters.mjs
 * Diff proofs: node client/scripts/generate-home-mobile-posters.mjs --diff
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../package.json'));
const sharp = require('sharp');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const videosDir = path.join(repoRoot, 'uploads/Videos');
const proofDir = path.join(repoRoot, '.scratch/perf-poster-proofs');

/** Exact DualityHero mobile poster set (cabin + valley × summer + winter). */
export const MOBILE_POSTER_SOURCES = [
  {
    id: 'cabin-summer',
    jpg: 'The-cabin-header.summer-poster.jpg'
  },
  {
    id: 'cabin-winter',
    jpg: 'The-cabin-header.winter-poster.jpg'
  },
  {
    id: 'valley-summer',
    jpg: 'The-Valley-Night-Stars-poster.jpg'
  },
  {
    id: 'valley-winter',
    jpg: 'The-Valley-firaplace-video.winter-poster.jpg'
  }
];

/**
 * High-quality encodes aimed at visually lossless vs JPEG at mobile display size.
 * Tuned so AVIF/WebP are smaller than the source JPEG while keeping low MAE.
 */
const AVIF_OPTS = { quality: 72, effort: 7 };
const WEBP_OPTS = { quality: 90, effort: 6 };

function siblingPath(jpgPath, ext) {
  return jpgPath.replace(/\.jpe?g$/i, `.${ext}`);
}

async function encodeOne(jpgName) {
  const jpgPath = path.join(videosDir, jpgName);
  if (!fs.existsSync(jpgPath)) {
    throw new Error(`Missing poster: ${jpgPath}`);
  }
  const jpgBuf = fs.readFileSync(jpgPath);
  const meta = await sharp(jpgBuf).metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`No dimensions for ${jpgName}`);
  }

  const avifPath = siblingPath(jpgPath, 'avif');
  const webpPath = siblingPath(jpgPath, 'webp');

  await sharp(jpgBuf)
    .avif(AVIF_OPTS)
    .toFile(avifPath);

  await sharp(jpgBuf)
    .webp(WEBP_OPTS)
    .toFile(webpPath);

  return {
    jpgName,
    width: meta.width,
    height: meta.height,
    jpgBytes: jpgBuf.length,
    avifBytes: fs.statSync(avifPath).size,
    webpBytes: fs.statSync(webpPath).size,
    avifPath,
    webpPath,
    jpgPath
  };
}

/**
 * Diff JPG vs decoded modern format at native + mobile display sizes.
 * Display sim: 375×406 (approx half of 375×812), cover + scale factors matching DualityHero.
 */
async function diffVariant(id, jpgPath, modernPath, label, display) {
  const { width: dw, height: dh, scale, objectPositionY } = display;

  async function toDisplayRgba(inputPath) {
    // Simulate object-fit:cover inside the pane, then CSS transform scale() crop.
    const tw = Math.round(dw * scale);
    const th = Math.round(dh * scale);
    const focusY = typeof objectPositionY === 'number' ? objectPositionY : 0.5;
    const left = Math.max(0, Math.floor((tw - dw) / 2));
    const top = Math.max(0, Math.min(th - dh, Math.round(th * focusY - dh / 2)));

    return sharp(inputPath)
      .resize(tw, th, { fit: 'cover', position: 'centre' })
      .extract({ left, top, width: dw, height: dh })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  }

  const jpgNative = await sharp(jpgPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const modNative = await sharp(modernPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  if (jpgNative.info.width !== modNative.info.width || jpgNative.info.height !== modNative.info.height) {
    throw new Error(`${id} ${label}: dimension mismatch native`);
  }

  const nativeStats = pixelStats(jpgNative.data, modNative.data);

  const jpgDisp = await toDisplayRgba(jpgPath);
  const modDisp = await toDisplayRgba(modernPath);
  const displayStats = pixelStats(jpgDisp.data, modDisp.data);

  // Side-by-side crop for owner approval (display-size)
  fs.mkdirSync(proofDir, { recursive: true });
  const jpgPng = await sharp(jpgDisp.data, {
    raw: { width: jpgDisp.info.width, height: jpgDisp.info.height, channels: 4 }
  })
    .png()
    .toBuffer();
  const modPng = await sharp(modDisp.data, {
    raw: { width: modDisp.info.width, height: modDisp.info.height, channels: 4 }
  })
    .png()
    .toBuffer();
  const sideBySide = await sharp({
    create: {
      width: dw * 2 + 8,
      height: dh,
      channels: 3,
      background: { r: 32, g: 32, b: 32 }
    }
  })
    .composite([
      { input: jpgPng, left: 0, top: 0 },
      { input: modPng, left: dw + 8, top: 0 }
    ])
    .png()
    .toFile(path.join(proofDir, `${id}-${label}-side-by-side.png`));

  // Diff heatmap (amplified)
  const heat = Buffer.alloc(dw * dh * 3);
  for (let i = 0, p = 0; i < jpgDisp.data.length; i += 4, p += 3) {
    const dr = Math.abs(jpgDisp.data[i] - modDisp.data[i]);
    const dg = Math.abs(jpgDisp.data[i + 1] - modDisp.data[i + 1]);
    const db = Math.abs(jpgDisp.data[i + 2] - modDisp.data[i + 2]);
    const mag = Math.min(255, (dr + dg + db) * 8);
    heat[p] = mag;
    heat[p + 1] = mag;
    heat[p + 2] = mag;
  }
  await sharp(heat, { raw: { width: dw, height: dh, channels: 3 } })
    .png()
    .toFile(path.join(proofDir, `${id}-${label}-diff-heat.png`));

  return { nativeStats, displayStats, sideBySide: sideBySide.path || path.join(proofDir, `${id}-${label}-side-by-side.png`) };
}

function pixelStats(a, b) {
  let max = 0;
  let sum = 0;
  let changed = 0;
  const n = a.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    const dr = Math.abs(a[i] - b[i]);
    const dg = Math.abs(a[i + 1] - b[i + 1]);
    const db = Math.abs(a[i + 2] - b[i + 2]);
    const m = Math.max(dr, dg, db);
    max = Math.max(max, m);
    sum += (dr + dg + db) / 3;
    if (m > 0) changed += 1;
  }
  return {
    pixels: n,
    maxChannelDiff: max,
    mae: sum / n,
    changedPct: (changed / n) * 100,
    identical: max === 0
  };
}

async function main() {
  const doDiff = process.argv.includes('--diff');
  const results = [];

  for (const src of MOBILE_POSTER_SOURCES) {
    const encoded = await encodeOne(src.jpg);
    results.push({ id: src.id, ...encoded });
    console.log(
      `${src.id}: ${encoded.width}x${encoded.height} jpg=${encoded.jpgBytes} avif=${encoded.avifBytes} webp=${encoded.webpBytes}`
    );
  }

  if (doDiff) {
    const cabinDisplay = { width: 375, height: 406, scale: 1.35, objectPositionY: 0.35 };
    const valleyDisplay = { width: 375, height: 406, scale: 1.1, objectPositionY: 0.5 };
    const report = [];

    for (const r of results) {
      const display = r.id.startsWith('cabin') ? cabinDisplay : valleyDisplay;
      for (const [label, p] of [
        ['avif', r.avifPath],
        ['webp', r.webpPath]
      ]) {
        const stats = await diffVariant(r.id, r.jpgPath, p, label, display);
        report.push({ id: r.id, format: label, ...stats });
        console.log(
          `DIFF ${r.id} ${label}: native max=${stats.nativeStats.maxChannelDiff} mae=${stats.nativeStats.mae.toFixed(3)} | display max=${stats.displayStats.maxChannelDiff} mae=${stats.displayStats.mae.toFixed(3)} changed=${stats.displayStats.changedPct.toFixed(2)}%`
        );
      }
    }

    fs.writeFileSync(path.join(proofDir, 'diff-report.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(
      path.join(proofDir, 'OWNER_APPROVAL_REQUIRED.txt'),
      [
        'OWNER APPROVAL REQUIRED BEFORE SHIP',
        '',
        'Review side-by-side crops in this folder (*-side-by-side.png).',
        'Left = original JPEG (display simulation). Right = AVIF or WebP decode.',
        'Diff heatmaps (*-diff-heat.png) amplify channel deltas ×8.',
        'Do not merge/deploy poster format switch until owner signs off on visual parity.',
        '',
        `Generated: ${new Date().toISOString()}`,
        `See diff-report.json for numeric stats.`
      ].join('\n')
    );
    console.log(`Proofs → ${proofDir}`);
  }

  console.log('[generate-home-mobile-posters] Done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
