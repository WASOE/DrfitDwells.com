import i18n from '../i18nCore';
import retreatsEn from '../locales/en/retreats.json';
import retreatsBg from '../locales/bg/retreats.json';

function add() {
  if (!i18n.hasResourceBundle('en', 'retreats')) {
    i18n.addResourceBundle('en', 'retreats', retreatsEn, true, true);
  }
  if (!i18n.hasResourceBundle('bg', 'retreats')) {
    i18n.addResourceBundle('bg', 'retreats', retreatsBg, true, true);
  }
}

add();
