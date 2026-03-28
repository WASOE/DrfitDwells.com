import { onCLS, onINP, onLCP } from 'web-vitals';

function pickLcpTarget(metric) {
  if (metric.name !== 'LCP') return null;
  const e = metric.entries?.[metric.entries.length - 1];
  if (!e || e.entryType !== 'largest-contentful-paint') return null;
  const el = e.element;
  if (el && el.tagName) {
    const tag = el.tagName.toLowerCase();
    if (el.id) return `${tag}#${el.id}`;
    return tag;
  }
  if (e.url) return e.url;
  return null;
}

function sendToEndpoint(payload) {
  const url = import.meta.env.VITE_WEB_VITALS_ENDPOINT;
  if (!url) return;
  const body = JSON.stringify(payload);
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      return;
    }
  } catch {
    // fall through
  }
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true
  }).catch(() => {});
}

export function initWebVitals() {
  const route = typeof window !== 'undefined' ? window.location.pathname : '';

  const report = (metric) => {
    const payload = {
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      delta: metric.delta,
      id: metric.id,
      navigationType: metric.navigationType,
      route
    };
    if (metric.name === 'LCP') {
      payload.lcpTarget = pickLcpTarget(metric);
    }
    sendToEndpoint(payload);
    if (import.meta.env.DEV) {
      console.debug('[vitals]', payload.name, payload.value, payload.lcpTarget || '');
    }
  };

  onLCP(report);
  onCLS(report);
  onINP(report);
}
