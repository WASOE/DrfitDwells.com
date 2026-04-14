/**
 * Drift & Dwells transactional email shell — brand-aligned, email-client safe.
 * Guest lifecycle + internal notification share typography tokens; guest uses logo + accent stripe.
 */
const { htmlEscape } = require('../../utils/htmlEscape');

/** Site accent (matches booking UI primary). */
const BRAND_SAGE = '#81887A';

const FONT_LINK =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Playfair+Display:wght@600;700&display=swap';

function sanitizeHeaderAccent(hex, fallback = BRAND_SAGE) {
  const s = String(hex || '').trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s;
  return fallback;
}

/**
 * Table-based detail rows (Outlook-friendly). valueHtml must already be escaped/safe HTML fragments.
 * @param {Array<{ label: string, valueHtml: string }>} rows
 */
function buildDetailRowsTable(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const inner = rows
    .map(
      (r) => `
    <tr>
      <td class="detail-td-label" valign="top">${htmlEscape(r.label)}</td>
      <td class="detail-td-value" valign="top" align="right">${r.valueHtml}</td>
    </tr>`
    )
    .join('');
  return `<table role="presentation" class="detail-grid" width="100%" cellpadding="0" cellspacing="0" border="0">${inner}
    </table>`;
}

const GUEST_EMAIL_BASE_CSS = `
  body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; background-color: #ebeae6; }
  .email-outer { padding: 20px 14px 40px; background-color: #ebeae6; }
  @media only screen and (min-width: 600px) {
    .email-outer { padding: 32px 20px 56px; }
  }
  .email-container { max-width: 600px; margin: 0 auto; width: 100%; }
  .email-card {
    background: #fdfcfa;
    border-radius: 16px;
    overflow: hidden;
    border: 1px solid #dedbd4;
    box-shadow: 0 2px 0 rgba(26, 25, 24, 0.04), 0 24px 48px rgba(26, 25, 24, 0.07);
  }
  .email-header {
    background-color: #f7f5f0;
    text-align: center;
  }
  .email-header-inner { padding: 26px 22px 22px; }
  @media only screen and (min-width: 600px) {
    .email-header-inner { padding: 32px 28px 26px; }
  }
  .email-header-logo { display: block; margin: 0 auto; border: 0; outline: none; text-decoration: none; }
  .email-header-tagline-wrap { padding: 18px 22px 22px; }
  @media only screen and (min-width: 600px) {
    .email-header-tagline-wrap { padding: 4px 28px 26px; }
  }
  .email-kicker {
    margin: 0 0 6px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: ${BRAND_SAGE};
  }
  @media only screen and (min-width: 600px) {
    .email-kicker { font-size: 12px; }
  }
  .email-tagline-lead {
    margin: 0;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 17px;
    font-weight: 500;
    line-height: 1.45;
    color: #1a1918;
  }
  @media only screen and (min-width: 600px) {
    .email-tagline-lead { font-size: 18px; }
  }
  .email-body {
    padding: 28px 22px 32px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 16px;
    line-height: 1.65;
    color: #2c2b28;
  }
  @media only screen and (min-width: 600px) {
    .email-body { padding: 36px 36px 40px; font-size: 17px; }
  }
  .email-heading {
    margin: 0 0 16px;
    font-family: 'Playfair Display', Georgia, 'Times New Roman', serif;
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.25;
    color: #1a1918;
  }
  @media only screen and (min-width: 600px) {
    .email-heading { font-size: 30px; margin-bottom: 18px; }
  }
  .email-body h3 {
    margin: 0 0 8px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: #45443f;
  }
  .email-body p { margin: 0 0 16px; }
  .booking-details {
    background: #f4f2ec;
    margin: 24px 0;
    border-radius: 12px;
    border: 1px solid #e5e2da;
    overflow: hidden;
  }
  .booking-details h3 {
    margin: 0;
    padding: 16px 18px 12px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #6b6a64;
    border-bottom: 1px solid #e5e2da;
    background: #ebe8e0;
  }
  @media only screen and (min-width: 600px) {
    .booking-details h3 { padding: 18px 22px 14px; }
  }
  .detail-grid { width: 100% !important; border-collapse: collapse !important; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  .detail-grid tr { border-bottom: 1px solid #e0ddd4; }
  .detail-grid tr:last-child { border-bottom: none; }
  .detail-td-label {
    padding: 14px 18px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 13px;
    font-weight: 600;
    color: #6b6a64;
    width: 38%;
  }
  .detail-td-value {
    padding: 14px 18px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 15px;
    font-weight: 500;
    color: #1a1918;
    line-height: 1.45;
  }
  @media only screen and (min-width: 600px) {
    .detail-td-label, .detail-td-value { padding-left: 22px; padding-right: 22px; }
  }
  @media only screen and (max-width: 480px) {
    .detail-td-value { display: block; width: 100% !important; text-align: left !important; padding-top: 4px; }
    .detail-td-label { display: block; width: 100% !important; padding-bottom: 2px; }
  }
  .btn {
    display: inline-block;
    padding: 13px 24px;
    color: #fdfcfa !important;
    text-decoration: none !important;
    border-radius: 10px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-weight: 600;
    font-size: 14px;
    margin: 6px 8px 6px 0;
    letter-spacing: 0.02em;
  }
  .email-card .footer {
    background: linear-gradient(180deg, #f4f2ec 0%, #ebe8e0 100%);
    padding: 28px 22px 30px;
    text-align: center;
    border-top: 1px solid #e5e2da;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 13px;
    color: #5c5b56;
    line-height: 1.65;
  }
  .email-card .footer a {
    color: #4a4944;
    text-decoration: underline;
    text-underline-offset: 3px;
    font-weight: 500;
  }
  .email-card .footer p { margin: 8px 0; }
  .email-card .footer .footer-tagline {
    margin: 0 0 4px;
    font-family: 'Playfair Display', Georgia, serif;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: #3d3c38;
  }
  .email-card .footer .footer-home { margin: 0 0 12px; }
  .email-card .footer .footer-home a { font-size: 14px; font-weight: 600; color: ${BRAND_SAGE}; }
  .email-card .footer .footer-legal {
    margin: 14px 0 0;
    font-size: 11px;
    color: #8a887f;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
`;

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.preheader]
 * @param {string} opts.logoUrl - absolute URL to logo image
 * @param {string} opts.siteHomeUrl - absolute homepage URL (logo link)
 * @param {string} [opts.headerAccentColor] - 6-char hex bottom stripe (default brand sage)
 * @param {number} [opts.headerLogoWidth] - img width attribute (default 200)
 * @param {string} opts.headerTagline - HTML (caller controls escaping of dynamic parts)
 * @param {string} opts.bodyHtml
 * @param {string} [opts.extraHeadCss]
 * @param {string} opts.footerHtml
 */
