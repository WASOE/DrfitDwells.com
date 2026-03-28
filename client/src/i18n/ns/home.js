import i18n from '../i18nCore';
import homeEn from '../locales/en/home.json';
import homeBg from '../locales/bg/home.json';

function add() {
  if (!i18n.hasResourceBundle('en', 'home')) {
    i18n.addResourceBundle('en', 'home', homeEn, true, true);
  }
  if (!i18n.hasResourceBundle('bg', 'home')) {
    i18n.addResourceBundle('bg', 'home', homeBg, true, true);
  }
}

add();
