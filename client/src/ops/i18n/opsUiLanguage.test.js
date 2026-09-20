import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import opsCleanerEn from './namespaces/opsCleaner.en.json';
import opsCleanerBg from './namespaces/opsCleaner.bg.json';
import {
  applyOpsDocumentLang,
  getOpsCleanerMessage,
  listOpsCleanerMessageKeys,
  resolveOpsUiLanguage
} from './opsUiLanguage.js';

const REQUIRED_CLEANER_STATUS_KEYS = [
  'status.cleaning.pending',
  'status.cleaning.done',
  'status.cleaning.same_day_turn',
  'status.cleaning_payment.pending',
  'status.cleaning_payment.partial',
  'status.cleaning_payment.paid'
];

describe('resolveOpsUiLanguage', () => {
  it('keeps admin and operator in English even when locale is bg', () => {
    expect(resolveOpsUiLanguage({ role: 'admin', locale: 'bg' })).toBe('en');
    expect(resolveOpsUiLanguage({ role: 'operator', locale: 'bg' })).toBe('en');
  });

  it('uses cleaner session locale when en or bg', () => {
    expect(resolveOpsUiLanguage({ role: 'cleaner', locale: 'bg' })).toBe('bg');
    expect(resolveOpsUiLanguage({ role: 'cleaner', locale: 'en' })).toBe('en');
  });

  it('falls back to English for missing or invalid cleaner locale', () => {
    expect(resolveOpsUiLanguage({ role: 'cleaner' })).toBe('en');
    expect(resolveOpsUiLanguage({ role: 'cleaner', locale: null })).toBe('en');
    expect(resolveOpsUiLanguage({ role: 'cleaner', locale: 'de' })).toBe('en');
    expect(resolveOpsUiLanguage({ role: 'cleaner', locale: 'BG' })).toBe('en');
  });

  it('does not use public i18n language', () => {
    const previous = globalThis.i18n;
    globalThis.i18n = { language: 'bg' };
    expect(resolveOpsUiLanguage({ role: 'admin', locale: null })).toBe('en');
    expect(resolveOpsUiLanguage({ role: 'operator' })).toBe('en');
    globalThis.i18n = previous;
  });
});

describe('cleaner namespaces', () => {
  it('exposes the same required keys in EN and BG', () => {
    expect(Object.keys(opsCleanerEn).sort()).toEqual(Object.keys(opsCleanerBg).sort());
    expect(listOpsCleanerMessageKeys().sort()).toEqual(REQUIRED_CLEANER_STATUS_KEYS.slice().sort());
    for (const key of REQUIRED_CLEANER_STATUS_KEYS) {
      expect(opsCleanerEn[key]).toBeTruthy();
      expect(opsCleanerBg[key]).toBeTruthy();
      expect(String(opsCleanerBg[key]).trim().length).toBeGreaterThan(0);
    }
  });

  it('uses locked Bulgarian cleaner status labels', () => {
    expect(getOpsCleanerMessage('status.cleaning.pending', 'bg')).toBe('За почистване');
    expect(getOpsCleanerMessage('status.cleaning.done', 'bg')).toBe('Почистено');
    expect(getOpsCleanerMessage('status.cleaning.same_day_turn', 'bg')).toBe('Смяна в същия ден');
    expect(getOpsCleanerMessage('status.cleaning_payment.pending', 'bg')).toBe('За плащане');
    expect(getOpsCleanerMessage('status.cleaning_payment.partial', 'bg')).toBe('Частично платено');
    expect(getOpsCleanerMessage('status.cleaning_payment.paid', 'bg')).toBe('Платено');
    expect(getOpsCleanerMessage('status.cleaning.pending', 'en')).toBe('Pending');
  });
});

describe('applyOpsDocumentLang', () => {
  afterEach(() => {
    document.documentElement.setAttribute('lang', 'en');
  });

  it('sets html lang and restores the previous value', () => {
    document.documentElement.setAttribute('lang', 'nl');
    const restore = applyOpsDocumentLang('bg');
    expect(document.documentElement.getAttribute('lang')).toBe('bg');
    restore();
    expect(document.documentElement.getAttribute('lang')).toBe('nl');
  });
});

describe('OpsLayout html lang wiring', () => {
  it('uses the Ops language helper rather than LanguageProvider', () => {
    const layoutPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../layouts/OpsLayout.jsx'
    );
    const layout = fs.readFileSync(layoutPath, 'utf8');
    expect(layout).toContain('resolveOpsUiLanguage');
    expect(layout).toContain('applyOpsDocumentLang');
    expect(layout).not.toContain('useTranslation');
    expect(layout).not.toContain('i18n.language');
  });
});
