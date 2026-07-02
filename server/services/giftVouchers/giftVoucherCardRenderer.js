const {
  CARD_TOKENS,
  CARD_TYPOGRAPHY,
  CARD_LAYOUT,
  CARD_BG_ALT,
  forestBackgroundUrl,
  resolveCardDisplayFields
} = require('../../../shared/giftVoucher/cardSpec');
const { userHtml } = require('../../utils/giftVoucherTextSafe');
const { getOccasionHeadline, getCardLabels } = require('../../data/giftVoucherCardCopy');

const HEADLINE_ATTR = 'data-gv-card-headline';

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

function buildHeadlineHtml(occasion, locale, { color, marginBottom = '12px' } = {}) {
  if (!occasion) return '';
  const headline = getOccasionHeadline(occasion, locale);
  if (!headline) return '';
  const safe = userHtml(headline);
  const ink = color || CARD_TOKENS.ink;
  return `<p ${HEADLINE_ATTR}="1" style="margin:0 0 ${marginBottom};font-family:${CARD_TYPOGRAPHY.fontSans};font-size:${CARD_LAYOUT.headlinePx}px;letter-spacing:${CARD_TYPOGRAPHY.trackingKicker};text-transform:uppercase;font-weight:600;color:${ink};">${safe}</p>`;
}

function buildMessageHtml(message, locale, { color, textShadow = 'none', italic = false, marginBottom = '16px' } = {}) {
  const labels = getCardLabels(locale);
  const safe = userHtml(message, labels.defaultMessage);
  const fontStyle = italic ? 'italic' : 'normal';
  return `<p data-gv-card-message="1" style="margin:0 0 ${marginBottom};font-family:${CARD_TYPOGRAPHY.fontSerif};font-size:${CARD_LAYOUT.messagePx}px;line-height:1.45;font-weight:500;font-style:${fontStyle};color:${color};text-shadow:${textShadow};">${safe}</p>`;
}

function wrapRomanticDoubleFrame(innerHtml, t) {
  const border = `${t.frameBorderPx}px solid ${t.warmAccent}`;
  const gap = t.frameGapPx;
  return `<div data-gv-card-romantic-frame="1" style="border:${border};padding:${gap}px;box-sizing:border-box;background:${t.bg};"><div style="border:${border};padding:${CARD_LAYOUT.print.padding};box-sizing:border-box;background:${t.surface};">${innerHtml}</div></div>`;
}

function buildRomanticMessageBlock(headline, message, locale, t) {
  const padY = CARD_LAYOUT.romanticMessageBlockPaddingY;
  return `<div data-gv-card-message-block="1" style="padding:${padY} 8px;text-align:center;">${headline}${message}</div>`;
}

function buildAmountHtml(cents, currency, locale, { color } = {}) {
  const labels = getCardLabels(locale);
  const amount = formatCurrency(cents, currency, locale);
  const safeAmount = userHtml(amount);
  const safeLabel = userHtml(labels.amountLabel);
  return `<p data-gv-card-amount="1" style="margin:0 0 8px;font-family:${CARD_TYPOGRAPHY.fontSans};font-size:${CARD_LAYOUT.amountPx}px;color:${color};"><span style="letter-spacing:${CARD_TYPOGRAPHY.trackingKicker};text-transform:uppercase;font-size:${CARD_LAYOUT.footerPx}px;">${safeLabel}</span><br/><strong style="font-size:${CARD_LAYOUT.amountPx}px;">${safeAmount}</strong></p>`;
}

function buildNamesHtml(fields, labels, { color, mutedColor } = {}) {
  const parts = [];
  if (fields.recipientName) {
    parts.push(
      `<span style="color:${mutedColor || color};">${userHtml(labels.forLabel)}</span> ${userHtml(fields.recipientName)}`
    );
  }
  if (fields.buyerName) {
    parts.push(
      `<span style="color:${mutedColor || color};">${userHtml(labels.fromLabel)}</span> ${userHtml(fields.buyerName)}`
    );
  }
  if (!parts.length) return '';
  return `<p style="margin:0 0 12px;font-family:${CARD_TYPOGRAPHY.fontSans};font-size:${CARD_LAYOUT.namesPx}px;line-height:1.5;color:${color};">${parts.join('<br/>')}</p>`;
}

