const STORAGE_KEY = 'dd_consent_v1';

/** @typedef {{ analytics: boolean; ads: boolean }} ConsentChoice */

export function readConsentChoice() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (typeof o.analytics !== 'boolean' || typeof o.ads !== 'boolean') return null;
    return { analytics: o.analytics, ads: o.ads };
  } catch {
    return null;
  }
}

/** @param {ConsentChoice} choice */
export function writeConsentChoice(choice) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  } catch {
    /* ignore */
  }
}

/**
 * Apply Google Consent Mode v2 update + optional GTM / Pixel bootstrap.
 * @param {ConsentChoice} choice
 * @param {{ loadGtm?: () => void; loadMetaPixel?: () => void }} hooks
 */
export function applyConsentToTags(choice, hooks = {}) {
  if (typeof window === 'undefined') return;

  const analyticsGranted = choice.analytics ? 'granted' : 'denied';
  const adsGranted = choice.ads ? 'granted' : 'denied';

  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag === 'function') {
    window.gtag('consent', 'update', {
      analytics_storage: analyticsGranted,
      ad_storage: adsGranted,
      ad_user_data: adsGranted,
      ad_personalization: adsGranted
    });
  }

  if (choice.analytics && typeof hooks.loadGtm === 'function') {
    hooks.loadGtm();
  }
  if (choice.ads && typeof hooks.loadMetaPixel === 'function') {
    hooks.loadMetaPixel();
  }
}

/** Install default denied consent before any tags (call once at boot). */
export function installConsentDefaults() {
  if (typeof window === 'undefined') return;

  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== 'function') {
    window.gtag = function gtag() {
      window.dataLayer.push(arguments);
    };
  }

  window.gtag('consent', 'default', {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    wait_for_update: 500
  });

  const saved = readConsentChoice();
  if (saved) {
    applyConsentToTags(saved, {
      loadGtm: () => import('./tagLoader.js').then((m) => m.loadGtmOnce()),
      loadMetaPixel: () => import('./tagLoader.js').then((m) => m.loadMetaPixelOnce())
    });
  }
}
