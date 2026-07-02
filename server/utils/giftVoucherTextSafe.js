const { htmlEscape } = require('./htmlEscape');

function userPlain(value, fallback = '') {
  if (value == null) return fallback;
  const trimmed = String(value).trim();
  return trimmed === '' ? fallback : trimmed;
}

function userHtml(value, fallback = '') {
  return htmlEscape(userPlain(value, fallback));
}

/** Strip CR/LF and other control characters before email subject interpolation. */
function subjectSafe(value, fallback = '') {
  const plain = userPlain(value, fallback);
  return plain.replace(/[\x00-\x1F\x7F]/g, '');
}

function resolveRecipientPlain(voucher, recipientEmail) {
  return userPlain(voucher?.recipientName) || userPlain(recipientEmail) || 'Guest';
}

module.exports = {
  userPlain,
  userHtml,
  subjectSafe,
  resolveRecipientPlain
};
