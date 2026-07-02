const { CARD_BG_ASSET_PATH } = require('../../../shared/giftVoucher/cardSpec');

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

/**
 * Wrap print-mode card fragment in a minimal printable HTML document.
 */
function buildGiftVoucherPrintDocument({ cardHtml, title = 'Drift & Dwells gift voucher' } = {}) {
  const origin = getPublicAppBaseUrl();
  const forestAsset = `${origin}${CARD_BG_ASSET_PATH}`;
  const safeTitle = escapeHtml(title);
  const resolvedCardHtml = String(cardHtml || '').replace(
    `src="${CARD_BG_ASSET_PATH}"`,
    `src="${forestAsset}"`
  );

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
