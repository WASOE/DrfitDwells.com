const { htmlEscape } = require('../../utils/htmlEscape');
const {
  userPlain,
  userHtml,
  subjectSafe,
  resolveRecipientPlain
} = require('../../utils/giftVoucherTextSafe');
const { buildGuestTransactionalHtml } = require('../emailTemplates/guestLifecycleLayout');
const { renderGiftVoucherCard } = require('./giftVoucherCardRenderer');
const { getCardLabels, getEmailCopy } = require('../../data/giftVoucherCardCopy');
const { normalizeCardLocale } = require('../../../shared/giftVoucher/cardSpec');

const EMAIL_SITE_ORIGIN = (process.env.APP_URL || 'https://driftdwells.com').replace(/\/$/, '');
const INSTAGRAM_URL = (process.env.INSTAGRAM_URL || 'https://www.instagram.com/driftdwells/').trim();
const FACEBOOK_URL = (
  process.env.FACEBOOK_URL || 'https://www.facebook.com/profile.php?id=61569960933269'
).trim();

function resolveBrandLogoAbsoluteUrl() {
  const disable = process.env.EMAIL_BRAND_LOGO_DISABLE;
  if (disable === '1' || disable === 'true' || disable === 'yes') return '';
  const explicit = (process.env.EMAIL_BRAND_LOGO_URL || '').trim();
  if (explicit === '0' || explicit.toLowerCase() === 'off' || explicit.toLowerCase() === 'false') {
    return '';
  }
  if (explicit.startsWith('https://')) return explicit;
  const path = (process.env.EMAIL_BRAND_LOGO_PATH || '/uploads/Logo/DRIFTS-01.png').trim();
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const fallback = (process.env.EMAIL_LOGO_FALLBACK_ORIGIN || 'https://driftdwells.com').replace(
    /\/$/,
    ''
  );
  return `${fallback}${normalized}`;
}

function guestEmailFooterHtml() {
  const terms = `${EMAIL_SITE_ORIGIN}/terms`;
  const privacy = `${EMAIL_SITE_ORIGIN}/privacy`;
  const y = new Date().getFullYear();
  return `
          <div class="footer">
            <p class="footer-tagline">Off-grid eco-retreat · Bulgaria</p>
            <p class="footer-home"><a href="${htmlEscape(EMAIL_SITE_ORIGIN)}">driftdwells.com</a></p>
            <p><a href="${htmlEscape(terms)}">Terms</a> · <a href="${htmlEscape(privacy)}">Privacy</a> · <a href="${htmlEscape(INSTAGRAM_URL)}">Instagram</a> · <a href="${htmlEscape(FACEBOOK_URL)}">Facebook</a></p>
            <p class="footer-legal">© ${y} Drift &amp; Dwells</p>
          </div>`;
}

function formatCurrency(cents, currency = 'EUR', locale = 'en') {
  const amount = Number(cents || 0) / 100;
  const intlLocale = locale === 'bg' ? 'bg-BG' : 'en-IE';
  return new Intl.NumberFormat(intlLocale, {
    style: 'currency',
    currency: String(currency || 'EUR').toUpperCase()
  }).format(amount);
}

function formatExpiryDate(value, locale = 'en') {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const intlLocale = locale === 'bg' ? 'bg-BG' : 'en-GB';
  return d.toLocaleDateString(intlLocale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Europe/Sofia'
  });
}

function cardLocaleFor(voucher) {
  return normalizeCardLocale(voucher?.cardLocale);
}

function buildDownloadCtaHtml(downloadUrl, locale) {
  if (!downloadUrl) return '';
  const copy = getEmailCopy(locale);
  const safeUrl = htmlEscape(downloadUrl);
  return `
    <p style="margin:24px 0 0;text-align:center;">
      <a href="${safeUrl}" style="display:inline-block;padding:12px 20px;background:#81887A;color:#fdfcfa;text-decoration:none;border-radius:8px;font-weight:600;letter-spacing:0.04em;">${userHtml(copy.downloadCta)}</a>
    </p>
    <p style="margin:10px 0 0;text-align:center;font-size:13px;color:#6b6a64;word-break:break-all;">
      <a href="${safeUrl}" style="color:#6b6a64;">${safeUrl}</a>
    </p>`;
}

function buildCardFragmentHtml(voucher) {
  return renderGiftVoucherCard({ voucher, mode: 'email', siteOrigin: EMAIL_SITE_ORIGIN }).html;
}

