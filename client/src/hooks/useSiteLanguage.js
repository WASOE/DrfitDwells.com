import { useTranslation } from 'react-i18next';

/**
 * Canonical languages supported by localized routes and resource bundles.
 */
export const SITE_LANGUAGES = ['en', 'bg'];

/**
 * Map i18n language / resolvedLanguage to site language (en | bg).
 * Prefer reading from i18n (resolvedLanguage) rather than re-parsing the URL in components.
 */
export function normalizeSiteLanguage(code) {
  if (!code) return 'en';
  const base = String(code).split('-')[0].toLowerCase();
  if (base === 'bg') return 'bg';
  return 'en';
}

/**
 * Single read-path source of truth for active site language, aligned with i18next.
 * Use {@link useLanguage} from LanguageContext only when you need setLanguage or URL-driven effects.
 */
export function useSiteLanguage() {
  const { i18n } = useTranslation();
  const language = normalizeSiteLanguage(i18n.resolvedLanguage || i18n.language);
  return { language, i18n };
}
