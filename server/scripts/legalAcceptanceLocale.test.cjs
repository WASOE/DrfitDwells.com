const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
  LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT,
  LEGAL_ACCEPTANCE_CHECKBOX_TEXTS_BY_LOCALE,
  assertLegalAcceptanceCheckboxSnapshots,
  getLegalAcceptanceCheckboxTexts,
  normalizeLegalAcceptanceLocale
} = require('../config/legalAcceptance');

describe('legalAcceptance locale snapshots', () => {
  it('keeps English aliases aligned with en locale map', () => {
    assert.equal(LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT, LEGAL_ACCEPTANCE_CHECKBOX_TEXTS_BY_LOCALE.en.checkbox1);
    assert.equal(LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT, LEGAL_ACCEPTANCE_CHECKBOX_TEXTS_BY_LOCALE.en.checkbox2);
  });

  it('accepts matching BG snapshots', () => {
    const bg = getLegalAcceptanceCheckboxTexts('bg');
    const result = assertLegalAcceptanceCheckboxSnapshots({
      locale: 'bg',
      checkbox1TextSnapshot: bg.checkbox1,
      checkbox2TextSnapshot: bg.checkbox2
    });
    assert.equal(result.ok, true);
    assert.equal(result.locale, 'bg');
  });

  it('rejects English snapshots when locale is bg', () => {
    const result = assertLegalAcceptanceCheckboxSnapshots({
      locale: 'bg',
      checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
      checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
    });
    assert.equal(result.ok, false);
  });

  it('defaults unknown locale to English validation', () => {
    assert.equal(normalizeLegalAcceptanceLocale('de'), 'en');
    const result = assertLegalAcceptanceCheckboxSnapshots({
      locale: 'de',
      checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
      checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
    });
    assert.equal(result.ok, true);
    assert.equal(result.locale, 'en');
  });
});
