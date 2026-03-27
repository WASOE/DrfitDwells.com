export const SUPPORT_WHATSAPP_LINK = 'https://wa.me/359876342540';

export const normalizePhone = (value = '') => String(value).replace(/[^\d+]/g, '');

export const buildTelLink = (value = '') => {
  const normalized = normalizePhone(value);
  return normalized ? `tel:${normalized}` : '';
};

export const looksLikePdf = (url = '') => /\.pdf($|\?)/i.test(url || '');

export const isAbsoluteUrl = (value = '') => /^https?:\/\//i.test(value || '');
export const isRelativeGuidePath = (value = '') =>
  /^\/guides\/(?:[a-z0-9]+(?:-[a-z0-9]+)*)(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(value || '');

export const toAbsoluteGuideUrl = (value = '') => {
  if (!value) return '';
  if (isAbsoluteUrl(value)) return value;
  if (isRelativeGuidePath(value)) return `${window.location.origin}${value}`;
  return `${window.location.origin}/${value}`;
};

export const openPrintableGuide = () => {
  window.print();
};

export const copyToClipboard = async (text) => {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_error) {
    return false;
  }
};

export const getGuideCtaLabel = (url = '') => {
  if (!url) return '';
  return looksLikePdf(url) ? 'Download Offline Guide (PDF)' : 'Open Arrival Guide';
};

/**
 * Fetches a same-origin URL and triggers a file save with a stable filename.
 * Avoids relying on `<a download>` alone (often ignored or opens XML in-browser on mobile).
 * @param {string} [mimeType] - Optional; e.g. `application/gpx+xml` helps some map apps recognize the file.
 */
export async function downloadUrlAsFile(url, filename, mimeType) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) {
    throw new Error(`Download failed (${res.status})`);
  }
  const buf = await res.arrayBuffer();
  const type =
    mimeType || res.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
  const blob = new Blob([buf], { type });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
