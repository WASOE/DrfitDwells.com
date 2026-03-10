import { promises as fs } from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const LOCALES_DIR = path.join(__dirname, '..', 'src', 'i18n', 'locales');
const NAMESPACES = ['common', 'nav', 'home', 'cabin', 'valley', 'faq', 'booking', 'legal', 'about', 'seo'];
const LOCALES = ['en', 'bg'];

const readJson = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
};

const flattenKeys = (obj, prefix = '') => {
  return Object.entries(obj).flatMap(([key, value]) => {
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return flattenKeys(value, newKey);
    }
    return [newKey];
  });
};

const main = async () => {
  let hasError = false;

  for (const ns of NAMESPACES) {
    const files = {};
    for (const locale of LOCALES) {
      const filePath = path.join(LOCALES_DIR, locale, `${ns}.json`);
      try {
        files[locale] = await readJson(filePath);
      } catch (err) {
        console.error(`[i18n] Missing file: ${filePath}`);
        hasError = true;
      }
    }

    if (!files.en || !files.bg) continue;

    const enKeys = new Set(flattenKeys(files.en));
    const bgKeys = new Set(flattenKeys(files.bg));

    const missingInBg = [...enKeys].filter((key) => !bgKeys.has(key));
    if (missingInBg.length > 0) {
      console.error(`[i18n] Namespace "${ns}": bg is missing keys:`);
      missingInBg.forEach((k) => console.error(`  - ${k}`));
      hasError = true;
    }
  }

  if (hasError) {
    console.error('[i18n] Missing translation keys detected.');
    process.exit(1);
  } else {
    console.log('[i18n] All translation namespaces are complete for bg.');
  }
};

main().catch((err) => {
  console.error('[i18n] check failed with error:', err);
  process.exit(1);
});

