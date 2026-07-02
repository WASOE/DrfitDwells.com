/**
 * Shared gift voucher card spec — pure data/constants for client preview and server renderer.
 * ESM module (mirrors shared/messaging/gmaPreviewRules.js).
 */

export const CARD_TEMPLATE_IDS = Object.freeze(['forest', 'romantic', 'minimal']);

export const CARD_OCCASIONS = Object.freeze([
  'birthday',
  'anniversary',
  'thank_you',
  'wedding',
  'last_minute',
  'custom'
]);

export const CARD_LOCALES = Object.freeze(['en', 'bg']);

export const PLACEHOLDER_VOUCHER_CODE = 'XXXX-XXXX';

/**
 * Legacy Batch 3 forest photo derivative. No longer used by templates but the
 * file must stay in client/public forever: already-sent emails hot-link it.
 */
export const CARD_BG_ASSET_PATH = '/media/gift-vouchers/gift-voucher-card-bg.jpg';

export const CARD_BG_ALT = 'Drift & Dwells gift card';

/**
 * Analog artifact assets (Canva exports owned by the business). Templates render
 * a flat fallback (paper #F7F4EE, texture omitted, art slots hidden) until each
 * file lands — do not substitute generated artwork.
 */
export const CARD_ASSET_BASE = '/media/gift-vouchers/card';

export const CARD_ASSETS = Object.freeze({
  paperTexture: `${CARD_ASSET_BASE}/gift-voucher-paper-texture.jpg`,
  crumpledTexture: `${CARD_ASSET_BASE}/gift-voucher-crumpled-texture.jpg`,
  mountainLineArt: `${CARD_ASSET_BASE}/gift-voucher-mountain-lineart.png`,
  stampFrame: `${CARD_ASSET_BASE}/gift-voucher-stamp-frame.png`,
  pressedFlower: `${CARD_ASSET_BASE}/gift-voucher-pressed-flower.png`,
  signpostSketch: `${CARD_ASSET_BASE}/gift-voucher-signpost.png`
});

/**
 * Self-hosted webfonts (Google Fonts OFL, Cyrillic + Latin subsets) under
 * client/public/fonts/gift-voucher/. Caveat is a variable font: one file per
 * subset covers weights 400–700.
 */
export const CARD_WEBFONT_BASE = '/fonts/gift-voucher';

