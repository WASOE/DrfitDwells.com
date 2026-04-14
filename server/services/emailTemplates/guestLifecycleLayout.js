/**
 * Shared HTML shell for guest booking lifecycle emails.
 * Internal ops notification uses buildInternalNotificationHtml — same discipline, calmer chrome.
 */
const { htmlEscape } = require('../../utils/htmlEscape');

/** Shared structural + typographic rules; template-specific blocks pass extraHeadCss. */
const GUEST_EMAIL_BASE_CSS = `
  .email-outer { padding: 18px 14px 36px; background-color: #eeeee9; }
  @media only screen and (min-width: 600px) {
    .email-outer { padding: 28px 20px 48px; }
  }
  .email-container { max-width: 600px; margin: 0 auto; width: 100%; }
  .email-card {
    background: #fdfdfc;
    border-radius: 14px;
    overflow: hidden;
    border: 1px solid #e0e0da;
    box-shadow: 0 1px 2px rgba(28, 32, 28, 0.04), 0 12px 40px rgba(28, 32, 28, 0.06);
  }
  .email-header {
    color: #fdfdfc;
    padding: 26px 22px 22px;
    text-align: center;
  }
  @media only screen and (min-width: 600px) {
    .email-header { padding: 32px 28px 26px; }
  }
  .email-brand {
    margin: 0;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    line-height: 1.25;
    color: #fdfdfc;
  }
  @media only screen and (min-width: 600px) {
    .email-brand { font-size: 24px; }
  }
  .email-tagline {
    margin: 14px 0 0;
    font-size: 17px;
    line-height: 1.45;
    font-weight: 500;
    color: rgba(253, 253, 252, 0.94);
  }
  @media only screen and (min-width: 600px) {
    .email-tagline { font-size: 18px; }
  }
  .email-kicker {
    display: block;
    margin-top: 12px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(253, 253, 252, 0.78);
  }
  @media only screen and (min-width: 600px) {
    .email-kicker { font-size: 12px; }
  }
  .email-body {
    padding: 26px 20px 30px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-size: 16px;
    line-height: 1.65;
    color: #2a2a28;
  }
  @media only screen and (min-width: 600px) {
    .email-body { padding: 32px 32px 36px; font-size: 17px; }
  }
  .email-body h2 {
    margin: 0 0 14px;
    font-size: 21px;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: #1c1c1a;
    line-height: 1.3;
  }
  @media only screen and (min-width: 600px) {
    .email-body h2 { font-size: 23px; }
  }
  .email-body h3 { margin: 0 0 8px; font-size: 14px; font-weight: 600; letter-spacing: 0.02em; color: #3d3d38; }
  .email-body p { margin: 0 0 16px; }
  .booking-details {
    background: #f7f7f4;
    padding: 0;
    border-radius: 12px;
    margin: 22px 0;
    border: 1px solid #e4e4df;
    overflow: hidden;
  }
  .booking-details h3 {
    margin: 0;
    padding: 16px 18px 12px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #5c5c56;
    border-bottom: 1px solid #e4e4df;
    background: #f0f0ec;
  }
  @media only screen and (min-width: 600px) {
    .booking-details h3 { padding: 18px 20px 14px; }
  }
  .detail-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    padding: 14px 18px;
    border-bottom: 1px solid #e8e8e3;
    flex-wrap: wrap;
  }
  @media only screen and (min-width: 600px) {
    .detail-row { padding: 14px 20px; }
  }
  .detail-row:last-child { border-bottom: none; }
  .detail-label {
    font-weight: 600;
    color: #5a5a54;
    flex: 0 1 38%;
    min-width: 120px;
    font-size: 14px;
  }
  .detail-row > span:last-child {
    text-align: right;
    color: #1c1c1a;
    flex: 1 1 50%;
    font-size: 15px;
    line-height: 1.5;
  }
  @media only screen and (max-width: 480px) {
    .detail-row { flex-direction: column; align-items: stretch; }
    .detail-row > span:last-child { text-align: left; }
  }
  .btn {
    display: inline-block;
    padding: 12px 22px;
    color: #fdfdfc !important;
    text-decoration: none;
    border-radius: 8px;
    font-weight: 600;
    font-size: 14px;
    margin: 6px 8px 6px 0;
    letter-spacing: 0.01em;
  }
  .email-card .footer {
    background: #f4f4f0;
    padding: 24px 20px 26px;
    text-align: center;
    border-top: 1px solid #e4e4df;
    font-size: 13px;
    color: #63635c;
    line-height: 1.65;
  }
  .email-card .footer a { color: #4a4a44; text-decoration: underline; text-underline-offset: 2px; }
  .email-card .footer p { margin: 8px 0; }
  .email-card .footer .footer-legal { font-size: 12px; color: #7a7a72; letter-spacing: 0.02em; }
  .email-tagline-lead {
    display: block;
    margin-top: 10px;
    font-weight: 500;
    font-size: 16px;
    line-height: 1.45;
    color: rgba(253, 253, 252, 0.94);
  }
  @media only screen and (min-width: 600px) {
    .email-tagline-lead { font-size: 17px; margin-top: 12px; }
  }
`;

