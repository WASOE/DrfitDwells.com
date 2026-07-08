/**
 * Batch 9 design gate — frozen card design at release (commit recorded in README).
 * Run from server/: node scripts/generateGiftVoucherDesignGate.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { renderGiftVoucherCard } = require('../services/giftVouchers/giftVoucherCardRenderer');
const { buildGiftVoucherPrintDocument } = require('../services/giftVouchers/giftVoucherCardPrintDocument');
const { buildRecipientVoucherDesignedEmail } = require('../services/giftVouchers/giftVoucherDesignedEmailBuilder');
const { buildCardDownloadUrl } = require('../services/giftVouchers/giftVoucherCardAccessService');

const OUT_DIR = path.join(__dirname, '../../design-gate/batch9-release');
const PUBLIC_REL = '../../client/public';
const GATE_COMMIT = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
// Amended post-launch with the mobile polish pass (card-as-object, brand
// line layout, form block treatment) — see decisions doc, Batch 9.
const CARD_DESIGN_FREEZE_COMMIT = '612eba0';

const SAMPLE_VOUCHER = {
  recipientName: 'Anna',
  buyerName: 'Jose',
  amountOriginalCents: 20000,
  currency: 'EUR',
  cardOccasion: 'birthday',
  message: 'Time offline together.\nA gift for your next escape.',
  code: 'DD-GATE-2000',
  expiresAt: new Date('2027-06-01T12:00:00.000Z')
};

const SAMPLE_MESSAGE_BG = 'Време офлайн заедно.\nПодарък за следващото ти бягство.';

const TEMPLATES = ['forest', 'romantic', 'minimal'];
const LOCALES = ['en', 'bg'];
const FULL_EMAIL_TEMPLATE = 'romantic';
const SAMPLE_DOWNLOAD_TOKEN = 'GATE_SAMPLE_DOWNLOAD_TOKEN_PLACEHOLDER_00000000001';

function absolutizeAssetPaths(html) {
  return String(html || '')
    .replace(/src="\/media\//g, `src="${PUBLIC_REL}/media/`)
    .replace(/url\('\/media\//g, `url('${PUBLIC_REL}/media/`)
    .replace(/url\("\/media\//g, `url("${PUBLIC_REL}/media/`);
}

function wrapEmailFragmentPreview(title, cardHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 24px; background: #ebeae6; font-family: Inter, system-ui, sans-serif; }
    .preview-note {
      max-width: 640px; margin: 0 auto 16px; padding: 12px 16px;
      background: #fff; border: 1px solid #dedbd4; font-size: 13px; color: #6b6a64; line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="preview-note">
    Design gate — email-mode <strong>card fragment</strong> only (not the full assembled email).
    For the complete recipient email see <code>romantic-email-full-*.html</code>.
    Open locally; compare against release gate ${GATE_COMMIT} (card design frozen at ${CARD_DESIGN_FREEZE_COMMIT}).
  </div>
  ${cardHtml}
</body>
</html>`;
}

function writeFile(filename, html) {
  const fullPath = path.join(OUT_DIR, filename);
  fs.writeFileSync(fullPath, html, 'utf8');
  console.log(`Wrote ${fullPath}`);
  return filename;
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const written = [];

for (const templateId of TEMPLATES) {
  for (const locale of LOCALES) {
    const voucher = {
      ...SAMPLE_VOUCHER,
      cardTemplateId: templateId,
      cardLocale: locale,
      message: locale === 'bg' ? SAMPLE_MESSAGE_BG : SAMPLE_VOUCHER.message
    };

    const { html: emailCard } = renderGiftVoucherCard({ voucher, mode: 'email' });
    written.push(
      writeFile(
        `${templateId}-email-${locale}.html`,
        wrapEmailFragmentPreview(`Gift voucher card — ${templateId} email (${locale})`, absolutizeAssetPaths(emailCard))
      )
    );

    const { html: printCard } = renderGiftVoucherCard({ voucher, mode: 'print' });
    const printDoc = buildGiftVoucherPrintDocument({
      cardHtml: absolutizeAssetPaths(printCard),
      title: `Gift voucher — ${templateId} (${locale})`
    });
    written.push(writeFile(`${templateId}-print-${locale}.html`, printDoc));
  }
}

for (const locale of LOCALES) {
  const voucher = {
    ...SAMPLE_VOUCHER,
    cardTemplateId: FULL_EMAIL_TEMPLATE,
    cardLocale: locale,
    message: locale === 'bg' ? SAMPLE_MESSAGE_BG : SAMPLE_VOUCHER.message
  };
  const { html, subject, text } = buildRecipientVoucherDesignedEmail({
    voucher,
    recipientEmail: 'anna@example.com',
    cardDownloadUrl: buildCardDownloadUrl(SAMPLE_DOWNLOAD_TOKEN)
  });
  const doc = `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${subject}</title>
</head>
<body>
<!-- Design gate: full assembled recipient_voucher email (guestLifecycleLayout + card + CTA). -->
<!-- Plain-text mirror (reference): -->
<pre style="display:none">${text.replace(/</g, '&lt;')}</pre>
${html}
</body>
</html>`;
  written.push(writeFile(`romantic-email-full-${locale}.html`, absolutizeAssetPaths(doc)));
}

const readme = `# Gift voucher design gate — Batch 9 release

Frozen at commit: \`${GATE_COMMIT}\` (card design frozen at \`${CARD_DESIGN_FREEZE_COMMIT}\`)

Card design is frozen (logo top-right, textures, no stamp/mountain; pressed-flower accent on Letter print only). Forest-as-texture deviation from original spec is **accepted**; this gate judges the frozen design as amended by the post-launch mobile polish pass (card-as-object preview treatment, brand line layout, frameless form block, TO/VALUE emphasis).

## Files (${written.length} HTML)

### Card fragments (email mode preview chrome)
${TEMPLATES.map((t) => LOCALES.map((l) => `- \`${t}-email-${l}.html\``).join('\n')).join('\n')}

### Print documents (production print wrapper)
${TEMPLATES.map((t) => LOCALES.map((l) => `- \`${t}-print-${l}.html\``).join('\n')).join('\n')}

### Full assembled recipient email (Letter / romantic)
- \`romantic-email-full-en.html\`
- \`romantic-email-full-bg.html\`

## Jose sign-off (EN primary)

Review these six EN renders in a browser (Print preview for print files):

1. \`forest-email-en.html\`
2. \`romantic-email-en.html\`
3. \`minimal-email-en.html\`
4. \`forest-print-en.html\`
5. \`romantic-print-en.html\`
6. \`minimal-print-en.html\`

Plus full assembled emails:

7. \`romantic-email-full-en.html\`
8. \`romantic-email-full-bg.html\`

Screenshots: \`screenshots/\` (6 EN fragment PNGs).

## Manual QA (8-point)

1. Desktop 1440px — builder amounts grid, preview, all 3 templates
2. Mobile 375px — same
3. EN + BG card language on Letter
4. Stripe test purchase — recipient_now
5. Email received — designed card + download link opens
6. Ops detail — card fields visible
7. Ops print — printable HTML
8. Compare EN gate PNGs to staging

Regenerate: \`node server/scripts/generateGiftVoucherDesignGate.cjs\`
Screenshots: \`node server/scripts/captureGiftVoucherDesignGateScreenshots.cjs\`
`;

fs.writeFileSync(path.join(OUT_DIR, 'README.md'), readme, 'utf8');
console.log(`Wrote ${path.join(OUT_DIR, 'README.md')}`);
console.log(`Total: ${written.length} HTML files`);
