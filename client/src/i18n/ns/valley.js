import i18n from '../i18nCore';
import valleyEn from '../locales/en/valley.json';
import valleyBg from '../locales/bg/valley.json';

function add() {
  if (!i18n.hasResourceBundle('en', 'valley')) {
    i18n.addResourceBundle('en', 'valley', valleyEn, true, true);
  }
  if (!i18n.hasResourceBundle('bg', 'valley')) {
    i18n.addResourceBundle('bg', 'valley', valleyBg, true, true);
  }
}

add();
