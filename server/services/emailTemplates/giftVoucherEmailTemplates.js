const { htmlEscape } = require('../../utils/htmlEscape');

function formatCurrency(cents, currency = 'EUR') {
  const amount = Number(cents || 0) / 100;
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: String(currency || 'EUR').toUpperCase()
  }).format(amount);
}

function formatDate(value) {
  if (!value) return 'N/A';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'N/A';
  return d.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function deliveryModeLabel(mode) {
  return mode === 'postal' ? 'Physical card by post' : 'Digital voucher by email';
}

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
  return userPlain(voucher.recipientName) || userPlain(recipientEmail) || 'Guest';
}

function buildBuyerReceiptTemplate({ voucher }) {
  const amount = formatCurrency(voucher.amountOriginalCents, voucher.currency);
  const expiresAt = formatDate(voucher.expiresAt);
  const recipientPlain = userPlain(voucher.recipientName, 'Recipient');
  const recipientHtml = userHtml(voucher.recipientName, 'Recipient');
  const delivery = deliveryModeLabel(voucher.deliveryMode);
  const subject = `Payment received - Drift & Dwells gift voucher (${amount})`;
  const html = `
    <h1>The Gift of Time Offline</h1>
    <p>Payment received. Thank you for purchasing a Drift & Dwells gift voucher.</p>
    <p><strong>Voucher amount:</strong> ${amount}</p>
    <p><strong>Recipient:</strong> ${recipientHtml}</p>
    <p><strong>Delivery method:</strong> ${delivery}</p>
    <p><strong>Valid until:</strong> ${expiresAt}</p>
    <p>We will deliver the voucher by email or prepare a physical card depending on the selected delivery mode.</p>
  `;
  const text = `The Gift of Time Offline

Payment received. Thank you for purchasing a Drift & Dwells gift voucher.
Voucher amount: ${amount}
Recipient: ${recipientPlain}
Delivery method: ${delivery}
Valid until: ${expiresAt}

We will deliver the voucher by email or prepare a physical card depending on the selected delivery mode.`;
  return { subject, html, text };
}

function buildRecipientVoucherTemplate({ voucher, recipientEmail }) {
  const amount = formatCurrency(voucher.amountOriginalCents, voucher.currency);
  const expiresAt = formatDate(voucher.expiresAt);
  const recipientPlain = resolveRecipientPlain(voucher, recipientEmail);
  const recipientHtml =
    userHtml(voucher.recipientName) || userHtml(recipientEmail) || htmlEscape('Guest');
  const buyerPlain = userPlain(voucher.buyerName, 'Someone');
  const buyerHtml = userHtml(voucher.buyerName, 'Someone');
  const messagePlain = userPlain(voucher.message, 'Enjoy your stay at Drift & Dwells.');
  const messageHtml = userHtml(voucher.message, 'Enjoy your stay at Drift & Dwells.');
  const code = voucher.code || 'N/A';
  const recipientSubject = subjectSafe(recipientPlain);
  const subject = `The Gift of Time Offline - ${amount} for ${recipientSubject}`;
  const html = `
    <h1>The Gift of Time Offline</h1>
    <p><strong>For:</strong> ${recipientHtml}</p>
    <p><strong>From:</strong> ${buyerHtml}</p>
    <p><strong>Message:</strong> ${messageHtml}</p>
    <p><strong>Voucher code:</strong> ${code}</p>
    <p><strong>Value:</strong> ${amount}</p>
    <p><strong>Valid until:</strong> ${expiresAt}</p>
    <p><strong>Redeem at:</strong> driftdwells.com</p>
  `;
  const text = `The Gift of Time Offline

For: ${recipientPlain}
From: ${buyerPlain}
Message: ${messagePlain}
Voucher code: ${code}
Value: ${amount}
Valid until: ${expiresAt}
Redeem at: driftdwells.com`;
  return { subject, html, text };
}

function buildRecipientResendTemplate({ voucher, recipientEmail }) {
  const payload = buildRecipientVoucherTemplate({ voucher, recipientEmail });
  return {
    subject: `Resent: ${payload.subject}`,
    html: `${payload.html}<p>This voucher email was resent by our team.</p>`,
    text: `${payload.text}\n\nThis voucher email was resent by our team.`
  };
}

module.exports = {
  buildBuyerReceiptTemplate,
  buildRecipientVoucherTemplate,
  buildRecipientResendTemplate
};
