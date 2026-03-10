import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import commonEn from './locales/en/common.json';
import navEn from './locales/en/nav.json';
import homeEn from './locales/en/home.json';
import cabinEn from './locales/en/cabin.json';
import valleyEn from './locales/en/valley.json';
import faqEn from './locales/en/faq.json';
import bookingEn from './locales/en/booking.json';
import legalEn from './locales/en/legal.json';
import aboutEn from './locales/en/about.json';
import seoEn from './locales/en/seo.json';

import commonBg from './locales/bg/common.json';
import navBg from './locales/bg/nav.json';
import homeBg from './locales/bg/home.json';
import cabinBg from './locales/bg/cabin.json';
import valleyBg from './locales/bg/valley.json';
import faqBg from './locales/bg/faq.json';
import bookingBg from './locales/bg/booking.json';
import legalBg from './locales/bg/legal.json';
import aboutBg from './locales/bg/about.json';
import seoBg from './locales/bg/seo.json';

const resources = {
  en: {
    common: commonEn,
    nav: navEn,
    home: homeEn,
    cabin: cabinEn,
    valley: valleyEn,
    faq: faqEn,
    booking: bookingEn,
    legal: legalEn,
    about: aboutEn,
    seo: seoEn
  },
  bg: {
    common: commonBg,
    nav: navBg,
    home: homeBg,
    cabin: cabinBg,
    valley: valleyBg,
    faq: faqBg,
    booking: bookingBg,
    legal: legalBg,
    about: aboutBg,
    seo: seoBg
  }
};

const getInitialLanguage = () => {
  if (typeof window === 'undefined') return 'en';

  const saved = window.localStorage.getItem('dd_language');
  if (saved === 'en' || saved === 'bg') return saved;

  const browserLang = window.navigator.language || window.navigator.userLanguage;
  if (browserLang && browserLang.toLowerCase().startsWith('bg')) return 'bg';

  return 'en';
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: getInitialLanguage(),
    fallbackLng: 'en',
    supportedLngs: ['en', 'bg'],
    ns: ['common', 'nav', 'home', 'cabin', 'valley', 'faq', 'booking', 'legal', 'about', 'seo'],
    defaultNS: 'common',
    interpolation: {
      escapeValue: false
    },
    react: {
      useSuspense: false
    }
  });

export default i18n;

