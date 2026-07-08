const fs = require('node:fs');
const path = require('node:path');
const {
  CARD_TOKENS,
  CARD_LAYOUT,
  CARD_ASSETS,
  CARD_LOGO,
  cardAssetUrl,
  cardFontFamily,
  cardFontStyle,
  resolveCardDisplayFields
} = require('../../../shared/giftVoucher/cardSpec');
const { userHtml } = require('../../utils/giftVoucherTextSafe');
const { htmlEscape } = require('../../utils/htmlEscape');
const {
  getOccasionHeadline,
  getCardLabels,
  getBrandLine,
  getBrandLineCircledWord,
  getFormLabels
} = require('../../data/giftVoucherCardCopy');
const { INK_FOOTER } = require('../../../shared/giftVoucher/cardCopy');

const HEADLINE_ATTR = 'data-gv-card-headline';
const BRAND_LINE_ATTR = 'data-gv-card-brand-line';
const FORM_BLOCK_ATTR = 'data-gv-card-form-block';

const CLIENT_PUBLIC_DIR = path.join(__dirname, '../../../client/public');

const assetAvailabilityCache = new Map();

/**
 * Artifact assets are Canva exports produced by the owner. Until a file lands,
 * its slot renders the flat fallback — never substitute artwork.
 */
function isCardAssetAvailable(assetKey) {
  if (assetAvailabilityCache.has(assetKey)) return assetAvailabilityCache.get(assetKey);
  const assetPath = CARD_ASSETS[assetKey];
  const available = Boolean(assetPath) && fs.existsSync(path.join(CLIENT_PUBLIC_DIR, assetPath));
  assetAvailabilityCache.set(assetKey, available);
  return available;
}

