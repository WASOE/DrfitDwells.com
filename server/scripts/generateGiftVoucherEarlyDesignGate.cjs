/**
 * One-off: early design gate renders (print mode, EN). Not part of CI.
 * Run from server/: node scripts/generateGiftVoucherEarlyDesignGate.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { renderGiftVoucherCard } = require('../services/giftVouchers/giftVoucherCardRenderer');

const OUT_DIR = path.join(__dirname, '../../design-gate/early-batch3-print-en');

const SAMPLE_VOUCHER = {
  recipientName: 'Anna',
  buyerName: 'Jose',
  amountOriginalCents: 20000,
  currency: 'EUR',
  cardOccasion: 'birthday',
  cardLocale: 'en',
  message: 'Time offline together.\nA gift for your next escape.',
  code: 'DD-EARLY-2000',
  expiresAt: new Date('2027-06-01T12:00:00.000Z')
};

const TEMPLATES = ['forest', 'romantic', 'minimal'];

function wrapPrintDocument(title, cardHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Playfair+Display:wght@500;600&display=swap" rel="stylesheet" />
  <style>
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
  Early design check — Batch 3 print mode, EN. Sample: Anna / Jose, €200, birthday.
  Open in browser; use Print preview. Formal Batch 9 gate will follow.
  </div>
  ${cardHtml}
</body>
</html>`;
}

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const templateId of TEMPLATES) {
  const { html } = renderGiftVoucherCard({
    voucher: { ...SAMPLE_VOUCHER, cardTemplateId: templateId },
    mode: 'print'
  });
  const doc = wrapPrintDocument(`Gift voucher — ${templateId}`, html)
    .replace(
      'src="/media/gift-vouchers/gift-voucher-card-bg.jpg"',
      'src="../../../client/public/media/gift-vouchers/gift-voucher-card-bg.jpg"'
    );
  const filename = `${templateId}-print-en.html`;
  fs.writeFileSync(path.join(OUT_DIR, filename), doc, 'utf8');
  console.log(`Wrote ${path.join(OUT_DIR, filename)}`);
}
