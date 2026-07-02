/**
 * Shared gift voucher card copy — single source for client preview and server renderer.
 * ESM module (mirrors shared/giftVoucher/cardSpec.js).
 */

export const OCCASION_HEADLINES = Object.freeze({
  en: Object.freeze({
    birthday: 'Happy birthday',
    anniversary: 'Happy anniversary',
    thank_you: 'Thank you',
    wedding: 'Congratulations',
    last_minute: 'A thoughtful gift',
    custom: 'A gift for you'
  }),
  bg: Object.freeze({
    birthday: 'Честит рожден ден',
    anniversary: 'Честита годишнина',
    thank_you: 'Благодаря ти',
    wedding: 'Поздравления',
    last_minute: 'Търсен подарък',
    custom: 'Подарък за теб'
  })
});

export const LABELS = Object.freeze({
  en: Object.freeze({
    forLabel: 'For',
    fromLabel: 'From',
    amountLabel: 'Gift value',
    codeLabel: 'Voucher code',
    expiresLabel: 'Valid until',
    redeemInstruction: 'Redeem at driftdwells.com when you are ready to book.',
    brandWordmark: 'Drift & Dwells',
    defaultMessage: 'Enjoy time offline with Drift & Dwells.'
  }),
  bg: Object.freeze({
    forLabel: 'За',
    fromLabel: 'От',
    amountLabel: 'Стойност',
    codeLabel: 'Код на ваучера',
    expiresLabel: 'Валиден до',
    redeemInstruction: 'Използвайте на driftdwells.com, когато сте готови да резервирате.',
    brandWordmark: 'Drift & Dwells',
    defaultMessage: 'Насладете се на време офлайн с Drift & Dwells.'
  })
});

/** Preview-only example content — never submitted in purchase payloads. */
export const PREVIEW_EXAMPLE = Object.freeze({
  recipientName: 'Anna',
  buyerName: 'James',
  message: 'Wishing you peaceful days away from the noise.'
});

export function normalizeCardCopyLocale(locale) {
  return locale === 'bg' ? 'bg' : 'en';
}

export function getOccasionHeadline(occasion, locale) {
  if (!occasion) return null;
  const loc = normalizeCardCopyLocale(locale);
  return OCCASION_HEADLINES[loc][occasion] || OCCASION_HEADLINES.en[occasion] || null;
}

export function getCardLabels(locale) {
  const loc = normalizeCardCopyLocale(locale);
  return LABELS[loc];
}
