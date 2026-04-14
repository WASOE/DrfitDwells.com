/**
 * Shared HTML shell for guest booking lifecycle emails (Phase 1 foundation).
 * Internal ops notification uses buildInternalNotificationHtml — same outer discipline, separate header tokens.
 */
const { htmlEscape } = require('../../utils/htmlEscape');

/** Shared structural + typographic rules; template-specific blocks pass extraHeadCss. */
const GUEST_EMAIL_BASE_CSS = `
  .email-outer { padding: 16px 12px 32px; background-color: #f4f4f5; }
  @media only screen and (min-width: 600px) {
    .email-outer { padding: 24px 16px 40px; }
  }
  .email-container { max-width: 600px; margin: 0 auto; width: 100%; }
  .email-card {
    background: #ffffff;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid #e4e4e7;
    box-shadow: 0 4px 24px rgba(15, 23, 42, 0.06);
  }
  .email-header {
    color: #ffffff;
    padding: 28px 24px 24px;
    text-align: center;
  }
  @media only screen and (min-width: 600px) {
    .email-header { padding: 32px 28px 28px; }
  }
  .email-brand {
    margin: 0;
    font-size: 26px;
    font-weight: 700;
    letter-spacing: 0.02em;
    line-height: 1.2;
  }
  @media only screen and (min-width: 600px) {
    .email-brand { font-size: 30px; }
  }
  .email-tagline {
    margin: 12px 0 0;
    font-size: 15px;
    line-height: 1.45;
    opacity: 0.95;
    font-weight: 500;
  }
  .email-body {
    padding: 24px 20px 28px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-size: 16px;
    line-height: 1.6;
    color: #27272a;
  }
  @media only screen and (min-width: 600px) {
    .email-body { padding: 28px 28px 32px; font-size: 17px; }
  }
  .email-body h2 { margin: 0 0 12px; font-size: 20px; color: #18181b; }
  @media only screen and (min-width: 600px) {
    .email-body h2 { font-size: 22px; }
  }
  .email-body p { margin: 0 0 14px; }
  .booking-details {
    background: #f4f4f5;
    padding: 18px 16px;
    border-radius: 10px;
    margin: 20px 0;
    border: 1px solid #e4e4e7;
  }
  .booking-details h3 { margin: 0 0 12px; font-size: 15px; color: #3f3f46; font-weight: 700; }
  .detail-row { display: flex; justify-content: space-between; gap: 12px; margin: 10px 0; flex-wrap: wrap; }
  .detail-label { font-weight: 600; color: #52525b; flex: 0 0 auto; }
  .detail-row > span:last-child { text-align: right; color: #27272a; }
  .btn {
    display: inline-block;
    padding: 12px 20px;
    color: #ffffff !important;
    text-decoration: none;
    border-radius: 8px;
    font-weight: 600;
    font-size: 15px;
    margin: 8px 6px 8px 0;
  }
  .email-card .footer {
    background: #fafafa;
    padding: 22px 18px 24px;
    text-align: center;
    border-top: 1px solid #e4e4e7;
    font-size: 14px;
    color: #71717a;
    line-height: 1.65;
  }
  .email-card .footer a { color: #52525b; text-decoration: underline; }
  .email-card .footer p { margin: 6px 0; }
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
        <div class="email-header" style="background: linear-gradient(135deg, ${headerGradientFrom}, ${headerGradientTo});">
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
  .email-outer { padding: 16px 12px 32px; background-color: #f4f4f5; }
  .email-container { max-width: 600px; margin: 0 auto; width: 100%; }
  .email-card {
    background: #ffffff;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid #e4e4e7;
    box-shadow: 0 4px 24px rgba(15, 23, 42, 0.06);
  }
  .email-header {
    color: #ffffff;
    padding: 24px 20px;
    text-align: center;
  }
  .email-brand { margin: 0; font-size: 22px; font-weight: 700; }
  .email-tagline { margin: 10px 0 0; font-size: 14px; opacity: 0.92; }
  .email-body {
    padding: 22px 18px 26px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-size: 15px;
    line-height: 1.55;
    color: #27272a;
  }
  .booking-details {
    background: #f4f4f5;
    padding: 16px 14px;
    border-radius: 10px;
    margin: 16px 0;
    border: 1px solid #e4e4e7;
  }
  .booking-details h3 { margin: 0 0 10px; font-size: 14px; color: #3f3f46; font-weight: 700; }
  .detail-row { display: flex; justify-content: space-between; gap: 10px; margin: 8px 0; flex-wrap: wrap; font-size: 14px; }
  .detail-label { font-weight: 600; color: #52525b; }
  .email-card .footer {
    background: #fafafa;
    padding: 18px 14px 20px;
    text-align: center;
    border-top: 1px solid #e4e4e7;
    font-size: 13px;
    color: #71717a;
    line-height: 1.6;
  }
  .email-card .footer a { color: #52525b; text-decoration: underline; }
`;

