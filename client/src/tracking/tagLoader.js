let gtmLoaded = false;
let pixelLoaded = false;
let googleAdsGtagLoaded = false;

export function loadGtmOnce() {
  const id = import.meta.env.VITE_GTM_ID;
  if (!id || gtmLoaded || typeof document === 'undefined') return;
  gtmLoaded = true;

  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
}

export function loadMetaPixelOnce() {
  const pixelId = import.meta.env.VITE_META_PIXEL_ID;
  if (!pixelId || pixelLoaded || typeof document === 'undefined') return;
  pixelLoaded = true;

  !(function (f, b, e, v, n, t, s) {
    if (f.fbq) return;
    n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n;
    n.push = n;
    n.loaded = !0;
    n.version = '2.0';
    n.queue = [];
    t = b.createElement(e);
    t.async = !0;
    t.src = v;
    s = b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t, s);
  })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

  if (typeof window.fbq === 'function') {
    window.fbq('init', pixelId);
    window.fbq('track', 'PageView');
  }
}

/**
 * Optional Google Ads gtag (AW-xxxxxxx) for first-party conversion linker cookies.
 * Prefer also adding a Conversion Linker tag in GTM on All Pages after consent; use this when you need linker outside GTM.
 */
export function loadGoogleAdsGtagOnce() {
  const id = import.meta.env.VITE_GOOGLE_ADS_ID;
  if (!id || googleAdsGtagLoaded || typeof document === 'undefined') return;
  googleAdsGtagLoaded = true;

  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== 'function') {
    window.gtag = function gtag() {
      window.dataLayer.push(arguments);
    };
  }

  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);

  window.gtag('js', new Date());
  window.gtag('config', id);
}