function buildGuestTransactionalHtml(opts) {
  const {
    title,
    preheader = '',
    logoUrl,
    siteHomeUrl,
    headerAccentColor = BRAND_SAGE,
    headerLogoWidth = 200,
    headerTagline,
    bodyHtml,
    extraHeadCss = '',
    footerHtml
  } = opts;

  const accent = sanitizeHeaderAccent(headerAccentColor);
  const pre =
    preheader != null && String(preheader).trim() !== ''
      ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${htmlEscape(
          String(preheader).trim()
        )}</div>`
      : '';

  const safeLogo = htmlEscape(String(logoUrl || '').trim());
  const safeHome = htmlEscape(String(siteHomeUrl || '').trim());
  const w = Math.min(280, Math.max(120, Number(headerLogoWidth) || 200));

  const headerBlock = `
        <div class="email-header" style="background-color:#f7f5f0;border-bottom:3px solid ${accent};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td class="email-header-inner" align="center">
                <a href="${safeHome}" style="text-decoration:none;border:0;">
                  <img class="email-header-logo" src="${safeLogo}" width="${w}" alt="Drift &amp; Dwells" style="display:block;margin:0 auto;max-width:${w}px;width:100%;height:auto;border:0;outline:none;text-decoration:none;" />
                </a>
              </td>
            </tr>
            <tr>
              <td class="email-header-tagline-wrap" align="center">
                ${headerTagline}
              </td>
            </tr>
          </table>
        </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${htmlEscape(title)}</title>
  <link rel="stylesheet" href="${FONT_LINK}">
  <style>
${GUEST_EMAIL_BASE_CSS}
${extraHeadCss}
  </style>
</head>
<body>
${pre}
  <div class="email-outer" role="article" aria-roledescription="email">
    <div class="email-container">
      <div class="email-card">
${headerBlock}
        <div class="email-body">
${bodyHtml}
        </div>
        ${footerHtml}
      </div>
    </div>
  </div>
</body>
</html>`;
}

const INTERNAL_BASE_CSS = `
  body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; background-color: #ebeae6; }
  .email-outer { padding: 20px 14px 40px; background-color: #ebeae6; }
  .email-container { max-width: 600px; margin: 0 auto; width: 100%; }
  .email-card {
    background: #fdfcfa;
    border-radius: 14px;
    overflow: hidden;
    border: 1px solid #dedbd4;
    box-shadow: 0 2px 0 rgba(26, 25, 24, 0.03), 0 16px 36px rgba(26, 25, 24, 0.06);
  }
  .email-header { background-color: #f0eeea; text-align: center; }
  .email-header-inner { padding: 18px 18px 14px; }
  .email-header-tagline-wrap { padding: 0 20px 18px; }
  .email-kicker {
    margin: 0 0 4px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #7a7870;
  }
  .email-tagline-lead {
    margin: 0;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 14px;
    font-weight: 500;
    color: #3d3c38;
  }
  .email-body {
    padding: 22px 20px 26px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 15px;
    line-height: 1.6;
    color: #2c2b28;
  }
  .email-heading {
    margin: 0 0 12px;
    font-family: 'Playfair Display', Georgia, serif;
    font-size: 22px;
    font-weight: 700;
    color: #1a1918;
  }
  .booking-details {
    background: #f4f2ec;
    margin: 18px 0;
    border-radius: 10px;
    border: 1px solid #e5e2da;
    overflow: hidden;
  }
  .booking-details h3 {
    margin: 0;
    padding: 12px 16px 10px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #6b6a64;
    border-bottom: 1px solid #e5e2da;
    background: #ebe8e0;
  }
  .detail-grid { width: 100% !important; border-collapse: collapse !important; }
  .detail-grid tr { border-bottom: 1px solid #e0ddd4; }
  .detail-grid tr:last-child { border-bottom: none; }
  .detail-td-label {
    padding: 10px 16px;
    font-size: 12px;
    font-weight: 600;
    color: #6b6a64;
    width: 36%;
  }
  .detail-td-value {
    padding: 10px 16px;
    font-size: 14px;
    color: #1a1918;
  }
  .email-card .footer {
    background: #ebe8e0;
    padding: 20px 16px 22px;
    text-align: center;
    border-top: 1px solid #e5e2da;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 12px;
    color: #6b6a64;
    line-height: 1.6;
  }
  .email-card .footer a { color: #4a4944; text-decoration: underline; text-underline-offset: 2px; }
  .email-card .footer p { margin: 6px 0; }
  .email-card .footer .footer-legal { font-size: 10px; color: #8a887f; letter-spacing: 0.06em; text-transform: uppercase; }
`;

const INTERNAL_NOTIFICATION_EXTRA_CSS = `
  .new-badge {
    background: #e8e6e0;
    color: #3d3c38;
    padding: 7px 12px;
    border-radius: 6px;
    display: inline-block;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-weight: 600;
    margin: 2px 0 14px;
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    border: 1px solid #d5d2ca;
  }
  .admin-link {
    background: #3d3c38;
    color: #fdfcfa !important;
    padding: 10px 18px;
    border-radius: 8px;
    text-decoration: none !important;
    display: inline-block;
    margin: 12px 0;
    font-weight: 600;
    font-size: 14px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  }
`;

function buildInternalNotificationHtml(opts) {
  const {
    title,
    preheader = '',
    logoUrl,
    siteHomeUrl,
    headerAccentColor = '#b0aea6',
    headerLogoWidth = 152,
    headerTagline,
    bodyHtml,
    footerHtml,
    extraHeadCss = ''
  } = opts;

  const accent = sanitizeHeaderAccent(headerAccentColor, '#b0aea6');
  const pre =
    preheader != null && String(preheader).trim() !== ''
      ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${htmlEscape(
          String(preheader).trim()
        )}</div>`
      : '';

  const safeLogo = htmlEscape(String(logoUrl || '').trim());
  const safeHome = htmlEscape(String(siteHomeUrl || '').trim());
  const w = Math.min(220, Math.max(100, Number(headerLogoWidth) || 152));

  const headerBlock = `
        <div class="email-header" style="background-color:#f0eeea;border-bottom:2px solid ${accent};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td class="email-header-inner" align="center">
                <a href="${safeHome}" style="text-decoration:none;border:0;">
                  <img class="email-header-logo" src="${safeLogo}" width="${w}" alt="Drift &amp; Dwells" style="display:block;margin:0 auto;max-width:${w}px;width:100%;height:auto;border:0;outline:none;text-decoration:none;" />
                </a>
                <p style="margin:10px 0 0;font-family:'Inter',sans-serif;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#7a7870;">Staff</p>
              </td>
            </tr>
            <tr>
              <td class="email-header-tagline-wrap" align="center">${headerTagline}</td>
            </tr>
          </table>
        </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <title>${htmlEscape(title)}</title>
  <link rel="stylesheet" href="${FONT_LINK}">
  <style>
${INTERNAL_BASE_CSS}
${extraHeadCss}
  </style>
</head>
<body>
${pre}
  <div class="email-outer">
    <div class="email-container">
      <div class="email-card">
${headerBlock}
        <div class="email-body">
${bodyHtml}
        </div>
        ${footerHtml}
      </div>
    </div>
  </div>
</body>
</html>`;
}

const GUEST_LIFECYCLE_RECEIVED_EXTRA_CSS = `
  .lede { color: #45443f; font-size: 16px; }
  @media only screen and (min-width: 600px) { .lede { font-size: 17px; } }
  .guidance-section {
    margin: 22px 0;
    padding: 18px 18px 18px 20px;
    background: #f9f7f2;
    border-left: 3px solid ${BRAND_SAGE};
    border-radius: 0 12px 12px 0;
  }
  .guidance-section h3 {
    margin: 0 0 10px;
    font-family: 'Playfair Display', Georgia, serif;
    font-size: 18px;
    font-weight: 700;
    color: #1a1918;
  }
  .guidance-section.valley { background: #f2f4f7; border-left-color: #5a6570; }
  .guidance-section.valley h3 { color: #2a3238; }
  .btn-brand { background: ${BRAND_SAGE} !important; }
  .btn-brand:hover { background: #6d7368 !important; }
  .btn-secondary { background: #5a6570 !important; }
  .btn-secondary:hover { background: #4a545c !important; }
  .packing-list {
    background: #f3f6f1;
    border: 1px solid #d2ddd2;
    padding: 18px;
    border-radius: 12px;
    margin: 18px 0;
  }
  .packing-list h3 {
    margin: 0 0 10px;
    font-family: 'Playfair Display', Georgia, serif;
    font-size: 18px;
    font-weight: 700;
    color: #2a382c;
  }
  .packing-list ul { margin: 8px 0 0; padding-left: 20px; }
  .packing-list li { margin: 5px 0; }
  .safety-notes {
    background: #faf6f4;
    border: 1px solid #e5d8d4;
    padding: 18px;
    border-radius: 12px;
    margin: 18px 0;
  }
  .safety-notes h3 {
    margin: 0 0 10px;
    font-family: 'Playfair Display', Georgia, serif;
    font-size: 18px;
    font-weight: 700;
    color: #4a3530;
  }
  .contact-info {
    background: #f2f4f7;
    border: 1px solid #d4dae2;
    padding: 18px;
    border-radius: 12px;
    margin: 18px 0;
  }
  .contact-info h3 {
    margin: 0 0 10px;
    font-family: 'Playfair Display', Georgia, serif;
    font-size: 18px;
    font-weight: 700;
    color: #2a3238;
  }
  .total-accent { font-weight: 700; font-size: 18px; color: #1a1918; letter-spacing: -0.02em; }
`;

const GUEST_LIFECYCLE_CONFIRMED_EXTRA_CSS = `
  .lede { color: #45443f; font-size: 16px; }
  @media only screen and (min-width: 600px) { .lede { font-size: 17px; } }
  .confirmed-badge {
    background: #e8efe9;
    color: #2d4a38;
    padding: 8px 14px;
    border-radius: 8px;
    display: inline-block;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-weight: 600;
    margin: 2px 0 18px;
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    border: 1px solid #c5d6c9;
  }
  .btn-primary { background: #5f7a66 !important; }
  .btn-primary:hover { background: #4e6554 !important; }
  .total-accent { font-weight: 700; font-size: 18px; color: #2d4a38; letter-spacing: -0.02em; }
`;

const GUEST_LIFECYCLE_CANCELLED_EXTRA_CSS = `
  .lede { color: #45443f; font-size: 16px; }
  @media only screen and (min-width: 600px) { .lede { font-size: 17px; } }
  .cancelled-badge {
    background: #f3eaea;
    color: #5c3838;
    padding: 8px 14px;
    border-radius: 8px;
    display: inline-block;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-weight: 600;
    margin: 2px 0 18px;
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    border: 1px solid #e0cccc;
  }
  .btn-muted { background: ${BRAND_SAGE} !important; }
  .btn-muted:hover { background: #6d7368 !important; }
`;

module.exports = {
  BRAND_SAGE,
  buildDetailRowsTable,
  buildGuestTransactionalHtml,
  buildInternalNotificationHtml,
  GUEST_LIFECYCLE_RECEIVED_EXTRA_CSS,
  GUEST_LIFECYCLE_CONFIRMED_EXTRA_CSS,
  GUEST_LIFECYCLE_CANCELLED_EXTRA_CSS,
  INTERNAL_NOTIFICATION_EXTRA_CSS
};
