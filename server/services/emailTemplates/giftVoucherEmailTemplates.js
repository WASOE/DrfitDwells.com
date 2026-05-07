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

function buildBuyerReceiptTemplate({ voucher }) {
  const amount = formatCurrency(voucher.amountOriginalCents, voucher.currency);
  const expiresAt = formatDate(voucher.expiresAt);
  const recipient = voucher.recipientName || 'Recipient';
  const delivery = deliveryModeLabel(voucher.deliveryMode);
  const subject = `Payment received - Drift & Dwells gift voucher (${amount})`;
  const html = `
    <h1>The Gift of Time Offline</h1>
    <p>Payment received. Thank you for purchasing a Drift & Dwells gift voucher.</p>
    <p><strong>Voucher amount:</strong> ${amount}</p>
    <p><strong>Recipient:</strong> ${recipient}</p>
    <p><strong>Delivery method:</strong> ${delivery}</p>
    <p><strong>Valid until:</strong> ${expiresAt}</p>
    <p>We will deliver the voucher by email or prepare a physical card depending on the selected delivery mode.</p>
  `;
  const text = `The Gift of Time Offline

Payment received. Thank you for purchasing a Drift & Dwells gift voucher.
Voucher amount: ${amount}
Recipient: ${recipient}
Delivery method: ${delivery}
Valid until: ${expiresAt}

We will deliver the voucher by email or prepare a physical card depending on the selected delivery mode.`;
  return { subject, html, text };
}

function buildRecipientVoucherTemplate({ voucher, recipientEmail }) {
  const amount = formatCurrency(voucher.amountOriginalCents, voucher.currency);
  const expiresAt = formatDate(voucher.expiresAt);
  const recipient = voucher.recipientName || recipientEmail || 'Guest';
  const buyer = voucher.buyerName || 'Someone';
  const code = voucher.code || 'N/A';
  const message = voucher.message || 'Enjoy your stay at Drift & Dwells.';
  const subject = `The Gift of Time Offline - ${amount} for ${recipient}`;
  const html = `
    <h1>The Gift of Time Offline</h1>
    <p><strong>For:</strong> ${recipient}</p>
    <p><strong>From:</strong> ${buyer}</p>
    <p><strong>Message:</strong> ${message}</p>
    <p><strong>Voucher code:</strong> ${code}</p>
    <p><strong>Value:</strong> ${amount}</p>
    <p><strong>Valid until:</strong> ${expiresAt}</p>
    <p><strong>Redeem at:</strong> driftdwells.com</p>
  `;
  const text = `The Gift of Time Offline

For: ${recipient}
From: ${buyer}
Message: ${message}
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
