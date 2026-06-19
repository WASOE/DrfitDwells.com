import { readConsentChoice } from './consent';
import { getAttributionPayload, getFunnelSessionKey, getFunnelVisitorKey } from './attribution';

const FUNNEL_ENDPOINT = '/api/funnel-events';

function isFunnelTrackingEnabled() {
  return String(import.meta.env.VITE_FUNNEL_TRACKING_ENABLED || '').trim().toLowerCase() === 'true';
}

export function isFunnelAnalyticsConsented() {
  const choice = readConsentChoice();
  return choice?.analytics === true;
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
    gclid,
    fbclid,
    msclkid,
    referrer,
    landingPath,
    referralCode
  } = payload;
  const attribution = {
    ...(utmSource ? { utmSource } : {}),
    ...(utmMedium ? { utmMedium } : {}),
    ...(utmCampaign ? { utmCampaign } : {}),
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

export function trackFunnelEvent(eventType, fields = {}) {
  if (!isFunnelTrackingEnabled() || !isFunnelAnalyticsConsented()) return;
  if (typeof window === 'undefined') return;

  const sessionKey = getFunnelSessionKey();
  if (!sessionKey) return;

  const payload = {
    eventType,
    sessionKey,
    ...(getFunnelVisitorKey() ? { visitorKey: getFunnelVisitorKey() } : {}),
    ...fields
  };

  const attribution = buildAttributionSubset();
  if (attribution) payload.attribution = attribution;

  sendFunnelPayload(payload);
}