function resetCardAssetAvailabilityCacheForTesting() {
  assetAvailabilityCache.clear();
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

function fontCss(role, mode) {
  const style = cardFontStyle(role, mode);
  return `font-family:${cardFontFamily(role, mode)};font-style:${style};`;
}

/**
 * Brand line. Voice: script (Marck Script) on Postcard/Letter, statement
 * (Playfair) on Ink. In print/preview the Letter draws a hand-drawn ellipse
 * stroke (inline SVG) around the "offline" word; email clients skip the SVG.
 */
function buildBrandLineHtml(locale, { voice = 'script', mode, color, sizePx, circled = false } = {}) {
  const line = getBrandLine(locale);
  const size = sizePx || (voice === 'statement' ? CARD_LAYOUT.brandStatementPx : CARD_LAYOUT.brandScriptPx);
  const leading = voice === 'statement' ? 1.08 : 1.3;
  let inner = userHtml(line);

  if (circled && mode !== 'email') {
    const word = getBrandLineCircledWord(locale);
    const idx = line.toLowerCase().indexOf(word.toLowerCase());
    if (idx >= 0) {
      // htmlEscape (not userHtml): fragments keep their surrounding spaces.
      const before = htmlEscape(line.slice(0, idx));
      const target = htmlEscape(line.slice(idx, idx + word.length));
      const after = htmlEscape(line.slice(idx + word.length));
      const circleSvg =
        `<svg viewBox="0 0 120 52" preserveAspectRatio="none" style="position:absolute;left:-10%;top:-22%;width:120%;height:150%;overflow:visible;" aria-hidden="true">` +
        `<path d="M12 27 C 14 10, 58 4, 88 9 C 112 13, 116 30, 96 41 C 72 51, 22 49, 12 36 C 6 29, 10 22, 18 18" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" opacity="0.9"/></svg>`;
      inner = `${before}<span style="position:relative;display:inline-block;white-space:nowrap;">${circleSvg}<span style="position:relative;">${target}</span></span>${after}`;
    }
  }

  return `<p ${BRAND_LINE_ATTR}="1" style="margin:0 0 14px;padding-right:${CARD_LOGO.brandLineClearancePx}px;${fontCss(voice === 'statement' ? 'statement' : 'script', mode)}font-size:${size}px;line-height:${leading};font-weight:${voice === 'statement' ? 600 : 400};color:${color};">${inner}</p>`;
}

/** Occasion headline — small utility-caps voice (Oswald), optional. */
function buildOccasionHtml(occasion, locale, mode, { color } = {}) {
  if (!occasion) return '';
  const headline = getOccasionHeadline(occasion, locale);
  if (!headline) return '';
  return `<p ${HEADLINE_ATTR}="1" style="margin:0 0 10px;${fontCss('utilityCaps', mode)}font-size:${CARD_LAYOUT.occasionPx}px;letter-spacing:0.22em;text-transform:uppercase;font-weight:500;color:${color};">${userHtml(headline)}</p>`;
}

/** The message — Caveat, always the largest text element. */
function buildMessageHtml(message, locale, mode, { color, lineHeight = 1.45 } = {}) {
  const labels = getCardLabels(locale);
  const safe = userHtml(message, labels.defaultMessage);
  return `<p data-gv-card-message="1" style="margin:0 0 10px;${fontCss('message', mode)}font-size:${CARD_LAYOUT.messagePx}px;line-height:${lineHeight};font-weight:500;color:${color};">${safe}</p>`;
}

/** Signature line under the message, handwritten voice. */
function buildSignatureHtml(buyerName, mode, { color } = {}) {
  if (!buyerName) return '';
  return `<p data-gv-card-signature="1" style="margin:0 0 ${CARD_LAYOUT.signatureGapPx}px;${fontCss('message', mode)}font-size:${CARD_LAYOUT.namesPx}px;line-height:1.4;color:${color};">— ${userHtml(buyerName)}</p>`;
}

/**
 * Letter-only pressed-flower accent between signature and form block.
 * Skipped in email mode (decorative image; email stays images-blocked-legible)
 * and when the Canva export has not landed.
 */
function buildLetterFlowerHtml(mode, siteOrigin) {
  if (mode === 'email' || !isCardAssetAvailable('pressedFlower')) return '';
  const url = cardAssetUrl('pressedFlower', { mode, siteOrigin });
  return `<img data-gv-card-flower="1" src="${url}" alt="" aria-hidden="true" style="display:block;margin:0 0 ${CARD_LAYOUT.signatureGapPx}px auto;width:${CARD_LAYOUT.letterFlowerWidthPx}px;height:auto;" />`;
}

/**
 * The voucher form block: TO / VALID UNTIL / CODE / VALUE. Oswald caps labels
 * left, handwritten values on dotted underlines. One function, all templates,
 * all modes — this block is the voucher identity. No outer frame: the dotted
 * underlines are the hand-drawn treatment (a solid rounded frame read like a
 * web form group, and SVG frames do not survive email clients). TO + VALUE
 * are emphasized — the two things a recipient looks for.
 */
function buildFormBlockHtml(fields, locale, mode, { color, mutedColor } = {}) {
  const labels = getFormLabels(locale);
  const rows = [
    { label: labels.to, value: fields.recipientName || '', attr: '', emphasized: true },
    { label: labels.validUntil, value: formatExpiryDate(fields.expiresAt, locale), attr: '' },
    { label: labels.code, value: fields.code, attr: ' data-gv-card-code="1"' },
    {
      label: labels.value,
      value: formatCurrency(fields.amountOriginalCents, fields.currency, locale),
      attr: ` data-gv-card-amount="1" data-gv-font-size="${CARD_LAYOUT.formValueEmphasisPx}"`,
      emphasized: true
    }
  ];

  const labelCss = `${fontCss('utilityCaps', mode)}font-size:${CARD_LAYOUT.formLabelPx}px;letter-spacing:0.18em;text-transform:uppercase;font-weight:500;color:${mutedColor};`;
  const valueCss = (emphasized) =>
    `${fontCss('message', mode)}font-size:${emphasized ? CARD_LAYOUT.formValueEmphasisPx : CARD_LAYOUT.formValuePx}px;line-height:1.3;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:${color};border-bottom:2px dotted ${mutedColor};`;

  const rowsHtml = rows
    .map(
      (row) => `
    <tr>
      <td style="padding:7px 14px 7px 0;vertical-align:bottom;white-space:nowrap;${labelCss}">${userHtml(row.label)}</td>
      <td${row.attr} style="padding:7px 0;vertical-align:bottom;width:100%;${valueCss(row.emphasized)}">${userHtml(row.value)}</td>
    </tr>`
    )
    .join('');

  return `<table ${FORM_BLOCK_ATTR}="1" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">${rowsHtml}</table>`;
}

/** Small utility footer: redeem instruction (Inter). */
function buildRedeemHtml(locale, mode, { color } = {}) {
  const labels = getCardLabels(locale);
  return `<p data-gv-card-redeem="1" style="margin:12px 0 0;${fontCss('smallUtility', mode)}font-size:${CARD_LAYOUT.footerPx}px;line-height:1.5;color:${color};">${userHtml(labels.redeemInstruction)}</p>`;
}

/** Site logo — top right on every template, same width as the former stamp slot. */
function buildCardLogoHtml(variant, mode, siteOrigin) {
  const path = variant === 'white' ? CARD_LOGO.white : CARD_LOGO.dark;
  const url = mode === 'email' ? `${String(siteOrigin).replace(/\/$/, '')}${path}` : path;
  const w = CARD_LOGO.widthPx;
  if (mode === 'email') {
    return `<img data-gv-card-logo="1" src="${url}" alt="${userHtml(CARD_LOGO.alt)}" width="${w}" align="right" style="display:block;width:${w}px;height:auto;margin:0 0 12px auto;" />`;
  }
  return `<img data-gv-card-logo="1" src="${url}" alt="${userHtml(CARD_LOGO.alt)}" width="${w}" style="position:absolute;top:14px;right:16px;width:${w}px;height:auto;" />`;
}

function containerDimensions(mode) {
  if (mode === 'print') {
    return `width:${CARD_LAYOUT.print.width};height:${CARD_LAYOUT.print.height};margin:0 auto;box-sizing:border-box;overflow:hidden;`;
  }
  return 'max-width:600px;width:100%;margin:0 auto;box-sizing:border-box;';
}

function textureBackgroundCss(assetKey, fallbackColor, mode, siteOrigin) {
  // Email mode: textures degrade to solid warm background colors.
  if (mode === 'email' || !isCardAssetAvailable(assetKey)) {
    return `background-color:${fallbackColor};`;
  }
  const url = cardAssetUrl(assetKey, { mode, siteOrigin });
  return `background-color:${fallbackColor};background-image:url('${url}');background-size:cover;background-position:center;`;
}

/**
 * Postcard (stored: forest). Warm paper texture, black line-art mountain scene
 * top third, brand line in script, message in Caveat, form block bottom.
 */
function renderPostcard(fields, locale, mode, siteOrigin) {
  const t = CARD_TOKENS.forest;
  const bg = textureBackgroundCss('paperTexture', t.fallbackBg, mode, siteOrigin);
  const logo = buildCardLogoHtml('dark', mode, siteOrigin);

  const occasion = buildOccasionHtml(fields.occasion, locale, mode, { color: t.muted });
  const brand = buildBrandLineHtml(locale, { voice: 'script', mode, color: t.ink });
  const message = buildMessageHtml(fields.message, locale, mode, { color: t.ink });
  const signature = buildSignatureHtml(fields.buyerName, mode, { color: t.ink });
  const formBlock = buildFormBlockHtml(fields, locale, mode, { color: t.ink, mutedColor: t.muted });
  const redeem = buildRedeemHtml(locale, mode, { color: t.muted });

  const pad = mode === 'print' ? CARD_LAYOUT.print.padding : '32px 28px';
  const positioning = mode === 'email' ? '' : 'position:relative;';

  return `
<div data-gv-card-template="forest" data-gv-card-mode="${mode}" style="${containerDimensions(mode)}${bg}${positioning}padding:${pad};">
  ${logo}
  ${brand}
  ${occasion}
  ${message}
  ${signature}
  ${formBlock}
  ${redeem}
</div>`;
}

/**
 * Letter (stored: romantic). Crumpled paper, script brand line with circled
 * word, message set as a letter with generous spacing, pressed-flower accent
 * above the frameless form block (dotted underlines only).
 */
function renderLetter(fields, locale, mode, siteOrigin) {
  const t = CARD_TOKENS.romantic;
  const bg = textureBackgroundCss('crumpledTexture', t.fallbackBg, mode, siteOrigin);
  const logo = buildCardLogoHtml('dark', mode, siteOrigin);

  const occasion = buildOccasionHtml(fields.occasion, locale, mode, { color: t.warmAccent });
  const brand = buildBrandLineHtml(locale, { voice: 'script', mode, color: t.ink, circled: true });
  const message = buildMessageHtml(fields.message, locale, mode, {
    color: t.ink,
    lineHeight: CARD_LAYOUT.letterLineHeight
  });
  const signature = buildSignatureHtml(fields.buyerName, mode, { color: t.ink });
  const flower = buildLetterFlowerHtml(mode, siteOrigin);
  const formBlock = buildFormBlockHtml(fields, locale, mode, {
    color: t.ink,
    mutedColor: t.muted
  });
  const redeem = buildRedeemHtml(locale, mode, { color: t.muted });

  const pad = mode === 'print' ? CARD_LAYOUT.print.padding : '32px 28px';
  const positioning = mode === 'email' ? '' : 'position:relative;';

  return `
<div data-gv-card-template="romantic" data-gv-card-mode="${mode}" style="${containerDimensions(mode)}${bg}${positioning}padding:${pad};">
  ${logo}
  ${brand}
  ${occasion}
  ${message}
  ${signature}
  ${flower}
  ${formBlock}
  ${redeem}
</div>`;
}

/**
 * Ink (stored: minimal). Solid black, brand line large in Playfair white with
 * tight leading, message in white Caveat, white dotted form block, small-caps
 * footer. Zero image assets; prints on any office printer.
 */
function renderInk(fields, locale, mode, siteOrigin) {
  const t = CARD_TOKENS.minimal;
  const logo = buildCardLogoHtml('white', mode, siteOrigin);

  const occasion = buildOccasionHtml(fields.occasion, locale, mode, { color: t.muted });
  const brand = buildBrandLineHtml(locale, { voice: 'statement', mode, color: t.text });
  const message = buildMessageHtml(fields.message, locale, mode, { color: t.text });
  const signature = buildSignatureHtml(fields.buyerName, mode, { color: t.text });
  const formBlock = buildFormBlockHtml(fields, locale, mode, { color: t.text, mutedColor: t.muted });
  const redeem = buildRedeemHtml(locale, mode, { color: t.muted });
  const footer = `<p data-gv-card-ink-footer="1" style="margin:16px 0 0;${fontCss('utilityCaps', mode)}font-size:11px;letter-spacing:0.3em;text-transform:uppercase;font-weight:500;color:${t.muted};">${userHtml(INK_FOOTER)}</p>`;

  const pad = mode === 'print' ? CARD_LAYOUT.print.padding : '36px 28px';
  const positioning = mode === 'email' ? '' : 'position:relative;';

  return `
<div data-gv-card-template="minimal" data-gv-card-mode="${mode}" style="${containerDimensions(mode)}background-color:${t.bg};${positioning}padding:${pad};">
  ${logo}
  ${brand}
  ${occasion}
  ${message}
  ${signature}
  ${formBlock}
  ${redeem}
  ${footer}
</div>`;
}

const RENDERERS = {
  forest: renderPostcard,
  romantic: renderLetter,
  minimal: renderInk
};

/**
 * Render designed gift voucher card HTML (email or print).
 */
function renderGiftVoucherCard({
  voucher,
  mode = 'email',
  recipientEmail = null,
  siteOrigin = 'https://driftdwells.com'
} = {}) {
  const normalizedMode = mode === 'print' ? 'print' : 'email';
  const fields = resolveCardDisplayFields(voucher, { recipientEmail });
  const renderer = RENDERERS[fields.templateId];
  if (!renderer) {
    throw new Error(`Unsupported card render: ${fields.templateId}/${normalizedMode}`);
  }
  const html = renderer(fields, fields.locale, normalizedMode, siteOrigin).trim();
  return {
    html,
    templateId: fields.templateId,
    locale: fields.locale,
    mode: normalizedMode
  };
}

module.exports = {
  renderGiftVoucherCard,
  isCardAssetAvailable,
  resetCardAssetAvailabilityCacheForTesting,
  HEADLINE_ATTR,
  BRAND_LINE_ATTR,
  FORM_BLOCK_ATTR
};
