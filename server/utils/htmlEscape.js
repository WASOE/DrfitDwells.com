/**
 * Escape text for safe interpolation into HTML attributes and text nodes.
 */
function htmlEscape(s) {
  if (s == null || s === '') return '';
  const str = String(s);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { htmlEscape };
