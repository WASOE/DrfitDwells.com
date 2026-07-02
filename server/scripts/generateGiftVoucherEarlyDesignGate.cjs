/**
 * One-off: design gate renders (print mode, EN + BG). Not part of CI.
 * Run from server/: node scripts/generateGiftVoucherEarlyDesignGate.cjs
 * Assets and fonts resolve relative to client/public so the gate works
 * offline before deploy; missing artifact assets render the flat fallback.
 */
const fs = require('node:fs');
const path = require('node:path');
const { renderGiftVoucherCard } = require('../services/giftVouchers/giftVoucherCardRenderer');
const { CARD_WEBFONTS, CARD_WEBFONT_BASE } = require('../../shared/giftVoucher/cardSpec');

const OUT_DIR = path.join(__dirname, '../../design-gate/card-redesign-print');
const PUBLIC_REL = '../../client/public';

const SAMPLE_VOUCHER = {
  recipientName: 'Anna',
  buyerName: 'Jose',
  amountOriginalCents: 20000,
  currency: 'EUR',
  cardOccasion: 'birthday',
  message: 'Time offline together.\nA gift for your next escape.',
  code: 'DD-EARLY-2000',
  expiresAt: new Date('2027-06-01T12:00:00.000Z')
};

const SAMPLE_MESSAGE_BG = 'Време офлайн заедно.\nПодарък за следващото ти бягство.';

const TEMPLATES = ['forest', 'romantic', 'minimal'];
const LOCALES = ['en', 'bg'];

function buildFontFaces() {
  return CARD_WEBFONTS.map(
    (f) => `@font-face {
      font-family: '${f.family}';
      font-style: normal;
      font-weight: ${f.weight};
      src: url('${PUBLIC_REL}${CARD_WEBFONT_BASE}/${f.file}') format('woff2');
      unicode-range: ${f.unicodeRange};
    }`
  ).join('\n    ');
}

function wrapPrintDocument(title, cardHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Playfair+Display:ital,wght@0,500;0,600;1,500&display=swap" rel="stylesheet" />
  <style>
    ${buildFontFaces()}
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      background: #ebeae6;
      font-family: Inter, system-ui, sans-serif;
    }
    .preview-note {
      max-width: 210mm;
      margin: 0 auto 16px;
      padding: 12px 16px;
      background: #fff;
      border: 1px solid #dedbd4;
      font-size: 13px;
      color: #6b6a64;
      line-height: 1.5;
    }
    @media print {
      body { padding: 0; background: #fff; }
      .preview-note { display: none; }
    }
  </style>
</head>
<body>
  <div class="preview-note">
  Design gate — card redesign print mode. Sample: Anna / Jose, €200, birthday.
  Missing artifact assets render the flat paper fallback until Canva exports land.
  Open in browser; use Print preview.
  </div>
  ${cardHtml}
</body>
</html>`;
}

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const templateId of TEMPLATES) {
  for (const locale of LOCALES) {
    const { html } = renderGiftVoucherCard({
      voucher: {
        ...SAMPLE_VOUCHER,
        cardTemplateId: templateId,
        cardLocale: locale,
        message: locale === 'bg' ? SAMPLE_MESSAGE_BG : SAMPLE_VOUCHER.message
      },
      mode: 'print'
    });
    const doc = wrapPrintDocument(`Gift voucher — ${templateId} (${locale})`, html)
      .replace(/src="\/media\//g, `src="${PUBLIC_REL}/media/`)
      .replace(/url\('\/media\//g, `url('${PUBLIC_REL}/media/`);
    const filename = `${templateId}-print-${locale}.html`;
    fs.writeFileSync(path.join(OUT_DIR, filename), doc, 'utf8');
    console.log(`Wrote ${path.join(OUT_DIR, filename)}`);
  }
}
