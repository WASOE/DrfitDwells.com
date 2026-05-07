const GiftVoucher = require('../../models/GiftVoucher');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_GROUP_SIZE = 4;
const CODE_GROUP_COUNT = 3;
const CODE_PREFIX = 'DD';

function randomChars(length) {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    const idx = Math.floor(Math.random() * CODE_ALPHABET.length);
    out += CODE_ALPHABET[idx];
  }
  return out;
}

function normalizeVoucherCodeInput(raw) {
  if (raw == null) return null;
  const value = String(raw).trim().toUpperCase();
  return value || null;
}

function generateVoucherCode({ prefix = CODE_PREFIX } = {}) {
  const normalizedPrefix = String(prefix || CODE_PREFIX).trim().toUpperCase();
  const groups = [];
  for (let i = 0; i < CODE_GROUP_COUNT; i += 1) {
    groups.push(randomChars(CODE_GROUP_SIZE));
  }
  return `${normalizedPrefix}-${groups.join('-')}`;
}

function isVoucherCodeFormatValid(code) {
  const normalized = normalizeVoucherCodeInput(code);
  if (!normalized) return false;
  return /^DD-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(normalized);
}

async function generateUniqueVoucherCode({ maxAttempts = 20 } = {}) {
  const safeMax = Math.max(1, Number(maxAttempts) || 20);
  for (let attempt = 1; attempt <= safeMax; attempt += 1) {
    const code = generateVoucherCode();
    // eslint-disable-next-line no-await-in-loop
    const existing = await GiftVoucher.exists({ code });
    if (!existing) {
      return { code, attempts: attempt };
    }
  }
  const err = new Error('Unable to generate a unique voucher code');
  err.code = 'VOUCHER_CODE_GENERATION_FAILED';
  throw err;
}

module.exports = {
  normalizeVoucherCodeInput,
  generateVoucherCode,
  isVoucherCodeFormatValid,
  generateUniqueVoucherCode
};