/** Internal new-booking: badge + optional admin CTA row. */
const INTERNAL_NOTIFICATION_EXTRA_CSS = `
  .new-badge {
    background: #dbeafe;
    color: #1e40af;
    padding: 10px 18px;
    border-radius: 999px;
    display: inline-block;
    font-weight: 700;
    margin: 4px 0 14px;
    font-size: 13px;
    border: 1px solid #bfdbfe;
  }
  .admin-link {
    background: #1f2937;
    color: #ffffff !important;
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
 * Internal new-booking email: same outer card discipline as guest mail; neutral slate header.
 */
function buildInternalNotificationHtml(opts) {
  const { title, preheader = '', headerGradientFrom, headerGradientTo, headerTagline, bodyHtml, footerHtml, extraHeadCss = '' } = opts;
  const pre =
    preheader != null && String(preheader).trim() !== ''
      ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${htmlEscape(
          String(preheader).trim()
        )}</div>`
      : '';

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
        <div class="email-header" style="background: linear-gradient(135deg, ${headerGradientFrom}, ${headerGradientTo});">
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
  .lede { color: #3f3f46; font-size: 16px; }
  @media only screen and (min-width: 600px) { .lede { font-size: 17px; } }
  .guidance-section { margin: 20px 0; padding: 18px 16px; background: #fffbeb; border-left: 4px solid #d97706; border-radius: 8px; }
  .guidance-section h3 { margin: 0 0 8px; font-size: 16px; color: #92400e; }
  .guidance-section.valley { background: #eff6ff; border-left-color: #2563eb; }
  .guidance-section.valley h3 { color: #1e40af; }
  .btn-sage { background: #6d735f !important; }
  .btn-sage:hover { background: #5c6154 !important; }
  .btn-blue { background: #2563eb !important; }
  .btn-blue:hover { background: #1d4ed8 !important; }
  .packing-list { background: #f0fdf4; border: 1px solid #bbf7d0; padding: 16px; border-radius: 8px; margin: 16px 0; }
  .packing-list h3 { margin: 0 0 8px; color: #166534; font-size: 16px; }
  .packing-list ul { margin: 8px 0 0; padding-left: 20px; }
  .packing-list li { margin: 4px 0; }
  .safety-notes { background: #fef2f2; border: 1px solid #fecaca; padding: 16px; border-radius: 8px; margin: 16px 0; }
  .safety-notes h3 { margin: 0 0 8px; color: #b91c1c; font-size: 16px; }
  .contact-info { background: #eff6ff; border: 1px solid #bfdbfe; padding: 16px; border-radius: 8px; margin: 16px 0; }
  .contact-info h3 { margin: 0 0 8px; color: #1e40af; font-size: 16px; }
  .total-accent { font-weight: 700; font-size: 18px; color: #575c50; }
`;

const GUEST_LIFECYCLE_CONFIRMED_EXTRA_CSS = `
  .confirmed-badge {
    background: #ecfdf5;
    color: #047857;
    padding: 10px 18px;
    border-radius: 999px;
    display: inline-block;
    font-weight: 700;
    margin: 4px 0 16px;
    font-size: 14px;
    letter-spacing: 0.02em;
    border: 1px solid #a7f3d0;
  }
  .btn-primary { background: #059669 !important; }
  .btn-primary:hover { background: #047857 !important; }
  .total-accent { font-weight: 700; font-size: 18px; color: #047857; }
`;

const GUEST_LIFECYCLE_CANCELLED_EXTRA_CSS = `
  .cancelled-badge {
    background: #fef2f2;
    color: #b91c1c;
    padding: 10px 18px;
    border-radius: 999px;
    display: inline-block;
    font-weight: 700;
    margin: 4px 0 16px;
    font-size: 14px;
    border: 1px solid #fecaca;
  }
  .btn-muted { background: #6d735f !important; }
  .btn-muted:hover { background: #5c6154 !important; }
`;

module.exports = {
  buildGuestTransactionalHtml,
  buildInternalNotificationHtml,
  GUEST_LIFECYCLE_RECEIVED_EXTRA_CSS,
  GUEST_LIFECYCLE_CONFIRMED_EXTRA_CSS,
  GUEST_LIFECYCLE_CANCELLED_EXTRA_CSS,
  INTERNAL_NOTIFICATION_EXTRA_CSS
};

