const crypto = require('crypto');

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

/** Values that must never be hashed or sent as phone (craft flow uses "Not provided"). */
const PLACEHOLDER_PHONE_EXACT = new Set(
  [
    'not provided',
    'n/a',
    'na',
    'none',
    'unknown',
    'pending',
    'tbd',
    'tbc',
    '--',
    '-',
    'placeholder'
  ].map((s) => s.toLowerCase())
);

function isPlaceholderPhone(raw) {
  const collapsed = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!collapsed) return true;
  if (PLACEHOLDER_PHONE_EXACT.has(collapsed)) return true;
  if (/^not\s+provided$/i.test(collapsed)) return true;
  const digits = collapsed.replace(/\D/g, '');
  if (digits.length === 0 && collapsed.length < 6) return true;
  return false;
}

/**
 * Meta: digits only, include country code; skip invalid/placeholder.
 * @param {string} phone
 * @returns {string|null}
 */
function normalizePhoneForMeta(phone) {
  if (isPlaceholderPhone(phone)) return null;
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 8) return null;
  return digits;
}

/**
 * Meta: lowercase, trim whitespace; hash UTF-8.
 * @param {string} name
 * @returns {string|null} hex sha256 or null if empty after normalize
 */
function hashNameForMeta(name) {
  const n = String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\s+/g, ' ');
  if (!n) return null;
  return sha256Hex(n);
}

/**
 * @param {object} opts
 * @param {string} opts.email
 * @param {string} [opts.phone]
 * @param {string} [opts.firstName]
 * @param {string} [opts.lastName]
 * @param {string} [opts.clientIp]
 * @param {string} [opts.userAgent]
 * @param {string} [opts.fbp]
 * @param {string} [opts.fbc]
 * @param {boolean} opts.enriched - when false, only em + ip + ua (legacy Purchase)
 * @returns {object} Meta `user_data` object
 */
function buildMetaPurchaseUserData(opts) {
  const email = normalizeEmail(opts.email);
  const userData = {};
  if (email) {
    userData.em = [sha256Hex(email)];
  }
  if (opts.clientIp) {
    userData.client_ip_address = String(opts.clientIp).slice(0, 45);
  }
  if (opts.userAgent) {
    userData.client_user_agent = String(opts.userAgent).slice(0, 512);
  }
  if (!opts.enriched) {
    return userData;
  }
  const ph = normalizePhoneForMeta(opts.phone);
  if (ph) {
    userData.ph = [sha256Hex(ph)];
  }
  const fn = hashNameForMeta(opts.firstName);
  if (fn) {
    userData.fn = [fn];
  }
  const ln = hashNameForMeta(opts.lastName);
  if (ln) {
    userData.ln = [ln];
  }
  const fbp = typeof opts.fbp === 'string' ? opts.fbp.trim() : '';
  if (fbp) {
    userData.fbp = fbp.slice(0, 500);
  }
  const fbc = typeof opts.fbc === 'string' ? opts.fbc.trim() : '';
  if (fbc) {
    userData.fbc = fbc.slice(0, 500);
  }
  return userData;
}

function isMetaCapiPurchaseEnriched() {
  const v = process.env.META_CAPI_PURCHASE_ENRICHED;
  return v === '1' || String(v).toLowerCase() === 'true';
}

module.exports = {
  sha256Hex,
  normalizeEmail,
  isPlaceholderPhone,
  normalizePhoneForMeta,
  hashNameForMeta,
  buildMetaPurchaseUserData,
  isMetaCapiPurchaseEnriched
};
