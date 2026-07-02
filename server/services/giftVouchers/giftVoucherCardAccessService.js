const crypto = require('crypto');
const GiftVoucher = require('../../models/GiftVoucher');

const TOKEN_BYTE_LENGTH = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DOWNLOADABLE_STATUSES = new Set(['active', 'partially_redeemed']);

const CARD_ACCESS_NOT_FOUND = Object.freeze({
  success: false,
  message: 'Not found'
});

function issueCardAccessToken() {
  const rawToken = crypto.randomBytes(TOKEN_BYTE_LENGTH).toString('base64url');
  const tokenHash = hashCardAccessToken(rawToken);
  return { rawToken, tokenHash };
}

function hashCardAccessToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken), 'utf8').digest('hex');
}

function isValidAccessTokenFormat(rawToken) {
  return typeof rawToken === 'string' && TOKEN_PATTERN.test(rawToken);
}

function getPublicAppBaseUrl() {
  const u = process.env.APP_URL || process.env.VITE_APP_URL || 'https://driftdwells.com';
  return String(u).replace(/\/$/, '');
}

function buildCardDownloadUrl(rawToken) {
  const base = getPublicAppBaseUrl();
  return `${base}/api/gift-vouchers/card/${encodeURIComponent(rawToken)}`;
}

async function revokeCardAccessToken(giftVoucherId) {
  await GiftVoucher.updateOne({ _id: giftVoucherId }, { $unset: { cardAccessTokenHash: 1 } });
}

function voucherFailsCardAccess(voucher) {
  if (!voucher) return true;
  if (!voucher.cardAccessTokenHash) return true;
  if (!DOWNLOADABLE_STATUSES.has(voucher.status)) return true;
  if (voucher.expiresAt) {
    const expiresAtMs = new Date(voucher.expiresAt).getTime();
    if (Number.isNaN(expiresAtMs) || expiresAtMs < Date.now()) return true;
  }
  return false;
}

async function resolveVoucherByCardAccessToken(rawToken) {
  if (!isValidAccessTokenFormat(rawToken)) return null;
  const tokenHash = hashCardAccessToken(rawToken);
  const voucher = await GiftVoucher.findOne({ cardAccessTokenHash: tokenHash }).lean();
  if (voucherFailsCardAccess(voucher)) return null;
  return voucher;
}

module.exports = {
  issueCardAccessToken,
  hashCardAccessToken,
  isValidAccessTokenFormat,
  buildCardDownloadUrl,
  revokeCardAccessToken,
  resolveVoucherByCardAccessToken,
  voucherFailsCardAccess,
  CARD_ACCESS_NOT_FOUND,
  DOWNLOADABLE_STATUSES
};
