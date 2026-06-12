import { promises as fs } from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const LOCALES_DIR = path.join(__dirname, '..', 'src', 'i18n', 'locales');
const NS_LOADERS_DIR = path.join(__dirname, '..', 'src', 'i18n', 'ns');
const NAMESPACES = ['common', 'nav', 'home', 'cabin', 'valley', 'faq', 'booking', 'legal', 'about', 'seo'];
const LOCALES = ['en', 'bg'];

// Namespaces bundled in the core entry (see i18nCore.js CORE_NS).
const CORE_NAMESPACES = ['common', 'nav'];

// Values that are legitimately byte-identical in en and bg (brands, codes,
// times, proper nouns kept in Latin script by design).
const IDENTICAL_VALUE_ALLOWLIST = new Set([
  'Drift & Dwells',
  'Airbnb',
  'Booking.com',
  'TripAdvisor',
  'Instagram',
  'Facebook',
  'WhatsApp',
  'YouTube',
  'Starlink',
  'what3words',
  'ATV',
  'FAQ',
  'OK',
  'Email',
  'EUR',
  'BGN',
  // Language switcher labels are identical by design.
  'EN',
  'BG',
  // Ratings stat: brand names + numbers only.
  '4.95 Airbnb, 9.8 Booking'
]);

const readJson = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
};

const flattenEntries = (obj, prefix = '') => {
  return Object.entries(obj).flatMap(([key, value]) => {
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return flattenEntries(value, newKey);
    }
    return [[newKey, value]];
  });
};

const isTranslatableString = (value) =>
  typeof value === 'string' && /[a-z]/i.test(value);

const main = async () => {
  let hasError = false;
  const fail = (lines) => {
    lines.forEach((l) => console.error(l));
    hasError = true;
  };

  const allFiles = {};
  for (const ns of NAMESPACES) {
    allFiles[ns] = {};
    for (const locale of LOCALES) {
      const filePath = path.join(LOCALES_DIR, locale, `${ns}.json`);
      try {
        allFiles[ns][locale] = await readJson(filePath);
      } catch {
        fail([`[i18n:parity] Missing file: ${filePath}`]);
      }
    }
  }

  // ── Section 1: key parity (en → bg) ─────────────────────────────────────
  for (const ns of NAMESPACES) {
    const files = allFiles[ns];
    if (!files.en || !files.bg) continue;

    const enKeys = new Set(flattenEntries(files.en).map(([k]) => k));
    const bgKeys = new Set(flattenEntries(files.bg).map(([k]) => k));

    const missingInBg = [...enKeys].filter((key) => !bgKeys.has(key));
    if (missingInBg.length > 0) {
      fail([
        `[i18n:parity] Namespace "${ns}": bg is missing keys:`,
        ...missingInBg.map((k) => `  - ${k}`)
      ]);
    }
  }

  // ── Section 2: bg values byte-identical to en (untranslated placeholders) ─
  for (const ns of NAMESPACES) {
    const files = allFiles[ns];
    if (!files.en || !files.bg) continue;

    const enMap = new Map(flattenEntries(files.en));
    const bgMap = new Map(flattenEntries(files.bg));

    const identical = [...bgMap.entries()].filter(([key, bgValue]) => {
      const enValue = enMap.get(key);
      if (typeof bgValue !== 'string' || typeof enValue !== 'string') return false;
      if (bgValue.trim() !== enValue.trim()) return false;
      if (!isTranslatableString(bgValue)) return false; // numbers, symbols, times
      if (IDENTICAL_VALUE_ALLOWLIST.has(bgValue.trim())) return false;
      return true;
    });

    if (identical.length > 0) {
      fail([
        `[i18n:identical] Namespace "${ns}": bg values identical to en (untranslated?):`,
        ...identical.map(([k, v]) => `  - ${k} = "${String(v).slice(0, 80)}"`)
      ]);
    }
  }

  // ── Section 3: empty / whitespace-only bg values ─────────────────────────
  for (const ns of NAMESPACES) {
    const files = allFiles[ns];
    if (!files.en || !files.bg) continue;

    const empty = flattenEntries(files.bg).filter(
      ([, value]) => typeof value === 'string' && value.trim() === ''
    );
    if (empty.length > 0) {
      fail([
        `[i18n:empty] Namespace "${ns}": empty bg values:`,
        ...empty.map(([k]) => `  - ${k}`)
      ]);
    }
  }

  // ── Section 4: orphaned namespaces (translated but never loaded) ─────────
  let loaderNames = [];
  try {
    loaderNames = (await fs.readdir(NS_LOADERS_DIR))
      .filter((f) => f.endsWith('.js'))
      .map((f) => path.basename(f, '.js'));
  } catch {
    fail([`[i18n:orphans] Cannot read ns loaders dir: ${NS_LOADERS_DIR}`]);
  }
  const loaded = new Set([...CORE_NAMESPACES, ...loaderNames]);
  const orphans = NAMESPACES.filter((ns) => allFiles[ns]?.en && !loaded.has(ns));
  if (orphans.length > 0) {
    fail([
      '[i18n:orphans] Namespaces translated in locales/ but never loaded (no src/i18n/ns/*.js loader, not in core bundle):',
      ...orphans.map((ns) => `  - ${ns}.json — translations exist but cannot render; wire a loader or remove`)
    ]);
  }

  if (hasError) {
    console.error('[i18n] FAIL — issues found (sections above: parity / identical / empty / orphans).');
    process.exit(1);
  } else {
    console.log('[i18n] OK — key parity, no identical placeholders, no empty values, no orphaned namespaces.');
  }
};

main().catch((err) => {
  console.error('[i18n] check failed with error:', err);
  process.exit(1);
});
