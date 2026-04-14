'use strict';

const crypto = require('crypto');

const MAX_MANUAL_RESEND_SUBJECT_LENGTH = 500;
const MAX_MANUAL_RESEND_HTML_LENGTH = 400 * 1024;

/**
 * Narrow HTML sanitization for admin manual resend only.
 * Strips script tags and javascript: URLs in common URL attributes.
 */
function sanitizeManualResendHtml(html) {
  if (html == null) return '';
  let out = String(html);
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<script\b[^>]*\/?>/gi, '');
  out = out.replace(/\b(href|src)\s*=\s*(["'])\s*javascript:/gi, (_, attr, q) => `${attr}=${q}#`);
  out = out.replace(/\b(href|src)\s*=\s*javascript:/gi, '$1=#');
  return out;
}

function derivePlainTextFromHtml(html) {
  const cleaned = sanitizeManualResendHtml(html || '');
  const noStyle = cleaned.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
  const noTags = noStyle.replace(/<[^>]+>/g, ' ');
  return noTags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function hashManualResendHtml(html) {
  return crypto.createHash('sha256').update(String(html || ''), 'utf8').digest('hex');
}

module.exports = {
  MAX_MANUAL_RESEND_SUBJECT_LENGTH,
  MAX_MANUAL_RESEND_HTML_LENGTH,
  sanitizeManualResendHtml,
  derivePlainTextFromHtml,
  hashManualResendHtml
};
