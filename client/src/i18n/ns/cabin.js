import i18n from '../i18nCore';
import cabinEn from '../locales/en/cabin.json';
import cabinBg from '../locales/bg/cabin.json';

function add() {
  if (!i18n.hasResourceBundle('en', 'cabin')) {
    i18n.addResourceBundle('en', 'cabin', cabinEn, true, true);
  }
  if (!i18n.hasResourceBundle('bg', 'cabin')) {
    i18n.addResourceBundle('bg', 'cabin', cabinBg, true, true);
  }
}

add();
