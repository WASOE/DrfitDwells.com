const STORAGE_KEY = 'dd_attrib_v1';
const PARAM_MAP = {
  utm_source: 'utmSource',
  utm_medium: 'utmMedium',
  utm_campaign: 'utmCampaign',
  utm_term: 'utmTerm',
  utm_content: 'utmContent',
  gclid: 'gclid',
  gbraid: 'gbraid',
  wbraid: 'wbraid',
  fbclid: 'fbclid',
  msclkid: 'msclkid'
};

function readStored() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeStored(obj) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    /* ignore */
  }
}

/**
 * Capture first-touch attribution from URL + referrer once per session.
 * Call on app boot (e.g. SiteLayout or main).
 */
export function captureAttributionFromUrl() {
  if (typeof window === 'undefined') return;
  const existing = readStored();
  if (existing && existing.capturedAt) return;

  const params = new URLSearchParams(window.location.search);
  const next = {
    capturedAt: new Date().toISOString(),
    landingPath: `${window.location.pathname}${window.location.search || ''}`.slice(0, 500),
    referrer: (document.referrer || '').slice(0, 500)
  };

  let any = false;
  for (const [param, key] of Object.entries(PARAM_MAP)) {
    const v = params.get(param);
    if (v) {
      next[key] = v.slice(0, 500);
      any = true;
    }
  }
  if (next.referrer) any = true;
  if (next.landingPath) any = true;

  if (any) writeStored(next);
}

/** Payload for POST /api/bookings (attribution field). */
export function getAttributionPayload() {
  const o = readStored();
  if (!o) return undefined;
  return {
    utmSource: o.utmSource || undefined,
    utmMedium: o.utmMedium || undefined,
    utmCampaign: o.utmCampaign || undefined,
    utmTerm: o.utmTerm || undefined,
    utmContent: o.utmContent || undefined,
    gclid: o.gclid || undefined,
    gbraid: o.gbraid || undefined,
    wbraid: o.wbraid || undefined,
    fbclid: o.fbclid || undefined,
    msclkid: o.msclkid || undefined,
    referrer: o.referrer || undefined,
    landingPath: o.landingPath || undefined
  };
}
