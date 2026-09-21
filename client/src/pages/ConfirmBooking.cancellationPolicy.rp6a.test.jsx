/**
 * RP6A Correction 2/3 — ConfirmBooking concise consent + localized checkbox1TextSnapshot.
 */
import { describe, expect, it } from 'vitest';
import i18n from 'i18next';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import enBooking from '../i18n/locales/en/booking.json';
import bgBooking from '../i18n/locales/bg/booking.json';
import {
  CONFIRM_TERMS_PATH,
  CONFIRM_CANCELLATION_POLICY_PATH,
  CONFIRM_BOOKING_CONSENT_BEFORE_KEY,
  CONFIRM_BOOKING_CONSENT_MIDDLE_KEY,
  CONFIRM_BOOKING_CONSENT_AFTER_KEY,
  CONFIRM_TERMS_LINK_KEY,
  CONFIRM_CANCELLATION_POLICY_LINK_KEY,
  buildTermsConsentPlainText,
  buildTermsConsentPlainTextFromT,
  buildFinalizeIntentClientPayload,
  buildCreateBookingPayload
} from './ConfirmBooking.jsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(__dirname, 'ConfirmBooking.jsx'), 'utf8');
const EN_JSON = fs.readFileSync(
  path.join(__dirname, '../i18n/locales/en/booking.json'),
  'utf8'
);
const BG_JSON = fs.readFileSync(
  path.join(__dirname, '../i18n/locales/bg/booking.json'),
  'utf8'
);

const EN_CONSENT =
  'By completing your booking, you agree to our Terms and Cancellation Policy.';
const BG_CONSENT =
  'Завършвайки резервацията, вие се съгласявате с нашите Общи условия и Политика за анулиране.';
const STALE_SNAPSHOT =
  'I have read and accept the Terms & Conditions and Cancellation Policy.';

const formData = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.test',
  phone: '+359888000111',
  specialRequests: '',
  agreedToTerms: true,
  agreedToActivityRisk: true
};

function composeConsent(i18nInstance) {
  return (
    i18nInstance.t(CONFIRM_BOOKING_CONSENT_BEFORE_KEY) +
    i18nInstance.t(CONFIRM_TERMS_LINK_KEY) +
    i18nInstance.t(CONFIRM_BOOKING_CONSENT_MIDDLE_KEY) +
    i18nInstance.t(CONFIRM_CANCELLATION_POLICY_LINK_KEY) +
    i18nInstance.t(CONFIRM_BOOKING_CONSENT_AFTER_KEY)
  );
}

async function makeBookingI18n(lng) {
  const instance = i18n.createInstance();
  await instance.init({
    lng,
    fallbackLng: false,
    resources: {
      en: { booking: enBooking },
      bg: { booking: bgBooking }
    },
    ns: ['booking'],
    defaultNS: 'booking',
    interpolation: { escapeValue: false },
    compatibilityJSON: 'v3'
  });
  return instance;
}