export const CARD_WEBFONTS = Object.freeze([
  { family: 'Marck Script', weight: '400', file: 'marck-script-latin.woff2', unicodeRange: 'U+0000-00FF, U+0131, U+0152-0153, U+2000-206F, U+20AC, U+2122' },
  { family: 'Marck Script', weight: '400', file: 'marck-script-cyrillic.woff2', unicodeRange: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116' },
  { family: 'Caveat', weight: '400 700', file: 'caveat-latin.woff2', unicodeRange: 'U+0000-00FF, U+0131, U+0152-0153, U+2000-206F, U+20AC, U+2122' },
  { family: 'Caveat', weight: '400 700', file: 'caveat-cyrillic.woff2', unicodeRange: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116' },
  { family: 'Oswald', weight: '500', file: 'oswald-latin.woff2', unicodeRange: 'U+0000-00FF, U+0131, U+0152-0153, U+2000-206F, U+20AC, U+2122' },
  { family: 'Oswald', weight: '500', file: 'oswald-cyrillic.woff2', unicodeRange: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116' }
]);

/**
 * Type voices — the contrast between them is the brand:
 *   statement    = Playfair Display (high-contrast serif; brand line on Ink)
 *   script       = Marck Script (signature script; brand line on Postcard/Letter)
 *   message      = Caveat (handwritten; the personal message, always the largest text)
 *   utilityCaps  = Oswald (condensed bold caps; form-block labels, footers)
 *   smallUtility = Inter (clean sans; smallest utility text)
 * Email clients load no custom fonts: script + message fall back to Playfair
 * italic, utilityCaps falls back to Arial bold caps.
 */
export const CARD_FONT_ROLES = Object.freeze({
  statement: {
    family: "'Playfair Display', Georgia, 'Times New Roman', serif",
    email: "'Playfair Display', Georgia, 'Times New Roman', serif",
    emailStyle: 'normal'
  },
  script: {
    family: "'Marck Script', 'Playfair Display', Georgia, cursive",
    email: "'Playfair Display', Georgia, 'Times New Roman', serif",
    emailStyle: 'italic'
  },
  message: {
    family: "'Caveat', 'Playfair Display', Georgia, cursive",
    email: "'Playfair Display', Georgia, 'Times New Roman', serif",
    emailStyle: 'italic'
  },
  utilityCaps: {
    family: "'Oswald', 'Arial Narrow', Arial, sans-serif",
    email: "Arial, Helvetica, sans-serif",
    emailStyle: 'normal'
  },
  smallUtility: {
    family: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
    email: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
    emailStyle: 'normal'
  }
});

export function cardFontFamily(role, mode = 'print') {
  const spec = CARD_FONT_ROLES[role] || CARD_FONT_ROLES.smallUtility;
  return mode === 'email' ? spec.email : spec.family;
}

export function cardFontStyle(role, mode = 'print') {
  const spec = CARD_FONT_ROLES[role] || CARD_FONT_ROLES.smallUtility;
  return mode === 'email' ? spec.emailStyle : 'normal';
}

export const CARD_TOKENS = Object.freeze({
  brandSage: '#81887A',
  brandSageHover: '#6f7669',
  ink: '#1a1918',
  inkMuted: '#6b6a64',
  cream: '#F7F4EE',
  creamLight: '#FAFAF7',
  paper: '#fdfcfa',
  warmHeader: '#f7f5f0',
  outer: '#ebeae6',
  border: '#dedbd4',
  borderSubtle: '#d6d3d1',
  /** Postcard (stored id: forest) — warm paper, black monoline art. */
  forest: {
    fallbackBg: '#F7F4EE',
    ink: '#1a1918',
    muted: '#6b6a64'
  },
  /** Letter (stored id: romantic) — crumpled paper, stamp, hand-drawn strokes. */
  romantic: {
    fallbackBg: '#F7F4EE',
    ink: '#1a1918',
    muted: '#6b6a64',
    warmAccent: '#a8957a'
  },
  /** Ink (stored id: minimal) — solid black cover card. */
  minimal: {
    bg: '#000000',
    text: '#ffffff',
    muted: 'rgba(255, 255, 255, 0.72)',
    rule: 'rgba(255, 255, 255, 0.85)'
  }
});

export const CARD_TYPOGRAPHY = Object.freeze({
  fontSans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
  fontSerif: "'Playfair Display', Georgia, 'Times New Roman', serif",
  trackingKicker: '0.24em',
  trackingButton: '0.18em'
});

/** Inline font sizes (px) — message is always the largest text element. */
export const CARD_LAYOUT = Object.freeze({
  messagePx: 30,
  brandScriptPx: 26,
  brandStatementPx: 38,
  occasionPx: 12,
  namesPx: 20,
  formLabelPx: 11,
  formValuePx: 20,
  footerPx: 11,
  print: {
    width: '210mm',
    height: '148mm',
    padding: '12mm',
    postcardArtRatio: '30%'
  },
  letterLineHeight: 1.8
});

const DEFAULT_SITE_ORIGIN = 'https://driftdwells.com';

export function normalizeCardLocale(value) {
  const v = String(value || 'en').trim().toLowerCase();
  return CARD_LOCALES.includes(v) ? v : 'en';
}

export function resolveCardTemplateId(value) {
  const v = value == null || String(value).trim() === '' ? null : String(value).trim();
  if (!v) return 'minimal';
  return CARD_TEMPLATE_IDS.includes(v) ? v : 'minimal';
}

export function forestBackgroundUrl({ mode, siteOrigin = DEFAULT_SITE_ORIGIN } = {}) {
  const path = CARD_BG_ASSET_PATH;
  if (mode === 'email') {
    const origin = String(siteOrigin || DEFAULT_SITE_ORIGIN).replace(/\/$/, '');
    return `${origin}${path}`;
  }
  return path;
}

/** Resolve an artifact asset URL; email mode needs absolute URLs. */
export function cardAssetUrl(assetKey, { mode, siteOrigin = DEFAULT_SITE_ORIGIN } = {}) {
  const assetPath = CARD_ASSETS[assetKey];
  if (!assetPath) return null;
  if (mode === 'email') {
    const origin = String(siteOrigin || DEFAULT_SITE_ORIGIN).replace(/\/$/, '');
    return `${origin}${assetPath}`;
  }
  return assetPath;
}

export function resolveCardDisplayFields(voucher = {}, { recipientEmail = null } = {}) {
  const templateId = resolveCardTemplateId(voucher.cardTemplateId);
  const locale = normalizeCardLocale(voucher.cardLocale);
  const occasion =
    voucher.cardOccasion && CARD_OCCASIONS.includes(voucher.cardOccasion)
      ? voucher.cardOccasion
      : null;

  return {
    templateId,
    locale,
    occasion,
    recipientName: String(voucher.recipientName || '').trim(),
    buyerName: String(voucher.buyerName || '').trim(),
    message: String(voucher.message || '').trim(),
    amountOriginalCents: Number(voucher.amountOriginalCents || 0),
    currency: String(voucher.currency || 'EUR').toUpperCase(),
    code: voucher.code ? String(voucher.code).trim() : PLACEHOLDER_VOUCHER_CODE,
    expiresAt: voucher.expiresAt || null,
    recipientEmail: recipientEmail || voucher.recipientEmail || null
  };
}