function buildFooterHtml(fields, labels, locale, { color, mutedColor, onPlainPaper = false } = {}) {
  const code = userHtml(fields.code);
  const expires = userHtml(formatExpiryDate(fields.expiresAt, locale));
  const redeem = userHtml(labels.redeemInstruction);
  const codeLabel = userHtml(labels.codeLabel);
  const expiresLabel = userHtml(labels.expiresLabel);
  const footerColor = onPlainPaper ? CARD_TOKENS.ink : color;
  const footerMuted = onPlainPaper ? CARD_TOKENS.inkMuted : mutedColor;
  const codeStyle = onPlainPaper
    ? `font-family:monospace;font-size:${CARD_LAYOUT.codePx}px;font-weight:700;letter-spacing:0.08em;color:${CARD_TOKENS.ink};border:1px solid ${CARD_TOKENS.minimal.rule};display:inline-block;padding:6px 10px;background:transparent;`
    : `font-family:monospace;font-size:${CARD_LAYOUT.codePx}px;font-weight:700;letter-spacing:0.08em;color:${footerColor};`;
  return `
    <div data-gv-card-footer="1" style="margin-top:${onPlainPaper ? '0' : '16px'};padding-top:12px;font-family:${CARD_TYPOGRAPHY.fontSans};font-size:${CARD_LAYOUT.footerPx}px;color:${footerColor};">
      <p style="margin:0 0 6px;color:${footerMuted};"><span style="text-transform:uppercase;letter-spacing:${CARD_TYPOGRAPHY.trackingKicker};">${codeLabel}</span></p>
      <p style="margin:0 0 10px;"><span style="${codeStyle}">${code}</span></p>
      <p style="margin:0 0 6px;color:${footerMuted};"><span style="text-transform:uppercase;letter-spacing:${CARD_TYPOGRAPHY.trackingKicker};">${expiresLabel}</span> ${expires}</p>
      <p style="margin:8px 0 0;color:${footerMuted};font-size:${CARD_LAYOUT.footerPx}px;line-height:1.45;">${redeem}</p>
    </div>`;
}

