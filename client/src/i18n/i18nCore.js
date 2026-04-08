import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import commonEn from './locales/en/common.json';
import navEn from './locales/en/nav.json';
import commonBg from './locales/bg/common.json';
import navBg from './locales/bg/nav.json';
import { getLanguageFromPath } from '../utils/localizedRoutes';

/** Namespaces bundled in the main entry — header + shared UI only. */
const CORE_NS = ['common', 'nav'];

const getInitialLanguage = () => {
  if (typeof window === 'undefined') return 'en';

  const pathLanguage = getLanguageFromPath(window.location.pathname);
  if (pathLanguage === 'bg') return 'bg';

  const saved = window.localStorage.getItem('dd_language');
  if (saved === 'en' || saved === 'bg') return saved;

  const browserLang = window.navigator.language || window.navigator.userLanguage;
  if (browserLang && browserLang.toLowerCase().startsWith('bg')) return 'bg';

  return 'en';
};

const resources = {
  en: { common: commonEn, nav: navEn },
  bg: { common: commonBg, nav: navBg }
};

i18n.use(initReactI18next).init({
  resources,
  lng: getInitialLanguage(),
  fallbackLng: 'en',
  supportedLngs: ['en', 'bg'],
  ns: CORE_NS,
  defaultNS: 'common',
  // JSON uses legacy `key` + `key_plural` pairs (e.g. booking.guestSummary). i18next v21+
  // defaults to v4 ICU suffixes (`_one` / `_other`), which would ignore `_plural`.
  // New keys: keep this pattern unless you migrate the whole repo to v4-style suffixes.
  compatibilityJSON: 'v3',
  interpolation: {
    escapeValue: false
  },
  react: {
    useSuspense: false
  }
});

export default i18n;
