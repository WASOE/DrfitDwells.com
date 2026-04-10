const SESSION_KEY = 'dd_track_session_v1';
const ATTRIB_KEY = 'dd_attrib_v1';

function getCookie(name) {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : '';
}

function getOrCreateSessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `s_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

function readStoredAttribution() {
  try {
    const raw = sessionStorage.getItem(ATTRIB_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Payload persisted on Booking for Meta CAPI Purchase (retry-safe).
 * @returns {{ eventSourceUrl: string, fbp?: string, fbc?: string, sessionId?: string }}
 */
export function getMetaClientContextPayload() {
  if (typeof window === 'undefined') {
    return { eventSourceUrl: '' };
  }
  const href = `${window.location.origin}${window.location.pathname}${window.location.search || ''}`;
  const eventSourceUrl = href.slice(0, 2000);

  const fbpRaw = getCookie('_fbp');
  const fbp = fbpRaw ? fbpRaw.slice(0, 500) : undefined;

  const fbcCookie = getCookie('_fbc');
  let fbc = fbcCookie ? fbcCookie.slice(0, 500) : undefined;
  if (!fbc) {
    const o = readStoredAttribution();
    const fbclid = o?.fbclid;
    if (fbclid && String(fbclid).trim()) {
      let ts = Math.floor(Date.now() / 1000);
      if (o.capturedAt) {
        const d = Date.parse(o.capturedAt);
        if (!Number.isNaN(d)) ts = Math.floor(d / 1000);
      }
      fbc = `fb.1.${ts}.${String(fbclid).trim()}`.slice(0, 500);
    }
  }

  const sessionId = getOrCreateSessionId() || undefined;

  const out = { eventSourceUrl };
  if (fbp) out.fbp = fbp;
  if (fbc) out.fbc = fbc;
  if (sessionId) out.sessionId = sessionId;
  return out;
}
