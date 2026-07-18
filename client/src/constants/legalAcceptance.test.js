import { describe, expect, it } from 'vitest';
import {
  LEGAL_ACCEPTANCE_CHECKBOX_TEXTS_BY_LOCALE,
  LEGAL_ACCEPTANCE_SUPPORTED_LOCALES,
  buildCheckbox1LinkParts,
  buildLegalAcceptancePayload,
  getLegalAcceptanceCheckboxTexts,
  normalizeLegalAcceptanceLocale
} from './legalAcceptance';

describe('legalAcceptance locale helpers', () => {
  it('normalizes locale codes to supported site languages', () => {
    expect(normalizeLegalAcceptanceLocale('bg')).toBe('bg');
    expect(normalizeLegalAcceptanceLocale('bg-BG')).toBe('bg');
    expect(normalizeLegalAcceptanceLocale('en-US')).toBe('en');
    expect(normalizeLegalAcceptanceLocale('fr')).toBe('en');
    expect(normalizeLegalAcceptanceLocale(undefined)).toBe('en');
  });

  it('exposes checkbox copy for every supported locale', () => {
    for (const locale of LEGAL_ACCEPTANCE_SUPPORTED_LOCALES) {
      const texts = getLegalAcceptanceCheckboxTexts(locale);
      expect(texts.checkbox1.length).toBeGreaterThan(10);
      expect(texts.checkbox2.length).toBeGreaterThan(40);
      expect(texts.checkbox1).toContain(texts.termsLinkLabel);
      expect(texts.checkbox1).toContain(texts.cancellationLinkLabel);
    }
  });

  it('builds BG snapshots that are not English', () => {
    const payload = buildLegalAcceptancePayload({
      agreedToTerms: true,
      agreedToActivityRisk: true,
      locale: 'bg'
    });
    expect(payload.locale).toBe('bg');
    expect(payload.checkbox1TextSnapshot).toBe(
      LEGAL_ACCEPTANCE_CHECKBOX_TEXTS_BY_LOCALE.bg.checkbox1
    );
    expect(payload.checkbox1TextSnapshot).not.toBe(
      LEGAL_ACCEPTANCE_CHECKBOX_TEXTS_BY_LOCALE.en.checkbox1
    );
    expect(payload.checkbox2TextSnapshot).toBe(
      LEGAL_ACCEPTANCE_CHECKBOX_TEXTS_BY_LOCALE.bg.checkbox2
    );
  });

  it('splits checkbox1 into linked parts with labels in order', () => {
    for (const locale of LEGAL_ACCEPTANCE_SUPPORTED_LOCALES) {
      const parts = buildCheckbox1LinkParts(locale);
      const types = parts.map((p) => p.type);
      expect(types).toContain('terms');
      expect(types).toContain('cancellation');
      expect(types.indexOf('terms')).toBeLessThan(types.indexOf('cancellation'));
      const rejoined = parts.map((p) => p.value).join('');
      expect(rejoined).toBe(getLegalAcceptanceCheckboxTexts(locale).checkbox1);
    }
  });
});
