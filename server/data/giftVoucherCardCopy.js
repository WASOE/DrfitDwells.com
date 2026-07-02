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
  OCCASION_HEADLINES,
  LABELS
};
