const OCCASION_HEADLINES = {
  en: {
    birthday: 'Happy birthday',
    anniversary: 'Happy anniversary',
    thank_you: 'Thank you',
    wedding: 'Congratulations',
    last_minute: 'A thoughtful gift',
    custom: 'A gift for you'
  },
  bg: {
    birthday: 'Честит рожден ден',
    anniversary: 'Честита годишнина',
    thank_you: 'Благодаря ти',
    wedding: 'Поздравления',
    last_minute: 'Търсен подарък',
    custom: 'Подарък за теб'
  }
};

const LABELS = {
  en: {
    forLabel: 'For',
    fromLabel: 'From',
    amountLabel: 'Gift value',
    codeLabel: 'Voucher code',
    expiresLabel: 'Valid until',
    redeemInstruction: 'Redeem at driftdwells.com when you are ready to book.',
    brandWordmark: 'Drift & Dwells',
    defaultMessage: 'Enjoy time offline with Drift & Dwells.'
  },
  bg: {
    forLabel: 'За',
    fromLabel: 'От',
    amountLabel: 'Стойност',
    codeLabel: 'Код на ваучера',
    expiresLabel: 'Валиден до',
    redeemInstruction: 'Използвайте на driftdwells.com, когато сте готови да резервирате.',
    brandWordmark: 'Drift & Dwells',
    defaultMessage: 'Насладете се на време офлайн с Drift & Dwells.'
  }
};

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

function getEmailCopy(locale) {
  return EMAIL_COPY[normalizeLocale(locale)];
}

function normalizeLocale(locale) {
  return locale === 'bg' ? 'bg' : 'en';
}

function getOccasionHeadline(occasion, locale) {
  if (!occasion) return null;
  const loc = normalizeLocale(locale);
  return OCCASION_HEADLINES[loc][occasion] || OCCASION_HEADLINES.en[occasion] || null;
}

function getCardLabels(locale) {
  const loc = normalizeLocale(locale);
  return LABELS[loc];
}

module.exports = {
  getOccasionHeadline,
  getCardLabels,
  getEmailCopy,
  OCCASION_HEADLINES,
  LABELS,
  EMAIL_COPY
};
