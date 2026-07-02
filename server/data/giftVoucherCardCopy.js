const {
  getOccasionHeadline,
  getCardLabels,
  getBrandLine,
  getBrandLineCircledWord,
  getFormLabels,
  OCCASION_HEADLINES,
  LABELS,
  BRAND_LINE,
  FORM_LABELS
} = require('../../shared/giftVoucher/cardCopy');

const EMAIL_COPY = {
  en: {
    receiptKicker: 'Payment received',
    receiptLead: 'Thank you for purchasing a Drift & Dwells gift voucher.',
    receiptPostalNote:
      'We will prepare a physical gift card and post it to the address you provided. This email is your payment receipt.',
    receiptScheduledNote:
      'The gift card will be emailed to the recipient on the date you chose. You can save or print a copy below.',
    giftCardKicker: 'A gift for you',
    giftCardLead: 'Your Drift & Dwells gift card is ready.',
    recipientKicker: 'You have received a gift',
    recipientLead: 'Someone sent you time offline with Drift & Dwells.',
    resendNote: 'This gift card email was resent by our team.',
    downloadCta: 'Save or print gift card',
    downloadLabel: 'Download gift card',
    deliveryMethodDigital: 'Digital voucher by email',
    deliveryMethodPostal: 'Physical card by post',
    deliveryMethodScheduled: 'Scheduled email delivery',
    deliveryMethodSendToBuyer: 'Gift card to you'
  },
  bg: {
    receiptKicker: 'Плащането е получено',
    receiptLead: 'Благодарим ви, че закупихте подаръчен ваучер на Drift & Dwells.',
    receiptPostalNote:
      'Ще подготвим физическа подаръчна карта и ще я изпратим на посочения адрес. Този имейл е вашата разписка за плащане.',
    receiptScheduledNote:
      'Подаръчната карта ще бъде изпратена на получателя на избраната от вас дата. Можете да запазите или отпечатате копие по-долу.',
    giftCardKicker: 'Подарък за вас',
    giftCardLead: 'Вашата подаръчна карта на Drift & Dwells е готова.',
    recipientKicker: 'Получихте подарък',
    recipientLead: 'Някой ви изпрати време офлайн с Drift & Dwells.',
    resendNote: 'Този имейл с подаръчна карта беше изпратен повторно от нашия екип.',
    downloadCta: 'Запазете или отпечатайте картата',
    downloadLabel: 'Изтеглете подаръчната карта',
    deliveryMethodDigital: 'Дигитален ваучер по имейл',
    deliveryMethodPostal: 'Физическа карта по пощата',
    deliveryMethodScheduled: 'Планирана доставка по имейл',
    deliveryMethodSendToBuyer: 'Подаръчна карта за вас'
  }
};

function normalizeLocale(locale) {
  return locale === 'bg' ? 'bg' : 'en';
}

function getEmailCopy(locale) {
  return EMAIL_COPY[normalizeLocale(locale)];
}

module.exports = {
  getOccasionHeadline,
  getCardLabels,
  getBrandLine,
  getBrandLineCircledWord,
  getFormLabels,
  getEmailCopy,
  OCCASION_HEADLINES,
  LABELS,
  BRAND_LINE,
  FORM_LABELS,
  EMAIL_COPY
};