function wrapDesignedEmail({ subject, preheader, kicker, lead, bodyHtml, locale }) {
  const html = buildGuestTransactionalHtml({
    title: subject,
    preheader,
    logoUrl: resolveBrandLogoAbsoluteUrl(),
    siteHomeUrl: EMAIL_SITE_ORIGIN,
    headerTagline: `<span class="email-kicker">${userHtml(kicker)}</span><span class="email-tagline-lead">${userHtml(lead)}</span>`,
    bodyHtml,
    footerHtml: guestEmailFooterHtml()
  });
  return html;
}

function buildPlainTextFields(voucher, recipientEmail, locale, { downloadUrl = null } = {}) {
  const labels = getCardLabels(locale);
  const recipientPlain = userPlain(voucher.recipientName, 'Recipient');
  const buyerPlain = userPlain(voucher.buyerName, 'Someone');
  const messagePlain = userPlain(voucher.message, labels.defaultMessage);
  const amount = formatCurrency(voucher.amountOriginalCents, voucher.currency, locale);
  const expires = formatExpiryDate(voucher.expiresAt, locale);
  const code = voucher.code || 'N/A';
  return {
    recipientPlain,
    buyerPlain,
    messagePlain,
    amount,
    expires,
    code,
    redeem: labels.redeemInstruction,
    downloadUrl: downloadUrl || null
  };
}

function appendPlainTextLines(lines, fields, { includeNames = true } = {}) {
  if (includeNames) {
    lines.push(`${fields.forLabel || 'For'}: ${fields.recipientPlain}`);
    lines.push(`${fields.fromLabel || 'From'}: ${fields.buyerPlain}`);
  }
  lines.push(`${fields.messageLabel || 'Message'}: ${fields.messagePlain}`);
  lines.push(`${fields.amountLabel || 'Value'}: ${fields.amount}`);
  lines.push(`${fields.codeLabel || 'Voucher code'}: ${fields.code}`);
  lines.push(`${fields.expiresLabel || 'Valid until'}: ${fields.expires}`);
  if (fields.downloadUrl) {
    lines.push(`${fields.downloadLabel || 'Download'}: ${fields.downloadUrl}`);
  }
  lines.push(fields.redeem);
}

function buildBuyerReceiptDesignedEmail({ voucher, cardDownloadUrl = null, variant = null } = {}) {
  const locale = cardLocaleFor(voucher);
  const copy = getEmailCopy(locale);
  const labels = getCardLabels(locale);
  const amount = formatCurrency(voucher.amountOriginalCents, voucher.currency, locale);
  const recipientHtml = userHtml(voucher.recipientName, 'Recipient');
  const expiresHtml = userHtml(formatExpiryDate(voucher.expiresAt, locale));

  let deliveryMethod = copy.deliveryMethodDigital;
  let variantNote = '';
  if (variant === 'postal') {
    deliveryMethod = copy.deliveryMethodPostal;
    variantNote = `<p style="margin:0 0 16px;color:#6b6a64;line-height:1.5;">${userHtml(copy.receiptPostalNote)}</p>`;
  } else if (variant === 'scheduled') {
    deliveryMethod = copy.deliveryMethodScheduled;
    variantNote = `<p style="margin:0 0 16px;color:#6b6a64;line-height:1.5;">${userHtml(copy.receiptScheduledNote)}</p>`;
  }

  const bodyHtml = `
    <p style="margin:0 0 16px;">${userHtml(copy.receiptLead)}</p>
    ${variantNote}
    <p style="margin:0 0 8px;"><strong>${userHtml(labels.amountLabel)}:</strong> ${userHtml(amount)}</p>
    <p style="margin:0 0 8px;"><strong>Recipient:</strong> ${recipientHtml}</p>
    <p style="margin:0 0 8px;"><strong>Delivery:</strong> ${userHtml(deliveryMethod)}</p>
    <p style="margin:0 0 16px;"><strong>${userHtml(labels.expiresLabel)}:</strong> ${expiresHtml}</p>
    ${buildCardFragmentHtml(voucher)}
    ${buildDownloadCtaHtml(cardDownloadUrl, locale)}`;

  const subject = `Payment received - Drift & Dwells gift voucher (${amount})`;
  const fields = buildPlainTextFields(voucher, voucher.buyerEmail, locale, {
    downloadUrl: cardDownloadUrl
  });
  const textLines = [
    copy.receiptLead,
    '',
    `${labels.amountLabel}: ${fields.amount}`,
    `Recipient: ${fields.recipientPlain}`,
    `${labels.fromLabel}: ${fields.buyerPlain}`,
    `Delivery: ${deliveryMethod}`,
    `${labels.expiresLabel}: ${fields.expires}`
  ];
  if (variant === 'postal') textLines.push('', copy.receiptPostalNote);
  if (variant === 'scheduled') textLines.push('', copy.receiptScheduledNote);
  textLines.push('', `${labels.codeLabel}: ${fields.code}`);
  textLines.push(`${labels.messageLabel || 'Message'}: ${fields.messagePlain}`);
  if (cardDownloadUrl) textLines.push(`${copy.downloadLabel}: ${cardDownloadUrl}`);
  textLines.push('', labels.redeemInstruction);

  return {
    subject,
    html: wrapDesignedEmail({
      subject,
      preheader: copy.receiptLead,
      kicker: copy.receiptKicker,
      lead: amount,
      bodyHtml,
      locale
    }),
    text: textLines.join('\n')
  };
}

