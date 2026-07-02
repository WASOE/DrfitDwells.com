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

/** Email/print forest background — dedicated derivative, not the page hero. */
export const CARD_BG_ASSET_PATH = '/media/gift-vouchers/gift-voucher-card-bg.jpg';

export const CARD_BG_ALT = 'Drift & Dwells gift card';

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
  forest: {
    fallbackBg: '#2a3d32',
    overlayTop: 'rgba(26, 40, 32, 0.55)',
    overlayBottom: 'rgba(18, 28, 22, 0.92)',
    text: '#f7f5f0',
    textMuted: 'rgba(247, 245, 240, 0.85)'
  },
  romantic: {
    bg: '#F7F4EE',
    surface: '#fdfcfa',
    rule: '#dedbd4',
    warmAccent: '#a8957a',
    text: '#1a1918',
    frameBorderPx: 1,
    frameGapPx: 6
  },
  minimal: {
    bg: '#ffffff',
    ink: '#1a1918',
    muted: '#6b6a64',
    rule: '#d6d3d1'
  }
});

export const CARD_TYPOGRAPHY = Object.freeze({
  fontSans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
  fontSerif: "'Playfair Display', Georgia, 'Times New Roman', serif",
  trackingKicker: '0.24em',
  trackingButton: '0.18em'
});

/** Inline font sizes (px) — message must exceed amount. */
export const CARD_LAYOUT = Object.freeze({
  messagePx: 28,
  amountPx: 22,
  headlinePx: 11,
  namesPx: 14,
  footerPx: 11,
  codePx: 13,
  print: {
    width: '210mm',
    height: '148mm',
    padding: '12mm',
    forestVisualRatio: '68%'
  },
  romanticMessageBlockPaddingY: '24px'
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
