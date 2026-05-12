const emailService = require('../emailService');

const BRAND_SAGE = '#b0aea6';
const BRAND_TEXT = '#1f1f1f';
const BRAND_MUTED = '#6b6b6b';
const BRAND_BG = '#f7f5f0';

function htmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatExpiryHuman(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Europe/Sofia'
    });
  } catch {
    return String(iso);
  }
}

function pickFirstName(fullName) {
  const trimmed = String(fullName || '').trim();
  if (!trimmed) return '';
  const first = trimmed.split(/\s+/)[0] || '';
  return first;
}

/**
 * Build the creator portal magic-link email payload.
 * No booking data. No commission data. No tracking pixels.
 */
function buildCreatorPortalMagicLinkEmail({ creatorName, verifyUrl, expiresAt }) {
  const first = pickFirstName(creatorName);
  const greetingPlain = first ? `Hi ${first}` : 'Hi there';
  const greetingHtml = htmlEscape(greetingPlain);
  const expiryHuman = formatExpiryHuman(expiresAt);
  const subject = 'Your Drift & Dwells creator portal link';

  const safeUrl = htmlEscape(verifyUrl);

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${htmlEscape(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:${BRAND_BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND_TEXT};">
    <span style="display:none !important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">Your private creator portal sign-in link.</span>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BRAND_BG};">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;border:1px solid #ececec;">
            <tr>
              <td style="padding:32px 32px 8px 32px;">
                <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${BRAND_SAGE};font-weight:600;">Drift &amp; Dwells · Creator portal</div>
                <h1 style="margin:12px 0 0 0;font-size:22px;line-height:1.25;color:${BRAND_TEXT};font-weight:600;">${greetingHtml},</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 8px 32px;">
                <p style="margin:0;font-size:15px;line-height:1.55;color:${BRAND_TEXT};">
                  Here is your private sign-in link for the Drift &amp; Dwells creator portal.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 8px 32px;" align="left">
                <a href="${safeUrl}"
                   style="display:inline-block;background:${BRAND_TEXT};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-size:14px;font-weight:600;letter-spacing:0.02em;">
                  Open creator portal
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 24px 32px;">
                <p style="margin:0;font-size:12px;line-height:1.5;color:${BRAND_MUTED};">
                  ${expiryHuman ? `Link expires on <strong style="color:${BRAND_TEXT};">${htmlEscape(expiryHuman)}</strong> and can be used once.` : 'Link expires soon and can be used once.'}
                </p>
                <p style="margin:12px 0 0 0;font-size:12px;line-height:1.5;color:${BRAND_MUTED};">
                  If the button does not work, paste this URL into your browser:
                </p>
                <p style="margin:6px 0 0 0;font-size:12px;line-height:1.5;color:${BRAND_MUTED};word-break:break-all;">
                  <span style="color:${BRAND_TEXT};">${safeUrl}</span>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px 32px;">
                <p style="margin:0;font-size:12px;line-height:1.5;color:${BRAND_MUTED};">
                  If you did not request this, you can ignore this email — no action will be taken.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0 0;font-size:11px;color:${BRAND_MUTED};">
            Drift &amp; Dwells · creator portal · private access
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const expiryLine = expiryHuman
    ? `This link expires on ${expiryHuman} and can be used once.`
    : 'This link expires soon and can be used once.';

  const text = [
    `${greetingPlain},`,
    '',
    'Here is your private sign-in link for the Drift & Dwells creator portal:',
    '',
    String(verifyUrl || ''),
    '',
    expiryLine,
    '',
    'If you did not request this, ignore this email.',
    '',
    '— Drift & Dwells'
  ].join('\n');

  return { subject, html, text };
}

/**
 * Send the creator portal magic-link email through the existing transport.
 * Never logs the raw verifyUrl — uses emailService's body-redacted fallback when SMTP is unavailable.
 */
async function sendCreatorPortalMagicLinkEmail({ to, creatorName, verifyUrl, expiresAt }) {
  if (!to || !verifyUrl) {
    return { success: false, method: 'missing-fields' };
  }
  const { subject, html, text } = buildCreatorPortalMagicLinkEmail({
    creatorName,
    verifyUrl,
    expiresAt
  });
  return emailService.sendEmail({
    to,
    subject,
    html,
    text,
    trigger: 'creator_portal_magic_link',
    bookingId: null,
    omitBodyFromLogs: true
  });
}

module.exports = {
  buildCreatorPortalMagicLinkEmail,
  sendCreatorPortalMagicLinkEmail
};
