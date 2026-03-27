let gtmLoaded = false;
let pixelLoaded = false;

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