/**
 * @param {object} opts
 * @param {string} opts.title - document <title>
 * @param {string} [opts.preheader] - hidden preheader for inbox preview
 * @param {string} opts.headerGradientFrom
 * @param {string} opts.headerGradientTo
 * @param {string} opts.headerTagline - HTML allowed only if caller escaped; typically plain text
 * @param {string} opts.bodyHtml - inner content (caller must escape dynamic parts)
 * @param {string} [opts.extraHeadCss]
 * @param {string} opts.footerHtml - full footer block HTML
 */
function buildGuestTransactionalHtml(opts) {
  const {
    title,
    preheader = '',
    headerGradientFrom,
    headerGradientTo,
    headerTagline,
    bodyHtml,
    extraHeadCss = '',
    footerHtml
  } = opts;

  const pre =
    preheader != null && String(preheader).trim() !== ''
      ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${htmlEscape(
          String(preheader).trim()
        )}</div>`
      : '';

  const from = String(headerGradientFrom || '').trim();
  const to = String(headerGradientTo || '').trim();
  const headerStyle =
    from && to && from.toLowerCase() === to.toLowerCase()
      ? `background-color: ${from};`
      : `background: linear-gradient(152deg, ${from} 0%, ${to} 100%);`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${htmlEscape(title)}</title>
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
        <div class="email-header" style="${headerStyle}">
          <p class="email-brand">Drift &amp; Dwells</p>
          <p class="email-tagline">${headerTagline}</p>
        </div>
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
  .email-outer { padding: 18px 14px 36px; background-color: #eeeee9; }
  .email-container { max-width: 600px; margin: 0 auto; width: 100%; }
  .email-card {
    background: #fdfdfc;
    border-radius: 14px;
    overflow: hidden;
    border: 1px solid #e0e0da;
    box-shadow: 0 1px 2px rgba(28, 32, 28, 0.04), 0 8px 28px rgba(28, 32, 28, 0.05);
  }
  .email-header {
    color: #fdfdfc;
    padding: 22px 20px;
    text-align: center;
  }
  .email-brand { margin: 0; font-size: 18px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
  .email-tagline { margin: 10px 0 0; font-size: 14px; font-weight: 500; color: rgba(253, 253, 252, 0.9); }
  .email-kicker {
    display: block;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(253, 253, 252, 0.72);
  }
  .email-tagline-lead {
    display: block;
    margin-top: 8px;
    font-size: 14px;
    font-weight: 500;
    line-height: 1.45;
    color: rgba(253, 253, 252, 0.92);
  }
  .email-body {
    padding: 24px 20px 28px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-size: 15px;
    line-height: 1.6;
    color: #2a2a28;
  }
  .booking-details {
    background: #f7f7f4;
    padding: 0;
    border-radius: 12px;
    margin: 18px 0;
    border: 1px solid #e4e4df;
    overflow: hidden;
  }
  .booking-details h3 {
    margin: 0;
    padding: 14px 16px 10px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #5c5c56;
    border-bottom: 1px solid #e4e4df;
    background: #f0f0ec;
  }
  .detail-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid #e8e8e3;
    flex-wrap: wrap;
    font-size: 14px;
  }
  .detail-row:last-child { border-bottom: none; }
  .detail-label { font-weight: 600; color: #5a5a54; }
  .email-card .footer {
    background: #f4f4f0;
    padding: 20px 16px 22px;
    text-align: center;
    border-top: 1px solid #e4e4df;
    font-size: 12px;
    color: #63635c;
    line-height: 1.6;
  }
  .email-card .footer a { color: #4a4a44; text-decoration: underline; text-underline-offset: 2px; }
  .email-card .footer p { margin: 6px 0; }
  .email-card .footer .footer-legal { font-size: 11px; color: #7a7a72; letter-spacing: 0.02em; }
`;

/** Internal new-booking: restrained badge + admin CTA. */
const INTERNAL_NOTIFICATION_EXTRA_CSS = `
  .new-badge {
    background: #ecece8;
    color: #3d3d38;
    padding: 8px 14px;
    border-radius: 6px;
    display: inline-block;
    font-weight: 600;
    margin: 2px 0 16px;
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    border: 1px solid #d8d8d2;
  }
  .admin-link {
    background: #3d3d38;
    color: #fdfdfc !important;
    padding: 10px 18px;
    border-radius: 8px;
    text-decoration: none;
    display: inline-block;
    margin: 12px 0;
    font-weight: 600;
    font-size: 14px;
  }
`;

/**
 * Internal new-booking email: secondary to guest mail; neutral header.
 */
function buildInternalNotificationHtml(opts) {
  const { title, preheader = '', headerGradientFrom, headerGradientTo, headerTagline, bodyHtml, footerHtml, extraHeadCss = '' } = opts;
  const pre =
    preheader != null && String(preheader).trim() !== ''
      ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${htmlEscape(
          String(preheader).trim()
        )}</div>`
      : '';

  const from = String(headerGradientFrom || '').trim();
  const to = String(headerGradientTo || '').trim();
  const headerStyle =
    from && to && from.toLowerCase() === to.toLowerCase()
      ? `background-color: ${from};`
      : `background: linear-gradient(152deg, ${from} 0%, ${to} 100%);`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <title>${htmlEscape(title)}</title>
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
        <div class="email-header" style="${headerStyle}">
          <p class="email-brand">Drift &amp; Dwells Admin</p>
          <p class="email-tagline">${headerTagline}</p>
        </div>
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

/** Guest booking_received: guidance, packing, safety, valley CTA, payment block. */
const GUEST_LIFECYCLE_RECEIVED_EXTRA_CSS = `
  .lede { color: #454542; font-size: 16px; }
  @media only screen and (min-width: 600px) { .lede { font-size: 17px; } }
  .guidance-section {
    margin: 22px 0;
    padding: 18px 18px 18px 20px;
    background: #f8f6f0;
    border-left: 3px solid #8a8f7e;
    border-radius: 0 10px 10px 0;
  }
  .guidance-section h3 { margin: 0 0 10px; font-size: 15px; font-weight: 600; color: #3d3d38; letter-spacing: -0.01em; }
  .guidance-section.valley { background: #f2f5f8; border-left-color: #5a6b7a; }
  .guidance-section.valley h3 { color: #2f3d4a; }
  .btn-sage { background: #5c6156 !important; }
  .btn-sage:hover { background: #4a4e45 !important; }
  .btn-blue { background: #4a5f6e !important; }
  .btn-blue:hover { background: #3d4f5c !important; }
  .packing-list {
    background: #f4f7f3;
    border: 1px solid #d4e0d4;
    padding: 18px;
    border-radius: 10px;
    margin: 18px 0;
  }
  .packing-list h3 { margin: 0 0 10px; color: #3d4d3d; font-size: 15px; font-weight: 600; }
  .packing-list ul { margin: 8px 0 0; padding-left: 20px; }
  .packing-list li { margin: 5px 0; }
  .safety-notes {
    background: #faf6f5;
    border: 1px solid #e8d8d4;
    padding: 18px;
    border-radius: 10px;
    margin: 18px 0;
  }
  .safety-notes h3 { margin: 0 0 10px; color: #5c3d38; font-size: 15px; font-weight: 600; }
  .contact-info {
    background: #f2f5f8;
    border: 1px solid #d4dde6;
    padding: 18px;
    border-radius: 10px;
    margin: 18px 0;
  }
  .contact-info h3 { margin: 0 0 10px; color: #2f3d4a; font-size: 15px; font-weight: 600; }
  .total-accent { font-weight: 700; font-size: 17px; color: #4a4e45; letter-spacing: -0.01em; }
`;

const GUEST_LIFECYCLE_CONFIRMED_EXTRA_CSS = `
  .lede { color: #454542; font-size: 16px; }
  @media only screen and (min-width: 600px) { .lede { font-size: 17px; } }
  .confirmed-badge {
    background: #e8f0eb;
    color: #2d4a38;
    padding: 8px 14px;
    border-radius: 6px;
    display: inline-block;
    font-weight: 600;
    margin: 2px 0 18px;
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    border: 1px solid #c5d6c9;
  }
  .btn-primary { background: #4a6b55 !important; }
  .btn-primary:hover { background: #3d5a47 !important; }
  .total-accent { font-weight: 700; font-size: 17px; color: #2d4a38; letter-spacing: -0.01em; }
`;

const GUEST_LIFECYCLE_CANCELLED_EXTRA_CSS = `
  .lede { color: #454542; font-size: 16px; }
  @media only screen and (min-width: 600px) { .lede { font-size: 17px; } }
  .cancelled-badge {
    background: #f5ecec;
    color: #5c3838;
    padding: 8px 14px;
    border-radius: 6px;
    display: inline-block;
    font-weight: 600;
    margin: 2px 0 18px;
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    border: 1px solid #e0cccc;
  }
  .btn-muted { background: #5c6156 !important; }
  .btn-muted:hover { background: #4a4e45 !important; }
`;

module.exports = {
  buildGuestTransactionalHtml,
  buildInternalNotificationHtml,
  GUEST_LIFECYCLE_RECEIVED_EXTRA_CSS,
  GUEST_LIFECYCLE_CONFIRMED_EXTRA_CSS,
  GUEST_LIFECYCLE_CANCELLED_EXTRA_CSS,
  INTERNAL_NOTIFICATION_EXTRA_CSS
};