function renderForestEmail(fields, labels, locale, siteOrigin) {
  const bgUrl = forestBackgroundUrl({ mode: 'email', siteOrigin });
  const t = CARD_TOKENS.forest;
  const textShadow = '0 1px 3px rgba(0,0,0,0.45)';
  const headline = buildHeadlineHtml(fields.occasion, locale);
  const message = buildMessageHtml(fields.message, locale, { color: t.text, textShadow });
  const names = buildNamesHtml(fields, labels, { color: t.text, mutedColor: t.textMuted });
  const amount = buildAmountHtml(fields.amountOriginalCents, fields.currency, locale, { color: t.text });
  const footer = buildFooterHtml(fields, labels, locale, { color: t.text, mutedColor: t.textMuted });

  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;margin:0 auto;border-collapse:collapse;">
  <tr>
    <td bgcolor="${t.fallbackBg}" background="${bgUrl}" style="background-color:${t.fallbackBg};background-image:url('${bgUrl}');background-size:cover;background-position:center;padding:0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
        <tr>
          <td style="background:${t.overlayTop};padding:32px 28px 20px;">
            ${headline}
            ${message}
            ${names}
          </td>
        </tr>
        <tr>
          <td style="background:${t.overlayBottom};padding:20px 28px 28px;">
            ${amount}
            ${footer}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

function renderForestPrint(fields, labels, locale) {
  const bgPath = forestBackgroundUrl({ mode: 'print' });
  const t = CARD_TOKENS.forest;
  const textShadow = '0 1px 4px rgba(0,0,0,0.65), 0 0 12px rgba(0,0,0,0.35)';
  const headline = buildHeadlineHtml(fields.occasion, locale);
  const message = buildMessageHtml(fields.message, locale, { color: t.text, textShadow });
  const names = buildNamesHtml(fields, labels, { color: t.text, mutedColor: t.textMuted });
  const amount = buildAmountHtml(fields.amountOriginalCents, fields.currency, locale, {
    color: CARD_TOKENS.ink
  });
  const footer = buildFooterHtml(fields, labels, locale, { onPlainPaper: true });
  const print = CARD_LAYOUT.print;

  return `
<div data-gv-card-template="forest" data-gv-card-mode="print" style="width:${print.width};height:${print.height};margin:0 auto;overflow:hidden;font-family:${CARD_TYPOGRAPHY.fontSans};background:${CARD_TOKENS.paper};box-sizing:border-box;display:flex;flex-direction:column;">
  <div style="position:relative;flex:0 0 ${print.forestVisualRatio};min-height:0;overflow:hidden;">
    <img src="${bgPath}" alt="${CARD_BG_ALT}" width="1200" height="800" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;z-index:0;display:block;" />
    <div style="position:relative;z-index:1;padding:${print.padding};box-sizing:border-box;height:100%;display:flex;flex-direction:column;justify-content:flex-end;">
      ${headline}
      ${message}
      ${names}
    </div>
  </div>
  <div style="flex:1 1 auto;padding:${print.padding};padding-top:10px;box-sizing:border-box;background:${CARD_TOKENS.paper};">
    ${amount}
    ${footer}
  </div>
</div>`;
}

function renderRomanticEmail(fields, labels, locale) {
  const t = CARD_TOKENS.romantic;
  const headline = buildHeadlineHtml(fields.occasion, locale, {
    color: t.warmAccent,
    marginBottom: '14px'
  });
  const message = buildMessageHtml(fields.message, locale, { color: t.text, italic: true, marginBottom: '0' });
  const messageBlock = buildRomanticMessageBlock(headline, message, locale, t);
  const names = buildNamesHtml(fields, labels, { color: t.text, mutedColor: CARD_TOKENS.inkMuted });
  const amount = buildAmountHtml(fields.amountOriginalCents, fields.currency, locale, {
    color: CARD_TOKENS.inkMuted
  });
  const footer = buildFooterHtml(fields, labels, locale, { color: t.text, mutedColor: CARD_TOKENS.inkMuted });
  const wordmark = userHtml(labels.brandWordmark);
  const inner = `
      <p style="margin:0 0 16px;text-align:center;font-family:${CARD_TYPOGRAPHY.fontSerif};font-size:18px;color:${t.warmAccent};letter-spacing:0.08em;">${wordmark}</p>
      ${messageBlock}
      ${names ? `<div style="text-align:center;margin:0 0 16px;">${names}</div>` : ''}
      ${amount}
      ${footer}`;

  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;margin:0 auto;border-collapse:collapse;">
  <tr>
    <td style="padding:0;">
      ${wrapRomanticDoubleFrame(inner, t)}
    </td>
  </tr>
</table>`;
}

function renderRomanticPrint(fields, labels, locale) {
  const t = CARD_TOKENS.romantic;
  const print = CARD_LAYOUT.print;
  const headline = buildHeadlineHtml(fields.occasion, locale, {
    color: t.warmAccent,
    marginBottom: '14px'
  });
  const message = buildMessageHtml(fields.message, locale, { color: t.text, italic: true, marginBottom: '0' });
  const messageBlock = buildRomanticMessageBlock(headline, message, locale, t);
  const names = buildNamesHtml(fields, labels, { color: t.text, mutedColor: CARD_TOKENS.inkMuted });
  const amount = buildAmountHtml(fields.amountOriginalCents, fields.currency, locale, {
    color: CARD_TOKENS.inkMuted
  });
  const footer = buildFooterHtml(fields, labels, locale, { color: t.text, mutedColor: CARD_TOKENS.inkMuted });
  const wordmark = userHtml(labels.brandWordmark);
  const inner = `
  <p style="margin:0 0 12px;text-align:center;font-family:${CARD_TYPOGRAPHY.fontSerif};font-size:20px;color:${t.warmAccent};letter-spacing:0.08em;">${wordmark}</p>
  ${messageBlock}
  ${names ? `<div style="text-align:center;margin-bottom:12px;">${names}</div>` : ''}
  ${amount}
  ${footer}`;

  return `
<div data-gv-card-template="romantic" data-gv-card-mode="print" style="width:${print.width};height:${print.height};margin:0 auto;box-sizing:border-box;font-family:${CARD_TYPOGRAPHY.fontSans};">
  ${wrapRomanticDoubleFrame(inner, t)}
</div>`;
}

function renderMinimalEmail(fields, labels, locale) {
  const t = CARD_TOKENS.minimal;
  const headline = buildHeadlineHtml(fields.occasion, locale);
  const message = buildMessageHtml(fields.message, locale, { color: t.ink });
  const names = buildNamesHtml(fields, labels, { color: t.ink, mutedColor: t.muted });
  const amount = buildAmountHtml(fields.amountOriginalCents, fields.currency, locale, { color: t.ink });
  const footer = buildFooterHtml(fields, labels, locale, { color: t.ink, mutedColor: t.muted });

  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;margin:0 auto;border-collapse:collapse;background:${t.bg};border:1px solid ${t.rule};">
  <tr>
    <td style="padding:32px 28px;">
      ${headline}
      ${message}
      ${names}
      <hr style="border:none;border-top:1px solid ${t.rule};margin:20px 0;" />
      ${amount}
      ${footer}
    </td>
  </tr>
</table>`;
}

function renderMinimalPrint(fields, labels, locale) {
  const t = CARD_TOKENS.minimal;
  const print = CARD_LAYOUT.print;
  const headline = buildHeadlineHtml(fields.occasion, locale);
  const message = buildMessageHtml(fields.message, locale, { color: t.ink });
  const names = buildNamesHtml(fields, labels, { color: t.ink, mutedColor: t.muted });
  const amount = buildAmountHtml(fields.amountOriginalCents, fields.currency, locale, { color: t.ink });
  const footer = buildFooterHtml(fields, labels, locale, { color: t.ink, mutedColor: t.muted });

  return `
<div data-gv-card-template="minimal" data-gv-card-mode="print" style="width:${print.width};height:${print.height};margin:0 auto;padding:${print.padding};box-sizing:border-box;background:${t.bg};font-family:${CARD_TYPOGRAPHY.fontSans};border:1px solid ${t.rule};">
  ${headline}
  ${message}
  ${names}
  <hr style="border:none;border-top:1px solid ${t.rule};margin:20px 0;" />
  ${amount}
  ${footer}
</div>`;
}

const RENDERERS = {
  forest: { email: renderForestEmail, print: renderForestPrint },
  romantic: { email: renderRomanticEmail, print: renderRomanticPrint },
  minimal: { email: renderMinimalEmail, print: renderMinimalPrint }
};

/**
 * Render designed gift voucher card HTML (email or print). Not wired to delivery yet (Batch 5).
 */
function renderGiftVoucherCard({
  voucher,
  mode = 'email',
  recipientEmail = null,
  siteOrigin = 'https://driftdwells.com'
} = {}) {
  const normalizedMode = mode === 'print' ? 'print' : 'email';
  const fields = resolveCardDisplayFields(voucher, { recipientEmail });
  const labels = getCardLabels(fields.locale);
  const renderer = RENDERERS[fields.templateId]?.[normalizedMode];
  if (!renderer) {
    throw new Error(`Unsupported card render: ${fields.templateId}/${normalizedMode}`);
  }
  const html = renderer(fields, labels, fields.locale, siteOrigin).trim();
  return {
    html,
    templateId: fields.templateId,
    locale: fields.locale,
    mode: normalizedMode
  };
}

module.exports = {
  renderGiftVoucherCard,
  HEADLINE_ATTR
};
