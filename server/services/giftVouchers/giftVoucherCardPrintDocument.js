const { CARD_WEBFONTS, CARD_WEBFONT_BASE } = require('../../../shared/giftVoucher/cardSpec');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getPublicAppBaseUrl() {
  const u = process.env.APP_URL || process.env.VITE_APP_URL || 'https://driftdwells.com';
  return String(u).replace(/\/$/, '');
}

/** Self-hosted @font-face rules for the card script/handwritten/caps voices. */
function buildCardFontFaces(origin) {
  return CARD_WEBFONTS.map(
    (f) => `@font-face {
      font-family: '${f.family}';
      font-style: normal;
      font-weight: ${f.weight};
      font-display: swap;
      src: url('${origin}${CARD_WEBFONT_BASE}/${f.file}') format('woff2');
      unicode-range: ${f.unicodeRange};
    }`
  ).join('\n    ');
}

/**
 * Wrap print-mode card fragment in a minimal printable HTML document.
 */
function buildGiftVoucherPrintDocument({ cardHtml, title = 'Drift & Dwells gift voucher' } = {}) {
  const origin = getPublicAppBaseUrl();
  const safeTitle = escapeHtml(title);
  // Renderer emits site-relative asset paths in print mode; absolutize so the
  // document works when saved locally or opened from a mail attachment.
  const resolvedCardHtml = String(cardHtml || '')
    .replace(/src="\/media\//g, `src="${origin}/media/`)
    .replace(/url\('\/media\//g, `url('${origin}/media/`);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${safeTitle}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Playfair+Display:ital,wght@0,500;0,600;1,500&display=swap" rel="stylesheet" />
  <style>
    ${buildCardFontFaces(origin)}
    * { box-sizing: border-box; }
    body { margin: 0; padding: 16px; background: #ebeae6; }
    @media print {
      body { padding: 0; background: #fff; }
      @page { size: A5 landscape; margin: 0; }
    }
  </style>
</head>
<body>
${resolvedCardHtml}
</body>
</html>`;
}

module.exports = {
  buildGiftVoucherPrintDocument
};
