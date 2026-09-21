const LEGAL_ACCEPTANCE_TERMS_VERSION = '2026-04-19-v2';
const LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION = '2026-04-19-v2';

/** Legacy cached-client checkbox1 snapshot (pre-RP6A concise consent). */
const LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT =
  'I have read and accept the Terms & Conditions and Cancellation Policy.';

/**
 * RP6A approved English concise consent (exact deployed ConfirmBooking EN composition).
 * Must remain byte-identical to buildTermsConsentPlainText('en').
 */
const LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT_EN_APPROVED =
  'By completing your booking, you agree to our Terms and Cancellation Policy.';

/**
 * RP6A approved Bulgarian concise consent (exact deployed ConfirmBooking BG composition).
 * Must remain byte-identical to buildTermsConsentPlainText('bg').
 */
const LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT_BG_APPROVED =
  'Завършвайки резервацията, вие се съгласявате с нашите Общи условия и Политика за анулиране.';

/**
 * Exact allowlist for finalizeIntent / booking legalAcceptance.checkbox1TextSnapshot.
 * Exact string match only — no trim, case-fold, or substring acceptance.
 */
const LEGAL_ACCEPTANCE_CHECKBOX_1_ALLOWED_SNAPSHOTS = Object.freeze([
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT_EN_APPROVED,
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT_BG_APPROVED
]);

const _checkbox1AllowSet = new Set(LEGAL_ACCEPTANCE_CHECKBOX_1_ALLOWED_SNAPSHOTS);

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isApprovedCheckbox1TextSnapshot(value) {
  return typeof value === 'string' && _checkbox1AllowSet.has(value);
}

const LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT =
  'I understand that staying at Drift & Dwells and participating in any outdoor or transport activity, including ATV, jeep, horseback, hiking, forest access, mountain terrain, remote access, uneven ground, changing weather, wildlife exposure, navigation risk, and delayed assistance, involves inherent risk of injury, death, getting lost, vehicle damage, property loss, and third-party damage. I accept those inherent risks and agree to follow all instructions, route restrictions, and safety rules.';

const LEGAL_ACCEPTANCE_TERMS_URL = '/legal/terms-2026-04-19-v2.pdf';
const LEGAL_ACCEPTANCE_CANCELLATION_URL = '/cancellation-policy';

module.exports = {
  LEGAL_ACCEPTANCE_TERMS_VERSION,
  LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT_EN_APPROVED,
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT_BG_APPROVED,
  LEGAL_ACCEPTANCE_CHECKBOX_1_ALLOWED_SNAPSHOTS,
  isApprovedCheckbox1TextSnapshot,
  LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT,
  LEGAL_ACCEPTANCE_TERMS_URL,
  LEGAL_ACCEPTANCE_CANCELLATION_URL
};
