/**
 * Per-locale content overlay for guest-facing cabin/cabin-type payloads.
 *
 * Listings store base (English) text in `name` / `location` / `description`
 * and optional translations under `i18n.bg`. When a guest endpoint receives
 * `locale=bg`, translated values are overlaid onto the base fields; missing
 * or empty translations fall back to the English value, so untranslated
 * listings render exactly as before.
 */

const SUPPORTED_CONTENT_LOCALES = ['en', 'bg'];
const LOCALIZED_CABIN_TEXT_FIELDS = ['name', 'location', 'description'];

const normalizeContentLocale = (raw) => {
  const value = String(raw || '').trim().toLowerCase();
  return value === 'bg' ? 'bg' : 'en';
};

/**
 * Returns a plain object with locale overrides applied.
 * Accepts a mongoose document or a plain object; always returns a plain object
 * (same shape as `doc.toObject()`), so callers can spread the result safely.
 */
const localizeCabinContent = (cabin, locale) => {
  if (!cabin) return cabin;
  const source = typeof cabin.toObject === 'function' ? cabin.toObject() : cabin;
  if (normalizeContentLocale(locale) !== 'bg') {
    return source;
  }

  const translations = (source.i18n && source.i18n.bg) || {};
  const localized = { ...source };
  for (const field of LOCALIZED_CABIN_TEXT_FIELDS) {
    const value = translations[field];
    if (typeof value === 'string' && value.trim()) {
      localized[field] = value;
    }
  }
  return localized;
};

module.exports = {
  SUPPORTED_CONTENT_LOCALES,
  LOCALIZED_CABIN_TEXT_FIELDS,
  normalizeContentLocale,
  localizeCabinContent
};
