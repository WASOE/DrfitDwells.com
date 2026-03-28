import i18n from '../i18nCore';
import seoEn from '../locales/en/seo.json';
import seoBg from '../locales/bg/seo.json';

function add() {
  if (!i18n.hasResourceBundle('en', 'seo')) {
    i18n.addResourceBundle('en', 'seo', seoEn, true, true);
  }
  if (!i18n.hasResourceBundle('bg', 'seo')) {
    i18n.addResourceBundle('bg', 'seo', seoBg, true, true);
  }
}

add();
