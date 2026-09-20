import opsCleanerEn from './namespaces/opsCleaner.en.json';
import opsCleanerBg from './namespaces/opsCleaner.bg.json';

export const OPS_UI_LANGUAGES = Object.freeze(['en', 'bg']);
export const DEFAULT_OPS_UI_LANGUAGE = 'en';

const OPS_CLEANER_NAMESPACES = Object.freeze({
  en: opsCleanerEn,
  bg: opsCleanerBg
});

function isCleanerRole(session) {
  return session?.role === 'cleaner';
}

/**
 * Product UI language for Ops.
 * Admin/operator are always English. Cleaner uses session.locale when it is en|bg.
 * Does not read public i18n.language or the browser language.
 */
export function resolveOpsUiLanguage(session) {
  if (!isCleanerRole(session)) {
    return DEFAULT_OPS_UI_LANGUAGE;
  }
  if (session?.locale === 'bg' || session?.locale === 'en') {
    return session.locale;
  }
  return DEFAULT_OPS_UI_LANGUAGE;
}

export function getOpsCleanerMessage(key, language) {
  const lang = language === 'bg' ? 'bg' : 'en';
  const table = OPS_CLEANER_NAMESPACES[lang] || OPS_CLEANER_NAMESPACES.en;
  if (table[key]) return table[key];
  return OPS_CLEANER_NAMESPACES.en[key] || key;
}

export function listOpsCleanerMessageKeys() {
  return Object.keys(OPS_CLEANER_NAMESPACES.en);
}

/**
 * Set documentElement.lang for the Ops shell. Returns a restore function.
 * Does not touch LanguageProvider / i18next.
 */
export function applyOpsDocumentLang(lang) {
  if (typeof document === 'undefined' || !document.documentElement) {
    return () => {};
  }
  const root = document.documentElement;
  const previous = root.getAttribute('lang');
  const next = lang === 'bg' ? 'bg' : 'en';
  root.setAttribute('lang', next);
  return () => {
    if (previous == null) {
      root.removeAttribute('lang');
      return;
    }
    root.setAttribute('lang', previous);
  };
}
