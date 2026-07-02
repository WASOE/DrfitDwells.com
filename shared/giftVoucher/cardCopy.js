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

/**
 * The brand line — appears on every card. Short, declarative, second person.
 * The card never says "voucher" first; the commercial part comes last.
 */
export const BRAND_LINE = Object.freeze({
  en: 'The gift of time offline.',
  bg: 'Подари време офлайн.'
});

/** The word inside the brand line that receives the hand-drawn circle stroke. */
export const BRAND_LINE_CIRCLED_WORD = Object.freeze({
  en: 'offline',
  bg: 'офлайн'
});

/**
 * Voucher form block labels — TO / VALID UNTIL / CODE / VALUE. This block is
 * the voucher identity, shared identically across all templates.
 */
export const FORM_LABELS = Object.freeze({
  en: Object.freeze({
    to: 'TO',
    validUntil: 'VALID UNTIL',
    code: 'CODE',
    value: 'VALUE'
  }),
  bg: Object.freeze({
    to: 'ЗА',
    validUntil: 'ВАЛИДНО ДО',
    code: 'КОД',
    value: 'СТОЙНОСТ'
  })
});

/** Ink template footer — brand handles, identical in both locales. */
export const INK_FOOTER = 'driftdwells.com  ·  @driftdwells';

/** Preview-only example content — never submitted in purchase payloads. */
export const PREVIEW_EXAMPLE = Object.freeze({
  recipientName: 'Anna',
  buyerName: 'James',
  message: Object.freeze({
    en: 'Wishing you peaceful days away from the noise.',
    bg: 'Пожелавам ти спокойни дни далеч от шума.'
  })
});

export function getBrandLine(locale) {
  return BRAND_LINE[normalizeCardCopyLocale(locale)];
}

export function getBrandLineCircledWord(locale) {
  return BRAND_LINE_CIRCLED_WORD[normalizeCardCopyLocale(locale)];
}

export function getFormLabels(locale) {
  return FORM_LABELS[normalizeCardCopyLocale(locale)];
}

export function getPreviewExampleMessage(locale) {
  return PREVIEW_EXAMPLE.message[normalizeCardCopyLocale(locale)];
}

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
