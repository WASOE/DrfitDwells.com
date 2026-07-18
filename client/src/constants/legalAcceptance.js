/**
 * Versioned legal acceptance copy.
 * Must stay in sync with server/config/legalAcceptance.js — locale-specific
 * checkbox text is what we display and what we snapshot on booking create.
 */
export const LEGAL_ACCEPTANCE_TERMS_VERSION = '2026-04-19-v2';
export const LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION = '2026-04-19-v2';

export const LEGAL_ACCEPTANCE_SUPPORTED_LOCALES = Object.freeze(['en', 'bg']);

export const LEGAL_ACCEPTANCE_CHECKBOX_TEXTS_BY_LOCALE = Object.freeze({
  en: Object.freeze({
    checkbox1: 'I have read and accept the Terms & Conditions and Cancellation Policy.',
    checkbox2:
      'I understand that staying at Drift & Dwells and participating in any outdoor or transport activity, including ATV, jeep, horseback, hiking, forest access, mountain terrain, remote access, uneven ground, changing weather, wildlife exposure, navigation risk, and delayed assistance, involves inherent risk of injury, death, getting lost, vehicle damage, property loss, and third-party damage. I accept those inherent risks and agree to follow all instructions, route restrictions, and safety rules.',
    termsLinkLabel: 'Terms & Conditions',
    cancellationLinkLabel: 'Cancellation Policy'
  }),
  bg: Object.freeze({
    checkbox1: 'Прочетох и приемам Общите условия и Политиката за анулации.',
    checkbox2:
      'Разбирам, че престоят в Drift & Dwells и участието във всякакви дейности на открито или транспортни дейности, включително ATV, джип, конна езда, пешеходен туризъм, достъп до гора, планински терен, отдалечен достъп, неравен терен, променливо време, среща с диви животни, риск от объркване на маршрута и забавена помощ, носят присъщ риск от травма, смърт, изгубване, повреда на превозно средство, загуба на имущество и щети на трети лица. Приемам тези присъщи рискове и се съгласявам да следвам всички инструкции, ограничения на маршрутите и правила за безопасност.',
    termsLinkLabel: 'Общите условия',
    cancellationLinkLabel: 'Политиката за анулации'
  })
});

/** @deprecated Prefer getLegalAcceptanceCheckboxTexts(locale).checkbox1 */
export const LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT =
  LEGAL_ACCEPTANCE_CHECKBOX_TEXTS_BY_LOCALE.en.checkbox1;

/** @deprecated Prefer getLegalAcceptanceCheckboxTexts(locale).checkbox2 */
export const LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT =
  LEGAL_ACCEPTANCE_CHECKBOX_TEXTS_BY_LOCALE.en.checkbox2;

export function normalizeLegalAcceptanceLocale(locale) {
  if (!locale) return 'en';
  const base = String(locale).split(/[-_]/)[0].toLowerCase();
  return LEGAL_ACCEPTANCE_SUPPORTED_LOCALES.includes(base) ? base : 'en';
}

export function getLegalAcceptanceCheckboxTexts(locale) {
  const normalized = normalizeLegalAcceptanceLocale(locale);
  return LEGAL_ACCEPTANCE_CHECKBOX_TEXTS_BY_LOCALE[normalized];
}

/**
 * Build the legalAcceptance payload for booking create.
 * Snapshot text always matches the locale the guest saw.
 */
export function buildLegalAcceptancePayload({
  agreedToTerms,
  agreedToActivityRisk,
  locale
}) {
  const normalizedLocale = normalizeLegalAcceptanceLocale(locale);
  const texts = getLegalAcceptanceCheckboxTexts(normalizedLocale);
  return {
    acceptedTermsAndCancellation: !!agreedToTerms,
    acceptedActivityRisk: !!agreedToActivityRisk,
    termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
    activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
    checkbox1TextSnapshot: texts.checkbox1,
    checkbox2TextSnapshot: texts.checkbox2,
    locale: normalizedLocale
  };
}

/**
 * Split checkbox1 plain text into nodes with linked terms/cancellation labels.
 * Labels must appear exactly as substrings of checkbox1 for the locale.
 */
export function buildCheckbox1LinkParts(locale) {
  const texts = getLegalAcceptanceCheckboxTexts(locale);
  const { checkbox1, termsLinkLabel, cancellationLinkLabel } = texts;
  const termsIdx = checkbox1.indexOf(termsLinkLabel);
  const cancellationIdx = checkbox1.indexOf(cancellationLinkLabel);

  if (
    termsIdx < 0 ||
    cancellationIdx < 0 ||
    termsIdx >= cancellationIdx
  ) {
    return [{ type: 'text', value: checkbox1 }];
  }

  return [
    { type: 'text', value: checkbox1.slice(0, termsIdx) },
    { type: 'terms', value: termsLinkLabel },
    {
      type: 'text',
      value: checkbox1.slice(termsIdx + termsLinkLabel.length, cancellationIdx)
    },
    { type: 'cancellation', value: cancellationLinkLabel },
    {
      type: 'text',
      value: checkbox1.slice(cancellationIdx + cancellationLinkLabel.length)
    }
  ];
}
