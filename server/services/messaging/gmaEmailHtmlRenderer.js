'use strict';

/**
 * Branded HTML shell for GMA guest/ops email templates.
 * Preview and dispatcher must use this so OPS preview matches future sends.
 * Brand tokens aligned with emailService lifecycle emails (no emailService import).
 */

const { htmlEscape } = require('../../utils/htmlEscape');
const {
  BRAND_SAGE,
  buildGuestTransactionalHtml,
  buildInternalNotificationHtml,
  INTERNAL_NOTIFICATION_EXTRA_CSS
} = require('../emailTemplates/guestLifecycleLayout');

const EMAIL_SITE_ORIGIN = (process.env.APP_URL || 'https://driftdwells.com').replace(/\/$/, '');
const INSTAGRAM_URL = (process.env.INSTAGRAM_URL || 'https://www.instagram.com/driftdwells/').trim();
const FACEBOOK_URL = (
  process.env.FACEBOOK_URL || 'https://www.facebook.com/profile.php?id=61569960933269'
).trim();

function isLocalOrUnroutableOrigin(origin) {
  try {
    const u = new URL(origin);
    const h = u.hostname.toLowerCase();
    if (u.protocol === 'file:') return true;
    return (
      h === 'localhost'
      || h === '127.0.0.1'
      || h === '0.0.0.0'
      || h === '[::1]'
      || h.endsWith('.local')
    );
  } catch {
    return true;
  }
}

function upgradeToHttpsIfRemote(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' && !isLocalOrUnroutableOrigin(url)) {
      u.protocol = 'https:';
      return u.href;
    }
  } catch {
    return url;
  }
  return url;
}

function resolveBrandLogoAbsoluteUrl() {
  const disable = process.env.EMAIL_BRAND_LOGO_DISABLE;
  if (disable === '1' || disable === 'true' || disable === 'yes') {
    return '';
  }
  const explicit = (process.env.EMAIL_BRAND_LOGO_URL || '').trim();
  if (explicit === '0' || explicit.toLowerCase() === 'off' || explicit.toLowerCase() === 'false') {
    return '';
  }
  if (explicit.startsWith('https://')) {
    return explicit;
  }
  if (explicit.startsWith('http://')) {
    return upgradeToHttpsIfRemote(explicit);
  }

  const path = (process.env.EMAIL_BRAND_LOGO_PATH || '/uploads/Logo/DRIFTS-01.png').trim();
  const normalized = path.startsWith('/') ? path : `/${path}`;

  const publicOrigin = (process.env.EMAIL_PUBLIC_ASSET_ORIGIN || '').trim().replace(/\/$/, '');
  if (publicOrigin.startsWith('https://') || publicOrigin.startsWith('http://')) {
    return `${upgradeToHttpsIfRemote(publicOrigin)}${normalized}`;
  }

  const fallbackOrigin = (process.env.EMAIL_LOGO_FALLBACK_ORIGIN || 'https://driftdwells.com')
    .trim()
    .replace(/\/$/, '');

  if (isLocalOrUnroutableOrigin(EMAIL_SITE_ORIGIN)) {
    return `${fallbackOrigin}${normalized}`;
  }

  let origin = EMAIL_SITE_ORIGIN;
  try {
    const u = new URL(origin);
    if (u.protocol === 'http:') {
      origin = upgradeToHttpsIfRemote(origin);
    }
  } catch {
    return `${fallbackOrigin}${normalized}`;
  }
  return `${String(origin).replace(/\/$/, '')}${normalized}`;
}

function copyrightYear() {
  return new Date().getFullYear();
}

function guestEmailFooterHtml() {
  const terms = `${EMAIL_SITE_ORIGIN}/terms`;
  const privacy = `${EMAIL_SITE_ORIGIN}/privacy`;
  const y = copyrightYear();
  return `
          <div class="footer">
            <p class="footer-tagline">Off-grid eco-retreat · Bulgaria</p>
            <p class="footer-home"><a href="${htmlEscape(EMAIL_SITE_ORIGIN)}">driftdwells.com</a></p>
            <p><a href="${htmlEscape(terms)}">Terms</a> · <a href="${htmlEscape(privacy)}">Privacy</a> · <a href="${htmlEscape(INSTAGRAM_URL)}">Instagram</a> · <a href="${htmlEscape(FACEBOOK_URL)}">Facebook</a></p>
            <p class="footer-legal">© ${y} Drift &amp; Dwells</p>
          </div>`;
}

function internalEmailFooterHtml() {
  const y = copyrightYear();
  return `
          <div class="footer">
            <p class="footer-legal">© ${y} Drift &amp; Dwells. Internal notification.</p>
            <p><a href="${htmlEscape(INSTAGRAM_URL)}">Instagram</a> | <a href="${htmlEscape(FACEBOOK_URL)}">Facebook</a></p>
          </div>`;
}

const GMA_GUEST_EXTRA_CSS = `
  section[lang="en"], section[lang="bg"] { margin: 0; }
  section[lang="bg"] { margin-top: 4px; }
  hr {
    border: none;
    border-top: 1px solid #e5e2da;
    margin: 28px 0;
  }
  section p { margin: 0 0 16px; }
  section p:last-child { margin-bottom: 0; }
  section strong { font-weight: 600; color: #1a1918; }
  section a { color: #5a6570; text-decoration: underline; text-underline-offset: 2px; }
`;

function stripHtmlForPreheader(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

/**
 * @param {{ audience?: 'guest'|'ops', subject: string, fragmentHtml: string, propertyName?: string|null }} input
 */
function renderGmaEmailHtml({ audience = 'guest', subject, fragmentHtml, propertyName = null }) {
  const safeSubject = String(subject || '').trim() || 'Message from Drift & Dwells';
  const bodyHtml = String(fragmentHtml || '');
  const preheader = stripHtmlForPreheader(bodyHtml) || safeSubject;
  const logoUrl = resolveBrandLogoAbsoluteUrl();

  if (audience === 'ops') {
    return buildInternalNotificationHtml({
      title: safeSubject,
      preheader,
      logoUrl,
      siteHomeUrl: EMAIL_SITE_ORIGIN,
      headerAccentColor: '#b0aea6',
      headerLogoWidth: 160,
      headerTagline:
        `<span class="email-kicker">Operations</span><span class="email-tagline-lead">${htmlEscape(safeSubject)}</span>`,
      bodyHtml,
      extraHeadCss: INTERNAL_NOTIFICATION_EXTRA_CSS,
      footerHtml: internalEmailFooterHtml()
    });
  }

  const propLabel = propertyName ? htmlEscape(String(propertyName)) : 'your stay';
  return buildGuestTransactionalHtml({
    title: safeSubject,
    preheader,
    logoUrl,
    siteHomeUrl: EMAIL_SITE_ORIGIN,
    headerAccentColor: BRAND_SAGE,
    headerLogoWidth: 208,
    headerTagline:
      `<span class="email-kicker">Arrival information</span><span class="email-tagline-lead">Practical details for ${propLabel}</span>`,
    bodyHtml,
    extraHeadCss: GMA_GUEST_EXTRA_CSS,
    footerHtml: guestEmailFooterHtml()
  });
}

module.exports = {
  renderGmaEmailHtml,
  resolveBrandLogoAbsoluteUrl
};
