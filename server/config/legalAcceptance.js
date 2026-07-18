/**
 * Versioned legal acceptance copy.
 * Locale-specific checkbox text is the source of truth for both UI display
 * and server-side snapshot validation (what the guest saw must be what we store).
 */
const LEGAL_ACCEPTANCE_TERMS_VERSION = '2026-04-19-v2';
const LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION = '2026-04-19-v2';

const LEGAL_ACCEPTANCE_SUPPORTED_LOCALES = Object.freeze(['en', 'bg']);

const LEGAL_ACCEPTANCE_CHECKBOX_TEXTS_BY_LOCALE = Object.freeze({
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

/** @deprecated Prefer getLegalAcceptanceCheckboxTexts(locale).checkbox1 — English canonical retained for tests/compat. */
const LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT = LEGAL_ACCEPTANCE_CHECKBOX_TEXTS_BY_LOCALE.en.checkbox1;

/** @deprecated Prefer getLegalAcceptanceCheckboxTexts(locale).checkbox2 — English canonical retained for tests/compat. */
const LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT = LEGAL_ACCEPTANCE_CHECKBOX_TEXTS_BY_LOCALE.en.checkbox2;

const LEGAL_ACCEPTANCE_TERMS_URL = '/legal/terms-2026-04-19-v2.pdf';
const LEGAL_ACCEPTANCE_CANCELLATION_URL = '/cancellation-policy';

function normalizeLegalAcceptanceLocale(locale) {
  if (!locale) return 'en';
  const base = String(locale).split(/[-_]/)[0].toLowerCase();
  return LEGAL_ACCEPTANCE_SUPPORTED_LOCALES.includes(base) ? base : 'en';
}

function getLegalAcceptanceCheckboxTexts(locale) {
  const normalized = normalizeLegalAcceptanceLocale(locale);
  return LEGAL_ACCEPTANCE_CHECKBOX_TEXTS_BY_LOCALE[normalized];
}

function assertLegalAcceptanceCheckboxSnapshots({ locale, checkbox1TextSnapshot, checkbox2TextSnapshot }) {
  const expected = getLegalAcceptanceCheckboxTexts(locale);
  if (checkbox1TextSnapshot !== expected.checkbox1) {
    return { ok: false, field: 'checkbox1TextSnapshot' };
  }
  if (checkbox2TextSnapshot !== expected.checkbox2) {
    return { ok: false, field: 'checkbox2TextSnapshot' };
  }
  return { ok: true, locale: normalizeLegalAcceptanceLocale(locale), expected };
}

module.exports = {
  LEGAL_ACCEPTANCE_TERMS_VERSION,
  LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
  LEGAL_ACCEPTANCE_SUPPORTED_LOCALES,
  LEGAL_ACCEPTANCE_CHECKBOX_TEXTS_BY_LOCALE,
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
  LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT,
  LEGAL_ACCEPTANCE_TERMS_URL,
  LEGAL_ACCEPTANCE_CANCELLATION_URL,
  normalizeLegalAcceptanceLocale,
  getLegalAcceptanceCheckboxTexts,
  assertLegalAcceptanceCheckboxSnapshots
};
