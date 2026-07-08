/**
 * Capture 6 EN design-gate PNGs from batch9-release HTML files.
 * Requires: npx playwright install chromium (or system Chrome).
 * Run from server/: node scripts/captureGiftVoucherDesignGateScreenshots.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const GATE_DIR = path.join(__dirname, '../../design-gate/batch9-release');
const SHOT_DIR = path.join(GATE_DIR, 'screenshots');

const EN_FILES = [
  'forest-email-en.html',
  'romantic-email-en.html',
  'minimal-email-en.html',
  'forest-print-en.html',
  'romantic-print-en.html',
  'minimal-print-en.html'
];

async function main() {
  let chromium;
  try {
    ({ chromium } = require('@playwright/test'));
  } catch {
    console.error('Install @playwright/test at repo root to capture screenshots.');
    process.exit(1);
  }

  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });

  for (const file of EN_FILES) {
    const htmlPath = path.join(GATE_DIR, file);
    const pngPath = path.join(SHOT_DIR, file.replace('.html', '.png'));
    await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: pngPath, fullPage: true });
    console.log(`Wrote ${pngPath}`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