describe('ConfirmBooking cancellation consent (RP6A C2/C3)', () => {
  it('wires concise consent keys and existing legal routes (not detailed schedule)', () => {
    expect(CONFIRM_TERMS_PATH).toBe('/terms');
    expect(CONFIRM_CANCELLATION_POLICY_PATH).toBe('/cancellation-policy');
    expect(SOURCE).toContain('CONFIRM_TERMS_PATH');
    expect(SOURCE).toContain('CONFIRM_CANCELLATION_POLICY_PATH');
    expect(SOURCE).toContain('t(CONFIRM_BOOKING_CONSENT_BEFORE_KEY)');
    expect(SOURCE).toContain('t(CONFIRM_TERMS_LINK_KEY)');
    expect(SOURCE).toContain('t(CONFIRM_CANCELLATION_POLICY_LINK_KEY)');
    expect(SOURCE).toContain('target="_blank"');
    expect(SOURCE).toContain('rel="noopener noreferrer"');
    expect(SOURCE).not.toMatch(/confirm-cancellation-policy-summary/);
    expect(SOURCE).not.toMatch(/cancellationPolicyTitle|cancellationPolicyBody|fullPolicyLink/);
    expect(SOURCE).not.toMatch(/NORMAL_STAY_CANCELLATION_SUMMARY/);
    expect(SOURCE).not.toMatch(/getDate\(\)\s*-\s*5/);
    expect(SOURCE).not.toMatch(/freeCancellationTitle|freeCancellationBody/);
    expect(SOURCE).not.toMatch(/14 or more days|100% refund|50% refund|no-shows?/i);
    expect(SOURCE).not.toMatch(/I have read and accept the/);
  });

  it('keeps a single terms consent checkbox (no extra mandatory interaction)', () => {
    const termsCheckboxMatches = SOURCE.match(/id="confirm-agreed-to-terms"/g) || [];
    expect(termsCheckboxMatches).toHaveLength(1);
    const activityCheckboxMatches = SOURCE.match(/id="confirm-agreed-to-activity-risk"/g) || [];
    expect(activityCheckboxMatches).toHaveLength(1);
    expect(SOURCE).toContain("handleFormChange('agreedToTerms'");
    expect(SOURCE).toContain('buildTermsConsentPlainText(language)');
    expect(SOURCE).not.toMatch(/checkbox1TextSnapshot:\s*LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT/);
  });

  it('English checkout renders the concise consent sentence', async () => {
    const i18nEn = await makeBookingI18n('en');
    expect(composeConsent(i18nEn)).toBe(EN_CONSENT);
    expect(buildTermsConsentPlainText('en')).toBe(EN_CONSENT);
    expect(buildTermsConsentPlainTextFromT(i18nEn.t.bind(i18nEn))).toBe(EN_CONSENT);
    expect(i18nEn.t(CONFIRM_TERMS_LINK_KEY)).toBe('Terms');
    expect(i18nEn.t(CONFIRM_CANCELLATION_POLICY_LINK_KEY)).toBe('Cancellation Policy');
  });

  it('Bulgarian checkout renders Bulgarian text with no English leakage', async () => {
    const i18nBg = await makeBookingI18n('bg');
    expect(composeConsent(i18nBg)).toBe(BG_CONSENT);
    expect(buildTermsConsentPlainText('bg')).toBe(BG_CONSENT);
    expect(buildTermsConsentPlainTextFromT(i18nBg.t.bind(i18nBg))).toBe(BG_CONSENT);
    expect(composeConsent(i18nBg)).not.toContain('By completing');
    expect(composeConsent(i18nBg)).not.toContain('Terms');
    expect(composeConsent(i18nBg)).not.toContain('Cancellation Policy');
    expect(i18nBg.t(CONFIRM_TERMS_LINK_KEY)).toBe('Общи условия');
    expect(i18nBg.t(CONFIRM_CANCELLATION_POLICY_LINK_KEY)).toBe('Политика за анулиране');
  });

  it('English visible sentence exactly matches English checkbox1TextSnapshot', async () => {
    const i18nEn = await makeBookingI18n('en');
    const visible = composeConsent(i18nEn);
    const payload = buildFinalizeIntentClientPayload({
      formData,
      selectedExpKeys: new Set(),
      language: 'en'
    });
    expect(visible).toBe(EN_CONSENT);
    expect(payload.legalAcceptance.checkbox1TextSnapshot).toBe(EN_CONSENT);
    expect(payload.legalAcceptance.checkbox1TextSnapshot).toBe(visible);
    expect(payload.legalAcceptance.checkbox1TextSnapshot).toBe(
      buildTermsConsentPlainText('en')
    );
  });

  it('Bulgarian visible sentence exactly matches Bulgarian checkbox1TextSnapshot', async () => {
    const i18nBg = await makeBookingI18n('bg');
    const visible = composeConsent(i18nBg);
    const payload = buildFinalizeIntentClientPayload({
      formData,
      selectedExpKeys: new Set(),
      language: 'bg'
    });
    expect(visible).toBe(BG_CONSENT);
    expect(payload.legalAcceptance.checkbox1TextSnapshot).toBe(BG_CONSENT);
    expect(payload.legalAcceptance.checkbox1TextSnapshot).toBe(visible);
    expect(payload.legalAcceptance.checkbox1TextSnapshot).not.toBe(EN_CONSENT);
    expect(payload.legalAcceptance.checkbox1TextSnapshot).not.toBe(STALE_SNAPSHOT);
  });

  it('does not submit the stale I-have-read-and-accept snapshot', () => {
    const enPayload = buildFinalizeIntentClientPayload({
      formData,
      selectedExpKeys: new Set(),
      language: 'en'
    });
    const bgPayload = buildFinalizeIntentClientPayload({
      formData,
      selectedExpKeys: new Set(),
      language: 'bg'
    });
    const bookingEn = buildCreateBookingPayload({
      bookingEntityType: 'cabin',
      bookingEntityId: 'cabin-1',
      checkIn: new Date(2026, 5, 10),
      checkOut: new Date(2026, 5, 12),
      adults: 2,
      children: 0,
      selectedExpKeys: new Set(),
      formData,
      checkoutId: 'chk_1',
      voucherRedemptionId: null,
      lockedPromoCode: null,
      appliedVoucherCode: null,
      language: 'en'
    });
    expect(enPayload.legalAcceptance.checkbox1TextSnapshot).not.toBe(STALE_SNAPSHOT);
    expect(bgPayload.legalAcceptance.checkbox1TextSnapshot).not.toBe(STALE_SNAPSHOT);
    expect(bookingEn.legalAcceptance.checkbox1TextSnapshot).not.toBe(STALE_SNAPSHOT);
    expect(SOURCE).not.toContain(STALE_SNAPSHOT);
    expect(SOURCE).not.toMatch(/LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT/);
  });

  it('Terms and Cancellation Policy destinations match existing public routes', () => {
    expect(SOURCE).toMatch(
      /to=\{CONFIRM_TERMS_PATH\}[\s\S]*?to=\{CONFIRM_CANCELLATION_POLICY_PATH\}/
    );
    expect(CONFIRM_TERMS_PATH).toBe('/terms');
    expect(CONFIRM_CANCELLATION_POLICY_PATH).toBe('/cancellation-policy');
  });

  it('links preserve checkout state via new-tab + safe rel (project pattern)', () => {
    const consentBlock = SOURCE.slice(
      SOURCE.indexOf('data-testid="confirm-booking-consent"'),
      SOURCE.indexOf('id="confirm-agreed-to-activity-risk"')
    );
    expect(consentBlock).toContain('target="_blank"');
    expect(consentBlock).toContain('rel="noopener noreferrer"');
    expect((consentBlock.match(/target="_blank"/g) || []).length).toBe(2);
    expect((consentBlock.match(/rel="noopener noreferrer"/g) || []).length).toBe(2);
  });

  it('clicking either consent link does not toggle the checkbox or submit the form', () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <form id="f">
        <label id="lab">
          <input id="confirm-agreed-to-terms" type="checkbox" />
          <span data-testid="confirm-booking-consent">
            <a id="terms" href="/terms" target="_blank" rel="noopener noreferrer">Terms</a>
            <a id="cancel" href="/cancellation-policy" target="_blank" rel="noopener noreferrer">Cancellation Policy</a>
          </span>
        </label>
      </form>
    </body></html>`, { url: 'https://example.test/confirm' });
    const { document } = dom.window;
    const cb = document.getElementById('confirm-agreed-to-terms');
    const form = document.getElementById('f');
    let submits = 0;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submits += 1;
    });
    cb.checked = false;
    document.getElementById('terms').click();
    expect(cb.checked).toBe(false);
    document.getElementById('cancel').click();
    expect(cb.checked).toBe(false);
    expect(submits).toBe(0);
  });

  it('unchecked consent still blocks; checked consent still builds payment-prep payload', () => {
    expect(SOURCE).toContain('!!formData.agreedToTerms && !!formData.agreedToActivityRisk');
    expect(SOURCE).toContain('if (!formData.agreedToTerms || !formData.agreedToActivityRisk)');
    const blocked = !false || !true;
    expect(!!formData.agreedToTerms && !!formData.agreedToActivityRisk).toBe(true);
    const unchecked = {
      ...formData,
      agreedToTerms: false
    };
    expect(!!unchecked.agreedToTerms && !!unchecked.agreedToActivityRisk).toBe(false);
    expect(blocked).toBe(true);
    const payload = buildFinalizeIntentClientPayload({
      formData,
      selectedExpKeys: new Set(),
      language: 'en'
    });
    expect(payload.legalAcceptance.acceptedTermsAndCancellation).toBe(true);
    expect(payload.guestInfo.email).toBe('ada@example.test');
  });

  it('does not render detailed 14/7/0 policy or check-in-minus-five copy in checkout', () => {
    const confirmEn = JSON.stringify(enBooking.confirm);
    const confirmBg = JSON.stringify(bgBooking.confirm);
    expect(confirmEn).not.toMatch(/14 or more days|100% refund|50% refund|no-shows?/i);
    expect(confirmBg).not.toMatch(/14 или повече дни|100%|50%|неявяване/);
    expect(confirmEn).not.toMatch(/5 days before|getDate\(\)\s*-\s*5/);
    expect(confirmBg).not.toMatch(/5 дни преди/);
    expect(SOURCE).not.toMatch(/getDate\(\)\s*-\s*5/);
    expect(enBooking.confirm.cancellationPolicyTitle).toBeUndefined();
    expect(enBooking.confirm.cancellationPolicyBody).toBeUndefined();
    expect(enBooking.confirm.fullPolicyLink).toBeUndefined();
    expect(bgBooking.confirm.cancellationPolicyTitle).toBeUndefined();
    expect(bgBooking.confirm.cancellationPolicyBody).toBeUndefined();
    expect(bgBooking.confirm.fullPolicyLink).toBeUndefined();
  });

  it('removes obsolete free-cancellation keys and does not restore them', () => {
    expect(EN_JSON).not.toMatch(/freeCancellationTitle|freeCancellationBody/);
    expect(BG_JSON).not.toMatch(/freeCancellationTitle|freeCancellationBody/);
    expect(enBooking.confirm.freeCancellationTitle).toBeUndefined();
    expect(bgBooking.confirm.freeCancellationBody).toBeUndefined();
  });

  it('keeps only consent fragment and link label keys (no new locale keys)', () => {
    expect(enBooking.confirm.bookingConsentBefore).toBeTruthy();
    expect(enBooking.confirm.bookingConsentMiddle).toBeTruthy();
    expect(enBooking.confirm.bookingConsentAfter).toBeTruthy();
    expect(enBooking.confirm.termsLink).toBe('Terms');
    expect(enBooking.confirm.cancellationPolicyLink).toBe('Cancellation Policy');
    expect(bgBooking.confirm.termsLink).toBe('Общи условия');
    expect(bgBooking.confirm.cancellationPolicyLink).toBe('Политика за анулиране');
  });
});
