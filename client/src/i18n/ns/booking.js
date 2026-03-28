import i18n from '../i18nCore';
import bookingEn from '../locales/en/booking.json';
import bookingBg from '../locales/bg/booking.json';

function add() {
  if (!i18n.hasResourceBundle('en', 'booking')) {
    i18n.addResourceBundle('en', 'booking', bookingEn, true, true);
  }
  if (!i18n.hasResourceBundle('bg', 'booking')) {
    i18n.addResourceBundle('bg', 'booking', bookingBg, true, true);
  }
}

add();
