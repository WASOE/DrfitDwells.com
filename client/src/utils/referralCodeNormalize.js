/**
 * Mirror of server/models/CreatorPartner.js applyReferralCodeNormalization + REFERRAL_CODE_RE.
 * Used for creator-portal preview so invalid input never looks valid.
 */

const REFERRAL_CODE_RE = /^[a-z0-9_.-]{1,80}$/;

function applyReferralCodeNormalization(raw) {
  if (raw == null) return null;
  let value = String(raw)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .trim()
    .toLowerCase();
  return value || null;
}

/**
 * @returns {string|null} normalized code if valid, otherwise null
 */
export function normalizeReferralCodeForPreview(raw) {
  const value = applyReferralCodeNormalization(raw);
  if (!value || !REFERRAL_CODE_RE.test(value)) return null;
  return value;
}

export { REFERRAL_CODE_RE, applyReferralCodeNormalization };
