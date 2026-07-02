import i18n from '../i18nCore';
import giftVoucherEn from '../locales/en/giftVoucher.json';
import giftVoucherBg from '../locales/bg/giftVoucher.json';

function add() {
  if (!i18n.hasResourceBundle('en', 'giftVoucher')) {
    i18n.addResourceBundle('en', 'giftVoucher', giftVoucherEn, true, true);
  }
  if (!i18n.hasResourceBundle('bg', 'giftVoucher')) {
    i18n.addResourceBundle('bg', 'giftVoucher', giftVoucherBg, true, true);
  }
}

add();
