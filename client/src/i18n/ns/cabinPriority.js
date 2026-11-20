import i18n from '../i18nCore';
import cabinPriorityEn from '../locales/en/cabinPriority.json';
import cabinPriorityBg from '../locales/bg/cabinPriority.json';

function add() {
  if (!i18n.hasResourceBundle('en', 'cabinPriority')) {
    i18n.addResourceBundle('en', 'cabinPriority', cabinPriorityEn, true, true);
  }
  if (!i18n.hasResourceBundle('bg', 'cabinPriority')) {
    i18n.addResourceBundle('bg', 'cabinPriority', cabinPriorityBg, true, true);
  }
}

add();
