const STORAGE_KEY_V2 = 'dd_attrib_v2';
const STORAGE_KEY_V1 = 'dd_attrib_v1';
const TTL_MS = 60 * 24 * 60 * 60 * 1000;
const REFERRAL_RE = /^[a-z0-9_-]{1,80}$/;
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

function normalizeReferralCode(raw) {
  if (raw == null) return null;
  const value = String(raw).trim().toLowerCase();
  if (!value || !REFERRAL_RE.test(value)) return null;
  return value;
}

function safeParseJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readStoredV2() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_V2);
    if (!raw) return null;
    const parsed = safeParseJson(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.expiresAt) {
      const expiresAt = new Date(parsed.expiresAt);
      if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
        localStorage.removeItem(STORAGE_KEY_V2);
        return null;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

function readLegacyV1() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_V1);
    const parsed = safeParseJson(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredV2(obj) {
  try {
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(obj));
  } catch {
    /* ignore */
  }
}

function readStored() {
  const v2 = readStoredV2();
  if (v2) return v2;
  const v1 = readLegacyV1();
  if (!v1) return null;
  const upgraded = {
    referralCode: normalizeReferralCode(v1.referralCode || null) || undefined,
    attributionCapturedAt: v1.attributionCapturedAt || v1.capturedAt || undefined,
    utmSource: v1.utmSource || undefined,
    utmMedium: v1.utmMedium || undefined,
    utmCampaign: v1.utmCampaign || undefined,
    utmTerm: v1.utmTerm || undefined,
    utmContent: v1.utmContent || undefined,
    gclid: v1.gclid || undefined,
    gbraid: v1.gbraid || undefined,
    wbraid: v1.wbraid || undefined,
    fbclid: v1.fbclid || undefined,
    msclkid: v1.msclkid || undefined,
    referrer: v1.referrer || undefined,
    landingPath: v1.landingPath || undefined,
    expiresAt: new Date(Date.now() + TTL_MS).toISOString()
  };
  writeStoredV2(upgraded);
  return upgraded;
}

/**
 * Capture first-touch attribution from URL + referrer once per session.
 * Call on app boot (e.g. SiteLayout or main).
 */
export function captureAttributionFromUrl() {
  if (typeof window === 'undefined') return;
  const existing = readStored();
  if (existing && existing.expiresAt) return;

  const params = new URLSearchParams(window.location.search);
  const referralCode =
    normalizeReferralCode(params.get('ref')) ||
    normalizeReferralCode(params.get('referral')) ||
    normalizeReferralCode(params.get('creator'));
  const capturedAt = new Date().toISOString();
  const next = {
    referralCode: referralCode || undefined,
    attributionCapturedAt: capturedAt,
    landingPath: `${window.location.pathname}${window.location.search || ''}`.slice(0, 500),
    referrer: (document.referrer || '').slice(0, 500),
    expiresAt: new Date(Date.now() + TTL_MS).toISOString()
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

  if (next.referralCode) any = true;
  if (any) writeStoredV2(next);
}

/** Payload for POST /api/bookings (attribution field). */
export function getAttributionPayload() {
  const o = readStored();
  if (!o) return undefined;
  return {
    referralCode: o.referralCode || undefined,
    attributionCapturedAt: o.attributionCapturedAt || undefined,
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
