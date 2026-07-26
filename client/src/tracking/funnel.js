import { readConsentChoice } from './consent';
import {
  getAttributionPayload,
  getFunnelSessionKey,
  getFunnelVisitorKey
} from './attribution';

const FUNNEL_ENDPOINT = '/api/funnel-events';

const LANDING_SESSION_FLAG = 'dd_funnel_landing_emitted_v1';
const LAST_PAGE_VIEW_KEY = 'dd_funnel_last_page_view_v1';

function isFunnelTrackingEnabled() {
  return String(import.meta.env.VITE_FUNNEL_TRACKING_ENABLED || '').trim().toLowerCase() === 'true';
}

export function isFunnelAnalyticsConsented() {
  const choice = readConsentChoice();
  return choice?.analytics === true;
}

function newEventId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function coarseDeviceCategory() {
  if (typeof window === 'undefined') return undefined;
  const w = window.innerWidth || 0;
  if (w < 768) return 'mobile';
  if (w < 1024) return 'tablet';
  return 'desktop';
}

function coarseScreenCategory() {
  if (typeof window === 'undefined') return undefined;
  const w = window.screen?.width || 0;
  if (w < 768) return 'sm';
  if (w < 1280) return 'md';
  return 'lg';
}

export function getFunnelIdentityPayload() {
  if (!isFunnelAnalyticsConsented()) {
    return {};
  }
  const sessionKey = getFunnelSessionKey();
  const visitorKey = getFunnelVisitorKey();
  return {
    ...(sessionKey ? { funnelSessionKey: sessionKey } : {}),
    ...(visitorKey ? { funnelVisitorKey: visitorKey } : {})
  };
}

function buildAttributionSubset() {
  if (!isFunnelAnalyticsConsented()) return undefined;
  const payload = getAttributionPayload();
  if (!payload) return undefined;
  const {
    utmSource,
    utmMedium,
    utmCampaign,
    utmTerm,
    utmContent,
    gclid,
    fbclid,
    msclkid,
    referrer,
    landingPath,
    referralCode
  } = payload;
  const attribution = {
    ...(utmSource ? { utmSource, source: utmSource } : {}),
    ...(utmMedium ? { utmMedium, medium: utmMedium } : {}),
    ...(utmCampaign ? { utmCampaign, campaign: utmCampaign } : {}),
    ...(utmTerm ? { utmTerm, term: utmTerm } : {}),
    ...(utmContent ? { utmContent, content: utmContent } : {}),
    ...(gclid ? { gclid } : {}),
    ...(fbclid ? { fbclid } : {}),
    ...(msclkid ? { msclkid } : {}),
    ...(referrer ? { referrer } : {}),
    ...(landingPath ? { landingPath } : {}),
    ...(referralCode ? { referralCode } : {})
  };
  return Object.keys(attribution).length ? attribution : undefined;
}

function sendFunnelPayload(payload) {
  const body = JSON.stringify(payload);
  window.setTimeout(() => {
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon(FUNNEL_ENDPOINT, blob);
        return;
      }
      fetch(FUNNEL_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true
      }).catch(() => {});
    } catch {
      /* ignore */
    }
  }, 0);
}

/**
 * Track a behavioural funnel event. Never throws. Never blocks UX.
 */
export function trackFunnelEvent(eventType, fields = {}) {
  if (!isFunnelTrackingEnabled() || !isFunnelAnalyticsConsented()) return;
  if (typeof window === 'undefined') return;

  const sessionKey = getFunnelSessionKey();
  if (!sessionKey) return;

  const visitorKey = getFunnelVisitorKey();
  const payload = {
    eventType,
    eventId: fields.eventId || newEventId(),
    sessionKey,
    ...(visitorKey ? { visitorKey, anonymousId: visitorKey } : {}),
    occurredAt: fields.occurredAt || new Date().toISOString(),
    pagePath: fields.pagePath || window.location.pathname,
    pageTitle: fields.pageTitle || (typeof document !== 'undefined' ? document.title : undefined),
    deviceCategory: fields.deviceCategory || coarseDeviceCategory(),
    screenCategory: fields.screenCategory || coarseScreenCategory(),
    language:
      fields.language ||
      (typeof navigator !== 'undefined' ? String(navigator.language || '').slice(0, 16) : undefined),
    ...fields
  };

  // Never allow client to send server-only names even if caller errs
  const blocked = new Set([
    'quote_created',
    'payment_started',
    'payment_succeeded',
    'payment_failed',
    'payment_cancelled',
    'booking_created',
    'booking_confirmed',
    'quote_received',
    'booking_converted'
  ]);
  if (blocked.has(String(eventType))) return;

  const attribution = buildAttributionSubset();
  if (attribution) {
    payload.attribution = attribution;
    if (!payload.firstTouch) payload.firstTouch = attribution;
    payload.lastTouch = attribution;
  }

  // Strip undefined
  Object.keys(payload).forEach((k) => {
    if (payload[k] === undefined) delete payload[k];
  });

  sendFunnelPayload(payload);
}

/**
 * Once per analytics-consented session.
 */
export function trackLandingOnce(extra = {}) {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return;
  try {
    if (sessionStorage.getItem(LANDING_SESSION_FLAG) === '1') return;
    sessionStorage.setItem(LANDING_SESSION_FLAG, '1');
  } catch {
    return;
  }
  trackFunnelEvent('landing', {
    landingPage: window.location.pathname + window.location.search,
    referrer: typeof document !== 'undefined' ? document.referrer || undefined : undefined,
    ...extra
  });
}

/**
 * Page view on meaningful public route change. Suppresses React StrictMode double-fire
 * and same-path rerenders within 800ms, but allows later revisits.
 */
export function trackPageViewForPath(pathname, extra = {}) {
  if (typeof window === 'undefined') return;
  if (!pathname || pathname.startsWith('/ops') || pathname.startsWith('/admin')) return;

  const now = Date.now();
  try {
    const raw = sessionStorage.getItem(LAST_PAGE_VIEW_KEY);
    if (raw) {
      const prev = JSON.parse(raw);
      if (prev?.path === pathname && now - Number(prev.at || 0) < 800) {
        return;
      }
    }
    sessionStorage.setItem(LAST_PAGE_VIEW_KEY, JSON.stringify({ path: pathname, at: now }));
  } catch {
    /* proceed */
  }

  trackLandingOnce();
  trackFunnelEvent('page_view', {
    pagePath: pathname,
    routeName: pathname,
    ...extra
  });
}
