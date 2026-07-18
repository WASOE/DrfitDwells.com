/**
 * Conservative in-app / embedded browser detection.
 * Prefer false negatives over false positives on real Safari/Chrome.
 */

const IN_APP_PATTERNS = [
  /Instagram/i,
  /FBAN|FBAV|FB_IAB|FBIOS|FBAN\//i,
  /Messenger/i,
  /Line\//i,
  /TikTok/i,
  /BytedanceWebview/i,
  /; wv\)/i // Android WebView
];

/**
 * @param {string} [ua]
 * @returns {boolean}
 */
export function isInAppBrowser(ua = typeof navigator !== 'undefined' ? navigator.userAgent : '') {
  const value = String(ua || '');
  if (!value) return false;
  return IN_APP_PATTERNS.some((re) => re.test(value));
}

/**
 * Coarse UA class for telemetry (no raw UA string persisted by callers).
 * @param {string} [ua]
 * @returns {'instagram'|'facebook'|'safari'|'other'}
 */
export function getUaClass(ua = typeof navigator !== 'undefined' ? navigator.userAgent : '') {
  const value = String(ua || '');
  if (/Instagram/i.test(value)) return 'instagram';
  if (/FBAN|FBAV|FB_IAB|FBIOS|Messenger/i.test(value)) return 'facebook';
  if (/Safari/i.test(value) && !/CriOS|Chrome|Android/i.test(value)) return 'safari';
  return 'other';
}