function buildDesignedGiftCardEmail({
  voucher,
  recipientEmail,
  cardDownloadUrl = null,
  kind = 'recipient'
} = {}) {
  const locale = cardLocaleFor(voucher);
  const copy = getEmailCopy(locale);
  const labels = getCardLabels(locale);
  const amount = formatCurrency(voucher.amountOriginalCents, voucher.currency, locale);
  const recipientPlain = resolveRecipientPlain(voucher, recipientEmail);
  const recipientSubject = subjectSafe(recipientPlain);

  const isBuyerGift = kind === 'buyer_gift_card';
  const kicker = isBuyerGift ? copy.giftCardKicker : copy.recipientKicker;
  const lead = isBuyerGift ? copy.giftCardLead : copy.recipientLead;
  const subject = isBuyerGift
    ? `Your Drift & Dwells gift card (${amount})`
    : `The Gift of Time Offline - ${amount} for ${recipientSubject}`;

  const bodyHtml = `
    ${buildCardFragmentHtml(voucher)}
    ${buildDownloadCtaHtml(cardDownloadUrl, locale)}`;

  const fields = buildPlainTextFields(voucher, recipientEmail, locale, {
    downloadUrl: cardDownloadUrl
  });
  fields.forLabel = labels.forLabel;
  fields.fromLabel = labels.fromLabel;
  fields.messageLabel = 'Message';
  fields.amountLabel = labels.amountLabel;
  fields.codeLabel = labels.codeLabel;
  fields.expiresLabel = labels.expiresLabel;
  fields.downloadLabel = copy.downloadLabel;

  const textLines = [lead, ''];
  appendPlainTextLines(textLines, fields);

  return {
    subject,
    html: wrapDesignedEmail({
      subject,
      preheader: lead,
      kicker,
      lead: recipientPlain,
      bodyHtml,
      locale
    }),
    text: textLines.join('\n')
  };
}

function buildRecipientVoucherDesignedEmail({ voucher, recipientEmail, cardDownloadUrl = null }) {
  return buildDesignedGiftCardEmail({
    voucher,
    recipientEmail,
    cardDownloadUrl,
    kind: 'recipient'
  });
}

function buildBuyerGiftCardDesignedEmail({ voucher, cardDownloadUrl = null }) {
  return buildDesignedGiftCardEmail({
    voucher,
    recipientEmail: voucher.buyerEmail,
    cardDownloadUrl,
    kind: 'buyer_gift_card'
  });
}

function buildRecipientResendDesignedEmail({ voucher, recipientEmail }) {
  const locale = cardLocaleFor(voucher);
  const copy = getEmailCopy(locale);
  const payload = buildDesignedGiftCardEmail({
    voucher,
    recipientEmail,
    cardDownloadUrl: null,
    kind: 'recipient'
  });
  const noteParagraph = `<p style="margin:16px 0 0;color:#6b6a64;">${userHtml(copy.resendNote)}</p>`;
  const html = payload.html.replace('<div class="footer">', `${noteParagraph}<div class="footer">`);
  return {
    subject: `Resent: ${payload.subject}`,
    html,
    text: `${payload.text}\n\n${copy.resendNote}`
  };
}

module.exports = {
  buildBuyerReceiptDesignedEmail,
  buildRecipientVoucherDesignedEmail,
  buildBuyerGiftCardDesignedEmail,
  buildRecipientResendDesignedEmail,
  buildPlainTextFields,
  formatCurrency,
  formatExpiryDate
};
